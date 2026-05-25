# How AI Agents Use Cerefox

Reference guide for AI agents interacting with the Cerefox knowledge base.
Read this before your first interaction. For a minimal quick reference, see `AGENT_QUICK_REFERENCE.md`.

---

## What Cerefox Is

Cerefox is a persistent, shared knowledge base that multiple AI agents can read and write.
Knowledge written by one agent (or a human) is immediately searchable by any other agent.
It is not a message bus -- it is curated, versioned, searchable memory backed by Postgres + pgvector.

## Two ways to interact with Cerefox

You'll be using **one** of these — whichever your user (or the harness) has configured:

1. **MCP tools (default)** — eight named tools (`cerefox_search`, `cerefox_ingest`, …) exposed by either a local MCP server (`cerefox mcp`) or the remote `cerefox-mcp` Edge Function. Tool names and parameters are documented in **The 8 Tools** below. This is the recommended path for purpose-built agent clients.
2. **Shell CLI (Bash tool)** — the same operations exposed as a local `uv run cerefox …` command, invoked via your Bash tool. Used when your user prefers not to install/configure an MCP server. The semantics are identical; only the surface differs. See **Using Cerefox via the CLI** near the bottom of this guide for the MCP-tool → CLI-command mapping and the small list of behavioural differences.

If you're not sure which mode you're in: check whether `cerefox_search` shows up in your tool list. If yes, use MCP. If no, ask your user where the Cerefox checkout lives — they'll have told you, typically in `CLAUDE.md`, `AGENTS.md`, or an equivalent project memory file.

The rest of this guide is written around the MCP tool names, since those are stable across both modes. The CLI section maps each tool name to its CLI command.

---

## The 8 Tools

### cerefox_search

Find documents using hybrid search (full-text + semantic vector similarity).

| Parameter | Required | Description |
|-----------|----------|-------------|
| `query` | Yes | Natural language search query. 3-8 focused keywords work best. |
| `match_count` | No | Max documents to return (default 5). |
| `project_name` | No | Filter to a specific project by name. |
| `metadata_filter` | No | JSON object for filtering by metadata (AND semantics). Example: `{"type": "decision-log"}` |
| `max_bytes` | No | Response size budget in bytes (default 200000). |
| `requestor` | No | Your agent name for attribution. Always set this. |

**Results format**: Each result shows `## Title [id: <uuid>] (score: X.XXX)` followed by content.
Save the `document_id` from `[id: ...]` -- you need it for `cerefox_get_document` and `cerefox_ingest` updates.

For large documents, results may be partial (`is_partial` flag). Use `cerefox_get_document` with the ID to get the full text.

**Rule**: Always search before answering questions about stored knowledge. Always search before ingesting to check for duplicates.

---

### cerefox_ingest

Save a new document or update an existing one.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `title` | Yes | Descriptive, stable title (e.g., "OAuth 2.1 Design Document", not "doc1"). |
| `content` | Yes | Markdown content. Use H1/H2/H3 headings -- the chunker uses them for segmentation. |
| `document_id` | No | UUID of an existing document to update. When provided, updates that document directly regardless of `update_if_exists`. Returns an error if the document does not exist. Workflow: search → note the `[id: ...]` → pass here. |
| `update_if_exists` | No | When `true`, updates the document with the same title (versions the old content). Default `false`. Ignored when `document_id` is provided. |
| `project_name` | No | Assign to a project (created automatically if it doesn't exist). |
| `metadata` | No | Arbitrary JSON. Use at minimum: `type` and `status`. |
| `author` | No | Your agent name for audit attribution. Always set this. |
| `source` | No | Origin label (default "agent"). |

**The update workflow (preferred -- ID-based)**:
1. Search for the document. Note the `[id: abc123]` in the result.
2. Call `cerefox_ingest` with `document_id: "abc123"` and the new content.
3. The old content is automatically versioned and recoverable.

**The update workflow (fallback -- title-based)**:
1. Search for the document first.
2. Call `cerefox_ingest` with the **exact same title** and `update_if_exists: true`.
3. If you use a different title, a **new** document is created (the old one remains). This is almost never what you want when revising.

**Deduplication**: Content is SHA-256 hashed. Identical content is skipped (no re-indexing). Metadata-only changes update metadata without creating a version.

**What to ingest**: Distilled summaries, decisions with rationale, curated insights. Not raw dumps, logs, or transcripts. Use Markdown headings for structure.

---

### cerefox_get_document

Retrieve the complete text of a document by its UUID.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `document_id` | Yes | UUID from search results `[id: ...]`. |
| `version_id` | No | UUID of an archived version (from `cerefox_list_versions`). |
| `requestor` | No | Your agent name. |

Use this when search returns partial results, or to read a previous version before restoring it.

---

### cerefox_list_versions

Show version history of a document.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `document_id` | Yes | UUID of the document. |
| `requestor` | No | Your agent name. |

Returns: version_number, version_id, source, chunk_count, total_chars, created_at.

**To restore an old version**: retrieve it with `cerefox_get_document(document_id, version_id=<target>)`, then re-ingest with `cerefox_ingest(title=<same>, content=<old>, update_if_exists=true)`.

---

### cerefox_list_metadata_keys

Discover which metadata keys are in use across the knowledge base.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `requestor` | No | Your agent name. |

Returns each key with document count and example values. Call this before constructing `metadata_filter` for search.

---

### cerefox_metadata_search

Find documents by metadata criteria without a text search query.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `metadata_filter` | Yes | JSON key-value pairs (AND semantics). Example: `{"type": "decision-log"}` |
| `project_name` | No | Restrict to a project. |
| `include_content` | No | Include full text (default false). |
| `limit` | No | Max results (default 10). |
| `updated_since` | No | ISO-8601 timestamp. Only docs updated on/after. |
| `created_since` | No | ISO-8601 timestamp. Only docs created on/after. |
| `max_bytes` | No | Response size budget when include_content is true. |
| `requestor` | No | Your agent name. |

Use for browsing by category, catching up on recent changes (`updated_since`), or finding all documents of a specific type.

---

### cerefox_list_projects

List all projects with names, IDs, and descriptions.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `requestor` | No | Your agent name. |

Call once per session to discover available projects before filtering search results by `project_name`.

---

### cerefox_get_audit_log

Query the immutable audit log of all write operations.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `document_id` | No | Filter by document UUID. |
| `author` | No | Filter by author name. |
| `operation` | No | Filter by type: create, update-content, update-metadata, delete, restore. |
| `since` | No | ISO timestamp lower bound. |
| `limit` | No | Max entries (default 50, max 200). |
| `requestor` | No | Your agent name. |

---

## Key Workflows

### Search then update (ID-based -- preferred)

```
1. cerefox_search("topic")           -- find relevant docs, note [id: uuid]
2. cerefox_get_document(id)          -- get full text if partial
3. cerefox_ingest(title, content,    -- update by document ID (deterministic)
     document_id="uuid")
```

### Search then update (title-based -- fallback)

```
1. cerefox_search("topic")           -- find relevant docs
2. cerefox_get_document(id)          -- get full text if partial
3. cerefox_ingest(title, content,    -- update with same title
     update_if_exists=true)
```

### Save new knowledge

```
1. cerefox_search("topic")           -- check if it already exists
2. If not found: cerefox_ingest(title, content, project_name, metadata)
3. If found: cerefox_ingest(same_title, new_content, document_id="uuid")
```

### Catch up on recent changes

```
1. cerefox_metadata_search(metadata_filter={"type": "decision-log"},
     updated_since="2026-03-28T00:00:00Z")
2. Review what other agents or the user have written since your last session
```

---

## Rules

1. **Always search before ingesting.** Check for existing documents on the topic.
2. **Prefer `document_id` for updates** -- pass the UUID from search results to update a specific document. Use `update_if_exists: true` as a fallback when you don't have the ID.
3. **Always set `author`/`requestor`** to your agent name for attribution.
4. **Use the `document_id` from search results** for `cerefox_get_document`, `cerefox_list_versions`, and targeted `cerefox_ingest` updates.
5. **Add metadata**: at minimum `type` (e.g., "research", "decision-log") and `status` ("active", "draft").
6. **Write structured Markdown** with H1/H2/H3 headings. The chunker uses heading structure.
7. **Distill, don't dump.** Summaries > transcripts. Decisions > discussions. Insights > raw data.

---

## Metadata Conventions

| Key | Purpose | Example values |
|-----|---------|---------------|
| `type` | Document category | `decision-log`, `design-doc`, `research`, `agent-guide`, `vision-document` |
| `status` | Lifecycle state | `active`, `draft`, `archived`, `research-complete` |
| `author` | Creator name | `claude-code`, `archiver`, `user` |
| `tags` | Topic keywords (JSON array string) | `["architecture", "MCP", "memory"]` |

Call `cerefox_list_metadata_keys` for the current list -- conventions evolve.

---

## Writing linkable content

Documents you ingest may contain markdown links to other Cerefox documents. The Cerefox web UI intercepts these links at click time and resolves them to the target document. This makes a `README.md` you ingested from a git repo behave the same way inside Cerefox as it does on disk or on GitHub — clickable cross-references. The resolution happens entirely in the browser; the stored markdown is untouched.

**You should write your link URLs in one of these four forms.** The resolver tries them in this order of stability; the first that matches wins.

### 1. Document UUID (preferred when you have one)

```markdown
[Opportunity Index](c937b70f-77af-43d3-b9bc-9f31e0d2041d)
```

The most stable and unambiguous form. Survives title changes. Never collides with another document. No spaces, no encoding gotchas. **If you have the target document's ID from a prior `cerefox_search` or `cerefox_ingest` response, use this.**

### 2. Repository-relative path (for docs originally ingested from a file)

```markdown
[Quickstart](docs/guides/quickstart.md)
```

Works when the target document has a `source_path` ending in that suffix — i.e. it was ingested from a file at that location, via `cerefox ingest` or `sync_docs.py`. Same link works on disk and on GitHub, so this is the right form for repo documentation.

### 3. Filename only (laxer fallback for paths)

```markdown
[Quickstart](quickstart.md)
```

Matches any document whose `source_path` ends with `/quickstart.md`. If multiple documents share that basename, the web UI shows a chooser. Use form 2 (with directory) when you want precision.

### 4. Title (for documents created via ingest / paste, no source_path)

For documents that were paste-ingested or agent-created, there is no `source_path` to match. The resolver falls back to a case-insensitive substring match against document titles.

**Spaces in URLs require escaping** — this is a standard-markdown requirement, not a Cerefox quirk:

| Form | Renders as link? |
|---|---|
| `[Career Coach](<Career Coach - Lisa Nichols>)` | ✓ Angle-bracket form — recommended for titles with spaces |
| `[Career Coach](Career%20Coach%20-%20Lisa%20Nichols)` | ✓ URL-encoded — also valid, less readable in source |
| `[Career Coach](Career Coach - Lisa Nichols)` | ✗ **Bare spaces break the markdown parser** — renders as plain text, not a link |

The resolver receives the decoded form either way, so both valid forms above produce the same lookup.

### Always set explicit link text

The `[Link Text](target)` syntax has two halves — both matter:

- **The link text** (`[…]`) is what the human reader sees. Use the actual title or a meaningful phrase.
- **The target** (`(…)`) is what the resolver consumes. Use a UUID for stability or a path/title for readability.

Bad: `[c937b70f-77af-...](c937b70f-77af-...)` — opaque to the reader.
Good: `[Job Hunting - Opportunity Index](c937b70f-77af-43d3-b9bc-9f31e0d2041d)`.

### What you don't need to do

- **You don't need to escape `#` anchors.** `[Section](setup.md#configuration)` works — the resolver splits the anchor off and reattaches it to the target document URL.
- **You don't need to handle external URLs.** Links starting with `http://`, `https://`, `mailto:`, etc. pass through unchanged and open in a new tab.
- **You don't need to handle absolute SPA paths.** Links starting with `/` (e.g. `/search?q=foo`) pass through to the SPA router unchanged.
- **You don't need to create relation rows** for these links. The resolver does not populate the relation graph at this stage — that's a separate, future feature (see Iteration 18 design). If you want explicit relations between documents, use `cerefox_set_relation` when it ships.

### A note on agents on Path C (CLI via Bash tool)

If you're using Cerefox via the local CLI (Path C from `connect-agents.md`), the same writing conventions apply. The web UI is where the resolution actually happens; the CLI is just how you wrote the content. A user reading your ingested document later in the web UI gets the clickable behaviour for free, as long as you authored the links in one of the four forms above.

---

## Governance

- **Review status**: agent writes set `pending_review`; human edits set `approved`. Both are searchable.
- **Soft delete**: deleted documents go to trash (recoverable). They are excluded from search. You can soft-delete via MCP (`cerefox_delete_document` if your client exposes it) or CLI (`cerefox delete-doc --yes --author <you> --author-type agent`).
- **Permanent purge and restore-from-trash are web-UI-only**, by design. If you decide to delete something, **tell the user explicitly** that you soft-deleted it and that they can review or restore it via the Cerefox web UI. You cannot un-do your own soft-delete from agent code; only the human can. See [`docs/guides/access-paths.md` → Destructive operations and the trust model](docs/guides/access-paths.md#destructive-operations-and-the-trust-model).
- **Versioning**: every update via `update_if_exists` creates an archived version. Old content is always recoverable.
- **Audit log**: all write operations are recorded with author, timestamp, and size changes.

This is a human-on-the-loop model: agents write and soft-delete freely with full audit attribution; humans review the trash, restore mistakes, and decide when to purge.

---

## Using Cerefox via the CLI

Read this section only if you do **not** have MCP tools available (no `cerefox_search` in your tool list) and your user has pointed you at a local Cerefox checkout. The semantics of every operation are identical to MCP — only the calling surface differs. The conventions above (when to search, when to ingest, metadata rules, ID-based update workflow, governance) all still apply.

### Setup

Your user will have told you where their Cerefox checkout lives (commonly `/Users/<name>/src/cerefox`, but check `CLAUDE.md` / `AGENTS.md` / project memory for the exact path). Run every command from that directory, or use `cd /path/to/cerefox && uv run cerefox …` in your Bash tool call.

If a command fails with `command not found: cerefox`, run it as `uv run cerefox <subcommand>` (the project's `uv` environment provides the binary).

> Full per-flag reference lives in [`docs/guides/cli.md`](docs/guides/cli.md). The mapping table below is the agent-facing summary. **CLI flag names match MCP parameter names exactly** (kebab-case); short forms like `--project`, `--filter`, `--count`, `--update`, `--version` are accepted as aliases.

### MCP tool ↔ CLI command mapping

| MCP tool | CLI command |
|---|---|
| `cerefox_search(query, match_count, project_name, metadata_filter, requestor)` | `uv run cerefox search "<query>" --match-count N --project-name <n> --metadata-filter '<json>' --requestor <name>` (also `--mode`, `--alpha`, `--min-score` — CLI-only) |
| `cerefox_ingest(title, content, project_name, metadata, update_if_exists, document_id, source, author, author_type)` (file) | `uv run cerefox ingest <path> --title <t> --project-name <n> --metadata '<json>' --update-if-exists\|--document-id <uuid> --source <s> --author <a> --author-type user\|agent` |
| `cerefox_ingest(...)` (paste) | `printf '%s' "<content>" \| uv run cerefox ingest --paste --title "<title>"` (same flags) |
| `cerefox_get_document(document_id, version_id, requestor)` | `uv run cerefox get-doc <document-id> --version-id <vid> --requestor <name>` |
| `cerefox_list_versions(document_id, requestor)` | `uv run cerefox list-versions <document-id> --requestor <name>` |
| `cerefox_list_projects(requestor)` | `uv run cerefox list-projects --requestor <name>` |
| `cerefox_list_metadata_keys()` | `uv run cerefox list-metadata-keys` |
| `cerefox_metadata_search(metadata_filter, project_name, updated_since, created_since, limit, include_content, requestor)` | `uv run cerefox metadata-search --metadata-filter '<json>' --project-name <n> --updated-since <iso> --created-since <iso> --limit N --include-content --requestor <name>` |
| `cerefox_get_audit_log(document_id, author, operation, since, until, limit, requestor)` | `uv run cerefox get-audit-log --document-id <id> --author <a> --operation <op> --since <iso> --until <iso> --limit N --json --requestor <name>` |

### Caller-identity flags (set these the same way you would on MCP)

You **MUST** identify yourself on every CLI invocation, exactly as you do via MCP:

- **Writes** (`ingest`, `ingest-dir`): set `--author "<your-agent-name>" --author-type "agent"`. The `author_type=agent` value auto-routes the write to `pending_review` (governance signal), matching the MCP path.
- **Reads** (`search`, `get-doc`, `list-versions`, `list-projects`, `metadata-search`, `get-audit-log`): set `--requestor "<your-agent-name>"`.

Alternative: have your user set `CEREFOX_AUTHOR_NAME`, `CEREFOX_AUTHOR_TYPE`, `CEREFOX_REQUESTOR_NAME` in their `.env` once. The CLI picks them up automatically — see [`docs/guides/cli.md`](docs/guides/cli.md) for the precedence rules.

### Behavioural differences worth knowing

1. **CLI output is human-formatted by default.** `cerefox search` returns a numbered, indented text block with title, score, and a 300-char preview per result. To extract document IDs reliably, parse the `Doc: <title>  (<source>)` lines or fall back to `cerefox list-docs` for a clean tabular listing. `cerefox get-doc <id>` prints raw Markdown to stdout. **For scripted access to audit data**, use `cerefox get-audit-log --json` — one JSON object per line, ideal for piping to `jq`.

2. **Every invocation is independent.** With MCP, your tool framework can pass `requestor` once per session. With the CLI, every command is a separate process — pass `--requestor` / `--author` / `--author-type` on every relevant invocation, or set the env-var defaults once at the start.

3. **Errors come back on stderr with a non-zero exit code.** Check both — a successful command prints results on stdout and exits 0; a failure prints to stderr and exits non-zero.

### Quick patterns

**Search before answering:**
```bash
uv run cerefox search "OAuth design notes" --match-count 5 --requestor "claude-code"
```

**Search then read full content of a hit:**
```bash
uv run cerefox search "OAuth design" --match-count 3 --requestor "claude-code"
# Note the [n] entries. Pick one and grab the doc id from `list-docs` or the result preview.
uv run cerefox get-doc <document-id> --requestor "claude-code"
```

**Ingest a note (agent identity):**
```bash
printf '# Title\n\nBody markdown with H2s for chunking.\n' \
  | uv run cerefox ingest --paste \
      --title "Stable Title" \
      --project-name "Cerefox" \
      --metadata '{"type":"decision-log","status":"active"}' \
      --author "claude-code" --author-type "agent"
```

**ID-based update (preferred — deterministic):**
```bash
# Step 1: search and note the [id: abc12345-...] in the result
uv run cerefox search "the exact doc" --match-count 1 --requestor "claude-code"

# Step 2: update by ID
printf '...new content...' \
  | uv run cerefox ingest --paste \
      --title "Exact Same Title" \
      --document-id "abc12345-..." \
      --author "claude-code" --author-type "agent"
```

**Title-based update (fallback when ID isn't available):**
```bash
printf '...new content...' \
  | uv run cerefox ingest --paste --title "Exact Same Title" --update-if-exists \
      --author "claude-code" --author-type "agent"
```

**Audit-log access (scripted, JSON):**
```bash
uv run cerefox get-audit-log --json --limit 1000 --requestor "claude-code" \
  | jq 'select(.author_type == "agent")'
```
