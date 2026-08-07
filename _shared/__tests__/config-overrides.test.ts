/**
 * Tests for the `.env` config overrides restored after the Python→TS migration,
 * plus a guard against future "phantom config" drift: every CEREFOX_/OPENAI_ var
 * documented in `.env.example` must actually be read somewhere in the TS source.
 * This is the cheap, non-brittle way to catch migration gaps (vs. diffing the old
 * Python against the current TS).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getMaxResponseBytes, getMinSearchScore } from "../mcp-tools/_utils.ts";
import { openaiEmbeddingConfig } from "../embeddings/index.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const TOUCHED = [
  "CEREFOX_MIN_SEARCH_SCORE",
  "CEREFOX_MAX_RESPONSE_BYTES",
  "CEREFOX_OPENAI_BASE_URL",
  "CEREFOX_OPENAI_EMBEDDING_MODEL",
  "CEREFOX_OPENAI_EMBEDDING_DIMENSIONS",
  "CEREFOX_EMBEDDER",
];

function clear() {
  for (const k of TOUCHED) delete process.env[k];
}
beforeEach(clear);
afterEach(clear);

describe("getMinSearchScore", () => {
  it("defaults to 0.5", () => expect(getMinSearchScore()).toBe(0.5));

  // Retired in v1.1.0. The similarity floor depends on which embedder produced
  // the vectors, and the embedder belongs to the STORE — every client querying
  // one database must use the same one. So the value lives in cerefox_config,
  // and a client-side variable must NOT be able to make search behave
  // differently depending on who asked.
  it("ignores CEREFOX_MIN_SEARCH_SCORE — the store's config governs", () => {
    process.env.CEREFOX_MIN_SEARCH_SCORE = "0.7";
    expect(getMinSearchScore()).toBe(0.5);
  });

  // Still keyed on the embedder: this is the built-in fallback used when the
  // store has expressed no preference, not an override of one.
  it("still uses the higher local-embedder default", () => {
    process.env.CEREFOX_EMBEDDER = "local";
    expect(getMinSearchScore()).toBe(0.6);
  });
});

describe("getMaxResponseBytes", () => {
  it("defaults to 200000", () => expect(getMaxResponseBytes()).toBe(200_000));
  it("honors a valid override", () => {
    process.env.CEREFOX_MAX_RESPONSE_BYTES = "50000";
    expect(getMaxResponseBytes()).toBe(50_000);
  });
  it("falls back on non-positive or non-numeric values", () => {
    process.env.CEREFOX_MAX_RESPONSE_BYTES = "0";
    expect(getMaxResponseBytes()).toBe(200_000);
    process.env.CEREFOX_MAX_RESPONSE_BYTES = "x";
    expect(getMaxResponseBytes()).toBe(200_000);
  });
});

describe("openaiEmbeddingConfig", () => {
  it("defaults to the built-in OpenAI model/url/dims", () => {
    const c = openaiEmbeddingConfig();
    expect(c.url).toBe("https://api.openai.com/v1/embeddings");
    expect(c.model).toBe("text-embedding-3-small");
    expect(c.dimensions).toBe(768);
  });
  it("honors base-url + model overrides; strips a trailing slash", () => {
    process.env.CEREFOX_OPENAI_BASE_URL = "https://proxy.example/v1/";
    process.env.CEREFOX_OPENAI_EMBEDDING_MODEL = "text-embedding-3-large";
    const c = openaiEmbeddingConfig();
    expect(c.url).toBe("https://proxy.example/v1/embeddings");
    expect(c.model).toBe("text-embedding-3-large");
  });
  it("falls back to 768 dims on a bad value", () => {
    process.env.CEREFOX_OPENAI_EMBEDDING_DIMENSIONS = "0";
    expect(openaiEmbeddingConfig().dimensions).toBe(768);
  });
});

describe("no phantom config (every documented var is read by the TS code)", () => {
  // Vars documented in .env.example but deliberately not wired in the TS runtime yet.
  const ALLOW_UNWIRED = new Set<string>([
    "CEREFOX_EMBEDDER", // OpenAI-only in TS; provider selection not implemented
    "CEREFOX_FIREWORKS_EMBEDDING_MODEL", // Fireworks embedder not implemented in TS
  ]);

  const example = readFileSync(join(REPO_ROOT, ".env.example"), "utf8");
  const vars = [
    ...new Set(
      [...example.matchAll(/^#?\s*(CEREFOX_[A-Z_]+|OPENAI_[A-Z_]+)=/gm)].map((m) => m[1]),
    ),
  ];

  it("finds at least a dozen documented vars (sanity)", () => {
    expect(vars.length).toBeGreaterThan(12);
  });

  for (const v of vars) {
    if (ALLOW_UNWIRED.has(v)) continue;
    it(`${v} is referenced in the TS source`, () => {
      let found = false;
      try {
        execSync(`grep -rqE "${v}" _shared packages/memory/src supabase`, { cwd: REPO_ROOT });
        found = true;
      } catch {
        found = false;
      }
      expect(found).toBe(true);
    });
  }
});
