#!/usr/bin/env bun
/**
 * backup_restore.ts — restore documents + chunks from a JSON backup
 * (iter-26 Part 26K). TS port of scripts/backup_restore.py.
 *
 * Idempotent: documents whose content_hash already exists are skipped.
 *
 * Usage:
 *   bun scripts/backup_restore.ts <backup.json> [--dry-run]
 *
 * Requires CEREFOX_SUPABASE_URL + CEREFOX_SUPABASE_KEY in your .env.
 */

import { loadSettings } from "../_shared/config/index.js";
import { createClient } from "../_shared/db-client/index.js";
import { restoreBackup } from "../_shared/backup/index.js";
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
  backupFile?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: false };
  for (const a of argv) {
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--help" || a === "-h") {
      println("Usage: bun scripts/backup_restore.ts <backup.json> [--dry-run]");
      process.exit(EXIT_OK);
    } else if (a.startsWith("-")) {
      errorln(`Unknown arg: ${a}`);
      process.exit(EXIT_USER_ERROR);
    } else if (!out.backupFile) {
      out.backupFile = a;
    } else {
      errorln(`Unexpected argument: ${a}`);
      process.exit(EXIT_USER_ERROR);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.backupFile) {
    errorln("A backup file path is required.");
    errorln("Usage: bun scripts/backup_restore.ts <backup.json> [--dry-run]");
    process.exit(EXIT_USER_ERROR);
  }

  const settings = loadSettings();
  if (!settings.supabaseUrl || !settings.supabaseKey) {
    errorln("❌  CEREFOX_SUPABASE_URL and CEREFOX_SUPABASE_KEY must be set.");
    process.exit(EXIT_SYSTEM_ERROR);
  }

  const client = createClient(settings);
  const db = makeBackupDb(client.raw as never);

  println(c.bold(args.dryRun ? "Restoring (DRY RUN — no writes)…" : "Restoring backup…"));
  const stats = await restoreBackup(db, args.backupFile, { dryRun: args.dryRun });
  println(
    `${args.dryRun ? c.yellow("ℹ") : c.green("✓")}  Restore complete: ` +
      `${stats.restored} restored, ${stats.skipped} skipped, ${stats.errors} errors.`,
  );
  process.exit(stats.errors > 0 ? EXIT_SYSTEM_ERROR : EXIT_OK);
}

main().catch((err) => {
  errorln(err instanceof Error ? err.message : String(err));
  process.exit(EXIT_SYSTEM_ERROR);
});
