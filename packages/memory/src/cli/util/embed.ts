/**
 * Embedding helper for CLI search commands.
 *
 * `cerefox search` and `cerefox metadata-search` (when text-augmented)
 * need to embed the query before calling the hybrid-search RPC. Uses the
 * existing `_shared/embeddings/getEmbedding()` — same code path the MCP
 * server uses, so the embedding model + dimensions stay in lockstep.
 *
 * The OpenAI API key is read from `loadSettings()` (which already covers
 * both `CEREFOX_OPENAI_API_KEY` and bare `OPENAI_API_KEY`).
 */

import { systemError, userError } from "../../../../../_shared/cli-core/index.ts";
import { loadSettings } from "../../../../../_shared/config/index.ts";
import { resolveEmbedderKind, getEmbedding } from "../../../../../_shared/embeddings/index.ts";

export async function embedQuery(query: string): Promise<number[]> {
  const settings = loadSettings();
  const apiKey = settings.openaiApiKey;
  // The local ONNX embedder (CEREFOX_EMBEDDER=local, iter-31) needs no API key.
  if (!apiKey && resolveEmbedderKind() !== "local") {
    throw userError(
      "OPENAI_API_KEY (or CEREFOX_OPENAI_API_KEY) is required for search.",
      "Set the key in your .env, or run `cerefox init` to bootstrap.",
    );
  }
  try {
    return await getEmbedding(query, apiKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw systemError(
      `Failed to embed query: ${msg}`,
      "Run `cerefox doctor` to verify the OpenAI API path.",
    );
  }
}
