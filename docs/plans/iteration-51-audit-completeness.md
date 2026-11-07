# Iteration 51: a complete and accurate audit log

> Status: implemented (2026-11-07), on `fix/audit-completeness`. Target:
> v1.23.0 (schema 0.22.0). Executed notes at the end.

## Why

The audit log is the store's record of every change. An inventory of every
write path (2026-11-07) found that some changes leave no entry, and that a
purge erases the link between a document and its whole history. Any later use
of the log (sync, compliance, "who changed this and when") inherits those gaps.

**Rule after this iteration: every write that changes Cerefox content (documents,
chunks, versions, memberships, projects, relations, config) records an audit
entry, in the same transaction where the write is in SQL, and entries keep
their document and version ids forever.**

## Inventory: what is missing today

| # | Write | Today | Where |
|---|---|---|---|
| G1 | Purge (one document, Empty trash, trash auto-purge) | Entry written, then `ON DELETE SET NULL` clears its `document_id`. **Every earlier entry for that document loses its id too** | FK on `cerefox_audit_log.document_id` / `version_id`; `cerefox_purge_document`, `cerefox_purge_expired_trash` |
| G2 | Project membership changes on update: content update with `project_names`, the singular `project_name` add, a metadata-only save that changes only projects | No entry, or a vague "Updated metadata" with no project names | `pipeline.ts` (`assignDocumentProjects`, `addDocumentToProjects`); `client-bridge.ts` direct table writes |
| G3 | Membership writes in the shared MCP helpers (add to project, replace by name) | No entry for the link itself (only an implicit project creation is audited) | `_shared/mcp-tools/_projects.ts` |
| G4 | `backup restore` | Raw inserts: no entries at all. Also not atomic: a document can land without its chunks if the second insert fails | `restore.ts` |
| G5 | Version retention pruning | Old versions deleted with no entry | `cerefox_snapshot_version` |
| G6 | `server reindex` | Embeddings rewritten with no entry | `reindex.ts` |
| G7 | Title-only save | Entry exists, but the row update, re-embed and entry are separate client calls (not atomic) | `pipeline.ts` metadata-only path |

Already complete (verified): ingest and every edit tool, rename, soft delete,
trash restore, metadata set, review status, version archive and unarchive,
projects create/edit/delete, relations, config, `migrate-format`.

## Changes

### Schema 0.22.0 (migration `0037_audit_completeness.sql`)

1. **Drop the foreign keys** on `cerefox_audit_log.document_id` and
   `version_id`; keep them as plain UUID columns with their indexes. An audit
   trail must outlive what it describes. (Entries already orphaned by past
   purges cannot be repaired; their description still names the title.)
2. **New operations** in the CHECK list:
   - `projects-change`: a document's memberships changed (before/after in
     `details`);
   - `backup-restore`: a document or project was written by `backup restore`;
   - `version-prune`: retention deleted an archived version;
   - `reindex`: one store-level entry per `server reindex` run (model, counts).
3. **`details JSONB`** column for structured before/after on operations that
   are not metadata (project ids and names, the backup file's timestamp, the
   reindex model). `metadata_before/after` keep their current meaning.
4. **New RPCs**, each writing and auditing in one transaction:
   - `cerefox_set_document_projects(doc, project_ids, mode 'add'|'replace', author, author_type)`:
     the only writer of `cerefox_document_projects` outside project delete;
     no entry when the set does not change;
   - `cerefox_restore_backup_document(doc jsonb, chunks jsonb, author)`:
     inserts the document and its chunks atomically, plus the entry (fixes G4's
     half-restore too);
   - `cerefox_update_document_title(...)` for G7, or fold the title path into
     `cerefox_rename_document`, whichever is smaller (decided in step 1).
5. `cerefox_snapshot_version` writes a `version-prune` entry per pruned version.
6. **A gap-free position for readers of the log.** Each entry gets
   `txid xid8 DEFAULT pg_current_xact_id()`, and a new RPC
   `cerefox_audit_changes(after_xid, limit)` returns the entries with
   `after_xid <= txid < xmin` of the current snapshot (the oldest transaction
   still running), plus that `xmin` as the next position. Everything below
   `xmin` has finished, so no entry can later appear behind a reader's
   position; a long transaction only delays its entries. Exposed through
   `cerefox_get_audit_log` (MCP and the EF, an `after_position` parameter and a
   `next_position` field) so the sync can use the Cerefox access token.
7. Bump `schema_version` to 0.22.0 in both places. **Raise `minSchema` to
   0.22.0**: a new client calls RPCs an older server lacks, so writes would
   fail (that is misbehavior, the bar for a minimum).

### Clients

- `pipeline.ts`, `client-bridge.ts`, `_shared/mcp-tools/_projects.ts`,
  `_document-meta.ts`: every membership write goes through
  `cerefox_set_document_projects`. The direct table writes are removed.
- `restore.ts` uses `cerefox_restore_backup_document`; projects and
  memberships restored by it get entries too.
- `reindex.ts` writes its store-level entry at the end of a run (and on a
  partial run, with what it did).
- Audit surfaces learn the new operations: the web UI labels, `audit list`,
  `cerefox_get_audit_log` (MCP and the EF), and `details` in their output.
  GPT Actions OpenAPI block: add `details` to the audit entry schema and bump
  its version.

### A gate so this stays true

`_shared/__tests__/audit-coverage.test.ts`, in the style of the existing
source-scan gates:

1. **SQL side:** every function in `rpcs.sql` that inserts, updates or deletes
   a content table must call `cerefox_create_audit_entry` (or be listed in an
   allowlist with a reason, for example `cerefox_snapshot_version`'s caller
   audits).
2. **Client side:** no `.insert/.update/.delete/.upsert` on a content table in
   non-test TypeScript, except an allowlist with reasons (review status and
   version archive audit client-side today; moving them into RPCs is optional
   here).

### Scheduled backups (the open-source part)

- `cerefox backup create --keep <n>`: after a successful snapshot, delete the
  oldest snapshots in the output directory beyond `n`. Only files this command
  writes (`cerefox-*.json`, matching the label if one is given) are ever
  considered, never anything else in the folder. Deferred from the #361 review.
- A documented recipe, `docs/guides/scheduled-backups.md`: the `cerefox-web`
  image (it contains the CLI) run as a cron container, one config directory per
  store (a Supabase store, and a Cerefox Local or LAN store reached with its API
  key), snapshots written to a mounted folder with `--keep`. Includes a
  Synology Container Manager variant and how to test a restore.
- The maintainer's own deployment (targets, keys, schedule) lives in a separate
  private repository, not here.

## Edge Functions

`_shared/mcp-tools` changes, so the 9 EFs change (`EF_LAST_CHANGED` 1.23.0)
and Supabase stores need `cerefox server deploy`. The Supabase CLI now refuses
`functions deploy` from an agent without the user's own confirmation, so the
maintainer runs the EF part of the production deploy.

## Test plan

- Unit: the gate above; the new RPCs' behavior under mocked clients.
- Live on staging, one case per gap: purge keeps ids on the purge entry and on
  earlier entries; each membership path writes exactly one `projects-change`
  (and none when unchanged); restore into a scratch store writes entries and
  never leaves a document without chunks; retention prune writes
  `version-prune`; reindex writes one entry.
- `--keep`: unit tests for the pruning rule (never touches other files, keeps
  the newest, respects labels, no deletion when the snapshot failed); one run
  of the recipe against staging.
- Position marker: a live test holds a transaction open, commits a later one,
  and checks that the reader neither skips nor repeats either entry.
- Upgrade test: a 1.22.2 Local volume booted on the branch image applies 0037;
  existing entries untouched.
- Playwright on staging (the audit page labels).
- Opus review before merge.

## Out of scope (next iterations)

- One-way sync itself (design draft on the local branch `design/one-way-sync`).
- The Supabase CLI 3.0 deploy changes (their own issue).

## As executed (2026-11-07)

- G7 used the existing `cerefox_rename_document` on the ingest path (title,
  chunk FTS and entry in one transaction); embeddings are refreshed after it
  as derived data. The catch-all "Updated metadata (content unchanged)" entry
  is gone: every real change has its own entry.
- Purges got their own operation, `purge` (they were logged as `delete`).
- Restore uses three RPCs (projects, each document with chunks and
  memberships, relations). `cerefox_insert_json_row` names only the columns a
  row carries, so a snapshot from an older server still takes column defaults.
  Relations keep their original author and metadata.
- Verified: a throwaway Postgres (0.21.1 to 0.22.0, each new behavior, and the
  slow-writer race against `cerefox_audit_changes`); staging (migration,
  package suite, Playwright 43, the reader over the Data API); throwaway Cerefox
  Local containers (upgrade boot from 1.22.2, every write path, backup and
  restore into a fresh store with identical search scores).
- Found on the way, not fixed here: two simultaneous first uses of the local
  embedder on a fresh Cerefox Local download the model into the same file and
  corrupt it permanently (no integrity check). Needs its own issue.
- The `cerefox-get-audit-log` Edge Function change cannot be deployed by an
  agent since Supabase CLI 3.0 (#363); the maintainer deploys it.
