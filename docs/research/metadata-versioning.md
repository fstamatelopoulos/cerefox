# Metadata Versioning — proposal (backlog, unscheduled)

**Status**: Proposal / design sketch — NOT scheduled. Lives in `research/` until
it graduates to an iteration (then a design-of-record in `specs/`).
**Date**: 2026-06-13
**Motivation**: the v0.11.1 incident — a metadata-wipe bug destroyed document
tags with **no recovery path**, because version snapshots capture content only.
Content enjoys two safety layers (optimistic locking for prevention, versioning
for recovery); metadata now has prevention-adjacent protection (absent ≠ clear,
v0.11.1) but still **zero recovery**.

## Current state

- `cerefox_document_versions` + archived chunks snapshot **content only**.
- Metadata lives solely on the live `cerefox_documents.metadata` JSONB column.
- Metadata writes (ingest-with-metadata, `document edit --set-meta/--unset-meta`,
  web edit, `cerefox_set_document_projects` for memberships) produce audit
  entries, but the audit log records **descriptions, not values** — you can see
  *that* metadata changed, not *what it was*.
- This was a deliberate simplicity choice (two-table design, lean version rows).

## Options

### Option A — snapshot metadata into version rows (smallest)

Add `metadata JSONB` to `cerefox_document_versions`; `cerefox_snapshot_version`
copies the document's metadata at snapshot time.

- Pros: one column + one line in the snapshot RPC; restore-from-version can
  optionally restore tags; zero new tables.
- Cons: only captures metadata at **content-update** moments — metadata-only
  edits between content updates still vanish without a trace; retention
  cleanup expires it with the version.

### Option B — audit log records metadata before/after values

Add `meta_before` / `meta_after` JSONB columns to `cerefox_audit_log`,
populated on `update-metadata` and `update-content` operations.

- Pros: covers **every** metadata change (including metadata-only edits);
  audit log is immutable and survives version cleanup; recovery = read the
  last good `meta_before`.
- Cons: grows the audit table (metadata is small; likely fine); recovery is
  manual-ish (no one-click restore), though a `document edit --restore-meta
  <audit-id>` verb could be added later.

### Option C — full metadata version table

A dedicated `cerefox_metadata_versions` table, one row per metadata change.

- Cons: a third versioning concept for marginal benefit over B. Rejected
  unless A+B prove insufficient.

## Leaning

**B, possibly A+B together** (they're independent and both cheap). B is the
real recovery net because metadata-only edits are the common case; A makes
"restore this version" semantically complete. Both are additive schema changes
(migration + `schema_version` bump). Revisit when the pain recurs or before
v1.0's stability commitment freezes the schema surface.

## Non-goals

- Optimistic locking for metadata-only edits (separate, smaller discussion —
  the v0.11.0 design doc scoped it out deliberately).
- Project-membership versioning (memberships are M2M rows, not metadata).
