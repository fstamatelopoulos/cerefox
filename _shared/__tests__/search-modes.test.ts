/**
 * Every `cerefox_search` mode runs its own RPC, and no other value is
 * accepted (#377).
 *
 * Until 1.25.0 the tool advertised `semantic` as "vector-only" but branched
 * only on `fts` and `hybrid`: `semantic`, and any typo, fell through to
 * `cerefox_search_docs`, the default document search, and the caller never
 * learned its argument had been ignored. The web UI and `/api/v1` ran
 * `semantic` properly, and the CLI did not offer it. One list now
 * (`SEARCH_MODES`) feeds all three, and this pins each mode to its RPC.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { TOOLS_BY_NAME } from "../mcp-tools/index.ts";
import { parseSearchMode, SEARCH_MODES } from "../mcp-tools/search.ts";
import type { MCPSupabaseClient, ToolContext } from "../mcp-tools/types.ts";

const ctx = { accessPath: "local-mcp", openaiApiKey: "test-key" } as ToolContext;
const search = TOOLS_BY_NAME["cerefox_search"];

const originalFetch = globalThis.fetch;
beforeAll(() => {
  // Every mode but fts embeds the query; any request gets a zero vector.
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: [{ embedding: Array(768).fill(0) }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

function recorder(rows: unknown[] = []) {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      return { data: name === "cerefox_log_usage" ? null : rows, error: null };
    },
  } as unknown as MCPSupabaseClient;
  return { client, searchCall: () => calls.find((c) => c.name !== "cerefox_log_usage") };
}

const EXPECTED_RPC: Record<string, string> = {
  docs: "cerefox_search_docs",
  hybrid: "cerefox_hybrid_search",
  fts: "cerefox_fts_search",
  semantic: "cerefox_semantic_search",
};

describe("each search mode runs its own RPC (#377)", () => {
  test("the table covers every mode the tool advertises", () => {
    const schemaEnum = (search.inputSchema as { properties: { mode: { enum: string[] } } }).properties.mode.enum;
    expect([...schemaEnum].sort()).toEqual(Object.keys(EXPECTED_RPC).sort());
    expect([...SEARCH_MODES].sort() as string[]).toEqual(Object.keys(EXPECTED_RPC).sort());
  });

  for (const [mode, rpc] of Object.entries(EXPECTED_RPC)) {
    test(`mode "${mode}" calls ${rpc}`, async () => {
      const r = recorder();
      await search.handler(r.client, { query: "anything", mode }, ctx);
      expect(r.searchCall()?.name).toBe(rpc);
    });
  }

  test("no mode at all is the docs search", async () => {
    const r = recorder();
    await search.handler(r.client, { query: "anything" }, ctx);
    expect(r.searchCall()?.name).toBe("cerefox_search_docs");
  });

  test("semantic sends only what the vector search takes", async () => {
    const r = recorder();
    await search.handler(
      r.client,
      { query: "anything", mode: "semantic", match_count: 7, alpha: 0.2, metadata_filter: { type: "note" } },
      ctx,
    );
    const params = r.searchCall()!.params;
    expect(Object.keys(params).sort()).toEqual(
      ["p_match_count", "p_metadata_filter", "p_project_id", "p_query_embedding", "p_use_upgrade"].sort(),
    );
    expect(params.p_match_count).toBe(7);
    expect(params.p_metadata_filter).toEqual({ type: "note" });
    // No similarity floor unless the caller names one, as the web UI and the API do.
    expect("p_min_score" in params).toBe(false);
  });

  test("semantic passes an explicit min_score through", async () => {
    const r = recorder();
    await search.handler(r.client, { query: "anything", mode: "semantic", min_score: 0.4 }, ctx);
    expect(r.searchCall()!.params.p_min_score).toBe(0.4);
  });

  test("semantic renders chunks, like hybrid", async () => {
    const r = recorder([
      {
        chunk_id: "c1",
        document_id: "d1",
        chunk_index: 3,
        title: "Retry policy",
        content: "SEMANTIC CHUNK BODY",
        heading_path: ["Ops Notes", "Retry policy"],
        score: 0.81,
        doc_title: "Ops Notes",
      },
    ]);
    const out = await search.handler(r.client, { query: "anything", mode: "semantic" }, ctx);
    expect(out).toContain("## Ops Notes › Retry policy");
    expect(out).toContain("SEMANTIC CHUNK BODY");
    expect(out).toContain("(chunk 3)");
  });
});

describe("an unknown mode is refused, not run as the docs search (#377)", () => {
  for (const bad of ["chunks", "Semantic", "vector", "docs "]) {
    test(`mode ${JSON.stringify(bad)}`, async () => {
      const r = recorder();
      await expect(search.handler(r.client, { query: "anything", mode: bad }, ctx)).rejects.toThrow(
        /is not a search mode: expected one of "docs", "hybrid", "fts", "semantic"/,
      );
      expect(r.searchCall()).toBeUndefined();
    });
  }

  test("content matches still applies to docs only, semantic included", async () => {
    const r = recorder();
    await expect(
      search.handler(r.client, { query: "anything", mode: "semantic", content: "matches" }, ctx),
    ).rejects.toThrow(/applies to mode "docs" only/);
  });

  test("parseSearchMode: the default and the refusals", () => {
    expect(parseSearchMode(undefined)).toBe("docs");
    expect(parseSearchMode("")).toBe("docs");
    expect(parseSearchMode("semantic")).toBe("semantic");
    expect(parseSearchMode("nonsense")).toBeNull();
    expect(parseSearchMode(3)).toBeNull();
  });
});
