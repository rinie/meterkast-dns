// Reading, writing, and watching the device-playlist.toml file, plus
// flattening its nested [devices.*] section into the flat registry
// namespace everything else uses. Dated backups live in playlist-backup.js
// -- a distinct enough concern (versioning/history) to be its own module.
import { readFile, writeFile, rename, watch } from "node:fs/promises";
import { dirname, join, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "smol-toml";
import { snapshotPlaylist } from "./playlist-backup.js";

// bin/meterkastd.js passes a file:// URL (relative to import.meta.url,
// same as loadDisplayFields's own dir argument) -- readFile alone
// tolerates that, but node:path's dirname/basename/extname don't, and
// template-literal string concatenation (`${path}.tmp`) would silently
// stringify a URL into something that is not a valid path at all.
// Normalized to a plain string once here, before either function touches
// the filesystem, rather than at every call site.
function toPathString(path) {
  return path instanceof URL ? fileURLToPath(path) : path;
}

export async function readPlaylist(path) {
  const text = await readFile(toPathString(path), "utf8");
  return parse(text);
}

// Last-known-good, kept deliberately independent of git: the prior version
// survives even a bad hand-edit or a buggy adapter write without needing a
// commit to have happened first. Write-then-rename keeps a crash mid-write
// from ever leaving a truncated playlist on disk.
export async function writePlaylist(rawPath, data) {
  const path = toPathString(rawPath);
  const backupDir = join(dirname(path), "backups");
  const baseName = basename(path, extname(path));
  await snapshotPlaylist(path, backupDir, baseName);

  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, stringify(data), "utf8");
  await rename(tempPath, path);
}

// Adds one new flat device entry (a discovered candidate the user chose to
// claim -- see server.js's handleAddToPlaylist) to the top-level playlist
// shape, the same shape every hand-typed flat entry
// (`kitchen-lamp.transport = "dirigera"`, ...) already uses -- never the
// nested `[devices.*]` shape, which is specifically for a multi-reading
// BLE-style device and not what a single-address discovered candidate is.
//
// A name collision throws with `error.code = "EEXISTS"` and a
// `suggestedName` (`${name}-2`, incrementing past whatever's already
// taken) rather than silently overwriting or picking a name on the
// caller's behalf -- the caller (an HTTP handler) decides whether to
// retry with the suggestion or ask the user for a different name. This
// also naturally protects the reserved `devices` top-level key (the
// nested-readings section): a device literally named "devices" collides
// with it the same way any other taken name would, with no special-case
// needed.
export function nextAvailableName(playlist, base) {
  if (!Object.hasOwn(playlist, base)) return base;
  let n = 2;
  while (Object.hasOwn(playlist, `${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export async function addPlaylistEntry(path, name, record) {
  let playlist;
  try {
    playlist = await readPlaylist(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    playlist = {};
  }
  if (Object.hasOwn(playlist, name)) {
    throw Object.assign(new Error(`Playlist already has an entry named "${name}"`), {
      code: "EEXISTS",
      suggestedName: nextAvailableName(playlist, name),
    });
  }
  const updated = { ...playlist, [name]: record };
  await writePlaylist(path, updated);
  return updated[name];
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
