/**
 * Reusable Cerefox schema-deploy core (iter-26 Part 26D).
 *
 * Extracted from `scripts/db_deploy.ts` so both the script and the
 * `cerefox deploy-server` CLI command run the exact same deploy logic
 * in-process — no shelling out, one error path. The script stays a thin
 * arg-parsing + confirm wrapper; deploy-server calls `runDbDeploy()`
 * directly with the bundled assets dir.
 *
 * Postgres client: `postgres` (Porsager) — cross-runtime (Node + Bun),
 * no native deps. Node/Bun only (uses node:fs); not a Deno surface.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

import type { ServerAssetPaths } from "../server-assets/index.js";

/** Tables/functions dropped in --reset mode (order matters for FKs). */
export const RESET_SQL = `
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

export const EXTENSIONS_SQL = `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
`;

export function listMigrationFiles(migrationsDir: string): string[] {
  if (!existsSync(migrationsDir)) return [];
  return readdirSync(migrationsDir)
    .filter((n) => n.endsWith(".sql"))
    .sort();
}

export interface DbDeployStep {
  label: string;
  sql: string;
}

/** Build the ordered list of SQL steps for a deploy (no I/O beyond reads). */
export function buildDeploySteps(
  assets: ServerAssetPaths,
  opts: { reset?: boolean } = {},
): DbDeployStep[] {
  const schemaSql = readFileSync(assets.schemaFile, "utf8");
  const rpcsSql = readFileSync(assets.rpcsFile, "utf8");
  const steps: DbDeployStep[] = [];
  if (opts.reset) {
    steps.push({ label: "Reset: drop existing Cerefox objects", sql: RESET_SQL });
  }
  steps.push(
    { label: "Enable extensions (uuid-ossp, vector/pgvector)", sql: EXTENSIONS_SQL },
    { label: "Apply schema (tables, indexes, triggers)", sql: schemaSql },
    { label: "Apply RPCs (search functions)", sql: rpcsSql },
  );
  const migrationFiles = listMigrationFiles(assets.migrationsDir);
  if (migrationFiles.length > 0) {
    const values = migrationFiles
      .map((n) => `('${n.replace(/'/g, "''")}')`)
      .join(", ");
    steps.push({
      label: "Stamp migration files as already applied",
      sql: `INSERT INTO cerefox_migrations (filename) VALUES ${values} ON CONFLICT (filename) DO NOTHING;`,
    });
  }
  return steps;
}

export interface DbDeployOptions {
  dbUrl: string;
  assets: ServerAssetPaths;
  dryRun?: boolean;
  reset?: boolean;
  /** Line sink for progress output. Defaults to no-op. */
  log?: (line: string) => void;
}

export interface DbDeployResult {
  ok: boolean;
  stepsRun: number;
  /** Set when a step failed. */
  failedStep?: string;
  error?: string;
}

/**
 * Run (or dry-run) the schema deploy. Returns a structured result; never
 * calls process.exit — the caller decides exit codes + prompts. Assumes
 * the assets paths exist (caller validates).
 */
export async function runDbDeploy(opts: DbDeployOptions): Promise<DbDeployResult> {
  const log = opts.log ?? (() => {});
  const steps = buildDeploySteps(opts.assets, { reset: opts.reset });

  if (opts.dryRun) {
    for (const step of steps) {
      log(`▶  ${step.label}… (dry-run, not executed)`);
    }
    return { ok: true, stepsRun: steps.length };
  }

  // `prepare: false` — Supabase's pooler doesn't support prepared statements
  // at txn level. `sql.unsafe()` runs multi-statement SQL (schema/rpcs files).
  const sql = postgres(opts.dbUrl, { prepare: false, onnotice: () => {} });
  let stepsRun = 0;
  try {
    for (const step of steps) {
      log(`▶  ${step.label}…`);
      try {
        await sql.unsafe(step.sql);
        stepsRun++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, stepsRun, failedStep: step.label, error: message };
      }
    }
    return { ok: true, stepsRun };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

/** Convenience: resolve the migrations dir join (re-export to avoid a path import in callers). */
export function migrationPath(assets: ServerAssetPaths, file: string): string {
  return join(assets.migrationsDir, file);
}
