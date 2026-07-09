/**
 * Cross-runtime parity test for `_shared/ingest/chunker.ts`.
 *
 * Loads the 12 captured Python chunker fixtures from
 * `packages/memory/test/fixtures/python-parity/chunking/` and asserts
 * the TS chunker produces byte-identical output for each one.
 *
 * Captured by `scripts/capture_python_chunking_parity.py` (Part 25
 * pre-iter step). Re-run the script if the Python chunker's behaviour
 * legitimately changes; otherwise this test is the canary that the TS
 * port has drifted from Python's.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chunkMarkdown, type ChunkData } from "../ingest/chunker.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(
  HERE,
  "..",
  "..",
  "packages",
  "memory",
  "test",
  "fixtures",
  "python-parity",
  "chunking",
);

interface PythonFixture {
  fixture: string;
  input_text: string;
  input_char_count: number;
  chunk_count: number;
  chunks: ChunkData[];
}

function loadFixtures(): PythonFixture[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(FIXTURES_DIR, f), "utf8")));
}

describe("chunkMarkdown — Python parity", () => {
  const fixtures = loadFixtures();

  test("loaded at least 10 fixtures", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(10);
  });

  for (const fx of fixtures) {
    test(fx.fixture, () => {
      const tsChunks = chunkMarkdown(fx.input_text);

      // Chunk count must match.
      expect(tsChunks.length).toBe(fx.chunk_count);

      // Each chunk must match field-for-field.
      for (let i = 0; i < fx.chunks.length; i++) {
        const py = fx.chunks[i];
        const ts = tsChunks[i];
        // chunk_index sequence
        expect(ts.chunk_index).toBe(py.chunk_index);
        // heading_path: deep equality
        expect(ts.heading_path).toEqual(py.heading_path);
        // heading_level: scalar
        expect(ts.heading_level).toBe(py.heading_level);
        // title: scalar
        expect(ts.title).toBe(py.title);
        // char_count: scalar
        expect(ts.char_count).toBe(py.char_count);
        // content: byte-identical. If this fails, diff py.content vs ts.content.
        expect(ts.content).toBe(py.content);
      }
    });
  }
});

describe("chunkMarkdown — oversized single paragraph reconstructs losslessly", () => {
  // Regression guard. `cerefox_reconstruct_doc` reassembles a document by joining
  // chunk contents with an E'\n\n' separator, so the chunker MUST only split at
  // paragraph ("\n\n") boundaries — otherwise the join inserts a spurious blank
  // line mid-content. Two historical bugs violated this when a single paragraph
  // (no blank lines — e.g. a markdown table) exceeded max_chunk_chars:
  //   (1) step = max_chars // 2 slid a full-width window → 50% OVERLAP → the
  //       overlapped span was DUPLICATED on reconstruction; and
  //   (2) even a non-overlapping char-split (step = max_chars) inserted a blank
  //       line mid-word ("Source" -> "Sour\n\nce") / mid-table-row.
  // The fix keeps an oversized single paragraph WHOLE (one chunk). The strong
  // assertion below — reconstruct === original — catches BOTH failure modes;
  // a weaker "no duplicate" check would have passed bug (2).
  const SEP = "\n\n"; // mirrors cerefox_reconstruct_doc's STRING_AGG separator
  const reconstruct = (doc: string, maxChars = 100): string =>
    chunkMarkdown(doc, maxChars).map((c) => c.content).join(SEP);

  test("a giant blank-line-free paragraph round-trips byte-for-byte", () => {
    const marker = "CEREFOXUNIQUESENTINEL0123456789";
    const para = "a".repeat(210) + marker + "b".repeat(120);
    expect(para.length).toBeGreaterThan(100); // must hit the oversized branch
    const recon = reconstruct(para);
    expect(recon).toBe(para); // lossless — no duplication, no injected blank lines
    expect(recon.split(marker).length - 1).toBe(1); // sentinel exactly once
  });

  test("a markdown table (one oversized paragraph) round-trips byte-for-byte", () => {
    const rows = Array.from(
      { length: 40 },
      (_, i) => `| row${i.toString().padStart(3, "0")} | valueColumnData${i} |`,
    );
    const table = `| col_a | col_b |\n| --- | --- |\n${rows.join("\n")}`;
    expect(table.length).toBeGreaterThan(100);
    const recon = reconstruct(table);
    expect(recon).toBe(table); // no blank line inserted mid-row; no duplicated rows
  });

  test("a full doc with a heading + oversized table reconstructs unchanged", () => {
    const rows = Array.from({ length: 30 }, (_, i) => `| ${i} | some data value ${i} |`);
    const doc = `## Section A\n\nintro paragraph\n\n## Big Table\n\n${rows.join("\n")}\n\n## Section C\n\ntail paragraph`;
    const recon = reconstruct(doc, 200);
    expect(recon).toBe(doc); // splits only at "\n\n" boundaries → lossless
  });
});
