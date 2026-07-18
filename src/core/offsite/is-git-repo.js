import { runGit } from "./run-git.js";

export async function isGitRepo(dir) {
  try {
    await runGit(dir, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}
