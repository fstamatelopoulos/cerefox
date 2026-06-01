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
  review_status: z.string().default("approved"),
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
