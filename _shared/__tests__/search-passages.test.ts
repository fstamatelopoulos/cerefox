/**
 * `cerefox_search` with `content: "matches"` (#375): the same documents as the
 * default docs search, each with only its best-matching passages.
 *
 * The RPC selects the passages (p_passages, p_max_passage_chars, schema
 * 0.23.0); these tests pin what the tool asks for and how it reads the answer:
 * the parameters it sends, the order and labels of what it renders, the note
 * that says what was left out, and the refusal cases. The byte budget over
 * these rows is covered by search-budget-invariant.test.ts.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { TOOLS_BY_NAME } from "../mcp-tools/index.ts";
import type { MCPSupabaseClient, ToolContext } from "../mcp-tools/types.ts";
import { DEFAULT_PASSAGE_CHARS, renderPassagesBody, resolvePassageChars } from "../search-passages/index.ts";

const ctx = { accessPath: "local-mcp", openaiApiKey: "test-key" } as ToolContext;
const search = TOOLS_BY_NAME["cerefox_search"];

const originalFetch = globalThis.fetch;
beforeAll(() => {
  // mode "docs" embeds the query; any request gets a zero vector.
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: [{ embedding: Array(768).fill(0) }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

/** Records every RPC call; answers the search with `rows` (or `error`). */
function recorder(rows: unknown[], error?: { code?: string; message: string }) {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      if (name === "cerefox_log_usage") return { data: null, error: null };
      return error ? { data: null, error } : { data: rows, error: null };
    },
  } as unknown as MCPSupabaseClient;
  const search_ = () => calls.find((c) => c.name !== "cerefox_log_usage")!;
  return { client, calls, search: search_ };
}

const DOC_ID = "550e8400-e29b-41d4-a716-446655440000";

/** A passages row as cerefox_search_docs returns it with p_passages. */
function passagesRow(over: Record<string, unknown> = {}) {
  return {
    document_id: DOC_ID,
    doc_title: "Release Process",
    full_content: null,
    best_score: 0.829,
    chunk_count: 2,
    total_chars: 48_210,
    is_partial: true,
    matched_chunk_count: 6,
    content_hash: "a".repeat(64),
    metadata_revision: 3,
    passages: [
      {
        chunk_index: 7,
        heading_path: ["Release Process", "Cutting", "Tagging"],
        score: 0.95,
        content: "BEST passage text",
        chars: 17,
        truncated: false,
      },
      {
        chunk_index: 2,
        heading_path: ["Release Process", "Checklist"],
        score: 0.8,
        content: "SECOND passage text",
        chars: 19,
        truncated: false,
      },
    ],
    ...over,
  };
}

const args = (over: Record<string, unknown> = {}) => ({ query: "release", mode: "docs", author: "t", ...over });

describe('content: "matches" asks the RPC for passages', () => {
  test("sends p_passages and the default cap to cerefox_search_docs", async () => {
    const r = recorder([passagesRow()]);
    await search.handler(r.client, args({ content: "matches" }), ctx);
    expect(r.search().name).toBe("cerefox_search_docs");
    expect(r.search().params).toMatchObject({ p_passages: true, p_max_passage_chars: DEFAULT_PASSAGE_CHARS });
    // Selection is the RPC's: the tool does not reshape small-to-big itself.
    expect(r.search().params).not.toHaveProperty("p_small_to_big_threshold");
    expect(r.search().params).not.toHaveProperty("p_context_window");
  });

  test("max_passage_chars is passed through, clamped", async () => {
    for (const [given, sent] of [[3000, 3000], [10, 200], [1e9, 20000], ["many", DEFAULT_PASSAGE_CHARS], [812.7, 812]]) {
      const r = recorder([passagesRow()]);
      await search.handler(r.client, args({ content: "matches", max_passage_chars: given }), ctx);
      expect({ given, sent: r.search().params.p_max_passage_chars }).toEqual({ given, sent });
    }
    expect(resolvePassageChars(undefined)).toBe(DEFAULT_PASSAGE_CHARS);
  });

  test('"full" (the default) sends neither parameter', async () => {
    for (const a of [args(), args({ content: "full" })]) {
      const r = recorder([]);
      await search.handler(r.client, a, ctx);
      expect(r.search().params).not.toHaveProperty("p_passages");
      expect(r.search().params).not.toHaveProperty("p_max_passage_chars");
    }
  });

  test("only the caller chooses: no environment setting changes the default", async () => {
    const prev = process.env.CEREFOX_SEARCH_CONTENT;
    process.env.CEREFOX_SEARCH_CONTENT = "matches";
    try {
      const r = recorder([]);
      await search.handler(r.client, args(), ctx);
      expect(r.search().params).not.toHaveProperty("p_passages");
    } finally {
      if (prev === undefined) delete process.env.CEREFOX_SEARCH_CONTENT;
      else process.env.CEREFOX_SEARCH_CONTENT = prev;
    }
  });
});

describe("a passages result is rendered best first, and says what it left out", () => {
  test("each passage under its section and score, in the order the RPC ranked them", async () => {
    const out = await search.handler(recorder([passagesRow()]).client, args({ content: "matches" }), ctx);
    expect(out).toContain("## Release Process [id: " + DOC_ID + "] (score: 0.829) -- 2 of 6 matched passages, 36 of 48,210 chars");
    expect(out).toContain("hash: " + "a".repeat(64) + " · metadata_revision: 3");
    expect(out).toContain("### Cutting › Tagging (score: 0.950)\n\nBEST passage text");
    expect(out).toContain("### Checklist (score: 0.800)\n\nSECOND passage text");
    expect(out.indexOf("BEST")).toBeLessThan(out.indexOf("SECOND"));
  });

  test("the note names how many matched passages were left out and how to read the document", async () => {
    const out = await search.handler(recorder([passagesRow()]).client, args({ content: "matches" }), ctx);
    expect(out).toContain(
      `[At least 4 more matched passages. cerefox_get_document("${DOC_ID}") reads the whole document; ` +
        "with outline: true it lists the sections, and with section it reads one.]",
    );
  });

  test("an excerpt says it is one, and how much of the passage it shows", async () => {
    const row = passagesRow({
      chunk_count: 1,
      matched_chunk_count: 1,
      passages: [{ ...passagesRow().passages[0], content: "around … the terms", chars: 3_975, truncated: true, excerpt: true }],
    });
    const out = await search.handler(recorder([row]).client, args({ content: "matches" }), ctx);
    expect(out).toContain("around … the terms\n\n[… excerpt around the query's terms: 18 of 3,975 chars of this passage]");
  });

  test("a cut passage says how much it held", async () => {
    const row = passagesRow({
      chunk_count: 1,
      matched_chunk_count: 1,
      passages: [{ ...passagesRow().passages[0], content: "opening", chars: 3_410, truncated: true }],
    });
    const out = await search.handler(recorder([row]).client, args({ content: "matches" }), ctx);
    expect(out).toContain(
      "opening\n\n[… passage cut at 7 of 3,410 chars. max_passage_chars is smaller than this chunk, so only its " +
        "opening is shown and the part that matched may be missing: search again with a larger max_passage_chars, " +
        "or read the document as the last note says.]",
    );
    // Nothing else matched, so no "more" count, but the document is still bigger than what is shown.
    expect(out).toContain(`[cerefox_get_document("${DOC_ID}") reads the whole document;`);
  });

  test("the CLI names its own flag in the cut note", () => {
    const row = passagesRow({
      chunk_count: 1,
      matched_chunk_count: 1,
      passages: [{ ...passagesRow().passages[0], content: "opening", chars: 3_410, truncated: true }],
    });
    const out = renderPassagesBody(row, (id) => `cerefox document get ${id}`, "--max-passage-chars");
    expect(out).toContain("--max-passage-chars is smaller than this chunk");
    expect(out).not.toContain("max_passage_chars");
  });

  test("a document the passages hold whole gets no note", async () => {
    const row = passagesRow({ is_partial: false, total_chars: 36, matched_chunk_count: 2 });
    const out = await search.handler(recorder([row]).client, args({ content: "matches" }), ctx);
    expect(out).not.toContain("cerefox_get_document(");
    expect(out).not.toContain("more matched");
  });
});

describe("refusals", () => {
  test("an unknown content value is rejected", async () => {
    await expect(search.handler(recorder([]).client, args({ content: "summary" }), ctx)).rejects.toThrow(
      /content must be/,
    );
  });

  test('content "matches" with a chunk mode is rejected, not ignored', async () => {
    for (const mode of ["hybrid", "fts"]) {
      await expect(search.handler(recorder([]).client, args({ mode, content: "matches" }), ctx)).rejects.toThrow(
        /applies to mode "docs" only/,
      );
    }
  });

  test("a server older than schema 0.23.0 gets a message that says so", async () => {
    const r = recorder([], {
      code: "PGRST202",
      message: "Could not find the function public.cerefox_search_docs(p_max_passage_chars, p_passages, …)",
    });
    await expect(search.handler(r.client, args({ content: "matches" }), ctx)).rejects.toThrow(
      /need server schema 0\.23\.0 or later.*cerefox server deploy.*retry in a minute/,
    );
  });

  test("any other RPC error is reported as it was", async () => {
    const r = recorder([], { code: "XX000", message: "boom" });
    await expect(search.handler(r.client, args({ content: "matches" }), ctx)).rejects.toThrow("RPC error: boom");
  });
});
