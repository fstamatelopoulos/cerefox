#!/usr/bin/env bun
/**
 * Deploy Cerefox schema to a fresh Supabase / Postgres instance.
 *
 * Usage:
 *   bun scripts/db_deploy.ts
 *   bun scripts/db_deploy.ts --dry-run
 *   bun scripts/db_deploy.ts --reset      # ⚠️  drops all cerefox tables first
 *
 * Requires CEREFOX_DATABASE_URL in your .env file. See
 * docs/guides/setup-supabase.md for where to find this value.
 *
 * TS port of `scripts/db_deploy.py` (iter-25 Part 25H). The Python
 * original is now a husk pointing at this script.
 *
 * Postgres client: `postgres` (Porsager) — small, well-typed, no
 * native deps, works on Node + Bun. Picked over `pg` (heavier, native
 * deps) and `bun:sql` (Bun-only, locks the script runtime).
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import postgres from "postgres";

import { loadEnv } from "../_shared/config/index.js";
import { resolveServerAssets } from "../_shared/server-assets/index.js";
import {
  EXIT_OK,
  EXIT_USER_ERROR,
  EXIT_SYSTEM_ERROR,
  c,
  println,
  errorln,
} from "../_shared/cli-core/index.js";

loadEnv();

// Tables to drop in --reset mode (order matters for FK constraints).
const RESET_SQL = `
DROP TABLE IF EXISTS cerefox_chunks      CASCADE;
DROP TABLE IF EXISTS cerefox_documents   CASCADE;
DROP TABLE IF EXISTS cerefox_projects    CASCADE;
DROP TABLE IF EXISTS cerefox_migrations  CASCADE;
DROP FUNCTION IF EXISTS cerefox_set_updated_at CASCADE;
DROP FUNCTION IF EXISTS cerefox_hybrid_search   CASCADE;
DROP FUNCTION IF EXISTS cerefox_fts_search      CASCADE;
DROP FUNCTION IF EXISTS cerefox_semantic_search CASCADE;
DROP FUNCTION IF EXISTS cerefox_reconstruct_doc CASCADE;
`;

const EXTENSIONS_SQL = `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
`;

interface Args {
  dryRun: boolean;
  reset: boolean;
  assetsDir?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: false, reset: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--reset") out.reset = true;
    else if (a === "--assets-dir") {
      const v = argv[++i];
      if (!v) {
        errorln("--assets-dir requires a path argument");
        process.exit(EXIT_USER_ERROR);
      }
      out.assetsDir = v;
    } else if (a === "--help" || a === "-h") {
      println("Usage: bun scripts/db_deploy.ts [--dry-run] [--reset] [--assets-dir <path>]");
      println("");
      println("  --dry-run        Print the planned steps without executing.");
      println("  --reset          DROP all Cerefox tables first (DESTRUCTIVE).");
      println("  --assets-dir     Override the server-assets root (bundled layout:");
      println("                   <dir>/db/schema.sql etc). Defaults to auto-resolution");
      println("                   (repo src/cerefox/db/ or the bundled dist/server-assets/).");
      process.exit(EXIT_OK);
    } else {
      errorln(`Unknown arg: ${a}`);
      process.exit(EXIT_USER_ERROR);
    }
  }
  return out;
}

async function confirmReset(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    "\n⚠️  --reset will DROP all Cerefox tables. All data will be lost. " +
      "Type 'yes' to continue: ",
  );
  rl.close();
  return answer.trim().toLowerCase() === "yes";
}

function listMigrationFiles(migrationsDir: string): string[] {
  if (!existsSync(migrationsDir)) return [];
  return readdirSync(migrationsDir)
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

  const assets = resolveServerAssets({ assetsDir: args.assetsDir });
  if (!existsSync(assets.schemaFile) || !existsSync(assets.rpcsFile)) {
    errorln(`❌  Schema files missing (looked for ${assets.schemaFile}).`);
    errorln("   Run from a repo checkout that includes src/cerefox/db/,");
    errorln("   or pass --assets-dir pointing at a bundled server-assets root.");
    process.exit(EXIT_SYSTEM_ERROR);
  }

  const schemaSql = readFileSync(assets.schemaFile, "utf8");
  const rpcsSql = readFileSync(assets.rpcsFile, "utf8");
  const migrationFiles = listMigrationFiles(assets.migrationsDir);

  println(c.bold("╔══════════════════════════════════════╗"));
  println(c.bold("║  Cerefox DB Deploy                   ║"));
  println(c.bold("╚══════════════════════════════════════╝"));

  if (args.dryRun) {
    println(c.yellow("\n⚠️  DRY-RUN mode — no changes will be made.\n"));
  }

  if (args.reset && !args.dryRun) {
    const ok = await confirmReset();
    if (!ok) {
      println("Aborted.");
      process.exit(EXIT_OK);
    }
  }

  // postgres lib auto-detects SSL from the URL; Supabase URLs include
  // `?sslmode=require` or similar. `prepare: false` because Supabase
  // connection pooler doesn't support prepared statements at txn level.
  const sql = postgres(dbUrl, {
    prepare: false,
    onnotice: () => {},
  });

  const steps: Array<{ sql: string; label: string }> = [];
  if (args.reset) {
    steps.push({ sql: RESET_SQL, label: "Reset: drop existing Cerefox objects" });
  }
  steps.push(
    { sql: EXTENSIONS_SQL, label: "Enable extensions (uuid-ossp, vector/pgvector)" },
    { sql: schemaSql, label: "Apply schema (tables, indexes, triggers)" },
    { sql: rpcsSql, label: "Apply RPCs (search functions)" },
  );

  // Stamp the migration files as already applied so db_migrate.ts
  // doesn't re-run changes already incorporated in schema.sql/rpcs.sql.
  if (migrationFiles.length > 0) {
    const values = migrationFiles.map((n) => `('${n.replace(/'/g, "''")}')`).join(", ");
    steps.push({
      sql: `INSERT INTO cerefox_migrations (filename) VALUES ${values} ON CONFLICT (filename) DO NOTHING;`,
      label: "Stamp migration files as already applied",
    });
  }

  println("\nConnecting to database...");
  let successCount = 0;
  for (const step of steps) {
    println(c.bold(`\n▶  ${step.label}…`));
    if (args.dryRun) {
      const preview = step.sql.slice(0, 500) + (step.sql.length > 500 ? "..." : "");
      println(c.dim(`   ── (dry-run, not executed) ──`));
      println(c.dim(preview));
      successCount++;
      continue;
    }
    try {
      // `sql.unsafe()` accepts a multi-statement SQL string. Required
      // because schema.sql + rpcs.sql contain many statements per file.
      await sql.unsafe(step.sql);
      println(c.green("   ✓  Done"));
      successCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errorln(`\n❌  ${step.label} failed: ${msg}`);
      errorln(`\nDeployment stopped at: ${step.label}`);
      await sql.end({ timeout: 5 });
      process.exit(EXIT_SYSTEM_ERROR);
    }
  }

  await sql.end({ timeout: 5 });

  println("\n" + "─".repeat(42));
  if (args.dryRun) {
    println(c.green(`✓  Dry-run complete. ${successCount} steps would have run.`));
  } else {
    println(c.green(`✓  Deployment complete. ${successCount} steps applied.`));
    println("\nNext step: verify the schema with:");
    println("    bun scripts/db_status.ts");
  }
}

main().catch((err) => {
  errorln(err instanceof Error ? err.message : String(err));
  process.exit(EXIT_SYSTEM_ERROR);
});
