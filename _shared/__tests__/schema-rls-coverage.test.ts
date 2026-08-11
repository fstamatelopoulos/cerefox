/**
 * Every table `schema.sql` creates must also have RLS enabled in it.
 *
 * Cerefox's access model is **RLS ON with NO policies**: the service-role key
 * bypasses RLS and holds all real access, and every other role is denied by
 * having nothing to match. That model is only as strong as its weakest table,
 * and a table that never reaches the `ENABLE ROW LEVEL SECURITY` block is
 * reachable by any role holding a table grant.
 *
 * `cerefox_document_relations` was added in iteration 29 and never added to
 * that block. On projects created before Supabase stopped granting `anon`
 * blanket privileges on `public`, that meant world read AND write on it via the
 * publishable key — a key designed to be public. Supabase's advisor caught it
 * on 2026-08-09, roughly a year after the table shipped.
 *
 * Nothing in the repo could have noticed: the schema applied cleanly, every
 * test passed, and the omission is invisible unless you compare two lists by
 * hand. So this compares them.
 *
 * Pure text analysis of `schema.sql`. No database.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCHEMA = readFileSync(
  join(import.meta.dir, "..", "..", "src", "cerefox", "db", "schema.sql"),
  "utf8",
);

/** Tables the schema creates. */
function declaredTables(): string[] {
  return [...SCHEMA.matchAll(/CREATE TABLE IF NOT EXISTS\s+(cerefox_[a-z_]+)/g)].map((m) => m[1]);
}

/** Tables the schema turns RLS on for. */
function rlsEnabledTables(): string[] {
  return [...SCHEMA.matchAll(/ALTER TABLE\s+(cerefox_[a-z_]+)\s+ENABLE ROW LEVEL SECURITY/g)].map(
    (m) => m[1],
  );
}

describe("RLS covers every table (Supabase rls_disabled_in_public)", () => {
  test("every created table has RLS enabled", () => {
    const declared = declaredTables();
    const guarded = new Set(rlsEnabledTables());
    const missing = declared.filter((t) => !guarded.has(t));

    // A table here is world-reachable on any project whose `anon` role holds a
    // grant on it — and the publishable key is meant to be public.
    expect(missing).toEqual([]);
  });

  test("both lists are non-trivial, so this cannot pass vacuously", () => {
    // If either matcher stopped matching, `missing` would be empty and the
    // assertion above would pass while protecting nothing.
    expect(declaredTables().length).toBeGreaterThanOrEqual(10);
    expect(rlsEnabledTables().length).toBeGreaterThanOrEqual(10);
  });

  test("the detector finds a table that is created but not guarded", () => {
    // Proves the comparison works, without needing a real regression.
    const declared = ["cerefox_documents", "cerefox_new_table"];
    const guarded = new Set(["cerefox_documents"]);
    expect(declared.filter((t) => !guarded.has(t))).toEqual(["cerefox_new_table"]);
  });

  test("RLS is enabled with NO policies — the model is deny-by-default", () => {
    // A policy would grant access to a non-service role, which is a different
    // security model from the one documented. If one is ever added, it should
    // be a deliberate decision that updates this test.
    expect(SCHEMA).not.toMatch(/CREATE POLICY/i);
  });
});
