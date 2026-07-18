import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePlaylist } from "../src/core/playlist/write-playlist.js";
import { readPlaylist } from "../src/core/playlist/read-playlist.js";
import { backupExistingFile } from "../src/core/playlist/backup-existing-file.js";

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

test("backupExistingFile returns false when there is nothing to back up yet", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meterkast-"));
  const path = join(dir, "device-playlist.toml");
  try {
    assert.equal(await backupExistingFile(path), false);
    await assert.rejects(() => access(`${path}.bak`));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writePlaylist keeps a .bak of the previous version, not the new one", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meterkast-"));
  const path = join(dir, "device-playlist.toml");
  try {
    await writePlaylist(path, { a: { transport: "ble", address: "1" } });
    await writePlaylist(path, { a: { transport: "ble", address: "2" } });

    const current = await readPlaylist(path);
    const backup = await readFile(`${path}.bak`, "utf8");

    assert.equal(current.a.address, "2");
    assert.match(backup, /address = "1"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writePlaylist never leaves a .tmp file behind", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meterkast-"));
  const path = join(dir, "device-playlist.toml");
  try {
    await writePlaylist(path, { a: { transport: "ble", address: "1" } });
    await assert.rejects(() => access(`${path}.tmp`));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
