/**
 * Every write to Cerefox content leaves an audit entry (iteration 51, 0.22.0).
 *
 * An inventory in 2026-11 found writes with no entry: project memberships on
 * several paths, `backup restore`, version retention, `server reindex`. Each
 * was a direct table write or an RPC that forgot the entry, added at a
 * different time by a different change. So the rule is enforced from source,
 * in both places a write can live:
 *
 * 1. SQL: a function in `rpcs.sql` that inserts, updates or deletes a content
 *    table must write an entry (`cerefox_create_audit_entry`, or a direct
 *    insert into the audit log), or be named in
 *    `SQL_ALLOWED` with a reason.
 * 2. TypeScript: a `.from("<content table>")` followed by `.insert`,
 *    `.update`, `.delete` or `.upsert` outside tests must be named in
 *    `TS_ALLOWED` with a reason. New writes belong in an RPC that audits in
 *    the same transaction.
 *
 * Deliberately NOT checked: that an allowlisted client-side write really does
 * write its entry, or that an entry's description is accurate. Those are
 * review questions; the test turns "forgot the audit log" into a decision.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RPCS = readFileSync(join(REPO_ROOT, "src/cerefox/db/rpcs.sql"), "utf8");

const CONTENT_TABLES = [
  "cerefox_documents",
  "cerefox_chunks",
  "cerefox_document_projects",
  "cerefox_projects",
  "cerefox_document_versions",
  "cerefox_document_relations",
  "cerefox_config",
];

/** SQL functions that write content without calling the audit RPC themselves. */
const SQL_ALLOWED: Record<string, string> = {
  cerefox_insert_json_row:
    "internal helper; called only by the backup-restore RPCs, which write the entry",
  cerefox_update_chunk_fts:
    "refreshes derived search data after a title change; called only by cerefox_rename_document, which writes the entry",
};

/** Client-side writes that stay direct, as "<repo path>:<table>". */
const TS_ALLOWED: Record<string, string> = {
  "packages/memory/src/ingestion/client-bridge.ts:cerefox_chunks":
    "re-embedding after a title change: derived search data; the rename RPC audits the change",
  "packages/memory/src/cli/commands/reindex.ts:cerefox_chunks":
    "re-embedding: derived search data; the run writes one 'reindex' entry",
  "packages/memory/src/web/routes/documents-write.ts:cerefox_documents":
    "review status: the route writes a 'status-change' entry after the update",
  "packages/memory/src/web/routes/documents-write.ts:cerefox_document_versions":
    "version archive: the route writes an 'archive'/'unarchive' entry after the update",
  "packages/memory/src/cli/commands/version-archive.ts:cerefox_document_versions":
    "version archive: the command writes an 'archive'/'unarchive' entry after the update",
};

/** Each function from its CREATE to its own closing `$$;`, comments stripped:
 *  a body that ran on into the next section's header once let a function
 *  pass on the strength of a comment that mentioned the audit RPC. */
function sqlFunctions(sql: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const re = /^CREATE (?:OR REPLACE )?FUNCTION ([a-z_]+)\s*\(/gm;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    const end = sql.indexOf("\n$$;", m.index);
    const body = sql.slice(m.index, end === -1 ? sql.length : end).replace(/--[^\n]*/g, "");
    out.push({ name: m[1], body });
  }
  return out;
}

/** The audit RPC, or a direct insert (the relation RPCs predate the helper). */
function audits(body: string): boolean {
  return body.includes("cerefox_create_audit_entry") || /INSERT INTO cerefox_audit_log\b/.test(body);
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "__tests__" || entry === "test") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...tsFiles(path));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

describe("audit coverage (iteration 51)", () => {
  test("every rpcs.sql function that writes content calls cerefox_create_audit_entry", () => {
    const writes = new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(${CONTENT_TABLES.join("|")})\\b`, "i");
    const missing = sqlFunctions(RPCS)
      .filter((f) => writes.test(f.body))
      .filter((f) => !audits(f.body))
      .map((f) => f.name)
      .filter((name) => !(name in SQL_ALLOWED));
    expect(missing).toEqual([]);
  });

  test("the SQL allowlist names only functions that exist and still need it", () => {
    const fns = new Map(sqlFunctions(RPCS).map((f) => [f.name, f.body]));
    for (const name of Object.keys(SQL_ALLOWED)) {
      expect(fns.has(name)).toBe(true);
      expect(audits(fns.get(name)!)).toBe(false);
    }
  });

  test("no direct client-side write to a content table outside the allowlist", () => {
    const found = new Set<string>();
    const fromRe = new RegExp(`\\.from\\(\\s*["'\`](${CONTENT_TABLES.join("|")})["'\`]\\s*\\)`, "g");
    const rawRe = new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(${CONTENT_TABLES.join("|")})\\b`, "gi");
    for (const root of ["_shared", "packages/memory/src", "supabase/functions", "scripts", "frontend/src"]) {
      for (const file of tsFiles(join(REPO_ROOT, root))) {
        const src = readFileSync(file, "utf8");
        for (let m = fromRe.exec(src); m; m = fromRe.exec(src)) {
          // The write verb follows within the same call chain.
          const chain = src.slice(m.index, m.index + 300).split(/;\s*\n/)[0];
          if (/\.(insert|update|delete|upsert)\(/.test(chain)) {
            found.add(`${relative(REPO_ROOT, file)}:${m[1]}`);
          }
        }
        // Raw SQL in TypeScript (a postgres.js tagged query, say) bypasses
        // the Data API entirely; the benchmark's cleanup once purged this way.
        for (let m = rawRe.exec(src); m; m = rawRe.exec(src)) {
          found.add(`${relative(REPO_ROOT, file)}:${m[2]}`);
        }
      }
    }
    const unexpected = [...found].filter((k) => !(k in TS_ALLOWED)).sort();
    expect(unexpected).toEqual([]);
    // A stale allowlist entry hides the next real write in that file.
    const stale = Object.keys(TS_ALLOWED).filter((k) => !found.has(k)).sort();
    expect(stale).toEqual([]);
  });

  test("the operation CHECK carries the 0.22.0 operations, in schema AND migration", () => {
    const schema = readFileSync(join(REPO_ROOT, "src/cerefox/db/schema.sql"), "utf8");
    const mig = readFileSync(join(REPO_ROOT, "src/cerefox/db/migrations/0037_audit_completeness.sql"), "utf8");
    for (const op of ["purge", "projects-change", "backup-restore", "version-prune", "reindex"]) {
      expect(schema).toContain(`'${op}'`);
      expect(mig).toContain(`'${op}'`);
    }
  });

  test("audit entries keep their ids: no foreign key on the audit log", () => {
    const schema = readFileSync(join(REPO_ROOT, "src/cerefox/db/schema.sql"), "utf8");
    const table = schema.slice(schema.indexOf("CREATE TABLE IF NOT EXISTS cerefox_audit_log"));
    const body = table.slice(0, table.indexOf(");"));
    expect(body).not.toMatch(/REFERENCES/);
  });
});
