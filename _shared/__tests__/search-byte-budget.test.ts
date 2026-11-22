/**
 * A search that matched must never report that it found nothing (#254).
 *
 * `cerefox_search` returns whole documents, and the byte budget drops whole
 * rows. When the top-ranked document was larger than `max_bytes` the first
 * row was dropped, the result set came back empty, and the handler answered
 * the literal string "No results found." — while the caller's own web UI,
 * which has no budget, showed the document at the top of the list.
 *
 * That is the most damaging answer this tool can give. An agent that reads
 * "no results" stops searching and often re-creates the document it failed to
 * find, so the store grows a duplicate and the original stays unfound. It is
 * the same failure iteration 28I addressed from the other direction, where a
 * weak match was reported as an empty set instead of a low-scoring one.
 *
 * These tests pin the contract: empty only when nothing matched.
 */

import { describe, expect, test } from "bun:test";

import { applyByteBudget } from "../mcp-tools/_utils.ts";
import { rowContent } from "../mcp-tools/search.ts";
import { TOOLS_BY_NAME } from "../mcp-tools/index.ts";
import type { MCPSupabaseClient, ToolContext } from "../mcp-tools/types.ts";

const ctx = { accessPath: "local-mcp", openaiApiKey: "" } as ToolContext;
const search = TOOLS_BY_NAME["cerefox_search"];

/** A document row of a given content size, as the search RPCs return them. */
function row(title: string, chars: number, score: number) {
  return {
    document_id: `id-${title}`,
    doc_title: title,
    full_content: "x".repeat(chars),
    best_score: score,
    chunk_count: 1,
    total_chars: chars,
    content_hash: `hash-${title}`,
  };
}

/** A client that answers every RPC with the given rows. */
function clientReturning(rows: unknown[]): MCPSupabaseClient {
  return {
    rpc: async (name: string) => {
      if (name === "cerefox_log_usage") return { data: null, error: null };
      return { data: rows, error: null };
    },
  } as unknown as MCPSupabaseClient;
}

const args = (over: Record<string, unknown> = {}) => ({
  query: "anything",
  mode: "fts", // no embedding, so no OpenAI key is needed
  ...over,
});

describe("applyByteBudget", () => {
  test("an oversized top hit is skipped, not the end of the list", () => {
    const rows = [row("big", 5_000, 1), row("small", 10, 0.5)];
    const out = applyByteBudget(rows, 1_000);
    // Until #268 this returned NOTHING: the scan stopped at the first row that
    // did not fit, so one oversized top hit suppressed every smaller result
    // behind it and the Edge Function then reported that nothing fitted. The
    // MCP tool has skipped since #266; this is the same rule on the surface
    // GPT Actions and direct HTTP callers use.
    expect((out.accepted as Array<{ doc_title: string }>).map((r) => r.doc_title)).toEqual([
      "small",
    ]);
    // Before #254 this information did not exist and the caller could only
    // see an empty array.
    expect((out.dropped as Array<{ doc_title: string }>).map((r) => r.doc_title)).toEqual([
      "big",
    ]);
    expect(out.truncated).toBe(true);
  });

  test("nothing fits at all: everything is dropped, and said so", () => {
    const rows = [row("big", 5_000, 1), row("bigger", 6_000, 0.5)];
    const out = applyByteBudget(rows, 1_000);
    expect(out.accepted).toEqual([]);
    expect(out.dropped).toEqual(rows);
    expect(out.truncated).toBe(true);
  });

  test("a partial fit reports exactly the remainder", () => {
    const rows = [row("small", 10, 1), row("big", 5_000, 0.5)];
    const out = applyByteBudget(rows, 500);
    expect(out.accepted).toHaveLength(1);
    expect(out.dropped).toHaveLength(1);
    expect((out.dropped[0] as { doc_title: string }).doc_title).toBe("big");
  });

  test("everything fitting means nothing dropped and no truncation", () => {
    const rows = [row("a", 10, 1), row("b", 10, 0.5)];
    const out = applyByteBudget(rows, 100_000);
    expect(out.accepted).toHaveLength(2);
    expect(out.dropped).toEqual([]);
    expect(out.truncated).toBe(false);
  });
});

/** A chunk row, as `cerefox_hybrid_search` and `cerefox_fts_search` return one. */
function chunkRow(title: string, text: string, score: number) {
  return {
    document_id: `id-${title}`,
    chunk_id: `chunk-${title}`,
    doc_title: title,
    content: text, // NOT full_content: that column belongs to the docs-mode RPC
    heading_path: [title, "Section"],
    score,
  };
}

describe("every search mode renders its own content column (#259)", () => {
  test("a chunk row is not rendered as an empty body", async () => {
    // The docs-mode RPC returns `full_content`; hybrid and fts return
    // `content`. Reading only the first rendered every chunk result as a
    // title with nothing under it, over both MCP transports, for as long as
    // the shared handlers have existed.
    //
    // Only `fts` is exercised here: `hybrid` embeds the query first and would
    // need a live embedder, but it renders through the same code path, and
    // the live Edge Function suite covers all three modes.
    const out = await search.handler(
      supabase([chunkRow("Contact", "CHUNK BODY TEXT", 0.9)]),
      args({ mode: "fts" }),
      ctx,
    );
    expect(out).toContain("## Contact");
    expect(out).toContain("CHUNK BODY TEXT");
  });

  test("the resolver reads either column, and prefers the document one", () => {
    // `args()` pins mode "fts" (every other mode needs an embedder), so the
    // docs-mode branch cannot be exercised through the handler here. Assert
    // the resolver itself rather than a test that only looks like it covers
    // both shapes (#261).
    expect(rowContent({ full_content: "DOC BODY" })).toBe("DOC BODY");
    expect(rowContent({ content: "CHUNK BODY" })).toBe("CHUNK BODY");
    expect(rowContent({ full_content: "DOC", content: "CHUNK" })).toBe("DOC");
    expect(rowContent({})).toBe("");
  });

  test("only the LEADING path element is dropped when it repeats the title", async () => {
    // A section legitimately named after its document must still appear:
    // dropping every matching element produced a breadcrumb that did not
    // match the document's structure (#261).
    const out = await search.handler(
      supabase([
        {
          ...chunkRow("Release Process", "BODY", 0.9),
          heading_path: ["Release Process", "Release Process", "Steps"],
          chunk_index: 2,
        },
      ]),
      args({ mode: "fts" }),
      ctx,
    );
    expect(out).toContain("## Release Process › Release Process › Steps");
  });

  test("the degraded path names sections too, since it is the whole answer", async () => {
    // Five chunks of one document, none fitting: without the section each
    // header line would be the same string (#261).
    const chunks = [0, 1, 2].map((i) => ({
      ...chunkRow("Doc", "z".repeat(20_000), 0.9 - i / 10),
      heading_path: ["Doc", `Section ${i}`],
      chunk_index: i,
    }));
    const out = await search.handler(supabase(chunks), args({ mode: "fts", max_bytes: 2_000 }), ctx);
    expect(out).toContain("Doc › Section 0");
    expect(out).toContain("Doc › Section 1");
    expect(out).toContain("Doc › Section 2");
  });

  test("a chunk result names its section, not just the document", async () => {
    // Chunk RPCs return several chunks OF THE SAME document, so identical
    // headings would leave an agent unable to tell them apart (#261).
    const out = await search.handler(
      supabase([
        // heading_path as the RPC returns it: document title first.
        { ...chunkRow("Doc", "FIRST", 0.9), heading_path: ["Doc", "Intro"], chunk_index: 0 },
        { ...chunkRow("Doc", "SECOND", 0.8), heading_path: ["Doc", "Details"], chunk_index: 4 },
        // No heading at all: the index is what tells the two apart.
        { ...chunkRow("Doc", "THIRD", 0.7), heading_path: [], title: "", chunk_index: 9 },
      ]),
      args({ mode: "fts" }),
      ctx,
    );
    // The document title is not repeated, and each block names its section.
    expect(out).toContain("## Doc › Intro");
    expect(out).toContain("## Doc › Details");
    expect(out).not.toContain("Doc › Doc");
    expect(out).toContain("(chunk 0)");
    expect(out).toContain("(chunk 9)");
    expect(out).toContain("FIRST");
    expect(out).toContain("SECOND");
    expect(out).toContain("THIRD");
  });

  test("a chunk row too large for the budget degrades instead of vanishing", async () => {
    // The budget always measured `content`; only the renderer ignored it, so
    // a big chunk could empty the result set AND print nothing.
    const out = await search.handler(
      supabase([chunkRow("Big", "y".repeat(30_000), 0.9)]),
      args({ mode: "fts", max_bytes: 2_000 }),
      ctx,
    );
    expect(out).not.toContain("No results found");
    expect(out).toContain("Big");
  });
});

describe("cerefox_search never reports an empty store for a budget miss", () => {
  test("matched but nothing fits: headers, not \"No results found.\"", async () => {
    const supabase = clientReturning([row("Contact - Josh Cohen", 20_000, 2.9)]);
    const out = await search.handler(supabase, args({ max_bytes: 6_000 }), ctx);

    expect(out).not.toContain("No results found");
    // The document, its id and its size: enough to fetch it deliberately.
    expect(out).toContain("Contact - Josh Cohen");
    expect(out).toContain("id-Contact - Josh Cohen");
    expect(out).toContain("20,000 chars");
    // And the reason, stated so an agent does not conclude absence.
    expect(out).toContain("NOT an empty");
    expect(out).toContain("max_bytes=6000");
  });

  test("the degraded response honours the budget it is explaining", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => row(`Doc ${i}`, 9_000, 1 - i / 100));
    const out = await search.handler(supabase(rows), args({ max_bytes: 900 }), ctx);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(
      // The lead sentence alone may exceed a very small budget; what must not
      // happen is listing 40 headers into a 900-byte budget.
      2_000,
    );
    expect(out).not.toContain("No results found");
  });

  test("nothing matched is still reported as nothing", async () => {
    const out = await search.handler(clientReturning([]), args({ max_bytes: 6_000 }), ctx);
    expect(out).toBe("No results found.");
  });

  test("a partial fit names what was held back instead of silently dropping it", async () => {
    const rows = [row("Small", 100, 2), row("Huge", 50_000, 1)];
    const out = await search.handler(supabase(rows), args({ max_bytes: 2_000 }), ctx);
    expect(out).toContain("Small");
    expect(out).toContain("1 of 2 result(s) shown");
    // Naming it is the point: "truncated" alone does not tell you what to ask for.
    expect(out).toContain("Huge");
  });

  test("a degraded response keeps the below-confidence warning (#257)", async () => {
    // 28I exists so weak candidates are not read as real matches. Losing that
    // flag in the degraded path would tell an agent "3 results matched" about
    // rows that cleared no threshold.
    const weak = [row("Maybe Related", 30_000, 0.2)].map((r) => ({
      ...r,
      below_confidence: true,
    }));
    const out = await search.handler(supabase(weak), args({ max_bytes: 1_200 }), ctx);
    expect(out).toContain("confidence threshold");
    expect(out).toContain("Maybe Related");
    expect(out).not.toContain("No results found");
  });

  test("the truncation footer names a bounded number of dropped documents (#257)", async () => {
    // Listing every dropped title made the footer grow with match_count and
    // overrun the budget it was reporting on.
    const rows = [row("Fits", 50, 9), ...Array.from({ length: 40 }, (_, i) => row(`Dropped ${i}`, 9_000, 1))];
    const out = await search.handler(supabase(rows), args({ max_bytes: 3_000 }), ctx);
    expect(out).toContain("1 of 41 result(s) shown");
    expect(out).toContain("and 35 more");
    // Bounded: the footer must not carry all forty titles.
    expect(out).not.toContain("Dropped 39");
  });

  test("everything fitting is unchanged: full content, no notice", async () => {
    const out = await search.handler(supabase([row("Small", 50, 1)]), args(), ctx);
    expect(out).toContain("## Small");
    expect(out).toContain("x".repeat(50));
    expect(out).not.toContain("did not fit");
    expect(out).not.toContain("NOT an empty");
  });
});

function supabase(rows: unknown[]): MCPSupabaseClient {
  return clientReturning(rows);
}
