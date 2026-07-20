import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { writePlaylist, readPlaylist, addPlaylistEntry, nextAvailableName } from "../src/core/playlist.js";
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

// bin/meterkastd.js's default playlistPath is a file:// URL, not a
// string (relative to import.meta.url, same as loadDisplayFields's own
// directory argument) -- readFile alone tolerates that, but
// writePlaylist also uses node:path's dirname/basename/extname, which
// don't. Never exercised before addPlaylistEntry existed, since
// meterkastd.js only ever read the playlist until now.
test("writePlaylist and readPlaylist both accept a file:// URL, not just a string path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meterkast-"));
  const path = join(dir, "device-playlist.toml");
  const url = pathToFileURL(path);
  try {
    await writePlaylist(url, { a: { transport: "ble", address: "1" } });
    const data = await readPlaylist(url);
    assert.equal(data.a.address, "1");
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

test("nextAvailableName returns the base name when it's free, else increments past whatever's taken", () => {
  assert.equal(nextAvailableName({}, "shed-sensor"), "shed-sensor");
  assert.equal(nextAvailableName({ "shed-sensor": {} }, "shed-sensor"), "shed-sensor-2");
  assert.equal(nextAvailableName({ "shed-sensor": {}, "shed-sensor-2": {} }, "shed-sensor"), "shed-sensor-3");
});

test("addPlaylistEntry writes a new entry into an existing playlist, backup created same as any other write", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meterkast-"));
  const path = join(dir, "device-playlist.toml");
  try {
    await writePlaylist(path, { "kitchen-lamp": { transport: "dirigera", address: "dev-1" } });

    const added = await addPlaylistEntry(path, "shed-sensor", { transport: "dirigera", address: "dev-2", deviceType: "motionSensor" });
    assert.deepEqual(added, { transport: "dirigera", address: "dev-2", deviceType: "motionSensor" });

    const playlist = await readPlaylist(path);
    assert.deepEqual(playlist["kitchen-lamp"], { transport: "dirigera", address: "dev-1" });
    assert.deepEqual(playlist["shed-sensor"], { transport: "dirigera", address: "dev-2", deviceType: "motionSensor" });
    await access(join(dir, "backups")); // a second write onto an existing file backs up the prior state
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("addPlaylistEntry starts a fresh playlist when the file doesn't exist yet", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meterkast-"));
  const path = join(dir, "device-playlist.toml");
  try {
    await addPlaylistEntry(path, "shed-sensor", { transport: "dirigera", address: "dev-2" });
    const playlist = await readPlaylist(path);
    assert.deepEqual(playlist["shed-sensor"], { transport: "dirigera", address: "dev-2" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("addPlaylistEntry rejects a name collision with error.code EEXISTS and a suggestedName, leaves the playlist untouched", async () => {
  const dir = await mkdtemp(join(tmpdir(), "meterkast-"));
  const path = join(dir, "device-playlist.toml");
  try {
    await writePlaylist(path, { "shed-sensor": { transport: "dirigera", address: "dev-1" } });

    await assert.rejects(
      () => addPlaylistEntry(path, "shed-sensor", { transport: "dirigera", address: "dev-2" }),
      (error) => {
        assert.equal(error.code, "EEXISTS");
        assert.equal(error.suggestedName, "shed-sensor-2");
        return true;
      },
    );

    const playlist = await readPlaylist(path);
    assert.deepEqual(playlist["shed-sensor"], { transport: "dirigera", address: "dev-1" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
