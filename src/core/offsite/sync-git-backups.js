import { isGitRepo } from "./is-git-repo.js";
import { initGitRepo } from "./init-git-repo.js";
import { commitBackups } from "./commit-backups.js";
import { pushBackups } from "./push-backups.js";

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
