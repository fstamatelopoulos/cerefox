# Cerefox CLI Reference

Comprehensive reference for every `cerefox` subcommand. For tutorials and walkthroughs see [`quickstart.md`](quickstart.md); for the agent-via-CLI use case (Claude Code, Codex CLI, opencode, OpenClaw, Hermes, …) see [Path C in `connect-agents.md`](connect-agents.md#path-c--shell-cli-for-local-coding-agents).

> `--help` is canonical. If anything in this document disagrees with `cerefox <subcommand> --help`, trust `--help` and file an issue against this guide.

> **Local / self-hosted (Docker) backend?** Every KB verb below is identical, but you run it
> as **`cerefox-local <verb>`** (it proxies into the container via `docker exec`); lifecycle
> is different (`cerefox-local init/start/stop/upgrade/uninstall/status/logs/configure-agent`).
> A local user sets **only `OPENAI_API_KEY`** — the Supabase/database vars below do **not**
> apply (the container owns them). See [`setup-local.md`](setup-local.md).

## Setup

This section is for the **cloud / Supabase** backend. Every command reads configuration from `.env` in the working directory (or environment variables — see [`configuration.md`](configuration.md)). Required at minimum:

- `CEREFOX_SUPABASE_URL` and `CEREFOX_SUPABASE_KEY` for any command that talks to Supabase
- `OPENAI_API_KEY` for any command that embeds (ingest, search)
- `CEREFOX_DATABASE_URL` for `cerefox server deploy` and the contributor scripts (`bun scripts/db_*.ts`)

The CLI is the TypeScript `@cerefox/memory` package. Invoke any command as plain `cerefox <subcommand>` (installed via the installer or `npm install -g @cerefox/memory` — see [`quickstart.md`](quickstart.md#1-install)).

> **v0.9 verb rename**: commands now follow a `resource verb` shape (e.g. `cerefox document get`, `cerefox project list`). The old flat verbs (`get-doc`, `list-docs`, `ingest`, `list-versions`, `config-get`, `deploy-server`, `docs`, …) survive as hidden husks — they don't run; they print a pointer to the new form and exit non-zero. These pointers are kept indefinitely. Use the new forms below.

## Commands

### `cerefox document ingest`

**Purpose**: ingest a Markdown, plain-text, or `.docx` file (or stdin) into the knowledge base. `.docx` support is **beta** — converted to Markdown on ingest (via mammoth; fidelity varies with document complexity); PDF is **not** supported — convert it to Markdown first, then ingest the `.md`.

**Synopsis**:
```
cerefox document ingest [OPTIONS] [PATH]
cerefox document ingest --paste --title "<title>" [OPTIONS]   # stdin
```

**Options**:

> **Flag naming**: every flag below matches its MCP-tool parameter name (e.g. `project_name` → `--project-name`). Common flags also have a single-letter short form (`-p`, `-c`, `-f`, `-m`, `-u`, `-a`, `-r`, `-l`, `-t`, `-i`); the long form is canonical. There are **no** long-form aliases such as `--project`, `--count`, `--filter`, `--update`, or `--version` — use the canonical long name or its single-letter short form.

| Flag (canonical) | Aliases | Type | Default | Description |
|---|---|---|---|---|
| `--title` | `-t` | str | filename stem | Document title. Required with `--paste`. |
| `--project-name` | `--project`, `-p` | str | _none_ | Project name to assign the document to (created if missing). |
| `--paste` | — | flag | off | Read markdown from stdin. Requires `--title`. |
| `--metadata` | `-m` | JSON | _not provided_ | Extra metadata as a JSON object, e.g. `'{"tags":["work"]}'`. **On update, omitting this keeps the document's existing metadata** (v0.11.1); pass `'{}'` to deliberately clear all metadata. |
| `--update-if-exists` | `-u` | flag | off | Title/source-path-based fallback update. Mutually exclusive with `--document-id`. |
| `--document-id` | `-i` | UUID | _none_ | Deterministic ID-based update. Errors if the document doesn't exist. |
| `--expected-content-hash` | — | sha256 | _none_ | **Required on content updates** (v0.11 optimistic concurrency): the `content_hash` of the version this edit is based on, shown by `cerefox document get` / `cerefox search`. Stale → conflict error (re-read, merge, retry). |
| `--last-write-wins` | — | flag | off | Skip the concurrency check and overwrite regardless of concurrent changes. For re-sync flows where an external source of truth makes conflicts meaningless. Recorded in the audit log. |
| `--source` | — | str | `paste` / `file` | Source label recorded on the document. |
| `--author` | — | str | `CEREFOX_AUTHOR_NAME` or `unknown` | Audit-log author identity. |
| `--author-type` | — | `user`\|`agent` | `CEREFOX_AUTHOR_TYPE` or `user` | Caller type. Agent writes auto-routed to `pending_review`. |

**Examples**:
```bash
# Minimal: ingest a file
cerefox document ingest notes.md

# Paste from stdin
printf '# Title\n\nbody' | cerefox document ingest --paste --title "Title"

# Agent ingestion with full attribution
cerefox document ingest notes.md \
  --author "claude-code" --author-type "agent" \
  --project-name "research" --metadata '{"type":"design-doc"}'

# Deterministic update (preferred — agents should search → grab ID + hash → ingest)
cerefox document ingest --paste --title "Same Title" \
  --document-id "abc12345-..." \
  --expected-content-hash "<hash from `document get`>" \
  --author "claude-code" --author-type "agent"
```

> **Concurrency (v0.11+)**: content updates require `--expected-content-hash`
> (or an explicit `--last-write-wins`). On a conflict, re-run
> `cerefox document get <id>`, merge your changes into the latest content, and
> retry with the new hash. `document ingest-dir` and `guides ingest` bypass the
> check internally (the filesystem / npm package is their source of truth).

**Output**: human-readable summary line(s) — "Ingested" or "Updated" with the document ID, chunk count, character count.

**Exit codes**: `0` success, `1` on validation error (missing `--title`, invalid JSON, document-not-found, mutually-exclusive flags, etc.).

**MCP equivalent**: [`cerefox_ingest`](../../AGENT_GUIDE.md).

---

### `cerefox document ingest-dir`

**Purpose**: bulk-ingest every matching file in a directory.

**Synopsis**:
```
cerefox document ingest-dir [OPTIONS] DIRECTORY
```

**Options**:

Walks `DIRECTORY` **recursively** (always — there is no recurse toggle) and ingests every file whose extension is in `--extensions`.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--extensions <list>` (`-e`) | comma list | `.md,.txt` | File extensions to ingest, e.g. `--extensions .md`. `.docx` is **not** in the default set — opt in with `--extensions .md,.txt,.docx` (converted via mammoth, same as single-file ingest). |
| `--project-name <name>` (`-p`) | str | _none_ | Project to assign every document to. |
| `--update-if-exists` (`-u`) | flag | off | Update existing documents by source path / title. |
| `--metadata <json>` (`-m`) | JSON | `{}` | JSON metadata applied to every file in the run. |
| `--source <label>` | str | `cli` | Source label recorded on each document. |
| `--author <name>` (`-a`) | str | `CEREFOX_AUTHOR_NAME` or `unknown` | Audit-log author identity (applies to every write). |
| `--author-type <type>` | `user`\|`agent` | `CEREFOX_AUTHOR_TYPE` or `user` | Caller type. |

**Examples**:
```bash
# Bulk import research notes with shared metadata (recurses automatically)
cerefox document ingest-dir ./research-notes \
  --project-name "research" --metadata '{"type":"research","status":"active"}'

# Only .md files
cerefox document ingest-dir ./notes --extensions .md

# Re-ingest after editing files
cerefox document ingest-dir ./notes --update-if-exists
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
| `--mode <mode>` | `docs`\|`hybrid`\|`fts` | `docs` | `docs` = reconstructed documents (recommended); `hybrid` = ranked chunks; `fts` = keyword-only (no embedding / API key needed). |
| `--match-count <n>` (`-c`) | int | `5` | Number of results. |
| `--project-name <name>` (`-p`) | str | _none_ | Limit to a project by name. |
| `--alpha <float>` | float | `0.7` | Semantic weight 0..1 (`docs`/`hybrid`). |
| `--min-score <float>` | float | `0.5` | Minimum cosine similarity (`docs`/`hybrid`; not applied to `fts`). |
| `--metadata-filter <json>` (`-f`) | JSON | _none_ | JSONB metadata containment filter, e.g. `'{"type":"decision"}'`. |
| `--max-bytes <n>` | int | `200000` | Response size budget in bytes. |
| `--only-metadata` | flag | off | List matching docs (id, score, chunks, chars) without content — a compact listing. |
| `--requestor <name>` (`-r`) | str | `CEREFOX_REQUESTOR_NAME` or `user` | Identity recorded in the usage log. |
| `--json` | flag | off | Machine-readable JSON output. |

**Examples**:
```bash
cerefox search "OAuth design"
cerefox search "decisions" --metadata-filter '{"type":"decision-log"}' --match-count 5
cerefox search "what we tried" --mode hybrid --requestor "claude-code"
cerefox search "design docs" --only-metadata
```

**Output**: in `docs` mode (default), each match prints `## Title [id: …] · score · N chunks · M chars · partial|full` followed by the (re)constructed document body; `hybrid`/`fts` print ranked chunks. A truncation note appears if the byte budget is hit.

**Exit codes**: `0` on success. Note: as of v0.1.17, the CLI logs usage in a try/except so a usage-logging error does not affect the user-visible output (closes the failure mode that produced cerefox#27).

**MCP equivalent**: [`cerefox_search`](../../AGENT_GUIDE.md).

---

### `cerefox document get`

**Purpose**: print the full markdown content of a document to stdout.

**Synopsis**:
```
cerefox document get [OPTIONS] DOCUMENT_ID
```

**Options**:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--version-id <uuid>` | UUID | _none_ (current) | Archived version UUID — get from `cerefox document version list`. |
| `--requestor <name>` (`-r`) | str | `CEREFOX_REQUESTOR_NAME` or `user` | Identity recorded in the usage log. |
| `--json` | flag | off | Machine-readable JSON output. |

**Examples**:
```bash
cerefox document get abc12345-...
cerefox document get abc12345-... --version-id <version-uuid>     # archived
cerefox document get abc12345-... | bat -l md                  # pipe to viewer
```

**Output**: title + metadata line + `content_hash` line (the optimistic-concurrency token — pass back via `document ingest --expected-content-hash` when updating), blank line, then raw markdown.

**MCP equivalent**: [`cerefox_get_document`](../../AGENT_GUIDE.md).

---

### `cerefox document list`

**Purpose**: list documents in the knowledge base.

**Synopsis**:
```
cerefox document list [OPTIONS]
```

**Options**:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--project <name>` (`-p`) | str | _none_ | Filter by project name. |
| `--limit <n>` (`-l`) | int | `100` | Max rows. |
| `--deleted` | flag | off | List soft-deleted (trashed) documents instead of active ones, newest-deleted first. Pair the ids with `cerefox document restore` / `cerefox document delete`. |
| `--json` | flag | off | Machine-readable JSON output. |

**Output**: tabular `id | title | source | status | updated_at` listing (or `deleted_at` with `--deleted`).

**MCP equivalent**: scope-by-project / metadata / time listing maps to [`cerefox_metadata_search`](../../AGENT_GUIDE.md) — e.g. `cerefox_metadata_search(project_name="research")` lists that project's documents (the `metadata_filter` may be empty when another scope is supplied). The `--deleted` (trash) view and unscoped whole-KB listing remain CLI-only.

---

### `cerefox document edit`

**Purpose**: update a document's title and/or metadata in place, without re-ingesting content.

**Synopsis**:
```
cerefox document edit [OPTIONS] DOCUMENT_ID
```

**Options**:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--title TEXT` | str | _unchanged_ | New document title. |
| `--set-meta TEXT` | `key=value` (repeatable) | _none_ | Set/overwrite a metadata key, e.g. `--set-meta type=decision --set-meta status=active`. |
| `--unset-meta TEXT` | key (repeatable) | _none_ | Remove a metadata key, e.g. `--unset-meta status`. |
| `--author TEXT` | str | `CEREFOX_AUTHOR_NAME` or `unknown` | Identity recorded in the audit log. |
| `--author-type [user\|agent]` | choice | `CEREFOX_AUTHOR_TYPE` or `user` | Caller type. |

Metadata-only edits do **not** create a new version. A title change re-derives the FTS vector and re-embeds current chunks.

**Examples**:
```bash
cerefox document edit <doc-id> --title "Renamed Doc"
cerefox document edit <doc-id> --set-meta status=archived --unset-meta draft
```

---

### `cerefox document set-projects`

**Purpose**: replace a document's project memberships with **exactly** the given set (full-set replace — any project not listed is removed). This is the CLI equivalent of the `cerefox_set_document_projects` MCP tool; both share one membership-replace core, so they behave identically. Content is untouched; the change is logged as an `update-metadata` audit entry.

**Synopsis**:
```
cerefox document set-projects [OPTIONS] DOCUMENT_ID [PROJECT_NAMES...]
```

**Options**:

| Flag | Type | Default | Description |
|---|---|---|---|
| `[project-names...]` | variadic args | _none_ | One or more project names. Each is created if missing; order preserved; case-insensitively de-duplicated. |
| `--clear` | flag | off | Remove the document from **all** projects. Mutually exclusive with passing names. |
| `--author <name>` (`-a`) | str | `CEREFOX_AUTHOR_NAME` or `unknown` | Identity recorded in the audit log. |
| `--author-type <type>` | `user`\|`agent` | `user` | Caller type recorded in the audit log. |

To set memberships **and** update content in one shot, use `cerefox document ingest --document-id <id> --project-name …` instead. Use this command when you only need to change membership.

**Examples**:
```bash
# Set the document to belong to exactly these two projects (replaces any others)
cerefox document set-projects <doc-id> research archive

# Remove the document from all projects
cerefox document set-projects <doc-id> --clear
```

**Output**: a confirmation line with the document title and the resulting project set (or a "cleared all memberships" line), plus a reminder that the previous set was replaced.

**Exit codes**: `0` on success; `1` on validation error (no names and no `--clear`, or both) or if the document is missing / soft-deleted.

**MCP equivalent**: [`cerefox_set_document_projects`](../../AGENT_GUIDE.md).

---

### `cerefox document restore`

**Purpose**: restore a soft-deleted (trashed) document back to active.

**Synopsis**: `cerefox document restore [OPTIONS] DOCUMENT_ID`

**Options**:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--author TEXT` | str | `CEREFOX_AUTHOR_NAME` or `unknown` | Identity recorded in the audit log. |
| `--author-type [user\|agent]` | choice | `CEREFOX_AUTHOR_TYPE` or `user` | Caller type. |

Clears `deleted_at`, returning the document to search and `cerefox document list`, and writes a `restore` audit entry.

---

### `cerefox document version list`

**Purpose**: list all archived versions of a document.

**Synopsis**:
```
cerefox document version list [OPTIONS] DOCUMENT_ID
```

**Options**:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--requestor TEXT` | str | `CEREFOX_REQUESTOR_NAME` or `user` | Identity recorded in the usage log. |

**Output**: table with version number, created timestamp, source, chunk/char counts, and version UUID. Pass the UUID to `cerefox document get --version-id <uuid>` to retrieve the archived content.

**MCP equivalent**: [`cerefox_list_versions`](../../AGENT_GUIDE.md).

---

### `cerefox document version archive` / `cerefox document version unarchive`

**Purpose**: mark a specific version as `archived` (protecting it from automatic version-retention cleanup), or remove that protection.

**Synopsis**:
```
cerefox document version archive [OPTIONS] DOCUMENT_ID VERSION_ID
cerefox document version unarchive [OPTIONS] DOCUMENT_ID VERSION_ID
```

An archived version is never deleted by the lazy version-retention sweep (see [`configuration.md` → Versioning](configuration.md#versioning)). `unarchive` makes it eligible for cleanup again. Both write an `archive` / `unarchive` audit entry.

---

### `cerefox project list`

**Purpose**: list all projects.

**Synopsis**:
```
cerefox project list [OPTIONS]
```

**Options**:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--requestor TEXT` | str | `CEREFOX_REQUESTOR_NAME` or `user` | Identity recorded in the usage log. |

**MCP equivalent**: [`cerefox_list_projects`](../../AGENT_GUIDE.md).

---

### `cerefox project create` / `cerefox project edit` / `cerefox project delete`

**Purpose**: manage projects (the grouping documents are assigned to). CLI/web-only — there is no MCP equivalent for mutations.

**Synopsis**:
```
cerefox project create [OPTIONS] NAME
cerefox project edit   [OPTIONS] PROJECT          # by id or name
cerefox project delete [OPTIONS] PROJECT
```

**Options** (common):

| Flag | Type | Default | Description |
|---|---|---|---|
| `--description TEXT` | str | _none_ | Project description (`create` / `edit`). |
| `--name TEXT` | str | _unchanged_ | New name (`edit`). |
| `-y, --yes` | flag | off | Skip confirmation (`delete`; required for non-interactive use). |

**Examples**:
```bash
cerefox project create research --description "Literature and design notes"
cerefox project edit research --name research-archive
cerefox project delete research-archive --yes
```

---

### `cerefox metadata keys`

**Purpose**: discover metadata keys used across all documents (with example values and document counts).

**Synopsis**: `cerefox metadata keys`

**MCP equivalent**: [`cerefox_list_metadata_keys`](../../AGENT_GUIDE.md).

---

### `cerefox metadata search`

**Purpose**: find documents by metadata key-value criteria (no text query needed).

**Synopsis**:
```
cerefox metadata search --metadata-filter '<json>' [OPTIONS]
```

**Options**:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--metadata-filter <json>` (`-f`) | JSON | _none_ | Metadata filter, e.g. `'{"type":"decision-log"}'`. Optional since v0.11.1 — at least one of filter / `--project-name` / `--updated-since` / `--created-since` is required (parity with the MCP tool). |
| `--project-name <name>` (`-p`) | str | _none_ | Filter by project name. Sufficient on its own to list that project's documents. |
| `--updated-since TEXT` | ISO-8601 | _none_ | Documents updated after this timestamp. |
| `--created-since TEXT` | ISO-8601 | _none_ | Documents created after this timestamp. |
| `--limit INTEGER` | int | `10` | Max results. |
| `--include-content` | flag | off | Include full document content (slower; subject to byte budget). |
| `--requestor TEXT` | str | `CEREFOX_REQUESTOR_NAME` or `user` | Identity recorded in the usage log. |

**Examples**:
```bash
cerefox metadata search --metadata-filter '{"type":"decision-log"}' --updated-since 2026-05-01
cerefox metadata search --metadata-filter '{"status":"active"}' --project-name "research" --include-content
```

**MCP equivalent**: [`cerefox_metadata_search`](../../AGENT_GUIDE.md).

---

### `cerefox audit list`

**Purpose**: query the immutable audit log (who changed what, when).

**Synopsis**:
```
cerefox audit list [OPTIONS]
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
cerefox audit list --since 2026-05-11

# All edits by a specific agent
cerefox audit list --author "claude-code" --operation update-content

# JSON output, piped to jq
cerefox audit list --json --limit 1000 | jq 'select(.author_type == "agent")'
```

**MCP equivalent**: [`cerefox_get_audit_log`](../../AGENT_GUIDE.md).

---

### `cerefox document delete`

**Purpose**: **soft-delete** a document — moves it to trash, recoverable. The CLI cannot permanently delete or restore; see [Destructive operations and the trust model](access-paths.md#destructive-operations-and-the-trust-model) for the rationale.

**Synopsis**: `cerefox document delete [OPTIONS] DOCUMENT_ID`

**Options**:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--yes` | flag | off | Skip confirmation prompt. Required for non-interactive use (agents, scripts). |
| `--reason <text>` | str | _none_ | Optional reason recorded on the delete audit entry. |
| `--author <name>` (`-a`) | str | `CEREFOX_AUTHOR_NAME` or `unknown` | Identity recorded in the audit log. |
| `--author-type <type>` | `user`\|`agent` | `CEREFOX_AUTHOR_TYPE` or `user` | Caller type, recorded in the audit log. |

**What this command does:**
- Sets `deleted_at` on the document row. The document stays in the database.
- Excludes the document from search and from `cerefox document list`.
- Writes an immutable `delete` audit-log entry with the resolved author / author_type and timestamp.

**What this command does NOT do:**
- Does NOT permanently delete the document.
- Does NOT free database storage.
- Versions, chunks, and audit entries remain intact under the trash.

**Recovery**: a soft-deleted document can be restored OR permanently purged **only from the Cerefox web UI** (Trash view). These destructive / restorative actions are intentionally web-UI-only to require human-in-the-loop confirmation. See [`access-paths.md` → Destructive operations and the trust model](access-paths.md#destructive-operations-and-the-trust-model).

**Agent usage**:
```bash
# Required: --yes (no TTY for confirmation) + identity flags
cerefox document delete <doc-id> --yes \
  --author "claude-code" --author-type "agent"
```
The success message echoes the resolved author / author_type back so you can surface it to the user in your response.

**Exit codes**: `0` on success. `1` on confirmation abort, missing document, or auth failure.

---

### `cerefox server deploy`

**Purpose**: stand up *or update* the server side — schema + RPCs and all 9 Edge Functions — from the npm-bundled assets (no source clone). This is the end-user deploy path.

**Synopsis**: `cerefox server deploy [OPTIONS]`

**Options**:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--schema-only` | flag | off | Deploy only schema + RPCs (skip Edge Functions). |
| `--functions-only` | flag | off | Deploy only the 9 Edge Functions (skip schema). |
| `--dry-run` | flag | off | Preview what would happen; make no changes. |
| `--project-ref <ref>` | string | derived from `CEREFOX_SUPABASE_URL` | Supabase project ref for the Edge Function deploys (needed only for custom domains, where the ref can't be derived). |
| `--yes` | flag | off | Skip the deployment confirmation (for scripted/non-interactive runs). |

> **macOS**: the Edge Function step shells out to the Supabase CLI, which reads its
> login token from the Keychain — expect a password dialog per function (click
> "Always Allow"). To skip the dialogs, set `SUPABASE_ACCESS_TOKEN` in
> `~/.cerefox/.env` — see [`configuration.md`](configuration.md#supabase--database).

Detects fresh vs. existing databases: a fresh DB gets schema + RPCs + migration stamps; an existing DB gets pending migrations applied and `rpcs.sql` re-applied in place. There is deliberately **no `--reset`** here — the destructive wipe lives only in the contributor script `bun scripts/db_deploy.ts --reset`. See [`setup-supabase.md`](setup-supabase.md).

---

### `cerefox server reindex`

**Purpose**: re-embed chunks (e.g. after switching embedding models or pulling a schema change like title-boosting).

**Synopsis**: `cerefox server reindex [OPTIONS]`

**Options**:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--batch INTEGER` | int | `100` | Chunks per batch. |
| `--all` | flag | off | Reindex every chunk regardless of embedder. |
| `--dry-run` | flag | off | Count what would be re-embedded; do nothing. |

---

### `cerefox token generate` / `cerefox token rotate` / `cerefox token list`

**Purpose**: manage the **Cerefox access token** (`cfx_pat_…`) — the Bearer credential that
callers present to the Edge Functions (remote MCP, GPT Actions, direct HTTP). It replaces the
retired legacy anon JWT (iter-28E). The token is validated in-function; the accepted set lives
in the `CEREFOX_ACCESS_TOKENS` Supabase Function secret, and the value this machine presents is
`CEREFOX_ACCESS_TOKEN` in local `.env`.

**Synopsis**:
```
cerefox token generate           # mint a token, set it on Supabase, write it to local .env
cerefox token rotate             # add a new token (accepted set becomes [new, old]) — zero downtime
cerefox token rotate --finalize  # drop the old token once every client is on the new one
cerefox token list               # show masked fingerprints of the accepted set (never the value)
```

- `generate` prints the token **once** (it's a secret — reprints are impossible; lose it → `rotate`),
  sets the `CEREFOX_ACCESS_TOKENS` Function secret, and upserts `CEREFOX_ACCESS_TOKEN` into your
  local `.env` (backs the file up; warns if `.env` isn't gitignored; `--no-env` skips the write).
- `rotate` widens the accepted set to `[new, old]` so clients cut over with no downtime;
  `rotate --finalize` removes the old token afterward.
- Paste the token into each client per [`connect-agents.md`](connect-agents.md): the Custom GPT's
  Actions → Authentication (Bearer), or the remote-MCP client header.
- Run `token generate` **before** a token-gated `cerefox server deploy` — deploying token-gated
  Edge Functions with no token set locks every caller out.

---

### `cerefox config list` / `cerefox config get` / `cerefox config set`

**Purpose**: read/write runtime config in `cerefox_config` (e.g. `usage_tracking_enabled`, `require_requestor_identity`).

**Synopsis**:
```
cerefox config list           # all current key/value pairs
cerefox config get KEY
cerefox config set KEY VALUE
```

Used for toggling features at runtime without a redeploy — see the "Decision Log Q1 Part 2 — usage tracking opt-in" entry (stored in the Cerefox knowledge base).

---

### `cerefox web`

**Purpose**: start the web UI — a TypeScript Hono backend serving the React/Mantine SPA + JSON API.

**Synopsis**: `cerefox web [OPTIONS]`

**Options**:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--host TEXT` | str | `127.0.0.1` | Bind address. |
| `--port INTEGER` | int | `8000` | Listen port. |

The SPA assets are bundled in the npm package; no separate build step is needed for installed users. Contributors building from source can rebuild the frontend with `cd frontend && bun install && bun run build`.

---

### `cerefox mcp`

**Purpose**: run the local MCP stdio server. Used by Claude Desktop / Cursor / Claude Code as a subprocess (Path A-Local in `connect-agents.md`).

**Synopsis**: `cerefox mcp`

No options. See [`connect-agents.md` → Path A-Local](connect-agents.md#path-a-local--local-mcp-server-cerefox-mcp).

---

### `cerefox guides`

**Purpose**: work with the bundled Cerefox self-docs that ship inside the npm package.

**Synopsis**:
```
cerefox guides list                 # list the bundled guide names
cerefox guides show <name>          # print a guide to stdout
cerefox guides open <name>          # open a guide in your pager / browser
cerefox guides ingest               # ingest the bundled self-docs into the knowledge base
```

`cerefox guides ingest` loads the bundled guides into the `_cerefox-self-docs` project so agents can search Cerefox usage guidance (the same step `cerefox init` offers). It replaces the old `cerefox docs` / `sync-self-docs` / `sync-docs` commands.

---

### Setup & maintenance commands

These flat commands handle install, configuration, and health. Run any with `--help` for details:

| Command | Purpose |
|---|---|
| `cerefox init` | Interactive first-run setup; writes `~/.cerefox/.env`, offers `server deploy` + self-docs ingest. |
| `cerefox doctor` | Diagnose the install (credentials, DB reachability, schema version). |
| `cerefox status` | Show connection + schema status. |
| `cerefox configure-agent --tool <client>` | Write MCP client config (`claude-code`, `claude-desktop`, `cursor`, `codex`, `gemini`). |
| `cerefox token generate` / `rotate` / `list` | Manage the Cerefox access token (`cfx_pat_…`) — the Edge Function Bearer credential (remote MCP, GPT Actions, curl). See the [`cerefox token`](#cerefox-token-generate--cerefox-token-rotate--cerefox-token-list) section above. |
| `cerefox self-update` | Update the installed `@cerefox/memory` package. |
| `cerefox completion` | Emit a shell completion script. |
| `cerefox backup create` / `cerefox backup restore` | File-system backup / restore of the knowledge base (see [`ops-scripts.md`](ops-scripts.md)). |

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
| `2` | Argument-parsing error (invalid choice value, missing required arg) |

## MCP tool ↔ CLI command mapping

Full table for Path C agents (see [`connect-agents.md`](connect-agents.md#path-c--shell-cli-for-local-coding-agents) for context).

Every MCP parameter has an exact-name CLI flag (kebab-cased). Short forms exist as aliases.

| MCP tool | CLI command |
|---|---|
| `cerefox_search(query, match_count, project_name, metadata_filter, requestor)` | `cerefox search "<q>" --match-count N --project-name <name> --metadata-filter '<json>' --requestor <name>` |
| `cerefox_ingest(title, content, project_name, metadata, update_if_exists, document_id, expected_content_hash, last_write_wins, source, author, author_type)` (file) | `cerefox document ingest <path> --title <t> --project-name <n> --metadata '<json>' --update-if-exists\|--document-id <uuid> --expected-content-hash <hash>\|--last-write-wins --source <s> --author <a> --author-type <t>` |
| `cerefox_ingest(...)` (paste) | `printf '...' \| cerefox document ingest --paste --title "<t>"` (same flags) |
| `cerefox_get_document(document_id, version_id, requestor)` | `cerefox document get <id> --version-id <vid> --requestor <name>` |
| `cerefox_list_versions(document_id, requestor)` | `cerefox document version list <id> --requestor <name>` |
| `cerefox_list_projects(requestor)` | `cerefox project list --requestor <name>` |
| `cerefox_set_document_projects(document_id, project_names, author)` | `cerefox document set-projects <id> <name...> --author <a> --author-type <t>` (or `--clear` to remove all) |
| `cerefox_list_metadata_keys()` | `cerefox metadata keys` |
| `cerefox_metadata_search(metadata_filter, project_name, updated_since, created_since, limit, include_content, requestor)` | `cerefox metadata search --metadata-filter '<json>' --project-name <n> --updated-since <iso> --created-since <iso> --limit N --include-content --requestor <name>` |
| `cerefox_get_audit_log(document_id, author, operation, since, until, limit, requestor)` | `cerefox audit list --document-id <id> --author <a> --operation <op> --since <iso> --until <iso> --limit N --requestor <name>` |

## CLI ↔ MCP parity matrix

The table above is MCP-first (it lists the tools that *have* a CLI form). This
one is **CLI-first** — every `cerefox` command, with its MCP equivalent or an
explicit reason it has none. It exists to make parity gaps visible. Legend:
**✅ mapped** · **⚠️ gap** (a capability one surface has and the other lacks,
arguably worth closing) · **🔒 intentional** (deliberately not on the MCP/agent
surface).

| CLI command | MCP equivalent | Status |
|---|---|---|
| `document ingest` | `cerefox_ingest` | ✅ |
| `document ingest-dir` | — (agents loop `cerefox_ingest`) | 🔒 bulk filesystem walk; no server-side dir access from MCP |
| `search` | `cerefox_search` | ✅ (CLI adds `--mode`/`--alpha`/`--min-score`/`--only-metadata`) |
| `document get` | `cerefox_get_document` | ✅ |
| `document list` | `cerefox_metadata_search` (scope by `project_name` / metadata / time) | ✅ as of this change. Unscoped whole-KB listing has no MCP path by design (scope it) |
| `document edit` (title / metadata in place) | — | 🔒 intentional: a human/web-parity convenience. Agents update title+metadata deterministically via `cerefox_ingest` (with `document_id`); a metadata-only edit isn't a needed agent primitive |
| `document delete` (soft-delete) | — | 🔒 destructive; trust model keeps delete/restore on CLI + web only |
| `document restore` | — | 🔒 trust model (CLI + web only) |
| `document version list` | `cerefox_list_versions` | ✅ |
| `document version archive` / `unarchive` | — | 🔒 intentional: version-retention protection is exposed only to CLI + web (a maintenance concern, not an agent primitive) |
| `document set-projects` | `cerefox_set_document_projects` | ✅ full-set replace of a document's project memberships (shared core; `--clear` to remove all) |
| `project list` | `cerefox_list_projects` | ✅ |
| `project create` / `edit` / `delete` | — | 🔒 project mutations CLI + web only |
| `metadata keys` | `cerefox_list_metadata_keys` | ✅ |
| `metadata search` | `cerefox_metadata_search` | ✅ |
| `audit list` | `cerefox_get_audit_log` | ✅ |
| `guides list` / `show` / `open` / `ingest` | `cerefox_get_help` (partial) | ✅~ `get_help` returns the bundled quick-reference; `guides` is the richer CLI form |
| `server deploy` / `server reindex` | — | 🔒 operator/deploy surface |
| `config list` / `get` / `set` | — | 🔒 runtime config; operator surface |
| `web` / `mcp` | — | 🔒 lifecycle (`mcp` *is* the MCP server) |
| `init` / `doctor` / `status` / `configure-agent` / `self-update` / `completion` / `backup *` | — | 🔒 install / health / ops |

**Gap status** (the 🔒 rows are deliberate and out of scope):

1. `document list` → **closed**: project/metadata/time-scoped listing now routes
   through `cerefox_metadata_search` (it accepts an empty `metadata_filter` when
   another scope is supplied).
2. `cerefox_set_document_projects` → **closed**: added `cerefox document
   set-projects` (full-set replace, `--clear` to remove all), sharing the
   membership-replace core with the MCP tool.
3. `document edit` (metadata/title-only edit) → **intentional non-gap**: a
   human/web-parity convenience; agents use `cerefox_ingest` for content+metadata
   updates. Revisit only if a concrete agent workflow needs metadata-only edits.
4. `document version archive` / `unarchive` → **intentional non-gap**: version-retention
   protection is exposed only to CLI + web (a maintenance concern, deliberately not on
   the MCP/agent surface).

## Known issues

None outstanding as of v1.0.1. When new bugs surface, they are tracked in the GitHub issues list; check there before relying on a behaviour the docs imply.

## Common recipes

### Bulk-import a directory with shared metadata
```bash
cerefox document ingest-dir ./papers --extensions .md \
  --project-name "literature" \
  --metadata '{"type":"paper","status":"reviewed"}'
```

### Update a document by ID (preferred pattern for agents)
```bash
# Step 1: find it
cerefox search "the OAuth design doc" --match-count 1

# Step 2: read it — note the id AND the `content_hash:` line (the concurrency token)
cerefox document get "<uuid>"

# Step 3: update in place, proving freshness with the hash from step 2
printf '%s' "$NEW_CONTENT" | cerefox document ingest --paste \
  --title "OAuth 2.1 Design Document" \
  --document-id "<uuid>" \
  --expected-content-hash "<hash>" \
  --author "claude-code" --author-type "agent"

# On a conflict error: repeat from step 2 (fresh content + fresh hash),
# merge your changes into the latest content, then retry.
```

### Unattended sync job
```bash
# In a cron job / launchd plist. Set CEREFOX_AUTHOR_NAME=sync-script in env.
cerefox document ingest-dir ~/notes --update-if-exists
```

### Use the CLI from an agent's Bash tool
See [`connect-agents.md` → Path C](connect-agents.md#path-c--shell-cli-for-local-coding-agents) for the full setup and [`AGENT_GUIDE.md` → Using Cerefox via the CLI](../../AGENT_GUIDE.md) for the agent-facing conventions.
