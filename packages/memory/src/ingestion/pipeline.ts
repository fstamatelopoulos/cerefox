/**
 * TS port of `src/cerefox/ingestion/pipeline.py`.
 *
 * Orchestrates the full parse → chunk → embed → store flow.
 *
 * Public API mirrors Python's `IngestionPipeline`:
 *   - `ingestText(opts)` → IngestResult
 *   - `updateDocument(opts)` → IngestResult
 *   - `ingestFile(path, opts)` → IngestResult (thin wrapper)
 *
 * Project semantics (issue #38):
 *   - List form (`projectIds` or `projectNames`): full-set destructive
 *     replace on update.
 *   - Singular form (`projectId` or `projectName`): non-destructive add
 *     on update.
 *
 * Review status routing:
 *   - `authorType: "agent"` + write → `pending_review`
 *   - `authorType: "user"` + write → `approved`
 */

import { readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  chunkMarkdown,
  contentHash,
  deriveSourcePath,
  resolveProjectIds,
} from "../../../../_shared/ingest/index.ts";
import { embedBatch } from "../../../../_shared/embeddings/index.ts";
import {
  IngestionDbBridge,
  type ChunkInsertRow,
} from "./client-bridge.ts";
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

  /**
   * Ingest raw markdown. Mirrors Python's `ingest_text`.
   *
   * Outcomes:
   *   - `documentId` provided → routes to `updateDocument` (returns
   *     `action: "updated"`).
   *   - `updateExisting && existing-by-source-path-or-title` → routes
   *     to `updateDocument` (returns `action: "updated"`).
   *   - Content-hash collision with an existing doc → returns
   *     `action: "skipped"`.
   *   - Otherwise → chunks + embeds + RPC; returns `action: "created"`.
   */
  async ingestText(opts: IngestTextOptions): Promise<IngestResult> {
    const {
      text,
      title,
      source = "paste",
      sourcePath: sourcePathOpt,
      projectName,
      projectId,
      projectIds,
      projectNames,
      metadata,
      updateExisting = false,
      documentId,
      author = "unknown",
      authorType = "user",
    } = opts;

    const listFormProvided =
      (projectIds !== undefined && projectIds !== null) ||
      (projectNames !== undefined && projectNames !== null);
    const getOrCreate = (name: string) => this.db.getOrCreateProject(name);

    // ── (1) ID-based update ──────────────────────────────────────────────
    if (documentId) {
      const existing = await this.db.getDocumentById(documentId);
      if (!existing) {
        throw new Error(`Document not found: ${documentId}`);
      }
      let fullSetResolved: string[] | null = null;
      if (listFormProvided) {
        fullSetResolved = await resolveProjectIds(
          { projectIds, projectNames },
          getOrCreate,
        );
      }
      const result = await this.updateDocument({
        documentId,
        text,
        title,
        source,
        projectIds: fullSetResolved,
        metadata,
        author,
        authorType,
      });
      if (!listFormProvided && (projectId || projectName)) {
        const singular = await resolveProjectIds(
          { projectId, projectName },
          getOrCreate,
        );
        if (singular.length > 0) {
          await this.db.addDocumentToProjects(documentId, singular);
          result.projectIds = await this.db.getDocumentProjectIds(documentId);
        }
      }
      if (!updateExisting) {
        result.note =
          "document_id provided; update_if_exists flag was overridden";
      }
      return result;
    }

    // ── (2) update-existing shortcut ────────────────────────────────────
    if (updateExisting) {
      let existingDoc = null;
      if (sourcePathOpt) {
        existingDoc = await this.db.findDocumentBySourcePath(sourcePathOpt);
      }
      if (!existingDoc) {
        existingDoc = await this.db.findDocumentByTitle(title);
      }
      if (existingDoc) {
        let fullSetResolved: string[] | null = null;
        if (listFormProvided) {
          fullSetResolved = await resolveProjectIds(
            { projectIds, projectNames },
            getOrCreate,
          );
        }
        const result = await this.updateDocument({
          documentId: existingDoc.id,
          text,
          title,
          source,
          projectIds: fullSetResolved,
          metadata,
          author,
          authorType,
        });
        if (!listFormProvided && (projectId || projectName)) {
          const singular = await resolveProjectIds(
            { projectId, projectName },
            getOrCreate,
          );
          if (singular.length > 0) {
            await this.db.addDocumentToProjects(existingDoc.id, singular);
            result.projectIds = await this.db.getDocumentProjectIds(
              existingDoc.id,
            );
          }
        }
        return result;
      }
      // No match found — fall through to create.
    }

    // ── (3) Resolve projects for the create path ─────────────────────────
    const resolvedIds = await resolveProjectIds(
      { projectIds, projectId, projectName, projectNames },
      getOrCreate,
    );

    const validatedMeta = metadata ?? {};

    // ── (4) Hash + dedup ─────────────────────────────────────────────────
    const hash = contentHash(text);
    const existingByHash = await this.db.getDocumentByHash(hash);
    if (existingByHash) {
      const existingProjectIds = await this.db.getDocumentProjectIds(
        existingByHash.id,
      );
      return {
        documentId: existingByHash.id,
        title: existingByHash.title ?? title,
        chunkCount: existingByHash.chunk_count ?? 0,
        totalChars: existingByHash.total_chars ?? 0,
        action: "skipped",
        reindexed: false,
        projectIds: existingProjectIds,
        note: "",
      };
    }

    // ── (5) Chunk ────────────────────────────────────────────────────────
    const chunks = chunkMarkdown(
      text,
      this.settings.maxChunkChars,
      this.settings.minChunkChars,
    );
    const totalChars = chunks.reduce((acc, c) => acc + c.char_count, 0);

    // ── (6) Derive source_path if missing ────────────────────────────────
    const sourcePath = sourcePathOpt ?? deriveSourcePath(title);

    // ── (7) Embed chunks (title-boosted) ─────────────────────────────────
    let chunkRows: ChunkInsertRow[] = [];
    if (chunks.length > 0) {
      const texts = chunks.map((c) => `# ${title}\n${c.content}`);
      const embeddings = await embedBatch(texts, this.apiKey);
      chunkRows = chunks.map((c, i) => ({
        chunk_index: c.chunk_index,
        heading_path: c.heading_path,
        heading_level: c.heading_level,
        title: c.title,
        content: c.content,
        char_count: c.char_count,
        embedding: embeddings[i],
        embedder: this.embedderModel,
      }));
    }

    // ── (8) Atomic RPC write ─────────────────────────────────────────────
    const reviewStatus =
      authorType === "agent" ? "pending_review" : "approved";
    const rpcResult = await this.db.ingestDocumentRpc({
      documentId: null,
      title,
      source,
      sourcePath,
      contentHash: hash,
      metadata: validatedMeta,
      reviewStatus,
      chunks: chunkRows,
      author,
      authorType,
    });
    const newDocumentId = rpcResult.document_id;

    // ── (9) Project M2M ──────────────────────────────────────────────────
    if (resolvedIds.length > 0) {
      await this.db.assignDocumentProjects(newDocumentId, resolvedIds);
    }

    return {
      documentId: newDocumentId,
      title,
      chunkCount: chunks.length,
      totalChars,
      action: "created",
      reindexed: false,
      projectIds: resolvedIds,
      note: "",
    };
  }

  /**
   * Re-ingest an existing document in place. Lands in Part 25E.
   * Currently stubbed — `ingestText` delegates here for the
   * `documentId` and `updateExisting` branches; both paths throw with
   * a clear message until 25E.
   */
  async updateDocument(_opts: UpdateDocumentOptions): Promise<IngestResult> {
    throw new Error(
      "IngestionPipeline.updateDocument: lands in Part 25E. For v0.7 Part 25D, " +
        "ingestText's create + dedup paths are functional; update branches " +
        "(documentId / updateExisting on existing doc) are not yet wired.",
    );
  }

  /**
   * Read a markdown file from disk and ingest it. Thin wrapper around
   * `ingestText`. Mirrors Python's `ingest_file`.
   *
   * - `title` defaults to the filename stem.
   * - `source` defaults to `"file"`.
   * - `sourcePath` is the resolved absolute path of the input.
   */
  async ingestFile(
    path: string,
    opts: Omit<IngestTextOptions, "text" | "title" | "sourcePath" | "source"> & {
      title?: string;
      source?: string;
    } = {},
  ): Promise<IngestResult> {
    const text = readFileSync(path, "utf8");
    const absPath = resolve(path);
    const stem = basename(absPath, extname(absPath));
    return this.ingestText({
      ...opts,
      text,
      title: opts.title ?? stem,
      source: opts.source ?? "file",
      sourcePath: absPath,
    });
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
