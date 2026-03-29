import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Code,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";

import type {
  ChunkSearchResult,
  DocSearchResult,
  SearchResponse,
} from "../api/types";
import { isDocResult } from "../api/types";

interface SearchResultsProps {
  data: SearchResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  hasQuery: boolean;
}

export function SearchResults({
  data,
  isLoading,
  error,
  hasQuery,
}: SearchResultsProps) {
  if (!hasQuery) {
    return (
      <Text c="dimmed" ta="center" mt="xl">
        Enter a query or select a project to browse.
      </Text>
    );
  }

  if (isLoading) {
    return (
      <Group justify="center" mt="xl">
        <Loader />
        <Text c="dimmed">Searching...</Text>
      </Group>
    );
  }

  if (error) {
    return (
      <Alert
        icon={<IconAlertCircle size={16} />}
        title="Search failed"
        color="red"
        mt="md"
      >
        {error.message}
      </Alert>
    );
  }

  if (!data || data.results.length === 0) {
    return (
      <Text c="dimmed" ta="center" mt="xl">
        No results found.
      </Text>
    );
  }

  const isDocView = data.results.length > 0 && isDocResult(data.results[0]);

  return (
    <Stack gap="md" mt="md">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {data.total_found} result{data.total_found !== 1 ? "s" : ""} found
        </Text>
        {data.truncated && (
          <Badge color="yellow" variant="light" size="sm">
            Results truncated
          </Badge>
        )}
      </Group>

      {isDocView ? (
        <DocResults results={data.results as DocSearchResult[]} />
      ) : (
        <ChunkResults results={data.results as ChunkSearchResult[]} />
      )}
    </Stack>
  );
}

function DocResults({ results }: { results: DocSearchResult[] }) {
  const navigate = useNavigate();
  return (
    <Accordion variant="separated" multiple>
      {results.map((r) => (
        <Accordion.Item key={r.document_id} value={r.document_id}>
          <Accordion.Control>
            <Group justify="space-between" wrap="nowrap" gap="sm">
              <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                <ScoreBadge score={r.best_score} />
                <Anchor
                  href={`/app/document/${r.document_id}`}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate(`/document/${r.document_id}`); }}
                  fw={600}
                  size="sm"
                  truncate
                >
                  {r.doc_title || "Untitled"}
                </Anchor>
              </Group>
              <Group gap="xs" wrap="nowrap">
                {r.is_partial ? (
                  <Badge color="yellow" variant="light" size="xs">
                    Excerpt
                  </Badge>
                ) : (
                  <Badge color="green" variant="light" size="xs">
                    Full
                  </Badge>
                )}
              </Group>
            </Group>
            <Group gap="xs" mt={4}>
              <Text size="xs" c="dimmed">
                {r.chunk_count} chunks | {r.total_chars.toLocaleString()} chars
              </Text>
              {r.doc_updated_at && (
                <Text size="xs" c="dimmed">
                  Updated {new Date(r.doc_updated_at).toLocaleDateString()}
                </Text>
              )}
              {r.best_chunk_heading_path.length > 0 && (
                <Text size="xs" c="dimmed" fs="italic">
                  Best match: {r.best_chunk_heading_path.join(" > ")}
                </Text>
              )}
            </Group>
            {r.doc_project_names && r.doc_project_names.length > 0 && (
              <Group gap={4} mt={4}>
                {r.doc_project_names.map((name) => (
                  <Badge key={name} size="xs" variant="filled" color="blue">
                    {name}
                  </Badge>
                ))}
              </Group>
            )}
          </Accordion.Control>
          <Accordion.Panel>
            <Code block style={{ whiteSpace: "pre-wrap", maxHeight: 400, overflow: "auto" }}>
              {r.full_content || "(no content)"}
            </Code>
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}

function ChunkResults({ results }: { results: ChunkSearchResult[] }) {
  const navigate = useNavigate();
  return (
    <Stack gap="sm">
      {results.map((r) => (
        <div
          key={r.chunk_id}
          style={{
            border: "1px solid var(--mantine-color-gray-3)",
            borderRadius: 8,
            padding: 12,
          }}
        >
          <Group gap="xs" mb={4}>
            {r.heading_path.length > 0 && (
              <Text size="xs" c="dimmed" style={{ fontFamily: "monospace" }}>
                {r.heading_path.join(" > ")}
              </Text>
            )}
          </Group>
          <Group gap="xs" mb={8}>
            <ScoreBadge score={r.score} />
            <Anchor href={`/app/document/${r.document_id}`}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate(`/document/${r.document_id}`); }} fw={600} size="sm">
              {r.doc_title || "Untitled"}
            </Anchor>
            {r.title && r.title !== r.doc_title && (
              <Text size="sm" c="dimmed">
                / {r.title}
              </Text>
            )}
          </Group>
          <Text
            size="sm"
            lineClamp={4}
            style={{ whiteSpace: "pre-wrap" }}
          >
            {r.content.slice(0, 400)}
          </Text>
        </div>
      ))}
    </Stack>
  );
}

function ScoreBadge({ score }: { score: number }) {
  if (score <= 0) return null;
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? "green" : pct >= 40 ? "yellow" : "gray";
  return (
    <Badge color={color} variant="light" size="xs">
      {pct}%
    </Badge>
  );
}
