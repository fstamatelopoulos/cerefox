import {
  Badge,
  Button,
  Card,
  Container,
  Group,
  Loader,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconRestore, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { fetchTrash, restoreDocument, purgeDocument, type DeletedDocument } from "../api/trash";

export function TrashPage() {
  const queryClient = useQueryClient();

  const { data: docs, isLoading, error } = useQuery({
    queryKey: ["trash"],
    queryFn: () => fetchTrash(),
    staleTime: 10_000,
  });

  const restoreMut = useMutation({
    mutationFn: restoreDocument,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trash"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const purgeMut = useMutation({
    mutationFn: purgeDocument,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trash"] });
    },
  });

  return (
    <Container size="lg">
      <Title order={2} mb="md">Trash</Title>
      <Text c="dimmed" size="sm" mb="md">
        Deleted documents are recoverable until permanently purged.
      </Text>

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
  onRestore,
  onPurge,
  restoring,
  purging,
}: {
  doc: DeletedDocument;
  onRestore: () => void;
  onPurge: () => void;
  restoring: boolean;
  purging: boolean;
}) {
  const [confirmPurge, setConfirmPurge] = useState(false);

  return (
    <Card withBorder p="sm">
      <Group justify="space-between">
        <div>
          <Group gap="xs" mb={4}>
            <Text fw={600} size="sm">{doc.title}</Text>
            <Badge size="xs" color="red" variant="light">Deleted</Badge>
          </Group>
          <Text size="xs" c="dimmed">
            {doc.total_chars.toLocaleString()} chars | {doc.chunk_count} chunks |
            deleted {doc.deleted_at?.slice(0, 10) ?? "?"}
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
