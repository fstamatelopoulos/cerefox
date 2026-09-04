/**
 * Schemas for search and discovery endpoints.
 *
 * Python source: `src/cerefox/api/routes_api.py`
 *   - SearchResponse                  (line 224)
 *   - DocSearchResultResponse         (line 167)
 *   - ChunkSearchResultResponse       (line 183)
 *   - MetadataSearchResultResponse    (line 199)
 *   - MetadataSearchRequest           (line 215)
 *   - MetadataKeyResponse             (line 241)
 *   - DashboardDocResponse            (line 499)
 *   - DashboardResponse               (line 510)
 *   - ProjectDocumentsResponse        (line 569)
 *
 * /documents/trash and /resolve-link have ad-hoc shapes — captured here
 * as zod schemas anyway so the frontend has typed access.
 */

import { z } from "zod";

import { ProjectResponse } from "./projects.js";

export const DocSearchResult = z.object({
  document_id: z.string(),
  doc_title: z.string(),
  doc_source: z.string().nullable(),
  doc_metadata: z.record(z.string(), z.unknown()),
  doc_project_ids: z.array(z.string()),
  doc_project_names: z.array(z.string()).default([]),
  best_score: z.number(),
  best_chunk_heading_path: z.array(z.string()),
  full_content: z.string(),
  chunk_count: z.number().int(),
  total_chars: z.number().int(),
  doc_updated_at: z.string().nullable(),
  is_partial: z.boolean(),
});
export type DocSearchResult = z.infer<typeof DocSearchResult>;

export const ChunkSearchResult = z.object({
  chunk_id: z.string(),
  document_id: z.string(),
  chunk_index: z.number().int(),
  title: z.string(),
  content: z.string(),
  heading_path: z.array(z.string()),
  heading_level: z.number().int().nullable(),
  score: z.number(),
  doc_title: z.string(),
  doc_source: z.string().nullable(),
  doc_project_ids: z.array(z.string()),
  doc_project_names: z.array(z.string()).default([]),
  doc_metadata: z.record(z.string(), z.unknown()),
});
export type ChunkSearchResult = z.infer<typeof ChunkSearchResult>;

export const SearchResponse = z.object({
  results: z.array(z.record(z.string(), z.unknown())),
  query: z.string(),
  mode: z.string(),
  total_found: z.number().int(),
  response_bytes: z.number().int(),
  truncated: z.boolean(),
});
export type SearchResponse = z.infer<typeof SearchResponse>;

export const MetadataKeyResponse = z.object({
  key: z.string(),
  doc_count: z.number().int(),
  examples: z.array(z.string()),
});
export type MetadataKeyResponse = z.infer<typeof MetadataKeyResponse>;

export const MetadataSearchRequest = z.object({
  metadata_filter: z.record(z.string(), z.unknown()),
  project_id: z.string().nullable().optional(),
  updated_since: z.string().nullable().optional(),
  created_since: z.string().nullable().optional(),
  limit: z.number().int().default(10),
  include_content: z.boolean().default(false),
});
export type MetadataSearchRequest = z.infer<typeof MetadataSearchRequest>;

export const MetadataSearchResult = z.object({
  document_id: z.string(),
  title: z.string(),
  doc_metadata: z.record(z.string(), z.unknown()),
  /** Absent when the review workflow is off (#241). */
  review_status: z.string().optional(),
  source: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  total_chars: z.number().int(),
  chunk_count: z.number().int(),
  project_ids: z.array(z.string()).default([]),
  project_names: z.array(z.string()).default([]),
  version_count: z.number().int(),
  content: z.string().nullable().optional(),
});
export type MetadataSearchResult = z.infer<typeof MetadataSearchResult>;

export const DashboardDoc = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string().nullable(),
  chunk_count: z.number().int(),
  total_chars: z.number().int(),
  /** Absent when the review workflow is off (#241). */
  review_status: z.string().optional(),
  updated_at: z.string(),
  project_ids: z.array(z.string()).default([]),
  author: z.string().nullable().default(null),
  author_type: z.string().nullable().default(null),
});
export type DashboardDoc = z.infer<typeof DashboardDoc>;

export const DashboardResponse = z.object({
  doc_count: z.number().int(),
  // TS-only additions (the live route always sends them); default keeps the
  // schema parsing older/Python-parity payloads that predate these fields.
  total_chunks: z.number().int().default(0),
  total_chars: z.number().int().default(0),
  project_count: z.number().int(),
  recent_docs: z.array(DashboardDoc),
  projects: z.array(ProjectResponse),
  project_doc_counts: z.record(z.string(), z.number().int()),
  project_deleted_doc_counts: z.record(z.string(), z.number().int()),
});
export type DashboardResponse = z.infer<typeof DashboardResponse>;

export const ProjectDocumentsResponse = z.object({
  documents: z.array(DashboardDoc),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type ProjectDocumentsResponse = z.infer<typeof ProjectDocumentsResponse>;

// /documents/trash — raw doc rows with extra `project_ids` field.
export const TrashedDoc = z.record(z.string(), z.unknown());
export type TrashedDoc = z.infer<typeof TrashedDoc>;

// /resolve-link response shape — best-effort link resolution.
export const ResolveLinkMatch = z.object({
  document_id: z.string(),
  title: z.string(),
  source_path: z.string().nullable(),
  match_method: z.enum([
    "document_id",
    "source_path_suffix",
    "basename",
    "title_match",
  ]),
});
export type ResolveLinkMatch = z.infer<typeof ResolveLinkMatch>;

export const ResolveLinkResponse = z.object({
  tried_path: z.string(),
  anchor: z.string().nullable(),
  matches: z.array(ResolveLinkMatch),
});
export type ResolveLinkResponse = z.infer<typeof ResolveLinkResponse>;
