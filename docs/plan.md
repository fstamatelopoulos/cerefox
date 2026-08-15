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

**2026-08-15 — v1.8.0 is CUT-READY on `feat/v1.8.0-drop-version-artifacts` / PR #217 (#216: archived chunks drop their search artifacts; schema 0.13.0). Six review rounds done, sandbox-validated; next: maintainer merges + cuts, installs on staging, then the agreed staging dress rehearsal (before-baseline → migrate → byte-identical reconstruction, search, new-write strip, restore, retention, acceptance + Playwright, idempotent re-deploy) gates the prod deploy. v1.7.x shipped, deployed, verified, announced.**

Schema is at 0.12.2; `minSchema` stays 0.10.5 (reviewed each release,
deliberately not raised). The tool surface is 15 core + 4 dormant relation
tools (delete/restore joined in v1.7.0).

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

**Production is current**: schema 0.11.3, Edge Functions and web UI on 1.6.1.
`minSchema` remains 0.10.5, reviewed each time and deliberately not raised.

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

**None.** The most recent:

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
