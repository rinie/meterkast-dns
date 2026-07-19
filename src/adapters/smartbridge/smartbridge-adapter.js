import { fetchSmartbridgeDevices } from "./fetch-smartbridge-devices.js";
import { matchConfiguredDevices } from "./match-configured-devices.js";
import { resolveSecretEnv } from "../../core/secrets/resolve-secret-env.js";

// One bulk "sync" call covers every device on the account, same shape as
// Dirigera -- a poll cycle is a single fetch, matched against configured
// playlist entries by the ICS2000 device id.
export default async function* smartbridgeAdapter(records, { intervalMs = 60000 } = {}) {
  const hasSmartbridgeDevices = Object.values(records).some((record) => record.transport === "smartbridge");
  if (!hasSmartbridgeDevices) return;

  const email = resolveSecretEnv("SMARTBRIDGE_EMAIL");
  const mac = resolveSecretEnv("SMARTBRIDGE_MAC");
  const passwordHash = resolveSecretEnv("SMARTBRIDGE_PASSWORD_HASH");

  while (true) {
    const devices = await fetchSmartbridgeDevices({ hostname: "trustsmartcloud2.com", email, mac, passwordHash });
    for (const match of matchConfiguredDevices(devices, records)) {
      yield match;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
