/**
 * Source-level invariants for the guards inside rpcs.sql.
 *
 * SQL function bodies have no unit-test harness here, so a guard can silently
 * vanish in a refactor and nothing fails until a live run. These assertions
 * read rpcs.sql and check each guard EXISTS inside the specific function that
 * must carry it — scoped to the function body so a similar guard elsewhere
 * cannot satisfy the test by accident.
 *
 * Technique adopted from @tdebasis's PR #213 (the community fix for #212),
 * which asserted the ingest metadata guard this way. His PR was superseded
 * behaviorally by #215/v1.7.1, but this idea outlived it.
 *
 * These are guards-about-guards: prove each fires on the shape it exists to
 * catch is the live suites' job; prove each still EXISTS is this file's.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RPCS = readFileSync(
  join(import.meta.dir, "..", "..", "src", "cerefox", "db", "rpcs.sql"),
  "utf8",
);

/** The body of one CREATE FUNCTION, so assertions cannot match a neighbour. */
function functionBody(name: string): string {
  const re = new RegExp(`CREATE (OR REPLACE )?FUNCTION ${name}\\(`);
  const m = RPCS.match(re);
  expect(m?.index).toBeGreaterThan(-1);
  const start = m!.index!;
  const next = RPCS.slice(start + 1).search(/CREATE (OR REPLACE )?FUNCTION /);
  return RPCS.slice(start, next === -1 ? undefined : start + 1 + next);
}

describe("cerefox_ingest_document guards (#212, #214)", () => {
  const body = functionBody("cerefox_ingest_document");

  test("metadata must be a JSON object; NULL stays legal (means 'not provided')", () => {
    expect(body).toMatch(/p_metadata IS NOT NULL AND jsonb_typeof\(p_metadata\) <> 'object'/);
    expect(body).toContain("metadata = COALESCE(p_metadata, metadata)");
  });

  test("trashed documents refuse content updates (CEREFOX_DELETED)", () => {
    expect(body).toContain("CEREFOX_DELETED");
  });

  test("link scanning is DELEGATED to the shared extractor, not inlined", () => {
    // The whole point of cerefox_extract_doc_link_ids is that the guard and
    // the sweep cannot drift; an inlined fence regex here would reopen that.
    expect(body).toContain("cerefox_extract_doc_link_ids");
    expect(body).not.toMatch(/```.*\.\*\?/);
    expect(body).toContain("CEREFOX_UNRESOLVED_LINKS");
  });

  test("the CAS compares trimmed and conflicts under PT409, never a retryable SQLSTATE", () => {
    expect(body).toMatch(/BTRIM\(p_expected_content_hash\) <> v_current_hash/);
    expect(body).toContain("USING ERRCODE = 'PT409'");
    // The 40001 history lives in a comment (kept deliberately); what must
    // never return is 40001 as an ACTUAL error code.
    expect(body).not.toContain("USING ERRCODE = '40001'");
  });
});

describe("cerefox_set_document_metadata guards (#212)", () => {
  const body = functionBody("cerefox_set_document_metadata");

  test("input must be a JSON object", () => {
    expect(body).toMatch(/jsonb_typeof\(p_metadata\) <> 'object'/);
  });

  test("merge onto a corrupt stored value is refused (CEREFOX_BAD_METADATA)", () => {
    expect(body).toContain("CEREFOX_BAD_METADATA");
  });

  test("the before-value is normalized so replace can REPAIR a corrupt row", () => {
    // jsonb_object_keys on a scalar errors and rolls the repair back — the
    // exact failure round 5 verified live. Normalization must precede use.
    const normalize = body.indexOf("jsonb_typeof(v_before) <> 'object' THEN '{}'::jsonb");
    // "FROM jsonb_object_keys" is the USE; a bare indexOf would match the
    // comment explaining the hazard, which precedes the normalization.
    const reporting = body.indexOf("FROM jsonb_object_keys");
    expect(normalize).toBeGreaterThan(-1);
    expect(reporting).toBeGreaterThan(-1);
    expect(normalize).toBeLessThan(reporting);
  });
});

describe("delete/restore/sweep invariants (#208, #210, #214)", () => {
  test("delete validates the read-hash BEFORE the already-deleted no-op", () => {
    const body = functionBody("cerefox_delete_document");
    const cas = body.indexOf("CEREFOX_CONFLICT");
    const noop = body.indexOf("'already_deleted', TRUE");
    expect(cas).toBeGreaterThan(-1);
    expect(noop).toBeGreaterThan(-1);
    expect(cas).toBeLessThan(noop);
  });

  test("grown signatures DROP their old overloads (the PGRST203 orphan class)", () => {
    // CREATE OR REPLACE never removes an old signature; every function whose
    // parameter list grew must drop its ancestors explicitly.
    expect(RPCS).toContain("DROP FUNCTION IF EXISTS cerefox_delete_document(UUID);");
    expect(RPCS).toContain("DROP FUNCTION IF EXISTS cerefox_purge_document(UUID);");
    expect(RPCS).toContain("DROP FUNCTION IF EXISTS cerefox_restore_document(UUID);");
  });

  test("the sweep uses the shared extractor too", () => {
    expect(functionBody("cerefox_find_dead_links")).toContain("cerefox_extract_doc_link_ids");
  });
});

describe("archived chunks carry no search artifacts (#216)", () => {
  test("snapshot nulls all three artifacts in the SAME archive UPDATE", () => {
    const body = functionBody("cerefox_snapshot_version");
    const update = body.slice(body.indexOf("UPDATE cerefox_chunks"));
    const stmt = update.slice(0, update.indexOf(";"));
    // One atomic write: re-point AND strip, so no window exists where an
    // archived row still carries artifacts.
    expect(stmt).toContain("SET version_id = v_version_id");
    expect(stmt).toContain("embedding_primary = NULL");
    expect(stmt).toContain("embedding_upgrade = NULL");
    expect(stmt).toContain("fts = NULL");
  });

  test("embedding_primary is nullable in the schema (archiving nulls it)", () => {
    const schema = readFileSync(
      join(import.meta.dir, "..", "..", "src", "cerefox", "db", "schema.sql"),
      "utf8",
    );
    expect(schema).not.toMatch(/embedding_primary\s+VECTOR\(768\)\s+NOT NULL/);
    expect(schema).toMatch(/embedding_primary\s+VECTOR\(768\)/);
  });
});
