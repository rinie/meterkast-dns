import { readFile } from "node:fs/promises";
import { parse } from "smol-toml";

export async function readPlaylist(path) {
  const text = await readFile(path, "utf8");
  return parse(text);
}
