# Operations Scripts

Reference guide for the operational scripts in `scripts/`. Run these from the project root.

---

## db_deploy.py — Schema deployment

Applies the full Cerefox schema (tables, indexes, RPC functions) to a Postgres database. Use this for **fresh installs** or to re-apply the schema after a Cerefox update.

```bash
uv run python scripts/db_deploy.py [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--dry-run` | Print the SQL that would be executed, without running it |
| `--reset` | Drop all `cerefox_*` tables before deploying (destructive) |

**Requires**: `CEREFOX_DATABASE_URL` — a direct Postgres connection URL (not the Supabase API URL).

After applying the schema, `db_deploy.py` automatically stamps any migration files in `src/cerefox/db/migrations/` into the `cerefox_migrations` table. This ensures `db_migrate.py` does not re-apply changes that are already incorporated in the base schema.

Example:
```bash
# Deploy to local Docker Postgres
CEREFOX_DATABASE_URL=postgresql://cerefox:cerefox@localhost:5432/cerefox \
  uv run python scripts/db_deploy.py
```

---

## db_status.py — Schema verification

Checks that the schema is correctly deployed and reports table statistics.

```bash
uv run python scripts/db_status.py
```

Reports:
- pgvector extension status
- Tables: cerefox_documents, cerefox_chunks, cerefox_document_versions, cerefox_projects
- RPC functions: hybrid_search, fts_search, semantic_search, reconstruct_doc, save_note, search_docs, context_expand, snapshot_version, get_document, list_document_versions
- Indexes: HNSW vector indexes (partial — current chunks only), FTS index, version index
- Row counts per table

Exit code 0 if everything is healthy; non-zero if any check fails.

---

## db_migrate.py — Schema migrations

Applies incremental migration files to an **existing** database with data. Use this when upgrading Cerefox on a database that already has documents — it applies only the changes that haven't been applied yet.

```bash
uv run python scripts/db_migrate.py [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--dry-run` | Show which migrations would run, without applying them |
| `--status` | List all migration files and whether each has been applied |

**When to use `db_deploy.py` vs `db_migrate.py`:**

| Situation | Use |
|-----------|-----|
| Fresh database, no data | `db_deploy.py` |
| Existing database, upgrading to a new version | `db_migrate.py` |

On a freshly deployed database, `db_migrate.py` is always a no-op — `db_deploy.py` has already stamped all existing migrations.

Migration files live in `src/cerefox/db/migrations/` and are applied in filename order (`0001_...`, `0002_...`). Each file is applied exactly once; applied filenames are recorded in the `cerefox_migrations` table.

Always run a backup before migrating:

```bash
uv run python scripts/backup_create.py && uv run python scripts/db_migrate.py
```

---

## backup_create.py — Create a backup

Exports all documents, chunks, and metadata to a JSON file in the backup directory.

```bash
uv run python scripts/backup_create.py [OPTIONS]
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
uv run python scripts/backup_create.py --label before-v2-migration
```

Output: `backup-data/cerefox-20260308T143022Z-before-v2-migration.json`

---

## backup_restore.py — Restore from a backup

Restores documents and chunks from a previously created backup file. Idempotent — documents with the same content hash are skipped.

```bash
uv run python scripts/backup_restore.py BACKUP_FILE [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--dry-run` | Show what would be restored without writing |

Example:
```bash
# Preview what will be restored
uv run python scripts/backup_restore.py backup-data/cerefox-20260308T143022Z.json --dry-run

# Restore
uv run python scripts/backup_restore.py backup-data/cerefox-20260308T143022Z.json
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

**Embeddings are included** in backups. This means a restored database is immediately searchable — no `cerefox reindex` required after restore.

The backup directory (`./backup-data/` by default) is gitignored. Back up the backup files separately if you want off-site copies (e.g. copy to cloud storage).

---

## sync_docs.py — Sync project documentation into Cerefox

This optional script, ingests `README.md` and every Markdown file under `docs/` into your Cerefox knowledge
base, updating existing documents in-place. Run this any time after editing documentation
so that AI agents always have access to the current state of the project. This is only helpful if, like me, you keep the 
Cerefox docs into your deployed Cerefox knowledge base.

```bash
uv run python scripts/sync_docs.py [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--project NAME` | Project to assign documents to (default: `cerefox`) |
| `--dry-run` | List files that would be synced without ingesting anything |

**Requires**: `CEREFOX_SUPABASE_URL`, `CEREFOX_SUPABASE_KEY`, and an embedding API key
(`OPENAI_API_KEY` or `CEREFOX_FIREWORKS_API_KEY`). The target project must already exist
(create it with `uv run cerefox create-project cerefox` if needed).

**What gets synced**: `README.md` + all `.md` files under `docs/`, except `docs/research/`
(exploratory notes, not authoritative documentation). Files are matched to existing
documents by their relative path (`source_path`), so re-running the script updates content
in-place rather than creating duplicates.

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
0 3 * * * cd /path/to/cerefox && uv run python scripts/backup_create.py --label daily
```

Backups include embeddings so they are larger than pure-text exports, but for a personal knowledge base they typically remain well under 100 MB.

---

## CLI commands

The `cerefox` CLI also provides data management commands:

| Command | Description |
|---------|-------------|
| `uv run cerefox ingest FILE` | Ingest a markdown file |
| `uv run cerefox ingest --paste --title TITLE` | Ingest text from stdin |
| `uv run cerefox search QUERY` | Search the knowledge base |
| `uv run cerefox list-docs` | List all documents |
| `uv run cerefox delete-doc ID` | Delete a document by ID |
| `uv run cerefox list-projects` | List all projects |
| `uv run cerefox list-versions ID` | List all archived versions of a document |
| `uv run cerefox get-doc ID` | Retrieve current content of a document |
| `uv run cerefox get-doc ID --version VERSION_ID` | Retrieve a specific archived version |
| `uv run cerefox web` | Start the web UI |

Run `uv run cerefox --help` or `uv run cerefox COMMAND --help` for details.
