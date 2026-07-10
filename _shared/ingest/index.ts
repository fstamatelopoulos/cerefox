/**
 * `_shared/ingest/` — chunking + embedding orchestration + content-hashing
 * utilities used by the v0.7 TS ingestion pipeline + the CLI ingest path.
 *
 * Consumers:
 *   - `packages/memory/src/ingestion/pipeline.ts` (the IngestionPipeline)
 *   - `packages/memory/src/cli/commands/ingest.ts` (v0.7 in-process variant)
 *   - `packages/memory/src/web/routes/ingest.ts` (the 3 endpoints unblocked
 *     in Part 25F)
 *   - `packages/memory/src/web/routes/documents-write.ts` (v0.6's /edit
 *     content-hash short-circuit, now using the shared helper)
 *
 * Also consumed by `supabase/functions/cerefox-ingest/` and
 * `_shared/mcp-tools/_chunker.ts` (iter-28D Phase 1 consolidation) — the
 * chunker lives here only; the EF bundles `_shared/ingest/` via
 * `bundle_server_assets.ts`, the same way it bundles `ef-auth`/`embeddings`.
 */

export {
  chunkMarkdown,
  blindStitch,
  CONTENT_FORMAT_BLIND_STITCH,
  type ChunkData,
} from "./chunker.js";
export {
  normalizeForHash,
  contentHash,
  deriveSourcePath,
  resolveProjectIds,
  type ProjectResolveInput,
} from "./pipeline-helpers.js";
