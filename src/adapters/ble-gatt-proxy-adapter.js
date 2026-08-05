// Polling adapter for transport: "ble-gatt" playlist entries -- pairs
// with ble-gatt-profiles.js's registry to turn a bare {address,
// deviceType, proxyUrl} record into a real reading, via whichever
// mechanism meterkast-proxy's now-fully-generic firmware exposes
// (GET /scan/ble's serviceData for advertisement-based devices,
// POST /gatt/session for connect-based ones). No device-specific
// knowledge lives here either -- that's entirely in the profile.
import { fetchProxyJson } from "./proxy-adapter.js";
import { BLE_GATT_PROFILES } from "./ble-gatt-profiles.js";
import { normalizeUuid } from "./ble-ignore.js";
import { buildAliasIndex, resolveCandidates, currentAliasValue } from "../core/identity-resolver.js";
import { log } from "../core/log.js";

// Reverse-resolves each device the proxy currently reports against the
// alias index, looking for the one that currently belongs to `name` --
// rather than an exact `record.address` string match, which would
// silently stop working the moment a device's own address rotates (a
// privacy-mode BLE MAC, say). A genuinely ambiguous raw key (two live
// records both claiming it right now) is logged and treated as "not
// found this cycle," never guessed at -- same discipline
// resolveCandidates itself already documents.
function findResolvedDevice(devices, name, aliasIndex) {
  const now = new Date();
  for (const device of devices) {
    const result = resolveCandidates(aliasIndex, "mac", device.address, now);
    if (result.status === "resolved" && result.name === name) return device;
    if (result.status === "ambiguous" && result.candidates.some((c) => c.name === name)) {
      const others = result.candidates.map((c) => c.name).filter((n) => n !== name);
      log("warn", `${name}: ${device.address} is currently ambiguous (also claimed by ${others.join(", ")}) -- skipping this cycle`);
    }
  }
  return undefined;
}

async function readAdvertisementProfile(proxyUrl, name, profile, aliasIndex) {
  const devices = await fetchProxyJson(proxyUrl, "/scan/ble");
  const device = findResolvedDevice(devices, name, aliasIndex);
  if (!device?.serviceData) return undefined;

  const entry = Object.entries(device.serviceData).find(([uuid]) => normalizeUuid(uuid) === normalizeUuid(profile.serviceDataUuid));
  if (!entry) return undefined;

  return profile.decode(Buffer.from(entry[1], "hex"));
}

// A GATT connect has to pick one definite address to dial *before*
// anything comes back to reverse-resolve against, unlike the
// advertisement path above which naturally sees many addresses in one
// scan response -- currentAliasValue answers "which of this record's own
// aliases is live right now" directly, no index needed for that
// direction.
async function readGattProfile(proxyUrl, name, record, profile) {
  const address = currentAliasValue(record, "mac");
  if (!address) {
    log("warn", `${name}: no currently-valid mac alias to connect to`);
    return undefined;
  }

  const result = await fetchProxyJson(proxyUrl, "/gatt/session", {
    address,
    serviceUuid: profile.serviceUuid,
    read: profile.characteristics,
  });
  if (!result.ok) {
    log("warn", `GATT session for ${address} via ${proxyUrl} failed: ${result.error}`);
    return undefined;
  }

  const readingsBuffers = Object.fromEntries(
    Object.entries(result.readings).map(([uuid, hex]) => [uuid, Buffer.from(hex, "hex")]),
  );
  return profile.decode(readingsBuffers);
}

// One record, one attempt, no loop -- factored out from the generator
// below specifically so it's directly testable (await it once, assert,
// done) without ever needing to spin up or tear down an infinite
// while(true) generator, which async generators can't be reliably
// stopped mid-cycle from the outside (.return() only takes effect at a
// yield point, and a record that never yields -- an unknown deviceType,
// a device not currently visible -- never reaches one).
//
// aliasIndex defaults to an index built from just this one record --
// correct and sufficient for the common case (no `aliases` array, one
// static address), same as before this existed. A caller juggling
// several records (the generator below, or a test exercising
// rotation/ambiguity across more than one) passes a real, shared index
// built from all of them instead.
export async function readBleGattRecord(name, record, aliasIndex = buildAliasIndex({ [name]: record })) {
  const profile = BLE_GATT_PROFILES[record.deviceType];
  if (!profile) {
    log("warn", `${name}: unknown ble-gatt deviceType "${record.deviceType}"`);
    return undefined;
  }

  const meta =
    profile.kind === "advertisement"
      ? await readAdvertisementProfile(record.proxyUrl, name, profile, aliasIndex)
      : await readGattProfile(record.proxyUrl, name, record, profile);

  if (meta === undefined) {
    log("warn", `${name}: no reading this cycle (device not currently visible, or service/characteristic missing)`);
  }
  return meta;
}

export default async function* bleGattProxyAdapter(records, { intervalMs = 60000, aliasIndex } = {}) {
  const targets = Object.entries(records).filter(([, record]) => record.transport === "ble-gatt");
  if (targets.length === 0) return;

  const index = aliasIndex ?? buildAliasIndex(records);
  while (true) {
    for (const [name, record] of targets) {
      try {
        const meta = await readBleGattRecord(name, record, index);
        if (meta !== undefined) yield { ...record, name, meta };
      } catch (error) {
        log("warn", `ble-gatt read failed for ${name}: ${error.message}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
