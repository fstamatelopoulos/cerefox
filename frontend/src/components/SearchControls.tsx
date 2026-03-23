import {
  ActionIcon,
  Button,
  Collapse,
  Group,
  Select,
  Stack,
  TextInput,
} from "@mantine/core";
import { IconFilter, IconSearch, IconX } from "@tabler/icons-react";
import { useCallback, useState } from "react";

import type { SearchMode } from "../api/types";
import { useMetadataKeys, useProjects } from "../hooks/useProjects";

const MODE_OPTIONS = [
  { value: "docs", label: "Documents (full)" },
  { value: "hybrid", label: "Hybrid chunks" },
  { value: "fts", label: "Keyword (FTS)" },
  { value: "semantic", label: "Semantic" },
];

const COUNT_OPTIONS = [
  { value: "5", label: "5 results" },
  { value: "10", label: "10 results" },
  { value: "20", label: "20 results" },
];

interface MetadataFilterPair {
  key: string;
  value: string;
}

const REVIEW_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "approved", label: "Approved" },
  { value: "pending_review", label: "Pending Review" },
];

interface SearchControlsProps {
  query: string;
  mode: SearchMode;
  projectId: string;
  count: number;
  reviewStatus: string;
  metadataFilter: Record<string, string>;
  onSearch: (params: {
    q: string;
    mode: SearchMode;
    projectId: string;
    count: number;
    reviewStatus: string;
    metadataFilter: Record<string, string>;
  }) => void;
}

export function SearchControls({
  query,
  mode,
  projectId,
  count,
  reviewStatus,
  metadataFilter,
  onSearch,
}: SearchControlsProps) {
  const [localQuery, setLocalQuery] = useState(query);
  const [localMode, setLocalMode] = useState<SearchMode>(mode);
  const [localProjectId, setLocalProjectId] = useState(projectId);
  const [localCount, setLocalCount] = useState(String(count));
  const [localReviewStatus, setLocalReviewStatus] = useState(reviewStatus);
  const [filterPairs, setFilterPairs] = useState<MetadataFilterPair[]>(() => {
    const pairs = Object.entries(metadataFilter).map(([key, value]) => ({
      key,
      value,
    }));
    return pairs.length > 0 ? pairs : [];
  });
  const [filtersOpen, setFiltersOpen] = useState(filterPairs.length > 0);

  const { data: projects } = useProjects();
  const { data: metadataKeys } = useMetadataKeys();

  const projectOptions = [
    { value: "", label: "All projects" },
    ...(projects?.map((p) => ({ value: p.id, label: p.name })) || []),
  ];

  const handleSubmit = useCallback(() => {
    const mf: Record<string, string> = {};
    for (const pair of filterPairs) {
      if (pair.key.trim() && pair.value.trim()) {
        mf[pair.key.trim()] = pair.value.trim();
      }
    }
    onSearch({
      q: localQuery,
      mode: localMode,
      projectId: localProjectId,
      count: Number(localCount),
      reviewStatus: localReviewStatus,
      metadataFilter: mf,
    });
  }, [localQuery, localMode, localProjectId, localCount, localReviewStatus, filterPairs, onSearch]);

  const addFilterPair = () => {
    setFilterPairs((prev) => [...prev, { key: "", value: "" }]);
  };

  const removeFilterPair = (index: number) => {
    setFilterPairs((prev) => prev.filter((_, i) => i !== index));
  };

  const updateFilterPair = (
    index: number,
    field: "key" | "value",
    val: string,
  ) => {
    setFilterPairs((prev) =>
      prev.map((pair, i) => (i === index ? { ...pair, [field]: val } : pair)),
    );
  };

  const keyOptions =
    metadataKeys?.map((mk) => ({
      value: mk.key,
      label: `${mk.key} (${mk.doc_count})`,
    })) || [];

  return (
    <Stack gap="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <Group gap="sm" align="flex-end">
          <TextInput
            placeholder="Search your knowledge base..."
            value={localQuery}
            onChange={(e) => setLocalQuery(e.currentTarget.value)}
            flex={1}
            size="md"
            leftSection={<IconSearch size={18} />}
          />
          <Select
            data={MODE_OPTIONS}
            value={localMode}
            onChange={(v) => setLocalMode((v as SearchMode) || "docs")}
            w={180}
            size="md"
          />
          {projectOptions.length > 1 && (
            <Select
              data={projectOptions}
              value={localProjectId}
              onChange={(v) => setLocalProjectId(v || "")}
              w={180}
              size="md"
              placeholder="All projects"
              clearable
            />
          )}
          <Select
            data={COUNT_OPTIONS}
            value={localCount}
            onChange={(v) => setLocalCount(v || "10")}
            w={120}
            size="md"
          />
          <Button type="submit" size="md">
            Search
          </Button>
        </Group>
      </form>

      <Group gap="xs">
        <Button
          variant="subtle"
          size="xs"
          leftSection={<IconFilter size={14} />}
          onClick={() => setFiltersOpen((o) => !o)}
        >
          Metadata filters {filterPairs.length > 0 && `(${filterPairs.length})`}
        </Button>
        {localMode === "docs" && (
          <Select
            data={REVIEW_OPTIONS}
            value={localReviewStatus}
            onChange={(v) => setLocalReviewStatus(v || "")}
            w={160}
            size="xs"
            placeholder="All statuses"
            clearable
          />
        )}
      </Group>

      <Collapse in={filtersOpen}>
        <Stack gap="xs" pl="sm">
          {filterPairs.map((pair, idx) => (
            <Group key={idx} gap="xs">
              <Select
                placeholder="Key"
                data={keyOptions}
                value={pair.key}
                onChange={(v) => updateFilterPair(idx, "key", v || "")}
                searchable
                w={200}
                size="xs"
              />
              <TextInput
                placeholder="Value"
                value={pair.value}
                onChange={(e) =>
                  updateFilterPair(idx, "value", e.currentTarget.value)
                }
                w={200}
                size="xs"
              />
              <ActionIcon
                variant="subtle"
                color="red"
                size="sm"
                onClick={() => removeFilterPair(idx)}
              >
                <IconX size={14} />
              </ActionIcon>
            </Group>
          ))}
          <Button variant="light" size="xs" w={140} onClick={addFilterPair}>
            + Add filter
          </Button>
        </Stack>
      </Collapse>
    </Stack>
  );
}
