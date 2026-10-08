/**
 * `doctor`'s `chunks` row (1.18.0): the scale heads-up for the exact vector
 * scan search has used since the HNSW indexes were dropped (#328).
 */

import { describe, expect, test } from "bun:test";

import { CHUNK_COUNT_WARN_AT, classifyChunkCount } from "../src/cli/util/checks.ts";

describe("classifyChunkCount", () => {
  test("ok up to and including the threshold", () => {
    expect(classifyChunkCount(0)).toMatchObject({ name: "chunks", status: "ok" });
    expect(classifyChunkCount(4_321).detail).toBe("4,321 current chunk(s)");
    expect(classifyChunkCount(CHUNK_COUNT_WARN_AT).status).toBe("ok");
  });

  test("warns past it, with the count and a pointer to the tracking issue", () => {
    const r = classifyChunkCount(CHUNK_COUNT_WARN_AT + 1);
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("100,001");
    expect(r.hint).toContain("issues/328");
  });

  test("the threshold is the measured 100k", () => {
    expect(CHUNK_COUNT_WARN_AT).toBe(100_000);
  });
});
