/**
 * 28I (v1.0.3): below-confidence annotation in the cerefox_search MCP tool.
 *
 * The RPC layer returns best-effort top candidates flagged
 * `below_confidence: true` when nothing clears the relevance threshold
 * (instead of an empty set, which agents misread as "this knowledge does
 * not exist"). These tests pin the tool-handler formatting: the warning
 * banner appears exactly when EVERY row is flagged, and never otherwise.
 *
 * OpenAI is stubbed at the fetch layer (same pattern as
 * embeddings-batching.test.ts); Supabase is a minimal mock client.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { TOOLS_BY_NAME } from "../mcp-tools/index.ts";
import type { MCPSupabaseClient, ToolContext } from "../mcp-tools/types.ts";

const FAKE_CTX: ToolContext = {
  openaiApiKey: "test-key",
  accessPath: "local-mcp",
} as ToolContext;

const originalFetch = globalThis.fetch;

beforeAll(() => {
  // Any embedding request gets a zero vector — scores are irrelevant here;
  // the mock RPC decides what comes back.
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ data: [{ embedding: Array(768).fill(0) }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

function clientReturning(rows: unknown[]): MCPSupabaseClient {
  return {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        order: () => chain,
        limit: () => ({ data: [], error: null }),
        maybeSingle: () => ({ data: null, error: null }),
      };
      return chain;
    },
    rpc: (name: string) =>
      name === "cerefox_log_usage"
        ? { data: null, error: null }
        : { data: rows, error: null },
  } as unknown as MCPSupabaseClient;
}

const row = (over: Record<string, unknown>) => ({
  document_id: "00000000-0000-0000-0000-000000000001",
  doc_title: "Doc",
  full_content: "body",
  best_score: 0.31,
  is_partial: false,
  chunk_count: 1,
  total_chars: 4,
  content_hash: "h",
  below_confidence: false,
  ...over,
});

describe("cerefox_search below-confidence annotation (28I)", () => {
  const tool = TOOLS_BY_NAME["cerefox_search"];

  test("all rows flagged → warning banner with candidate count", async () => {
    const out = (await tool.handler(
      clientReturning([
        row({ below_confidence: true, doc_title: "A" }),
        row({ below_confidence: true, doc_title: "B", best_score: 0.22 }),
      ]),
      { query: "unmatched concept terms" },
      FAKE_CTX,
    )) as string;
    expect(out).toContain("No results cleared the confidence threshold");
    expect(out).toContain("closest 2 candidate(s)");
    // Scores stay visible so the caller can judge.
    expect(out).toContain("(score: 0.310)");
    expect(out).toContain("(score: 0.220)");
    // Content still delivered.
    expect(out).toContain("## A");
    expect(out).toContain("## B");
  });

  test("normal results → no banner", async () => {
    const out = (await tool.handler(
      clientReturning([row({}), row({ doc_title: "C" })]),
      { query: "normal query" },
      FAKE_CTX,
    )) as string;
    expect(out).not.toContain("confidence threshold");
    expect(out).toContain("## Doc");
  });

  test("legacy rows without the flag (older server) → no banner", async () => {
    const legacy = row({});
    delete (legacy as Record<string, unknown>).below_confidence;
    const out = (await tool.handler(
      clientReturning([legacy]),
      { query: "query against pre-0.9.0 schema" },
      FAKE_CTX,
    )) as string;
    expect(out).not.toContain("confidence threshold");
  });

  test("truly empty → unchanged 'No results found.'", async () => {
    const out = (await tool.handler(
      clientReturning([]),
      { query: "nothing at all" },
      FAKE_CTX,
    )) as string;
    expect(out).toBe("No results found.");
  });
});

describe("getMinTermCoverage env parsing (v1.0.4)", () => {
  const { getMinTermCoverage } = require("../mcp-tools/_utils.ts");
  const KEY = "CEREFOX_MIN_TERM_COVERAGE";
  const prior = process.env[KEY];
  afterAll(() => {
    if (prior === undefined) delete process.env[KEY];
    else process.env[KEY] = prior;
  });

  test("unset → undefined (param omitted; server default rules)", () => {
    delete process.env[KEY];
    expect(getMinTermCoverage()).toBeUndefined();
  });
  test("valid value parses", () => {
    process.env[KEY] = "0.3";
    expect(getMinTermCoverage()).toBe(0.3);
  });
  test("out-of-range / junk → undefined", () => {
    process.env[KEY] = "1.5";
    expect(getMinTermCoverage()).toBeUndefined();
    process.env[KEY] = "abc";
    expect(getMinTermCoverage()).toBeUndefined();
  });
});

describe("getSearchAlpha + Deno.env fallback (v1.0.6)", () => {
  const { getSearchAlpha, DEFAULT_SEARCH_ALPHA } = require("../mcp-tools/_utils.ts");
  const KEY = "CEREFOX_SEARCH_ALPHA";
  const prior = process.env[KEY];
  afterAll(() => {
    if (prior === undefined) delete process.env[KEY];
    else process.env[KEY] = prior;
    delete (globalThis as { Deno?: unknown }).Deno;
  });

  test("unset → the built-in default", () => {
    delete process.env[KEY];
    expect(getSearchAlpha()).toBe(DEFAULT_SEARCH_ALPHA);
  });

  test("valid env value wins", () => {
    process.env[KEY] = "0.25";
    expect(getSearchAlpha()).toBe(0.25);
  });

  test("out-of-range falls back to the default", () => {
    process.env[KEY] = "7";
    expect(getSearchAlpha()).toBe(DEFAULT_SEARCH_ALPHA);
  });

  test("Deno.env is read when process.env has nothing (Edge Function secrets)", () => {
    delete process.env[KEY];
    (globalThis as { Deno?: unknown }).Deno = {
      env: { get: (k: string) => (k === KEY ? "0.9" : undefined) },
    };
    expect(getSearchAlpha()).toBe(0.9);
  });

  test("process.env still wins over Deno.env", () => {
    process.env[KEY] = "0.1";
    (globalThis as { Deno?: unknown }).Deno = {
      env: { get: () => "0.9" },
    };
    expect(getSearchAlpha()).toBe(0.1);
  });
});
