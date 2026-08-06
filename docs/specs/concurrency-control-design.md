# Optimistic Concurrency Control for Content Updates

**Status**: Design of record — implemented on `feat/optimistic-locking` (Iteration 32, target v0.11.0).
**Date**: 2026-06-12
**Motivation**: a real incident — two agent sessions updated the same document at close
times; the later write silently shadowed the earlier one (last-write-wins). Versioning
made the merge recoverable, but recovery is not prevention. Concurrent agents writing to
shared memory need the same conflict discipline as any distributed system.

## 1. The race

Every content-update path does: read document → chunk → **embed (seconds of external
API latency)** → call `cerefox_ingest_document`. The embedding window is the race: two
writers can both read the same base version, both embed, and the second RPC call
overwrites the first with no warning. The pre-RPC "already up-to-date" hash check in the
handlers does not help — it runs *before* the window, not atomically with the write.

## 2. Design: compare-and-swap on `content_hash`

`cerefox_documents.content_hash` (SHA-256 of the normalized markdown, NOT NULL,
maintained on every write) is already the system's identity for "this exact content".
It becomes the optimistic-locking token — no new column, no migration, no second
versioning concept.

**Writer contract (update paths only — `document_id` or `update_if_exists`):**

1. Read the document; note its `content_hash` (now returned by every read surface).
2. Prepare the new content.
3. Call ingest with `expected_content_hash=<the hash you read>`.
4. The RPC, **atomically** (row locked with `SELECT … FOR UPDATE` inside the single
   ingest transaction):
   - hash matches current → proceed exactly as before (snapshot version, update, chunks).
   - hash differs → **conflict error**: the document moved underneath you. Re-read,
     merge, retry with the fresh hash.
   - token absent → **token-required error** (see policy below).

**Create path**: both parameters ignored — there is nothing to conflict with.

### Policy: safe by default, explicit escape hatch

Content updates **require** the token. There is no silent opt-out — the escape hatch is
an explicit `last_write_wins=true` flag that names the semantics the caller is choosing.
Rationale: opt-in safety doesn't get used (the incident happened precisely because
nothing required anyone to opt in). No `cerefox_config` knob: the flag *is* the policy,
visible per call and recorded in the audit description when used.

`last_write_wins` is intended for flows where an external source of truth makes
conflicts meaningless:

| Caller | Behavior |
|---|---|
| `cerefox document ingest-dir` | passes `last_write_wins` internally (filesystem is the source of truth) |
| `cerefox guides ingest` (self-docs sync) | same |
| Python frozen fallback (`db/client.py`) | passes `last_write_wins` (preserves its historical behavior; explicitly unsafe — one deliberate exception to its frozen status) |
| Everything else (MCP, EF, CLI single-doc, web edit) | must supply `expected_content_hash` or explicitly pass the flag |

### Error surface

Two distinct failures, raised in the RPC so every transport behaves identically
(single-implementation principle):

| Condition | SQLSTATE | Meaning |
|---|---|---|
| Token absent on update (and not `last_write_wins`) | `22023` (invalid_parameter_value) | caller didn't follow the read-before-write contract |
| Token stale | `PT409` → HTTP 409 Conflict | the document changed underneath the caller |

> **Why not `40001`?** Stale-token conflicts used to raise `40001`
> (serialization_failure). That is the one PostgreSQL class whose contract says
> "transient — retry and it may succeed", and PostgREST maps it to a retryable
> HTTP status. But this conflict is *deterministic*: the same request fails
> identically forever. Retry-aware infrastructure believed the contract and
> looped. Measured before the fix: **one** HTTP request executed the RPC 68,825
> times in 125s, returned 504, and kept running after the client was gone —
> past 153,000 executions. A contributor hit the same loop for ~24h and 47
> million calls, exhausting their project's Disk IO budget. The same probe
> under `PT409` executed **once** and returned 409 in 636ms. Never raise a
> permanent application error under a SQLSTATE that means "retryable".
> Fixed in v1.1.0-beta.6 (schema 0.10.2, migration 0015).
>
> A **blank** token (empty or whitespace) is likewise treated as *absent* — it
> raises `CEREFOX_TOKEN_REQUIRED` (400), not a conflict. `''` is not NULL, so it
> previously slipped into the conflict branch and could never match a real hash:
> a permanent failure wearing a retryable code, which is what triggered the
> incident.

Messages are prefixed `CEREFOX_CONFLICT:` / `CEREFOX_TOKEN_REQUIRED:` so transport
handlers can detect them without parsing prose. Each handler maps them to an
agent-first instruction: the current hash, and the exact workflow (re-read via
`cerefox_get_document` → merge → retry with the new hash). The `cerefox-ingest` EF maps
conflict → HTTP 409, token-required → HTTP 400.

**Interplay with the "already up-to-date" short-circuit**: handlers still return early
when the *new* content's hash equals the current hash — even if the caller's
`expected_content_hash` is stale. Correct: identical content cannot lose data, so no
conflict is surfaced.

## 3. Read surfaces — where writers get the token

`content_hash` added to every document-shaped read:

- `cerefox_get_document` RPC → MCP tool header, CLI `document get` header, EF response.
- `cerefox_search_docs` RPC (docs mode) → search result headers (MCP + CLI + EF).
- `cerefox_metadata_search` RPC → result rows (the Decision-Log append workflow starts
  here, so it must carry the token too).
- Web: `DocumentEditPage` keeps the hash from load, sends it on save; a 409 shows a
  "document changed since you opened it — merge needed" error.

The full 64-char hex is returned everywhere (it must round-trip exactly; no prefix
matching — cleverness there buys little and complicates the RPC contract).

## 4. Compatibility and versioning

- **RPC signature change** (`DROP FUNCTION` + `CREATE` with two new defaulted params,
  plus new `content_hash` columns in three read RPCs' return tables) →
  **`schema_version` 0.4.0 → 0.5.0** (both literals, lockstep). RPC-only change: ships
  via `cerefox server deploy` re-apply; **no migration file** (no table change).
- **This is a deliberate breaking change for updaters**: an old client (pre-feature CLI
  or local MCP) updating against an upgraded server fails with the token-required error
  until updated (`self-update`); the doctor drift nudge already covers discovery.
  Old *readers* are unaffected (extra returned column is ignored).
- **GPT Actions**: ingest action body gains the two fields; existing custom GPTs'
  updates fail until the schema block is re-pasted → OpenAPI `info.version` → **2.0.0**.
- **Release**: behavior-changing default ⇒ a **minor** (proposed v0.11.0; the local
  embedder slides to a post-1.0 minor — maintainer decides at cut time).

## 5. Out of scope (explicit)

- **Metadata/title edits** (`document edit`, `cerefox_set_document_projects`): metadata
  is not versioned; guarding it is a separate (smaller) problem. Not covered.
- **Server-side merge**: on conflict the caller merges. Cerefox stores; agents think.
- **Pessimistic locks / leases**: wrong tool for occasionally-conflicting,
  long-think-time writers; optimistic CAS + versioning-as-recovery is the fit.

## 6. Alternatives considered

- **`expected_version` (monotonic revision counter)**: classic, human-friendly
  ("you have rev 5, server is at 7"), but needs a new column + migration, a second
  version concept alongside archived `version_number` (which interacts with retention
  cleanup), and false-conflicts on revert-to-identical-content. Rejected: the hash gives
  the same protection with strictly less machinery and exact semantics ("did the
  *content* move", not "did a write happen").
- **`If-Unmodified-Since` on `updated_at`**: timestamps are brittle tokens
  (serialization precision, equality semantics). Rejected.
- **Config-gated enforcement** (`require_concurrency_token`): more machinery for a
  policy the flag already expresses per call. Rejected.
