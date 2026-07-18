import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePlaylist } from "../src/core/playlist/write-playlist.js";
import { readPlaylist } from "../src/core/playlist/read-playlist.js";

test("write then read round-trips a playlist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meterkast-"));
  const path = join(dir, "device-playlist.toml");
  try {
    await writePlaylist(path, {
      "kitchen-light": { transport: "zigbee", address: "0x00124b0018f3a1c2" },
    });
    const data = await readPlaylist(path);
    assert.equal(data["kitchen-light"].transport, "zigbee");
    assert.equal(data["kitchen-light"].address, "0x00124b0018f3a1c2");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
