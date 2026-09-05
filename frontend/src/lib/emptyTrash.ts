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
 * What gets purged is what the human confirmed. The rows listed when the
 * count was shown are the run's set; a document trashed AFTER that moment
 * (an agent's soft-delete while the run is going) is never touched, because
 * nobody looked at it. The listing is capped server-side (500) and ordered
 * newest-deleted first, so with more than 500 in the trash the confirmed
 * page holds the newest entries and its cutoff is the trash's newest entry:
 * the loop re-lists after each pass and every older row is eligible, until
 * everything trashed before the confirmation is gone. An id is never
 * attempted twice, so a document that refuses to purge cannot make the loop
 * spin.
 *
 * Pure (dependencies injected) so it is tested without a browser, and so the
 * modal only renders what it reports.
 */

export interface TrashEntry {
  id: string;
  title: string;
  deleted_at: string | null;
}

export interface EmptyTrashFailure {
  id: string;
  title: string;
  error: string;
}

export interface EmptyTrashProgress {
  /** Documents attempted so far (purged + restored-meanwhile + failed). */
  done: number;
  /** Attempted + still eligible in the current pass. Grows if a re-list finds more. */
  total: number;
  /** Title of the document being purged right now, or null between purges. */
  current: string | null;
  purged: number;
  failures: EmptyTrashFailure[];
}

export interface EmptyTrashResult {
  /** True purges: the document is gone. */
  purged: number;
  /** Listed at confirmation, but restored before their turn: still live, untouched. */
  restored: TrashEntry[];
  failures: EmptyTrashFailure[];
  /** True when `shouldStop()` ended the run before the set was exhausted. */
  stopped: boolean;
  /** Set when the run ended early on a systemic error; what remains is still in the trash. */
  aborted: string | null;
}

export interface EmptyTrashDeps {
  /** The rows the user saw when confirming. The run's set, and its cutoff. */
  confirmed: TrashEntry[];
  /** The current trash listing, for passes beyond the server's cap. */
  listTrash: () => Promise<TrashEntry[]>;
  /**
   * One permanent delete. Resolves `{ purged: false }` when the document was
   * no longer in the trash (restored meanwhile); rejects on failure.
   */
  purge: (id: string) => Promise<{ purged: boolean }>;
  onProgress?: (progress: EmptyTrashProgress) => void;
  /** Polled before every purge; true ends the run after the current one. */
  shouldStop?: () => boolean;
  /** A purge error that means every further call would fail too (auth, outage). Aborts the run. */
  isFatal?: (err: unknown) => boolean;
}

const stamp = (d: TrashEntry) => Date.parse(d.deleted_at ?? "") || 0;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function emptyTrash(deps: EmptyTrashDeps): Promise<EmptyTrashResult> {
  const cutoff = deps.confirmed.reduce((max, d) => Math.max(max, stamp(d)), 0);
  const attempted = new Set<string>();
  const restored: TrashEntry[] = [];
  const failures: EmptyTrashFailure[] = [];
  let purged = 0;
  let stopped = false;
  let aborted: string | null = null;

  const eligible = (d: TrashEntry) => !attempted.has(d.id) && stamp(d) <= cutoff;
  const report = (current: string | null, remaining: number) =>
    deps.onProgress?.({
      done: attempted.size,
      total: attempted.size + remaining,
      current,
      purged,
      failures: [...failures],
    });

  let pending = deps.confirmed.filter(eligible);
  outer: while (pending.length > 0) {
    for (let i = 0; i < pending.length; i++) {
      if (deps.shouldStop?.()) {
        stopped = true;
        break outer;
      }
      const doc = pending[i]!;
      report(doc.title, pending.length - i);
      try {
        const outcome = await deps.purge(doc.id);
        if (outcome.purged) purged += 1;
        else restored.push(doc);
      } catch (err) {
        if (deps.isFatal?.(err)) {
          aborted = message(err);
          break outer;
        }
        failures.push({ id: doc.id, title: doc.title, error: message(err) });
      }
      attempted.add(doc.id);
      report(null, pending.length - i - 1);
    }
    try {
      pending = (await deps.listTrash()).filter(eligible);
    } catch (err) {
      aborted = `Could not list the trash: ${message(err)}`;
      break;
    }
  }

  return { purged, restored, failures, stopped, aborted };
}
