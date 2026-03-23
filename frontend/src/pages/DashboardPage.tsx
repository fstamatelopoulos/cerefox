import {
  Anchor,
  Badge,
  Button,
  Card,
  Container,
  Group,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconDatabase, IconFolder, IconList, IconSearch } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchDashboard } from "../api/dashboard";
import { useProjects } from "../hooks/useProjects";
import { formatDate } from "../utils/dates";

export function DashboardPage() {
  const navigate = useNavigate();
  const [quickSearch, setQuickSearch] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboard,
  });
  const { data: projects } = useProjects();

  const projectMap = new Map(
    projects?.map((p) => [p.id, p.name]) ?? [],
  );

  const handleQuickSearch = () => {
    if (quickSearch.trim()) {
      navigate(`/search?q=${encodeURIComponent(quickSearch.trim())}&mode=docs`);
    } else {
      navigate("/search");
    }
  };

  return (
    <Container size="lg">
      <Title order={2} mb="md">
        Dashboard
      </Title>

      <SimpleGrid cols={{ base: 1, sm: 3 }} mb="xl">
        <Card shadow="xs" padding="md" radius="md" withBorder>
          <Group align="center">
            <IconDatabase size={24} color="var(--mantine-color-blue-6)" />
            <Text size="xl" fw={700}>
              {isLoading ? <Skeleton width={30} height={24} /> : data?.doc_count ?? 0}
            </Text>
            <Text size="sm" c="dimmed">
              Documents
            </Text>
          </Group>
        </Card>
        <Card shadow="xs" padding="md" radius="md" withBorder>
          <Group align="center">
            <IconFolder size={24} color="var(--mantine-color-green-6)" />
            <Text size="xl" fw={700}>
              {isLoading ? <Skeleton width={30} height={24} /> : data?.project_count ?? 0}
            </Text>
            <Text size="sm" c="dimmed">
              Projects
            </Text>
          </Group>
        </Card>
        <Card shadow="xs" padding="md" radius="md" withBorder>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleQuickSearch();
            }}
            style={{ display: "flex", alignItems: "center", height: "100%" }}
          >
            <Group gap="xs" w="100%" align="center">
              <TextInput
                placeholder="Quick search..."
                value={quickSearch}
                onChange={(e) => setQuickSearch(e.currentTarget.value)}
                leftSection={<IconSearch size={16} />}
                style={{ flex: 1 }}
                size="sm"
              />
              <Button type="submit" size="sm" variant="light">
                Go
              </Button>
            </Group>
          </form>
        </Card>
      </SimpleGrid>

      <Title order={4} mb="sm">
        Recent Documents
      </Title>
      {isLoading ? (
        <Stack gap="xs">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} height={40} />
          ))}
        </Stack>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Title</Table.Th>
              <Table.Th>Chunks</Table.Th>
              <Table.Th>Size</Table.Th>
              <Table.Th>Updated</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data?.recent_docs.map((doc) => (
              <Table.Tr key={doc.id}>
                <Table.Td>
                  <Group gap="xs">
                    <Anchor
                      href={`/app/document/${doc.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        navigate(`/document/${doc.id}`);
                      }}
                      fw={500}
                      size="sm"
                    >
                      {doc.title || "Untitled"}
                    </Anchor>
                    {doc.project_ids.map((pid) => (
                      <Badge key={pid} variant="light" size="xs">
                        {projectMap.get(pid) || pid.slice(0, 8)}
                      </Badge>
                    ))}
                    <Badge
                      variant="light"
                      size="xs"
                      color={doc.review_status === "approved" ? "green" : "yellow"}
                    >
                      {doc.review_status === "approved" ? "Approved" : "Pending"}
                    </Badge>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{doc.chunk_count}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{doc.total_chars.toLocaleString()}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {formatDate(doc.updated_at)}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {data && data.projects.length > 0 && (
        <>
          <Title order={4} mt="xl" mb="sm">
            Projects
          </Title>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Description</Table.Th>
                <Table.Th>Documents</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.projects.map((p) => {
                const docCount = data.project_doc_counts[p.id] ?? 0;
                return (
                  <Table.Tr key={p.id}>
                    <Table.Td>
                      <Text fw={600} size="sm">
                        {p.name}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed" lineClamp={1}>
                        {p.description || ""}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs">
                        <Text size="sm">{docCount}</Text>
                        {docCount > 0 && (
                          <Button
                            variant="subtle"
                            size="compact-xs"
                            leftSection={<IconList size={12} />}
                            onClick={() =>
                              navigate(`/projects/${p.id}/documents`)
                            }
                          >
                            List
                          </Button>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </>
      )}
    </Container>
  );
}
