import { Alert, Button, Group, Modal, Progress, Stack, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client";
import { fetchTrash, purgeDocument } from "../api/trash";
import { emptyTrash, type EmptyTrashProgress, type EmptyTrashResult } from "../lib/emptyTrash";

/** The server caps the trash listing at this many rows. */
const LIST_CAP = 500;

/**
 * One run per tab. The loop outlives a component that unmounts mid-run (it
 * is a promise, not a subscription), so a second Purge click after Back /
 * Forward must be refused rather than raced against the first.
 */
let runInFlight = false;

/** A purge error after which every further call would fail the same way. */
const isFatal = (err: unknown) =>
  (err instanceof ApiError && [401, 403, 503].includes(err.status)) || err instanceof TypeError;

type Phase =
  | { kind: "confirm" }
  | { kind: "running"; progress: EmptyTrashProgress }
  | { kind: "done"; result: EmptyTrashResult };

interface Props {
  onClose: () => void;
  /** Called once a run has ended (purged something, failed, stopped or aborted). */
  onFinished: (result: EmptyTrashResult) => void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Confirmation + progress for "Empty trash". Mounted only while open, so
 * every open starts clean: fresh count, confirm phase, no stale state. Purges
 * are issued one at a time from the browser through the per-document endpoint
 * (see lib/emptyTrash.ts for why there is no bulk endpoint). Closing is
 * blocked while a run is in flight; Stop ends it after the purge in progress.
 */
export function EmptyTrashModal({ onClose, onFinished }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "confirm" });
  // The loop polls the ref (no re-render needed); the button renders the state.
  const stopRef = useRef(false);
  const [stopping, setStopping] = useState(false);
  const [refused, setRefused] = useState(false);

  // What the user is confirming: the rows actually in the trash right now (the
  // page may be showing a slice). These rows ARE the run's set; a document
  // trashed after this listing is never touched.
  const listing = useQuery({
    queryKey: ["trash", "count"],
    queryFn: () => fetchTrash(LIST_CAP),
    enabled: phase.kind === "confirm",
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const rows = listing.data;
  const count = rows?.length;

  const running = phase.kind === "running";

  // While a run is going: warn on reload / tab close, and if the component
  // unmounts anyway (browser Back), stop the loop after the purge in flight.
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      stopRef.current = true;
    };
  }, [running]);

  const start = async () => {
    if (!rows || rows.length === 0) return;
    if (runInFlight) {
      setRefused(true);
      return;
    }
    runInFlight = true;
    try {
      const result = await emptyTrash({
        confirmed: rows,
        listTrash: () => fetchTrash(LIST_CAP),
        purge: purgeDocument,
        onProgress: (progress) => setPhase({ kind: "running", progress }),
        shouldStop: () => stopRef.current,
        isFatal,
      });
      setPhase({ kind: "done", result });
      onFinished(result);
    } finally {
      runInFlight = false;
    }
  };

  const countLabel = (n: number) => (n >= LIST_CAP ? `${LIST_CAP} or more` : String(n));

  return (
    <Modal
      opened
      onClose={running ? () => {} : onClose}
      closeOnClickOutside={!running}
      closeOnEscape={!running}
      withCloseButton={!running}
      title="Empty trash"
      data-testid="empty-trash-modal"
    >
      {phase.kind === "confirm" && (
        <Stack gap="sm" data-testid="empty-trash-confirm">
          {listing.isError ? (
            <Alert icon={<IconAlertTriangle size={16} />} color="red">
              <Text size="sm">
                Could not read the trash: {listing.error.message}. Nothing was purged.
              </Text>
            </Alert>
          ) : count === undefined ? (
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
                Only what is in the trash right now is purged, one document at a time, each
                recorded in the audit log. You can stop part-way; what was purged stays purged.
              </Text>
            </>
          )}
          {refused && (
            <Text size="xs" c="red">
              A run is already in progress in this tab. Wait for it to finish.
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {count === 0 || listing.isError ? "Close" : "Cancel"}
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
          {phase.result.aborted && (
            <Alert icon={<IconAlertTriangle size={16} />} color="red">
              <Text size="sm">
                Stopped early: {phase.result.aborted}. Whatever was not purged is still in the
                trash.
              </Text>
            </Alert>
          )}
          {phase.result.restored.length > 0 && (
            <Text size="sm">
              {plural(phase.result.restored.length, "document")}{" "}
              {phase.result.restored.length === 1 ? "was" : "were"} restored while this ran and{" "}
              {phase.result.restored.length === 1 ? "is" : "are"} live again, untouched:{" "}
              {phase.result.restored.map((d) => d.title).join(", ")}.
            </Text>
          )}
          {phase.result.failures.length > 0 && (
            <Alert icon={<IconAlertTriangle size={16} />} color="yellow">
              <Text size="sm">
                {plural(phase.result.failures.length, "document")} could not be purged and{" "}
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
            <Button data-testid="empty-trash-close" onClick={onClose}>
              Close
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
