# Iteration 44 — the review workflow becomes optional (v1.13.0)

**Status: IMPLEMENTATION COMPLETE, verified on staging, awaiting review +
release** (2026-09-04). Branch: `design/review-workflow-toggle` (squash-merge;
the branch is deleted after). Target: **v1.13.0**. Schema **0.15.0 → 0.16.0**,
migration 0031, **`minSchema` raised to 0.16.0** (redeploy required).

Closes [#241](https://github.com/fstamatelopoulos/cerefox/issues/241) (the
toggle), [#240](https://github.com/fstamatelopoulos/cerefox/issues/240)
(filtered search under-returned),
[#239](https://github.com/fstamatelopoulos/cerefox/issues/239) (`config list`
hid working keys) and
[#235](https://github.com/fstamatelopoulos/cerefox/issues/235) (live-test
timeouts).

Spec: [`docs/specs/review-workflow-toggle.md`](../specs/review-workflow-toggle.md)
(the discussion doc, converted in this iteration to record what shipped).

## Why

The `review_status` workflow presumes a reviewer. On an unattended agent
harness, or any single-operator store, there is none, so every agent write
lands `pending_review` and the queue grows without meaning. The maintainer
wanted it off — and, on reflection, off **by default** for new installs.

## Decisions (maintainer, 2026-09-03/04)

| Question | Decision |
|---|---|
| Name | `review_workflow_enabled`, in `cerefox_config`, group Governance, high-impact |
| Fresh install | `false` (seeded by `schema.sql`) |
| Upgrade | `true` (seeded by migration 0031) — an upgrade must not change behaviour |
| What "off" means | The feature is **absent** everywhere. The first draft proposed reporting `approved` on reads to keep required schema fields valid; rejected — "we are changing the data … I would prefer the extra complexity of hiding the flag from the UI and the API". Field absent on every read; search filter `400`; review-status endpoint `404`. |
| Stored rows | Never touched by a toggle |
| CLI | Drops the `status` column when off, for consistency |
| `doctor` | Always one `review workflow` line (on / off / row missing) |
| Curator agent | Future only; nothing here anticipates it beyond keeping the column and making the RPC the single decision point |
| #240 | Fix properly — do not assume nobody uses the filter |
| #239 | CLI derives from `CONFIG_CATALOG`; the new flag must be supported by CLI, API and web UI alike |

## What was built

**Database (0.16.0, migration 0031).** `cerefox_ingest_document` decides
`review_status` from `author_type` and `cerefox_config_bool('review_workflow_enabled', FALSE)`;
`p_review_status` is accepted and ignored. `cerefox_hybrid_search` and
`cerefox_search_docs` gain `p_review_status` (old overloads dropped).
`cerefox_set_config`'s `v_allowed` widened (re-shipped in the migration, and a
lockstep test compares it with `rpcs.sql`).

**One reader, every surface.** `reviewWorkflowEnabled()` in
`_shared/mcp-tools/feature-flags.ts` (rewritten as a per-key cache, 15 s TTL,
fail-closed, failures not cached). The web config route calls
`resetFeatureFlagCache()` after a successful `PUT`, so a flip is live on the
next request. Surfaces gated: web routes (document GET, list, dashboard,
recent-docs, project documents, trash, metadata-search, search filter,
review-status POST), MCP `cerefox_metadata_search`, the
`cerefox-metadata-search` Edge Function, CLI `document list` / `metadata
search`, and the SPA (`useReviewWorkflow()` hook; pill, badges and search chip
gated; `review_status` optional in the API types).

**Client decision sites removed** (six): `_shared/mcp-tools/{ingest,partial-edits}.ts`,
`packages/memory/src/ingestion/{pipeline,client-bridge}.ts`,
`supabase/functions/cerefox-ingest/index.ts`.

**Config catalog (#239).** New Governance entry; `cerefox config list` derives
from `CONFIG_CATALOG` (grouped text; `--json` keeps `keys: string[]` and adds
`catalog`). `_shared/__tests__/config-catalog-allowlist.test.ts` pins the
catalog to `v_allowed`.

**`doctor`.** New `checkReviewWorkflow()` right after "schema + RPCs".

**Tests (#235 and the toggle).** `packages/memory/test/_live-test.ts` (60 s
`liveTest`), 16 live files migrated, `live-test-budget.test.ts` guards it.
New `web-integration/review-workflow.test.ts` flips the flag both ways on
every run (43 assertions) and restores it. Flag-aware: `pipeline-ingest-text`,
`web-integration/{attribution,destructive}`, `edge-functions`
(metadata-search row). `destructive.test.ts` gained the production-write
guard it had been missing. Playwright: document-detail test follows the flag;
Settings test asserts the Governance row.

**Docs.** Spec converted; `configuration.md` (new "Review Workflow" section),
`api.md`, `cli.md`, `access-paths.md`, `connect-agents.md` (OpenAPI 3.4.0),
`README.md`, `solution-design.md`, `e2e-use-cases.md`, `AGENT_GUIDE.md`,
`CLAUDE.md` (review workflow, config catalog, `liveTest` conventions),
`CHANGELOG.md`.

## Verification (staging, 2026-09-04)

- Migration 0031 applied + RPCs refreshed via `cerefox server deploy
  --schema-only --yes`; `doctor` → schema 0.16.0, `review workflow ON`
  (the upgrade seed, as designed).
- `_shared`: 600 pass. Package suite against staging: **303 pass / 2 skip /
  0 fail**. Playwright: 20/20 with the flag on; document-detail + search
  tests re-run with the flag off (6/6); staging restored to `true`.
- Edge Functions `cerefox-ingest` and `cerefox-metadata-search` deployed to
  the staging project; narrow live EF suite 10/10 with the flag on, the
  metadata-search row assertion re-run with it off.
- CLI: `document list --json` / `metadata search --json` carry
  `review_status` only when on; `config list` shows the Governance entry.

## Release notes for the cut

- Schema gate: 0.16.0 in both literals; `cut_release.ts` will check.
- `EF_VERSION` bumps at the cut (two EFs changed).
- After the cut: `cerefox server deploy` on staging then production (both
  schema and functions); `doctor` should print `review workflow ON` on both
  (upgraded stores). Production keeps today's behaviour until the maintainer
  flips it.
- **#154** (Node baseline / commander 15) was pencilled for v1.13.0 and is
  untouched here; it moves to the next minor. Third move; same reasoning as
  before (keep "what changed?" unambiguous).
