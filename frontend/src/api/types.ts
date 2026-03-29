/** TypeScript interfaces matching the FastAPI JSON API responses. */

// -- Search --

export interface DocSearchResult {
  document_id: string;
  doc_title: string;
  doc_source: string | null;
  doc_metadata: Record<string, string>;
  doc_project_ids: string[];
  doc_project_names: string[];
  best_score: number;
  best_chunk_heading_path: string[];
  full_content: string;
  chunk_count: number;
  total_chars: number;
  doc_updated_at: string | null;
  is_partial: boolean;
}

export interface ChunkSearchResult {
  chunk_id: string;
  document_id: string;
  chunk_index: number;
  title: string;
  content: string;
  heading_path: string[];
  heading_level: number | null;
  score: number;
  doc_title: string;
  doc_source: string | null;
  doc_project_ids: string[];
  doc_project_names: string[];
  doc_metadata: Record<string, string>;
}

export type SearchResult = DocSearchResult | ChunkSearchResult;

export type SearchMode = "docs" | "hybrid" | "fts" | "semantic";

export interface SearchResponse {
  results: SearchResult[];
  query: string;
  mode: SearchMode;
  total_found: number;
  response_bytes: number;
  truncated: boolean;
}

// -- Projects --

export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

// -- Metadata --

export interface MetadataKeyInfo {
  key: string;
  doc_count: number;
  examples: string[];
}

// -- Documents --

export interface DocumentDetail {
  document_id: string;
  full_content: string;
  doc_title: string;
  doc_source: string | null;
  doc_metadata: Record<string, string>;
  total_chars: number;
  chunk_count: number;
  project_ids: string[];
  review_status: string;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
  versions: DocumentVersion[];
}

export interface DocumentVersion {
  version_id: string;
  version_number: number;
  source: string;
  chunk_count: number;
  total_chars: number;
  archived: boolean;
  created_at: string;
}

// -- Metadata Search --

export interface MetadataSearchResult {
  document_id: string;
  title: string;
  doc_metadata: Record<string, string>;
  review_status: string;
  source: string | null;
  created_at: string;
  updated_at: string;
  total_chars: number;
  chunk_count: number;
  project_ids: string[];
  project_names: string[];
  version_count: number;
  content: string | null;
}

// -- Audit log --

export interface AuditEntry {
  id: string;
  document_id: string | null;
  doc_title: string | null;
  version_id: string | null;
  operation: string;
  author: string;
  author_type: string;
  size_before: number | null;
  size_after: number | null;
  description: string;
  created_at: string;
}

export interface DocumentChunk {
  chunk_id: string;
  document_id: string;
  chunk_index: number;
  title: string;
  content: string;
  heading_path: string[];
  heading_level: number | null;
  char_count: number;
}

// -- Dashboard --

export interface DashboardDoc {
  id: string;
  title: string;
  source: string | null;
  chunk_count: number;
  total_chars: number;
  review_status: string;
  updated_at: string | null;
  project_ids: string[];
}

export interface DashboardResponse {
  doc_count: number;
  project_count: number;
  recent_docs: DashboardDoc[];
  projects: Project[];
  project_doc_counts: Record<string, number>;
}

// -- Ingest --

export interface IngestResponse {
  success: boolean;
  document_id: string | null;
  title: string;
  skipped: boolean;
  updated: boolean;
  error: string | null;
}

// -- Edit --

export interface EditResponse {
  success: boolean;
  reindexed: boolean;
  error: string | null;
}

// -- Filename check --

export interface FilenameCheckResponse {
  exists: boolean;
  document_id: string | null;
  title: string | null;
  updated_at: string | null;
}

// -- Type guards --

export function isDocResult(result: SearchResult): result is DocSearchResult {
  return "full_content" in result;
}

export function isChunkResult(
  result: SearchResult,
): result is ChunkSearchResult {
  return "chunk_id" in result;
}
