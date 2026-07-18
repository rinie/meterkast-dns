import { runGit } from "./run-git.js";
import { hasUncommittedChanges } from "./has-uncommitted-changes.js";

export async function commitBackups(dir, message) {
  if (!(await hasUncommittedChanges(dir))) return false;
  await runGit(dir, ["add", "-A"]);
  await runGit(dir, ["commit", "-q", "-m", message]);
  return true;
}
