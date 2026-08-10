#!/usr/bin/env bun
/**
 * backup_restore.ts — restore a JSON snapshot into the knowledge base.
 *
 * **This is a thin shim over `cerefox backup restore`, deliberately** — see the
 * note in `backup_create.ts`. It previously carried its own restore logic via
 * `_shared/backup/`, which never learned to recreate project memberships,
 * relations, `lifecycle_status`, or trash state (#166). Worse than the capture
 * side: a restore is the moment you are already having a bad day, and a second
 * implementation quietly recreating less than the snapshot holds is the wrong
 * thing to discover then.
 *
 * Delegating keeps one restore path, which is also the one that gets exercised
 * by the live suites.
 *
 * Usage (unchanged):
 *   bun scripts/backup_restore.ts <backup.json> [--dry-run]
 *
 * Requires CEREFOX_SUPABASE_URL + CEREFOX_SUPABASE_KEY in your .env.
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { EXIT_OK, EXIT_USER_ERROR, c, errorln, println } from "../_shared/cli-core/index.js";

interface Args {
  backupFile?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: false };
  for (const a of argv) {
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--help" || a === "-h") {
      println("Usage: bun scripts/backup_restore.ts <backup.json> [--dry-run]");
      println("");
      println(c.dim("Delegates to `cerefox backup restore`, which is the single restore"));
      println(c.dim("implementation (memberships, relations, lifecycle_status, trash)."));
      process.exit(EXIT_OK);
    } else if (a.startsWith("-")) {
      errorln(`Unknown arg: ${a}`);
      process.exit(EXIT_USER_ERROR);
    } else {
      out.backupFile = a;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.backupFile) {
  errorln("Missing backup file. Usage: bun scripts/backup_restore.ts <backup.json> [--dry-run]");
  process.exit(EXIT_USER_ERROR);
}

// Run the CLI from source, so a contributor in a clone needs no build step.
const bin = join(import.meta.dir, "..", "packages", "memory", "src", "bin", "cerefox.ts");
const cliArgs = ["backup", "restore", args.backupFile];
if (args.dryRun) cliArgs.push("--dry-run");

const result = spawnSync("bun", [bin, ...cliArgs], { stdio: "inherit" });
process.exit(result.status ?? EXIT_USER_ERROR);
