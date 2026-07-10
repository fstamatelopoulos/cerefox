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
 * NOT consumed by `supabase/functions/cerefox-ingest/` — Deno Edge Runtime
 * can't import from the monorepo's `_shared/`. The EF keeps its own
 * chunker copy; cross-runtime parity is enforced by shared fixture tests
 * (see `packages/memory/test/fixtures/python-parity/chunking/`).
 */

export { chunkMarkdown, chunkMarkdownExact, blindStitch, type ChunkData } from "./chunker.js";
export {
  normalizeForHash,
  contentHash,
  deriveSourcePath,
  resolveProjectIds,
  type ProjectResolveInput,
} from "./pipeline-helpers.js";
