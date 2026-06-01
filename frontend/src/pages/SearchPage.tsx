import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

import { fetchDashboard } from "../api/dashboard";
import type { SearchMode } from "../api/types";
import { SearchControls } from "../components/SearchControls";
import { SearchResults } from "../components/SearchResults";
import { serializeMfParam, useSearchQuery, useSearchState } from "../hooks/useSearch";
import ui from "../styles/redesign.module.css";
import styles from "./SearchPage.module.css";

export function SearchPage() {
  const [, setSearchParams] = useSearchParams();
  const state = useSearchState();
  const { data, isLoading, error } = useSearchQuery(state);
  const { data: dash } = useQuery({ queryKey: ["dashboard"], queryFn: fetchDashboard });

  const handleSearch = useCallback(
    (params: {
      q: string;
      mode: SearchMode;
      projectId: string;
      count: number;
      reviewStatus: string;
      metadataFilter: Record<string, string>;
    }) => {
      const sp = new URLSearchParams();
      if (params.q) sp.set("q", params.q);
      if (params.mode !== "docs") sp.set("mode", params.mode);
      if (params.projectId) sp.set("project_id", params.projectId);
      if (params.count !== 10) sp.set("count", String(params.count));
      if (params.reviewStatus) sp.set("review_status", params.reviewStatus);
      const mf = serializeMfParam(params.metadataFilter);
      if (mf) sp.set("mf", mf);
      setSearchParams(sp);
    },
    [setSearchParams],
  );

  return (
    <div className={styles.wrap}>
      <div className={ui.pageHead}>
        <div>
          <p className={ui.eyebrow}>Knowledge base</p>
          <h1 className={ui.pageTitle}>Search memory</h1>
        </div>
        {dash && (
          <span className={`${ui.mono} ${ui.faint}`} style={{ fontSize: 12 }}>
            {dash.doc_count.toLocaleString()} docs · {dash.total_chunks.toLocaleString()} chunks
          </span>
        )}
      </div>

      <SearchControls
        query={state.q}
        mode={state.mode}
        projectId={state.projectId}
        count={state.count}
        reviewStatus={state.reviewStatus}
        metadataFilter={state.metadataFilter}
        onSearch={handleSearch}
      />

      <SearchResults
        data={data}
        isLoading={isLoading}
        error={error as Error | null}
        hasQuery={!!state.q}
      />
    </div>
  );
}
