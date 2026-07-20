// Ecowitt REST adapter (weather-station readings). See README.md
// "Extending to cloud vendor APIs" for the honest cloud-vs-local caveat
// versus Dirigera. Verified against the real production API.
import https from "node:https";
import { resolveSecretEnv } from "../core/secrets.js";
import { log } from "../core/log.js";

// Ecowitt wraps success/failure in the body itself, not just HTTP status:
// {code: 0, msg: "success", data: {...}}. code !== 0 is a real API-level
// error even when HTTP itself returned 200.
export function parseEcowittResponse(statusCode, body) {
  if (statusCode !== 200) {
    throw new Error(`Ecowitt API returned HTTP ${statusCode}`);
  }
  const parsed = JSON.parse(body);
  if (parsed.code !== 0) {
    throw new Error(`Ecowitt API error: ${parsed.msg} (code ${parsed.code})`);
  }
  return parsed.data;
}

// api.ecowitt.net is a real public cloud API with a properly CA-signed
// cert, unlike Dirigera's local hub -- rejectUnauthorized defaults to
// true. Tests point hostname/port at a local mock server and pass
// rejectUnauthorized: false only there, never against the real API.
export function fetchEcowittReading(
  { hostname, applicationKey, apiKey, mac },
  { port = 443, rejectUnauthorized = true } = {},
) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({
      application_key: applicationKey,
      api_key: apiKey,
      mac,
      call_back: "all",
      // Confirmed empirically against the real API: temp_unitid=2
      // (Fahrenheit) is the server's own default when this is omitted,
      // regardless of any unit preference set in the Ecowitt account/app
      // -- 1 requests Celsius explicitly rather than relying on that
      // default.
      temp_unitid: "1",
    });
    const req = https.request(
      {
        hostname,
        port,
        path: `/api/v3/device/real_time?${query}`,
        method: "GET",
        rejectUnauthorized,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            resolve(parseEcowittResponse(res.statusCode, Buffer.concat(chunks).toString()));
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

// Ecowitt's real_time endpoint is queried per device (one mac per call),
// unlike Dirigera's single bulk fetch -- so a poll cycle is N calls, one
// per configured ecowitt-transport playlist entry. A single station's
// fetch failing (offline, out of battery) is caught and logged per-device
// rather than aborting the whole cycle -- other stations should keep
// reporting even if one is down, unlike Dirigera where one fetch covers
// every device and a failure there really does mean the whole cycle failed.
export default async function* ecowittAdapter(records, { intervalMs = 60000 } = {}) {
  const targets = Object.entries(records).filter(([, record]) => record.transport === "ecowitt");
  if (targets.length === 0) return;

  const applicationKey = resolveSecretEnv("ECOWITT_APPLICATION_KEY");
  const apiKey = resolveSecretEnv("ECOWITT_API_KEY");

  while (true) {
    for (const [name, record] of targets) {
      try {
        const data = await fetchEcowittReading({
          hostname: "api.ecowitt.net",
          applicationKey,
          apiKey,
          mac: record.address,
        });
        yield { name, transport: "ecowitt", address: record.address, meta: data };
      } catch (error) {
        log("warn", `Ecowitt reading failed for ${name}: ${error.message}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
