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

**2026-09-04 — v1.13.1 SHIPPED** (PR #243, squash `a92c151`; npm + ghcr
published; **verified on staging**: client 1.13.1, schema 0.16.1, EF v1.13.1,
package suite 303 pass / 2 skip / 0 fail with the flag ON and OFF, Playwright
20/20, remote-MCP live suite 26/26 incl. the `by_author` negative case; flag
restored to `true`, no fixtures left). Two low-risk fixes. (a) The flag was
meant to hide/show the review workflow, not change what a write stores;
v1.13.0's RPC stored `approved` for everyone while off. Now
`cerefox_ingest_document` decides from `author_type` alone and the flag is
presentation-only. Schema 0.16.0 → **0.16.1**, RPC-only, no migration,
`minSchema` unchanged. (b) One caller-identity name on every MCP tool:
`author` (reads and writes), with `requestor` kept as a silent alias; the
audit-log filter formerly called `author` is now `by_author` (the one real
behaviour change, called out in the CHANGELOG). Found when a new agent read
the schemas literally and concluded the partial-edit tools had no author.
`cerefox-mcp` enforcement takes either name. CLI flags and primitive-EF
bodies unchanged. **Pending (maintainer)**: `cerefox server deploy` on
production (client 1.13.1 sees schema 0.16.0 / EF 1.13.0 as warnings, not
gates), `cerefox-local upgrade` (Local is healthy at 1.13.0), then one
combined Discord announcement for 1.13.0 + 1.13.1. A post-cut test-only
commit (`65b28a7`) gave the review-workflow suite's hooks the `liveTest`
budget: its afterAll tripped bun's 5 s hook default under a full parallel
run. Detail: [iteration 44](plans/iteration-44-review-workflow-toggle.md)
(v1.13.1 follow-up block).

**2026-09-04 — v1.13.0 SHIPPED** (PR #242; deployed and verified on staging,
production and Cerefox Local). The review workflow
becomes optional: a store-level `review_workflow_enabled` flag — **false on a
fresh install, true on an upgraded store** (migration 0031) — decided ONCE in
`cerefox_ingest_document`, with the six client-side copies of the rule
removed. With it off, `review_status` is absent from every surface (API, MCP,
CLI, Edge Function, web UI); the search filter is a 400 and the review-status
endpoint a 404; stored rows are never touched. Also closes #240 (filter moved
into the search RPCs), #239 (`config list` derives from `CONFIG_CATALOG`) and
#235 (`liveTest` 60 s budget + guard). Schema **0.16.0**, **`minSchema` raised
to 0.16.0** (redeploy required). Staging: package suite 303/0, Playwright
20/20 in both flag states, EF suite 10/10. Detail:
[iteration 44](plans/iteration-44-review-workflow-toggle.md); spec:
[`specs/review-workflow-toggle.md`](specs/review-workflow-toggle.md).

Post-release: `doctor` prints `review workflow ON` on staging and production
(upgrade seed); the maintainer flipped it off on Cerefox Local only, which is
what surfaced the v1.13.1 correction above. **#154** (Node baseline) slips to
the next minor — third move, same reasoning.

**2026-09-03 — v1.12.2 SHIPPED** (iteration 43, #237: the false container
warning). Iterations 40–43 are closed; see below and
[history](plans/history.md).

**2026-09-02 — v1.11.0 SHIPPED and verified on ALL THREE instances**
(staging, production, Cerefox Local). Iteration 40 delivered optional
`author`/`requestor`/`author_type` on `/api/v1` (#226), the `doctor` config-dir
misreport (#225), the repo-root compose bind (#227), and #228 — `POST
/documents/{id}/upload`, broken since v0.11.0 and found only because the same
work revealed the web-integration suite had been skipping since v0.9.0. No
schema change. #225–#228 closed by PR #231. Detail:
[iteration 40](plans/iteration-40-api-attribution.md).

**Live verification** (2026-09-02): production `doctor` all-green on EF v1.11.0;
attributed reads confirmed logging `access_path=api` on the shared Cerefox Local
instance (the bot harness's own backend); MCP read path unaffected. The
production EF deploy first failed on an upstream registry race — JSR published
`supabase-js@2.113.0` at 06:03:13Z, npm published its `auth-js` dependency at
06:05:01Z, and the deploy landed in that 108-second window. Staging had deployed
before 06:03 and resolved 2.112.4, which is why the same command worked there.
Retrying after the window closed succeeded. **Pinning the `jsr:@supabase/
supabase-js@2` specifier was considered and REJECTED** (2026-09-02): the failure
is rare, loud, leaves the previous functions live, and self-heals on retry, so a
permanent manual-bump burden across 9 files is the worse trade. What it does
justify is a readable error message (see iteration 41).

**2026-09-03 — v1.12.0 SHIPPED then IMMEDIATELY HOTFIXED. Iteration 42
(v1.12.1) fixes a release-day break.** v1.12.0's #229 auth gate made Cerefox
Local **completely inaccessible** — every request 401, web UI included —
because Docker's port publishing rewrites the source address, so the loopback
exemption never matched. Found live on the maintainer's instance by a demo
agent, not by the suite. Detail:
[iteration 42](plans/iteration-42-container-loopback.md).

**The design correction, which matters beyond the bug**: inside a
bridge-networked container the server CANNOT distinguish a host-loopback caller
from a remote one (Docker NATs both to the same address), so the loopback-exempt
middle ground is not implementable there. The container gate is now
all-or-nothing, decided on the HOST from the publish address. Guarded by
`docker/local/smoke-auth.sh`, which builds the real image and was verified to
fail on the v1.12.0 behaviour.

**Lesson**: a feature that depends on a property of the transport must be tested
in every packaging that changes the transport. 17 unit tests, 8 HTTP-boundary
tests and a real LAN verification all passed — every one of them against
`cerefox web` running natively.

**2026-09-02 — Iteration 41 CLOSED (v1.12.0).** Authentication for
`/api/v1` (#229, design-first), the ingest routes' HTTP-status inconsistency
(#232), live suites skipping in a full `bun test` (#230), and the deploy-error
message above. Detail: [iteration 41](plans/iteration-41-api-auth.md).

**Release lineage decided 2026-09-02**: v1.12.0 is this batch; **#154**
(commander 15, Node ≥ 22.12, installer detection) moves to **v1.13.0**. Both are
"your setup may need attention" releases, and landing an auth change and a
platform-baseline drop together makes "what broke?" ambiguous for anyone who
hits a problem. #154 has now moved twice (v1.11.0 → v1.12.0 → v1.13.0), which is
acceptable because each move was made to protect a clearer announcement, not to
avoid the work.

**Unreleased on `main`**: `00e37ca` (test-only — the `ingest-dir` live test had
no timeout and inherited bun's 5s default, failing at 22s during the v1.11.0
staging pass). Rides the next cut.

Previously: **v1.10.0 + v1.10.1 SHIPPED** (2026-08-22) and verified on BOTH
staging and production. Production jumped 1.9.1 → 1.10.1 in one hop
(migration 0030 ran clean; the interrupted-then-rerun deploy proved the
idempotency design; guides re-synced 17/17; acceptance 15/15 on prod; #222
warning verified firing on prod CLI and quiet on clean writes). #222 closed.
The 1.10.x line was announced in Discord `#announcements` on 2026-08-22.

Schema is at 0.16.0 (v1.13.0, migration 0031); `minSchema` is **0.16.0**,
raised in v1.13.0 — the second raise since the policy was written (the first
was v1.9.0, iteration 38; the rationale for this one is in
`specs/review-workflow-toggle.md`).
The tool surface is 15 core + 4 dormant relation tools (delete/restore
joined in v1.7.0).

**What shipped** — an agent's question ("why is there no delete in MCP?")
grew into the release pair: `cerefox_delete_document` (requires the caller's
read-hash; reason in audit) and `cerefox_restore_document` (#210 — restore
moved out of the human-only tier; **permanent purge is the single
web-UI-only action**); referential integrity for `](uuid)` links (#214, both
phases: write-time guard + `document dead-links` sweep — mangled-UUID
protection, LLMs corrupt long ids structurally, see
`docs/guides/linking.md`); the #212 metadata-destruction fix (community
report, guarded at every write path + table CHECK); trashed documents refuse
content updates; dashboard recent-docs project selector; review-status-pill
staleness fix. Five review rounds, 54 findings addressed.
Details: [iteration 37](plans/iteration-37-mcp-delete-parity.md).

**Open threads for a next session**: staging is UP and current (recovered
8/14 after a Supabase-side transient; the maintainer leaves it running and
pauses over the weekend if nothing is being built); the deferred-by-decision
items below still stand.

Previous state (v1.6.1, for context):

Three releases went out in six days, all driven by agents using the previous
one:

- **v1.4.0** — section read (#198), `rename_section` (#197), loss reporting by
  what was touched (#196), CLI provenance (#193), plus guard debt (#171, #194,
  #168). Schema 0.11.1.
- **v1.5.0** — CLI section read (#201), dashboard access paths (#195), UTC
  timestamp markers (#199), `serverName` in JSON (#202), server identity in
  `get_help`, the heading-duplication refusal, a committed acceptance harness,
  **and an RLS security fix**: `cerefox_document_relations` had row-level
  security disabled since iteration 29, found by Supabase's advisor rather than
  by us. Schema 0.11.2.
- **v1.6.0 / v1.6.1** — `cerefox_set_document_metadata` (#204): change tags
  without resending a document, merging so concurrent agents cannot clobber each
  other. Plus two dashboard fixes (#205, #206) and their follow-up. Schema
  0.11.3.

**Production is current**: schema 0.14.1, Edge Functions and web UI on 1.9.1+.

### What is open

- **#155 is closed.** The UI e2e suite was never broken: it defaulted to port
  8000 and reused whatever `cerefox web` was already there, so it tested a
  different build. It passes 18/18 against the build in the repo.
- **Deferred by decision, with reasoning on the tickets** — do not re-derive
  these as bugs: register row 22 (append a table row without resending its
  section; observed and priced at 1,100 chars to add one row to a 4,164-char
  section), and Playwright in CI (needs live credentials and a labelled target,
  so it runs locally before pushing frontend changes).
- **Unverified by execution**: the `self-update --check` tests now skip when the
  npm registry is unreachable, but Bun's fetch ignores `npm_config_registry` and
  the proxy variables, so that skip path was never exercised.

- **Plans**: [iteration 35](plans/iteration-35-partial-edits-followups.md),
  [iteration 36](plans/iteration-36-observability-and-parity.md). The v1.6.x work
  was small enough to run without its own iteration plan; it is recorded in
  `CHANGELOG.md` and in the issues it closed.

---

## Active iteration

**[Iteration 44 — the review workflow becomes optional](plans/iteration-44-review-workflow-toggle.md)**
— ⏳ **IMPLEMENTATION COMPLETE, verified on staging, awaiting review + release**
(2026-09-04), target v1.13.0. Schema 0.16.0, migration 0031, `minSchema`
0.16.0. Closes #241, #240, #239, #235.

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
