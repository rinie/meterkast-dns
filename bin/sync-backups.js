#!/usr/bin/env node
// Meant to run on a schedule (cron), separate from the always-running
// daemon -- offsite sync is a periodic concern, not a live one. Example:
//   0 3 * * * node --env-file=.env bin/sync-backups.js
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { syncGitBackups } from "../src/core/offsite/sync-git-backups.js";

const backupDir =
  process.env.METERKAST_BACKUP_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), "..", "backups");
const remoteUrl = process.env.METERKAST_BACKUP_REMOTE;

const committed = await syncGitBackups(backupDir, remoteUrl);
console.log(committed ? "Backups synced: new changes pushed." : "Backups synced: nothing new.");
