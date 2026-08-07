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
  // Retired in v1.1.0: the coverage gate is the store's policy, so the client
  // omits the parameter and cerefox_config resolves it for every access path.
  test("a set value is ignored — the store's config governs", () => {
    process.env[KEY] = "0.3";
    expect(getMinTermCoverage()).toBeUndefined();
  });
  test("out-of-range / junk → undefined", () => {
    process.env[KEY] = "1.5";
    expect(getMinTermCoverage()).toBeUndefined();
    process.env[KEY] = "abc";
    expect(getMinTermCoverage()).toBeUndefined();
  });
});

describe("getSearchAlpha — retired env override (v1.1.0)", () => {
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

  // Retired in v1.1.0. Retrieval tuning describes the store, so it lives in
  // cerefox_config and one value governs every access path. A client variable
  // that could change ranking for one caller and not another was the bug.
  test("process.env no longer overrides", () => {
    process.env[KEY] = "0.25";
    expect(getSearchAlpha()).toBe(DEFAULT_SEARCH_ALPHA);
  });

  // Same reasoning for the Edge Function path: a Function secret overriding the
  // store's policy is the identical category error, just hosted elsewhere.
  test("Deno.env (Edge Function secrets) no longer overrides either", () => {
    delete process.env[KEY];
    (globalThis as { Deno?: unknown }).Deno = {
      env: { get: (k: string) => (k === KEY ? "0.9" : undefined) },
    };
    expect(getSearchAlpha()).toBe(DEFAULT_SEARCH_ALPHA);
  });
});
