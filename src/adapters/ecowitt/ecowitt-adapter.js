import { fetchEcowittReading } from "./fetch-ecowitt-reading.js";
import { resolveSecretEnv } from "../../core/secrets/resolve-secret-env.js";

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
        console.error(`Ecowitt reading failed for ${name}:`, error.message);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
