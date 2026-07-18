import { formatBackupDate } from "./format-backup-date.js";

// version 1 -> device-playlist-2026-07-18.toml (no suffix, the common case)
// version 2 -> device-playlist-2026-07-18-2.toml (a second validated change same day)
export function formatBackupFilename(baseName, date, version = 1) {
  const day = formatBackupDate(date);
  const suffix = version > 1 ? `-${version}` : "";
  return `${baseName}-${day}${suffix}.toml`;
}
