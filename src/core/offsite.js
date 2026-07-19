// Offsite backup: backups/ becomes its own independent git repo, pushed to
// a private remote you configure yourself. Shells out to the git CLI --
// git is already load-bearing for this project's own workflow, so reusing
// it costs nothing new; auth is whatever git/gh is already configured
// with, this code never handles a credential directly.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";

const execFileAsync = promisify(execFile);

export async function runGit(cwd, args) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}

export async function isGitRepo(dir) {
  try {
    await runGit(dir, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

// Only ever attaches to a remote that already exists -- creating the
// private repo itself is a deliberate one-time manual step, not something
// application code does on its own, especially unattended via cron.
export async function initGitRepo(dir, remoteUrl) {
  await mkdir(dir, { recursive: true });
  await runGit(dir, ["init", "-q"]);
  await runGit(dir, ["remote", "add", "origin", remoteUrl]);
}

export async function hasUncommittedChanges(dir) {
  const status = await runGit(dir, ["status", "--porcelain"]);
  return status.trim().length > 0;
}

export async function commitBackups(dir, message) {
  if (!(await hasUncommittedChanges(dir))) return false;
  await runGit(dir, ["add", "-A"]);
  await runGit(dir, ["commit", "-q", "-m", message]);
  return true;
}

export async function pushBackups(dir) {
  await runGit(dir, ["push", "-q", "origin", "HEAD"]);
}

// Commits any new or changed dated snapshots in `dir` and pushes them to
// `remoteUrl` -- the offsite copy, outside the house. Returns whether
// anything was actually committed and pushed (false is the common case:
// nothing changed since the last sync).
export async function syncGitBackups(dir, remoteUrl) {
  if (!remoteUrl) {
    throw new Error(
      "No offsite backup remote configured. Set METERKAST_BACKUP_REMOTE to a " +
        "private git repo URL (e.g. git@github.com:you/meterkast-dns-backups.git).",
    );
  }

  if (!(await isGitRepo(dir))) {
    await initGitRepo(dir, remoteUrl);
  }

  const committed = await commitBackups(dir, `backup ${new Date().toISOString()}`);
  if (committed) {
    await pushBackups(dir);
  }
  return committed;
}
