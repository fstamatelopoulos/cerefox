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

/** A docs-mode row: no section, no chunk index, `full_content` not `content`. */
function doc(title: string, chars: number, score: number) {
  return {
    document_id: "550e8400-e29b-41d4-a716-446655440001",
    doc_title: title,
    full_content: "z".repeat(chars),
    best_score: score,
    chunk_count: 3,
    total_chars: chars,
    content_hash: "a".repeat(64),
  };
}

/**
 * The shapes, not just the sizes.
 *
 * A grid over one row shape is still one example, which is the failure this
 * file exists to close. Each of these adds bytes to the reply that the naive
 * accounting missed: the 28I preamble is ~185 bytes nothing counted; a docs
 * row carries a 64-character hash and an id in the footer; a sparse row is
 * tiny as JSON and not as markdown, which is exactly where a JSON-measured
 * budget under-reserves.
 */
const SHAPES: Array<{
  name: string;
  make: (i: number, chars: number) => Record<string, unknown>;
}> = [
  { name: "chunk", make: (i, c) => chunk("Cerefox Implementation Plan", `23D: Server ${i}`, i, c, 1 - i / 100) },
  {
    name: "chunk below-confidence",
    make: (i, c) => ({
      ...chunk("Cerefox Implementation Plan", `23D: Server ${i}`, i, c, 1 - i / 100),
      below_confidence: true,
    }),
  },
  { name: "docs", make: (i, c) => doc(`Release Process ${i}`, c, 1 - i / 100) },
  {
    name: "docs below-confidence",
    make: (i, c) => ({ ...doc(`Release Process ${i}`, c, 1 - i / 100), below_confidence: true }),
  },
  {
    name: "sparse (small json, wide render)",
    make: (i, c) => ({
      document_id: "550e8400-e29b-41d4-a716-446655440002",
      doc_title: "T",
      chunk_index: i,
      heading_path: [],
      content: "z".repeat(c),
      score: 1 - i / 100,
    }),
  },
];

const bytes = (s: string) => new TextEncoder().encode(s).length;

describe("a search reply never exceeds max_bytes", () => {
  // Sizes chosen to straddle the interesting boundaries: rows far smaller than
  // the budget, rows near it, and rows larger than all of it.
  const budgets = [500, 1_000, 2_000, 5_000, 20_000];
  const rowSizes = [50, 400, 1_500, 9_000, 40_000];
  const counts = [1, 3, 12, 40];

  for (const shape of SHAPES) {
    for (const budget of budgets) {
      for (const size of rowSizes) {
        for (const count of counts) {
        test(`${shape.name}: budget ${budget}, ${count} row(s) of ${size} chars`, async () => {
          const rows = Array.from({ length: count }, (_, i) => shape.make(i, size));
          const out = await search.handler(
            client(rows),
            { query: "q", mode: "fts", max_bytes: budget, author: "t" },
            ctx,
          );

          // Never the answer that made an agent conclude the store was empty.
          expect(out).not.toBe("No results found.");

          // "None fit" must be TRUE when claimed: the earlier version of this
          // grid accepted a reply saying nothing fit a 1,649-byte budget when
          // the largest result rendered to 1,617 bytes, which is how content
          // that fit was lost to a footer (#265).
          const degraded = out.includes("none fit max_bytes");
          if (degraded) {
            const largest = Number(
              /largest is ([\d,]+) bytes/.exec(out)?.[1]?.replace(/,/g, "") ?? 0,
            );
            expect(largest).toBeGreaterThan(budget);
            expect(out).not.toContain("z".repeat(200)); // an explanation, not content
          }

          if (bytes(out) > budget) {
            // Two documented exceptions, and no others: nothing fit at all, or
            // a single result plus the shortest possible advisory.
            const lastResort =
              degraded || (out.startsWith("⚠ Below the confidence threshold") && !out.includes("did not fit"));
            expect(lastResort).toBe(true);
          }
        });
        }
      }
    }
  }

  test("content that fits is never dropped so a footer can fit (#265)", async () => {
    // Five rows whose bodies fit but whose footer does not: the reply must be
    // the content, without a footer, not "none fit" about content that did.
    const rows = Array.from({ length: 5 }, (_, i) => chunk("Doc", `S${i}`, i, 90, 0.9 - i / 10));
    const out = await search.handler(
      client(rows),
      { query: "q", mode: "fts", max_bytes: 600, author: "t" },
      ctx,
    );
    expect(out).not.toContain("none fit max_bytes");
    expect(out).toContain("z".repeat(90));
    expect(bytes(out)).toBeLessThanOrEqual(600);
  });

  test("a near-ceiling document is still returned (#265)", async () => {
    // At the server ceiling, "raise max_bytes" is not a remedy the caller has.
    // Dropping the document there turned a small overrun into total loss.
    const rows = [doc("Big", 195_000, 0.9), doc("Small", 500, 0.4)];
    const out = await search.handler(
      client(rows),
      { query: "q", mode: "fts", max_bytes: 200_000, author: "t" },
      ctx,
    );
    expect(out).toContain("## Big");
    expect(out).toContain("z".repeat(1_000));
    expect(bytes(out)).toBeLessThanOrEqual(200_000);
  });

  test("a non-numeric match_count cannot become an unbounded query (#265)", async () => {
    // NaN serialises to JSON null, and `LIMIT NULL` in Postgres is no limit.
    const seen: Array<Record<string, unknown>> = [];
    const spy = {
      rpc: async (name: string, params: Record<string, unknown>) => {
        if (name === "cerefox_log_usage") return { data: null, error: null };
        seen.push(params);
        return { data: [chunk("Doc", "S", 0, 50, 0.9)], error: null };
      },
    } as unknown as MCPSupabaseClient;
    await search.handler(spy, { query: "q", mode: "fts", match_count: "many", author: "t" }, ctx);
    expect(seen[0]!.p_match_count).toBe(5);
  });

  test("the below-confidence banner never displaces the answer it warns about", async () => {
    // #265: the ~190-byte advisory was charged to the budget but could not be
    // shortened, so a result that fit on its own was dropped in favour of a
    // LONGER message carrying no content.
    const row = { ...chunk("Doc", "Setup", 0, 400, 0.4), below_confidence: true };
    const out = await search.handler(
      client([row]),
      { query: "q", mode: "fts", max_bytes: 600, author: "t" },
      ctx,
    );
    expect(bytes(out)).toBeLessThanOrEqual(600);
    expect(out).toContain("z".repeat(400)); // the content survived
    expect(out.toLowerCase()).toContain("confidence"); // and so did the warning
  });

  test("the degraded message quotes a size in the same unit as the budget", async () => {
    // #265: it quoted JSON bytes, producing "the largest is 490 bytes" against
    // a 600-byte budget — a remedy the caller cannot act on.
    const out = await search.handler(
      client([chunk("Doc", "Setup", 0, 5_000, 0.9)]),
      { query: "q", mode: "fts", max_bytes: 600, author: "t" },
      ctx,
    );
    const quoted = Number(/largest is ([\d,]+) bytes/.exec(out)?.[1]?.replace(/,/g, "") ?? 0);
    expect(quoted).toBeGreaterThan(600);
  });

  test("a large match_count is clamped, so fitting cannot be made unbounded work", async () => {
    const rows = Array.from({ length: 400 }, (_, i) => chunk("Doc", `S${i}`, i, 200, 1 - i / 1000));
    const started = Date.now();
    const out = await search.handler(
      client(rows),
      { query: "q", mode: "fts", match_count: 100_000, max_bytes: 200_000, author: "t" },
      ctx,
    );
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(bytes(out)).toBeLessThanOrEqual(200_000);
  });

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
