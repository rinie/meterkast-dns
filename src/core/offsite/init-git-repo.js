import { mkdir } from "node:fs/promises";
import { runGit } from "./run-git.js";

// Only ever attaches to a remote that already exists -- creating the
// private repo itself is a deliberate one-time manual step, not something
// application code does on its own, especially unattended via cron.
export async function initGitRepo(dir, remoteUrl) {
  await mkdir(dir, { recursive: true });
  await runGit(dir, ["init", "-q"]);
  await runGit(dir, ["remote", "add", "origin", remoteUrl]);
}
