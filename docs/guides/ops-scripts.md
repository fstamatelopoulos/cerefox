# Operations Scripts

Reference guide for the operational scripts in `scripts/`. Run these from the project root.

> Looking for `cerefox <subcommand>` reference (ingest, search, get-doc, etc.)? See [`docs/guides/cli.md`](cli.md). This guide covers the `scripts/` directory only.

## Who this guide is for

There are two audiences:

- **End users** (installed via the installer or `npm install -g @cerefox/memory`, no repo
  clone) do not run the `scripts/` directory at all. The user-facing equivalents are CLI
  commands: `cerefox server deploy` (schema + RPCs + Edge Functions), `cerefox server reindex`,
  and `cerefox backup create` / `cerefox backup restore`. Skip to [CLI commands](#cli-commands).
- **Contributors** (clone the repo, use `bun`) run the `scripts/` directly. That's the rest
  of this guide.

## Contributor scripts

The canonical scripts are **TypeScript**, run with [Bun](https://bun.sh) (install with
`curl -fsSL https://bun.sh/install | bash`):

| Script | Run with |
|---|---|
| `db_status.ts` | `bun scripts/db_status.ts` |
| `sync_docs.ts` | `bun scripts/sync_docs.ts` |
| `db_deploy.ts` | `bun scripts/db_deploy.ts` |
| `db_migrate.ts` | `bun scripts/db_migrate.ts` |
| `backup_create.ts` | `bun scripts/backup_create.ts` |
| `backup_restore.ts` | `bun scripts/backup_restore.ts` |
| `reindex_all.ts` | `bun scripts/reindex_all.ts` |

The `.py` equivalents are **legacy** — they still exist as a migration aid but are no longer
maintained; use the `.ts` scripts. The legacy `db_status.py` and `sync_docs.py` are
deprecation shims that exit non-zero with a pointer to the TS replacement, so update any cron
jobs / CI / make targets that invoke them.

### TS scripts and `.env` resolution

`bun scripts/<name>.ts` reads the same `.env` the Python CLI does. Precedence:

1. `CEREFOX_CONFIG_DIR` env var (explicit override; supports `~`).
2. `./.env` in the current working directory (dev mode).
3. `~/.cerefox/.env` (user-state root).

See [`docs/specs/polish-and-distribution-design.md` §7b](../specs/polish-and-distribution-design.md) for the full rule.

---

## db_deploy.ts — Schema deployment

Applies the full Cerefox schema (tables, indexes, RPC functions) to a Postgres database. Use this for **fresh installs** or to re-apply the schema after a Cerefox update. (End users use `cerefox server deploy` instead.)

```bash
bun scripts/db_deploy.ts [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--dry-run` | Print the SQL that would be executed, without running it |
| `--reset` | Drop all `cerefox_*` tables before deploying (destructive; typed-`yes` guard) |

**Requires**: `CEREFOX_DATABASE_URL` — a direct Postgres connection URL (not the Supabase API URL).

After applying the schema, `db_deploy.ts` automatically stamps any migration files in `src/cerefox/db/migrations/` into the `cerefox_migrations` table. This ensures `db_migrate.ts` does not re-apply changes that are already incorporated in the base schema.

Example:
```bash
# Deploy to local Docker Postgres
CEREFOX_DATABASE_URL=postgresql://cerefox:cerefox@localhost:5432/cerefox \
  bun scripts/db_deploy.ts
```

---

## db_status.ts — Schema verification

**TypeScript (v0.3.0+).** Checks that the schema is correctly deployed and reports table statistics. Replaces the legacy `db_status.py`, which now prints a deprecation notice and exits non-zero.

```bash
bun scripts/db_status.ts          # human-readable report
bun scripts/db_status.ts --json   # structured JSON output
```

Reports:
- Tables: `cerefox_documents`, `cerefox_chunks`, `cerefox_document_versions`, `cerefox_projects`, `cerefox_document_projects`, `cerefox_audit_log`, `cerefox_migrations`
- RPC functions: hybrid_search, fts_search, semantic_search, reconstruct_doc, save_note, search_docs, context_expand, snapshot_version, get_document, list_document_versions, ingest_document, delete_document, create_audit_entry, list_audit_entries, list_metadata_keys, update_chunk_fts, **`cerefox_schema_version`** (new in v0.3.0), **`cerefox_pg_function_exists`** (new in v0.3.0)
- Row counts per table
- **Schema-version mismatch**: compares the `@version` marker in the bundled `schema.sql` against the deployed `cerefox_schema_version()` RPC. Non-zero exit if they differ (the same check powers the web UI's schema-mismatch banner).

Exit code 0 if everything is healthy; 1 if any check fails; 2 on configuration error.

**Function-existence detection** routes through the `cerefox_pg_function_exists()` introspection RPC for reliability. Legacy deployments missing that RPC fall back to a naive "call with no args" probe — the legacy fallback will misreport RPCs that take required parameters as missing, which is itself a signal that the deployment needs `db_deploy.ts`.

---

## db_migrate.ts — Schema migrations

Applies incremental migration files to an **existing** database with data. Use this when upgrading Cerefox on a database that already has documents — it applies only the changes that haven't been applied yet. (End users get the same effect via `cerefox server deploy`, which applies pending migrations on an existing DB.)

```bash
bun scripts/db_migrate.ts [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--dry-run` | Show which migrations would run, without applying them |
| `--status` | List all migration files and whether each has been applied |

**When to use `db_deploy.ts` vs `db_migrate.ts`:**

| Situation | Use |
|-----------|-----|
| Fresh database, no data | `db_deploy.ts` |
| Existing database, upgrading to a new version | `db_migrate.ts` |

On a freshly deployed database, `db_migrate.ts` is always a no-op — `db_deploy.ts` has already stamped all existing migrations.

Migration files live in `src/cerefox/db/migrations/` and are applied in filename order (`0001_...`, `0002_...`). Each file is applied exactly once; applied filenames are recorded in the `cerefox_migrations` table.

Always run a backup before migrating:

```bash
bun scripts/backup_create.ts && bun scripts/db_migrate.ts
```

---

## backup_create.ts — Create a backup

Exports all documents, chunks, and metadata to a JSON file in the backup directory. (End users use `cerefox backup create`.)

```bash
bun scripts/backup_create.ts [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--label LABEL` | Optional label appended to the filename (e.g. `pre-migration`) |
| `--dir DIR` | Directory to write backup to (default: `./backup-data`) |
| `--git-commit` | Stage and commit the backup file to git after writing |

Backup filename format: `cerefox-{YYYYMMDDTHHMMSSZ}[-{label}].json`

**Versioning note**: Backups capture only **current** chunks (those not yet archived). Archived version history (previous content snapshots) is intentionally excluded — backups represent the present state of your knowledge base, not its history. Archived versions remain in the database and continue to be accessible via the versioning API until they expire.

Example:
```bash
bun scripts/backup_create.ts --label before-v2-migration
```

Output: `backup-data/cerefox-20260308T143022Z-before-v2-migration.json`

---

## backup_restore.ts — Restore from a backup

Restores documents and chunks from a previously created backup file. Idempotent — documents with the same content hash are skipped. (End users use `cerefox backup restore`.)

```bash
bun scripts/backup_restore.ts BACKUP_FILE [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--dry-run` | Show what would be restored without writing |

Example:
```bash
# Preview what will be restored
bun scripts/backup_restore.ts backup-data/cerefox-20260308T143022Z.json --dry-run

# Restore
bun scripts/backup_restore.ts backup-data/cerefox-20260308T143022Z.json
```

Restore output shows counts of restored / skipped / error documents.

---

## Backup format

Backups are JSON files with the following structure:

```json
{
  "version": 1,
  "created_at": "2026-03-08T14:30:22.000Z",
  "document_count": 42,
  "chunk_count": 317,
  "documents": [
    {
      "id": "uuid",
      "title": "My Note",
      "source": "file",
      "content_hash": "sha256hex",
      "metadata": {},
      "chunks": [
        {
          "chunk_index": 0,
          "heading_path": ["My Note", "Section"],
          "heading_level": 2,
          "title": "Section",
          "content": "...",
          "char_count": 120,
          "embedder_primary": "text-embedding-3-small",
          "embedding_primary": [0.012, -0.034, ...],
          "embedding_upgrade": null
        }
      ]
    }
  ]
}
```

**Embeddings are included** in backups. This means a restored database is immediately searchable — no `cerefox server reindex` required after restore.

The backup directory (`./backup-data/` by default) is gitignored. Back up the backup files separately if you want off-site copies (e.g. copy to cloud storage).

---

## sync_docs.ts — Sync project documentation into Cerefox

Ingests `README.md`, `AGENT_GUIDE.md`, `AGENT_QUICK_REFERENCE.md`, and every Markdown file under `docs/` into your Cerefox knowledge base, updating existing documents in-place. Run this any time after editing documentation so AI agents always have access to the current state of the project.

Replaces the legacy `sync_docs.py`, which now prints a deprecation notice and exits non-zero.

```bash
bun scripts/sync_docs.ts [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--project NAME`, `-p NAME` | Project to assign documents to (default: `cerefox`) |
| `--dry-run`, `-n` | List files that would be synced without ingesting anything |

**Requires**: `CEREFOX_SUPABASE_URL` and `CEREFOX_SUPABASE_ANON_KEY` (the legacy anon JWT — `eyJ…` — used to invoke Edge Functions). Embedding happens server-side inside the `cerefox-ingest` Edge Function, so you don't need an OpenAI / Fireworks key in your local env for the TS script.

The target project must already exist (create it with `cerefox project create cerefox` if needed).

**What gets synced**: `README.md` + `AGENT_GUIDE.md` + `AGENT_QUICK_REFERENCE.md` + all `.md` files under `docs/` (including `docs/research/` and `docs/specs/`). Research notes are included because Cerefox is a shared memory layer for multiple agents — exploratory notes, experiments, and decision rationale are exactly the kind of context agents benefit from. Files are matched to existing documents by their relative path (`source_path`), so re-running the script updates content in-place rather than creating duplicates.

Example output:
```
Syncing 22 file(s) → project "cerefox"
  =  README.md  (Cerefox)                            [unchanged]
  ↑  docs/plan.md  (Cerefox Implementation Plan)     [re-embedded]
  =  docs/guides/quickstart.md  (Quickstart)         [unchanged]
  ...
Done. 0 new · 1 updated · 21 unchanged · 0 errors
```

---

## Recommended backup schedule

For a personal knowledge base, a simple daily cron is sufficient:

```cron
# End user (CLI):
0 3 * * * cerefox backup create --label daily
# Contributor (repo clone):
0 3 * * * cd /path/to/cerefox && bun scripts/backup_create.ts --label daily
```

Backups include embeddings so they are larger than pure-text exports, but for a personal knowledge base they typically remain well under 100 MB.

---

## CLI commands

The `cerefox` CLI also provides data management commands (these are the end-user equivalents of the contributor scripts above):

| Command | Description |
|---------|-------------|
| `cerefox server deploy` | Deploy/update schema + RPCs + the 9 Edge Functions |
| `cerefox server reindex` | Re-embed all chunks |
| `cerefox backup create` | Create a backup |
| `cerefox backup restore FILE` | Restore from a backup |
| `cerefox document ingest FILE` | Ingest a markdown file |
| `cerefox document ingest --paste --title TITLE` | Ingest text from stdin |
| `cerefox search QUERY` | Search the knowledge base |
| `cerefox document list` | List all documents |
| `cerefox document delete ID` | Delete a document by ID |
| `cerefox project list` | List all projects |
| `cerefox document version list ID` | List all archived versions of a document |
| `cerefox document get ID` | Retrieve current content of a document |
| `cerefox document get ID --version VERSION_ID` | Retrieve a specific archived version |
| `cerefox web` | Start the web UI |

Run `cerefox --help` or `cerefox COMMAND --help` for details.
