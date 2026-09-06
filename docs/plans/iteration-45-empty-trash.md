# Iteration 45 — Empty trash (v1.14.0)

**Status: DONE. v1.14.0 SHIPPED 2026-09-05** (PR #248, cut `8e91cc4`) **and
v1.14.1 SHIPPED 2026-09-05** (PR #250, cut `6c879fe`); both verified on staging
after the release deploys, 1.14.1 also on Cerefox Local by the maintainer (a
real 569-document Empty-trash run). Auto-purge of old trash is backlogged (#251).

**v1.14.1 (2026-09-05, #249).** Right after the upgrade the maintainer saw
"Permanently delete 500 or more documents?" on a Local store they believed
held 50. It held 569: the Trash page showed 50, its selector's default, and
said nothing about the rest, so the modal (which could only count the 500
rows it got) was right and the page was misleading. Fix: the listing returns
the exact total in `X-Total-Count` (same exact-count query the dashboard
uses; no schema change); the page drops the 50/100/200/500 selector, always
shows the 500 most recently deleted and says "Showing the 500 most recently
deleted of 569" when capped; the modal states the exact number and passes it
to the loop as `totalHint` so the progress bar starts at the real total.

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
  store**, so it is triple-guarded: production guard, explicit opt-in
  (`CEREFOX_E2E_EMPTY_TRASH=1`), and a skip if the trash holds anything not
  `[E2E`-prefixed.
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

## Under discussion for 1.14.1: auto-purge of trash older than N days

**Ask (maintainer, 2026-09-05).** An opt-in setting, off by default, stored in
`cerefox_config` and editable in Settings: permanently delete trash older than
N days (default 30, editable). The difficulty: Cerefox has no scheduled or
timed process. Version retention is lazy: `cerefox_ingest_document` prunes a
document's own archived versions when that document is written, and never
otherwise.

**Constant across every option.** One RPC, `cerefox_purge_expired_trash(p_max)`:
reads `trash_auto_purge_enabled` and `trash_retention_days` from config,
purges up to `p_max` rows with `deleted_at < now() - retention` (oldest first),
one audit entry per document (author `trash-retention`, description carries
the deleted-at date and the retention in force), returns the ids purged. Not
exposed on MCP or the Edge Functions (the "no agent path to purge" rule holds;
the RPC is reachable only with the service key, like every other RPC). Two
config keys in the catalog + `v_allowed` + seed rows + a migration, so a
schema bump (0.17.0). The Settings confirmation for enabling it is the
human-in-the-loop step, and it should say what happens next: "at the next
sweep, every document trashed more than N days ago is purged."

| Option | Who calls the RPC | For | Against |
|---|---|---|---|
| A. Sweep on view | The web server, before answering `GET /documents/trash` (and the dashboard), at most once per few minutes | No new process; runs exactly when someone is about to look at the trash | A GET that destroys data; only sweeps when someone looks, so a store nobody opens never sweeps |
| B. Sweep on write | `cerefox_ingest_document`, like version pruning | Same shape as the existing lazy cleanup | Every agent write pays for it; an agent's write becomes the trigger for permanent deletion, which is the thing the access model keeps agents away from |
| C. `pg_cron` | The database itself, hourly | A real schedule, independent of any client | Supabase has it (needs enabling per project); Cerefox Local would need the extension in the image and `shared_preload_libraries`; two environments to configure and document, and a third for anyone on plain Postgres |
| D. Web-daemon timer | `cerefox web` (which Cerefox Local always runs): a sweep at startup and then hourly | Uses the one long-running process Cerefox already has; no extension; purge stays "executed by the web tier" | A Supabase-only user who never runs `cerefox web` never sweeps, and must be told so |
| E. D + A | The daemon timer, plus a rate-limited sweep when the trash is listed | Covers both the always-on daemon and the occasional web visit; the listing sweep is a no-op when the timer keeps up | Two triggers to document; still nothing for a store with no daemon and no visits (acceptable: nothing to see, nothing at risk) |

**Recommendation: E**, with `doctor` printing one line (`trash auto-purge: off`
/ `on, 30 days, last sweep <time>`), the last-sweep time kept in
`cerefox_config` by the RPC, and a `cerefox server sweep-trash` CLI verb for
the Supabase-only case and for scripts. Batches of 100 per call so a first
sweep over a large backlog cannot hold a request. The sweep-on-list trigger
answers the listing AFTER the sweep, so the page never shows a row that is
about to vanish.

**Decision (maintainer, 2026-09-05): backlog, and when built, trigger on a
document delete** (#251). "The write that adds to the trash also sweeps it":
not elegant, but predictable, simple to build and to document, and the same
shape as version retention. Not scheduled; the use case is harnesses with
several roles writing and deleting frequently.
