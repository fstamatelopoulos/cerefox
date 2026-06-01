import {
  Badge,
  Button,
  Card,
  Container,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconRestore, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { fetchTrash, restoreDocument, purgeDocument, type DeletedDocument } from "../api/trash";
import { useProjects } from "../hooks/useProjects";

export function TrashPage() {
  const queryClient = useQueryClient();
  const { data: projects } = useProjects();
  // Resolve project_id → name for the chips on each deleted row.
  // Junction rows are preserved across soft-delete, so the trash UI can
  // still show which projects a deleted document belonged to.
  const projectMap = new Map(projects?.map((p) => [p.id, p.name]) ?? []);
  const [limit, setLimit] = useState("50");

  const { data: docs, isLoading, error } = useQuery({
    queryKey: ["trash", limit],
    queryFn: () => fetchTrash(Number(limit)),
    staleTime: 10_000,
  });
  const atCap = !!docs && docs.length === Number(limit);

  const restoreMut = useMutation({
    mutationFn: restoreDocument,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trash"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["search"] });
    },
  });

  const purgeMut = useMutation({
    mutationFn: purgeDocument,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trash"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["search"] });
    },
  });

  return (
    <Container size="lg">
      <Title order={2} mb="md">Trash</Title>
      <Group justify="space-between" align="flex-end" mb="md">
        <Text c="dimmed" size="sm">
          Deleted documents are recoverable until permanently purged.
        </Text>
        <Select
          label="Show up to"
          data={["50", "100", "200", "500"]}
          value={limit}
          onChange={(v) => setLimit(v || "50")}
          w={120}
          size="xs"
        />
      </Group>
      {atCap && (
        <Text c="dimmed" size="xs" mb="sm">
          Showing the first {limit} — raise the limit to see more.
        </Text>
      )}

      {isLoading && (
        <Group justify="center" mt="xl"><Loader /></Group>
      )}

      {error && (
        <Text c="red" mt="md">Error: {(error as Error).message}</Text>
      )}

      {docs && docs.length === 0 && (
        <Card withBorder p="xl">
          <Text ta="center" c="dimmed" size="lg">Trash is empty.</Text>
        </Card>
      )}

      {docs && docs.length > 0 && (
        <Stack gap="sm">
          <Text size="sm" c="dimmed">{docs.length} deleted document{docs.length !== 1 ? "s" : ""}</Text>
          {docs.map((doc) => (
            <TrashCard
              key={doc.id}
              doc={doc}
              projectMap={projectMap}
              onRestore={() => restoreMut.mutate(doc.id)}
              onPurge={() => purgeMut.mutate(doc.id)}
              restoring={restoreMut.isPending}
              purging={purgeMut.isPending}
            />
          ))}
        </Stack>
      )}
    </Container>
  );
}

function TrashCard({
  doc,
  projectMap,
  onRestore,
  onPurge,
  restoring,
  purging,
}: {
  doc: DeletedDocument;
  projectMap: Map<string, string>;
  onRestore: () => void;
  onPurge: () => void;
  restoring: boolean;
  purging: boolean;
}) {
  const [confirmPurge, setConfirmPurge] = useState(false);
  // project_ids may include IDs we can't resolve (e.g. a project deleted
  // after the doc went to trash). Filter to known projects so we don't
  // render orphan UUID-looking badges.
  const knownProjects = doc.project_ids.filter((pid) => projectMap.has(pid));

  return (
    <Card withBorder p="sm">
      <Group justify="space-between">
        <div>
          <Group gap="xs" mb={4}>
            <Text fw={600} size="sm">{doc.title}</Text>
            <Badge size="xs" color="red" variant="light">Deleted</Badge>
            {knownProjects.map((pid) => (
              <Badge key={pid} size="xs" variant="light" color="blue">
                {projectMap.get(pid)}
              </Badge>
            ))}
          </Group>
          <Text size="xs" c="dimmed">
            {doc.total_chars.toLocaleString()} chars | {doc.chunk_count} chunks |
            deleted {doc.deleted_at?.slice(0, 10) ?? "?"}
            {knownProjects.length === 0 && doc.project_ids.length === 0 && " | no project"}
          </Text>
        </div>
        <Group gap="xs">
          <Button
            size="compact-sm"
            variant="light"
            color="green"
            leftSection={<IconRestore size={14} />}
            onClick={onRestore}
            loading={restoring}
          >
            Restore
          </Button>
          {!confirmPurge ? (
            <Button
              size="compact-sm"
              variant="light"
              color="red"
              leftSection={<IconTrash size={14} />}
              onClick={() => setConfirmPurge(true)}
            >
              Purge
            </Button>
          ) : (
            <Group gap={4}>
              <Button
                size="compact-sm"
                color="red"
                onClick={() => { onPurge(); setConfirmPurge(false); }}
                loading={purging}
              >
                Confirm Purge
              </Button>
              <Button
                size="compact-sm"
                variant="subtle"
                onClick={() => setConfirmPurge(false)}
              >
                Cancel
              </Button>
            </Group>
          )}
        </Group>
      </Group>
    </Card>
  );
}
