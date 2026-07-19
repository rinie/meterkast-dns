#!/usr/bin/env node
import { createRegistry } from "../src/core/registry/create-registry.js";
import { upsertRecord } from "../src/core/registry/upsert-record.js";
import { recordsAsObject } from "../src/core/registry/records-as-object.js";
import { readPlaylist } from "../src/core/playlist/read-playlist.js";
import { flattenDeviceReadings } from "../src/core/playlist/flatten-device-readings.js";
import { createServer } from "../src/core/server/create-server.js";
import bleGattAdapter from "../src/adapters/ble-gatt/ble-gatt-adapter.js";

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

const hasBluetoothDevices = [...registry.records.values()].some(
  (record) => record.transport === "bluetooth",
);
if (hasBluetoothDevices) {
  runBleGattAdapter(registry).catch((error) => {
    // A native/blocking binding fault stays contained to this adapter --
    // see IMPLEMENTATION.md "Isolation is not the default" -- the rest of
    // the resolver keeps serving whatever else it knows about.
    console.error("BLE GATT adapter stopped:", error.message);
  });
}

const server = createServer(registry);
const port = Number(process.env.PORT ?? 8420);
server.listen(port, () => {
  console.log(`meterkast-dns listening on http://localhost:${port}`);
});

async function runBleGattAdapter(registryToUpdate) {
  for await (const reading of bleGattAdapter(recordsAsObject(registryToUpdate))) {
    upsertRecord(registryToUpdate, reading.name, reading);
  }
}
