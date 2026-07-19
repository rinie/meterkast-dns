import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatBackupDate,
  formatBackupFilename,
  listBackupVersions,
  isValidToml,
  snapshotPlaylist,
} from "../src/core/playlist-backup.js";

test("formatBackupDate pads month and day to two digits", () => {
  assert.equal(formatBackupDate(new Date(2026, 0, 5)), "2026-01-05");
});

test("formatBackupFilename omits the suffix for version 1", () => {
  const date = new Date(2026, 6, 18);
  assert.equal(
    formatBackupFilename("device-playlist", date, 1),
    "device-playlist-2026-07-18.toml",
  );
});

test("formatBackupFilename adds a -N suffix for version 2+", () => {
  const date = new Date(2026, 6, 18);
  assert.equal(
    formatBackupFilename("device-playlist", date, 2),
    "device-playlist-2026-07-18-2.toml",
  );
  assert.equal(
    formatBackupFilename("device-playlist", date, 3),
    "device-playlist-2026-07-18-3.toml",
  );
});

test("listBackupVersions returns an empty array when the directory doesn't exist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meterkast-"));
  await rm(dir, { recursive: true, force: true });
  assert.deepEqual(await listBackupVersions(dir, "device-playlist", new Date()), []);
});

test("listBackupVersions finds and sorts existing versions for the day", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meterkast-"));
  const date = new Date(2026, 6, 18);
  try {
    await writeFile(join(dir, "device-playlist-2026-07-18.toml"), "");
    await writeFile(join(dir, "device-playlist-2026-07-18-3.toml"), "");
    await writeFile(join(dir, "device-playlist-2026-07-18-2.toml"), "");
    await writeFile(join(dir, "device-playlist-2026-07-19.toml"), ""); // different day, ignored
    assert.deepEqual(await listBackupVersions(dir, "device-playlist", date), [1, 2, 3]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("isValidToml distinguishes valid TOML from garbage", () => {
  assert.equal(isValidToml('a.b = "c"'), true);
  assert.equal(isValidToml("not valid toml {{{"), false);
});

test("snapshotPlaylist returns null when there is nothing to back up yet", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meterkast-"));
  try {
    const result = await snapshotPlaylist(
      join(dir, "device-playlist.toml"),
      join(dir, "backups"),
      "device-playlist",
    );
    assert.equal(result, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("snapshotPlaylist skips corrupt content instead of preserving it as a backup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meterkast-"));
  const path = join(dir, "device-playlist.toml");
  try {
    await writeFile(path, "not valid toml {{{");
    const result = await snapshotPlaylist(path, join(dir, "backups"), "device-playlist");
    assert.equal(result, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("snapshotPlaylist writes a dated backup of valid, new content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meterkast-"));
  const path = join(dir, "device-playlist.toml");
  const backupDir = join(dir, "backups");
  try {
    await writeFile(path, 'a.transport = "ble"\n');
    const result = await snapshotPlaylist(path, backupDir, "device-playlist");
    assert.notEqual(result, null);
    const content = await readFile(result, "utf8");
    assert.match(content, /transport = "ble"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
