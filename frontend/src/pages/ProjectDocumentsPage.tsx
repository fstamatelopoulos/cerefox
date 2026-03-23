import {
  Anchor,
  Badge,
  Container,
  Group,
  Loader,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";

import { apiFetch } from "../api/client";
import type { DashboardDoc } from "../api/types";
import { useProjects } from "../hooks/useProjects";
import { formatDate } from "../utils/dates";

export function ProjectDocumentsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: projects } = useProjects();

  const project = projects?.find((p) => p.id === id);
  const projectMap = new Map(projects?.map((p) => [p.id, p.name]) ?? []);

  const { data: docs, isLoading } = useQuery({
    queryKey: ["project-documents", id],
    queryFn: () => apiFetch<DashboardDoc[]>(`/projects/${id}/documents`),
    enabled: !!id,
  });

  return (
    <Container size="lg">
      <Group gap="xs" mb="md">
        <Anchor size="sm" onClick={() => navigate("/projects")}>
          Projects
        </Anchor>
        <Text size="sm" c="dimmed">
          /
        </Text>
        <Title order={2}>{project?.name || "Project"}</Title>
      </Group>

      {project?.description && (
        <Text size="sm" c="dimmed" mb="md">
          {project.description}
        </Text>
      )}

      {isLoading ? (
        <Group justify="center" mt="xl">
          <Loader />
        </Group>
      ) : !docs || docs.length === 0 ? (
        <Text c="dimmed" ta="center" mt="xl">
          No documents in this project.
        </Text>
      ) : (
        <>
          <Text size="sm" c="dimmed" mb="sm">
            {docs.length} document{docs.length !== 1 ? "s" : ""}
          </Text>
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
              {docs.map((doc) => (
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
                      {doc.project_ids
                        .filter((pid) => pid !== id)
                        .map((pid) => (
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
        </>
      )}
    </Container>
  );
}
