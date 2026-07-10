/**
 * Shared OpenAI-compatible embedding client.
 *
 * Used by `_shared/mcp-tools/search.ts` (query embedding) and
 * `_shared/mcp-tools/ingest.ts` (chunk embeddings). Both the Edge Function
 * and the local TS MCP server use this module via `_shared/mcp-tools/`.
 *
 * Runtime-neutral: uses only `fetch` and `setTimeout`. No Deno- or Bun-
 * specific APIs. The OpenAI API key is always passed in by the caller —
 * the module never reads env vars directly.
 *
 * Mirrors `supabase/functions/cerefox-mcp/embeddings.ts` exactly for v0.4.0
 * (extraction commit; no behaviour change). Future tweaks live here.
 */

export const OPENAI_EMBEDDING_URL = "https://api.openai.com/v1/embeddings";
export const OPENAI_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Resolve the OpenAI embedding endpoint/model/dimensions, applying `.env`
 * overrides over the built-in defaults. These were configurable in the Python
 * runtime; the TS migration hardcoded them.
 *
 * ⚠ Overriding the MODEL or DIMENSIONS is a BREAKING change: query vectors must
 * match the stored vectors and the DB column is `vector(768)`. Changing either
 * requires re-embedding the whole corpus (`cerefox server reindex`) and, for a
 * non-768 model, a schema change. `CEREFOX_OPENAI_BASE_URL` (proxy/gateway) is
 * the only safe one to flip on an existing KB.
 *
 * Runtime-agnostic env read; the Deno Edge Function (no host env) keeps the
 * constants — matching the EF's "model config is a constant" design.
 */
export function openaiEmbeddingConfig(): { url: string; model: string; dimensions: number } {
  const env =
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const base = env.CEREFOX_OPENAI_BASE_URL?.replace(/\/+$/, "");
  const dims = Number.parseInt(env.CEREFOX_OPENAI_EMBEDDING_DIMENSIONS ?? "", 10);
  return {
    url: base ? `${base}/embeddings` : OPENAI_EMBEDDING_URL,
    model: env.CEREFOX_OPENAI_EMBEDDING_MODEL || OPENAI_MODEL,
    dimensions: Number.isNaN(dims) || dims <= 0 ? EMBEDDING_DIMENSIONS : dims,
  };
}

/**
 * Safety cap (iter-28D Phase 0) on the characters sent to the embedding model per
 * input — a conservative proxy for the model's token limit (`text-embedding-3-small`
 * is 8191 tokens). Normal chunks are far below this (`max_chunk_chars` ≈ 2000); the
 * cap only bites on an oversized *keep-whole* chunk (a huge table or blank-line-free
 * paragraph the interim chunker fix keeps intact). Default 20000 chars sits well under
 * 8191 tokens for markdown/English; override with `CEREFOX_EMBED_MAX_INPUT_CHARS`.
 */
export const DEFAULT_EMBED_MAX_INPUT_CHARS = 20000;

export function embeddingMaxInputChars(): number {
  const env =
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const raw = Number.parseInt(env.CEREFOX_EMBED_MAX_INPUT_CHARS ?? "", 10);
  return Number.isNaN(raw) || raw <= 0 ? DEFAULT_EMBED_MAX_INPUT_CHARS : raw;
}

/**
 * Truncate one embedding input to the char cap. The full chunk `content` is stored and
 * reconstructed untouched; only its *embedding* is computed on this prefix — so at worst
 * search quality for one oversized chunk is degraded, and an ingest **never fails** on an
 * over-limit embedding input (the failure mode this prevents). Surrogate-safe (never leaves
 * a dangling high surrogate). Warns when it truncates.
 */
export function capEmbeddingInput(text: string): string {
  const max = embeddingMaxInputChars();
  if (text.length <= max) return text;
  let cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1); // don't split a surrogate pair
  console.warn(
    `[embeddings] truncated an embedding input: ${text.length} → ${cut.length} chars ` +
      `(cap CEREFOX_EMBED_MAX_INPUT_CHARS=${max}). The full content is stored and reconstructed ` +
      `untouched; only this chunk's embedding uses the prefix (degraded search for this chunk).`,
  );
  return cut;
}

const EMBEDDING_MAX_RETRIES = 3;
const EMBEDDING_INITIAL_BACKOFF_MS = 500; // 500ms → 1s → 2s

/** Embed a single string. Used for the query vector in `cerefox_search`. */
export async function getEmbedding(text: string, apiKey: string): Promise<number[]> {
  let lastError: Error | null = null;
  const cfg = openaiEmbeddingConfig();
  const input = capEmbeddingInput(text); // cap once, before the retry loop

  for (let attempt = 0; attempt < EMBEDDING_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(cfg.url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: cfg.model,
          input,
          dimensions: cfg.dimensions,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        if (response.status < 500) {
          // 4xx — don't retry; throw immediately.
          throw new Error(`OpenAI embedding error ${response.status}: ${err}`);
        }
        lastError = new Error(`OpenAI embedding error ${response.status}: ${err}`);
        const backoff = EMBEDDING_INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(
          `Embedding API returned ${response.status} (attempt ${attempt + 1}/${EMBEDDING_MAX_RETRIES}), retrying in ${backoff}ms`,
        );
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      const data = await response.json();
      if (attempt > 0) console.info(`Embedding API succeeded on retry ${attempt}`);
      return data.data[0].embedding;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("OpenAI embedding error")) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      const backoff = EMBEDDING_INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      console.warn(
        `Embedding API request failed: ${lastError.message} (attempt ${attempt + 1}/${EMBEDDING_MAX_RETRIES}), retrying in ${backoff}ms`,
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  throw lastError ?? new Error(`Embedding API failed after ${EMBEDDING_MAX_RETRIES} attempts`);
}

/**
 * Per-API-call batch limit. Mirrors Python's `CloudEmbedder.BATCH_SIZE`
 * (in `src/cerefox/embeddings/cloud.py`). OpenAI's `/v1/embeddings`
 * accepts up to 2048 inputs per request, but 96 is the Python contract
 * and matches what the existing corpus was embedded with.
 *
 * v0.7 (iter-25 / Part 25B) introduces this constant to TS — the v0.4
 * `embedBatch` had no batching and would blow the API limit on bulk
 * ingest of large documents.
 */
export const EMBEDDING_BATCH_SIZE = 96;

/**
 * Single API call to OpenAI's embeddings endpoint. Caller is responsible
 * for staying within the API's per-request limit; in practice, use
 * `embedBatch` which chunks calls at `EMBEDDING_BATCH_SIZE`.
 */
async function embedBatchSingleCall(
  texts: string[],
  apiKey: string,
): Promise<number[][]> {
  let lastError: Error | null = null;
  const cfg = openaiEmbeddingConfig();
  const inputs = texts.map(capEmbeddingInput); // cap once, before the retry loop

  for (let attempt = 0; attempt < EMBEDDING_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(cfg.url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: cfg.model,
          input: inputs,
          dimensions: cfg.dimensions,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        if (response.status < 500) {
          throw new Error(`OpenAI embedding error ${response.status}: ${err}`);
        }
        lastError = new Error(`OpenAI embedding error ${response.status}: ${err}`);
        const backoff = EMBEDDING_INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(
          `Embedding API returned ${response.status} (attempt ${attempt + 1}/${EMBEDDING_MAX_RETRIES}), retrying in ${backoff}ms`,
        );
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      const data = await response.json();
      if (attempt > 0) console.info(`Embedding API succeeded on retry ${attempt}`);
      const sorted = data.data.sort(
        (a: { index: number }, b: { index: number }) => a.index - b.index,
      );
      return sorted.map((d: { embedding: number[] }) => d.embedding);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("OpenAI embedding error")) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      const backoff = EMBEDDING_INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      console.warn(
        `Embedding API request failed: ${lastError.message} (attempt ${attempt + 1}/${EMBEDDING_MAX_RETRIES}), retrying in ${backoff}ms`,
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  throw lastError ?? new Error(`Embedding API failed after ${EMBEDDING_MAX_RETRIES} attempts`);
}

/**
 * Embed multiple strings, chunked into per-API-call batches of
 * `batchSize` (default 96). Used by the v0.7 ingestion pipeline + the
 * MCP-tools ingest handler.
 *
 * Results are returned in input order (each per-call response is sorted
 * by `index` and the results concatenated in input order).
 *
 * Pre-v0.7 callers that used the old single-call `embedBatch` (no
 * batching) continue to work — the signature is backward-compatible.
 * The new `batchSize` param is opt-in; default 96 matches Python.
 */
export async function embedBatch(
  texts: string[],
  apiKey: string,
  batchSize: number = EMBEDDING_BATCH_SIZE,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.length <= batchSize) {
    return embedBatchSingleCall(texts, apiKey);
  }

  const out: number[][] = [];
  for (let start = 0; start < texts.length; start += batchSize) {
    const slice = texts.slice(start, start + batchSize);
    const vectors = await embedBatchSingleCall(slice, apiKey);
    for (const v of vectors) out.push(v);
  }
  return out;
}
