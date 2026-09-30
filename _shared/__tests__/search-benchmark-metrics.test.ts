/**
 * The search-calibration benchmark's arithmetic (iteration 48). Every number
 * the calibration decision rests on comes from these functions, so each is
 * checked against a hand-computed value.
 */

import { describe, expect, test } from "bun:test";

import {
  groupConsistency,
  hitAt1,
  jaccardAtK,
  mean,
  ndcgAtK,
  recallAtK,
  reciprocalRank,
} from "../search-benchmark/metrics.ts";

const grades = { a: 2, b: 1, c: 1 };

describe("reciprocalRank", () => {
  test("first grade-2 document at rank 3 → 1/3", () => {
    expect(reciprocalRank(["x", "b", "a"], grades)).toBeCloseTo(1 / 3);
  });
  test("grade-1 documents do not count as the answer", () => {
    expect(reciprocalRank(["b", "c"], grades)).toBe(0);
  });
  test("outside the cut-off → 0", () => {
    expect(reciprocalRank(["x", "y", "a"], grades, 2)).toBe(0);
  });
});

describe("hitAt1", () => {
  test("only a grade-2 top result counts", () => {
    expect(hitAt1(["a", "b"], grades)).toBe(1);
    expect(hitAt1(["b", "a"], grades)).toBe(0);
    expect(hitAt1([], grades)).toBe(0);
  });
});

describe("recallAtK", () => {
  test("share of grade ≥ 1 documents in the top k", () => {
    expect(recallAtK(["a", "x", "c", "y", "z"], grades, 5)).toBeCloseTo(2 / 3);
  });
  test("no relevant documents (a negative query) → 0, not NaN", () => {
    expect(recallAtK(["a"], {})).toBe(0);
  });
});

describe("ndcgAtK", () => {
  test("the ideal order scores 1", () => {
    expect(ndcgAtK(["a", "b", "c"], grades)).toBeCloseTo(1);
  });
  test("hand-computed: answer at rank 2, one related at rank 1", () => {
    // DCG = 1/log2(2) + 3/log2(3) ; IDCG = 3/log2(2) + 1/log2(3) + 1/log2(4)
    const dcg = 1 / 1 + 3 / Math.log2(3);
    const idcg = 3 / 1 + 1 / Math.log2(3) + 1 / 2;
    expect(ndcgAtK(["b", "a"], grades)).toBeCloseTo(dcg / idcg);
  });
  test("nothing relevant anywhere → 0", () => {
    expect(ndcgAtK(["x"], {})).toBe(0);
  });
});

describe("jaccardAtK and groupConsistency", () => {
  test("identical top sets agree fully; disjoint ones not at all", () => {
    expect(jaccardAtK(["a", "b"], ["b", "a"])).toBe(1);
    expect(jaccardAtK(["a"], ["b"])).toBe(0);
  });
  test("partial overlap: |{a,b}| / |{a,b,c,d}| = 0.5", () => {
    expect(jaccardAtK(["a", "b", "c"], ["a", "b", "d"])).toBe(0.5);
  });
  test("only the top k count", () => {
    expect(jaccardAtK(["a", "x"], ["a", "y"], 1)).toBe(1);
  });
  test("mean over every pair of variants", () => {
    // pairs: (1,2)=1, (1,3)=0, (2,3)=0 → 1/3
    expect(groupConsistency([["a"], ["a"], ["b"]])).toBeCloseTo(1 / 3);
  });
  test("two empty result lists agree; a single variant is trivially consistent", () => {
    expect(jaccardAtK([], [])).toBe(1);
    expect(groupConsistency([["a"]])).toBe(1);
  });
});

test("mean of nothing is 0", () => {
  expect(mean([])).toBe(0);
  expect(mean([1, 2, 3])).toBe(2);
});
