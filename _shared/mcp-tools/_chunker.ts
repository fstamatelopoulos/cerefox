/**
 * Chunker + content-hash utilities for the MCP ingest tool.
 *
 * iter-28D Phase 1: the chunker is now the single exact-partition implementation
 * in `_shared/ingest/chunker.ts` — this module re-exports it (the previous copy
 * here was removed) and keeps the content-hash helpers used for dedup.
 */

export { chunkMarkdown, type ChunkData, type ChunkData as Chunk } from "../ingest/chunker.ts";

export const MAX_CHUNK_CHARS = 4000;

/**
 * Content-hash normalization. Kept stable so the content_hash dedup key is
 * consistent across access paths and over time.
 */
export function normalizeContent(text: string): string {
  return text.trim().replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n");
}

export async function sha256hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
