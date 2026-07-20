#!/usr/bin/env node
import { createRegistry, upsertRecord } from "../src/core/registry.js";
import { readPlaylist, flattenDeviceReadings } from "../src/core/playlist.js";
import { createServer } from "../src/core/server.js";
import { runPollingAdapter } from "../src/core/run-polling-adapter.js";
import dirigeraAdapter from "../src/adapters/dirigera-adapter.js";
import ecowittAdapter from "../src/adapters/ecowitt-adapter.js";
import smartbridgeAdapter from "../src/adapters/smartbridge-adapter.js";
import mdnsAdapter from "../src/adapters/mdns-adapter.js";

const playlistPath =
  process.env.METERKAST_PLAYLIST ?? new URL("../device-playlist.toml", import.meta.url);

const registry = createRegistry();

const playlist = await readPlaylist(playlistPath).catch((error) => {
  if (error.code === "ENOENT") {
    console.warn(
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
];
for (const [transport, label, adapterFn] of pollingAdapters) {
  runPollingAdapter(registry, transport, adapterFn).catch((error) => {
    console.error(`${label} adapter stopped:`, error.message);
  });
}

const server = createServer(registry);
const port = Number(process.env.PORT ?? 8420);
server.listen(port, () => {
  console.log(`meterkast-dns listening on http://localhost:${port}`);
});
