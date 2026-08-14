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
      sourceOnCreate,
      sourceLabel,
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
      forceRechunk = false,
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
        sourceLabel,
        projectIds: fullSetResolved,
        metadata,
        author,
        authorType,
        expectedContentHash,
        lastWriteWins,
        forceRechunk,
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
      if (existingDoc?.deleted_at && lastWriteWins) {
        // Filesystem-sync flows (ingest-dir --update-if-exists, guides
        // ingest) pass last_write_wins and re-run forever: a hard error here
        // would make every sync fail on this file until a human intervenes,
        // and updating would resurrect what a human deliberately trashed.
        // Skipping respects the deletion AND converges — the note says how
        // to resume syncing this file.
        const projIds = await this.db.getDocumentProjectIds(existingDoc.id);
        return {
          documentId: existingDoc.id,
          title: existingDoc.title ?? title,
          chunkCount: existingDoc.chunk_count ?? 0,
          totalChars: existingDoc.total_chars ?? 0,
          action: "skipped",
          reindexed: false,
          projectIds: projIds,
          note:
            `"${existingDoc.title}" is in the trash (soft-deleted ` +
            `${existingDoc.deleted_at.slice(0, 10)}) — skipped, deletion respected. ` +
            `To resume syncing this file, restore the document ` +
            `(\`cerefox document restore ${existingDoc.id}\`) or purge it from the web UI Trash.`,
          contentHash: existingDoc.content_hash ?? "",
        };
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
          sourceLabel,
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
        // A hash match on a TRASHED document reads as "already up-to-date"
        // while search shows nothing — the classic re-upload-after-delete
        // confusion (#211 round 3). Say where the content actually is.
        note: existingByHash.deleted_at
          ? `Identical content is in the TRASH as "${existingByHash.title}" ` +
            `(soft-deleted ${existingByHash.deleted_at.slice(0, 10)}). Restore it ` +
            `(\`cerefox document restore ${existingByHash.id}\` or the web UI Trash page) ` +
            `instead of re-ingesting, or purge it first to start fresh.`
          : "",
        contentHash: existingByHash.content_hash ?? hash,
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
      // `null` means "caller omitted source, keep what is stored" — but on a
      // create there is nothing stored to keep, and letting null through lands
      // on the RPC's 'agent' default, mislabelling a document a CLI user just
      // made (review bug_005). This branch is where create-vs-update is finally
      // known, so it is where the sentinel resolves.
      source: source ?? sourceOnCreate ?? null,
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
      contentHash: hash,
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
      sourceLabel,
      projectId,
      projectIds,
      metadata,
      author = "unknown",
      authorType = "user",
      expectedContentHash,
      lastWriteWins = false,
      forceRechunk = false,
    } = opts;

    // ── (1) Verify document exists ───────────────────────────────────────
    const existing = await this.db.getDocumentById(documentId);
    if (!existing) {
      throw new Error(`Document ${JSON.stringify(documentId)} not found`);
    }
    // Fast-fail BEFORE the embedding spend; the authoritative guard is in
    // the cerefox_ingest_document RPC (0.12.0). "soft-deleted" in the
    // message is load-bearing: the web edit route maps it to a 409.
    if (existing.deleted_at) {
      throw new Error(
        `Document ${documentId} ("${existing.title}") is soft-deleted (in the trash). ` +
          `A trashed document cannot be updated — restore it first ` +
          `(\`cerefox document restore ${documentId}\`, the web UI Trash page, or ` +
          `cerefox_restore_document over MCP), then re-ingest.`,
      );
    }

    // ── (2) Hash + collision check ───────────────────────────────────────
    const newHash = contentHash(text);
    const contentUnchanged = newHash === existing.content_hash;

    // Trimmed once here: this is the CLI/web entry point, and a token read
    // from a file (`--expected-content-hash "$(cat hash.txt)"`) arrives with
    // a trailing newline. The RPC compares trimmed (0.12.0); an untrimmed
    // advisory check here would fake the exact conflict the RPC fix removed.
    const expectedHashTrimmed = expectedContentHash?.trim() || null;

    if (!contentUnchanged) {
      // Optimistic-concurrency fast-fail (iter-32): a stale token fails here,
      // BEFORE the embedding spend. Advisory only — the authoritative,
      // race-free check is inside the cerefox_ingest_document RPC
      // (SELECT … FOR UPDATE). Content-unchanged saves are exempt: identical
      // content cannot lose data.
      if (
        !lastWriteWins &&
        expectedHashTrimmed &&
        expectedHashTrimmed !== existing.content_hash
      ) {
        throw new ConcurrencyConflictError(
          documentId,
          existing.content_hash,
          `CEREFOX_CONFLICT: document ${documentId} changed since it was read ` +
            `(expected hash ${expectedHashTrimmed}, current hash ${existing.content_hash}). ` +
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

    // `forceRechunk` deliberately falls through to the full re-chunk path even
    // though the content is identical. A format migration re-ingests the same
    // text on purpose — the point is to rewrite the chunk rows under the
    // current chunker. Without this escape hatch the short-circuit below wins
    // silently: `server migrate-format` reported "Converted N" while every
    // document stayed on the legacy format, reproducing the exact #164 defect
    // the command was written to fix.
    if (contentUnchanged && hasChunks && !forceRechunk) {
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
        contentHash: existing.content_hash ?? newHash,
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
      // The document's origin and the reason for this particular write are the
      // same thing for an ordinary save, and different for a maintenance pass
      // that rewrites a document without changing where it came from (#191).
      // source may now be null — "caller omitted it, keep the stored value"
      // (#193). The version label still has to say how THIS write happened, so
      // it falls through to the update path's own default rather than to null.
      sourceLabel: sourceLabel ?? source ?? "manual",
      // Deliberately NOT passed: version retention is the store's policy, read
      // by the RPC from cerefox_config. Sending this client's env values here is
      // what made the surviving history depend on which client wrote last — an
      // agent on defaults would prune versions an operator had chosen to keep.
      // Configure it with `cerefox config set version_retention_hours` or the
      // Settings page.
      // A forced re-chunk of *identical* content needs no caller-supplied
      // token: the pipeline already treats content-unchanged saves as exempt
      // from the concurrency check (nothing can be lost when the bytes match),
      // but the RPC does not know that and rejects the write with
      // CEREFOX_TOKEN_REQUIRED. Satisfy it with the hash we just compared
      // against, so `forceRechunk` works standalone instead of forcing every
      // caller to thread a token through for a no-op-equivalent write.
      expectedContentHash:
        expectedHashTrimmed ??
        (forceRechunk && contentUnchanged ? existing.content_hash : null),
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
      contentHash: newHash,
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
      source?: string | null;
    } = {},
  ): Promise<IngestResult> {
    const text = await fileToMarkdown(path, readFileSync(path));
    const absPath = resolve(path);
    const stem = basename(absPath, extname(absPath));
    return this.ingestText({
      ...opts,
      text,
      title: opts.title ?? stem,
      // `?? "file"` would turn an explicit null — "caller omitted source, keep
      // what is stored" (#193) — into a relabel. Only undefined defaults.
      source: opts.source === undefined ? "file" : opts.source,
      sourceOnCreate: opts.sourceOnCreate ?? "file",
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
