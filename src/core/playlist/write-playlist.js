import { writeFile } from "node:fs/promises";
import { stringify } from "smol-toml";

export async function writePlaylist(path, data) {
  await writeFile(path, stringify(data), "utf8");
}
