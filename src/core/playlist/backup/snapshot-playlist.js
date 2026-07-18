import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatBackupFilename } from "./format-backup-filename.js";
import { listBackupVersions } from "./list-backup-versions.js";
import { readLatestBackup } from "./read-latest-backup.js";
import { isValidToml } from "./is-valid-toml.js";

// Snapshots the *current* file content -- the state about to be superseded
// by a write -- into a dated backups/ directory, Domoticz-style: one file
// per day, a version suffix only when a second validated change lands the
// same day. Skips writing a new generation when the content is unchanged
// since the last backup, or when it fails to parse as TOML (never preserve
// a corrupt state as if it were good). Returns the path written, or null if
// nothing was written.
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
