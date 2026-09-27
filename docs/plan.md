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

**2026-09-27 — v1.15.1 READY TO CUT.** `main` is green and clean: no open PRs,
no feature branches, `[Unreleased]` populated with four entries. Every suite run
against staging today — `_shared` 1169/0, frontend unit 31/0, package suite
321 pass / 2 skip / 0 fail, Playwright 24 passed / 1 skipped (the Empty-trash
test, which needs `CEREFOX_E2E_EMPTY_TRASH=1`).

**Why 1.15.1 and not 1.16.0.** Two of the four entries are new *capability*, but
neither ships in the npm package or the container, so no user gains a feature:

- `docs/api/openapi.json` (#270) is repo-only — `bundle_package_docs.ts` copies a
  curated `docs/guides/*.md` subset and nothing from `docs/api/`.
- `scripts/cerefox_export.ts` (#286) is a contributor script; `scripts/` is not in
  the package's `files` list.

What the shipped artifact gains is two fixes — the web-UI blank-screen crash
(#289) and the fresh-cloud-deploy grant gap (#284, schema 0.16.2) — plus a
refreshed `ops-scripts.md`, which *is* bundled. That is a patch.

**Release-gate state** (checked, not assumed):

- `schema_version` **0.16.2** in both literals (`schema.sql` `-- @version:` and
  `cerefox_schema_version()`); `cut_release.ts` gates the pair.
- `minSchema` stays **0.16.0**. The derived grants only affect a *fresh* cloud
  deploy, so a client on 1.15.1 against a 0.16.0 server behaves correctly — old,
  not wrong, which is the distinction `minSchema` exists to draw.
- **No Edge Function source changed** since v1.15.0 (`git diff --name-only
  v1.15.0..main -- supabase/functions` is empty), so the GPT Actions OpenAPI block
  needs no sync. `cut_release.ts` bumps `EF_VERSION` unconditionally at a stable
  cut regardless.

**What #289 cost, and the lesson worth keeping.** A one-character edit in a
metadata input blanked the entire web app, and the report read as "the web app is
broken". Two causes, and the second is the one that generalises:

1. Three `onChange` handlers read `e.currentTarget.value` *inside* a functional
   `setState` updater. React nulls `currentTarget` when the handler returns and
   the updater runs later, in the render phase — so the read threw **during
   render**. It was on two independent screens (Ingest → Metadata, Search →
   Filters), neither of which the report named; the second was found by scanning
   for the pattern, not by following the repro.
2. The frontend had **no error boundary anywhere**. Any render throw therefore
   emptied `#root`: white page, no message, nothing to click, and the browser
   console as the only diagnosis. The blast radius was out of all proportion to
   the defect, and it applied to every future render bug equally.

Both are fixed, and the class is guarded twice — a browser-free source scan in CI
(`frontend/src/lib/no-event-in-updater.test.ts`, asserted to fire on the verbatim
handler that shipped) and a Playwright spec that types into all three fields and
asserts `#root` still has children. The boundary was **proven** to catch by
injecting a deliberate throw, not assumed.

**Next after the cut.** #251 (opt-in auto-purge of trash older than N days) is the
only open non-backlog enhancement. It was deliberately *not* rushed into this
release: it deletes user data on a timer, so it wants its own cycle with its own
staging verification, not a slot in a patch. Everything else open (#129, #140-#149)
is a backlog umbrella.

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
