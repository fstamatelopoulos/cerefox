import { Alert, Button, Group, Modal, Progress, Stack, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { fetchTrash, purgeDocument } from "../api/trash";
import { emptyTrash, type EmptyTrashProgress, type EmptyTrashResult } from "../lib/emptyTrash";

/** The server caps the trash listing at this many rows. */
const LIST_CAP = 500;

type Phase =
  | { kind: "confirm" }
  | { kind: "running"; progress: EmptyTrashProgress }
  | { kind: "done"; result: EmptyTrashResult };

interface Props {
  opened: boolean;
  onClose: () => void;
  /** Called once a run has ended (purged something, failed, or was stopped). */
  onFinished: (result: EmptyTrashResult) => void;
}

/**
 * Confirmation + progress for "Empty trash". Purges are issued one at a time
 * from the browser through the per-document endpoint (see lib/emptyTrash.ts
 * for why there is no bulk endpoint). Closing is blocked while a run is in
 * flight; Stop ends it after the purge in progress.
 */
export function EmptyTrashModal({ opened, onClose, onFinished }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "confirm" });
  // The loop polls the ref (no re-render needed); the button renders the state.
  const stopRef = useRef(false);
  const [stopping, setStopping] = useState(false);

  // Count what is actually in the trash (the page may be showing a slice).
  // Fetched fresh on every open; never served from cache.
  const { data: count } = useQuery({
    queryKey: ["trash-count"],
    queryFn: async () => (await fetchTrash(LIST_CAP)).length,
    enabled: opened && phase.kind === "confirm",
    staleTime: 0,
    gcTime: 0,
  });

  const running = phase.kind === "running";

  // The modal can only close from the confirm or done phase, so resetting on
  // close is enough to start the next open clean.
  const close = () => {
    setPhase({ kind: "confirm" });
    stopRef.current = false;
    setStopping(false);
    onClose();
  };

  const start = async () => {
    const result = await emptyTrash({
      listTrash: () => fetchTrash(LIST_CAP),
      purge: purgeDocument,
      onProgress: (progress) => setPhase({ kind: "running", progress }),
      shouldStop: () => stopRef.current,
    });
    setPhase({ kind: "done", result });
    onFinished(result);
  };

  const countLabel = (n: number) => (n >= LIST_CAP ? `${LIST_CAP} or more` : String(n));

  return (
    <Modal
      opened={opened}
      onClose={running ? () => {} : close}
      closeOnClickOutside={!running}
      closeOnEscape={!running}
      withCloseButton={!running}
      title="Empty trash"
      data-testid="empty-trash-modal"
    >
      {phase.kind === "confirm" && (
        <Stack gap="sm" data-testid="empty-trash-confirm">
          {count === undefined ? (
            <Text size="sm" c="dimmed">
              Counting…
            </Text>
          ) : count === 0 ? (
            <Text size="sm">The trash is already empty.</Text>
          ) : (
            <>
              <Alert icon={<IconAlertTriangle size={16} />} color="red">
                <Text size="sm">
                  Permanently delete <strong>{countLabel(count)}</strong>{" "}
                  {count === 1 ? "document" : "documents"}? This cannot be undone: their
                  content, chunks and version history are removed. Restore anything you still
                  want first.
                </Text>
              </Alert>
              <Text size="xs" c="dimmed">
                Documents are purged one at a time, each recorded in the audit log. You can stop
                part-way; what was purged stays purged.
              </Text>
            </>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              {count === 0 ? "Close" : "Cancel"}
            </Button>
            {count !== undefined && count > 0 && (
              <Button color="red" data-testid="empty-trash-start" onClick={() => void start()}>
                Purge {countLabel(count)} {count === 1 ? "document" : "documents"}
              </Button>
            )}
          </Group>
        </Stack>
      )}

      {phase.kind === "running" && (
        <Stack gap="sm" data-testid="empty-trash-progress">
          <Text size="sm">
            Purging {Math.min(phase.progress.done + 1, phase.progress.total)} of{" "}
            {phase.progress.total}…
          </Text>
          <Progress
            value={phase.progress.total ? (phase.progress.done / phase.progress.total) * 100 : 0}
            color="red"
            animated
            aria-label="Purge progress"
          />
          <Text size="xs" c="dimmed" truncate>
            {phase.progress.current ?? " "}
          </Text>
          {phase.progress.failures.length > 0 && (
            <Text size="xs" c="red">
              {phase.progress.failures.length} failed so far
            </Text>
          )}
          <Group justify="flex-end">
            <Button
              variant="default"
              data-testid="empty-trash-stop"
              disabled={stopping}
              onClick={() => {
                stopRef.current = true;
                setStopping(true);
              }}
            >
              {stopping ? "Stopping after this one…" : "Stop"}
            </Button>
          </Group>
        </Stack>
      )}

      {phase.kind === "done" && (
        <Stack gap="sm" data-testid="empty-trash-done">
          <Text size="sm">
            Purged <strong>{phase.result.purged}</strong>{" "}
            {phase.result.purged === 1 ? "document" : "documents"}
            {phase.result.stopped ? " before you stopped" : ""}.
          </Text>
          {phase.result.failures.length > 0 && (
            <Alert icon={<IconAlertTriangle size={16} />} color="yellow">
              <Text size="sm">
                {phase.result.failures.length} could not be purged and{" "}
                {phase.result.failures.length === 1 ? "is" : "are"} still in the trash:
              </Text>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {phase.result.failures.map((f) => (
                  <li key={f.id}>
                    <Text size="xs">
                      {f.title}: {f.error}
                    </Text>
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          <Group justify="flex-end">
            <Button data-testid="empty-trash-close" onClick={close}>
              Close
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
