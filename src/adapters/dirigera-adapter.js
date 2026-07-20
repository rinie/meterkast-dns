// Dirigera REST adapter: connect, decode, poll -- see README.md "Extending
// to vendor-hub REST APIs" for why this beats speaking Matter/Zigbee
// directly. Verified against both a local mock hub and the real hub with
// a real bearer token; see IMPLEMENTATION.md for what was actually run.
import https from "node:https";
import { resolveSecretEnv } from "../core/secrets.js";
import { log } from "../core/log.js";

export function parseDirigeraResponse(statusCode, body) {
  if (statusCode !== 200) {
    throw new Error(`Dirigera API returned ${statusCode}`);
  }
  return JSON.parse(body);
}

// Dirigera's local REST API uses a self-signed cert -- there's no CA for a
// LAN IP, which is normal for this class of device, not a shortcut being
// taken carelessly. rejectUnauthorized is scoped to this one request only,
// never global: NODE_TLS_REJECT_UNAUTHORIZED=0 would disable cert checking
// for every HTTPS call in the process, not just this one hub.
export function fetchDirigeraDevices(hostname, bearerToken, port = 8443) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        port,
        path: "/v1/devices",
        method: "GET",
        headers: { authorization: `Bearer ${bearerToken}` },
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            resolve(parseDirigeraResponse(res.statusCode, Buffer.concat(chunks).toString()));
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

// Matches Dirigera's raw device list against the playlist's configured
// dirigera-transport records (keyed by Dirigera's own device id), and
// produces upsert-ready records. Dirigera's own `attributes` object is
// passed through as `meta` verbatim rather than cherry-picked field by
// field -- the API already returns clean, well-named state (isOn,
// lightLevel, batteryPercentage, ...), which is the whole reason to use it
// instead of raw Zigbee/Matter in the first place.
export function matchConfiguredDevices(dirigeraDevices, configuredRecords) {
  const byId = new Map(dirigeraDevices.map((device) => [device.id, device]));
  const matches = [];
  for (const [name, record] of Object.entries(configuredRecords)) {
    if (record.transport !== "dirigera") continue;
    const device = byId.get(record.address);
    if (!device) continue;
    matches.push({
      name,
      transport: "dirigera",
      address: record.address,
      meta: device.attributes,
    });
  }
  return matches;
}

// Polls Dirigera's REST API on an interval and yields one record per
// configured device on each poll. `records` is the flat registry slice
// this adapter reads from -- playlist entries with transport = "dirigera",
// address = the Dirigera-assigned device id. Connection config (hub
// hostname, bearer token) lives in .env, not the playlist -- see
// README.md "Secrets never go in the playlist"; hostname isn't a secret
// but is real-instance-specific config that shouldn't be hardcoded either.
//
// A cycle's fetch is caught and logged rather than left to escape the
// generator -- a real bug found in production, not in testing: a
// transient network error (ECONNRESET) on this single bulk call used to
// kill the whole adapter permanently (bin/meterkastd.js's own
// runPollingAdapter(...).catch() only logs once, it never restarts the
// loop), unlike Ecowitt/mDNS/DNS, which already caught per-device
// failures inside their own loops from the start. One bad cycle now just
// waits for the next one, the same resilience those adapters already had.
export default async function* dirigeraAdapter(records, { intervalMs = 30000, fetchDevices = fetchDirigeraDevices } = {}) {
  const hostname = process.env.DIRIGERA_HOSTNAME;
  if (!hostname) {
    throw new Error("DIRIGERA_HOSTNAME is not set");
  }
  const bearerToken = resolveSecretEnv("DIRIGERA_BEARER_TOKEN");

  while (true) {
    try {
      const devices = await fetchDevices(hostname, bearerToken);
      for (const match of matchConfiguredDevices(devices, records)) {
        yield match;
      }
    } catch (error) {
      log("warn", `Dirigera poll failed: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
