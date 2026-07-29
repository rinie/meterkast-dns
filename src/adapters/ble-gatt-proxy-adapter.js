// Polling adapter for transport: "ble-gatt" playlist entries -- pairs
// with ble-gatt-profiles.js's registry to turn a bare {address,
// deviceType, proxyUrl} record into a real reading, via whichever
// mechanism meterkast-proxy's now-fully-generic firmware exposes
// (GET /scan/ble's serviceData for advertisement-based devices,
// POST /gatt/session for connect-based ones). No device-specific
// knowledge lives here either -- that's entirely in the profile.
import { fetchProxyJson } from "./proxy-adapter.js";
import { BLE_GATT_PROFILES } from "./ble-gatt-profiles.js";
import { log } from "../core/log.js";

// The ESP32's own NimBLEUUID::toString() renders a 16-bit UUID as
// "0xfcd2" (confirmed live against the real device, not assumed) --
// profiles reference the bare "fcd2" form instead (matching
// known-services.js's own convention), so matching has to be tolerant
// of the "0x" prefix rather than require an exact string match.
function normalizeUuid(uuid) {
  return uuid.toLowerCase().replace(/^0x/, "");
}

async function readAdvertisementProfile(proxyUrl, address, profile) {
  const devices = await fetchProxyJson(proxyUrl, "/scan/ble");
  const device = devices.find((d) => d.address.toLowerCase() === address.toLowerCase());
  if (!device?.serviceData) return undefined;

  const entry = Object.entries(device.serviceData).find(([uuid]) => normalizeUuid(uuid) === normalizeUuid(profile.serviceDataUuid));
  if (!entry) return undefined;

  return profile.decode(Buffer.from(entry[1], "hex"));
}

async function readGattProfile(proxyUrl, address, profile) {
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
export async function readBleGattRecord(name, record) {
  const profile = BLE_GATT_PROFILES[record.deviceType];
  if (!profile) {
    log("warn", `${name}: unknown ble-gatt deviceType "${record.deviceType}"`);
    return undefined;
  }

  const meta =
    profile.kind === "advertisement"
      ? await readAdvertisementProfile(record.proxyUrl, record.address, profile)
      : await readGattProfile(record.proxyUrl, record.address, profile);

  if (meta === undefined) {
    log("warn", `${name}: no reading this cycle (device not currently visible, or service/characteristic missing)`);
  }
  return meta;
}

export default async function* bleGattProxyAdapter(records, { intervalMs = 60000 } = {}) {
  const targets = Object.entries(records).filter(([, record]) => record.transport === "ble-gatt");
  if (targets.length === 0) return;

  while (true) {
    for (const [name, record] of targets) {
      try {
        const meta = await readBleGattRecord(name, record);
        if (meta !== undefined) yield { ...record, name, meta };
      } catch (error) {
        log("warn", `ble-gatt read failed for ${name}: ${error.message}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
