import {
  Accordion,
  Badge,
  Button,
  Code,
  Container,
  Divider,
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import {
  IconDownload,
  IconEdit,
  IconLock,
  IconLockOpen,
  IconTrash,
} from "@tabler/icons-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { useState } from "react";

import { setReviewStatus, setVersionArchived } from "../api/audit";
import { fetchDocument, fetchChunks, deleteDocument, getDownloadUrl } from "../api/documents";
import { MarkdownViewer } from "../components/MarkdownViewer";
import { useProjects } from "../hooks/useProjects";
import { formatDateTime } from "../utils/dates";
import { showSuccess, showError } from "../utils/notifications";

export function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: doc, isLoading, error } = useQuery({
    queryKey: ["document", id],
    queryFn: () => fetchDocument(id!),
    enabled: !!id,
  });

  const { data: chunks, isLoading: chunksLoading } = useQuery({
    queryKey: ["document-chunks", id],
    queryFn: () => fetchChunks(id!),
    enabled: !!id,
  });

  const { data: projects } = useProjects();
  const projectMap = new Map(projects?.map((p) => [p.id, p.name]) ?? []);

  const deleteMutation = useMutation({
    mutationFn: () => deleteDocument(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      showSuccess("Document deleted");
      navigate("/");
    },
    onError: (err) => showError("Delete failed", String(err)),
  });

  const reviewMutation = useMutation({
    mutationFn: (status: string) => setReviewStatus(id!, status),
    onSuccess: (_, status) => {
      queryClient.invalidateQueries({ queryKey: ["document", id] });
      showSuccess("Review status updated", status === "approved" ? "Approved" : "Pending review");
    },
    onError: (err) => showError("Status update failed", String(err)),
  });

  const archiveMutation = useMutation({
    mutationFn: ({ versionId, archived }: { versionId: string; archived: boolean }) =>
      setVersionArchived(id!, versionId, archived),
    onSuccess: (_, { archived }) => {
      queryClient.invalidateQueries({ queryKey: ["document", id] });
      showSuccess(archived ? "Version archived" : "Version unarchived",
        archived ? "Protected from cleanup" : "Eligible for cleanup");
    },
    onError: (err) => showError("Archive update failed", String(err)),
  });

  const [confirmUnarchive, setConfirmUnarchive] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Container size="lg">
        <Group justify="center" mt="xl">
          <Loader />
        </Group>
      </Container>
    );
  }

  if (error || !doc) {
    return (
      <Container size="lg">
        <Text c="red" mt="xl">
          {error ? String(error) : "Document not found."}
        </Text>
      </Container>
    );
  }

  const metaEntries = Object.entries(doc.doc_metadata || {});

  return (
    <Container size="lg">
      <Group justify="space-between" align="flex-start" mb="md">
        <div>
          <Title order={2}>{doc.doc_title || "Untitled"}</Title>
          <Group gap="xs" mt="xs">
            {doc.project_ids.map((pid) => (
              <Badge key={pid} variant="light" size="sm">
                {projectMap.get(pid) || pid.slice(0, 8)}
              </Badge>
            ))}
            <Text size="sm" c="dimmed">
              {doc.chunk_count} chunks | {doc.total_chars.toLocaleString()} chars
            </Text>
          </Group>
          <Group gap="md" mt={4}>
            {doc.created_at && (
              <Text size="xs" c="dimmed">
                Created: {formatDateTime(doc.created_at)}
              </Text>
            )}
            {doc.updated_at && (
              <Text size="xs" c="dimmed">
                Updated: {formatDateTime(doc.updated_at)}
              </Text>
            )}
            <SegmentedControl
              size="xs"
              value={doc.review_status}
              onChange={(v) => reviewMutation.mutate(v)}
              color={doc.review_status === "approved" ? "green" : "yellow"}
              data={[
                { label: "Approved", value: "approved" },
                { label: "Pending Review", value: "pending_review" },
              ]}
              disabled={reviewMutation.isPending}
            />
          </Group>
        </div>
        <Group gap="xs">
          <Button
            variant="light"
            size="xs"
            leftSection={<IconEdit size={14} />}
            onClick={() => navigate(`/document/${id}/edit`)}
          >
            Edit
          </Button>
          <Button
            variant="light"
            size="xs"
            leftSection={<IconDownload size={14} />}
            component="a"
            href={getDownloadUrl(id!)}
          >
            Download
          </Button>
          {!confirmDelete ? (
            <Button
              variant="light"
              color="red"
              size="xs"
              leftSection={<IconTrash size={14} />}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          ) : (
            <Group gap={4}>
              <Button
                color="red"
                size="xs"
                onClick={() => deleteMutation.mutate()}
                loading={deleteMutation.isPending}
              >
                Confirm delete
              </Button>
              <Button
                variant="subtle"
                size="xs"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
            </Group>
          )}
        </Group>
      </Group>

      {metaEntries.length > 0 && (
        <>
          <Divider my="sm" />
          <Accordion variant="contained" mb="md">
            <Accordion.Item value="metadata">
              <Accordion.Control>
                <Text size="sm" fw={500}>
                  Metadata ({metaEntries.length} fields)
                </Text>
              </Accordion.Control>
              <Accordion.Panel>
                <Table>
                  <Table.Tbody>
                    {metaEntries.map(([k, v]) => (
                      <Table.Tr key={k}>
                        <Table.Td fw={500} w={200}>
                          {k}
                        </Table.Td>
                        <Table.Td>{String(v)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </>
      )}

      {doc.versions.length > 0 && (
        <Accordion variant="contained" mb="md">
          <Accordion.Item value="versions">
            <Accordion.Control>
              <Text size="sm" fw={500}>
                Version History ({doc.versions.length} retained)
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Table striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Version</Table.Th>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Size</Table.Th>
                    <Table.Th>Chunks</Table.Th>
                    <Table.Th>Protected</Table.Th>
                    <Table.Th></Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {doc.versions.map((v) => (
                    <Table.Tr key={v.version_id}>
                      <Table.Td>
                        <Group gap={4}>
                          <Badge variant="outline" size="sm">
                            v{v.version_number}
                          </Badge>
                          {v.archived && <IconLock size={14} color="var(--mantine-color-blue-6)" />}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{formatDateTime(v.created_at)}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">
                          {v.total_chars.toLocaleString()} chars
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{v.chunk_count}</Text>
                      </Table.Td>
                      <Table.Td>
                        {v.archived ? (
                          confirmUnarchive === v.version_id ? (
                            <Group gap={4}>
                              <Button
                                size="compact-xs"
                                color="yellow"
                                onClick={() => {
                                  archiveMutation.mutate({ versionId: v.version_id, archived: false });
                                  setConfirmUnarchive(null);
                                }}
                                loading={archiveMutation.isPending}
                              >
                                Confirm
                              </Button>
                              <Button
                                size="compact-xs"
                                variant="subtle"
                                onClick={() => setConfirmUnarchive(null)}
                              >
                                Cancel
                              </Button>
                            </Group>
                          ) : (
                            <Button
                              variant="subtle"
                              size="compact-xs"
                              color="blue"
                              leftSection={<IconLockOpen size={12} />}
                              onClick={() => setConfirmUnarchive(v.version_id)}
                            >
                              Unarchive
                            </Button>
                          )
                        ) : (
                          <Button
                            variant="subtle"
                            size="compact-xs"
                            leftSection={<IconLock size={12} />}
                            onClick={() =>
                              archiveMutation.mutate({ versionId: v.version_id, archived: true })
                            }
                            loading={archiveMutation.isPending}
                          >
                            Archive
                          </Button>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Button
                          variant="subtle"
                          size="compact-xs"
                          leftSection={<IconDownload size={12} />}
                          component="a"
                          href={getDownloadUrl(id!, v.version_id)}
                        >
                          Download
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}

      <Divider my="sm" />

      <Accordion variant="separated" multiple defaultValue={["content"]}>
        <Accordion.Item value="content">
          <Accordion.Control>
            <Text size="sm" fw={500}>
              Full Content ({doc.total_chars.toLocaleString()} chars)
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            <MarkdownViewer
              content={doc.full_content}
              defaultView="rendered"
            />
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="chunks">
          <Accordion.Control>
            <Text size="sm" fw={500}>
              Chunks ({doc.chunk_count})
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            {chunksLoading ? (
              <Loader size="sm" />
            ) : (
              <Stack gap="sm">
                {chunks?.map((c) => (
                  <div
                    key={c.chunk_id}
                    style={{
                      border: "1px solid var(--mantine-color-gray-3)",
                      borderRadius: 8,
                      padding: 8,
                    }}
                  >
                    <Text size="xs" c="dimmed" mb={4} style={{ fontFamily: "monospace" }}>
                      {c.heading_path.length > 0
                        ? c.heading_path.join(" > ")
                        : "(preamble)"}
                    </Text>
                    <Code
                      block
                      style={{ whiteSpace: "pre-wrap", fontSize: 12 }}
                    >
                      {c.content}
                    </Code>
                  </div>
                ))}
              </Stack>
            )}
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Container>
  );
}
