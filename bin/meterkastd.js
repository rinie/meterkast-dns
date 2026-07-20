#!/usr/bin/env node
import { createRegistry, upsertRecord, recordsAsObject } from "../src/core/registry.js";
import { readPlaylist, flattenDeviceReadings } from "../src/core/playlist.js";
import { loadDisplayFields } from "../src/core/display-fields.js";
import { createServer } from "../src/core/server.js";
import { runPollingAdapter } from "../src/core/run-polling-adapter.js";
import { resolveSecretEnv } from "../src/core/secrets.js";
import dirigeraAdapter, { fetchDirigeraDevices, unclaimedDirigeraDevices } from "../src/adapters/dirigera-adapter.js";
import ecowittAdapter from "../src/adapters/ecowitt-adapter.js";
import smartbridgeAdapter, { fetchSmartbridgeDevices, unclaimedSmartbridgeDevices } from "../src/adapters/smartbridge-adapter.js";
import mdnsAdapter from "../src/adapters/mdns-adapter.js";
import dnsAdapter, { scanSubnet, unclaimedDnsCandidates } from "../src/adapters/dns-adapter.js";
import { log } from "../src/core/log.js";

const playlistPath =
  process.env.METERKAST_PLAYLIST ?? new URL("../device-playlist.toml", import.meta.url);
const displayFieldsDir =
  process.env.METERKAST_DISPLAY_FIELDS_DIR ?? new URL("../display-fields/", import.meta.url);

const registry = createRegistry();
const displayFields = await loadDisplayFields(displayFieldsDir);

const playlist = await readPlaylist(playlistPath).catch((error) => {
  if (error.code === "ENOENT") {
    log(
      "warn",
      `No device-playlist.toml found at ${playlistPath} -- starting empty. ` +
        "Copy device-playlist.example.toml to device-playlist.toml to get started.",
    );
  } else {
    throw error;
  }
  return {};
});
const { devices, ...flatEntries } = playlist;
for (const [name, record] of Object.entries(flatEntries)) {
  upsertRecord(registry, name, record);
}
for (const [name, record] of Object.entries(flattenDeviceReadings(devices))) {
  upsertRecord(registry, name, record);
}

const pollingAdapters = [
  ["dirigera", "Dirigera", dirigeraAdapter],
  ["ecowitt", "Ecowitt", ecowittAdapter],
  ["smartbridge", "Smartbridge", smartbridgeAdapter],
  ["mdns", "mDNS", mdnsAdapter],
  ["dns", "DNS", dnsAdapter],
];
for (const [transport, label, adapterFn] of pollingAdapters) {
  runPollingAdapter(registry, transport, adapterFn).catch((error) => {
    log("error", `${label} adapter stopped: ${error.message}`);
  });
}

// GET /discover/:transport's real work -- server.js stays
// transport-agnostic (it only knows a discovery function exists or it
// doesn't), the actual hub hostname/bearer token/cloud credentials are
// resolved here, the same place each polling adapter above resolves them.
// Dirigera/Smartbridge are wired up because they already fetch their full
// inventory in one bulk call, so "who's unclaimed" costs nothing extra.
// DNS is wired up too, but needs a `cidr` query param -- unlike a hub's
// own inventory call, there's no sane server-side default for "which
// subnet", so a missing one throws a clear message (surfaced as a 502 by
// handleDiscover, the same as any other discovery failure -- a missing
// param and a real network/credential error both mean "this scan didn't
// happen", no finer distinction needed on the wire). mDNS
// discovery (browsing for arbitrary LAN devices, not resolving an
// already-configured hostname) needs a different mechanism again
// (DNS-SD's own meta-query) and is parked -- see README.md "Discovering
// unclaimed devices".
const discover = {
  dirigera: async () => {
    const hostname = process.env.DIRIGERA_HOSTNAME;
    if (!hostname) throw new Error("DIRIGERA_HOSTNAME is not set");
    const bearerToken = resolveSecretEnv("DIRIGERA_BEARER_TOKEN");
    const devices = await fetchDirigeraDevices(hostname, bearerToken);
    return unclaimedDirigeraDevices(devices, recordsAsObject(registry));
  },
  smartbridge: async () => {
    const email = resolveSecretEnv("SMARTBRIDGE_EMAIL");
    const mac = resolveSecretEnv("SMARTBRIDGE_MAC");
    const passwordHash = resolveSecretEnv("SMARTBRIDGE_PASSWORD_HASH");
    const devices = await fetchSmartbridgeDevices({ hostname: "trustsmartcloud2.com", email, mac, passwordHash });
    return unclaimedSmartbridgeDevices(devices, recordsAsObject(registry));
  },
  dns: async (query) => {
    const cidr = query.get("cidr");
    if (!cidr) throw new Error('DNS discovery needs a "cidr" query param, e.g. ?cidr=192.168.1.0/24');
    const scanResults = await scanSubnet(cidr);
    return unclaimedDnsCandidates(scanResults, recordsAsObject(registry));
  },
};

const server = createServer(registry, displayFields, { playlistPath, discover });
const port = Number(process.env.PORT ?? 8420);
server.listen(port, () => {
  log("info", `meterkast-dns listening on http://localhost:${port}`);
});
