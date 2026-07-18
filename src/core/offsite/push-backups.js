import { runGit } from "./run-git.js";

export async function pushBackups(dir) {
  await runGit(dir, ["push", "-q", "origin", "HEAD"]);
}
