# Cerefox Implementation Plan

> **What this doc is — read this first.** `plan.md` is the project's primary
> **cross-session hand-off artifact** and high-level progress record. Its main
> consumer is the *next* AI dev session (and any human adopter following along):
> read it to understand where the project is and what's next *before* touching
> code. It tracks history and progress at a higher level than git — the "why"
> and "what next", not every commit.
>
> **How to use it:**
> - **[`## Current Focus`](#current-focus) is at the top.** It is the live status
>   and what's next; the active iteration follows it. Closed iterations move to
>   [`plans/history.md`](plans/history.md), so this file stays short enough to read
>   in full. (It was one 4,500-line file with the live status at the very bottom
>   until 2026-08-09, when an automated edit searching for that heading matched
>   this very sentence instead and truncated the entire history. Restored from
>   git; the split is the durable fix.)
> - **Keep it current — this is non-negotiable.** Whenever work starts, completes,
>   or is re-scoped, update the relevant iteration entry **and** the `Current Focus`
>   block in the same session. A stale `plan.md` silently breaks the next session's
>   hand-off; treat updating it as part of finishing the work, not an afterthought.
> - **It is not the changelog.** Release-by-release notes live in
>   [`CHANGELOG.md`](../CHANGELOG.md); design rationale lives in `docs/specs/`.
>   Link those rather than duplicating them here (duplicates rot).
>
> **Approach**: iterative and agile — each iteration delivers working functionality.

---

## Current Focus

**2026-09-30 — v1.16.0 IS RELEASED AND VERIFIED on staging and Cerefox Local;
production (on 1.15.3) awaits the maintainer.** Headline: opt-in trash auto-purge
(#251, iteration 47): the delete that adds to the trash also sweeps documents older than
`trash_retention_days` (default 60), off by default; schema 0.17.0, migration 0033, so
`cerefox server deploy` is required. Also: `/version` reports the running code's commit,
not the daemon cwd's (#305), and two advisories cleared.

**The first v1.16.0 cut failed on its tag and was re-cut** (npm never published; ghcr
had, and was overwritten). Cause: an `api.md` table cell said "(v1.16.0)"; summaries are
copied into the generated `openapi.json`, whose "no package version" guard can only fire
once the cut bumps the package. New guard (#307) fails BEFORE the cut on any `vX.Y.Z`
in the artifact that is not older than the current package. Rule: never write the
upcoming release number into `api.md`'s endpoint table.

Verified: staging (released package, `server deploy`, doctor green incl. the new
auto-purge line; the smoke test; an auto-purge round trip on the released build;
Playwright 27/1) and Local (`pg_dump` in `~/.cerefox/local/backups/`, upgrade, data
identical, embedder runtime unchanged, migration applied on start, settings seeded
off/60). Auto-purge was left OFF on both; turning it on for Local is the maintainer's
call. Discord announcement drafted (two messages), not yet posted.

**Trash auto-purge is ON for Cerefox Local only** (enabled 2026-09-30 at the
maintainer's request, 60-day period). Its trash held 3 documents, all trashed
2026-09-30, so **the first real purge can happen from 2026-11-29**; check the audit log
for `trash-retention` entries after that date. Production stays OFF (maintainer
decision); production is still on 1.15.3, and its 1.16.0 upgrade (backup first) is
pending with the maintainer.

Resolved after the release (#308, next release): `cerefox server deploy` run from the
repo's own build failed every Edge Function. Root cause: inside an npm workspace `npx`
moves the child to the workspace package's directory (`packages/memory`) whatever `cwd`
it is given, so the Supabase CLI looked for functions there. Now passes `--workdir`.
Same error text as #84, a different cause, which is why it kept looking solved.

**2026-09-30 — v1.15.3 IS RELEASED AND VERIFIED on staging and Cerefox Local;
production (still 1.15.1) is green-lit and awaiting the maintainer.** npm `latest`, ghcr
`v1.15.3` = `latest`, and the GitHub Release are out; release workflow, image build and
main CI watched to green; the registry tarball carries all 19 guides and `openapi.json`.

It carries #301 (update-by-id override note only for an explicit `false`, on MCP, CLI,
`/api/v1` and the `cerefox-ingest` EF; `/schema-version` reports the bundled version on
every install and `mismatch` means deployed < bundled; cached model loads silently; the
Local image sets `ORT_DISABLE_TELEMETRY`, because the in-process opt-out does not reach
onnxruntime under Bun) and #303 (every guide ships; `GET /api/v1/openapi.json`, with an
RFC 8631 `Link: rel="service-desc"` on every `/api/v1` response).

Verified: **staging** (own 1.15.3 tree, `server deploy` with 9 EFs, web :8030 restarted,
`doctor` green, a 34-check smoke against the running server including the served spec
byte-identical to the tagged artifact, Playwright 26/1-skip, the deployed ingest EF and
the stdio MCP tool both omitting the note unless `false` is sent). **Local** (fresh
`pg_dump` in `~/.cerefox/local/backups/`, `upgrade v1.15.3`, data identical to baseline,
`doctor` green, embedder runtime unchanged from 1.15.2, the same smoke passing, the CLI
silent on a cached model, `ORT_DISABLE_TELEMETRY=1` in the container).

Observed on Local, not ours: an API client's e2e tests create and soft-delete test
documents without purging them (the ~1,800 trashed documents) and send no identity
headers, so their writes are recorded as `web-ui`. #300 stays open (pin the Local
image's embedder runtime; decide the move to transformers 4.x deliberately).

**2026-09-30 — v1.15.2 IS RELEASED AND VERIFIED on staging and Cerefox Local;
production is awaiting the maintainer's upgrade.** npm (`latest`, with provenance),
ghcr `v1.15.2` = `latest`, and the GitHub Release are all out; the release workflow and
main CI were watched to green (npm checked explicitly, per the 1.15.1 lesson).

What it contains: the `/api/v1` contract fixes and the derived OpenAPI document 1.1.0
(#296), the web UI's "Update existing" toggle (#298, sent as `last_write_wins`), project
chips on web search results, the local embedder's onnxruntime telemetry opt-out, the
dependency refresh (#297) and the audit-gate fixes (`ip-address` override, both `sharp`
exceptions retired). No schema change; the only Edge-Function-bundled change is the
embedder file, which EFs never execute, so `server deploy` just refreshes the EF label.

Verified after publish:
- **Staging** (own install tree, 1.15.2): `server deploy` (0 migrations, 9 EFs), web
  daemon :8030 restarted, `doctor` all green (EF 1.15.2, schema 0.16.2); a 33-check
  contract smoke against the running server, every response parsed with the published
  schemas; Playwright 26/1-skip against :8030; CLI, stdio MCP (15 tools) and one remote
  MCP `tools/list` call.
- **Cerefox Local** (`cerefox-local`, :8010): full `pg_dump` taken first
  (`~/.cerefox/local/backups/cerefox-local-pre-v1.15.2-*.sql.gz`, kept apart from production's `~/.cerefox/backups`), `upgrade v1.15.2`; data
  identical to the pre-upgrade baseline (179 docs / 205 chunks / 22 projects / 1,808
  trashed); `doctor` green; embedder runtime identical to the 1.15.1 image
  (transformers 3.8.1 + nested onnxruntime 1.21.0, so existing chunks stay valid);
  contract smoke passes.
- `cerefox-staging` (second Local container) is still on v1.15.0, untouched.

Open follow-ups: #300 (Local image resolves its embedder runtime fresh per build, still
on transformers 3.x); `GET /schema-version` reports `bundled: null` inside the Local
container (pre-existing, cosmetic; `doctor` reads it correctly); the in-container CLI
prints "loading … from HuggingFace (first-run only)" on every run though the model is
cached; the ingest note "update_if_exists flag was overridden" appears even when the
caller never sent that flag. #251 remains the next feature candidate.

**2026-09-28 — v1.15.1 IS RELEASED AND VERIFIED.** npm, ghcr, the GitHub Release
and the tag are all out and consistent. Staging, Cerefox Local and production are
on it. `main` is `cf1f2d4`; no open PRs of ours, no feature branches.

### What shipped in v1.15.1

| # | Change | Reaches a user? |
|---|---|---|
| #289 | Web UI blanked when typing in a metadata key/value field | **Yes** — the reason this is a release |
| #284 | Data API grant list derived from the catalogue (schema **0.16.2**, migration 0032) | Yes, on a fresh cloud deploy |
| #270 | OpenAPI 3.1 document for `/api/v1` at `docs/api/openapi.json` | No — repo-only |
| #286 | `cerefox_export.ts` writes a metadata sidecar | No — contributor script |

`scripts/` and `docs/api/` are **not** in the npm package (`files` is
`dist, docs, AGENT_*, README, LICENSE, CHANGELOG`; the published tarball is 104
files). So #270 and #286 are repo value, and that is why 1.15.1 was a patch rather
than a minor. Verify this with `cd packages/memory && npm pack --dry-run` — running
it from the repo root packs the `private: true` workspace root instead and misleads.

### The release had to be cut twice — read this before the next cut

The first v1.15.1 attempt **tagged, released on GitHub and published its container
image, but skipped npm.** `info.version` in the generated OpenAPI document was read
from `packages/memory/package.json`, and the artifact is generated *and committed*
with a byte-for-byte staleness guard — so `cut_release.ts` bumping the version made
the cut commit itself stale, CI failed on the tag, and `Publish to npm` never ran.

The guard was right and nothing a human had edited was wrong, which is the worst
shape a release blocker can take. Fixed in #291 by making `info.version` the **API
surface** version (`1.0.0`), with two guards: the package version must not appear
anywhere in the artifact, and regeneration must be deterministic. Both proven to
fire by reintroducing the coupling.

Because npm never received it, the tag was **re-cut** rather than superseded — this
project's one sanctioned reason to move a tag (CONTRIBUTING.md: *"an objective
failure of the release pipeline itself"*). The recipe, if it is ever needed again:

```bash
gh release delete vX.Y.Z --yes --cleanup-tag   # release + remote tag
git tag -d vX.Y.Z                             # may already be gone; harmless
# then revert the cut commit's bookkeeping so the NORMAL path runs again:
#   fold the [vX.Y.Z] heading back into [Unreleased]
#   return VERSION, EF_VERSION, CEREFOX_VERSION, package.json, meta.ts to the prior release
bun scripts/cut_release.ts X.Y.Z --npm-publish --docker-publish
```

`EF_VERSION` and friends are *assigned* the release version, not incremented, so a
re-cut cannot double-bump them. Confirm the released changelog history is
byte-identical to the previous tag before cutting, or `checkReleasedSectionUnchanged`
will object.

### Verified on 1.15.1

Staging: `doctor` all-green (schema 0.16.2 deployed *and* bundled, EF 1.15.1),
`_shared` 1171/0, frontend unit 31/0, package suite 321 pass / 2 skip / 0 fail,
Playwright 24 passed / 1 skipped, plus `render-crash.spec.ts` against the **released**
:8030 server. All 10 `cerefox_*` tables reachable over the Data API, including
`cerefox_document_relations` — the one #284 was actually about. Cerefox Local
(`cerefox-local`, :8010) on the published image: version 1.15.1, schema 0.16.2,
bundled guides present, projects/search/metadata-keys/trash/get-document all good.

**`cerefox-staging`, the second Local container, is still on v1.15.0.** Not upgraded
here; the maintainer upgrades it separately.

### In `[Unreleased]` now

Only #292: `ops-scripts.md` documents the scripts it claims to (it listed 7 of 15 —
`gen_openapi.ts` and `cerefox_export.ts` had both shipped without an entry), derived
by `ops-scripts-documented.test.ts`; plus two stale pointers to #270 as future work.
**None of it reaches a user, so there is deliberately no release for it** — the next
release picks it up.

### Open, and what I would do next

- **Two dependabot PRs, both `CLEAN` but deliberately not merged** (the maintainer
  asked to hold): **#293** the minor-and-patch group (26 updates, nothing crossing a
  major; `onnxruntime-node` 1.27→1.30 and `@huggingface/transformers` 4.2→4.3 are the
  only two worth real verification, because they are the **local ONNX embedder** and a
  numerical change there would silently diverge from already-embedded chunks), and
  **#294** `@types/node` **24 → 26**, which I would **decline**: the runtime floor,
  CI, the release workflow and the maintainer's Node are all **24**, so typing against
  26 lets `tsc` accept APIs that do not exist on the supported floor. Revisit when the
  Node floor moves. Note they both touch `bun.lock`, so whichever merges second needs
  a rebase.
- **#251** (opt-in auto-purge of trash older than N days) is the only open non-backlog
  enhancement. It deletes user data on a timer, so it wants its own cycle with its own
  staging verification. Everything else open (#129, #140–#149) is a backlog umbrella.
- **The production export is verified and done** (#286's first real use). `cerefox_export.ts`
  against prod produced **1,059 unique documents = exactly the 1,059 live documents in the
  store**; 1,179 copies (102 documents in 2–3 projects), 1,179 sidecars, zero unpaired, zero
  orphans, zero duplicate names within a folder, the 23 trashed documents correctly excluded.
  30 random documents byte-identical to `full_content` with `content_hash` still current;
  14 more matched on title, source, timestamps, review status, chunk count and **all** project
  memberships. The 21 files present only in the older backup are 14 project-membership moves
  and 7 retitles, all confirmed live — nothing lost.
  Two open nits, neither blocking: the sidecar's `Characters` is the store's `total_chars`
  (sum of chunk content), which differs from the exported file size by 0–228 chars depending
  on how chunks rejoin — 1,017 of 1,179 match exactly, and relabelling it `Characters
  (stored)` is a one-line change; and one production title holds a literal `&amp;`, which
  matters because titles are boosted in search.
  Operational notes for the next run: `--force` permits a non-empty target but **never
  cleans**, so exporting over an old backup leaves orphans indistinguishable from current
  files; `/Users/fotis/src/cerefox/.env` points at the **same project as production** and
  `./.env` in the cwd outranks `~/.cerefox/.env`, so pass `CEREFOX_CONFIG_DIR` explicitly; and
  a plain `mv` onto an existing directory **nests** it rather than replacing it.

---

## Active iteration

**[Iteration 47 — Trash auto-purge](plans/iteration-47-trash-auto-purge.md)** —
✅ merged (#306), releasing as **v1.16.0**. The delete that adds to the trash also
sweeps it; off by default, 60-day default period. Verified live on staging.

Before iteration 47: work since v1.13.0 had run as ticket-sized slices off
`main` rather than as numbered iterations — #254–#267 (the search-response
contract), the v1.15.0 dependency sweep, then #270/#284/#286/#289 in v1.15.1. Each
is recorded in `CHANGELOG.md` and in the issue it closed. Open the next iteration
when a body of work needs a plan of its own; #251 (timed trash auto-purge) is the
first open candidate.

**[Iteration 46 — the SPA after an upgrade, and what the tab says](plans/iteration-46-spa-serving-and-tab-titles.md)**
— ✅ **CLOSED, shipped v1.14.2** (2026-09-08). #252, #253.

**[Iteration 45 — Empty trash](plans/iteration-45-empty-trash.md)**
— ✅ **CLOSED, shipped v1.14.0** (2026-09-05). #247, #249.

**[Iteration 44 — the review workflow becomes optional](plans/iteration-44-review-workflow-toggle.md)**
— ✅ **CLOSED, shipped v1.13.0** (2026-09-04), verified on staging and production.
Schema 0.16.0, migration 0031, `minSchema` 0.16.0. #241, #240, #239, #235.

**[Iteration 43 — say the true thing](plans/iteration-43-warning-clarity.md)**
— ✅ **CLOSED, shipped v1.12.2** (2026-09-03). #237.

**[Iteration 42 — container loopback](plans/iteration-42-container-loopback.md)**
— ✅ **CLOSED, shipped v1.12.1** (2026-09-03).

**[Iteration 41 — API auth](plans/iteration-41-api-auth.md)**
— ✅ **CLOSED, shipped v1.12.0** (2026-09-02). #229, #232, #230.

**[Iteration 40 — API attribution and environment honesty](plans/iteration-40-api-attribution.md)**
— ✅ **CLOSED, shipped v1.11.0** (2026-09-02). #225, #226, #227, #228.

**[Iteration 39 — Audit consistency: the web save on shared cores](plans/iteration-39-audit-consistency.md)**
— ✅ **CLOSED, shipped v1.10.0 + v1.10.1** (2026-08-22; schema 0.15.0,
migration 0030), verified on staging and production, announced.

**[Iteration 38 — Audit completeness, settings clarity, docs restoration](plans/iteration-38-audit-completeness.md)**
— ✅ **CLOSED, shipped v1.9.0/v1.9.1/v1.9.2** (2026-08-17/18), verified on
staging and production, announced.

The most recent closed:

**[Iteration 37 — MCP delete/restore parity, link integrity, dashboard UX](plans/iteration-37-mcp-delete-parity.md)**
— ✅ **CLOSED, shipped v1.7.0 + v1.7.1** (2026-08-14), verified live, announced.

The three before it closed in sequence:

**[Iteration 36 — Observability, surface parity, test hygiene](plans/iteration-36-observability-and-parity.md)**
— ✅ **CLOSED, shipped v1.5.0** (2026-08-11), plus the v1.6.x follow-ons.

**[Iteration 35 — Partial-edit follow-ups and guard debt](plans/iteration-35-partial-edits-followups.md)**
— ✅ **CLOSED, shipped v1.4.0** (2026-08-11).

**[Iteration 34 — Partial Document Edits](plans/iteration-34-partial-edits.md)**
— ✅ **CLOSED, shipped v1.3.0** (2026-08-10).

---

**Near-term tracks** (iteration numbers are planning IDs, not ship order):
1. **Iteration 32 — Optimistic concurrency control**: ✅ **SHIPPED v0.11.0**
   (2026-06-12; schema 0.5.0; deployed + live-validated on the maintainer cloud).
   Content updates require `expected_content_hash` (compare-and-swap on the existing
   `content_hash`, atomic in the ingest RPC via `FOR UPDATE`) or an explicit
   `last_write_wins`. Design of record:
   [`docs/specs/concurrency-control-design.md`](specs/concurrency-control-design.md).
   **v0.11.1 follow-up** (on `fix/metadata-preserve-on-update`, schema 0.6.0):
   content updates without metadata no longer wipe a document's tags
   (`p_metadata` NULL = keep existing), plus CLI `metadata search` parity (filter
   optional with another scope). The wipe incident also spawned the
   **metadata-versioning** backlog proposal:
   [`docs/research/metadata-versioning.md`](research/metadata-versioning.md).
2. **Iteration 31 — Local ONNX embedder** (fully-offline World B), target **v1.1+ (post-1.0)**
   (slid from v0.11.0 to make room for iter-32), on `feat/local-embedder`.
   Design committed; P0 implementation pending review. See iter-31 in the log above.
3. **Iteration 28 — v1.0**: ⏳ **ACTIVE (28A) as of 2026-07-08** on `feat/oauth-mcp`.
   Re-scoped to fold in the **OAuth-protected remote MCP server** (28A: claude.ai +
   Claude mobile via Supabase's native OAuth 2.1 Server — design of record:
   [`docs/specs/oauth-mcp-server-design.md`](specs/oauth-mcp-server-design.md)),
   then the security audit (28B, on the Fable 5 model, covering the new OAuth
   surface) and the stability contract (28C: strict SemVer becomes binding).
   28B/28C trigger: ~2–3 months of v0.10/v0.11 in the wild + an outside user
   installing unaided.
4. **Iteration 29 — Document Relations & Semantic Graph** (post-v1.0, target **v1.1+**),
   **partially implemented and dormant, NOT design-only** (corrected 2026-08-12;
   this entry previously said "implementation is future work", which was wrong
   and would have had someone rebuild what already ships). Design of record:
   [`docs/research/document-relations-and-semantic-graph.md`](research/document-relations-and-semantic-graph.md).

   **What exists**: the `cerefox_document_relations` table; four RPCs
   (`cerefox_set_relation`, `cerefox_delete_relation`, `cerefox_get_relations`,
   `cerefox_get_neighbors`); four MCP tools wrapping them; and the traversal
   semantics documented in `AGENT_GUIDE.md` (`supersedes` marks the target
   superseded, `contradicts` marks both stale, and several types are symmetric).

   **What does not**: any web-UI surface beyond the Settings toggle, so a human
   cannot see or curate a graph the agents can write. There is no CLI parity for
   the four tools either.

   **Status**: gated behind `relations_enabled`, which defaults to **false**, so
   the tools are hidden from `tools/list` on a default install. That is why the
   table is empty on most deployments, and why the RLS gap fixed in v1.5.0
   exposed no content.

   **How it got here matters for that decision.** It was not a deliberate
   roadmap commitment. The item moved into an iteration plan during a TODO
   cleanup while several things were in flight, the maintainer did not catch it,
   and phase 1 of the original design was implemented on that basis. So there is
   no prior investment to protect: finishing it and removing it are both open,
   and should be judged on merit rather than on sunk cost.

   **Before building on it**, decide whether the dormant half ships or is
   removed. A feature that is reachable by agents but invisible to the human
   contradicts the human-on-the-loop governance model the rest of the product
   follows, and it has already cost one security incident by being the one table
   nobody was looking at.

Release history lives in [`CHANGELOG.md`](../CHANGELOG.md); the design-of-record
for the polish arc is [`docs/specs/polish-and-distribution-design.md`](specs/polish-and-distribution-design.md).
The dated iteration log above this section remains the high-level progress record.

---

---

## History

Iterations 1–33 — everything shipped through v1.2.0 — are in
[`plans/history.md`](plans/history.md), the master history log. From iteration 34
on, an active iteration gets its own plan under [`plans/`](plans/), linked from
Current Focus above and from the history log when it closes.
