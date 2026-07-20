// Smartbridge/ICS2000 REST adapter (KlikAanKlikUit cloud). See README.md
// "Extending to cloud vendor APIs" for the honest cloud-vs-local caveat and
// the confirmed encrypted-payload limit. Verified against the real
// production API.
import https from "node:https";
import { resolveSecretEnv } from "../core/secrets.js";
import { log } from "../core/log.js";

export function parseSmartbridgeResponse(statusCode, body) {
  if (statusCode !== 200) {
    throw new Error(`Smartbridge API returned HTTP ${statusCode}`);
  }
  return JSON.parse(body);
}

// trustsmartcloud2.com is a real public API with a properly CA-signed
// cert -- rejectUnauthorized defaults to true, same reasoning as the
// Ecowitt adapter. Tests point hostname/port at a local mock and override
// it there only.
export function fetchSmartbridgeDevices(
  { hostname, email, mac, passwordHash },
  { port = 443, rejectUnauthorized = true } = {},
) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({ action: "sync", email, mac, password_hash: passwordHash });
    const req = https.request(
      {
        hostname,
        port,
        path: `/ics2000_api/gateway.php?${query}`,
        method: "GET",
        rejectUnauthorized,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            resolve(parseSmartbridgeResponse(res.statusCode, Buffer.concat(chunks).toString()));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// The ICS2000 cloud's `data`/`status` fields are opaque encrypted blobs --
// confirmed against the real API, not assumed: base64-looking ciphertext,
// no documented or publicly known way to decrypt them. They pass through
// unchanged rather than being guessed at, the same honest fallback as an
// undecoded 128-bit BLE UUID or LIRC's raw pulse mode. version_status and
// version_data still change when the device's real state changes, which is
// enough to detect "something happened" without knowing what happened.
//
// Spreads `...record` first, same as the mdns/dns adapters (and now
// dirigera-adapter.js, fixed for the identical reason) -- without it, any
// extra hand-typed playlist field this adapter doesn't itself manage
// (like displayFields/excludeDisplayFields, see server.js's withDisplay)
// was silently dropped instead of carried through.
export function matchConfiguredDevices(smartbridgeDevices, configuredRecords) {
  const byId = new Map(smartbridgeDevices.map((device) => [device.id, device]));
  const matches = [];
  for (const [name, record] of Object.entries(configuredRecords)) {
    if (record.transport !== "smartbridge") continue;
    const device = byId.get(record.address);
    if (!device) continue;
    matches.push({
      ...record,
      name,
      transport: "smartbridge",
      address: record.address,
      meta: {
        version_status: device.version_status,
        version_data: device.version_data,
        time_added: device.time_added,
        encrypted_data: device.data,
        encrypted_status: device.status,
      },
    });
  }
  return matches;
}

// One bulk "sync" call covers every device on the account, same shape as
// Dirigera -- a poll cycle is a single fetch, matched against configured
// playlist entries by the ICS2000 device id.
//
// A cycle's fetch is caught and logged rather than left to escape the
// generator -- a real bug hit in production, not in testing: a transient
// network error (ECONNRESET) on this single bulk call used to kill the
// whole adapter permanently (bin/meterkastd.js's own
// runPollingAdapter(...).catch() only logs once, it never restarts the
// loop), unlike Ecowitt/mDNS/DNS, which already caught per-device
// failures inside their own loops from the start. One bad cycle now just
// waits for the next one, the same resilience those adapters already had.
export default async function* smartbridgeAdapter(records, { intervalMs = 60000, fetchDevices = fetchSmartbridgeDevices } = {}) {
  const hasSmartbridgeDevices = Object.values(records).some((record) => record.transport === "smartbridge");
  if (!hasSmartbridgeDevices) return;

  const email = resolveSecretEnv("SMARTBRIDGE_EMAIL");
  const mac = resolveSecretEnv("SMARTBRIDGE_MAC");
  const passwordHash = resolveSecretEnv("SMARTBRIDGE_PASSWORD_HASH");

  while (true) {
    try {
      const devices = await fetchDevices({ hostname: "trustsmartcloud2.com", email, mac, passwordHash });
      for (const match of matchConfiguredDevices(devices, records)) {
        yield match;
      }
    } catch (error) {
      log("warn", `Smartbridge poll failed: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
