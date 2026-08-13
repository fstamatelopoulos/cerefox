/**
 * `document edit` must not destroy metadata it was never asked to change.
 *
 * Two defects, one write:
 *   1. The update payload always carried `metadata`, so `--title` alone
 *      rewrote it. Nothing on the command line mentioned metadata.
 *   2. The patch is built with an object spread, which does not copy a
 *      non-object JSONB value — it decomposes it. A stored JSON string becomes
 *      one key per character, an array becomes integer-indexed keys, a number
 *      or boolean becomes {}. The write then reports success, and metadata has
 *      no version history to roll back to.
 *
 * Tested at the source level, in the same spirit as ingest-source-default:
 * both defects live in how the payload is ASSEMBLED, above the database, so a
 * round-trip test against a healthy document passes while they are live.
 *
 * The RPC assertion is here rather than in a SQL suite because the two halves
 * are one fix: the RPC guard closes the path that creates the invalid state,
 * and the CLI guard stops the command that destroys it. Fixing either alone
 * leaves the class open, which is the #194 shape.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(import.meta.dir, "..", "src", "cli", "commands", "document-edit.ts"),
  "utf8",
);
const RPCS = readFileSync(
  join(import.meta.dir, "..", "..", "..", "src", "cerefox", "db", "rpcs.sql"),
  "utf8",
);

/** The body of cerefox_ingest_document, so a guard elsewhere in rpcs.sql
 *  cannot make this pass by accident. */
function ingestFunctionBody(): string {
  const start = RPCS.indexOf("CREATE FUNCTION cerefox_ingest_document(");
  expect(start).toBeGreaterThan(-1);
  const end = RPCS.indexOf("CREATE FUNCTION", start + 1);
  return RPCS.slice(start, end === -1 ? undefined : end);
}

describe("document edit: metadata is only written when asked for", () => {
  test("the update payload is assembled conditionally", () => {
    // The bug was a single object literal: .update({ title, metadata, ... }).
    // `metadata` must be attached behind a flag check instead.
    expect(SRC).toMatch(/if \(sets\.length \|\| unsets\.length\) update\.metadata = metadata;/);
  });

  test("no unconditional metadata key survives in the update call", () => {
    const call = SRC.slice(SRC.indexOf(".update("), SRC.indexOf(".eq(\"id\", documentId)"));
    expect(call).not.toMatch(/\{[^}]*\bmetadata\b[^}]*\}/);
  });
});

describe("document edit: non-object metadata is refused, not spread", () => {
  test("the guard runs before the spread", () => {
    const guard = SRC.indexOf("refusing to patch it");
    const spread = SRC.indexOf("{ ...(stored ?? {}) }");
    expect(guard).toBeGreaterThan(-1);
    expect(spread).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(spread);
  });

  test("arrays are caught too, since typeof [] is 'object'", () => {
    expect(SRC).toMatch(/typeof stored !== "object" \|\| Array\.isArray\(stored\)/);
  });

  test("the error names the repair path, including --replace", () => {
    // Without --replace the repair is a no-op on exactly these rows: the RPC
    // merges with `stored || patch`, and Postgres treats a non-object left
    // side as an array, so the result is another non-object value.
    expect(SRC).toContain("cerefox document set-metadata");
    expect(SRC).toContain("--replace");
  });
});

describe("cerefox_ingest_document refuses non-object metadata", () => {
  test("the guard exists inside the ingest function", () => {
    expect(ingestFunctionBody()).toMatch(
      /p_metadata IS NOT NULL AND jsonb_typeof\(p_metadata\) <> 'object'/,
    );
  });

  test("it raises invalid_parameter_value, not a bare exception", () => {
    const body = ingestFunctionBody();
    const guard = body.slice(body.indexOf("jsonb_typeof(p_metadata)"));
    expect(guard.slice(0, guard.indexOf("END IF;"))).toContain("22023");
  });

  test("NULL metadata stays legal, because it means 'not provided'", () => {
    // The update branch coalesces to the stored value and the create branch to
    // '{}'; a guard that rejected NULL would break every partial update.
    const body = ingestFunctionBody();
    expect(body).toContain("metadata = COALESCE(p_metadata, metadata)");
    expect(body).toMatch(/p_metadata IS NOT NULL AND/);
  });
});
