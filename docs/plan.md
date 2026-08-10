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

**2026-08-10 — `main` at v1.4.0-dev; v1.3.0 shipped and in production.**
**Iteration 35 (Partial-edit follow-ups and guard debt) is ACTIVE** on
`feat/1.4.0-section-read`, target **v1.4.0**.

Eight tickets: the partial-edit feature completing itself under real usage
(#198 section read, #197 `rename_section`), defects found by using it (#196
shrink trigger, #193 CLI `--source`, #189 already fixed in v1.3.0), and guard
debt this iteration is the right size to clear (#171 typecheck coverage, #194
static guard, #168 environment-labelled MCP name). **#155 (UI e2e, 8/13
failing) is explicitly out** — unknown cause, unbounded, and it needs a human to
confirm intended UI.

- **Plan**: [`plans/iteration-35-partial-edits-followups.md`](plans/iteration-35-partial-edits-followups.md)
- **Spec** (§8 sessions 7–8, §9 register rows 13/24):
  [`specs/partial-document-edits-design.md`](specs/partial-document-edits-design.md)
- **Staging** is dedicated to this iteration and may be changed freely;
  **production is not touched** until the sub-agent review passes.

**v1.3.0 shipped (2026-08-10)** — partial document edits, schema 0.11.0. Two
agent sessions on the released build produced everything above: the outline →
edit loop works as designed, and the gaps are the parts the design assumed
someone would already have.

---

## Active iteration

**[Iteration 35 — Partial-edit follow-ups and guard debt](plans/iteration-35-partial-edits-followups.md)**
(2026-08-10 → , target **v1.4.0**, normal release preferred over a beta —
several small fixes, no single risky change). Adds `rename_section` and a
section read, fixes a warning that could not see its own motivating case, and
clears three guard-debt tickets. Full phase list and status in the linked plan.

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
