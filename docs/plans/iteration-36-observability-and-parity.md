# Iteration 36 — Observability, surface parity, and test hygiene

**Status**: ACTIVE — started 2026-08-11, branch `feat/1.4.1-observability`.
**Target**: **v1.4.1** (additive + fixes; no schema change expected).
**Predecessor**: [iteration 35](iteration-35-partial-edits-followups.md) shipped v1.4.0.

Four tickets, all found by *using* v1.3.0/v1.4.0 rather than by reading it, plus
test hygiene that this iteration is the right moment to fix.

## Why this iteration exists

v1.4.0 was validated over MCP and the Edge Functions, and shipped a read mode
the CLI cannot reach (#201). Its audit trail gained a fourth partial-edit
operation the web UI cannot filter or colour. Its timestamps are UTC with the
marker stripped, which sent an agent's log entries a day into the future (#199).
And the dashboard counts transports rather than actors, under-reporting agent
work by roughly 70% (#195).

The common thread is **surfaces drifting apart**: the same capability is present
on one path and absent on another, and nothing tells you. Each fix here is
small; the value is in closing the gaps and, where cheap, adding the guard that
makes the *class* visible.

## Scope

| # | What | Surface |
|---|---|---|
| #201 | `document get --section` / `--section-part` | CLI |
| #195 | Dashboard shows three access paths, and counts agent CLI usage | Web UI |
| #199 | Emit the UTC marker; document the content-date rule | MCP + CLI + docs |
| #202 | `configure-agent --json` carries `serverName` | CLI |
| — | Live suites clean up after themselves | Tests |

Plus whatever lands from the maintainer's held agent-feedback notes — the plan
is written so that arriving items slot in as additional phases rather than
reopening the ones below.

**Out of scope**: #155 (UI e2e 8/13 failing). Still needs a human to confirm
intended UI, and it is a bad fit for unattended work. **But see phase 2** — a
dashboard change lands with no working e2e, which is a risk to state plainly
rather than to solve here.

## Phases

Each phase ends green (typecheck + `bun test`) and commits on its own.

### Phase 0 — logistics
- Branch from `v1.4.0` on `main`.
- Confirm staging is on 1.4.0 / schema 0.11.1 before any live work.
- **Cleanup rule for this iteration.** An automated test may purge the
  fixtures *it created* — otherwise every run leaves residue in a trash a human
  has to empty. What is out of bounds is purging by hand to tidy up after
  myself, which is what happened in iteration 35: the CLI has no purge command
  by design, and reaching past that to `cerefox_purge_document` overrode a
  decision rather than respecting it.
  - Follow the pattern the suites already use: **raw deletes in dependency
    order** (`audit_log` → `document_versions` → `chunks` → `documents`), NOT
    `cerefox_purge_document`. That RPC deliberately preserves the audit trail
    — correct for a user purge, whose record should outlive the document, and
    pure litter for a fixture that existed for four seconds. The reasoning is
    already written down at `partial-edits-live.test.ts:143`.
  - Only ids the run created. Not a title-prefix sweep, which would catch a
    concurrent run's fixtures or a similarly-titled human document.

### Phase 1 — #201 CLI section read
The larger half of the parity gap. `document edit-parts` takes an opaque JSON
operations array, so `rename_section` reached the CLI for free; `document get`
takes declared flags, so the section read did not.
- `--section <anchor>` and `--section-part <own_body|subtree>`.
- Behaviour identical to the MCP tool, via the same `extractSection`: same
  anchor rules, same ambiguity refusal naming both options, `--section` +
  `--outline` refused, `--section-part` without `--section` refused, archived
  reads withhold `content_hash`.
- `--json` emits the same object shape the MCP tool returns.
- **Guard test**: assert CLI/MCP parameter parity for `get_document` explicitly,
  so the next read mode cannot ship on one surface only.

### Phase 2 — #195 dashboard access paths
- Show `local-mcp`, `remote-mcp` and `edge-function` separately rather than
  collapsing to "mcp · edge", and count `cli` usage by an agent requestor.
- The tile currently reads 637 where the honest number is far higher, because
  1,422 CLI operations are excluded and `edge-function` shows a bare 0 without
  saying it has 1,051 all-time.
- **Risk to state, not solve**: the Playwright suite is 8/13 failing (#155), so
  this lands without working e2e coverage. Keep the change display-only, and
  flag it for the maintainer to eyeball on staging.

### Phase 3 — #199 timestamps
- Stop truncating the zone: full ISO 8601 with `Z` in `audit-log.ts`,
  `list-versions.ts` (which currently emits a bare date), and the CLI renderers.
- **Do not** convert to local server-side — the reasoning is recorded in #199
  and must not be relitigated silently: "local" is undefined server-side (the
  remote MCP's local *is* UTC), it breaks the identical-behaviour-per-transport
  principle, and naked local times are not comparable across agents.
- Optional, if it stays small: a `display_timezone` config key rendering a
  second, parenthesised local value. Both, never one.
- **The part that actually prevents recurrence**: `AGENT_GUIDE.md` +
  `AGENT_QUICK_REFERENCE.md` (→ `get_help`) state that timestamps are UTC and
  that a date written into document *content* comes from the author's clock, not
  from a Cerefox timestamp. Re-run `bundle_help.ts`.

### Phase 4 — #202 configure-agent JSON
- Add `serverName` to the `--json` payload from the same `mcpServerName()` the
  writer uses. One line plus a test; grouped last because it is the smallest.

### Phase 5 — a reusable acceptance harness

**The suites are not the problem.** All eight live suites already hard-purge in
`afterAll`, via raw deletes in dependency order, and they have done so for
several iterations. Checking this before writing the phase inverted it.

What littered staging (and production, twice) is the **ad-hoc acceptance
harness** each session writes from scratch — `stg140.js`, `cli140.sh`,
`prod-round2.ts` — none of which had teardown, because each was meant to be
throwaway and then wasn't. The recurring cost is not a missing feature; it is
that the harness gets re-invented per session and the cleanup is what gets
dropped.

- A committed acceptance harness under `packages/memory/test/acceptance/`,
  driving both the CLI and the local MCP stdio server, with id-tracked teardown
  in a `finally` so a crashed run still cleans up.
- Reuses the existing four-table delete helper rather than adding a second
  cleanup convention.
- Two alignments to the existing suites while in there:
  - `search-recall` purges by **title prefix** (`LIKE '[E2E …]%'`) instead of by
    created ids — a sweep that would catch a concurrent run's fixtures.
  - It deletes only `cerefox_documents`, leaving audit rows behind, unlike the
    four-table pattern everything else uses.
- Verify by running twice and confirming no growth in the active document count
  or the trash.

### Phase 6 — docs and release prep
- CHANGELOG `[Unreleased]`, anchored on the heading.
- `staging-env.md`: document the **non-beta** install case — the guide only
  covers `@beta`, so for a normal release the documented command installs the
  *previous* version. Pin the explicit version instead.
- Compatibility matrix reviewed (no schema change expected → no `minSchema`
  movement).
- GPT Actions OpenAPI block only if an EF request/response shape moves.

### Phase 7 — staging validation and report
- Deploy to staging, run the acceptance pass over CLI **and** MCP — iteration 35
  proved a single-surface pass hides single-surface gaps.
- Test fixtures purge themselves; report anything left behind rather than
  assuming the teardown ran.
- Written report for review.

## Guardrails

- Staging only. Production is not touched by this iteration.
- **Tests purge their own fixtures; I do not purge by hand.** Ad-hoc cleanup
  is soft-delete, and the trash is the maintainer's to empty.
- Live write suites still refuse an unlabelled target; do not override the guard.
- Every phase green before the next starts.
- Anchor scripted edits to line-start patterns and assert the match is unique.
- Private detail from agent reports does not enter the repo, specs, or issues.
