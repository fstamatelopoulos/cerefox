#!/usr/bin/env bun
/**
 * backup_create.ts — create a JSON snapshot backup of the knowledge base.
 *
 * **This is a thin shim over `cerefox backup create`, deliberately.** It used to
 * carry its own capture logic via `_shared/backup/`, and that second
 * implementation is exactly how #166 half-healed: the fix that taught backups to
 * capture project memberships (v1.0.7), then relations and `lifecycle_status`
 * (v1.1.0), landed in the CLI command and never reached this path. A contributor
 * running this script — including from the pre-migration safety recipe in
 * `docs/guides/ops-scripts.md` — got a format-1 snapshot with none of them, and
 * nothing said so.
 *
 * Rather than port the fixes across and leave two implementations to diverge
 * again, this delegates. One capture path, one format, one thing to keep right.
 *
 * Usage (unchanged):
 *   bun scripts/backup_create.ts [--label <name>] [--dir <path>] [--git-commit]
 *
 * Requires CEREFOX_SUPABASE_URL + CEREFOX_SUPABASE_KEY in your .env.
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { EXIT_OK, EXIT_USER_ERROR, errorln, println, c } from "../_shared/cli-core/index.js";

interface Args {
  label?: string;
  dir?: string;
  gitCommit: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { gitCommit: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--label" || a === "-l") out.label = argv[++i];
    else if (a === "--dir") out.dir = argv[++i];
    else if (a === "--git-commit") out.gitCommit = true;
    else if (a === "--help" || a === "-h") {
      println("Usage: bun scripts/backup_create.ts [--label <name>] [--dir <path>] [--git-commit]");
      println("");
      println(c.dim("Delegates to `cerefox backup create`, which is the single capture"));
      println(c.dim("implementation (project memberships, relations, lifecycle_status, trash)."));
      process.exit(EXIT_OK);
    } else {
      errorln(`Unknown argument: ${a}`);
      process.exit(EXIT_USER_ERROR);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

// Run the CLI from source, so a contributor in a clone needs no build step.
const bin = join(import.meta.dir, "..", "packages", "memory", "src", "bin", "cerefox.ts");
const cliArgs = ["backup", "create"];
if (args.label) cliArgs.push("--label", args.label);
if (args.dir) cliArgs.push("--output-dir", args.dir);
if (args.gitCommit) cliArgs.push("--git");

const result = spawnSync("bun", [bin, ...cliArgs], { stdio: "inherit" });
process.exit(result.status ?? EXIT_USER_ERROR);
