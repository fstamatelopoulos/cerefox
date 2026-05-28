/**
 * TS port of `src/cerefox/ingestion/pipeline.py` (iter-25 Parts 25C-25E).
 *
 * Orchestrates the full parse → chunk → embed → store flow:
 *
 *   1. Hash the input (content_hash) using the shared `normalizeForHash`
 *      from `_shared/ingest/`.
 *   2. Dedup: if a doc with the same content_hash exists, return
 *      `action: "skipped"` early.
 *   3. Chunk: `_shared/ingest/chunkMarkdown` (byte-identical to Python).
 *   4. Embed: `_shared/embeddings/embedBatch` (96-chunk batching).
 *      Each chunk's embedding input is `"# {title}\n{c.content}"` for
 *      title-boosted FTS / semantic search recall (matches Python's
 *      contextual-enrichment pattern).
 *   5. Atomic write: `cerefox_ingest_document` RPC inserts the document
 *      + chunks + audit entry in one transaction.
 *   6. Project M2M: post-write `assignDocumentProjects` (full-set) or
 *      `addDocumentToProjects` (non-destructive).
 *
 * Public API matches Python's `IngestionPipeline`:
 *   - `ingestText(opts)` → IngestResult
 *   - `updateDocument(opts)` → IngestResult
 *   - `ingestFile(path, opts)` → IngestResult (thin wrapper)
 *
 * Part 25C ships the constructor + types + stubs that throw
 * "not yet implemented". Part 25D implements `ingestText`'s
 * create-and-dedup path; Part 25E implements `updateDocument` and the
 * `/edit` content-change swap; Part 25F wires the 3 web ingest
 * endpoints to use this pipeline.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { IngestionDbBridge } from "./client-bridge.ts";
import {
  DEFAULT_PIPELINE_SETTINGS,
  type IngestResult,
  type IngestTextOptions,
  type PipelineSettings,
  type UpdateDocumentOptions,
} from "./types.ts";

export interface IngestionPipelineDeps {
  supabase: SupabaseClient;
  openAiApiKey: string;
  /**
   * Embedder identifier persisted in `cerefox_chunks.embedder_primary`.
   * Defaults to the v0.4 contract value `"text-embedding-3-small"`.
   */
  embedderModel?: string;
  settings?: Partial<PipelineSettings>;
}

export class IngestionPipeline {
  readonly db: IngestionDbBridge;
  readonly apiKey: string;
  readonly embedderModel: string;
  readonly settings: PipelineSettings;

  constructor(deps: IngestionPipelineDeps) {
    this.db = new IngestionDbBridge(deps.supabase);
    this.apiKey = deps.openAiApiKey;
    this.embedderModel = deps.embedderModel ?? "text-embedding-3-small";
    this.settings = { ...DEFAULT_PIPELINE_SETTINGS, ...(deps.settings ?? {}) };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  // Implementations land in Part 25D and 25E. Stubs preserve the
  // constructor + module surface so consumers can import without
  // breaking compilation.

  async ingestText(_opts: IngestTextOptions): Promise<IngestResult> {
    throw new Error(
      "IngestionPipeline.ingestText: not yet implemented (lands in Part 25D)",
    );
  }

  async updateDocument(_opts: UpdateDocumentOptions): Promise<IngestResult> {
    throw new Error(
      "IngestionPipeline.updateDocument: not yet implemented (lands in Part 25E)",
    );
  }

  async ingestFile(
    _path: string,
    _opts: Omit<IngestTextOptions, "text" | "title"> & {
      title?: string;
    } = {},
  ): Promise<IngestResult> {
    throw new Error(
      "IngestionPipeline.ingestFile: not yet implemented (lands in Part 25D)",
    );
  }
}

export {
  type IngestResult,
  type IngestAction,
  type IngestTextOptions,
  type UpdateDocumentOptions,
  type PipelineSettings,
  DEFAULT_PIPELINE_SETTINGS,
} from "./types.ts";
