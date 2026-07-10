/**
 * Unit tests for the iter-28D Phase 0 embedding-input cap. The cap prevents an
 * oversized keep-whole chunk from exceeding the model's token limit (which would
 * fail the ingest); the full content is still stored, only the embedding uses a
 * prefix.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  capEmbeddingInput,
  DEFAULT_EMBED_MAX_INPUT_CHARS,
  embeddingMaxInputChars,
} from "../embeddings/index.ts";

const ENV_KEY = "CEREFOX_EMBED_MAX_INPUT_CHARS";
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
});
afterEach(() => {
  if (saved === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = saved;
});

describe("embeddingMaxInputChars", () => {
  test("defaults when unset/invalid", () => {
    expect(embeddingMaxInputChars()).toBe(DEFAULT_EMBED_MAX_INPUT_CHARS);
    process.env[ENV_KEY] = "0";
    expect(embeddingMaxInputChars()).toBe(DEFAULT_EMBED_MAX_INPUT_CHARS);
    process.env[ENV_KEY] = "-5";
    expect(embeddingMaxInputChars()).toBe(DEFAULT_EMBED_MAX_INPUT_CHARS);
    process.env[ENV_KEY] = "notanumber";
    expect(embeddingMaxInputChars()).toBe(DEFAULT_EMBED_MAX_INPUT_CHARS);
  });

  test("honours a valid override", () => {
    process.env[ENV_KEY] = "1234";
    expect(embeddingMaxInputChars()).toBe(1234);
  });
});

describe("capEmbeddingInput", () => {
  test("passes through inputs at or under the cap unchanged", () => {
    process.env[ENV_KEY] = "10";
    expect(capEmbeddingInput("")).toBe("");
    expect(capEmbeddingInput("abc")).toBe("abc");
    expect(capEmbeddingInput("0123456789")).toBe("0123456789"); // exactly 10
  });

  test("truncates an over-cap input to the cap length", () => {
    process.env[ENV_KEY] = "10";
    const out = capEmbeddingInput("0123456789ABCDEF");
    expect(out).toBe("0123456789");
    expect(out.length).toBe(10);
  });

  test("normal-sized chunks are never touched (default cap)", () => {
    const chunk = "x".repeat(2000); // ~ max_chunk_chars
    expect(capEmbeddingInput(chunk)).toBe(chunk);
  });

  test("a huge keep-whole chunk is truncated to the default cap", () => {
    const huge = "y".repeat(DEFAULT_EMBED_MAX_INPUT_CHARS + 5000);
    const out = capEmbeddingInput(huge);
    expect(out.length).toBe(DEFAULT_EMBED_MAX_INPUT_CHARS);
  });

  test("never leaves a dangling high surrogate at the cut boundary", () => {
    process.env[ENV_KEY] = "5";
    // "abcd" + "𝟙" (astral, surrogate pair) — cutting at 5 would split the pair;
    // the cap must drop the lone high surrogate → length 4, still valid UTF-16.
    const out = capEmbeddingInput("abcd\u{1D7D9}");
    expect(out).toBe("abcd");
    // no unpaired surrogate remains
    for (let i = 0; i < out.length; i++) {
      const c = out.charCodeAt(i);
      expect(c >= 0xd800 && c <= 0xdbff).toBe(false);
    }
  });

  test("keeps a complete surrogate pair that fits under the cap", () => {
    process.env[ENV_KEY] = "6";
    const out = capEmbeddingInput("abcd\u{1D7D9}ef"); // 'abcd' + pair(2 units) = 6 units
    expect(out).toBe("abcd\u{1D7D9}");
  });
});
