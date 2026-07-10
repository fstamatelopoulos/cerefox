/**
 * Reusable schema-introspection checks.
 *
 * Consumed by `scripts/db_status.ts` in v0.3.0 and by the upcoming
 * `cerefox doctor` command in v0.5. Single source of truth for the expected
 * shape of a healthy Cerefox database.
 *
 * The checks run against Supabase's PostgREST surface — no direct psycopg2-style
 * connection needed. Function-existence probing relies on the fact that calling
 * an unknown RPC returns a PostgreSQL 42883 error, which the db-client wrapper
 * folds into `rpc()` → `null`.
 */

import type { CerefoxDbClient } from "../db-client/index.js";

export const EXPECTED_TABLES = [
  "cerefox_projects",
  "cerefox_documents",
  "cerefox_document_versions",
  "cerefox_audit_log",
  "cerefox_document_projects",
  "cerefox_chunks",
  "cerefox_migrations",
] as const;

export const EXPECTED_FUNCTIONS = [
  "cerefox_set_updated_at",
  "cerefox_hybrid_search",
  "cerefox_fts_search",
  "cerefox_semantic_search",
  "cerefox_reconstruct_doc",
  "cerefox_save_note",
  "cerefox_search_docs",
  "cerefox_context_expand",
  "cerefox_list_metadata_keys",
  "cerefox_snapshot_version",
  "cerefox_get_document",
  "cerefox_list_document_versions",
  "cerefox_create_audit_entry",
  "cerefox_list_audit_entries",
  "cerefox_ingest_document",
  "cerefox_delete_document",
  "cerefox_update_chunk_fts",
  "cerefox_schema_version",
  "cerefox_pg_function_exists",
] as const;

export const ROW_COUNT_TABLES = [
  "cerefox_projects",
  "cerefox_documents",
  "cerefox_document_versions",
  "cerefox_document_projects",
  "cerefox_chunks",
] as const;

export type CheckStatus = "ok" | "missing" | "error" | "unknown";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail?: string;
}

export interface DbStatusReport {
  tables: CheckResult[];
  functions: CheckResult[];
  rowCounts: Record<string, number | null>;
  schemaVersion: { deployed: string | null; bundled?: string | null; mismatch: boolean };
  allOk: boolean;
}

export type ProgressPhase = "tables" | "functions" | "rowCounts" | "schemaVersion";

export interface ProgressEvent {
  phase: ProgressPhase;
  /** 1-indexed; ≤ total. */
  index: number;
  total: number;
  /** The thing being checked right now (table / function / row-count target). */
  current: string;
}

export interface RunChecksOptions {
  /** Pass the bundled schema version (read from schema.sql header) for mismatch detection. */
  bundledSchemaVersion?: string | null;
  /**
   * Optional callback fired before each individual probe. Lets the driver
   * update a spinner / progress bar without `_shared/db-status/` taking
   * on a `ora` dependency itself.
   */
  onProgress?: (event: ProgressEvent) => void;
}

export async function runDbStatusChecks(
  client: CerefoxDbClient,
  opts: RunChecksOptions = {},
): Promise<DbStatusReport> {
  const tables: CheckResult[] = [];
  const functions: CheckResult[] = [];
  const rowCounts: Record<string, number | null> = {};
  const onProgress = opts.onProgress;

  for (let i = 0; i < EXPECTED_TABLES.length; i++) {
    const t = EXPECTED_TABLES[i];
    onProgress?.({ phase: "tables", index: i + 1, total: EXPECTED_TABLES.length, current: t });
    try {
      const exists = await client.tableExists(t);
      tables.push({ name: t, status: exists ? "ok" : "missing" });
    } catch (err) {
      tables.push({
        name: t,
        status: "error",
        detail: (err as Error).message,
      });
    }
  }

  for (let i = 0; i < EXPECTED_FUNCTIONS.length; i++) {
    const f = EXPECTED_FUNCTIONS[i];
    onProgress?.({
      phase: "functions",
      index: i + 1,
      total: EXPECTED_FUNCTIONS.length,
      current: f,
    });
    try {
      const exists = await client.functionExists(f);
      // exists can be true | false | null. null means the introspection
      // helper RPC (cerefox_pg_function_exists) isn't deployed on this
      // database — render as "unknown" rather than misreporting.
      const status: CheckStatus =
        exists === true ? "ok" : exists === false ? "missing" : "unknown";
      const detail =
        status === "unknown"
          ? "introspection helper not deployed; run `cerefox server deploy`"
          : undefined;
      functions.push({ name: f, status, detail });
    } catch (err) {
      functions.push({
        name: f,
        status: "error",
        detail: (err as Error).message,
      });
    }
  }

  for (let i = 0; i < ROW_COUNT_TABLES.length; i++) {
    const t = ROW_COUNT_TABLES[i];
    onProgress?.({
      phase: "rowCounts",
      index: i + 1,
      total: ROW_COUNT_TABLES.length,
      current: t,
    });
    try {
      rowCounts[t] = await client.rowCount(t);
    } catch {
      rowCounts[t] = null;
    }
  }

  onProgress?.({ phase: "schemaVersion", index: 1, total: 1, current: "cerefox_schema_version" });
  let deployed: string | null = null;
  try {
    const result = await client.rpc<string | { cerefox_schema_version?: string } | unknown>(
      "cerefox_schema_version",
    );
    if (typeof result === "string") {
      deployed = result;
    } else if (
      result &&
      typeof result === "object" &&
      "cerefox_schema_version" in (result as object)
    ) {
      const v = (result as { cerefox_schema_version?: unknown }).cerefox_schema_version;
      if (typeof v === "string") deployed = v;
    }
  } catch {
    deployed = null;
  }

  const bundled = opts.bundledSchemaVersion ?? null;
  const mismatch = !!(bundled && deployed && bundled !== deployed);

  // A report is "all OK" only when every check is explicitly OK. "unknown"
  // and "error" both fail the gate so the user is nudged to redeploy.
  const allOk =
    tables.every((t) => t.status === "ok") &&
    functions.every((f) => f.status === "ok") &&
    !mismatch;
  const anyUnknown = functions.some((f) => f.status === "unknown");

  void anyUnknown; // formatReport reads it via the per-row detail field
  return {
    tables,
    functions,
    rowCounts,
    schemaVersion: { deployed, bundled, mismatch },
    allOk,
  };
}

/** Pretty-print a report for the CLI. Returns the multi-line string. */
export function formatReport(report: DbStatusReport): string {
  const lines: string[] = [];
  lines.push("╔══════════════════════════════════════╗");
  lines.push("║  Cerefox DB Status                   ║");
  lines.push("╚══════════════════════════════════════╝");
  lines.push("");

  lines.push("Tables:");
  for (const t of report.tables) {
    const mark = t.status === "ok" ? "✓" : t.status === "missing" ? "✗" : "!";
    lines.push(`  ${mark}  ${t.name}${t.detail ? `  — ${t.detail}` : ""}`);
  }

  lines.push("");
  lines.push("Functions / RPCs:");
  const anyUnknown = report.functions.some((f) => f.status === "unknown");
  if (anyUnknown) {
    lines.push(
      "  ⚠️  Function introspection unavailable on this database. The");
    lines.push(
      "     `cerefox_pg_function_exists` helper RPC is missing (likely a");
    lines.push(
      "     legacy deployment that hasn't been redeployed since v0.3.0).");
    lines.push(
      "     Run `cerefox server deploy` to install it, then");
    lines.push(
      "     re-run this script for a full report.");
    lines.push("");
  }
  for (const f of report.functions) {
    const mark =
      f.status === "ok"
        ? "✓"
        : f.status === "missing"
        ? "✗"
        : f.status === "unknown"
        ? "?"
        : "!";
    lines.push(`  ${mark}  ${f.name}()${f.detail ? `  — ${f.detail}` : ""}`);
  }

  lines.push("");
  lines.push("Row counts:");
  for (const [t, c] of Object.entries(report.rowCounts)) {
    if (c === null) {
      lines.push(`  ?  ${t}: (table missing)`);
    } else {
      lines.push(`  ℹ  ${t}: ${c.toLocaleString()} rows`);
    }
  }

  lines.push("");
  lines.push("Schema version:");
  lines.push(`  bundled : ${report.schemaVersion.bundled ?? "(unknown)"}`);
  lines.push(`  deployed: ${report.schemaVersion.deployed ?? "(not reported)"}`);
  if (report.schemaVersion.mismatch) {
    lines.push("  ⚠️  bundled and deployed schema versions differ — run db_deploy.py");
  }

  lines.push("");
  lines.push("─".repeat(42));
  if (report.allOk) {
    lines.push("✓  All checks passed. Schema looks healthy.");
  } else if (anyUnknown) {
    lines.push("?  Function checks unavailable. Run db_deploy.py to install");
    lines.push("   the introspection helper RPC, then re-run.");
  } else {
    lines.push("✗  Some checks failed. Run db_deploy.py to fix missing objects.");
  }

  return lines.join("\n");
}
