// ── OpenAI embedding constants ────────────────────────────────────────────────

export const OPENAI_EMBEDDING_URL = "https://api.openai.com/v1/embeddings";
export const OPENAI_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 768;

const EMBEDDING_MAX_RETRIES = 3;
const EMBEDDING_INITIAL_BACKOFF_MS = 500; // 500ms → 1s → 2s

// ── Single-text embedding (used by search tool for query vector) ──────────────

export async function getEmbedding(text: string, apiKey: string): Promise<number[]> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < EMBEDDING_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(OPENAI_EMBEDDING_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          input: text,
          dimensions: EMBEDDING_DIMENSIONS,
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

// ── Batch embedding (used by ingest tool for chunk embeddings) ────────────────

export async function embedBatch(texts: string[], apiKey: string): Promise<number[][]> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < EMBEDDING_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(OPENAI_EMBEDDING_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          input: texts,
          dimensions: EMBEDDING_DIMENSIONS,
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
