/**
 * Public types for the TS ingestion pipeline.
 *
 * Mirrors `IngestResult` + the parameter shapes from
 * `src/cerefox/ingestion/pipeline.py` so callers that previously held
 * Python `IngestResult` objects map cleanly to the TS equivalents.
 */

/** Outcome of an ingest call. */
export type IngestAction = "created" | "updated" | "skipped";

/**
 * Summary returned by every `ingestText` / `updateDocument` / `ingestFile`
 * call.
 *
 * - `action: "created"` — new document written.
 * - `action: "updated"` — existing document updated; check `reindexed`
 *   to distinguish full re-embed from a metadata-only save.
 * - `action: "skipped"` — identical content already present (content-
 *   hash match); nothing written.
 *
 * `reindexed` is only meaningful when `action === "updated"`.
 * `note` carries optional warnings (e.g. `document_id` overrides
 * `updateExisting` flag).
 */
export interface IngestResult {
  documentId: string;
  title: string;
  chunkCount: number;
  totalChars: number;
  action: IngestAction;
  reindexed: boolean;
  projectIds: string[];
  note: string;
}

/**
 * Options for `ingestText`. Mirrors `ingest_text(...)` in Python's
 * pipeline.
 *
 * Project assignment follows issue #38 semantics:
 *
 * - List form (`projectIds` or `projectNames`): full-set destructive
 *   replace on update.
 * - Singular form (`projectId` or `projectName`): non-destructive add
 *   on update.
 * - Precedence (highest first): `projectIds` > `projectNames` >
 *   `projectId` > `projectName`.
 */
export interface IngestTextOptions {
  text: string;
  title: string;
  source?: string;            // default "paste"
  sourcePath?: string | null;
  projectName?: string | null;
  projectId?: string | null;
  projectIds?: string[] | null;
  projectNames?: string[] | null;
  metadata?: Record<string, unknown> | null;
  updateExisting?: boolean;   // default false
  documentId?: string | null; // explicit update; bypasses dedup
  author?: string;             // default "unknown"
  authorType?: "user" | "agent"; // default "user"
}

/** Options for `updateDocument`. Mirrors Python's `update_document(...)`. */
export interface UpdateDocumentOptions {
  documentId: string;
  text: string;
  title: string;
  source?: string;             // default "manual"
  projectId?: string | null;
  projectIds?: string[] | null;
  metadata?: Record<string, unknown> | null;
  author?: string;
  authorType?: "user" | "agent";
}

/** Settings the pipeline needs. Subset of the broader app settings. */
export interface PipelineSettings {
  maxChunkChars: number;
  minChunkChars: number;
  versionRetentionHours: number;
  versionCleanupEnabled: boolean;
}

/** Default pipeline settings matching Python's defaults. */
export const DEFAULT_PIPELINE_SETTINGS: PipelineSettings = {
  maxChunkChars: 4000,
  minChunkChars: 100,
  versionRetentionHours: 48,
  versionCleanupEnabled: true,
};
