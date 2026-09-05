# Iteration 45 — Empty trash (v1.14.0)

**Status: IN PROGRESS (2026-09-05, branch `feat/empty-trash`, #247).**

## Ask

The maintainer, after cleaning up a run of e2e fixtures by hand: a way to
empty the whole trash from the web app, with a confirmation, and without
adding a server endpoint that deletes everything.

## Decisions

| Question | Decision |
|---|---|
| Where does the loop run? | **In the browser.** No bulk-purge endpoint on `/api/v1`, on purpose: purge is the one irreversible operation and that surface is reachable by anything holding the local key. The existing per-document `DELETE /documents/{id}/purge` is called once per document, so each purge is audited on its own, exactly as a click would be. |
| Confirmation | A modal that counts what is actually in the trash (the page may be showing a 50-row slice) and states it: "Permanently delete N documents?" Cancel is the default button. |
| Progress | A bar, "Purging i of N", the title in flight, a running failure count, and a **Stop** button that ends the run after the purge in progress. What was purged stays purged. |
| Failures | Recorded and skipped, never retried within a run (a document that refuses to purge must not spin the loop); listed in the summary with the error. |
| More than the listing cap (500) | The loop re-lists after each pass until nothing it has not already attempted comes back. |
| Concurrency | None. One request at a time, as asked ("one by one"); the store gets the same load as a person clicking. |
| CLI | No `document purge`, bulk or otherwise. The guarded property in `access-paths.md` ("no agent path to permanent purge") is untouched. |
| What exactly is purged (review finding) | **Only what the human confirmed.** The rows listed when the count was shown are the run's set and its cutoff (newest `deleted_at` among them); a document trashed after that moment is never touched, so "seen before destroyed" holds. First draft re-listed without a cutoff and would have purged an agent's mid-run soft-delete. |
| Restored mid-run (review finding) | The purge RPC is a silent no-op on a live row. The route now answers `purged: false` (one `select id` after the RPC, no schema change); the loop reports those as "restored, still live" instead of counting them. |
| Systemic errors (review finding) | A 401/403/503 or a network error on a purge aborts the run rather than failing every remaining document one round-trip at a time; a failed re-list ends the run with a message instead of stranding the modal in the running phase. |
| Leaving the page (review finding) | `beforeunload` warns while a run is going; unmount (browser Back) stops the loop after the purge in flight; a second Purge click while a run is in flight in the same tab is refused. |
| Where the unit test lives (review finding) | Beside the module, `frontend/src/lib/emptyTrash.test.ts`, because CI's frontend step is `bun test src/`; a `tests/unit/` suite would never have run. |

## What was built

- `frontend/src/lib/emptyTrash.ts`: the loop as a pure function with injected
  `listTrash` / `purge` / `onProgress` / `shouldStop`. Returns
  `{ purged, failures, stopped }`.
- `frontend/src/components/EmptyTrashModal.tsx`: three phases (confirm →
  running → done); closing is blocked while running.
- `TrashPage`: "Empty trash" button in the toolbar, disabled when the trash is
  empty; on finish, invalidates the shared document views and toasts.
- Tests: `frontend/tests/unit/empty-trash.test.ts` (6 cases: order, cap
  re-listing, failure not retried, stop, progress snapshots, empty no-op) via
  the new `bun run test:unit`; two Playwright tests (full run to empty; Cancel
  purges nothing). **The Playwright test empties the whole trash of the target
  store**, which the production guard makes acceptable and staging exists for.
- Docs: `api.md` ("There is no bulk purge"), `access-paths.md` (why this does
  not weaken the web-UI-only rule), `solution-design.md`, `e2e-use-cases.md`,
  `CLAUDE.md` (test table), `frontend/README.md`, `CONTRIBUTING.md`, CHANGELOG.

## Verification

- `bun run typecheck` clean (all three); frontend lint 0 errors (the 7
  pre-existing hook warnings in the chart components are untouched);
  `test:unit` 6/6.
- Playwright against staging: **22/22** (20 existing + the two Trash tests);
  the run emptied the staging trash, as designed. Re-run after the review
  fixes: 22/22, frontend unit 19/19 (`bun test src/`), `destructive.test.ts`
  5/5 with the route's new `purged` field. Package suite not affected
  (frontend-only); the web static-resolution and smoke files re-run green on
  the rebundled `dist`.

## Release notes for the cut

- Frontend-only change; no schema, no Edge Function, no `minSchema` change.
  `cerefox server deploy` is not needed for it; `cerefox self-update` (and
  `cerefox-local upgrade`) picks up the new SPA bundle.
- **#154** (Node baseline / commander 15) moves to the next minor again.
