import { runGit } from "./run-git.js";

export async function hasUncommittedChanges(dir) {
  const status = await runGit(dir, ["status", "--porcelain"]);
  return status.trim().length > 0;
}
