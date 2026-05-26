import {
  Anchor,
  Badge,
  Container,
  Group,
  Loader,
  Pagination,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { apiFetch } from "../api/client";
import type { ProjectDocumentsResponse } from "../api/types";
import { useProjects } from "../hooks/useProjects";
import { formatDate } from "../utils/dates";

const PAGE_SIZE = 50;

export function ProjectDocumentsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: projects } = useProjects();

  const project = projects?.find((p) => p.id === id);
  const projectMap = new Map(projects?.map((p) => [p.id, p.name]) ?? []);

  const [page, setPage] = useState(1);
  const offset = (page - 1) * PAGE_SIZE;

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["project-documents", id, page],
    queryFn: () =>
      apiFetch<ProjectDocumentsResponse>(
        `/projects/${id}/documents?limit=${PAGE_SIZE}&offset=${offset}`,
      ),
    enabled: !!id,
    // Keep current data visible while the next page loads — avoids a
    // full-page loader flicker on every page-link click.
    placeholderData: keepPreviousData,
  });

  const docs = data?.documents ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstOnPage = total === 0 ? 0 : offset + 1;
  const lastOnPage = Math.min(offset + docs.length, total);

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
      ) : total === 0 ? (
        <Text c="dimmed" ta="center" mt="xl">
          No documents in this project.
        </Text>
      ) : (
        <>
          <Group justify="space-between" mb="sm">
            <Text size="sm" c="dimmed">
              {total === 1
                ? "1 document"
                : `${total} documents — showing ${firstOnPage}–${lastOnPage}`}
            </Text>
            {isFetching && !isLoading && <Loader size="xs" />}
          </Group>
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
                        .filter((pid) => pid !== id && projectMap.has(pid))
                        .map((pid) => (
                          <Badge key={pid} variant="light" size="xs">
                            {projectMap.get(pid)}
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
          {totalPages > 1 && (
            <Group justify="center" mt="md">
              <Pagination
                value={page}
                onChange={setPage}
                total={totalPages}
                size="sm"
                withEdges
              />
            </Group>
          )}
        </>
      )}
    </Container>
  );
}
