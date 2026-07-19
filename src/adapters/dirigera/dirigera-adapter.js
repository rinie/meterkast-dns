import { fetchDirigeraDevices } from "./fetch-dirigera-devices.js";
import { matchConfiguredDevices } from "./match-configured-devices.js";
import { resolveSecretEnv } from "../../core/secrets/resolve-secret-env.js";

// Polls Dirigera's REST API on an interval and yields one record per
// configured device on each poll. `records` is the flat registry slice
// this adapter reads from -- playlist entries with transport = "dirigera",
// address = the Dirigera-assigned device id. Connection config (hub
// hostname, bearer token) lives in .env, not the playlist -- see
// README.md "Secrets never go in the playlist"; hostname isn't a secret
// but is real-instance-specific config that shouldn't be hardcoded either.
//
// Pure/tested: parse-dirigera-response.js, match-configured-devices.js.
// This file's own job -- opening the HTTPS connection to a real hub -- is
// not verified in this environment; no Dirigera hardware reachable here.
export default async function* dirigeraAdapter(records, { intervalMs = 30000 } = {}) {
  const hostname = process.env.DIRIGERA_HOSTNAME;
  if (!hostname) {
    throw new Error("DIRIGERA_HOSTNAME is not set");
  }
  const bearerToken = resolveSecretEnv("DIRIGERA_BEARER_TOKEN");

  while (true) {
    const devices = await fetchDirigeraDevices(hostname, bearerToken);
    for (const match of matchConfiguredDevices(devices, records)) {
      yield match;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
