# Cerefox Implementation Plan

> **What this doc is — read this first.** `plan.md` is the project's primary
> **cross-session hand-off artifact** and high-level progress record. Its main
> consumer is the *next* AI dev session (and any human adopter following along):
> read it to understand where the project is and what's next *before* touching
> code. It tracks history and progress at a higher level than git — the "why"
> and "what next", not every commit.
>
> **How to use it:**
> - **Read [`### Iteration 33 — Partial Document Edits (2026-08-08 → , target v1.3.0-beta)

The largest spec-first iteration to date. The spec
([`docs/specs/partial-document-edits-design.md`](specs/partial-document-edits-design.md))
was shaped by **four real agent sessions** over two days — each session's usage
overrode prior reasoning, twice reversing decisions (scope: append-alone →
two-tool contract; `end_of_section`: subtree default → never-guess). Frozen
2026-08-09. Technical design:
[`docs/specs/partial-edits-technical-design.md`](specs/partial-edits-technical-design.md).

**Contract (frozen)**: two tools — `cerefox_insert` (additive, non-destructive
annotation) and `cerefox_edit` (1..n operations of `insert` / `replace_section` /
`delete_section`, atomic, one token, destructive annotation) — plus `get_document`
outline mode and the #189 fix (create returns `content_hash`). Positions:
`end_of_document` / `end_of_section` / `after_heading` / `before_heading`; anchors
are exact headings or parent paths; every ambiguity errors with candidates rather
than guessing.

**Build plan (branch `feat/partial-edits`, unattended 2026-08-09 night)**:
1. ✍️ Freeze-pass on the spec (done — uniform nesting rule for replace/delete)
2. Technical design doc (done)
3. `_shared/partial-edits/` pure module (outline parser, anchor resolver,
   operation applier) + exhaustive unit tests
4. RPC: `p_operations` per-op audit labels, `content_hash` + `size_warning`
   returns, migration 0019 (audit CHECK widened), schema **0.11.0**
5. `_shared/mcp-tools/` handlers: `insert.ts`, `edit.ts`, get-document `outline`
6. CLI: `document insert`, `document edit`, `document get --outline`
7. Live e2e vs **staging only** (probe-and-skip; also tomorrow's joint
   walkthrough script); deploy 0.11.0 to staging; verify vs the spec §3/§9
8. CHANGELOG, agent guides, EF version bump, security/regression pass

Then: joint staging validation with the maintainer → PR → beta → prod deploy →
the maintainer's agents dogfood it (their §8 feedback is the acceptance test).

## Current Focus

**Update (2026-08-09, `main` at v1.2.0):** v1.2.0 shipped (MCP tool annotations;
the #183 retention fix; minSchema 0.10.5). **Iteration 33 — Partial Document
Edits is ACTIVE** on `feat/partial-edits`: spec frozen after four agent-session
feedback rounds, technical design committed, unattended build in progress
targeting a staging-validated beta. See the iteration 33 entry above for the
step list; the frozen spec is the success criterion. Staging is unpaused for the
build; **prod untouched until the joint validation passes**. Awaiting: feedback
from Debasis's agents on the spec (will slot into §8/§9 without reopening the
freeze unless a session finding demands it); #189 ships inside this iteration.
