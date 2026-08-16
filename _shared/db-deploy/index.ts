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
    await reloadPostgrestSchemaCache(sql);
    return { ok: true, stepsRun };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

/**
 * Ask PostgREST to reload its schema cache after DDL. rpcs.sql and the
 * migrations DROP/CREATE functions; until the cache refreshes, calling a
 * changed function through the Data API yields PGRST202 ("Could not find the
 * function") — which callers misread as "server not deployed". Hosted
 * Supabase auto-reloads via a DDL event trigger within moments; a plain
 * PostgREST (Cerefox Local) may not, so the deploy paths nudge it explicitly.
 * Best-effort: NOTIFY costs nothing when nobody is listening.
 */
async function reloadPostgrestSchemaCache(sql: ReturnType<typeof postgres>): Promise<void> {
  try {
    await sql.unsafe("NOTIFY pgrst, 'reload schema'");
  } catch {
    // Non-fatal — the hosted event trigger covers the common case.
  }
}

/** Convenience: resolve the migrations dir join (re-export to avoid a path import in callers). */
export function migrationPath(assets: ServerAssetPaths, file: string): string {
  return join(assets.migrationsDir, file);
}

// ── Incremental migrations (extracted from scripts/db_migrate.ts, v0.8.1) ────

export const BOOTSTRAP_MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS cerefox_migrations (
    id         SERIAL      PRIMARY KEY,
    filename   TEXT        NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

/**
 * Does this database already have a Cerefox schema? Used by
 * `cerefox deploy-server` to choose the fresh-deploy path vs the
 * apply-pending-migrations path. Probes for the core documents table.
 */
export async function detectExistingSchema(dbUrl: string): Promise<boolean> {
  const sql = postgres(dbUrl, { prepare: false, onnotice: () => {} });
  try {
    const rows = (await sql`SELECT to_regclass('public.cerefox_documents') AS t`) as Array<{
      t: string | null;
    }>;
    return rows[0]?.t != null;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

export interface MigrationStatus {
  all: string[];
  applied: string[];
  pending: string[];
}

/** Read which migration files exist vs are recorded as applied. */
export async function migrationStatus(opts: {
  dbUrl: string;
  assets: ServerAssetPaths;
}): Promise<MigrationStatus> {
  const sql = postgres(opts.dbUrl, { prepare: false, onnotice: () => {} });
  try {
    await sql.unsafe(BOOTSTRAP_MIGRATIONS_SQL);
    const all = listMigrationFiles(opts.assets.migrationsDir);
    const appliedRows = (await sql`SELECT filename FROM cerefox_migrations ORDER BY filename`) as Array<{
      filename: string;
    }>;
    const appliedSet = new Set(appliedRows.map((r) => r.filename));
    return {
      all,
      applied: all.filter((f) => appliedSet.has(f)),
      pending: all.filter((f) => !appliedSet.has(f)),
    };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

export interface DbMigrateOptions {
  dbUrl: string;
  assets: ServerAssetPaths;
  dryRun?: boolean;
  log?: (line: string) => void;
}

export interface DbMigrateResult {
  ok: boolean;
  /** Filenames applied (empty in dry-run; that's what `pending` is for). */
  applied: string[];
  /** All pending migrations found at start. */
  pending: string[];
  failedFile?: string;
  error?: string;
}

/**
 * Apply pending migrations to an existing database, each in its own
 * transaction (with the tracking-row insert in the same txn so a failure
 * rolls both back). Bootstraps `cerefox_migrations` first. Returns a
 * structured result; never calls process.exit.
 */
export async function runDbMigrate(opts: DbMigrateOptions): Promise<DbMigrateResult> {
  const log = opts.log ?? (() => {});
  // Migration NOTICEs are the operator's report (0026 lists corrupt-metadata
  // rows; 0027 reports rows/bytes stripped) — the blanket onnotice:()=>{}
  // used elsewhere silently swallowed them, so every data migration ran mute
  // (found while planning the 0027 staging rehearsal). Surface them through
  // the same log the step lines use.
  const sql = postgres(opts.dbUrl, {
    prepare: false,
    onnotice: (n: { message?: string }) => {
      if (n.message) log(`   ↳ ${n.message}`);
    },
  });
  try {
    await sql.unsafe(BOOTSTRAP_MIGRATIONS_SQL);
    const allFiles = listMigrationFiles(opts.assets.migrationsDir);
    const appliedRows = (await sql`SELECT filename FROM cerefox_migrations ORDER BY filename`) as Array<{
      filename: string;
    }>;
    const appliedSet = new Set(appliedRows.map((r) => r.filename));
    const pending = allFiles.filter((f) => !appliedSet.has(f));

    if (pending.length === 0) return { ok: true, applied: [], pending: [] };
    if (opts.dryRun) {
      for (const f of pending) log(`Would apply ${f}`);
      return { ok: true, applied: [], pending };
    }

    const applied: string[] = [];
    for (const f of pending) {
      const body = readFileSync(join(opts.assets.migrationsDir, f), "utf8");
      log(`Applying ${f}…`);
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(body);
          await tx`INSERT INTO cerefox_migrations (filename) VALUES (${f}) ON CONFLICT DO NOTHING`;
        });
        applied.push(f);
      } catch (err) {
        return {
          ok: false,
          applied,
          pending,
          failedFile: f,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    if (applied.length > 0) await reloadPostgrestSchemaCache(sql);
    return { ok: true, applied, pending };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

/**
 * Re-apply `rpcs.sql` to refresh the Postgres RPCs (CREATE OR REPLACE /
 * DROP+CREATE — idempotent). Used by the existing-DB path of
 * `cerefox deploy-server` so an update lands the latest RPC definitions.
 */
export async function applyRpcs(opts: {
  dbUrl: string;
  assets: ServerAssetPaths;
  dryRun?: boolean;
  log?: (line: string) => void;
}): Promise<{ ok: boolean; error?: string }> {
  const log = opts.log ?? (() => {});
  log("Refresh RPCs (rpcs.sql)…");
  if (opts.dryRun) return { ok: true };
  const rpcsSql = readFileSync(opts.assets.rpcsFile, "utf8");
  const sql = postgres(opts.dbUrl, { prepare: false, onnotice: () => {} });
  try {
    await sql.unsafe(rpcsSql);
    await reloadPostgrestSchemaCache(sql);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}
