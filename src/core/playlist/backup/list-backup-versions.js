import { readdir } from "node:fs/promises";
import { formatBackupDate } from "./format-backup-date.js";

// Returns the existing version numbers for a given day, sorted ascending,
// e.g. [1, 2] if both device-playlist-2026-07-18.toml and
// device-playlist-2026-07-18-2.toml exist. Empty array if the backup
// directory doesn't exist yet or nothing matches.
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
