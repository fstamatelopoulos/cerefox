/**
 * Guard against the #191 defect class: a document field that a caller may
 * legitimately omit must be preserved on update, not overwritten.
 *
 * `cerefox_ingest_document` serves both "save new content" and "relabel this
 * document". Its parameters therefore carry two meanings at once, and the only
 * thing separating them is whether the UPDATE branch coalesces:
 *
 *     source      = COALESCE(p_source, source)             -- absent = keep
 *     source_path = COALESCE(p_source_path, source_path)   -- absent = keep
 *     metadata    = COALESCE(p_metadata, metadata)         -- absent = keep
 *
 * Assign one of those unconditionally and every caller that omits it silently
 * rewrites it to the parameter default. That is what #191 was: `p_source TEXT
 * DEFAULT 'agent'` plus a bare `source = p_source`, so `server migrate-format`
 * relabelled every document it converted and any other partial update quietly
 * reset provenance to 'agent'. v0.11.1 had already fixed exactly this for
 * `metadata` after content updates were found to be wiping tags; `source` was
 * left out of that fix and took another release to surface.
 *
 * Both halves are required and neither is sufficient alone:
 *   - COALESCE without a NULL default never sees NULL, so it cannot fire.
 *   - A NULL default without COALESCE writes NULL into a NOT NULL column.
 *
 * The failure is invisible at runtime: the write succeeds, the audit entry says
 * 'update-content', and only the stored column disagrees. So the check is
 * static — parse the SQL and assert both halves.
 *
 * Pure text analysis of `rpcs.sql`. No DB, no network.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");

const RPCS = readFileSync(
  join(REPO_ROOT, "src", "cerefox", "db", "rpcs.sql"),
  "utf8",
);

const MIGRATE_FORMAT = readFileSync(
  join(REPO_ROOT, "packages", "memory", "src", "cli", "commands", "migrate-format.ts"),
  "utf8",
);

const PIPELINE = readFileSync(
  join(REPO_ROOT, "packages", "memory", "src", "ingestion", "pipeline.ts"),
  "utf8",
);

/** The body of `cerefox_ingest_document`, up to the next function definition. */
function ingestBody(): string {
  const start = RPCS.indexOf("CREATE FUNCTION cerefox_ingest_document");
  expect(start).toBeGreaterThan(-1);
  const rest = RPCS.slice(start + 1);
  const end = rest.indexOf("\nCREATE FUNCTION ");
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Document columns a caller may omit on an update. `metadata` and `source_path`
 * carry the v0.11.1 fix; `source` joined them in #191.
 */
const PRESERVED_ON_UPDATE = ["source", "source_path", "metadata"] as const;

/** Parameters whose absence must be distinguishable from a real value. */
const OMITTABLE_PARAMS = ["p_source", "p_source_path", "p_metadata"] as const;

describe("cerefox_ingest_document preserves omitted document fields (#191)", () => {
  const body = ingestBody();

  for (const column of PRESERVED_ON_UPDATE) {
    test(`${column} is coalesced, not assigned unconditionally`, () => {
      // The UPDATE list assigns `column = <expr>,`. Capture to end of line
      // rather than to the first comma: the expected expression contains one.
      const re = new RegExp(`^\\s*${column}\\s*=\\s*(.+)$`, "m");
      const match = body.match(re);
      // A renamed column would make this vacuously pass.
      expect(match).not.toBeNull();
      expect(match![1].trim().replace(/,$/, "")).toBe(`COALESCE(p_${column}, ${column})`);
    });
  }

  for (const param of OMITTABLE_PARAMS) {
    test(`${param} declares DEFAULT NULL so omission is detectable`, () => {
      const re = new RegExp(`^\\s*${param}\\s+[A-Z0-9()]+\\s+DEFAULT\\s+([^,\\n]+)`, "im");
      const match = body.match(re);
      expect(match).not.toBeNull();
      expect(match![1].trim().replace(/,$/, "").toUpperCase()).toBe("NULL");
    });
  }

  test("the CREATE path still supplies a concrete source", () => {
    // NOT NULL column: create cannot inherit a previous value, so the fallback
    // has to live at the insert.
    expect(body).toContain("COALESCE(p_source, 'agent')");
  });

  test("p_source and p_source_label remain distinct", () => {
    // p_source is the document's origin; p_source_label records how this write
    // was triggered and lands on the version row. Collapsing them would make
    // preserving one impossible without falsifying the other.
    expect(body).toContain(
      "cerefox_snapshot_version(v_doc_id, p_source_label, p_retention_hours, p_cleanup_enabled)",
    );
    expect(body).not.toContain("cerefox_snapshot_version(v_doc_id, p_source,");
  });
});

describe("server migrate-format does not relabel what it converts (#191)", () => {
  test("the ingest call passes the document's own source", () => {
    // The RPC guard above makes an omitted source safe. This asserts the
    // stronger client-side property: the command sends the value it read, so it
    // is also correct against a server that predates the COALESCE.
    expect(MIGRATE_FORMAT).toContain("source: doc.doc_source");
  });

  test("no hardcoded document source survives", () => {
    // `source:` on an ingest call must never be a string literal here. The
    // version label is a separate key and is allowed to be one.
    const hardcoded = /(?<!\w)source:\s*["'`]/.exec(MIGRATE_FORMAT);
    expect(hardcoded).toBeNull();
  });

  test("the version row still records that migrate-format did the write", () => {
    // Preserving provenance must not cost the audit trail: the conversion is
    // still identifiable in version history.
    expect(MIGRATE_FORMAT).toContain('sourceLabel: "migrate-format"');
  });

  test("sourceLabel survives the ingestText → updateDocument hand-off", () => {
    // The RPC call carrying sourceLabel lives in updateDocument, but callers
    // set it on ingestText, which forwards to updateDocument for every
    // by-id update — the path migrate-format takes. Omit it from that object
    // literal and the label is silently dropped: the option still type-checks
    // on the way in, and nothing fails at runtime. Caught exactly this way
    // while writing the #191 fix.
    const calls = [...PIPELINE.matchAll(/await this\.updateDocument\(\{([\s\S]*?)\n\s*\}\)/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call[1]).toContain("sourceLabel");
  });

  test("doc_source is actually read back from the RPC", () => {
    // cerefox_get_document returns doc_source; the local type annotation has to
    // include it or the value is silently undefined at runtime.
    expect(MIGRATE_FORMAT).toContain("doc_source: string");
    expect(RPCS).toContain("d.source        AS doc_source");
  });
});
