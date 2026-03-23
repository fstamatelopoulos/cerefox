import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { fetchSearch, type SearchParams } from "../api/search";
import type { SearchMode } from "../api/types";

/** Parse metadata filters from URL: mf=key1:val1,key2:val2 */
function parseMfParam(mf: string): Record<string, string> {
  if (!mf) return {};
  const result: Record<string, string> = {};
  for (const pair of mf.split(",")) {
    const idx = pair.indexOf(":");
    if (idx > 0) {
      result[pair.slice(0, idx)] = pair.slice(idx + 1);
    }
  }
  return result;
}

/** Serialize metadata filters to URL param */
export function serializeMfParam(filters: Record<string, string>): string {
  return Object.entries(filters)
    .filter(([k, v]) => k && v)
    .map(([k, v]) => `${k}:${v}`)
    .join(",");
}

export interface SearchState {
  q: string;
  mode: SearchMode;
  projectId: string;
  count: number;
  reviewStatus: string;
  metadataFilter: Record<string, string>;
}

export function useSearchState(): SearchState {
  const [params] = useSearchParams();
  return {
    q: params.get("q") || "",
    mode: (params.get("mode") as SearchMode) || "docs",
    projectId: params.get("project_id") || "",
    count: Number(params.get("count")) || 10,
    reviewStatus: params.get("review_status") || "",
    metadataFilter: parseMfParam(params.get("mf") || ""),
  };
}

export function useSearchQuery(state: SearchState) {
  const hasQuery = !!state.q;

  const params: SearchParams = {
    q: state.q || undefined,
    mode: state.mode,
    project_id: state.projectId || undefined,
    count: state.count,
    review_status: state.reviewStatus || undefined,
    metadata_filter:
      Object.keys(state.metadataFilter).length > 0
        ? state.metadataFilter
        : undefined,
  };

  return useQuery({
    queryKey: ["search", params],
    queryFn: () => fetchSearch(params),
    enabled: hasQuery,
  });
}
