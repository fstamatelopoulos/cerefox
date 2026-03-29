import { apiFetch } from "./client";
import type { MetadataSearchResult } from "./types";

export interface MetadataSearchParams {
  metadata_filter: Record<string, string>;
  project_id?: string;
  updated_since?: string;
  created_since?: string;
  limit?: number;
  include_content?: boolean;
}

export async function fetchMetadataSearch(
  params: MetadataSearchParams,
): Promise<MetadataSearchResult[]> {
  return apiFetch<MetadataSearchResult[]>("/documents/metadata-search", {
    method: "POST",
    body: JSON.stringify(params),
  });
}
