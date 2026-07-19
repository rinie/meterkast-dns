import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePlaylist, readPlaylist } from "../src/core/playlist.js";
import { formatBackupDate } from "../src/core/playlist-backup.js";

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

test("writePlaylist creates no backup on the very first write", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meterkast-"));
  const path = join(dir, "device-playlist.toml");
  try {
    await writePlaylist(path, { a: { transport: "ble", address: "1" } });
    await assert.rejects(() => access(join(dir, "backups")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writePlaylist backs up each distinct prior state, versioning repeat changes the same day", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meterkast-"));
  const path = join(dir, "device-playlist.toml");
  const backupDir = join(dir, "backups");
  try {
    await writePlaylist(path, { a: { transport: "ble", address: "1" } });
    await writePlaylist(path, { a: { transport: "ble", address: "2" } });
    await writePlaylist(path, { a: { transport: "ble", address: "3" } });

    const today = formatBackupDate(new Date());
    const first = await readFile(join(backupDir, `device-playlist-${today}.toml`), "utf8");
    const second = await readFile(join(backupDir, `device-playlist-${today}-2.toml`), "utf8");

    assert.match(first, /address = "1"/);
    assert.match(second, /address = "2"/);
    await assert.rejects(() => access(join(backupDir, `device-playlist-${today}-3.toml`)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writePlaylist does not create a duplicate backup when content hasn't changed since the last one", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meterkast-"));
  const path = join(dir, "device-playlist.toml");
  const backupDir = join(dir, "backups");
  try {
    await writePlaylist(path, { a: { transport: "ble", address: "1" } });
    await writePlaylist(path, { a: { transport: "ble", address: "1" } });
    await writePlaylist(path, { a: { transport: "ble", address: "1" } });

    const entries = await readdir(backupDir);
    assert.equal(entries.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
