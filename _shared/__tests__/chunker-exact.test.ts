/**
 * iter-28D Phase 1 — invariant tests for the exact-partition ("blind-stitch")
 * chunker. THE test that would have caught the original corruption bug:
 *
 *     blindStitch(chunkMarkdown(doc)) === doc.trim()
 *
 * for every input, byte-for-byte, plus "no chunk exceeds the size limit".
 * These are pure-TS and validate the core algorithm ahead of the (coupled,
 * deploy-dependent) Phase 1 wiring.
 */

import { describe, expect, test } from "bun:test";

import { blindStitch, chunkMarkdown, type ChunkData } from "../ingest/chunker.ts";

function cpLen(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

const roundTrips = (doc: string, max = 100): ChunkData[] => {
  const chunks = chunkMarkdown(doc, max);
  expect(blindStitch(chunks)).toBe(doc.trim()); // THE invariant
  for (const c of chunks) expect(cpLen(c.content)).toBeLessThanOrEqual(max); // bounded
  // chunk_index is contiguous from 0
  chunks.forEach((c, i) => expect(c.chunk_index).toBe(i));
  return chunks;
};

describe("chunkMarkdown — the reconstruction invariant", () => {
  test("empty / whitespace-only → no chunks", () => {
    expect(chunkMarkdown("")).toEqual([]);
    expect(chunkMarkdown("   \n\n  \t ")).toEqual([]);
  });

  test("small doc → single chunk == trimmed doc", () => {
    const chunks = roundTrips("# Title\n\nA short paragraph.", 4000);
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toBe("# Title\n\nA short paragraph.");
  });

  test("plain multi-paragraph prose round-trips", () => {
    const doc = Array.from({ length: 30 }, (_, i) => `Paragraph number ${i} with some words.`).join("\n\n");
    roundTrips(doc, 120);
  });

  test("multi-heading document round-trips", () => {
    const doc =
      "# Alpha\n\nIntro text under alpha.\n\n" +
      "## Beta\n\nBody of beta section here.\n\n" +
      "### Gamma\n\nGamma details.\n\n" +
      "## Delta\n\nDelta body spanning a bit more text to force a split.";
    roundTrips(doc, 60);
  });

  test("a markdown table larger than the limit (one blank-line-free block)", () => {
    const rows = Array.from({ length: 200 }, (_, i) => `| ${i} | value_${i} | more_${i} |`);
    const table = `# Data\n\n| a | b | c |\n| - | - | - |\n${rows.join("\n")}`;
    const chunks = roundTrips(table, 200);
    expect(chunks.length).toBeGreaterThan(1); // was split, but losslessly
  });

  test("a single blank-line-free paragraph larger than the limit", () => {
    const para = "word ".repeat(500).trim(); // ~2500 chars, no blank lines
    roundTrips(para, 100);
  });

  test("unicode / multibyte content round-trips (no split code points)", () => {
    const doc =
      "# 日本語\n\n" +
      "🎉🎊✨ ".repeat(80) + "\n\n" +
      "Ελληνικά κείμενο εδώ. ".repeat(40) + "\n\n" +
      "𝟙𝟚𝟛𝟜 astral digits ".repeat(40);
    const chunks = roundTrips(doc, 90);
    // No chunk boundary split a surrogate pair (concat equality already proves it,
    // but assert no lone surrogate at any chunk edge for good measure).
    for (const c of chunks) {
      const first = c.content.charCodeAt(0);
      const last = c.content.charCodeAt(c.content.length - 1);
      expect(first >= 0xdc00 && first <= 0xdfff).toBe(false); // no lone low surrogate at start
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false); // no lone high surrogate at end
    }
  });

  test("leading/trailing whitespace is trimmed, interior preserved", () => {
    const doc = "\n\n\n  # Head\n\nBody with   interior   spaces\nand a single newline.\n\n\n  ";
    const chunks = roundTrips(doc, 4000);
    expect(chunks[0].content).toBe(doc.trim());
  });

  test("CRLF and mixed newlines survive round-trip", () => {
    const doc = "# H\r\n\r\nLine one.\r\n\r\nLine two is here and a bit longer to split.\r\n\r\nLine three.";
    roundTrips(doc, 30);
  });

  test("consecutive blank-line runs (3+ newlines) survive", () => {
    const doc = "Para one.\n\n\n\nPara two after a big gap.\n\n\nPara three.";
    roundTrips(doc, 20);
  });

  test("stress: many sizes never break the invariant or the bound", () => {
    const doc =
      "# Root\n\n" +
      Array.from({ length: 60 }, (_, i) =>
        i % 5 === 0 ? `## Section ${i}\n\nlead-in ${i}` : `Paragraph ${i} ${"x".repeat(i % 40)}`,
      ).join("\n\n");
    for (const max of [20, 37, 50, 100, 250, 999]) roundTrips(doc, max);
  });
});

describe("chunkMarkdown — heading_path metadata", () => {
  test("a mid-section chunk inherits its enclosing heading path (not stored in content)", () => {
    const doc = "# A\n\n## B\n\n" + "para ".repeat(60).trim() + "\n\n" + "more ".repeat(60).trim();
    const chunks = chunkMarkdown(doc, 120);
    // find a chunk whose content does NOT contain a heading line but is under A > B
    const midSection = chunks.find((c) => !/^#{1,3} /m.test(c.content) && c.heading_path.length > 0);
    expect(midSection).toBeDefined();
    expect(midSection!.heading_path).toEqual(["A", "B"]);
    expect(midSection!.heading_level).toBe(2);
    expect(midSection!.title).toBe("B");
  });

  test("proper nesting stack: a new H1 resets the path", () => {
    const doc = "# One\n\n## Sub\n\nbody one\n\n# Two\n\nbody two here to make it distinct and longer.";
    const chunks = chunkMarkdown(doc, 40);
    const underTwo = chunks.find((c) => c.heading_path[0] === "Two");
    expect(underTwo).toBeDefined();
    expect(underTwo!.heading_path).toEqual(["Two"]);
  });

  test("preamble before any heading has empty path / level 0", () => {
    const doc = "preamble text ".repeat(30).trim() + "\n\n# Later\n\nbody";
    const first = chunkMarkdown(doc, 80)[0];
    expect(first.heading_path).toEqual([]);
    expect(first.heading_level).toBe(0);
  });
});

describe("chunkMarkdown — adversarial edge cases (sole-chunker hardening)", () => {
  test("heading immediately followed by body (no blank line between)", () => {
    const doc = "## Head\nbody line right under it\n\n" + "tail ".repeat(50).trim();
    roundTrips(doc, 40);
  });

  test("doc exactly at the size limit → single chunk, unchanged", () => {
    const body = "z".repeat(100);
    const chunks = chunkMarkdown(body, 100);
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toBe(body);
  });

  test("doc of only headings round-trips", () => {
    const doc = Array.from({ length: 20 }, (_, i) => `${"#".repeat((i % 3) + 1)} Heading ${i}`).join("\n\n");
    roundTrips(doc, 30);
  });

  test("trailing spaces + tabs on lines are preserved exactly", () => {
    const doc = "# H   \n\nline with trailing spaces   \nand a\ttab\tinside\n\n" + "x".repeat(200);
    roundTrips(doc, 50);
  });

  test("heading with closing hashes (## Foo ##) parses title without them", () => {
    const doc = "## Foo ##\n\n" + "body ".repeat(60).trim();
    const chunks = chunkMarkdown(doc, 80);
    const underFoo = chunks.find((c) => c.heading_path.length > 0);
    expect(underFoo!.heading_path).toEqual(["Foo"]);
    expect(blindStitch(chunks)).toBe(doc.trim()); // content still exact incl. the "##"
  });

  test("a fenced code block containing '### not-a-heading' still round-trips exactly", () => {
    const doc =
      "# Real\n\n```\n### this is code, not a heading\nsome code line\n```\n\n" + "after ".repeat(60).trim();
    // Round-trip must be byte-exact regardless of how headings are detected.
    roundTrips(doc, 50);
  });

  test("one huge line (no blank lines, has single \\n soft-wraps) hard-splits losslessly", () => {
    const doc = Array.from({ length: 400 }, (_, i) => `soft-wrapped line number ${i}`).join("\n"); // single \n, no \n\n
    const chunks = roundTrips(doc, 120);
    expect(chunks.length).toBeGreaterThan(1);
  });

  test("all-astral content larger than the limit hard-splits without breaking pairs", () => {
    const doc = "𝟙".repeat(1000); // 1000 astral code points, one block, no separators
    roundTrips(doc, 100);
  });

  test("CRLF throughout a large multi-section doc", () => {
    const doc = Array.from({ length: 20 }, (_, i) => `## Section ${i}\r\n\r\nBody ${i} ${"y".repeat(20)}`).join(
      "\r\n\r\n",
    );
    roundTrips(doc, 45);
  });

  test("windows-style paragraph gaps (\\r\\n\\r\\n) count as separators", () => {
    const doc = "para one here\r\n\r\npara two here\r\n\r\npara three which is a bit longer to force splitting";
    roundTrips(doc, 25);
  });
});
