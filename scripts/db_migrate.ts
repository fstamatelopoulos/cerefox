#!/usr/bin/env bun
/**
 * Apply pending database migrations to an existing Cerefox instance.
 *
 * Migration files live in src/cerefox/db/migrations/ and are named
 * with a numeric prefix (e.g. 0003_add_versions.sql). Applied in
 * filename order. Each file is applied exactly once; applied
 * filenames are recorded in `cerefox_migrations` so they're never
 * re-applied.
 *
 * Usage:
 *   bun scripts/db_migrate.ts              # apply all pending migrations
 *   bun scripts/db_migrate.ts --dry-run    # show what would run
 *   bun scripts/db_migrate.ts --status     # list status, exit
 *
 * TS port of `scripts/db_migrate.py` (iter-25 Part 25H).
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

import { loadEnv } from "../_shared/config/index.js";
import {
  EXIT_OK,
  EXIT_USER_ERROR,
  EXIT_SYSTEM_ERROR,
  c,
  println,
  errorln,
} from "../_shared/cli-core/index.js";

loadEnv();

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(
  HERE,
  "..",
  "src",
  "cerefox",
  "db",
  "migrations",
);

const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS cerefox_migrations (
    id         SERIAL      PRIMARY KEY,
    filename   TEXT        NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

interface Args {
  dryRun: boolean;
  status: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: false, status: false };
  for (const a of argv) {
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--status") out.status = true;
    else if (a === "--help" || a === "-h") {
      println("Usage: bun scripts/db_migrate.ts [--dry-run | --status]");
      process.exit(EXIT_OK);
    } else {
      errorln(`Unknown arg: ${a}`);
      process.exit(EXIT_USER_ERROR);
    }
  }
  return out;
}

function listMigrationFiles(): string[] {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR)
    .filter((n) => n.endsWith(".sql"))
    .sort();
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

  println(c.bold("╔══════════════════════════════════════╗"));
  println(c.bold("║  Cerefox DB Migrate                  ║"));
  println(c.bold("╚══════════════════════════════════════╝"));

  const sql = postgres(dbUrl, { prepare: false, onnotice: () => {} });

  // Bootstrap: ensure tracking table exists.
  await sql.unsafe(BOOTSTRAP_SQL);

  const allFiles = listMigrationFiles();
  const appliedRows = await sql<
    { filename: string }[]
  >`SELECT filename FROM cerefox_migrations ORDER BY filename`;
  const applied = new Set(appliedRows.map((r) => r.filename));

  if (args.status) {
    if (allFiles.length === 0) {
      println("No migration files found.");
      await sql.end({ timeout: 5 });
      return;
    }
    println(`\n${"Filename".padEnd(50)}  Status`);
    println("─".repeat(60));
    for (const f of allFiles) {
      const status = applied.has(f) ? c.green("✓  applied") : c.yellow("○  pending");
      println(`  ${f.padEnd(50)}  ${status}`);
    }
    const pendingCount = allFiles.filter((f) => !applied.has(f)).length;
    println(
      `\n${allFiles.length} total  |  ${allFiles.length - pendingCount} applied  |  ${pendingCount} pending`,
    );
    await sql.end({ timeout: 5 });
    return;
  }

  const pending = allFiles.filter((f) => !applied.has(f));
  if (pending.length === 0) {
    println(c.green("\n✓  No pending migrations — database is up to date."));
    await sql.end({ timeout: 5 });
    return;
  }

  println(`\n${pending.length} pending migration(s):`);
  for (const f of pending) println(`  • ${f}`);

  if (args.dryRun) {
    println(c.yellow("\n⚠️  Dry-run mode — no changes will be made."));
    for (const f of pending) {
      const body = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
      println(`\n── ${f} ──`);
      println(c.dim(body.slice(0, 600) + (body.length > 600 ? "..." : "")));
    }
    await sql.end({ timeout: 5 });
    return;
  }

  println("");
  let appliedCount = 0;
  for (const f of pending) {
    const body = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    println(c.bold(`▶  Applying ${f}…`));
    try {
      // Each migration runs in its own implicit transaction via
      // `sql.begin`. Insert the tracking row in the SAME transaction so
      // an error rolls both back.
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO cerefox_migrations (filename) VALUES (${f}) ON CONFLICT DO NOTHING`;
      });
      println(c.green("   ✓  Done"));
      appliedCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errorln(`\n❌  ${f} failed: ${msg}`);
      errorln("\nMigration stopped. Previous migrations in this run were committed.");
      errorln("Fix the error in the migration file and re-run db_migrate.ts.");
      await sql.end({ timeout: 5 });
      process.exit(EXIT_SYSTEM_ERROR);
    }
  }
  println(c.green(`\n✓  Applied ${appliedCount} migration(s) successfully.`));
  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  errorln(err instanceof Error ? err.message : String(err));
  process.exit(EXIT_SYSTEM_ERROR);
});
