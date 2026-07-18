import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { listBackupVersions } from "./list-backup-versions.js";
import { formatBackupFilename } from "./format-backup-filename.js";

// The content of the highest-versioned backup for a given day, or null if
// no backup exists for that day yet.
export async function readLatestBackup(backupDir, baseName, date) {
  const versions = await listBackupVersions(backupDir, baseName, date);
  if (versions.length === 0) return null;
  const latest = versions[versions.length - 1];
  const filename = formatBackupFilename(baseName, date, latest);
  return readFile(join(backupDir, filename), "utf8");
}
