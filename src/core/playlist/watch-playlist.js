import { watch } from "node:fs/promises";

export async function watchPlaylist(path, onChange, { signal } = {}) {
  const watcher = watch(path, { signal });
  for await (const event of watcher) {
    onChange(event);
  }
}
