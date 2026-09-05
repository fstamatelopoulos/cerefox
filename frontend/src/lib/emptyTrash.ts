/**
 * "Empty trash": purge every soft-deleted document, one call at a time.
 *
 * There is deliberately NO bulk-purge endpoint on the server (decision,
 * 2026-09-05): purge is the one operation that frees storage and cannot be
 * undone, and `/api/v1` is reachable by anything that holds the local key.
 * A single request that empties the trash would be a footgun on that
 * surface, so the loop lives here, in the browser, and drives the existing
 * per-document `DELETE /documents/{id}/purge`. Each purge is audited on its
 * own, exactly as if the user had clicked it.
 *
 * The loop is pure (dependencies injected) so it can be unit-tested without
 * a browser, and so the modal only renders what it reports.
 *
 * Termination: the trash listing is capped server-side (500), so the loop
 * re-lists after each pass until nothing it has not already attempted comes
 * back. Ids it has attempted are never retried within one run, so a
 * document that fails to purge cannot make the loop spin.
 */

export interface TrashEntry {
  id: string;
  title: string;
}

export interface EmptyTrashFailure {
  id: string;
  title: string;
  error: string;
}

export interface EmptyTrashProgress {
  /** Documents attempted so far (purged + failed). */
  done: number;
  /** Best current estimate: attempted + still listed. Grows if a re-list finds more. */
  total: number;
  /** Title of the document being purged right now, or null between passes. */
  current: string | null;
  purged: number;
  failures: EmptyTrashFailure[];
}

export interface EmptyTrashResult {
  purged: number;
  failures: EmptyTrashFailure[];
  /** True when `shouldStop()` ended the run before the trash was empty. */
  stopped: boolean;
}

export interface EmptyTrashDeps {
  /** The current trash listing (server caps it; the loop re-lists as needed). */
  listTrash: () => Promise<TrashEntry[]>;
  /** One permanent delete. Rejects on failure; the loop records it and moves on. */
  purge: (id: string) => Promise<void>;
  onProgress?: (progress: EmptyTrashProgress) => void;
  /** Polled before every purge; true ends the run after the current one. */
  shouldStop?: () => boolean;
}

export async function emptyTrash(deps: EmptyTrashDeps): Promise<EmptyTrashResult> {
  const attempted = new Set<string>();
  const failures: EmptyTrashFailure[] = [];
  let purged = 0;
  let stopped = false;

  const report = (current: string | null, remaining: number) => {
    deps.onProgress?.({
      done: attempted.size,
      total: attempted.size + remaining,
      current,
      purged,
      failures: [...failures],
    });
  };

  for (;;) {
    const pending = (await deps.listTrash()).filter((d) => !attempted.has(d.id));
    if (pending.length === 0) break;
    report(null, pending.length);

    for (let i = 0; i < pending.length; i++) {
      if (deps.shouldStop?.()) {
        stopped = true;
        break;
      }
      const doc = pending[i]!;
      report(doc.title, pending.length - i);
      try {
        await deps.purge(doc.id);
        purged += 1;
      } catch (err) {
        failures.push({ id: doc.id, title: doc.title, error: err instanceof Error ? err.message : String(err) });
      }
      attempted.add(doc.id);
      report(null, pending.length - i - 1);
    }
    if (stopped) break;
  }

  return { purged, failures, stopped };
}
