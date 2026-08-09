# Iteration 34 — Partial Document Edits

**Status**: ACTIVE (2026-08-08 → ). Branch `feat/partial-edits`. Target **v1.3.0** (current release is v1.2.0), shipped first as
`v1.3.0-beta.1` and validated on staging before any prod deploy.

**Spec (frozen — the success criterion)**:
[`../specs/partial-document-edits-design.md`](../specs/partial-document-edits-design.md)
**Technical design**:
[`../specs/partial-edits-technical-design.md`](../specs/partial-edits-technical-design.md)

## Why this iteration exists

An agent that wants to add three paragraphs to a 24,000-character document has
to resend all 24,000. That is a correctness problem before it is a cost problem:
the agent must reproduce the untouched remainder verbatim inside a tool call, and
any drift silently rewrites content nobody asked to change.

The spec is the unusual part of this iteration. It was shaped by **four real
agent sessions** over two days, under a stated rule that a session's observed
usage outranks anyone's reasoning — including the maintainer's and the authoring
agent's. That rule reversed the design twice:

- **Scope**: "ship `append` alone" → a two-tool contract, when session 2 reported
  ~70% mid-document edits against session 1's 100% appends.
- **`end_of_section`**: a subtree-end default → refuse-and-return-candidates,
  when session 3 supplied a document shape where the default lands content pages
  from where the agent meant it.

Session 4 then *shrank* the contract from three tools to two by showing that
coordinated multi-location edits were the majority case, which promoted the
batched form from "deferred" into the contract itself.

## The contract (frozen)

| | `cerefox_insert` | `cerefox_edit` |
|---|---|---|
| operations | `insert` only | `insert`, `replace_section`, `delete_section` |
| count | one | one to many, **atomic** |
| can destroy content | no, structurally | yes |
| MCP annotation | non-destructive | destructive |

Positions: `end_of_document`, `end_of_section`, `after_heading`,
`before_heading`. Anchors are exact heading text or a ` > ` parent path. Every
ambiguity errors with the candidates that resolve it — the design never guesses a
location. Plus `get_document` outline mode, and #189 (create returns
`content_hash`).

## Steps

1. **✅ Freeze-pass on the spec** — found and closed one gap: the nesting rule was
   defined for `end_of_section` but `replace_section`/`delete_section` share the
   ambiguity with higher stakes.
2. **✅ Technical design** — settles that the composition lives in
   `_shared/mcp-tools/` (not an RPC: chunking is TypeScript and embedding needs
   an external key; not EF-only: the CLI never touches Edge Functions), with the
   single `cerefox_ingest_document` RPC still the only write path.
3. **✅ `_shared/partial-edits/`** — pure string layer: fence-aware outline
   parser, anchor resolver, operation applier. 40 unit tests, including the
   scope-confusion guarantee (insert output always contains every input line).
4. **✅ DB — schema 0.11.0**, migration 0019: audit CHECK widened
   (`insert`/`replace-section`/`delete-section`), `p_operations` for per-operation
   audit entries, `content_hash` returned on create (#189), `size_warning` +
   `document_size_warning_chars`. **Staging probe 11/11**, and it caught two
   defects invisible from reading code:
   - audit entries in one batch shared `NOW()` (transaction start), so the order
     of operations inside a batch was unrecoverable → `clock_timestamp()`
   - the new config key was in the TS catalog but missing from
     `cerefox_set_config`'s in-RPC allow-list, so it was unsettable
5. **⏳ MCP handlers** — `insert.ts`, `edit.ts`, `outline` on get-document.
6. **⏳ CLI** — `document insert`, `document edit`, `document get --outline`.
7. **⏳ Live e2e against staging** — probe-and-skip, self-cleaning; doubles as the
   joint walkthrough script.
8. **⏳ Docs + review** — CHANGELOG, agent guides, EF version, security and
   regression pass.

## Guardrails

- **Staging only.** Prod is untouched until the joint validation passes.
- **The frozen spec is the acceptance test**: every §3 semantic and every §9
  register row marked **v1** must map to a named test.
- `minSchema` stays 0.10.5 — against an older server the new tools fail loudly
  (unknown RPC signature), which is the correct failure class. No silent
  misbehaviour, so no reason to block anyone's `cerefox web`.

## Then

Joint staging validation → PR → beta → prod deploy → the maintainer's agents
dogfood it. Their §8 feedback is the acceptance test the spec actually asks for.
