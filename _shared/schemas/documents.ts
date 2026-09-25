/**
 * Schemas for document read/write endpoints.
 *
 * Python source: `src/cerefox/api/routes_api.py`
 *   - DocumentDetailResponse        (line 623)
 *   - DocumentVersionResponse       (line 257)
 *   - ChunkResponse                 (line 638)
 *   - FilenameCheckResponse         (line 1124)
 *
 * Part 24D ships the read side: GET /documents/{id}, /chunks, /versions,
 * /download, /check-filename. Write endpoints (Part 24E) reuse
 * DocumentDetailResponse + add their own request types.
 */

import { z } from "zod";

export const DocumentVersionResponse = z.object({
  version_id: z.string(),
  version_number: z.number().int(),
  source: z.string(),
  chunk_count: z.number().int(),
  total_chars: z.number().int(),
  archived: z.boolean().default(false),
  created_at: z.string(),
});
export type DocumentVersionResponse = z.infer<typeof DocumentVersionResponse>;

export const DocumentDetailResponse = z.object({
  document_id: z.string(),
  full_content: z.string(),
  doc_title: z.string(),
  doc_source: z.string().nullable().optional(),
  doc_metadata: z.record(z.string(), z.unknown()).default({}),
  total_chars: z.number().int().default(0),
  chunk_count: z.number().int().default(0),
  project_ids: z.array(z.string()).default([]),
  /** Absent when the review workflow is off (#241). */
  review_status: z.string().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  /** Set when the document is soft-deleted (in trash); null/absent otherwise. */
  deleted_at: z.string().nullable().optional(),
  versions: z.array(DocumentVersionResponse).default([]),
});
export type DocumentDetailResponse = z.infer<typeof DocumentDetailResponse>;

export const ChunkResponse = z.object({
  chunk_id: z.string(),
  document_id: z.string(),
  chunk_index: z.number().int(),
  title: z.string().default(""),
  content: z.string().default(""),
  heading_path: z.array(z.string()).default([]),
  heading_level: z.number().int().nullable().optional(),
  char_count: z.number().int().default(0),
});
export type ChunkResponse = z.infer<typeof ChunkResponse>;

export const FilenameCheckResponse = z.object({
  exists: z.boolean(),
  document_id: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});
export type FilenameCheckResponse = z.infer<typeof FilenameCheckResponse>;

// Write-endpoint request/response shapes (Part 24E).

export const EditRequest = z.object({
  title: z.string(),
  content: z.string(),
  project_ids: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.string()).default({}),
});
export type EditRequest = z.infer<typeof EditRequest>;

export const EditResponse = z.object({
  success: z.boolean(),
  reindexed: z.boolean().default(false),
  error: z.string().nullable().optional(),
});
export type EditResponse = z.infer<typeof EditResponse>;

export const ReviewStatusRequest = z.object({
  status: z.enum(["approved", "pending_review"]),
});
export type ReviewStatusRequest = z.infer<typeof ReviewStatusRequest>;

export const VersionArchiveRequest = z.object({
  archived: z.boolean(),
});
export type VersionArchiveRequest = z.infer<typeof VersionArchiveRequest>;

// ── Write-path response shapes (#270) ────────────────────────────────────────
//
// These were modelled from live `/api/v1` responses and are asserted against a
// running server by `api-schema-truth.test.ts`, not inferred from the handlers.
// They exist so the OpenAPI document can describe the write surface an embedder
// actually uses; before this, every write endpoint was listed with no body.

export const IngestRequest = z.object({
  title: z.string(),
  content: z.string(),
  /** Omit to create; pass to update a specific document. */
  document_id: z.string().uuid().optional(),
  /** REQUIRED on a content update: the hash you read the document at. */
  expected_content_hash: z.string().optional(),
  /** Skips the concurrency check. Only when an external source of truth makes conflicts meaningless. */
  last_write_wins: z.boolean().optional(),
  update_if_exists: z.boolean().optional(),
  project_name: z.string().optional(),
  project_names: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  source: z.string().optional(),
  author: z.string().optional(),
  author_type: z.enum(["user", "agent"]).optional(),
});
export type IngestRequest = z.infer<typeof IngestRequest>;

export const IngestResponse = z.object({
  success: z.boolean(),
  document_id: z.string(),
  title: z.string(),
  /** True when the content hash matched and nothing was written. */
  skipped: z.boolean(),
  /** True when an existing document was updated rather than created. */
  updated: z.boolean(),
});
export type IngestResponse = z.infer<typeof IngestResponse>;

export const DeleteResponse = z.object({
  success: z.boolean(),
  /** True when the document was already in the trash, so this was a no-op. */
  already_deleted: z.boolean(),
});
export type DeleteResponse = z.infer<typeof DeleteResponse>;

export const RestoreResponse = z.object({
  success: z.boolean(),
  restored: z.boolean(),
});
export type RestoreResponse = z.infer<typeof RestoreResponse>;

export const PurgeResponse = z.object({
  success: z.boolean(),
  /** False when the document was restored before the purge landed (v1.14.1). */
  purged: z.boolean(),
});
export type PurgeResponse = z.infer<typeof PurgeResponse>;

export const ReviewStatusResponse = z.object({
  status: z.enum(["approved", "pending_review"]),
});
export type ReviewStatusResponse = z.infer<typeof ReviewStatusResponse>;
