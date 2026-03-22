/** TypeScript interfaces matching the FastAPI JSON API responses. */

// -- Search --

export interface DocSearchResult {
  document_id: string;
  doc_title: string;
  doc_source: string | null;
  doc_metadata: Record<string, string>;
  doc_project_ids: string[];
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

export interface Document {
  document_id: string;
  full_content: string;
  doc_title: string;
  doc_source: string | null;
  doc_metadata: Record<string, string>;
  total_chars: number;
  chunk_count: number;
}

export interface DocumentVersion {
  version_id: string;
  version_number: number;
  source: string;
  chunk_count: number;
  total_chars: number;
  created_at: string;
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
