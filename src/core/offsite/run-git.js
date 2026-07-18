import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function runGit(cwd, args) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}
