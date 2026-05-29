#!/usr/bin/env bun
/**
 * Apply pending database migrations to an existing Cerefox instance.
 *
 * Migration files live in src/cerefox/db/migrations/ and are named with a
 * numeric prefix (e.g. 0003_add_versions.sql). Applied in filename order;
 * each exactly once, recorded in `cerefox_migrations`.
 *
 * Usage:
 *   bun scripts/db_migrate.ts              # apply all pending migrations
 *   bun scripts/db_migrate.ts --dry-run    # show what would run
 *   bun scripts/db_migrate.ts --status     # list status, exit
 *   bun scripts/db_migrate.ts --assets-dir <path>
 *
 * Low-level contributor script. End users get the same effect (and more)
 * from `cerefox deploy-server`, which runs pending migrations on existing
 * databases. The migrate logic lives in `_shared/db-deploy/`
 * (`runDbMigrate` / `migrationStatus`); this script is a thin wrapper.
 */

import { loadEnv } from "../_shared/config/index.js";
import { resolveServerAssets } from "../_shared/server-assets/index.js";
import { migrationStatus, runDbMigrate } from "../_shared/db-deploy/index.js";
import {
  EXIT_OK,
  EXIT_USER_ERROR,
  EXIT_SYSTEM_ERROR,
  c,
  println,
  errorln,
} from "../_shared/cli-core/index.js";

loadEnv();

interface Args {
  dryRun: boolean;
  status: boolean;
  assetsDir?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: false, status: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--status") out.status = true;
    else if (a === "--assets-dir") {
      const v = argv[++i];
      if (!v) {
        errorln("--assets-dir requires a path argument");
        process.exit(EXIT_USER_ERROR);
      }
      out.assetsDir = v;
    } else if (a === "--help" || a === "-h") {
      println("Usage: bun scripts/db_migrate.ts [--dry-run | --status] [--assets-dir <path>]");
      process.exit(EXIT_OK);
    } else {
      errorln(`Unknown arg: ${a}`);
      process.exit(EXIT_USER_ERROR);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dbUrl = process.env.CEREFOX_DATABASE_URL ?? "";
  if (!dbUrl) {
    errorln("❌  CEREFOX_DATABASE_URL is not set.");
    errorln("");
    errorln("Set it in your .env file. See docs/guides/setup-supabase.md.");
    process.exit(EXIT_USER_ERROR);
  }

  const assets = resolveServerAssets({ assetsDir: args.assetsDir });

  println(c.bold("╔══════════════════════════════════════╗"));
  println(c.bold("║  Cerefox DB Migrate                  ║"));
  println(c.bold("╚══════════════════════════════════════╝"));

  if (args.status) {
    const status = await migrationStatus({ dbUrl, assets });
    if (status.all.length === 0) {
      println("No migration files found.");
      process.exit(EXIT_OK);
    }
    println(`\n${"Filename".padEnd(50)}  Status`);
    println("─".repeat(60));
    const appliedSet = new Set(status.applied);
    for (const f of status.all) {
      const label = appliedSet.has(f) ? c.green("✓  applied") : c.yellow("○  pending");
      println(`  ${f.padEnd(50)}  ${label}`);
    }
    println(
      `\n${status.all.length} total  |  ${status.applied.length} applied  |  ${status.pending.length} pending`,
    );
    process.exit(EXIT_OK);
  }

  const result = await runDbMigrate({
    dbUrl,
    assets,
    dryRun: args.dryRun,
    log: (line) => println(c.bold(`▶  ${line}`)),
  });

  if (!result.ok) {
    errorln(`\n❌  ${result.failedFile} failed: ${result.error}`);
    errorln("\nMigration stopped. Previous migrations in this run were committed.");
    errorln("Fix the error in the migration file and re-run.");
    process.exit(EXIT_SYSTEM_ERROR);
  }

  if (result.pending.length === 0) {
    println(c.green("\n✓  No pending migrations — database is up to date."));
  } else if (args.dryRun) {
    println(c.yellow(`\n⚠️  Dry-run — ${result.pending.length} migration(s) would be applied.`));
  } else {
    println(c.green(`\n✓  Applied ${result.applied.length} migration(s) successfully.`));
  }
}

main().catch((err) => {
  errorln(err instanceof Error ? err.message : String(err));
  process.exit(EXIT_SYSTEM_ERROR);
});
