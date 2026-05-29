#!/usr/bin/env bun
/**
 * backup_create.ts — create a JSON snapshot backup of the knowledge base
 * (iter-26 Part 26K). TS port of scripts/backup_create.py.
 *
 * Usage:
 *   bun scripts/backup_create.ts [--label <name>] [--dir <path>] [--git-commit]
 *
 * Requires CEREFOX_SUPABASE_URL + CEREFOX_SUPABASE_KEY in your .env.
 */

import { spawnSync } from "node:child_process";
import { dirname } from "node:path";

import { loadSettings } from "../_shared/config/index.js";
import { createClient } from "../_shared/db-client/index.js";
import { createBackup } from "../_shared/backup/index.js";
import { makeBackupDb } from "../_shared/backup/supabase-adapter.js";
import {
  EXIT_OK,
  EXIT_USER_ERROR,
  EXIT_SYSTEM_ERROR,
  c,
  println,
  errorln,
} from "../_shared/cli-core/index.js";

interface Args {
  label?: string;
  dir: string;
  gitCommit: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { dir: "./backups", gitCommit: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--label" || a === "-l") out.label = argv[++i];
    else if (a === "--dir") out.dir = argv[++i] ?? out.dir;
    else if (a === "--git-commit") out.gitCommit = true;
    else if (a === "--help" || a === "-h") {
      println("Usage: bun scripts/backup_create.ts [--label <name>] [--dir <path>] [--git-commit]");
      process.exit(EXIT_OK);
    } else {
      errorln(`Unknown arg: ${a}`);
      process.exit(EXIT_USER_ERROR);
    }
  }
  return out;
}

function gitCommitBackup(path: string, label?: string): void {
  const repoDir = dirname(path);
  const msg = `backup: ${path.split("/").pop()}${label ? ` (${label})` : ""}`;
  const add = spawnSync("git", ["add", path], { cwd: repoDir, encoding: "utf8" });
  if (add.status !== 0) {
    println(c.dim("  (git add skipped — not a git repo or git unavailable)"));
    return;
  }
  const commit = spawnSync("git", ["commit", "-m", msg], { cwd: repoDir, encoding: "utf8" });
  if (commit.status === 0) println(c.dim(`  committed to git: ${msg}`));
  else println(c.dim("  (git commit skipped)"));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const settings = loadSettings();
  if (!settings.supabaseUrl || !settings.supabaseKey) {
    errorln("❌  CEREFOX_SUPABASE_URL and CEREFOX_SUPABASE_KEY must be set.");
    process.exit(EXIT_SYSTEM_ERROR);
  }

  const client = createClient(settings);
  const db = makeBackupDb(client.raw as never);

  println(c.bold("Creating Cerefox backup…"));
  const info = await createBackup(db, args.dir, { label: args.label });
  println(
    c.green(
      `✓  ${info.path} (${info.documentCount} docs, ${info.chunkCount} chunks, ${info.sizeBytes} bytes)`,
    ),
  );
  if (args.gitCommit) gitCommitBackup(info.path, args.label);
}

main().catch((err) => {
  errorln(err instanceof Error ? err.message : String(err));
  process.exit(EXIT_SYSTEM_ERROR);
});
