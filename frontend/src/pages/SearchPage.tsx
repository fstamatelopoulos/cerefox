import { Container, Title } from "@mantine/core";
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

import type { SearchMode } from "../api/types";
import { SearchControls } from "../components/SearchControls";
import { SearchResults } from "../components/SearchResults";
import { serializeMfParam, useSearchQuery, useSearchState } from "../hooks/useSearch";

export function SearchPage() {
  const [, setSearchParams] = useSearchParams();
  const state = useSearchState();
  const { data, isLoading, error } = useSearchQuery(state);

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

  const hasQuery = !!state.q;

  return (
    <Container size="lg">
      <Title order={2} mb="md">
        Search Knowledge Base
      </Title>

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
        hasQuery={hasQuery}
      />
    </Container>
  );
}
