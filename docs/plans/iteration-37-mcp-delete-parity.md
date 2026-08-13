# Iteration 37 — MCP delete parity (`cerefox_delete_document`)

**Status: IN PROGRESS (2026-08-13). Target: v1.7.0. Issue: #208. Branch: `feat/mcp-delete-document`.**

## Why

An agent asked why it could not find a delete command in the MCP interface. The
answer was a parity gap, not a policy: the trust model
(`docs/guides/access-paths.md` → "Destructive operations and the trust model")
always sanctioned agent soft-delete — "an agent (via MCP, Edge Function, or CLI)
can write or soft-delete freely" — and its tier table marked soft-delete as "not
MCP or Edge Functions **today**". The CLI had `document delete` all along; the
MCP tool was simply never built.

## Design (judgment calls, stated)

- **`cerefox_delete_document`, soft-delete only.** No restore, no purge — tier 3
  stays human-only (web UI). An agent must not be able to silently undo its own
  delete, let alone escalate to permanent removal.
- **`expected_content_hash` is required on the MCP surface.** The CLI's
  proof-of-intent is an interactive y/N; an agent's is evidence it READ what it
  deletes. No `last_write_wins` — a delete with no read has no legitimate agent
  use case. The "required" lives in the tool handler (transport-layer input
  validation); the CAS itself lives in the RPC under `FOR UPDATE`, the one place
  all transports share (iter-32 lesson). CLI passes no hash and is unchanged.
- **RPC rework** (schema 0.11.3 → 0.12.0, migration 0024): `p_expected_content_hash`
  (mismatch → `CEREFOX_CONFLICT`/PT409 — never a retryable SQLSTATE), `p_reason`
  appended to the audit description (what the human reviewing the trash goes on),
  JSONB return, idempotent re-delete (original `deleted_at` kept, no duplicate
  audit entry).
- **CLI `--reason` now recorded** (was print-only). Passed only when given, so
  the bare 3-arg call still matches the old function signature and plain
  `document delete` keeps working against pre-0.12.0 servers.
- **Primitive GPT-Actions Edge Function: deferred deliberately.** New billable
  EF + OpenAPI surface; separate decision. Remote MCP gets the tool
  automatically via `_shared/mcp-tools/`.
- **`minSchema` stays 0.10.5.** A 1.7.0 client against an older server degrades
  with a clear error on the new tool only (same posture as v1.6.0's
  `set_document_metadata`); nothing misbehaves.

## Steps

- [x] Design against existing patterns (set-document-metadata as template)
- [x] RPC rework + schema bump both literals + migration 0024
- [x] `_shared/mcp-tools/delete-document.ts` + registration (14 core / 18 total)
- [x] CLI `--reason` wiring
- [x] Unit tests (11 new; registration, contract, conflict mapping, responses)
- [x] Docs sweep: AGENT_GUIDE (new tool section, governance, CLI mapping),
      AGENT_QUICK_REFERENCE (+ bundled help regen), access-paths tier table,
      connect-agents, README(s), solution-design, CLAUDE.md, CHANGELOG.
      Also fixed pre-existing drift: Path A table missing insert/edit, stale
      "all core tools on Path B" claim, two 16-vs-18 arithmetic leftovers,
      "N named tools" now caught by the doc-count guard.
- [ ] Live verification — **retargeted to production** (2026-08-13): staging got
      stuck in Supabase "Restoration in progress" for over an hour after
      unpause (dashboard: "taking longer than usual, contact support"), and the
      maintainer chose careful prod verification over waiting. Risk accepted as
      small: additive tool, reversible soft-delete, notice-stub migration,
      PT409 pattern proven in prod by the ingest CAS, self-cleaning harness.
      Sequence: high-effort review of PR #211 first, then merge + cut (the
      maintainer's), then deploy 0.12.0 to prod and run the acceptance suite
      with the deliberate prod override.
- [ ] PR, review, merge; release v1.7.0 (maintainer cuts).
- [ ] Post-release: production `server deploy`, reconnect MCP clients, rubric
      update, Decision Log entry, announcement draft (on request).
