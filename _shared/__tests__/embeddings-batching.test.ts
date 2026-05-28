/**
 * Tests for `_shared/embeddings/embedBatch()` 96-chunk batching.
 *
 * Two test groups:
 *   - **Batching logic** (unit) — mock `fetch` to verify per-API-call
 *     counts for various input sizes. No live OpenAI calls.
 *   - **Cosine parity** (live, probe-and-skip) — embed the captured
 *     Python reference text via the real OpenAI API and assert cosine
 *     similarity ≥ 1 - 1e-6 against the Python baseline. Skip when
 *     OPENAI_API_KEY isn't set.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  embedBatch,
  EMBEDDING_BATCH_SIZE,
  getEmbedding,
} from "../embeddings/index.js";
import { loadEnv } from "../config/index.js";

// Load .env so OPENAI_API_KEY (et al) are available to the probe-and-skip
// live tests below. Idempotent.
loadEnv();

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
  "embedding",
);

// ── Unit: batching logic ────────────────────────────────────────────────────

describe("embedBatch — chunking at EMBEDDING_BATCH_SIZE", () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  let lastBatchSizes: number[] = [];

  beforeEach(() => {
    callCount = 0;
    lastBatchSizes = [];
    // Mock fetch: respond with one zero-vector per input, indexed in order.
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      callCount += 1;
      const body = JSON.parse((init?.body as string) ?? "{}") as {
        input: string[];
      };
      lastBatchSizes.push(body.input.length);
      const data = body.input.map((_t: string, i: number) => ({
        index: i,
        embedding: new Array(768).fill(0),
      }));
      return new Response(JSON.stringify({ data }), { status: 200 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("EMBEDDING_BATCH_SIZE constant is 96 (Python contract)", () => {
    expect(EMBEDDING_BATCH_SIZE).toBe(96);
  });

  test("empty input → no fetch + empty array", async () => {
    const result = await embedBatch([], "fake-key");
    expect(result).toEqual([]);
    expect(callCount).toBe(0);
  });

  test("1 input → 1 API call with 1 item", async () => {
    const result = await embedBatch(["a"], "fake-key");
    expect(result.length).toBe(1);
    expect(callCount).toBe(1);
    expect(lastBatchSizes).toEqual([1]);
  });

  test("96 inputs → 1 API call (boundary)", async () => {
    const input = Array.from({ length: 96 }, (_, i) => `text-${i}`);
    const result = await embedBatch(input, "fake-key");
    expect(result.length).toBe(96);
    expect(callCount).toBe(1);
    expect(lastBatchSizes).toEqual([96]);
  });

  test("97 inputs → 2 API calls (96 + 1)", async () => {
    const input = Array.from({ length: 97 }, (_, i) => `text-${i}`);
    const result = await embedBatch(input, "fake-key");
    expect(result.length).toBe(97);
    expect(callCount).toBe(2);
    expect(lastBatchSizes).toEqual([96, 1]);
  });

  test("300 inputs → 4 API calls (96 + 96 + 96 + 12)", async () => {
    const input = Array.from({ length: 300 }, (_, i) => `text-${i}`);
    const result = await embedBatch(input, "fake-key");
    expect(result.length).toBe(300);
    expect(callCount).toBe(4);
    expect(lastBatchSizes).toEqual([96, 96, 96, 12]);
  });

  test("custom batchSize=10 → expected call shape", async () => {
    const input = Array.from({ length: 25 }, (_, i) => `text-${i}`);
    const result = await embedBatch(input, "fake-key", 10);
    expect(result.length).toBe(25);
    expect(callCount).toBe(3);
    expect(lastBatchSizes).toEqual([10, 10, 5]);
  });

  test("results preserve input order across batches", async () => {
    // Mock that returns each text's index-in-input as embedding[0].
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}") as {
        input: string[];
      };
      const data = body.input.map((t: string, i: number) => {
        const idx = Number.parseInt(t.replace("text-", ""), 10);
        const vec = new Array(768).fill(0);
        vec[0] = idx;
        return { index: i, embedding: vec };
      });
      return new Response(JSON.stringify({ data }), { status: 200 });
    }) as typeof fetch;

    const input = Array.from({ length: 200 }, (_, i) => `text-${i}`);
    const result = await embedBatch(input, "fake-key");
    for (let i = 0; i < 200; i++) {
      expect(result[i][0]).toBe(i);
    }
  });
});

// ── Live: cosine parity with the captured Python reference ──────────────────

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

describe("embedder — cosine parity with Python (live, probe-and-skip)", () => {
  const apiKey =
    process.env.OPENAI_API_KEY ||
    process.env.CEREFOX_OPENAI_API_KEY ||
    "";
  const live = apiKey.length > 0;

  test("captured reference matches TS embedding (cosine ≥ 1 - 1e-6)", async () => {
    if (!live) {
      console.log("(skipped: no OPENAI_API_KEY)");
      return;
    }
    let ref: { text: string; embedding: number[] };
    try {
      ref = JSON.parse(
        readFileSync(join(FIXTURES_DIR, "reference.json"), "utf8"),
      );
    } catch {
      console.log("(skipped: no embedding/reference.json fixture)");
      return;
    }
    const tsVec = await getEmbedding(ref.text, apiKey);
    expect(tsVec.length).toBe(768);
    const sim = cosine(tsVec, ref.embedding);
    // Allow a small epsilon for any cross-runtime numerical noise. OpenAI's
    // model is deterministic for the same input, so we expect sim very close
    // to 1.0. Threshold 1 - 1e-6 caught any sign-flip / dimensions mismatch.
    expect(sim).toBeGreaterThan(1 - 1e-6);
  });
});
