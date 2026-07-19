import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { syncGitBackups } from "../src/core/offsite.js";

const execFileAsync = promisify(execFile);

async function bareRepoCommitCount(bareDir) {
  try {
    const { stdout } = await execFileAsync("git", ["--git-dir", bareDir, "log", "--oneline"]);
    return stdout.trim().split("\n").filter(Boolean).length;
  } catch {
    return 0; // no commits pushed yet
  }
}

test("syncGitBackups initializes, commits, and pushes new backup files", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "meterkast-offsite-"));
  const backupsDir = join(workDir, "backups");
  const bareDir = join(workDir, "remote.git");
  try {
    await execFileAsync("git", ["init", "--bare", "-q", bareDir]);
    await mkdir(backupsDir, { recursive: true });
    await writeFile(join(backupsDir, "device-playlist-2026-07-18.toml"), 'a.address = "1"\n');

    const committed = await syncGitBackups(backupsDir, bareDir);

    assert.equal(committed, true);
    assert.equal(await bareRepoCommitCount(bareDir), 1);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("syncGitBackups is a no-op when there is nothing new to back up", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "meterkast-offsite-"));
  const backupsDir = join(workDir, "backups");
  const bareDir = join(workDir, "remote.git");
  try {
    await execFileAsync("git", ["init", "--bare", "-q", bareDir]);
    await mkdir(backupsDir, { recursive: true });
    await writeFile(join(backupsDir, "device-playlist-2026-07-18.toml"), 'a.address = "1"\n');

    await syncGitBackups(backupsDir, bareDir);
    const committedAgain = await syncGitBackups(backupsDir, bareDir);

    assert.equal(committedAgain, false);
    assert.equal(await bareRepoCommitCount(bareDir), 1);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("syncGitBackups pushes a second commit when a new backup file appears", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "meterkast-offsite-"));
  const backupsDir = join(workDir, "backups");
  const bareDir = join(workDir, "remote.git");
  try {
    await execFileAsync("git", ["init", "--bare", "-q", bareDir]);
    await mkdir(backupsDir, { recursive: true });
    await writeFile(join(backupsDir, "device-playlist-2026-07-18.toml"), 'a.address = "1"\n');
    await syncGitBackups(backupsDir, bareDir);

    await writeFile(join(backupsDir, "device-playlist-2026-07-19.toml"), 'a.address = "2"\n');
    const committed = await syncGitBackups(backupsDir, bareDir);

    assert.equal(committed, true);
    assert.equal(await bareRepoCommitCount(bareDir), 2);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("syncGitBackups throws a clear error when no remote is configured", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "meterkast-offsite-"));
  try {
    await assert.rejects(
      () => syncGitBackups(join(workDir, "backups"), undefined),
      /No offsite backup remote configured/,
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});
