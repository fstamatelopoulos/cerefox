# Partial Document Edits — Technical Design

**Implements**: [`partial-document-edits-design.md`](partial-document-edits-design.md)
(the frozen spec; it is the success criterion — every §3 semantic and every §9
**v1** register row must be traceable to a mechanism below).
**Status**: v1 build, iteration 34. Branch `feat/partial-edits`.
**Date**: 2026-08-09

## 1. Where the logic lives (settling the RPC-vs-EF question)

**Not in an RPC, and not EF-only.** A partial edit is reconstruct → modify →
re-chunk → re-embed → write. Chunking is the TypeScript chunker
(`_shared/ingest/chunker.ts`) and embedding needs an external HTTP call with an
API key that has no business in Postgres — so the *composition* cannot be a
Postgres function. It also must not be EF-only, because the CLI and local MCP
never touch Edge Functions.

The composition lives in **`_shared/mcp-tools/`**, the module both transports
already import:

```
                    ┌─ local MCP server (stdio)  ─┐
_shared/mcp-tools/ ─┼─ cerefox-mcp EF (remote)   ─┼─▶ cerefox_ingest_document RPC
  insert.ts, edit.ts└─ CLI commands (same package)┘        (single write path)
```

The **final write is still the single `cerefox_ingest_document` RPC** — the
handler assembles the full new content and calls the same atomic
write-version-audit transaction every other content write uses. Single
implementation principle intact; the RPC grows three small things (§4), no new
RPC is created.

Pure string work (outline parsing, anchor resolution, applying operations) lives
in a new dependency-free module **`_shared/partial-edits/`** so it is unit-testable
without any client, runs identically under Deno (EF) and Node/Bun, and keeps the
handlers thin.

## 2. Module: `_shared/partial-edits/`

Runtime-agnostic, no imports beyond types. Three exports:

### 2.1 `parseOutline(content) → OutlineNode[]`

Single pass over the text producing a flat, ordered list of sections:

```ts
interface OutlineNode {
  heading: string;      // full heading line, trimmed: "### Notes"
  level: number;        // 1-6
  path: string;         // "## Intake > ### Notes" — §3.7 anchor form
  start: number;        // offset of the heading line's first char
  bodyStart: number;    // offset just past the heading line
  ownBodyEnd: number;   // before its first child heading (== subtreeEnd for leaves)
  subtreeEnd: number;   // before the next heading of equal-or-higher level
  chars: number;        // subtreeEnd - start (per-section size for outline mode)
}
```

**Fenced code blocks are skipped**: a `#` line inside ``` ``` ``` or `~~~` fences
is content, not a heading. The fence scanner tracks the opening fence's character
and length per CommonMark (a fence closes only on a matching marker at least as
long). This is the one correctness subtlety in the parser and gets its own test
block — a decision-log document quoting markdown *will* contain fenced headings.

Path construction: a stack of open sections by level; each node's `path` is the
` > `-joined headings of its ancestors plus itself. Duplicate `path`s are
possible and legal at parse time; ambiguity is the *resolver's* problem.

### 2.2 `resolveAnchor(outline, anchorHeading) → OutlineNode`

Implements spec §3.7 exactly:

- The **literal heading** is tried first, always: matched against `node.heading`
  (exact, trimmed), *including* when the anchor contains ` > `.
- Only if no heading matches literally is the anchor read as a **path** against
  `node.path` (exact, trimmed segments).

  This ordering is a fix, not a preference. Reading any ` > `-containing anchor
  as a path made headings that genuinely contain the separator — `## Draft >
  Review`, `## A > B` — unaddressable by their own text: outline mode printed
  the heading, the agent pasted it back verbatim, and the resolver replied
  "anchor not found" while listing it in the same message. Literal-first also
  preserves outline mode's promise that what it prints can be used as-is. Found
  by adversarial testing against staging, not by review.
- 0 matches → throw `AnchorNotFoundError` (never falls back to end-of-document).
- 2+ matches → throw `AmbiguousAnchorError` carrying `candidates: string[]` (the
  qualifying paths, ready to paste back). A path that is itself ambiguous throws
  the same error — the spec accepts this dead-end as rare and prefers it to
  occurrence indexes.

### 2.3 `applyOperations(content, operations) → { content, applied }`

Applies the ops **in order against the evolving text** (spec §3.4): each op
re-parses the outline of the current intermediate string. Naive-cost is fine —
documents are ≤ ~50K chars by policy and ops per call are few; re-parsing is
microseconds and buys total simplicity.

Position semantics (spec §3.1, §3.3):

| position | resolved insertion offset |
|---|---|
| `end_of_document` | end of text |
| `end_of_section` | leaf → `ownBodyEnd`; body+children → **requires `section_part`** (`own_body` → `ownBodyEnd`, `subtree` → `subtreeEnd`); children-without-body → `subtreeEnd` (unambiguous per spec) |
| `after_heading` | `bodyStart` |
| `before_heading` | `start` |

`replace_section` / `delete_section` target ranges the same way (freeze-pass
rule): leaf → `[bodyStart, subtreeEnd)`; body+children → require `section_part`
(`own_body` → `[bodyStart, ownBodyEnd)`, `subtree` → `[bodyStart, subtreeEnd)`).
`delete_section` with `scope: "heading_and_body"` extends the range to `start`.
Missing `section_part` on an ambiguous target throws `AmbiguousPositionError`
with both concrete candidates (spec §3.3's error shape).

**Block separation is normalized**: inserted/replacement text is joined so that
exactly one blank line separates it from surrounding content (existing newlines
collapsed, never multiplied). Agents send content, not whitespace bookkeeping;
without this, `end_of_section` inserts would glue onto the previous paragraph or
stack blank lines nondeterministically. Deletion collapses the residual gap to
one blank line. This is deliberately *not* in the spec (representation, not
contract) but it is load-bearing for format 2's byte-exact reconstruction
round-trips, so it is pinned by tests.

`applied` echoes one entry per op (`op`, resolved path, position) — the handler
uses it for the RPC's per-op audit labels and the response text.

## 3. Handlers: `_shared/mcp-tools/insert.ts`, `edit.ts`, get-document outline

### 3.1 Shared flow (both write tools)

1. Validate args. `expected_content_hash` **required** (no `last_write_wins`
   parameter on these tools at all — spec §5; the deliberate-overwrite path
   stays on `cerefox_ingest`).
2. Read current text + hash: same `cerefox_get_document` RPC the read tool uses.
3. **Advisory fast-fail** if `expected_content_hash` ≠ current hash — same
   pre-embedding conflict short-circuit `ingest.ts` uses, same agent-first
   conflict message (reused, not copied). Authoritative check remains the RPC's
   `FOR UPDATE` CAS; the race between read and write is closed there.
4. `applyOperations` (pure). Anchor/position errors surface as
   `McpInvalidParams` with the candidates in the message — recoverable per spec.
5. Chunk + embed the **assembled** result — the identical code path ingest uses
   (`chunkMarkdown`, `embeddingInputFor`, `embedBatch`, format 2). v1 re-embeds
   the whole document; incremental embedding is explicitly deferred (spec §7).
6. `cerefox_ingest_document` with `p_expected_content_hash` = caller's token,
   `p_operations` = the applied-ops array (§4), title unchanged (title changes
   are not partial edits), `p_metadata: null` (keep existing).
7. Respond: new `content_hash`, new size, per-op summary, `size_warning` if the
   RPC returned it. **Never the body** (spec §3.8).

`cerefox_insert` is the same flow with a single synthesized
`{op: "insert", ...}` — one handler implementation, two tool surfaces, so the
additive tool cannot drift from the batch's insert semantics.

### 3.2 Tool definitions

- `cerefox_insert` — annotations `{readOnlyHint: false, destructiveHint: false,
  idempotentHint: false, openWorldHint: false}`. Args: `document_id`, `text`,
  `position`, `anchor_heading?`, `section_part?`, `expected_content_hash`,
  `requestor?` (renamed `author` in v1.13.1, when every tool converged on that
  one name; `requestor` is still accepted as an alias).
- `cerefox_edit` — `destructiveHint: true`. Args: `document_id`, `operations[]`
  (each `{op, text?, position?, anchor_heading?, section_part?, scope?}`),
  `expected_content_hash`, `requestor?`. Validation: non-empty array, per-op
  required fields by `op` type, fail the whole call on the first invalid op
  (all-or-nothing extends to validation).
- `cerefox_get_document` gains `outline: boolean` — when true, returns
  `content_hash`, `total_chars`, and the outline (paths, levels, per-section
  chars) as compact JSON; no body. Handler-side: reconstruct (existing RPC),
  `parseOutline`, drop the text. The DB→handler transfer is paid; the
  agent-context cost — the one the spec targets — is not. Chunk metadata cannot
  supply this (greedy accumulation merges small sections into one chunk), which
  is why it parses the reconstruction. Annotations unchanged (read-only).

Tool count: 14 → 16 (10 core + 2 new + 4 dormant relations). The relations
feature-flag mechanism is untouched — the new tools are always visible, like
ingest.

## 4. RPC changes (`src/cerefox/db/rpcs.sql`) — schema 0.10.5 → **0.11.0**

Three additive changes to `cerefox_ingest_document`; no new RPC:

1. **`p_operations JSONB DEFAULT NULL`** — array of
   `{"op": "...", "detail": "..."}`. When NULL: exactly today's audit behaviour
   (`create` / `update-content`) — NULL-means-today per the #183 lesson. When
   set: **one audit entry per element**, `operation` = element's `op`,
   `description` = its `detail` (resolved path + position), sizes on the last
   entry. Values validated against the widened CHECK by the insert itself.
2. **Returns `content_hash TEXT`** — the hash just written, on create *and*
   update. Fixes #189 (a document is born holding its token). Return-shape
   change ⇒ `DROP FUNCTION` of the current signature added alongside the
   existing historical drops.
3. **Returns `size_warning BOOLEAN`** — `v_total_chars >
   cerefox_config_int('document_size_warning_chars', 0)` when that config is > 0,
   else false. Config key added to `_shared/config-catalog/` (dormant by
   default, spec §3.8). Computed in the RPC so every access path gets it from
   one implementation.

**Migration `0019_partial_edit_audit_ops.sql`**: widens
`cerefox_audit_log_operation_check` with `insert`, `replace-section`,
`delete-section` (drop + re-add constraint; idempotent). Schema version bumped
in both places, lockstep (marker + `cerefox_schema_version()`); `cut_release.ts`
gates it.

**Existing callers are safe**: `p_operations` is trailing-optional; the widened
RETURNS TABLE is additive and every caller (client-bridge, EF, mcp-tools) reads
columns by name. `cerefox_ingest`'s handler and the `cerefox-ingest` EF start
surfacing `content_hash` on create (the #189 fix reaching users); the GPT
Actions OpenAPI block gets the additive response field + `info.version` minor
bump per the CLAUDE.md rule.

**Compatibility**: `minSchema` stays 0.10.5. Against an un-redeployed server the
new tools fail loudly (`p_operations` unknown → RPC signature error mapped to
"server needs `cerefox server deploy`"), which is the correct failure class —
new feature absent, nothing silently misbehaving. `doctor` reports
older-than-bundled as usual.

## 5. CLI (`packages/memory/src/cli/`)

Resource-verb, registered under the `document` group:

- `cerefox document insert <id> --text/-t <text|-> --position <p>
  [--anchor <h>] [--section-part <own_body|subtree>] --expected-hash <hash>`
  (`-` reads text from stdin, matching existing CLI conventions).
- `cerefox document edit <id> --operations <file|-> --expected-hash <hash>` —
  operations as a JSON array, file or stdin; scripts compose it, humans mostly
  won't type it.
- `cerefox document get <id> --outline` — flag on the existing verb.

All three go through the same `_shared/mcp-tools` handlers (as the CLI's ingest
already does via shared code), so CLI and MCP cannot diverge. CLI is `author_type
"user"`; MCP is `"agent"` — same as today's split.

Web UI: **out of scope**, per maintainer decision — the web editor edits whole
documents with the full document visible, which is precisely the case partial
edits exist to avoid.

## 6. Tests

| Layer | Where | What |
|---|---|---|
| Pure module | `_shared/__tests__/partial-edits.test.ts` | outline parsing (nesting, setext ignored, **fences**), anchor resolution (exact/path/absent/ambiguous), every position × leaf/nested/children-no-body, `section_part`, replace/delete scopes, batch ordering + all-or-nothing, blank-line normalization, **property: insert output always contains every byte of the input** (the §1 scope-confusion guarantee, tested not asserted) |
| Handlers | `_shared/__tests__/mcp-partial-edits.test.ts` | mocked client: happy paths, missing/stale token (advisory fail before embed spend), ambiguity → candidates in message, per-op audit payload shape, outline mode returns no body |
| RPC guard | extend `rpc-config-defaults.test.ts` pattern | static: `p_operations` defaults NULL; CHECK contains the three values; both schema literals agree |
| CLI smoke | `packages/memory/test/cli-smoke.test.ts` | new verbs exist, `--help` shape, bad-args exit non-zero |
| Live e2e (staging) | `packages/memory/test/partial-edits-live.test.ts` | probe-and-skip + `[E2E …]`-prefixed self-cleaning docs: create → insert(end_of_document) → insert(end_of_section) → edit(batch of 3) → outline round-trip → conflict on stale hash → ambiguity error → delete scopes → audit entries verified per-op → #189 hash-on-create. Data API only, zero EF calls. |

Success criterion: each §3 subsection of the spec and each §9 **v1** row maps to
at least one named test. The live suite doubles as tomorrow's joint staging
walkthrough script.

## 7. Security & regression review (pre-merge checklist)

- **No new credential surface**: handlers use the session's existing client;
  no new EF, no new auth path; EF `--no-verify-jwt` posture unchanged.
- **Injection**: operation `detail` strings land in audit `description` via
  parameterized RPC args (no SQL string assembly); anchor text is compared, never
  executed; text is chunked exactly as ingest chunks untrusted content today.
- **The CHECK constraint stays the allow-list** for audit ops — handler labels
  that drift from it fail the transaction loudly.
- **Concurrency**: no weakening — the new tools are *stricter* than ingest (no
  `last_write_wins` at all).
- **Regression surface**: `cerefox_ingest_document` signature change is the one
  shared touchpoint — covered by the existing write-commands live suite plus the
  new static guard; `bun test` in `_shared` and `packages/memory` must stay
  green; `parity.test.ts` guards the EF/local tool-surface equivalence.
- **Response-size ceiling**: outline mode output is bounded (headings only) and
  still passes through `getMaxResponseBytes` like every tool response.

## 8. Rollout

1. Tonight: build + unit green + deploy schema/RPCs to **staging** + live suite
   green against staging (this branch deploys nothing to prod).
2. Tomorrow: joint staging walkthrough (the live suite is the script), then PR.
3. After merge: **v1.3.0-beta.1** cut (v1.2.0 is current; new tools + schema 0.11.0 make this a minor), `cerefox server deploy` on prod, maintainer's agents
   dogfood via MCP — their §8 feedback is the acceptance test the spec asks for.
