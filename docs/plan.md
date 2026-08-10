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

**2026-08-10 — v1.3.0 in production; v1.4.0 built and staging-validated.**
**Iteration 35 is BUILD COMPLETE** on `feat/1.4.0-section-read`, awaiting a
sub-agent review, then a release.

All eight tickets closed: #198 (section read), #197 (`rename_section`), #196
(shrink trigger), #193 (CLI `--source` + the CLI half of #189), #189 (verified
already fixed, closed), #171 (typecheck coverage), #194 (script guard), #168
(environment-labelled MCP name). **#155 (UI e2e, 8/13 failing) stays out** — it
needs its own session with a human to confirm intended UI.

Schema 0.11.0 → **0.11.1** (migration 0021, audit CHECK widened for
`rename-section`). `minSchema` reviewed and deliberately left at 0.10.5.

- **Plan + outcome**: [`plans/iteration-35-partial-edits-followups.md`](plans/iteration-35-partial-edits-followups.md)
- **Spec** (§8 sessions 7–8, §9 register rows 13/24 now served):
  [`specs/partial-document-edits-design.md`](specs/partial-document-edits-design.md)
- Verified: typecheck 0, `_shared` 495 pass, package suite 190 pass, staging
  acceptance 22/22, remote Edge Function end-to-end. **Production untouched.**
- **Next**: sub-agent review → normal release (several small fixes, no single
  risky change) → prod deploy → CLI validation here, MCP validation by the
  user's agents over local and remote. Release notes must carry the
  **reconnect your MCP client** instruction.

---

## Active iteration

**[Iteration 35 — Partial-edit follow-ups and guard debt](plans/iteration-35-partial-edits-followups.md)**
(2026-08-10, target **v1.4.0**) — ✅ **build complete, staging-validated**.
Adds `rename_section` and a section read, fixes a warning that could not see its
own motivating case, and clears three guard-debt tickets. Outcome, verification
table and open risk in the linked plan.

**[Iteration 34 — Partial Document Edits](plans/iteration-34-partial-edits.md)**
— ✅ **CLOSED, shipped v1.3.0** (2026-08-10). Two MCP tools, `get_document`
outline mode, schema 0.11.0; contract shaped by four agent sessions and frozen
before any code.

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
   pending — design only. Design of record:
   [`docs/research/document-relations-and-semantic-graph.md`](research/document-relations-and-semantic-graph.md).
   (The early semantic-graph exploration branch was already merged to main;
   implementation is future work.)

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
