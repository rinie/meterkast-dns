// Domoticz-style dated, versioned backups of the playlist -- see README.md
// "Safe writes to the playlist". One file per day for the first validated
// change, -2/-3/... for further ones the same day. Never preserves a
// corrupt state, never writes a duplicate generation for an unchanged file.
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "smol-toml";

export function formatBackupDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// version 1 -> device-playlist-2026-07-18.toml (no suffix, the common case)
// version 2 -> device-playlist-2026-07-18-2.toml (a second validated change same day)
export function formatBackupFilename(baseName, date, version = 1) {
  const day = formatBackupDate(date);
  const suffix = version > 1 ? `-${version}` : "";
  return `${baseName}-${day}${suffix}.toml`;
}

// Existing version numbers for a given day, sorted ascending, e.g. [1, 2].
// Empty array if the backup directory doesn't exist yet or nothing matches.
export async function listBackupVersions(backupDir, baseName, date) {
  const day = formatBackupDate(date);
  const pattern = new RegExp(`^${baseName}-${day}(?:-(\\d+))?\\.toml$`);

  let entries;
  try {
    entries = await readdir(backupDir);
  } catch {
    return [];
  }

  const versions = [];
  for (const entry of entries) {
    const match = entry.match(pattern);
    if (match) versions.push(match[1] ? Number(match[1]) : 1);
  }
  return versions.sort((a, b) => a - b);
}

// The content of the highest-versioned backup for a given day, or null if
// no backup exists for that day yet.
export async function readLatestBackup(backupDir, baseName, date) {
  const versions = await listBackupVersions(backupDir, baseName, date);
  if (versions.length === 0) return null;
  const latest = versions[versions.length - 1];
  const filename = formatBackupFilename(baseName, date, latest);
  return readFile(join(backupDir, filename), "utf8");
}

// The "validated" gate: never preserve a corrupt or truncated write as if
// it were a good backup generation.
export function isValidToml(text) {
  try {
    parse(text);
    return true;
  } catch {
    return false;
  }
}

// Snapshots the *current* file content -- the state about to be superseded
// by a write -- into the dated backups/ directory. Skips writing a new
// generation when the content is unchanged since the last backup, or when
// it fails to parse as TOML. Returns the path written, or null if nothing
// was written.
export async function snapshotPlaylist(playlistPath, backupDir, baseName, now = new Date()) {
  let content;
  try {
    content = await readFile(playlistPath, "utf8");
  } catch {
    return null; // nothing to back up yet
  }

  if (!isValidToml(content)) return null;

  const latest = await readLatestBackup(backupDir, baseName, now);
  if (latest === content) return null; // no delta since the last backup

  const versions = await listBackupVersions(backupDir, baseName, now);
  const nextVersion = versions.length === 0 ? 1 : versions[versions.length - 1] + 1;
  const filename = formatBackupFilename(baseName, now, nextVersion);

  await mkdir(backupDir, { recursive: true });
  const destination = join(backupDir, filename);
  await writeFile(destination, content, "utf8");
  return destination;
}
