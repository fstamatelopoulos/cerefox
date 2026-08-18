/**
 * #135 — guard against silently truncated PostgREST reads.
 *
 * Supabase caps responses at 1000 rows. A `.select()` with no bound returns a
 * prefix that is indistinguishable from a complete result, so callers that
 * derive totals from `data.length` report the truncation as success — the
 * failure behind #131 (a backup that dropped 29% of a corpus and exited 0).
 *
 * This test walks the source and flags `.from(...).select(...)` chains that
 * carry no bound. A read is considered bounded when it uses any of:
 *   .range() / .limit()            — explicit window (incl. fetchAllPages)
 *   .single() / .maybeSingle()     — one row by construction
 *   count: "exact" + head: true    — server-side count, no rows fetched
 *   .eq("id", …) / .in("id", …)    — id-scoped lookup
 *
 * New unbounded reads must either be bounded or added to ALLOWLIST with a
 * reason. Prefer server-side aggregation (an RPC or `count: "exact"`) over
 * fetching rows to count them — that pattern is structurally immune, which is
 * why `cerefox doctor`'s counts were unaffected by #131.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCAN_DIRS = [
  join(REPO_ROOT, "_shared"),
  join(REPO_ROOT, "packages", "memory", "src"),
  join(REPO_ROOT, "scripts"),
  join(REPO_ROOT, "supabase", "functions"),
];

/**
 * Known-safe unbounded reads: small, structurally bounded result sets.
 * Key = `path:tableName`. Add here only with a reason.
 */
const ALLOWLIST = new Map<string, string>([
  // Projects are a small, human-curated set (tens, not thousands).
  ["packages/memory/src/cli/commands/list-projects.ts:cerefox_projects", "small set"],
  ["packages/memory/src/cli/commands/project-crud.ts:cerefox_projects", "small set"],
  ["packages/memory/src/web/routes/discovery.ts:cerefox_projects", "small set"],
  ["packages/memory/src/web/routes/projects.ts:cerefox_projects", "small set"],
  ["scripts/cerefox_export.ts:cerefox_projects", "small set (id → name map)"],
  ["supabase/functions/cerefox-ingest/index.ts:cerefox_projects", "single-project lookup/insert"],
  ["_shared/db-client/index.ts:cerefox_projects", "small set"],
  ["_shared/mcp-tools/list-projects.ts:cerefox_projects", "small set"],
  ["_shared/mcp-tools/_projects.ts:cerefox_projects", "small set"],
  // One document's project memberships: a handful of rows by construction.
  ["packages/memory/src/ingestion/client-bridge.ts:cerefox_document_projects", "per-document memberships"],
  ["_shared/mcp-tools/_document-meta.ts:cerefox_document_projects", "per-document memberships (facet diff + replace tail)"],
  ["_shared/mcp-tools/_document-meta.ts:cerefox_projects", "id-validation of the requested set (bounded by request size)"],
  ["packages/memory/src/web/routes/documents-read.ts:cerefox_document_projects", "per-document memberships"],
  ["scripts/cerefox_export.ts:cerefox_document_projects", "per-document memberships"],
  ["packages/memory/src/web/routes/discovery.ts:cerefox_document_projects", "per-document memberships (dashboard); the bulk scans paginate"],
]);

const BOUND_MARKERS = [
  ".range(",
  ".limit(",
  ".single(",
  ".maybeSingle(",
  "head: true",
  'eq("id"',
  'in("id"',
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/**
 * Find `.from("table")` … `.select(` chains and check the statement they sit
 * in for a bound. Statement = from the `.from(` to the next `;` at depth 0,
 * which covers the multi-line builder chains used throughout the codebase.
 */
function findUnbounded(source: string, relPath: string): string[] {
  const findings: string[] = [];
  const fromRe = /\.from\(\s*["'`]([A-Za-z0-9_]+)["'`]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(source)) !== null) {
    const table = m[1];
    const semi = source.indexOf(";", m.index);
    const end = semi === -1 ? source.length : semi;
    const stmt = source.slice(m.index, end);
    if (!stmt.includes(".select(")) continue; // writes: delete/insert/update
    if (BOUND_MARKERS.some((mark) => stmt.includes(mark))) continue;
    if (ALLOWLIST.has(`${relPath}:${table}`)) continue;

    // Inside a fetchAllPages callback: bounded by the helper's contract (it
    // supplies the range and asserts completeness against the server count).
    const before = source.slice(Math.max(0, m.index - 600), m.index);
    if (before.includes("fetchAllPages")) continue;

    // Builder pattern: `let q = supabase.from(...)…;` bounded in a later
    // statement (`q = q.range(...)`, `return q.limit(...)`). Follow the
    // assigned variable forward through the rest of the enclosing function.
    // The assignment may sit on an earlier line (`let q = ctx.supabase\n
    // .from(...)`), so look back past the statement start, not just the line.
    const stmtStart = Math.max(
      source.lastIndexOf(";", m.index),
      source.lastIndexOf("{", m.index),
    );
    const assign = /(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*[\w.$\s]*$/.exec(
      source.slice(stmtStart + 1, m.index),
    );
    if (assign) {
      const varName = assign[1];
      const after = source.slice(end, end + 2000);
      if (BOUND_MARKERS.some((mark) => after.includes(`${varName}${mark}`))) continue;
    }

    findings.push(`${relPath} → .from("${table}")`);
  }
  return findings;
}

describe("no unbounded PostgREST selects (#135)", () => {
  test("every row-returning select is bounded or allowlisted", () => {
    const findings: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(dir)) {
        const rel = relative(REPO_ROOT, file);
        findings.push(...findUnbounded(readFileSync(file, "utf8"), rel));
      }
    }
    if (findings.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        "Unbounded PostgREST select(s) — bound with .range()/.limit()/fetchAllPages, " +
          "use a server-side count, or allowlist with a reason:\n  " +
          findings.join("\n  "),
      );
    }
    expect(findings).toEqual([]);
  });

  test("the scanner actually detects the #131 shape", () => {
    // Regression guard for the guard: the pre-#132 backup query.
    const bad = `const { data } = await client.raw
      .from("cerefox_documents")
      .select("id, title")
      .is("deleted_at", null)
      .order("created_at", { ascending: true });`;
    expect(findUnbounded(bad, "x.ts").length).toBe(1);

    const good = bad.replace(".order(", ".range(0, 199).order(");
    expect(findUnbounded(good, "x.ts")).toEqual([]);
  });
});
