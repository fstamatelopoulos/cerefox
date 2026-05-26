import {
  Alert,
  Anchor,
  Container,
  Grid,
  Group,
  Loader,
  NavLink,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconBook, IconRobot, IconFileText } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { fetchDocContent, fetchDocsIndex, type DocEntry } from "../api/docs";
import { MarkdownViewer } from "../components/MarkdownViewer";

const CATEGORY_LABELS: Record<string, string> = {
  readme: "Project overview",
  "agent-guide": "Agent integration",
  guide: "Guides",
};

const CATEGORY_ORDER = ["readme", "agent-guide", "guide"];

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  readme: <IconFileText size={16} />,
  "agent-guide": <IconRobot size={16} />,
  guide: <IconBook size={16} />,
};

export function HelpPage() {
  const navigate = useNavigate();
  const { "*": docPath } = useParams();

  const indexQuery = useQuery({
    queryKey: ["docs", "index"],
    queryFn: fetchDocsIndex,
    staleTime: Infinity,
  });

  const docs = indexQuery.data ?? [];

  // Default to README on first visit
  const selectedPath = docPath && docPath.length > 0 ? docPath : docs[0]?.path;

  const contentQuery = useQuery({
    queryKey: ["docs", "content", selectedPath],
    queryFn: () => fetchDocContent(selectedPath!),
    staleTime: Infinity,
    enabled: !!selectedPath,
  });

  const grouped = useMemo(() => {
    const out: Record<string, DocEntry[]> = {};
    for (const entry of docs) {
      (out[entry.category] ??= []).push(entry);
    }
    return out;
  }, [docs]);

  if (indexQuery.isLoading) {
    return (
      <Container py="xl">
        <Loader />
      </Container>
    );
  }

  if (indexQuery.isError) {
    return (
      <Container py="xl">
        <Alert color="red" title="Could not load documentation">
          {(indexQuery.error as Error).message}
        </Alert>
      </Container>
    );
  }

  if (docs.length === 0) {
    return (
      <Container py="xl">
        <Alert color="yellow" title="No bundled docs available">
          This Cerefox install did not ship with bundled documentation.
          Check that the wheel was built with the{" "}
          <code>[tool.hatch.build.targets.wheel.force-include]</code> block
          intact, or run from a repo checkout.
        </Alert>
      </Container>
    );
  }

  return (
    <Container fluid py="md">
      <Grid gutter="md">
        <Grid.Col span={{ base: 12, md: 3 }}>
          <Stack gap={2}>
            <Title order={5} mb="xs">
              Help
            </Title>
            {CATEGORY_ORDER.filter((cat) => grouped[cat]?.length).map((cat) => (
              <Stack key={cat} gap={0} mb="sm">
                <Group gap={6} mb={4} mt={6}>
                  {CATEGORY_ICONS[cat]}
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                    {CATEGORY_LABELS[cat] ?? cat}
                  </Text>
                </Group>
                {grouped[cat].map((entry) => (
                  <NavLink
                    key={entry.path}
                    label={entry.title}
                    description={entry.path}
                    active={entry.path === selectedPath}
                    onClick={() => navigate(`/help/${entry.path}`)}
                  />
                ))}
              </Stack>
            ))}
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 9 }}>
          {contentQuery.isLoading && <Loader />}
          {contentQuery.isError && (
            <Alert color="red" title={`Could not load ${selectedPath}`}>
              {(contentQuery.error as Error).message}
            </Alert>
          )}
          {contentQuery.data && (
            <Stack gap="sm">
              <Group justify="space-between" align="flex-end">
                <Title order={3}>
                  {docs.find((d) => d.path === selectedPath)?.title ?? selectedPath}
                </Title>
                <Anchor
                  size="xs"
                  c="dimmed"
                  href={`/api/v1/docs/${selectedPath}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  raw
                </Anchor>
              </Group>
              <MarkdownViewer content={contentQuery.data} showToggle={false} />
            </Stack>
          )}
        </Grid.Col>
      </Grid>
    </Container>
  );
}
