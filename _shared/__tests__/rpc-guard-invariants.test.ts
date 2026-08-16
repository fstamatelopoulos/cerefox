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

  test("embedding_primary is nullable, WITH the current-chunk CHECK replacing NOT NULL", () => {
    const schema = readFileSync(
      join(import.meta.dir, "..", "..", "src", "cerefox", "db", "schema.sql"),
      "utf8",
    );
    expect(schema).not.toMatch(/embedding_primary\s+VECTOR\(768\)\s+NOT NULL/);
    // Round-6 review: dropping NOT NULL alone would let a short embedding-API
    // response insert a silently search-invisible CURRENT chunk. The CHECK
    // keeps that failure loud.
    expect(schema).toContain("cerefox_chunks_current_has_embedding");
    expect(schema).toContain("CHECK (version_id IS NOT NULL OR embedding_primary IS NOT NULL)");
  });

  test("snapshot also clears the upgrade-embedder stamp with its vector", () => {
    const body = functionBody("cerefox_snapshot_version");
    const stmt = body.slice(body.indexOf("UPDATE cerefox_chunks"), body.indexOf("Lazy retention"));
    expect(stmt).toContain("embedder_upgrade = NULL");
  });

  test("migration 0027 carries the new snapshot body and the CHECK (repair-path closure)", () => {
    const mig = readFileSync(
      join(import.meta.dir, "..", "..", "src", "cerefox", "db", "migrations", "0027_drop_archived_search_artifacts.sql"),
      "utf8",
    );
    // db_migrate.ts never refreshes rpcs.sql, and a deploy can fail between
    // the migration step and the RPC refresh — in both states the OLD
    // snapshot would keep archiving WITH artifacts while 0027 is stamped
    // applied. Shipping the function inside the migration closes both.
    expect(mig).toContain("CREATE FUNCTION cerefox_snapshot_version");
    expect(mig).toContain("embedding_primary = NULL");
    expect(mig).toContain("cerefox_chunks_current_has_embedding");
  });
});

describe("store-level writes join the audit trail (0.14.0, #147)", () => {
  const SCHEMA = readFileSync(
    join(import.meta.dir, "..", "..", "src", "cerefox", "db", "schema.sql"),
    "utf8",
  );
  const MIG = readFileSync(
    join(import.meta.dir, "..", "..", "src", "cerefox", "db", "migrations", "0028_audit_store_level_writes.sql"),
    "utf8",
  );

  test("cerefox_set_config writes a config-change entry in the same transaction", () => {
    const body = functionBody("cerefox_set_config");
    expect(body).toContain("cerefox_create_audit_entry");
    expect(body).toContain("'config-change'");
    // The old→new description is what makes the trail answer "what changed".
    expect(body).toMatch(/v_old/);
  });

  test("the grown set_config DROPs its old 2-arg signature (PGRST203 class)", () => {
    expect(RPCS).toContain("DROP FUNCTION IF EXISTS cerefox_set_config(TEXT, TEXT);");
  });

  test("the operation CHECK allows all four store-level values, in schema AND migration", () => {
    for (const op of ["config-change", "project-create", "project-edit", "project-delete"]) {
      expect(SCHEMA).toContain(`'${op}'`);
      expect(MIG).toContain(`'${op}'`);
    }
  });

  test("migration 0028 carries the new set_config body (repair-path closure, as 0027)", () => {
    expect(MIG).toContain("CREATE OR REPLACE FUNCTION cerefox_set_config");
    expect(MIG).toContain("'config-change'");
    expect(MIG).toContain("DROP FUNCTION IF EXISTS cerefox_set_config(TEXT, TEXT);");
  });

  test("save_note is gone; context_expand SURVIVES because search_docs calls it", () => {
    expect(RPCS).not.toContain("CREATE OR REPLACE FUNCTION cerefox_save_note");
    for (const text of [RPCS, MIG]) {
      expect(text).toContain("DROP FUNCTION IF EXISTS cerefox_save_note(TEXT, TEXT, TEXT, UUID, JSONB);");
      // The sandbox caught this: dropping context_expand broke search_docs
      // (SQL-level caller invisible to TS grep). Neither file may drop it.
      expect(text).not.toContain("DROP FUNCTION IF EXISTS cerefox_context_expand");
    }
    expect(RPCS).toContain("CREATE OR REPLACE FUNCTION cerefox_context_expand");
    expect(functionBody("cerefox_search_docs")).toContain("cerefox_context_expand(");
  });

  test("project writes audit IN-TRANSACTION via their RPCs (#219)", () => {
    for (const fn of ["cerefox_create_project", "cerefox_update_project", "cerefox_delete_project"]) {
      expect(functionBody(fn)).toContain("cerefox_create_audit_entry");
    }
    // Delete audits only when a row actually came back — the trail must
    // never assert an event that did not occur.
    const del = functionBody("cerefox_delete_project");
    expect(del.indexOf("RETURNING name INTO v_name")).toBeGreaterThan(-1);
    expect(del.indexOf("IF v_name IS NULL")).toBeLessThan(del.indexOf("cerefox_create_audit_entry"));
    // 'return' mode must not audit the already-exists path: the early RETURN
    // precedes the INSERT + audit.
    const create = functionBody("cerefox_create_project");
    expect(create.indexOf("RETURN QUERY SELECT v_id, v_name, FALSE")).toBeLessThan(create.indexOf("INSERT INTO cerefox_projects"));
  });

  test("migration 0028 carries the project RPC bodies VERBATIM (no drift)", () => {
    const bodyOf = (text: string, name: string): string => {
      const i = text.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
      expect(i).toBeGreaterThan(-1);
      return text.slice(i, text.indexOf("\n$$;", i));
    };
    // set_config is excluded: its rpcs.sql form is CREATE FUNCTION with
    // narrative comments; its migration copy is checked by the key-lockstep
    // and content tests instead.
    for (const fn of ["cerefox_create_project", "cerefox_update_project", "cerefox_delete_project"]) {
      expect(bodyOf(MIG, fn)).toBe(bodyOf(RPCS, fn));
    }
  });

  test("migration 0028 locks down every function it creates (REVOKE PUBLIC)", () => {
    for (const sig of [
      "cerefox_set_config(TEXT, TEXT, TEXT, TEXT)",
      "cerefox_create_project(TEXT, TEXT, TEXT, TEXT, TEXT)",
      "cerefox_update_project(UUID, TEXT, TEXT, TEXT, TEXT)",
      "cerefox_delete_project(UUID, TEXT, TEXT)",
    ]) {
      expect(MIG).toContain(sig);
    }
    expect(MIG.match(/REVOKE EXECUTE ON FUNCTION/g)!.length).toBeGreaterThanOrEqual(2);
  });

  test("the allow-listed config keys stay in lockstep between rpcs.sql and migration 0028", () => {
    // Drift here means a key settable after `server deploy` (rpcs refresh)
    // but not after `db_migrate` alone, or vice versa.
    const fromRpcs = functionBody("cerefox_set_config").match(/ARRAY\[[\s\S]*?\]/)![0];
    const fromMig = MIG.match(/ARRAY\[[\s\S]*?\]/)![0];
    const strip = (s: string) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(strip(fromMig)).toEqual(strip(fromRpcs));
  });
});

