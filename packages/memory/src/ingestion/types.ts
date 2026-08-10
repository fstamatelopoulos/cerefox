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
  /**
   * The document's content_hash after this write — the optimistic-concurrency
   * token for the NEXT edit. Returned on create as well as update (#189): the
   * author of a brand-new document otherwise had to re-read a document it had
   * just written, or pass last_write_wins, on the first edit of every document
   * it created.
   */
  contentHash: string;
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
  source?: string | null;     // default "paste"; null = keep stored (#193)
  /**
   * Version-row label recording how THIS write was triggered, as distinct from
   * `source`, which is the document's own origin. Defaults to `source`, which
   * is right for ordinary saves where the two coincide.
   *
   * They diverge for maintenance commands that rewrite a document without
   * changing where it came from: `server migrate-format` preserves the
   * document's `source` and labels the version it archives "migrate-format",
   * so the history still shows which run performed the conversion (#191).
   */
  sourceLabel?: string;
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
  /**
   * Optimistic-concurrency token (iter-32): the content_hash of the document
   * version this edit was based on. Required by the RPC on content updates
   * unless `lastWriteWins` is set. Ignored on create.
   */
  expectedContentHash?: string | null;
  /** Explicitly skip the concurrency check (filesystem-sync flows). */
  lastWriteWins?: boolean;
  /**
   * Re-chunk and re-embed even when the content is byte-identical.
   *
   * Normally identical content takes the metadata-only path — re-doing the
   * work would be pure waste. But a *format* migration re-ingests exactly the
   * same text on purpose: the goal is to rewrite the chunk rows under the
   * current chunker, not to change the content. Without this the short-circuit
   * silently wins and `content_format` never advances (see
   * `server migrate-format`).
   */
  forceRechunk?: boolean;
}

/** Options for `updateDocument`. Mirrors Python's `update_document(...)`. */
export interface UpdateDocumentOptions {
  documentId: string;
  text: string;
  title: string;
  source?: string | null;      // default "manual"; null = keep stored (#193)
  /** Version-row label — see IngestTextOptions.sourceLabel. Defaults to `source`. */
  sourceLabel?: string;
  projectId?: string | null;
  projectIds?: string[] | null;
  metadata?: Record<string, unknown> | null;
  author?: string;
  authorType?: "user" | "agent";
  /** Optimistic-concurrency token — see IngestTextOptions.expectedContentHash. */
  expectedContentHash?: string | null;
  /** Explicitly skip the concurrency check (filesystem-sync flows). */
  lastWriteWins?: boolean;
  /**
   * Re-chunk and re-embed even when the content is byte-identical.
   *
   * Normally identical content takes the metadata-only path — re-doing the
   * work would be pure waste. But a *format* migration re-ingests exactly the
   * same text on purpose: the goal is to rewrite the chunk rows under the
   * current chunker, not to change the content. Without this the short-circuit
   * silently wins and `content_format` never advances (see
   * `server migrate-format`).
   */
  forceRechunk?: boolean;
}

/**
 * Thrown when a content update loses the optimistic-concurrency race
 * (iter-32): the document's content_hash moved between read and write.
 * Callers should re-read the document, merge, and retry with the new hash.
 * The web routes map this to HTTP 409.
 */
export class ConcurrencyConflictError extends Error {
  readonly documentId: string;
  readonly currentHash: string | null;
  constructor(documentId: string, currentHash: string | null, message: string) {
    super(message);
    this.name = "ConcurrencyConflictError";
    this.documentId = documentId;
    this.currentHash = currentHash;
  }
}

/**
 * Thrown when a content update supplies neither expectedContentHash nor
 * lastWriteWins. The web routes map this to HTTP 400.
 */
export class ConcurrencyTokenRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConcurrencyTokenRequiredError";
  }
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

/**
 * Pipeline settings with `.env` overrides applied over the defaults. The Python
 * runtime read these; the TS migration dropped them. Honors
 * CEREFOX_MAX_CHUNK_CHARS, CEREFOX_MIN_CHUNK_CHARS, CEREFOX_VERSION_RETENTION_HOURS,
 * and CEREFOX_VERSION_CLEANUP_ENABLED. Used as the pipeline's default settings.
 */
export function loadPipelineSettings(): PipelineSettings {
  const env =
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const intMin = (raw: string | undefined, def: number, min: number): number => {
    if (raw === undefined || raw === "") return def;
    const n = Number.parseInt(raw, 10);
    return Number.isNaN(n) || n < min ? def : n;
  };
  const bool = (raw: string | undefined, def: boolean): boolean =>
    raw === undefined || raw === "" ? def : !/^(false|0|no|off)$/i.test(raw.trim());
  return {
    maxChunkChars: intMin(env.CEREFOX_MAX_CHUNK_CHARS, DEFAULT_PIPELINE_SETTINGS.maxChunkChars, 1),
    minChunkChars: intMin(env.CEREFOX_MIN_CHUNK_CHARS, DEFAULT_PIPELINE_SETTINGS.minChunkChars, 0),
    versionRetentionHours: intMin(
      env.CEREFOX_VERSION_RETENTION_HOURS,
      DEFAULT_PIPELINE_SETTINGS.versionRetentionHours,
      0,
    ),
    versionCleanupEnabled: bool(
      env.CEREFOX_VERSION_CLEANUP_ENABLED,
      DEFAULT_PIPELINE_SETTINGS.versionCleanupEnabled,
    ),
  };
}
