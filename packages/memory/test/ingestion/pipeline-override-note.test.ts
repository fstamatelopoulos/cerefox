/**
 * The "update_if_exists flag was overridden" note on an update by document_id
 * (#301). It names a flag the caller SET to false and that document_id then
 * overrode. It used to fire whenever the flag was not true, including when it
 * was never sent, so every update by id carried a warning. The route test in
 * web-api-contract.test.ts checks that "not sent" reaches the pipeline as
 * undefined; this checks what the pipeline makes of each value.
 */

import { describe, expect, test } from "bun:test";

import { updateByIdNote } from "../../src/ingestion/pipeline.ts";

describe("update by document_id: the override note", () => {
  test("absent when update_if_exists was not sent", () => {
    expect(updateByIdNote(undefined)).toBeUndefined();
  });
  test("absent when update_if_exists was true", () => {
    expect(updateByIdNote(true)).toBeUndefined();
  });
  test("present when the caller explicitly sent false", () => {
    expect(updateByIdNote(false)).toContain("update_if_exists flag was overridden");
  });
});
