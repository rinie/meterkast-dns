import { writeFile, rename } from "node:fs/promises";
import { stringify } from "smol-toml";
import { backupExistingFile } from "./backup-existing-file.js";

// Last-known-good, kept deliberately independent of git: the prior version
// survives even a bad hand-edit or a buggy adapter write without needing a
// commit to have happened first. Write-then-rename keeps a crash mid-write
// from ever leaving a truncated playlist on disk.
export async function writePlaylist(path, data) {
  await backupExistingFile(path);
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, stringify(data), "utf8");
  await rename(tempPath, path);
}
