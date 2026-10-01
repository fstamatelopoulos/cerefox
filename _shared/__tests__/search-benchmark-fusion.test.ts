/**
 * The benchmark's client-side reproduction of hybrid search (iteration 48).
 * The decisive check is the runner's comparison with the live RPC; these pin the
 * rules that comparison depends on, one at a time.
 */

import { describe, expect, test } from "bun:test";

import { bounded, keywordView, linear, raw, rankDocuments, rrf, run, type ChunkSignals } from "../search-benchmark/fusion.ts";

const chunk = (id: string, doc: string, over: Partial<ChunkSignals> = {}): ChunkSignals => ({
  chunk_id: id,
  document_id: doc,
  vec_score: 0.3,
  in_and: false,
  in_or: false,
  rank_and: 0,
  rank_or: 0,
  tokens_matched: 0,
  total_tokens: 2,
  ...over,
});
const gates = { minScore: 0.5, minCoverage: 0.5 };

describe("keywordView", () => {
  test("uses the AND query whenever any chunk matches it", () => {
    const v = keywordView([chunk("a", "A", { in_and: true, rank_and: 2 }), chunk("b", "B", { in_or: true, rank_or: 1 })], 0.5);
    expect(v.map((c) => [c.in_fts, c.fts_raw])).toEqual([[true, 2], [false, 0]]);
  });
  test("falls back to OR with the coverage bar when nothing matches AND", () => {
    const v = keywordView(
      [chunk("a", "A", { in_or: true, rank_or: 1, tokens_matched: 1 }), chunk("b", "B", { in_or: true, rank_or: 1, tokens_matched: 0 })],
      0.5,
    );
    expect(v.map((c) => [c.in_fts, c.coverage_ok])).toEqual([[true, true], [true, false]]);
  });
});

describe("rankDocuments", () => {
  test("a document's score is its best chunk's", () => {
    const view = keywordView([chunk("a1", "A", { vec_score: 0.6 }), chunk("a2", "A", { vec_score: 0.9 })], 0.5);
    const r = rankDocuments(view, linear("cur", 1, gates, raw).score(view), gates, 10);
    expect(r.docs).toEqual([{ document_id: "A", score: 0.9 }]);
  });
  test("nothing passes → best chunk per document, at most 3, flagged below confidence", () => {
    const view = keywordView(["A", "B", "C", "D"].map((d, i) => chunk(d, d, { vec_score: 0.1 + i / 100 })), 0.5);
    const r = rankDocuments(view, linear("cur", 1, gates, raw).score(view), gates, 10);
    expect(r.below_confidence).toBe(true);
    expect(r.docs.map((d) => d.document_id)).toEqual(["D", "C", "B"]);
  });
  test("a covered keyword match passes even with a low vector score", () => {
    const r = run(linear("cur", 0.7, gates, raw), [chunk("a", "A", { in_and: true, rank_and: 3, vec_score: 0.1 })]);
    expect(r.below_confidence).toBe(false);
    expect(r.docs[0]!.score).toBeCloseTo(0.7 * 0.1 + 0.3 * 3);
  });
});

describe("candidates", () => {
  test("bounded keeps the keyword side within [0, 1)", () => {
    expect(bounded(3)).toBeCloseTo(0.75);
    expect(bounded(0)).toBe(0);
  });
  test("RRF adds 1/(k + rank) from each list the chunk appears in", () => {
    const view = keywordView([chunk("a", "A", { vec_score: 0.9, in_and: true, rank_and: 1 }), chunk("b", "B", { vec_score: 0.8 })], 0.5);
    const s = rrf("rrf", 60, gates).score(view);
    expect(s.get("a")).toBeCloseTo(1 / 61 + 1 / 61);
    expect(s.get("b")).toBeCloseTo(1 / 62);
  });
});

describe("the RPC's chunk limit", () => {
  test("a document with no chunk in the first count × 10 never reaches the document level", () => {
    // 20 passing chunks of A outscore B's only chunk; count 2 → chunk limit 20.
    const chunks = [
      ...Array.from({ length: 20 }, (_, i) => chunk(`a${i}`, "A", { vec_score: 0.9 })),
      chunk("b", "B", { vec_score: 0.8 }),
    ];
    const r = run(linear("cur", 1, gates, raw), chunks, 2);
    expect(r.docs.map((d) => d.document_id)).toEqual(["A"]);
  });
});
