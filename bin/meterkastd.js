#!/usr/bin/env node
import { createRegistry } from "../src/core/registry/create-registry.js";
import { upsertRecord } from "../src/core/registry/upsert-record.js";
import { recordsAsObject } from "../src/core/registry/records-as-object.js";
import { readPlaylist } from "../src/core/playlist/read-playlist.js";
import { flattenDeviceReadings } from "../src/core/playlist/flatten-device-readings.js";
import { createServer } from "../src/core/server/create-server.js";
import dirigeraAdapter from "../src/adapters/dirigera/dirigera-adapter.js";

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

const hasDirigeraDevices = [...registry.records.values()].some(
  (record) => record.transport === "dirigera",
);
if (hasDirigeraDevices) {
  runDirigeraAdapter(registry).catch((error) => {
    // A misconfigured or unreachable hub stays contained to this adapter --
    // see IMPLEMENTATION.md "Isolation is not the default" -- the rest of
    // the resolver keeps serving whatever else it knows about. Unlike BLE,
    // this is plain HTTPS with no native binding, so it runs in-process by
    // design, not as a precaution against a crash.
    console.error("Dirigera adapter stopped:", error.message);
  });
}

const server = createServer(registry);
const port = Number(process.env.PORT ?? 8420);
server.listen(port, () => {
  console.log(`meterkast-dns listening on http://localhost:${port}`);
});

async function runDirigeraAdapter(registryToUpdate) {
  for await (const reading of dirigeraAdapter(recordsAsObject(registryToUpdate))) {
    upsertRecord(registryToUpdate, reading.name, reading);
  }
}
