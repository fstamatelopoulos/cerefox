/**
 * The one property `max_bytes` promises, checked across the whole space
 * instead of at the two or three points a hand-written case happens to pick.
 *
 * Three separate changes in this release broke it, each time in a new place
 * and each time caught by review rather than by a test:
 *
 *  - #257: the truncation footer named every dropped document, so it grew
 *    with `match_count` and pushed the reply past the budget.
 *  - #261 (fixing #257's other half): naming the SECTION made each footer
 *    entry carry a full heading and a uuid, so the footer grew again.
 *  - #263: that footer was appended after the budget had been spent, so a
 *    reply could exceed it by 40% while reporting on the overrun.
 *
 * Every one of those was an addition to the response that nobody counted.
 * The example-based tests kept passing because they used inputs where the
 * extra bytes happened to fit. This file asserts the invariant itself, so the
 * next addition to the response has to face it.
 *
 * The one documented exception: when a single row is larger than the entire
 * budget, the reply says so instead of returning nothing, and that sentence
 * can exceed the budget. Silence would be worse — that is #254.
 */

import { describe, expect, test } from "bun:test";

import { TOOLS_BY_NAME } from "../mcp-tools/index.ts";
import type { MCPSupabaseClient, ToolContext } from "../mcp-tools/types.ts";

const ctx = { accessPath: "local-mcp", openaiApiKey: "" } as ToolContext;
const search = TOOLS_BY_NAME["cerefox_search"];

function client(rows: unknown[]): MCPSupabaseClient {
  return {
    rpc: async (name: string) =>
      name === "cerefox_log_usage" ? { data: null, error: null } : { data: rows, error: null },
  } as unknown as MCPSupabaseClient;
}

/** A chunk row: several of these usually belong to ONE document. */
function chunk(doc: string, section: string, index: number, chars: number, score: number) {
  return {
    document_id: "550e8400-e29b-41d4-a716-446655440000",
    chunk_id: `c-${index}`,
    chunk_index: index,
    doc_title: doc,
    title: section,
    heading_path: [doc, "Iteration 23: v0.5.0 packaging", section],
    content: "z".repeat(chars),
    score,
  };
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

describe("a search reply never exceeds max_bytes", () => {
  // Sizes chosen to straddle the interesting boundaries: rows far smaller than
  // the budget, rows near it, and rows larger than all of it.
  const budgets = [500, 1_000, 2_000, 5_000, 20_000];
  const rowSizes = [50, 400, 1_500, 9_000, 40_000];
  const counts = [1, 3, 12, 40];

  for (const budget of budgets) {
    for (const size of rowSizes) {
      for (const count of counts) {
        test(`budget ${budget}, ${count} row(s) of ${size} chars`, async () => {
          const rows = Array.from({ length: count }, (_, i) =>
            chunk(
              "Cerefox Implementation Plan",
              `23D: Server + ops commands ${i}`,
              i,
              size,
              1 - i / 100,
            ),
          );
          const out = await search.handler(
            client(rows),
            { query: "q", mode: "fts", max_bytes: budget, author: "t" },
            ctx,
          );

          // Never the answer that made an agent conclude the store was empty.
          expect(out).not.toBe("No results found.");

          const overBudget = bytes(out) > budget;
          if (overBudget) {
            // Only the documented exception may exceed it: nothing fit at all,
            // so the reply is the explanation rather than results.
            expect(out).toContain("none fit max_bytes");
            // And it is an explanation, not smuggled content.
            expect(out).not.toContain("z".repeat(200));
          }
        });
      }
    }
  }

  test("the truncation footer is inside the budget, not appended over it", async () => {
    // #263 exactly: rows that fill the budget, plus enough dropped rows for a
    // long footer. The footer must fit, which means the content had to leave
    // room for it.
    const rows = [
      chunk("Cerefox Implementation Plan", "Small", 0, 300, 0.99),
      ...Array.from({ length: 30 }, (_, i) =>
        chunk("Cerefox Implementation Plan", `23D: Server + ops commands ${i}`, i + 1, 5_000, 0.5),
      ),
    ];
    const out = await search.handler(
      client(rows),
      { query: "q", mode: "fts", max_bytes: 2_000, author: "t" },
      ctx,
    );
    expect(out).toContain("did not fit");
    expect(bytes(out)).toBeLessThanOrEqual(2_000);
  });

  test("a footer that cannot be shortened enough still leaves the content intact", async () => {
    // Degenerate: a budget so small that even the bare footer is a squeeze.
    // The reply must still be truthful and must not lose what it did return.
    const rows = [
      chunk("Doc", "A", 0, 100, 0.9),
      ...Array.from({ length: 5 }, (_, i) => chunk("Doc", `B${i}`, i + 1, 9_000, 0.5)),
    ];
    const out = await search.handler(
      client(rows),
      { query: "q", mode: "fts", max_bytes: 600, author: "t" },
      ctx,
    );
    expect(out).toContain("z".repeat(100)); // the row that fit is still there
    expect(out).toContain("did not fit");
  });
});
