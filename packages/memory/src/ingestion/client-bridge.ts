/**
 * Thin DB-call layer for the TS ingestion pipeline.
 *
 * Replaces the subset of Python `CerefoxClient` methods the pipeline
 * needs (per the iter-25 coverage matrix). Python `CerefoxClient` stays
 * intact for the Python MCP server (which keeps it alive through
 * v0.9+ per the Python-minimization policy).
 *
 * Methods here are 1:1 wrappers over `@supabase/supabase-js` calls
 * (`supabase.rpc(...)` or `supabase.from(...).select/insert/update`).
 * No business logic in this file — it's a typed bridge.
 *
 * Public API match (Python → TS):
 *   get_document_by_id → getDocumentById
 *   get_document_by_hash → getDocumentByHash
 *   find_document_by_title → findDocumentByTitle
 *   find_document_by_source_path → findDocumentBySourcePath
 *   list_chunks_for_document → listChunksForDocument
 *   get_document_project_ids → getDocumentProjectIds
 *   ingest_document_rpc → ingestDocumentRpc
 *   update_document → updateDocumentRow
 *   update_chunk_embedding → updateChunkEmbedding
 *   update_chunk_fts → updateChunkFts
 *   assign_document_projects → assignDocumentProjects (destructive)
 *   add_document_to_projects → addDocumentToProjects (non-destructive)
 *   get_or_create_project → getOrCreateProject
 *   create_audit_entry → createAuditEntry
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPages } from "../../../../_shared/db-client/paginate.ts";
import { extractConflictHashes } from "../../../../_shared/mcp-tools/_utils.ts";

import {
  ConcurrencyConflictError,
  ConcurrencyTokenRequiredError,
} from "./types.ts";

// ── Types ───────────────────────────────────────────────────────────────────

export interface DocumentRow {
  id: string;
  title: string;
  source: string | null;
  source_path: string | null;
  content_hash: string | null;
  metadata: Record<string, unknown> | null;
  chunk_count: number;
  total_chars: number;
  review_status: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ChunkRowForUpdate {
  id: string;
  document_id: string;
  chunk_index: number;
  heading_path: string[];
  heading_level: number | null;
  title: string;
  content: string;
  char_count: number;
}

/**
 * Shape of the chunk payload passed to `cerefox_ingest_document` RPC.
 * Embedding is the 768-dim float vector.
 *
 * Field names match the RPC's `c->>'embedding'` / `c->>'embedder'`
 * lookups in `rpcs.sql:1169-1170`. Python's client method translates
 * its `embedding_primary` / `embedder_primary` to these names before
 * sending; the TS bridge writes them directly.
 */
export interface ChunkInsertRow {
  chunk_index: number;
  heading_path: string[];
  heading_level: number;
  title: string;
  content: string;
  char_count: number;
  embedding: number[];
  embedder: string;
}

export interface IngestDocumentRpcResult {
  document_id: string;
  chunk_count: number;
  total_chars: number;
  operation: "create" | "update-content";
  version_id: string | null;
}

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
}

// ── Bridge class ────────────────────────────────────────────────────────────

export class IngestionDbBridge {
  constructor(private readonly supabase: SupabaseClient) {}

  // ── Documents (read) ──────────────────────────────────────────────────────

  async getDocumentById(documentId: string): Promise<DocumentRow | null> {
    const { data } = await this.supabase
      .from("cerefox_documents")
      .select("*")
      .eq("id", documentId)
      .maybeSingle();
    return (data as DocumentRow | null) ?? null;
  }

  async getDocumentByHash(contentHash: string): Promise<DocumentRow | null> {
    // No `deleted_at` filter, deliberately: soft-deleted docs still occupy
    // the store-wide unique constraint on `content_hash`, so a create with
    // identical content WILL collide with a trashed doc. Finding it lets the
    // pipeline return action=skipped with a note saying the content is in
    // the trash, instead of crashing on insert.
    const { data } = await this.supabase
      .from("cerefox_documents")
      .select("*")
      .eq("content_hash", contentHash)
      .limit(1);
    const rows = (data ?? []) as DocumentRow[];
    return rows.length > 0 ? rows[0] : null;
  }

  /** Prefer-live resolution: a LIVE match always wins over a trashed one.
   *
   *  Nothing enforces title uniqueness, and soft delete bumps updated_at, so
   *  a recency-ordered lookup that sees the trash would resolve a
   *  freshly-trashed twin over the live document — making the live one
   *  unreachable via update-if-exists. Trashed docs are still returned when
   *  they are the ONLY match, so the update path can refuse with "restore
   *  first" BEFORE the embedding spend (the old comment here claimed the
   *  no-filter lookup let updates "resurrect" trashed docs — never true;
   *  nothing cleared deleted_at, content just vanished into the trash). */
  private async findPreferLive(column: string, value: string): Promise<DocumentRow | null> {
    const live = await this.supabase
      .from("cerefox_documents")
      .select("*")
      .eq(column, value)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1);
    const liveRows = (live.data ?? []) as DocumentRow[];
    if (liveRows.length > 0) return liveRows[0];
    const any = await this.supabase
      .from("cerefox_documents")
      .select("*")
      .eq(column, value)
      .order("updated_at", { ascending: false })
      .limit(1);
    const anyRows = (any.data ?? []) as DocumentRow[];
    return anyRows.length > 0 ? anyRows[0] : null;
  }

  async findDocumentByTitle(title: string): Promise<DocumentRow | null> {
    return this.findPreferLive("title", title);
  }

  async findDocumentBySourcePath(sourcePath: string): Promise<DocumentRow | null> {
    return this.findPreferLive("source_path", sourcePath);
  }

  async listChunksForDocument(documentId: string): Promise<ChunkRowForUpdate[]> {
    // Paginated: a document can exceed the 1000-row cap (#135).
    const data = await fetchAllPages<ChunkRowForUpdate>((from, to) =>
      this.supabase
        .from("cerefox_chunks")
        .select(
          "id, document_id, chunk_index, heading_path, heading_level, title, content, char_count",
        )
        .eq("document_id", documentId)
        .is("version_id", null)
        .order("chunk_index")
        .range(from, to),
    );
    return (data ?? []) as ChunkRowForUpdate[];
  }

  async getDocumentProjectIds(documentId: string): Promise<string[]> {
    const { data } = await this.supabase
      .from("cerefox_document_projects")
      .select("project_id")
      .eq("document_id", documentId);
    return ((data ?? []) as Array<{ project_id: string }>).map(
      (r) => r.project_id,
    );
  }

  // ── Documents (write) ─────────────────────────────────────────────────────

  /**
   * Call the `cerefox_ingest_document` RPC — atomic transaction that
   * either INSERTs (when `documentId === null`) or UPDATEs (when
   * `documentId` is a UUID; old chunks are snapshotted to a version)
   * the document + its chunks, plus inserts the audit entry.
   */
  async ingestDocumentRpc(args: {
    documentId: string | null;
    title: string;
    /** null = "not provided": create uses the RPC default, update keeps the stored value (#191, #193). */
    source: string | null;
    sourcePath: string | null;
    contentHash: string;
    metadata: Record<string, unknown>;
    reviewStatus: "approved" | "pending_review";
    chunks: ChunkInsertRow[];
    author: string;
    authorType: "user" | "agent";
    sourceLabel?: string;
    retentionHours?: number;
    cleanupEnabled?: boolean;
    expectedContentHash?: string | null;
    lastWriteWins?: boolean;
    /** iter-28D: chunk reconstruction format (2 = exact-partition/blind-stitch). */
    contentFormat?: number;
  }): Promise<IngestDocumentRpcResult> {
    const params: Record<string, unknown> = {
      p_document_id: args.documentId,
      p_title: args.title,
      p_source: args.source,
      p_source_path: args.sourcePath,
      p_content_hash: args.contentHash,
      p_metadata: args.metadata,
      p_review_status: args.reviewStatus,
      p_chunks: args.chunks,
      p_author: args.author,
      p_author_type: args.authorType,
    };
    if (args.sourceLabel !== undefined) params.p_source_label = args.sourceLabel;
    if (args.retentionHours !== undefined)
      params.p_retention_hours = args.retentionHours;
    if (args.cleanupEnabled !== undefined)
      params.p_cleanup_enabled = args.cleanupEnabled;
    if (args.contentFormat !== undefined) params.p_content_format = args.contentFormat;
    // Optimistic concurrency (iter-32). Always sent on the update path so the
    // RPC's token-required default applies; the RPC ignores both on create.
    if (args.documentId !== null) {
      params.p_expected_content_hash = args.expectedContentHash ?? null;
      params.p_last_write_wins = args.lastWriteWins ?? false;
    }

    const { data, error } = await this.supabase.rpc(
      "cerefox_ingest_document",
      params,
    );
    if (error) {
      const msg = error.message ?? JSON.stringify(error);
      if (msg.includes("CEREFOX_CONFLICT")) {
        const { current } = extractConflictHashes(msg);
        throw new ConcurrencyConflictError(
          args.documentId ?? "",
          current === "unknown" ? null : current,
          msg,
        );
      }
      if (msg.includes("CEREFOX_TOKEN_REQUIRED")) {
        throw new ConcurrencyTokenRequiredError(msg);
      }
      throw new Error(msg);
    }
    // RPC returns either a single object or an array-with-one-object
    // depending on Supabase client version. Normalise.
    if (Array.isArray(data) && data.length > 0) {
      return data[0] as IngestDocumentRpcResult;
    }
    return data as IngestDocumentRpcResult;
  }

  /** Direct UPDATE on the documents row. Used for metadata-only updates. */
  async updateDocumentRow(
    documentId: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.supabase
      .from("cerefox_documents")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", documentId);
    if (error) throw new Error(error.message ?? JSON.stringify(error));
  }

  async updateChunkEmbedding(
    chunkId: string,
    embedding: number[],
    embedderName: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from("cerefox_chunks")
      .update({
        embedding_primary: embedding,
        embedder_primary: embedderName,
      })
      .eq("id", chunkId);
    if (error) throw new Error(error.message ?? JSON.stringify(error));
  }

  /**
   * Refresh the FTS tsvector on all current chunks of a document
   * (used after a title change for the contextual-enrichment path).
   * Calls the `cerefox_update_chunk_fts` RPC.
   */
  async updateChunkFts(documentId: string, newTitle: string): Promise<void> {
    const { error } = await this.supabase.rpc("cerefox_update_chunk_fts", {
      p_document_id: documentId,
      p_new_title: newTitle,
    });
    if (error) throw new Error(error.message ?? JSON.stringify(error));
  }

  // ── Project M2M ───────────────────────────────────────────────────────────

  /**
   * Destructive replace — clears existing junction rows then inserts
   * the new set. Use for "set the full project membership" (issue #38
   * list form).
   */
  async assignDocumentProjects(
    documentId: string,
    projectIds: string[],
  ): Promise<void> {
    await this.supabase
      .from("cerefox_document_projects")
      .delete()
      .eq("document_id", documentId);
    if (projectIds.length === 0) return;
    const rows = projectIds.map((pid) => ({
      document_id: documentId,
      project_id: pid,
    }));
    const { error } = await this.supabase
      .from("cerefox_document_projects")
      .insert(rows);
    if (error) throw new Error(error.message ?? JSON.stringify(error));
  }

  /**
   * Non-destructive add — inserts junction rows for any project_id not
   * already linked. Use for "ensure this membership exists, leave
   * others alone" (issue #38 singular form).
   */
  async addDocumentToProjects(
    documentId: string,
    projectIds: string[],
  ): Promise<void> {
    if (projectIds.length === 0) return;
    const existing = await this.getDocumentProjectIds(documentId);
    const toAdd = projectIds.filter((pid) => !existing.includes(pid));
    if (toAdd.length === 0) return;
    const rows = toAdd.map((pid) => ({
      document_id: documentId,
      project_id: pid,
    }));
    const { error } = await this.supabase
      .from("cerefox_document_projects")
      .insert(rows);
    if (error) throw new Error(error.message ?? JSON.stringify(error));
  }

  async getOrCreateProject(
    name: string,
    audit?: { author: string; authorType: "user" | "agent" },
  ): Promise<ProjectRow> {
    // 0.14.0 (#219): resolution and creation go through the RPC, which
    // audits an actual create in the same transaction as the insert. An
    // existing project comes back untouched and unaudited.
    const { data, error } = await this.supabase.rpc("cerefox_create_project", {
      p_name: name,
      p_description: "",
      p_author: audit?.author ?? "unknown",
      p_author_type: audit?.authorType ?? "user",
      p_if_exists: "return",
    });
    if (error) throw new Error(error.message ?? JSON.stringify(error));
    const row = (data as Array<{ project_id: string; project_name: string }> | null)?.[0];
    if (!row) throw new Error(`getOrCreateProject(${name}) returned no data`);
    // The RPC returns id + name; description is not part of resolution.
    return { id: row.project_id, name: row.project_name, description: null };
  }

  // ── Audit ─────────────────────────────────────────────────────────────────

  /**
   * Create an audit log entry. Pipeline uses this for the
   * `update-metadata` branch (content unchanged but title/metadata
   * changed); `create` and `update-content` entries are emitted by the
   * `cerefox_ingest_document` RPC itself.
   */
  async createAuditEntry(args: {
    operation: string;
    author: string;
    authorType?: "user" | "agent";
    documentId?: string | null;
    versionId?: string | null;
    sizeBefore?: number | null;
    sizeAfter?: number | null;
    description?: string;
  }): Promise<void> {
    try {
      await this.supabase.rpc("cerefox_create_audit_entry", {
        p_document_id: args.documentId ?? null,
        p_version_id: args.versionId ?? null,
        p_operation: args.operation,
        p_author: args.author,
        p_author_type: args.authorType ?? "user",
        p_size_before: args.sizeBefore ?? null,
        p_size_after: args.sizeAfter ?? null,
        p_description: args.description ?? "",
      });
    } catch {
      // Audit failures don't block the user-visible operation — Python
      // logs a warning and continues; we match that behaviour.
    }
  }
}
