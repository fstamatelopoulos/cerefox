import { apiFetch, buildQueryString } from "./client";
import type { SearchMode, SearchResponse } from "./types";

export interface SearchParams {
  q?: string;
  mode?: SearchMode;
  project_id?: string;
  count?: number;
  review_status?: string;
  metadata_filter?: Record<string, string>;
}

export async function fetchSearch(params: SearchParams): Promise<SearchResponse> {
  const metadataFilter =
    params.metadata_filter && Object.keys(params.metadata_filter).length > 0
      ? JSON.stringify(params.metadata_filter)
      : undefined;

  const qs = buildQueryString({
    q: params.q,
    mode: params.mode,
    project_id: params.project_id,
    count: params.count !== undefined ? params.count : undefined,
    review_status: params.review_status,
    metadata_filter: metadataFilter,
  });

  return apiFetch<SearchResponse>(`/search${qs}`);
}
