/**
 * Supabase implementation of the `BackupDb` interface (iter-26 Part 26K).
 * Mirrors the column sets used by the Python `CerefoxClient` backup methods
 * so backups round-trip across both runtimes.
 */

import type { BackupDb } from "./index.js";

const DOC_COLUMNS =
  "id, title, source, source_path, content_hash, metadata, " +
  "chunk_count, total_chars, created_at, updated_at";

const CHUNK_COLUMNS =
  "id, document_id, chunk_index, heading_path, heading_level, " +
  "title, content, char_count, version_id, " +
  "embedding_primary, embedding_upgrade, embedder_primary, embedder_upgrade, created_at";

// Minimal structural type for the supabase client we use.
interface SupabaseLike {
  from(table: string): {
    select: (cols: string, opts?: unknown) => any;
    insert: (rows: unknown) => any;
  };
}

import { fetchAllPages } from "../db-client/paginate.js";

export function makeBackupDb(raw: SupabaseLike): BackupDb {
  return {
    async listAllDocuments() {
      const batchSize = 200;
      let offset = 0;
      const results: Record<string, unknown>[] = [];
      // Paginate so the default row cap can't silently truncate the backup.
      for (;;) {
        const { data, error } = await raw
          .from("cerefox_documents")
          .select(DOC_COLUMNS)
          .order("created_at")
          .range(offset, offset + batchSize - 1);
        if (error) throw new Error(error.message ?? JSON.stringify(error));
        const page = (data ?? []) as Record<string, unknown>[];
        results.push(...page);
        if (page.length < batchSize) break;
        offset += batchSize;
      }
      return results;
    },

    async listChunksForDocument(documentId: string) {
      // Paginated: a single document can exceed the 1000-row cap, which would
      // silently back up a truncated chunk list (#135, same class as #131).
      return await fetchAllPages<Record<string, unknown>>((from, to) =>
        raw
          .from("cerefox_chunks")
          .select(CHUNK_COLUMNS)
          .eq("document_id", documentId)
          .is("version_id", null)
          .order("chunk_index")
          .range(from, to),
      );
    },

    async getDocumentByHash(contentHash: string) {
      const { data, error } = await raw
        .from("cerefox_documents")
        .select("id")
        .eq("content_hash", contentHash)
        .maybeSingle();
      if (error) throw new Error(error.message ?? JSON.stringify(error));
      return (data as Record<string, unknown> | null) ?? null;
    },

    async insertDocument(doc: Record<string, unknown>) {
      const { data, error } = await raw
        .from("cerefox_documents")
        .insert(doc)
        .select("id")
        .single();
      if (error) throw new Error(error.message ?? JSON.stringify(error));
      return { id: (data as { id: string }).id };
    },

    async insertChunks(chunks: Record<string, unknown>[]) {
      const { error } = await raw.from("cerefox_chunks").insert(chunks);
      if (error) throw new Error(error.message ?? JSON.stringify(error));
    },
  };
}
