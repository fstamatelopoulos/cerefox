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
  test("reports what it dropped, so callers can say so", () => {
    const rows = [row("big", 5_000, 1), row("small", 10, 0.5)];
    const out = applyByteBudget(rows, 1_000);
    expect(out.accepted).toEqual([]);
    // Before #254 this information did not exist and the caller could only
    // see an empty array.
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
