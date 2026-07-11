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
  CONTENT_FORMAT_BLIND_STITCH,
  contentHash,
  deriveSourcePath,
  embeddingInputFor,
  resolveProjectIds,
} from "../../../../_shared/ingest/index.ts";
import { activeEmbedderName, embedBatch } from "../../../../_shared/embeddings/index.ts";
import {
  IngestionDbBridge,
  type ChunkInsertRow,
} from "./client-bridge.ts";
import { fileToMarkdown } from "./file-to-markdown.ts";
import {
  ConcurrencyConflictError,
  loadPipelineSettings,
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
    this.embedderModel = deps.embedderModel ?? activeEmbedderName();
    this.settings = { ...loadPipelineSettings(), ...(deps.settings ?? {}) };
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
      expectedContentHash,
      lastWriteWins = false,
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
        expectedContentHash,
        lastWriteWins,
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
          expectedContentHash,
          lastWriteWins,
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
      const texts = chunks.map((c) => embeddingInputFor(title, c));
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
      contentFormat: CONTENT_FORMAT_BLIND_STITCH,
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
   * Re-ingest an existing document in place, preserving its ID. Mirrors
   * Python's `update_document`.
   *
   * Three sub-paths:
   *   1. **Content unchanged + chunks exist** → metadata-only update.
   *      Update title/metadata via direct UPDATE; if the title changed,
   *      re-embed all chunks (contextual enrichment) + refresh FTS;
   *      create an `update-metadata` audit entry (client-side, not via
   *      the RPC).
   *   2. **Content changed** → call `cerefox_ingest_document` RPC with
   *      `documentId`; the RPC internally snapshots old chunks as a
   *      version, then inserts the new chunks. `reindexed = true`.
   *   3. **Content unchanged + no chunks** → data-corruption guard;
   *      Python errors here. Currently treated as a metadata-only
   *      update (less strict, but recoverable).
   *
   * Project assignment is updated only when `projectIds` (or legacy
   * `projectId`) is explicitly provided. `null` / `undefined` leaves
   * the existing assignments unchanged; `[]` removes from all projects.
   *
   * @throws if the document is not found, or if the new content
   *   collides with a DIFFERENT document's content_hash.
   */
  async updateDocument(opts: UpdateDocumentOptions): Promise<IngestResult> {
    const {
      documentId,
      text,
      title,
      source = "manual",
      projectId,
      projectIds,
      metadata,
      author = "unknown",
      authorType = "user",
      expectedContentHash,
      lastWriteWins = false,
    } = opts;

    // ── (1) Verify document exists ───────────────────────────────────────
    const existing = await this.db.getDocumentById(documentId);
    if (!existing) {
      throw new Error(`Document ${JSON.stringify(documentId)} not found`);
    }

    // ── (2) Hash + collision check ───────────────────────────────────────
    const newHash = contentHash(text);
    const contentUnchanged = newHash === existing.content_hash;

    if (!contentUnchanged) {
      // Optimistic-concurrency fast-fail (iter-32): a stale token fails here,
      // BEFORE the embedding spend. Advisory only — the authoritative,
      // race-free check is inside the cerefox_ingest_document RPC
      // (SELECT … FOR UPDATE). Content-unchanged saves are exempt: identical
      // content cannot lose data.
      if (
        !lastWriteWins &&
        expectedContentHash &&
        expectedContentHash !== existing.content_hash
      ) {
        throw new ConcurrencyConflictError(
          documentId,
          existing.content_hash,
          `CEREFOX_CONFLICT: document ${documentId} changed since it was read ` +
            `(expected hash ${expectedContentHash}, current hash ${existing.content_hash}). ` +
            `Re-read the document, merge your changes, and retry with the new hash.`,
        );
      }

      const collision = await this.db.getDocumentByHash(newHash);
      if (collision && collision.id !== documentId) {
        throw new Error(
          `Identical content already exists as document ${JSON.stringify(collision.title)}. ` +
            "Edit that document or change the content before saving.",
        );
      }
    }

    // ── (3) Resolve project assignments ──────────────────────────────────
    let newProjectIds: string[] | null = null;
    if (projectIds !== undefined && projectIds !== null) {
      newProjectIds = projectIds.filter((p) => p);
    } else if (projectId !== undefined && projectId !== null) {
      newProjectIds = [projectId];
    }

    // ── Branch: metadata-only update ─────────────────────────────────────
    const actualChunks = await this.db.listChunksForDocument(documentId);
    const hasChunks = actualChunks.length > 0;

    if (contentUnchanged && hasChunks) {
      const oldTitle = existing.title ?? "";
      const titleChanged = oldTitle !== title;

      const updates: Record<string, unknown> = { title };
      if (metadata !== undefined && metadata !== null) {
        updates.metadata = metadata;
      }
      await this.db.updateDocumentRow(documentId, updates);

      // Title-change re-embed (contextual enrichment).
      if (titleChanged) {
        const texts = actualChunks.map((c) => embeddingInputFor(title, c));
        try {
          const embeddings = await embedBatch(texts, this.apiKey);
          for (let i = 0; i < actualChunks.length; i++) {
            await this.db.updateChunkEmbedding(
              actualChunks[i].id,
              embeddings[i],
              this.embedderModel,
            );
          }
        } catch (err) {
          // Match Python: log a warning but don't block the metadata save.
          // eslint-disable-next-line no-console
          console.warn(
            `Failed to re-embed chunks after title change for ${documentId}:`,
            err,
          );
        }
        try {
          await this.db.updateChunkFts(documentId, title);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `Failed to update FTS after title change for ${documentId}:`,
            err,
          );
        }
      }

      // Project membership.
      let finalProjectIds: string[];
      if (newProjectIds !== null) {
        await this.db.assignDocumentProjects(documentId, newProjectIds);
        finalProjectIds = newProjectIds;
      } else {
        finalProjectIds = await this.db.getDocumentProjectIds(documentId);
      }

      const chunkCount = existing.chunk_count ?? 0;
      const totalChars = existing.total_chars ?? 0;

      await this.db.createAuditEntry({
        operation: "update-metadata",
        author,
        authorType,
        documentId,
        sizeBefore: totalChars,
        sizeAfter: totalChars,
        description: `Updated metadata for '${title}' (content unchanged)`,
      });

      return {
        documentId,
        title,
        chunkCount,
        totalChars,
        action: "updated",
        reindexed: false,
        projectIds: finalProjectIds,
        note: "",
      };
    }

    // ── Branch: content changed (or no chunks) ───────────────────────────
    const chunks = chunkMarkdown(
      text,
      this.settings.maxChunkChars,
      this.settings.minChunkChars,
    );
    const totalChars = chunks.reduce((acc, c) => acc + c.char_count, 0);

    let chunkRows: ChunkInsertRow[] = [];
    if (chunks.length > 0) {
      const texts = chunks.map((c) => embeddingInputFor(title, c));
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

    const reviewStatus =
      authorType === "agent" ? "pending_review" : "approved";

    // metadata semantics: undefined/null → keep existing; otherwise use new.
    const metaToWrite =
      metadata !== undefined && metadata !== null
        ? metadata
        : (existing.metadata as Record<string, unknown>) ?? {};

    await this.db.ingestDocumentRpc({
      documentId,
      title,
      source,
      sourcePath: existing.source_path,
      contentHash: newHash,
      metadata: metaToWrite,
      reviewStatus,
      chunks: chunkRows,
      contentFormat: CONTENT_FORMAT_BLIND_STITCH,
      author,
      authorType,
      sourceLabel: source,
      retentionHours: this.settings.versionRetentionHours,
      cleanupEnabled: this.settings.versionCleanupEnabled,
      expectedContentHash: expectedContentHash ?? null,
      lastWriteWins,
    });

    // Update project membership if explicitly provided.
    let finalProjectIds: string[];
    if (newProjectIds !== null) {
      await this.db.assignDocumentProjects(documentId, newProjectIds);
      finalProjectIds = newProjectIds;
    } else {
      finalProjectIds = await this.db.getDocumentProjectIds(documentId);
    }

    return {
      documentId,
      title,
      chunkCount: chunks.length,
      totalChars,
      action: "updated",
      reindexed: true,
      projectIds: finalProjectIds,
      note: "",
    };
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
    const text = await fileToMarkdown(path, readFileSync(path));
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
  ConcurrencyConflictError,
  ConcurrencyTokenRequiredError,
  DEFAULT_PIPELINE_SETTINGS,
} from "./types.ts";
