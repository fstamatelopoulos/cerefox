# Cerefox CLI Reference

Comprehensive reference for every `cerefox` subcommand. For tutorials and walkthroughs see [`quickstart.md`](quickstart.md); for the agent-via-CLI use case (Claude Code, Codex CLI, opencode, OpenClaw, Hermes, …) see [Path C in `connect-agents.md`](connect-agents.md#path-c--shell-cli-for-local-coding-agents).

> `--help` is canonical. If anything in this document disagrees with `cerefox <subcommand> --help`, trust `--help` and file an issue against this guide.

## Setup

Every command reads configuration from `.env` in the working directory (or environment variables — see [`configuration.md`](configuration.md)). Required at minimum:

- `CEREFOX_SUPABASE_URL` and `CEREFOX_SUPABASE_KEY` for any command that talks to Supabase
- `OPENAI_API_KEY` (or `CEREFOX_FIREWORKS_API_KEY`) for any command that embeds (ingest, search)
- `CEREFOX_DATABASE_URL` only for the `scripts/db_*.py` deployment scripts (not the `cerefox` CLI itself)

Invoke any command with `uv run cerefox <subcommand>`. Inside an activated venv, `cerefox <subcommand>` works too — but `uv run` is preferred (no venv activation needed; see Decision Log Q2 lesson on `uv` installation).

## Commands

### `cerefox ingest`

**Purpose**: ingest a markdown / PDF / DOCX file (or stdin) into the knowledge base.

**Synopsis**:
```
cerefox ingest [OPTIONS] [PATH]
cerefox ingest --paste --title "<title>" [OPTIONS]   # stdin
```

**Options**:

> **Flag naming**: every flag below matches its MCP-tool parameter name (e.g. `project_name` → `--project-name`). Short forms (`--project`, `-p`) remain as aliases — the long form is the canonical name shown in `--help`.

| Flag (canonical) | Aliases | Type | Default | Description |
|---|---|---|---|---|
| `--title` | `-t` | str | filename stem | Document title. Required with `--paste`. |
| `--project-name` | `--project`, `-p` | str | _none_ | Project name to assign the document to (created if missing). |
| `--paste` | — | flag | off | Read markdown from stdin. Requires `--title`. |
| `--metadata` | `-m` | JSON | `{}` | Extra metadata as a JSON object, e.g. `'{"tags":["work"]}'`. |
| `--update-if-exists` | `--update` | flag | off | Title/source-path-based fallback update. Mutually exclusive with `--document-id`. |
| `--document-id` | — | UUID | _none_ | Deterministic ID-based update. Errors if the document doesn't exist. |
| `--source` | — | str | `paste` / `file` | Source label recorded on the document. |
| `--author` | — | str | `CEREFOX_AUTHOR_NAME` or `unknown` | Audit-log author identity. |
| `--author-type` | — | `user`\|`agent` | `CEREFOX_AUTHOR_TYPE` or `user` | Caller type. Agent writes auto-routed to `pending_review`. |

**Examples**:
```bash
# Minimal: ingest a file
cerefox ingest notes.md

# Paste from stdin
printf '# Title\n\nbody' | cerefox ingest --paste --title "Title"

# Agent ingestion with full attribution
cerefox ingest notes.md \
  --author "claude-code" --author-type "agent" \
  --project-name "research" --metadata '{"type":"design-doc"}'

# Deterministic update (preferred — agents should search → grab ID → ingest)
cerefox ingest --paste --title "Same Title" \
  --document-id "abc12345-..." \
  --author "claude-code" --author-type "agent"
```

**Output**: human-readable summary line(s) — "Ingested" or "Updated" with the document ID, chunk count, character count.

**Exit codes**: `0` success, `1` on validation error (missing `--title`, invalid JSON, document-not-found, mutually-exclusive flags, etc.).

**MCP equivalent**: [`cerefox_ingest`](../../AGENT_GUIDE.md).

---

### `cerefox ingest-dir`

**Purpose**: bulk-ingest every matching file in a directory.

**Synopsis**:
```
cerefox ingest-dir [OPTIONS] DIRECTORY
```

**Options**:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--pattern TEXT` | glob | `*.md` | Glob pattern. Examples: `**/*.md`, `*.pdf`. |
| `--project-name TEXT` (alias: `--project`, `-p`) | str | _none_ | Project to assign every document to. |
| `--recursive / --no-recursive` | flag | `--no-recursive` | Recurse into sub-directories. |
| `--dry-run` | flag | off | Print files that would be ingested; do nothing. |
| `--update-if-exists` (alias: `--update`) | flag | off | Update existing documents by source path. |
| `-m, --metadata TEXT` | JSON | `{}` | JSON metadata applied to every file in the run. |
| `--author TEXT` | str | `CEREFOX_AUTHOR_NAME` or `unknown` | Audit-log author identity (applies to every write). |
| `--author-type [user\|agent]` | choice | `CEREFOX_AUTHOR_TYPE` or `user` | Caller type. |

**Examples**:
```bash
# Bulk import research notes with shared metadata
cerefox ingest-dir ./research-notes --recursive \
  --project-name "research" --metadata '{"type":"research","status":"active"}'

# Re-ingest after editing files
cerefox ingest-dir ./notes --update-if-exists
```

**Output**: one line per file showing `✓` (ingested), `↑` (updated), `⏭` (skipped: hash match), or `❌` (error); summary at the end.

**Exit codes**: `0` even if some files errored — per-file errors are counted but the command itself does not fail unless argument validation fails.

---

### `cerefox search`

**Purpose**: search the knowledge base (hybrid FTS + semantic by default).

**Synopsis**:
```
cerefox search [OPTIONS] QUERY
```

**Options**:

| Flag | Type | Default | Description |
|---|---|---|---|
| `-m, --mode [hybrid\|fts\|semantic]` | choice | `hybrid` | Search mode. |
| `--match-count INTEGER` (alias: `--count`, `-n`) | int | `10` | Number of results. |
| `--project-name TEXT` (alias: `--project`, `-p`) | str | _none_ | Limit to a project by name. |
| `--alpha FLOAT` | float | `0.7` | FTS/semantic weight (hybrid only). |
| `--min-score FLOAT` | float | `CEREFOX_MIN_SEARCH_SCORE` or `0.50` | Minimum cosine similarity (hybrid/semantic only). |
| `--metadata-filter TEXT` (alias: `--filter`, `-f`) | JSON | _none_ | JSONB metadata containment filter, e.g. `'{"type":"decision"}'`. |
| `--requestor TEXT` | str | `CEREFOX_REQUESTOR_NAME` or `user` | Identity recorded in the usage log. |

**Examples**:
```bash
cerefox search "OAuth design"
cerefox search "decisions" --metadata-filter '{"type":"decision-log"}' --match-count 5
cerefox search "what we tried" --mode semantic --requestor "claude-code"
```

**Output**: numbered result list with title, score, and 300-char preview per hit. Final line shows total results + bytes.

**Exit codes**: `0` on success. Note: as of v0.1.17, the CLI logs usage in a try/except so a usage-logging error does not affect the user-visible output (closes the failure mode that produced cerefox#27).

**MCP equivalent**: [`cerefox_search`](../../AGENT_GUIDE.md).

---

### `cerefox get-doc`

**Purpose**: print the full markdown content of a document to stdout.

**Synopsis**:
```
cerefox get-doc [OPTIONS] DOCUMENT_ID
```

**Options**:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--version-id TEXT` (alias: `--version`) | UUID | _none_ (current) | Archived version UUID — get from `cerefox list-versions`. |
| `--requestor TEXT` | str | `CEREFOX_REQUESTOR_NAME` or `user` | Identity recorded in the usage log. |

**Examples**:
```bash
cerefox get-doc abc12345-...
cerefox get-doc abc12345-... --version-id <version-uuid>     # archived
cerefox get-doc abc12345-... | bat -l md                  # pipe to viewer
```

**Output**: title + metadata line, blank line, then raw markdown.

**MCP equivalent**: [`cerefox_get_document`](../../AGENT_GUIDE.md).

---

### `cerefox list-docs`

**Purpose**: list documents in the knowledge base.

**Synopsis**:
```
cerefox list-docs [OPTIONS]
```

**Options**:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--project-name TEXT` (alias: `--project`, `-p`) | str | _none_ | Filter by project ID or name. |
| `-n, --limit INTEGER` | int | `20` | Max rows. |

**Output**: tabular `id | chunk_count | total_chars | title` listing. CLI-only — there is no MCP equivalent.

---

### `cerefox list-versions`

**Purpose**: list all archived versions of a document.

**Synopsis**:
```
cerefox list-versions [OPTIONS] DOCUMENT_ID
```

**Options**:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--requestor TEXT` | str | `CEREFOX_REQUESTOR_NAME` or `user` | Identity recorded in the usage log. |

**Output**: table with version number, created timestamp, source, chunk/char counts, and version UUID. Pass the UUID to `cerefox get-doc --version-id <uuid>` to retrieve the archived content.

**MCP equivalent**: [`cerefox_list_versions`](../../AGENT_GUIDE.md).

---

### `cerefox list-projects`

**Purpose**: list all projects.

**Synopsis**:
```
cerefox list-projects [OPTIONS]
```

**Options**:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--requestor TEXT` | str | `CEREFOX_REQUESTOR_NAME` or `user` | Identity recorded in the usage log. |

**MCP equivalent**: [`cerefox_list_projects`](../../AGENT_GUIDE.md).

---

### `cerefox list-metadata-keys`

**Purpose**: discover metadata keys used across all documents (with example values and document counts).

**Synopsis**: `cerefox list-metadata-keys`

**MCP equivalent**: [`cerefox_list_metadata_keys`](../../AGENT_GUIDE.md).

---

### `cerefox metadata-search`

**Purpose**: find documents by metadata key-value criteria (no text query needed).

**Synopsis**:
```
cerefox metadata-search --metadata-filter '<json>' [OPTIONS]
```

**Options**:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--metadata-filter TEXT` (alias: `--filter`) | JSON | **required** | Metadata filter, e.g. `'{"type":"decision-log"}'`. |
| `--project-name TEXT` (alias: `--project`) | str | _none_ | Filter by project name. |
| `--updated-since TEXT` | ISO-8601 | _none_ | Documents updated after this timestamp. |
| `--created-since TEXT` | ISO-8601 | _none_ | Documents created after this timestamp. |
| `--limit INTEGER` | int | `10` | Max results. |
| `--include-content` | flag | off | Include full document content (slower; subject to byte budget). |
| `--requestor TEXT` | str | `CEREFOX_REQUESTOR_NAME` or `user` | Identity recorded in the usage log. |

**Examples**:
```bash
cerefox metadata-search --metadata-filter '{"type":"decision-log"}' --updated-since 2026-05-01
cerefox metadata-search --metadata-filter '{"status":"active"}' --project-name "research" --include-content
```

**MCP equivalent**: [`cerefox_metadata_search`](../../AGENT_GUIDE.md).

---

### `cerefox get-audit-log`

**Purpose**: query the immutable audit log (who changed what, when).

**Synopsis**:
```
cerefox get-audit-log [OPTIONS]
```

**Options**:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--document-id TEXT` | UUID | _none_ | Filter to a single document. |
| `--author TEXT` | str | _none_ | Filter by author name (exact match). |
| `--operation [create\|update-content\|update-metadata\|delete\|status-change\|archive\|unarchive\|restore]` | choice | _none_ | Filter by operation type. |
| `--since TEXT` | ISO-8601 | _none_ | Lower bound on `created_at`. |
| `--until TEXT` | ISO-8601 | _none_ | Upper bound on `created_at`. |
| `--limit INTEGER` | int | `50` | Max rows. |
| `--json` | flag | off | Emit one JSON object per line (for piping to `jq` / scripts). |
| `--requestor TEXT` | str | `CEREFOX_REQUESTOR_NAME` or `user` | Identity recorded in the usage log. |

**Examples**:
```bash
# All audit entries in the last week
cerefox get-audit-log --since 2026-05-11

# All edits by a specific agent
cerefox get-audit-log --author "claude-code" --operation update-content

# JSON output, piped to jq
cerefox get-audit-log --json --limit 1000 | jq 'select(.author_type == "agent")'
```

**MCP equivalent**: [`cerefox_get_audit_log`](../../AGENT_GUIDE.md).

---

### `cerefox delete-doc`

**Purpose**: **soft-delete** a document — moves it to trash, recoverable. The CLI cannot permanently delete or restore; see [Destructive operations and the trust model](access-paths.md#destructive-operations-and-the-trust-model) for the rationale.

**Synopsis**: `cerefox delete-doc [OPTIONS] DOCUMENT_ID`

**Options**:

| Flag | Type | Default | Description |
|---|---|---|---|
| `-y, --yes` | flag | off | Skip confirmation prompt. Required for non-interactive use (agents, scripts). |
| `--author` | str | `CEREFOX_AUTHOR_NAME` or `unknown` | Identity recorded in the audit log. |
| `--author-type` | `user`\|`agent` | `CEREFOX_AUTHOR_TYPE` or `user` | Caller type, recorded in the audit log. |

**What this command does:**
- Sets `deleted_at` on the document row. The document stays in the database.
- Excludes the document from search and from `cerefox list-docs`.
- Writes an immutable `delete` audit-log entry with the resolved author / author_type and timestamp.

**What this command does NOT do:**
- Does NOT permanently delete the document.
- Does NOT free database storage.
- Versions, chunks, and audit entries remain intact under the trash.

**Recovery**: a soft-deleted document can be restored OR permanently purged **only from the Cerefox web UI** (Trash view). These destructive / restorative actions are intentionally web-UI-only to require human-in-the-loop confirmation. See [`access-paths.md` → Destructive operations and the trust model](access-paths.md#destructive-operations-and-the-trust-model).

**Agent usage**:
```bash
# Required: --yes (no TTY for confirmation) + identity flags
cerefox delete-doc <doc-id> --yes \
  --author "claude-code" --author-type "agent"
```
The success message echoes the resolved author / author_type back so you can surface it to the user in your response.

**Exit codes**: `0` on success. `1` on confirmation abort, missing document, or auth failure.

---

### `cerefox reindex`

**Purpose**: re-embed chunks (e.g. after switching embedding models or pulling a schema change like title-boosting).

**Synopsis**: `cerefox reindex [OPTIONS]`

**Options**:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--batch INTEGER` | int | `100` | Chunks per batch. |
| `--all` | flag | off | Reindex every chunk regardless of embedder. |
| `--dry-run` | flag | off | Count what would be re-embedded; do nothing. |

---

### `cerefox config-get` / `cerefox config-set`

**Purpose**: read/write runtime config in `cerefox_config` (e.g. `usage_tracking_enabled`).

**Synopsis**:
```
cerefox config-get KEY
cerefox config-set KEY VALUE
```

Used for toggling features at runtime without a redeploy — see [Decision Log Q1 Part 2 — usage tracking opt-in](https://github.com/fstamatelopoulos/cerefox) entry.

---

### `cerefox web`

**Purpose**: start the FastAPI web UI (React SPA + JSON API).

**Synopsis**: `cerefox web [OPTIONS]`

**Options**:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--host TEXT` | str | `127.0.0.1` | Bind address. |
| `--port INTEGER` | int | `8000` | Listen port. |
| `--reload` | flag | off | Auto-reload on source changes (dev). |

Requires the frontend to be built: `cd frontend && npm install && npm run build`.

---

### `cerefox mcp`

**Purpose**: run the local MCP stdio server. Used by Claude Desktop / Cursor / Claude Code as a subprocess (Path A-Local in `connect-agents.md`).

**Synopsis**: `cerefox mcp`

No options. See [`connect-agents.md` → Path A-Local](connect-agents.md#path-a-local--local-mcp-server-cerefox-mcp).

---

## Environment variables

The CLI reads its own runtime config from environment (or `.env`). See [`configuration.md`](configuration.md) for the full list. Most relevant to CLI behaviour:

| Variable | Default | Effect |
|---|---|---|
| `CEREFOX_AUTHOR_NAME` | `unknown` | Default for `--author` on `ingest` / `ingest-dir`. |
| `CEREFOX_AUTHOR_TYPE` | `user` | Default for `--author-type`. |
| `CEREFOX_REQUESTOR_NAME` | `user` | Default for `--requestor` on read commands. |

Precedence: **CLI flag > env var > built-in default**.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Validation error, missing config, document-not-found, etc. — see error message |
| `2` | Click argument-parsing error (invalid Choice value, missing required arg) |

## MCP tool ↔ CLI command mapping

Full table for Path C agents (see [`connect-agents.md`](connect-agents.md#path-c--shell-cli-for-local-coding-agents) for context).

Every MCP parameter has an exact-name CLI flag (kebab-cased). Short forms exist as aliases.

| MCP tool | CLI command |
|---|---|
| `cerefox_search(query, match_count, project_name, metadata_filter, requestor)` | `cerefox search "<q>" --match-count N --project-name <name> --metadata-filter '<json>' --requestor <name>` |
| `cerefox_ingest(title, content, project_name, metadata, update_if_exists, document_id, source, author, author_type)` (file) | `cerefox ingest <path> --title <t> --project-name <n> --metadata '<json>' --update-if-exists\|--document-id <uuid> --source <s> --author <a> --author-type <t>` |
| `cerefox_ingest(...)` (paste) | `printf '...' \| cerefox ingest --paste --title "<t>"` (same flags) |
| `cerefox_get_document(document_id, version_id, requestor)` | `cerefox get-doc <id> --version-id <vid> --requestor <name>` |
| `cerefox_list_versions(document_id, requestor)` | `cerefox list-versions <id> --requestor <name>` |
| `cerefox_list_projects(requestor)` | `cerefox list-projects --requestor <name>` |
| `cerefox_list_metadata_keys()` | `cerefox list-metadata-keys` |
| `cerefox_metadata_search(metadata_filter, project_name, updated_since, created_since, limit, include_content, requestor)` | `cerefox metadata-search --metadata-filter '<json>' --project-name <n> --updated-since <iso> --created-since <iso> --limit N --include-content --requestor <name>` |
| `cerefox_get_audit_log(document_id, author, operation, since, until, limit, requestor)` | `cerefox get-audit-log --document-id <id> --author <a> --operation <op> --since <iso> --until <iso> --limit N --requestor <name>` |

## Known issues

None outstanding as of v0.1.17 (cerefox#27 — the `cerefox search` NameError — is resolved). When new bugs surface, they are tracked in the GitHub issues list; check there before relying on a behaviour the docs imply.

## Common recipes

### Bulk-import a directory with shared metadata
```bash
cerefox ingest-dir ./papers --recursive --pattern '*.pdf' \
  --project-name "literature" \
  --metadata '{"type":"paper","status":"reviewed"}'
```

### Update a document by ID (preferred pattern for agents)
```bash
# Step 1: find it
cerefox search "the OAuth design doc" --match-count 1

# Step 2: copy the id from `Doc: ... (id: <uuid>)` line
# Step 3: update in place
printf '%s' "$NEW_CONTENT" | cerefox ingest --paste \
  --title "OAuth 2.1 Design Document" \
  --document-id "<uuid>" \
  --author "claude-code" --author-type "agent"
```

### Unattended sync job
```bash
# In a cron job / launchd plist. Set CEREFOX_AUTHOR_NAME=sync-script in env.
cd /path/to/cerefox && uv run cerefox ingest-dir ~/notes --recursive --update-if-exists
```

### Use the CLI from an agent's Bash tool
See [`connect-agents.md` → Path C](connect-agents.md#path-c--shell-cli-for-local-coding-agents) for the full setup and [`AGENT_GUIDE.md` → Using Cerefox via the CLI](../../AGENT_GUIDE.md) for the agent-facing conventions.
