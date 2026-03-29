import {
  Accordion,
  Badge,
  Button,
  Card,
  Code,
  Container,
  Divider,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import {
  IconArrowsDiff,
  IconDownload,
  IconEdit,
  IconLock,
  IconLockOpen,
  IconTrash,
} from "@tabler/icons-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { useState } from "react";

import { fetchAuditLog, setReviewStatus, setVersionArchived } from "../api/audit";
import { fetchDocument, fetchChunks, deleteDocument, fetchDocumentVersion, getDownloadUrl } from "../api/documents";
import { restoreDocument, purgeDocument } from "../api/trash";
import { DiffViewer } from "../components/DiffViewer";
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

  const [auditOpened, setAuditOpened] = useState(false);
  const auditEnabled = !!id && auditOpened;
  const { data: auditEntries, isLoading: auditLoading } = useQuery({
    queryKey: ["document-audit", id],
    queryFn: () => fetchAuditLog({ document_id: id!, limit: 50 }),
    enabled: auditEnabled,
  });

  const { data: projects } = useProjects();
  const projectMap = new Map(projects?.map((p) => [p.id, p.name]) ?? []);

  const deleteMutation = useMutation({
    mutationFn: () => deleteDocument(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["document", id] });
      showSuccess("Document moved to trash");
      navigate("/");
    },
    onError: (err) => showError("Delete failed", String(err)),
  });

  const restoreMutation = useMutation({
    mutationFn: () => restoreDocument(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document", id] });
      queryClient.invalidateQueries({ queryKey: ["trash"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      showSuccess("Document restored");
    },
    onError: (err) => showError("Restore failed", String(err)),
  });

  const purgeMutation = useMutation({
    mutationFn: () => purgeDocument(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trash"] });
      showSuccess("Document permanently deleted");
      navigate("/trash");
    },
    onError: (err) => showError("Purge failed", String(err)),
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
  const [diffVersionId, setDiffVersionId] = useState<string | null>(null);
  const [diffVersionContent, setDiffVersionContent] = useState<string | null>(null);
  const [diffVersionLabel, setDiffVersionLabel] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);

  const openDiff = async (versionId: string, versionNumber: number) => {
    setDiffLoading(true);
    setDiffVersionId(versionId);
    setDiffVersionLabel(`v${versionNumber}`);
    try {
      const versionDoc = await fetchDocumentVersion(id!, versionId);
      setDiffVersionContent(versionDoc.full_content);
    } catch {
      showError("Failed to load version content");
      setDiffVersionId(null);
    } finally {
      setDiffLoading(false);
    }
  };

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
            {doc.project_ids
              .filter((pid) => projectMap.has(pid))
              .map((pid) => (
                <Badge key={pid} variant="light" size="sm">
                  {projectMap.get(pid)}
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

      {doc.deleted_at && (
        <Card withBorder p="sm" mt="sm" bg="var(--mantine-color-red-light)">
          <Group justify="space-between">
            <Group gap="xs">
              <Badge color="red" variant="filled">Deleted</Badge>
              <Text size="sm">This document is in the trash (deleted {doc.deleted_at?.slice(0, 10)}). It is excluded from search.</Text>
            </Group>
            <Group gap="xs">
              <Button
                size="compact-sm"
                color="green"
                onClick={() => restoreMutation.mutate()}
                loading={restoreMutation.isPending}
              >
                Restore
              </Button>
              <Button
                size="compact-sm"
                color="red"
                onClick={() => purgeMutation.mutate()}
                loading={purgeMutation.isPending}
              >
                Permanently Delete
              </Button>
            </Group>
          </Group>
        </Card>
      )}

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

      <Accordion variant="contained" mb="md" onChange={(v) => {
        if (v === "audit" || (Array.isArray(v) && v.includes("audit"))) {
          setAuditOpened(true);
        }
      }}>
        <Accordion.Item value="audit">
          <Accordion.Control>
            <Text size="sm" fw={500}>
              Audit Trail{auditEntries ? ` (${auditEntries.length} entries)` : ""}
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            {auditLoading ? (
              <Loader size="sm" />
            ) : !auditEntries?.length ? (
              <Text size="sm" c="dimmed">No audit entries for this document.</Text>
            ) : (
              <Table striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Operation</Table.Th>
                    <Table.Th>Author</Table.Th>
                    <Table.Th>Size</Table.Th>
                    <Table.Th>Description</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {auditEntries.map((e) => {
                    const opColor = (() => {
                      switch (e.operation) {
                        case "create": return "green";
                        case "update-content": return "blue";
                        case "update-metadata": return "cyan";
                        case "delete": return "red";
                        case "status-change": return "yellow";
                        case "archive": return "violet";
                        case "unarchive": return "orange";
                        default: return "gray";
                      }
                    })();
                    const sizeText = e.size_before != null && e.size_after != null
                      ? `${e.size_before.toLocaleString()} -> ${e.size_after.toLocaleString()}`
                      : e.size_after != null
                        ? e.size_after.toLocaleString()
                        : "";
                    return (
                      <Table.Tr key={e.id}>
                        <Table.Td>
                          <Text size="xs">{formatDateTime(e.created_at)}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge variant="light" size="sm" color={opColor}>
                            {e.operation}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4}>
                            <Text size="sm">{e.author}</Text>
                            <Badge variant="dot" size="xs"
                              color={e.author_type === "agent" ? "violet" : "blue"}>
                              {e.author_type}
                            </Badge>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">{sizeText}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" lineClamp={2}>{e.description}</Text>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            )}
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>

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
                                Confirm removal
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
                            <Badge
                              variant="light"
                              size="sm"
                              color="green"
                              leftSection={<IconLock size={12} />}
                              style={{ cursor: "pointer" }}
                              title="Click to remove protection. This version will become eligible for automatic cleanup."
                              onClick={() => setConfirmUnarchive(v.version_id)}
                            >
                              Yes (archived)
                            </Badge>
                          )
                        ) : (
                          <Badge
                            variant="light"
                            size="sm"
                            color="yellow"
                            leftSection={<IconLockOpen size={12} />}
                            style={{ cursor: "pointer" }}
                            title="Click to archive. Archived versions are protected from automatic cleanup and retained indefinitely."
                            onClick={() =>
                              archiveMutation.mutate({ versionId: v.version_id, archived: true })
                            }
                          >
                            No (will be deleted)
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          <Button
                            variant="subtle"
                            size="compact-xs"
                            leftSection={<IconArrowsDiff size={12} />}
                            onClick={() => openDiff(v.version_id, v.version_number)}
                            loading={diffLoading && diffVersionId === v.version_id}
                          >
                            Diff
                          </Button>
                          <Button
                            variant="subtle"
                            size="compact-xs"
                            leftSection={<IconDownload size={12} />}
                            component="a"
                            href={getDownloadUrl(id!, v.version_id)}
                          >
                            Download
                          </Button>
                        </Group>
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
      <Modal
        opened={diffVersionId !== null && diffVersionContent !== null}
        onClose={() => {
          setDiffVersionId(null);
          setDiffVersionContent(null);
        }}
        title={`Diff: ${diffVersionLabel} vs current`}
        size="xl"
      >
        {diffVersionContent !== null && (
          <DiffViewer
            oldContent={diffVersionContent}
            newContent={doc.full_content}
            oldLabel={diffVersionLabel}
            newLabel="Current"
          />
        )}
      </Modal>
    </Container>
  );
}
