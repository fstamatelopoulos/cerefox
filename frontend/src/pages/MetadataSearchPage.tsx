import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Checkbox,
  Container,
  Group,
  Loader,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconPlus, IconSearch, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import {
  fetchMetadataSearch,
  type MetadataSearchParams,
} from "../api/metadataSearch";
import { fetchMetadataKeys, fetchProjects } from "../api/projects";
import type { MetadataSearchResult } from "../api/types";

export function MetadataSearchPage() {
  // ── Filter state ─────────────────────────────────────────────────────────
  const [filters, setFilters] = useState<Array<{ key: string; value: string }>>([
    { key: "", value: "" },
  ]);
  const [projectId, setProjectId] = useState<string>("");
  const [updatedSince, setUpdatedSince] = useState("");
  const [createdSince, setCreatedSince] = useState("");
  const [limit, setLimit] = useState<number>(10);
  const [includeContent, setIncludeContent] = useState(false);

  // ── Autocomplete data ────────────────────────────────────────────────────
  const { data: metadataKeys } = useQuery({
    queryKey: ["metadataKeys"],
    queryFn: fetchMetadataKeys,
    staleTime: 60_000,
  });

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
    staleTime: 60_000,
  });

  const keySuggestions = (metadataKeys ?? []).map((k) => ({
    value: k.key,
    label: `${k.key} (${k.doc_count} docs)`,
  }));

  const projectOptions = [
    { value: "", label: "All projects" },
    ...(projects ?? []).map((p) => ({ value: p.id, label: p.name })),
  ];

  // ── Filter management ────────────────────────────────────────────────────
  const addFilter = () => setFilters((f) => [...f, { key: "", value: "" }]);

  const removeFilter = (idx: number) =>
    setFilters((f) => f.filter((_, i) => i !== idx));

  const updateFilter = (idx: number, field: "key" | "value", val: string) =>
    setFilters((f) => f.map((row, i) => (i === idx ? { ...row, [field]: val } : row)));

  // ── Search mutation ──────────────────────────────────────────────────────
  const {
    mutate: doSearch,
    data: results,
    isPending,
    error,
    reset,
  } = useMutation({
    mutationFn: (params: MetadataSearchParams) => fetchMetadataSearch(params),
  });

  const handleSearch = useCallback(() => {
    const mf: Record<string, string> = {};
    for (const f of filters) {
      if (f.key.trim() && f.value.trim()) {
        mf[f.key.trim()] = f.value.trim();
      }
    }
    if (Object.keys(mf).length === 0) return;

    const params: MetadataSearchParams = {
      metadata_filter: mf,
      limit,
      include_content: includeContent,
    };
    if (projectId) params.project_id = projectId;
    if (updatedSince) params.updated_since = updatedSince;
    if (createdSince) params.created_since = createdSince;

    reset();
    doSearch(params);
  }, [filters, projectId, updatedSince, createdSince, limit, includeContent, doSearch, reset]);

  const validFilterCount = filters.filter(
    (f) => f.key.trim() && f.value.trim(),
  ).length;

  return (
    <Container size="lg">
      <Title order={2} mb="md">
        Metadata Search
      </Title>

      {/* ── Controls ──────────────────────────────────────────────────── */}
      <Card withBorder mb="md" p="md">
        <Stack gap="sm">
          <Text fw={500} size="sm">
            Metadata Filters (all must match)
          </Text>
          {filters.map((f, idx) => (
            <Group key={idx} gap="xs" align="flex-end">
              <Select
                placeholder="Key"
                data={keySuggestions}
                value={f.key || null}
                onChange={(v) => updateFilter(idx, "key", v ?? "")}
                searchable
                allowDeselect
                style={{ flex: 1 }}
                size="sm"
              />
              <TextInput
                placeholder="Value"
                value={f.value}
                onChange={(e) => updateFilter(idx, "value", e.currentTarget.value)}
                style={{ flex: 1 }}
                size="sm"
              />
              {filters.length > 1 && (
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => removeFilter(idx)}
                  size="md"
                >
                  <IconTrash size={16} />
                </ActionIcon>
              )}
            </Group>
          ))}
          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconPlus size={14} />}
            onClick={addFilter}
            style={{ alignSelf: "flex-start" }}
          >
            Add filter
          </Button>

          <Group gap="sm" grow>
            <Select
              label="Project"
              data={projectOptions}
              value={projectId}
              onChange={(v) => setProjectId(v ?? "")}
              size="sm"
              clearable
            />
            <NumberInput
              label="Limit"
              value={limit}
              onChange={(v) => setLimit(Number(v) || 10)}
              min={1}
              max={100}
              size="sm"
            />
          </Group>

          <Group gap="sm" grow>
            <TextInput
              label="Updated since"
              placeholder="YYYY-MM-DD"
              value={updatedSince}
              onChange={(e) => setUpdatedSince(e.currentTarget.value)}
              size="sm"
            />
            <TextInput
              label="Created since"
              placeholder="YYYY-MM-DD"
              value={createdSince}
              onChange={(e) => setCreatedSince(e.currentTarget.value)}
              size="sm"
            />
          </Group>

          <Group>
            <Checkbox
              label="Include document content"
              checked={includeContent}
              onChange={(e) => setIncludeContent(e.currentTarget.checked)}
              size="sm"
            />
          </Group>

          <Button
            leftSection={<IconSearch size={16} />}
            onClick={handleSearch}
            disabled={validFilterCount === 0}
            loading={isPending}
          >
            Search
          </Button>
        </Stack>
      </Card>

      {/* ── Results ───────────────────────────────────────────────────── */}
      {isPending && (
        <Group justify="center" mt="xl">
          <Loader />
        </Group>
      )}

      {error && (
        <Text c="red" mt="md">
          Error: {(error as Error).message}
        </Text>
      )}

      {results && results.length === 0 && (
        <Text c="dimmed" mt="md">
          No documents match the metadata filter.
        </Text>
      )}

      {results && results.length > 0 && (
        <Stack gap="sm" mt="md">
          <Text size="sm" c="dimmed">
            {results.length} document{results.length !== 1 ? "s" : ""} found
          </Text>
          {results.map((doc: MetadataSearchResult) => (
            <MetadataResultCard
              key={doc.document_id}
              doc={doc}
              showContent={includeContent}
            />
          ))}
        </Stack>
      )}
    </Container>
  );
}

// ── Result card component ──────────────────────────────────────────────────

function MetadataResultCard({
  doc,
  showContent,
}: {
  doc: MetadataSearchResult;
  showContent: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [renderMd, setRenderMd] = useState(true);
  const metaEntries = Object.entries(doc.doc_metadata ?? {});
  const topMeta = metaEntries.slice(0, 3);
  const hasMoreMeta = metaEntries.length > 3;

  return (
    <Card withBorder p="sm">
      {/* ── Collapsed: click anywhere to expand/collapse ───────────── */}
      <div
        style={{ cursor: "pointer" }}
        onClick={() => setExpanded((e) => !e)}
      >
        <Group justify="space-between" mb={4}>
          <Group gap="xs">
            <Text fw={600} size="sm">{doc.title}</Text>
            <Badge size="xs" variant="light" color={doc.review_status === "approved" ? "green" : "yellow"}>
              {doc.review_status}
            </Badge>
          </Group>
        </Group>

        <Group gap={4} mb={4}>
          {(expanded ? metaEntries : topMeta).map(([k, v]) => (
            <Badge key={k} size="xs" variant="outline">
              {k}={String(v).length > 30 ? String(v).slice(0, 28) + "..." : String(v)}
            </Badge>
          ))}
          {!expanded && hasMoreMeta && (
            <Badge size="xs" variant="light" c="dimmed">+{metaEntries.length - 3} more</Badge>
          )}
        </Group>

        {doc.project_names.length > 0 && (
          <Group gap={4} mb={4}>
            {doc.project_names.map((name) => (
              <Badge key={name} size="xs" variant="filled" color="blue">{name}</Badge>
            ))}
          </Group>
        )}

        <Text size="xs" c="dimmed">
          {doc.total_chars.toLocaleString()} chars | {doc.chunk_count} chunks |
          {doc.version_count > 0 ? ` ${doc.version_count} versions |` : ""} updated{" "}
          {doc.updated_at?.slice(0, 10) ?? "?"}
        </Text>
      </div>

      {/* ── Expanded: full metadata + content + link ───────────────── */}
      {expanded && (
        <Stack gap="xs" mt="sm">
          {/* All metadata as key-value table */}
          {metaEntries.length > 0 && (
            <Card p="xs" bg="var(--mantine-color-gray-light)" radius="sm">
              <Text size="xs" fw={500} mb={4}>All Metadata</Text>
              {metaEntries.map(([k, v]) => (
                <Group key={k} gap={4}>
                  <Text size="xs" fw={500} c="dimmed" style={{ minWidth: 100 }}>{k}:</Text>
                  <Text size="xs">{String(v)}</Text>
                </Group>
              ))}
            </Card>
          )}

          {/* Document fields */}
          <Group gap="xs">
            <Text size="xs" c="dimmed">ID: {doc.document_id}</Text>
            {doc.source && <Text size="xs" c="dimmed">| Source: {doc.source}</Text>}
            <Text size="xs" c="dimmed">| Created: {doc.created_at?.slice(0, 10) ?? "?"}</Text>
          </Group>

          {/* Content viewer with raw/md toggle */}
          {showContent && doc.content && (
            <Card p="xs" withBorder radius="sm">
              <Group justify="space-between" mb={4}>
                <Text size="xs" fw={500}>Content</Text>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => setRenderMd((r) => !r)}
                >
                  {renderMd ? "Raw" : "Rendered"}
                </Button>
              </Group>
              {renderMd ? (
                <div
                  style={{ maxHeight: 300, overflow: "auto", fontSize: 12 }}
                  dangerouslySetInnerHTML={{
                    __html: doc.content
                      .replace(/^### (.+)$/gm, "<h4>$1</h4>")
                      .replace(/^## (.+)$/gm, "<h3>$1</h3>")
                      .replace(/^# (.+)$/gm, "<h2>$1</h2>")
                      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
                      .replace(/\n\n/g, "<br/><br/>")
                      .replace(/\n/g, "<br/>"),
                  }}
                />
              ) : (
                <Text
                  size="xs"
                  style={{
                    whiteSpace: "pre-wrap",
                    maxHeight: 300,
                    overflow: "auto",
                    fontFamily: "monospace",
                  }}
                >
                  {doc.content}
                </Text>
              )}
            </Card>
          )}

          {/* Link to document detail (opens in new tab) */}
          <Group>
            <Button
              component="a"
              href={`/app/document/${doc.document_id}`}
              target="_blank"
              rel="noopener"
              size="compact-xs"
              variant="light"
            >
              View Document Details
            </Button>
          </Group>
        </Stack>
      )}
    </Card>
  );
}
