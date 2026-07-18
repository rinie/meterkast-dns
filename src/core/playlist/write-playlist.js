import { writeFile, rename } from "node:fs/promises";
import { dirname, join, basename, extname } from "node:path";
import { stringify } from "smol-toml";
import { snapshotPlaylist } from "./backup/snapshot-playlist.js";

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
