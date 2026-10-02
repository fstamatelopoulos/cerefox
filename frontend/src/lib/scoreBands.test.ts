import { describe, expect, test } from "bun:test";

import { displayScore, isRelativeScale, scoreTone } from "./scoreBands";

describe("score ring tones", () => {
  test("OpenAI bands: strong from 0.55, typical from 0.35", () => {
    expect(scoreTone(0.56, { embedder: "openai" })).toBe("strong");
    expect(scoreTone(0.55, { embedder: "openai" })).toBe("strong");
    expect(scoreTone(0.4, { embedder: "openai" })).toBe("typical");
    expect(scoreTone(0.3, { embedder: "openai" })).toBe("weak");
  });

  test("the local model's higher scale gets higher bands, so 0.56 is only typical there", () => {
    expect(scoreTone(0.56, { embedder: "local" })).toBe("typical");
    expect(scoreTone(0.7, { embedder: "local" })).toBe("strong");
    expect(scoreTone(0.4, { embedder: "local" })).toBe("weak");
  });

  test("below confidence dims a result whatever its score", () => {
    expect(scoreTone(0.9, { embedder: "openai", belowConfidence: true })).toBe("dim");
  });

  test("an unknown embedder (older server) falls back to the OpenAI bands", () => {
    expect(scoreTone(0.56, {})).toBe("strong");
  });

  test("keyword mode ranks against the list's best", () => {
    expect(isRelativeScale("fts", 0.8)).toBe(true);
    expect(displayScore(2, 4, true)).toBe(0.5);
    expect(scoreTone(0.75, { relative: true })).toBe("strong");
  });

  test("bounded modes show the score itself, not relative to the top", () => {
    expect(isRelativeScale("docs", 0.62)).toBe(false);
    expect(displayScore(0.31, 0.62, false)).toBe(0.31);
  });

  test("a pre-0.18 server (scores above 1) is still rescaled", () => {
    expect(isRelativeScale("docs", 2.1)).toBe(true);
  });
});
