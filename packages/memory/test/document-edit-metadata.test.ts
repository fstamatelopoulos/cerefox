/**
 * Unit tests for `document edit`'s metadata patch core (#212).
 *
 * The bug: a JS spread over jsonb metadata DECOMPOSES non-object values — a
 * stored string becomes one key per character, a number becomes {} — and the
 * result was written back unconditionally with "✓ Edited" on top. Pure
 * function, no DB.
 */

import { describe, expect, test } from "bun:test";

import { patchMetadata } from "../src/cli/commands/document-edit.ts";

const DOC = "11111111-2222-3333-4444-555555555555";

describe("patchMetadata (#212)", () => {
  test("patches an object: sets overwrite, unsets remove, rest preserved", () => {
    const out = patchMetadata({ a: "1", b: "2", c: "3" }, [["b", "20"], ["d", "4"]], ["c"], DOC);
    expect(out).toEqual({ a: "1", b: "20", d: "4" });
  });

  test("null/undefined stored metadata starts from empty", () => {
    expect(patchMetadata(null, [["k", "v"]], [], DOC)).toEqual({ k: "v" });
    expect(patchMetadata(undefined, [], ["x"], DOC)).toEqual({});
  });

  test("REFUSES a stored string instead of decomposing it into 86 keys", () => {
    const stored = '{"content_type": "session-context", "date": "2026-03-30"}'; // a JSON *string* in jsonb
    expect(() => patchMetadata(stored, [["note", "hello"]], [], DOC)).toThrow(/non-object metadata \(string\)/);
    expect(() => patchMetadata(stored, [["note", "hello"]], [], DOC)).toThrow(/set-metadata.*--replace/);
  });

  test("REFUSES arrays and numbers (silent-wipe shapes)", () => {
    expect(() => patchMetadata(["a", "b"], [["k", "v"]], [], DOC)).toThrow(/non-object metadata \(array\)/);
    expect(() => patchMetadata(42, [["k", "v"]], [], DOC)).toThrow(/non-object metadata \(number\)/);
    expect(() => patchMetadata(true, [["k", "v"]], [], DOC)).toThrow(/non-object metadata \(boolean\)/);
  });

  test("the refusal names the repair command with the document id", () => {
    try {
      patchMetadata("oops", [], ["k"], DOC);
      expect.unreachable();
    } catch (e) {
      expect(String(e)).toContain(`cerefox document set-metadata ${DOC} --replace`);
    }
  });
});
