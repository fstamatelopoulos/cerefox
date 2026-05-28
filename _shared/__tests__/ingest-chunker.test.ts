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
