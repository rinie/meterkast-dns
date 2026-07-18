import { access, copyFile, constants } from "node:fs/promises";

export async function backupExistingFile(path) {
  try {
    await access(path, constants.F_OK);
  } catch {
    return false; // nothing to back up yet
  }
  await copyFile(path, `${path}.bak`);
  return true;
}
