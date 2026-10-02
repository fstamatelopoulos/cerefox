import { describe, expect, test } from "bun:test";

import { bestConfidentScore, displayScore, isRelativeScale, scoreTone } from "./scoreBands";

describe("score ring tones (relative to the best confident result)", () => {
  test("the best confident result is green whatever its absolute score", () => {
    // A two-word name tops out near 0.4-0.5 even when it is a perfect hit.
    expect(scoreTone(0.39, { best: 0.39 })).toBe("strong");
    expect(scoreTone(0.67, { best: 0.67 })).toBe("strong");
  });

  test("90% of the best is still strong, 60% typical, below that weak", () => {
    expect(scoreTone(0.36, { best: 0.39 })).toBe("strong"); // 92%
    expect(scoreTone(0.32, { best: 0.39 })).toBe("typical"); // 82%
    expect(scoreTone(0.2, { best: 0.39 })).toBe("weak"); // 51%
  });

  test("below confidence dims a result whatever its score", () => {
    expect(scoreTone(0.9, { best: 0.9, belowConfidence: true })).toBe("dim");
  });

  test("when nothing is confident, everything is dim", () => {
    const rows = [
      { score: 0.48, belowConfidence: true },
      { score: 0.4, belowConfidence: true },
    ];
    const best = bestConfidentScore(rows);
    expect(best).toBe(0);
    expect(rows.map((r) => scoreTone(r.score, { best, belowConfidence: r.belowConfidence }))).toEqual(["dim", "dim"]);
  });

  test("below-confidence rows do not set the reference", () => {
    expect(bestConfidentScore([{ score: 0.6, belowConfidence: true }, { score: 0.4, belowConfidence: false }])).toBe(0.4);
  });
});

describe("what the ring shows", () => {
  test("bounded modes show the absolute score", () => {
    expect(isRelativeScale("docs", 0.62)).toBe(false);
    expect(displayScore(0.39, 0.62, false)).toBe(0.39);
  });

  test("keyword mode and pre-0.18 servers show the score relative to the best", () => {
    expect(isRelativeScale("fts", 0.8)).toBe(true);
    expect(isRelativeScale("docs", 2.1)).toBe(true);
    expect(displayScore(2, 4, true)).toBe(0.5);
  });
});
