// Reading, writing, and watching the device-playlist.toml file, plus
// flattening its nested [devices.*] section into the flat registry
// namespace everything else uses. Dated backups live in playlist-backup.js
// -- a distinct enough concern (versioning/history) to be its own module.
import { readFile, writeFile, rename, watch } from "node:fs/promises";
import { dirname, join, basename, extname } from "node:path";
import { parse, stringify } from "smol-toml";
import { snapshotPlaylist } from "./playlist-backup.js";

export async function readPlaylist(path) {
  const text = await readFile(path, "utf8");
  return parse(text);
}

// Last-known-good, kept deliberately independent of git: the prior version
// survives even a bad hand-edit or a buggy adapter write without needing a
// commit to have happened first. Write-then-rename keeps a crash mid-write
// from ever leaving a truncated playlist on disk.
export async function writePlaylist(path, data) {
  const backupDir = join(dirname(path), "backups");
  const baseName = basename(path, extname(path));
  await snapshotPlaylist(path, backupDir, baseName);

  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, stringify(data), "utf8");
  await rename(tempPath, path);
}

export async function watchPlaylist(path, onChange, { signal } = {}) {
  const watcher = watch(path, { signal });
  for await (const event of watcher) {
    onChange(event);
  }
}

// Turns a nested `[devices.name]` + `[devices.name.readings]` playlist
// section into flat records, one per reading:
// `${deviceName}-${readingName}` -> {transport, address, service,
// characteristic}. Lets a human write the address once per physical
// device -- the same address-once pattern as RC5/newKaku remotes -- while
// every reading still ends up as an independently queryable entry in the
// same flat registry namespace as everything else, with no special-casing
// needed anywhere downstream (the core, the HTTP API).
export function flattenDeviceReadings(devicesSection = {}) {
  const flat = {};
  for (const [deviceName, device] of Object.entries(devicesSection)) {
    const { readings = {}, ...deviceFields } = device;
    for (const [readingName, reading] of Object.entries(readings)) {
      flat[`${deviceName}-${readingName}`] = { ...deviceFields, ...reading };
    }
  }
  return flat;
}
