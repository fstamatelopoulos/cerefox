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
  /** The optimistic-concurrency token: send it back as `expected_content_hash`
   *  on an edit, an ingest by `document_id`, an upload or a delete. Always the
   *  CURRENT hash, even when `version_id` selects an archived version. */
  content_hash: z.string().nullable(),
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

/**
 * Caller identity, accepted in the body of every write that takes one
 * (#226). The `X-Cerefox-*` headers carry the same fields and win when both
 * are present; they are the only form on a GET or DELETE.
 */
export const IdentityFields = z.object({
  author: z.string().optional().describe("Who is writing. Recorded as cerefox_audit_log.author."),
  requestor: z
    .string()
    .optional()
    .describe("Who is calling. Recorded as cerefox_usage_log.requestor; defaults to `author`."),
  author_type: z
    .enum(["user", "agent"])
    .optional()
    .describe("`agent` makes a new document land in pending_review, as it does over MCP."),
});

const HASH_DESCRIPTION =
  "The content_hash you read the document at (GET /documents/{id}). Required on a content update unless last_write_wins is true; a stale one is a 409.";
const LWW_DESCRIPTION =
  "Skip the concurrency check. Only when an external source of truth makes a conflict meaningless.";

/** Every field is optional: a body carrying only `metadata` changes only the
 *  metadata. An empty or unchanged `content` takes the metadata-only path.
 *  `.strict()` because the route refuses unknown fields (#296), so the
 *  document says so; `EDIT_FIELDS` in the route is pinned to these keys. */
export const EditRequest = IdentityFields.extend({
  title: z.string().optional(),
  content: z.string().optional(),
  project_ids: z.array(z.string()).optional().describe("Replaces the full set of project memberships."),
  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Replaces the metadata. `{}` clears every key; omit to leave it unchanged."),
  expected_content_hash: z.string().nullable().optional().describe(HASH_DESCRIPTION),
  last_write_wins: z.boolean().optional().describe(LWW_DESCRIPTION),
}).strict();
export type EditRequest = z.infer<typeof EditRequest>;

export const EditResponse = z.object({
  success: z.boolean(),
  /** True when the content changed and was re-chunked and re-embedded. */
  reindexed: z.boolean().default(false),
  error: z.string().nullable().optional(),
  // On the metadata-only branch: which facets actually changed. A facet sent
  // unchanged is skipped (and writes no audit entry), so these can be false
  // for a field the request carried. camelCase for historical reasons.
  titleChanged: z.boolean().optional(),
  metadataChanged: z.boolean().optional(),
  projectsChanged: z.boolean().optional(),
});
export type EditResponse = z.infer<typeof EditResponse>;

export const ReviewStatusRequest = IdentityFields.extend({
  status: z.enum(["approved", "pending_review"]),
});
export type ReviewStatusRequest = z.infer<typeof ReviewStatusRequest>;

export const VersionArchiveRequest = IdentityFields.extend({
  archived: z.boolean(),
});

export const VersionArchiveResponse = z.object({
  archived: z.boolean(),
});
export type VersionArchiveResponse = z.infer<typeof VersionArchiveResponse>;
export type VersionArchiveRequest = z.infer<typeof VersionArchiveRequest>;

// ── Write-path response shapes (#270) ────────────────────────────────────────
//
// These were modelled from live `/api/v1` responses and are asserted against a
// running server by `api-schema-truth.test.ts`, not inferred from the handlers.
// They exist so the OpenAPI document can describe the write surface an embedder
// actually uses; before this, every write endpoint was listed with no body.

/** `.strict()`: the route refuses unknown fields (#296), and `INGEST_FIELDS`
 *  is pinned to these keys by `api-request-contract.test.ts`. */
export const IngestRequest = IdentityFields.extend({
  title: z.string().min(1),
  content: z.string().min(1),
  document_id: z
    .string()
    .uuid()
    .optional()
    .describe("Update this document. Omit to create (or to match by title with update_if_exists)."),
  expected_content_hash: z.string().optional().describe(HASH_DESCRIPTION),
  last_write_wins: z.boolean().optional().describe(LWW_DESCRIPTION),
  update_if_exists: z
    .boolean()
    .optional()
    .describe("Update the document with this title instead of creating a second one. A content update, so it needs the hash or last_write_wins."),
  update_existing: z.boolean().optional().describe("Alias of update_if_exists (the name the bundled web UI sends)."),
  project_ids: z.array(z.string()).optional().describe("Project ids; the full set of memberships."),
  project_names: z
    .array(z.string())
    .optional()
    .describe("Project names, created if they do not exist; the full set of memberships."),
  project_name: z.string().optional().describe("One project name, added to the memberships."),
  metadata: z.record(z.string(), z.unknown()).optional(),
  source: z.string().optional().describe('Origin label. Defaults to "paste".'),
  mode: z.string().optional().describe("Ignored. Sent by the bundled web UI."),
}).strict();
export type IngestRequest = z.infer<typeof IngestRequest>;

export const IngestResponse = z.object({
  success: z.boolean(),
  document_id: z.string(),
  title: z.string(),
  /** True when the content hash matched and nothing was written. */
  skipped: z.boolean(),
  /** True when an existing document was updated rather than created. */
  updated: z.boolean(),
  /** Why a write was skipped or overridden, when there is something to say. */
  note: z.string().optional(),
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

/** `POST /documents/{id}/upload`: never a skip, so no `skipped`. */
export const UploadResponse = z.object({
  success: z.boolean(),
  document_id: z.string(),
  title: z.string(),
  updated: z.boolean(),
});
export type UploadResponse = z.infer<typeof UploadResponse>;
