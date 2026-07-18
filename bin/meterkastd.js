#!/usr/bin/env node
import { createRegistry } from "../src/core/registry/create-registry.js";
import { upsertRecord } from "../src/core/registry/upsert-record.js";
import { readPlaylist } from "../src/core/playlist/read-playlist.js";
import { flattenDeviceReadings } from "../src/core/playlist/flatten-device-readings.js";
import { createServer } from "../src/core/server/create-server.js";

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

const server = createServer(registry);
const port = Number(process.env.PORT ?? 8420);
server.listen(port, () => {
  console.log(`meterkast-dns listening on http://localhost:${port}`);
});
