# Cerefox Knowledge Base -- Agent Quick Reference

Cerefox is a persistent, shared knowledge base. You have **10 MCP tools** (9 of them have CLI equivalents — `cerefox_get_help` is MCP-only). For the full guide, search Cerefox for "How AI Agents Use Cerefox" or call `cerefox_get_help` to retrieve this content over MCP.

## Tools

| Tool | Purpose | Key params |
|------|---------|------------|
| `cerefox_search` | Find documents (hybrid FTS + semantic) | `query` (required), `project_name`, `metadata_filter`, `requestor` |
| `cerefox_ingest` | Save or update a document | `title`, `content` (required), `document_id` (update by ID), `update_if_exists`, `project_name` (single, non-destructive add on update), `project_names` (list, destructive replace on update), `metadata`, `author` |
| `cerefox_get_document` | Get full document by ID | `document_id` (required) |
| `cerefox_list_versions` | Version history of a document | `document_id` (required) |
| `cerefox_metadata_search` | Find docs by metadata (no text query) | `metadata_filter` (required), `include_content`, `updated_since` |
| `cerefox_list_metadata_keys` | Discover available metadata keys | (none required) |
| `cerefox_list_projects` | List all projects | (none required) |
| `cerefox_set_document_projects` | Set doc's project memberships to exactly the given list (destructive replace; metadata-only, no content change) | `document_id`, `project_names` (required) |
| `cerefox_get_audit_log` | Query write operation history | `document_id`, `author`, `operation`, `since` |
| `cerefox_get_help` | Retrieve Cerefox conventions (this reference) over MCP. **Call this whenever uncertain.** | `topic` (optional, case-insensitive H2 substring match) |

## Essential Rules

1. **Search before ingesting** -- check if the document exists first.
2. **Prefer ID-based updates** -- pass `document_id` from search results for deterministic updates. Falls back to title-matching with `update_if_exists: true`.
3. **Set `author`/`requestor`** to your name on every call (e.g., "Claude Code", "archiver"). On MCP, pass as parameters. On CLI, pass `--author`/`--author-type`/`--requestor` flags, or rely on `CEREFOX_AUTHOR_NAME`/`CEREFOX_AUTHOR_TYPE`/`CEREFOX_REQUESTOR_NAME` env vars set in the user's `.env`.
4. **Use `document_id` from search results** `[id: uuid]` for get_document and list_versions.
5. **Add metadata** -- at minimum `type` ("decision-log", "research", "design-doc") and `status` ("active", "draft").
6. **Write structured Markdown** with H1/H2/H3 headings for good chunking and search.
7. **Deletes are soft (recoverable); purge is web-UI-only.** If you decide to delete, surface it to the user (`I soft-deleted X — recoverable from the Cerefox web UI trash`). You cannot un-do your own delete from agent code by design.
8. **Cross-doc links inside content**: **always use `[Text](document-uuid)`.** UUIDs are the only fully reliable link form — stable across title changes, never ambiguous, no encoding gotchas. Every `cerefox_search` result shows `[id: <uuid>]` after the title; grab it and use it. Title-based linking (`[Text](<Title With Spaces>)`) is fragile (breaks on colons, parens, ampersands, brackets — silently navigates to wrong page) — **don't write title-based links**; do an extra search to get the UUID instead. Repo-path forms (`[Text](docs/path.md)`) exist for repo-ingested files; don't construct manually. See `AGENT_GUIDE.md → Writing linkable content` for the full rule.
9. **Project memberships — non-destructive by default**: on `cerefox_ingest` updates, **`project_name` (singular) is a non-destructive add** (ensures membership, preserves others). Use **`project_names` (list)** when you want to set the doc's full project set in one call (destructive replace). For metadata-only project changes without writing content, use **`cerefox_set_document_projects(document_id, project_names)`** — that tool is the destructive-replace contract made explicit. Never call `cerefox_set_document_projects` with a single name when you mean "add" — that would REMOVE the doc from all other projects. When in doubt, use `cerefox_ingest` with singular `project_name`.

## Update Workflow (ID-based -- preferred)

```
search("topic") -> find doc [id: abc123] -> get_document(abc123) -> modify ->
ingest(title="Same Title", content="...", document_id="abc123", author="my-agent")
```

## Update Workflow (title-based -- fallback)

```
search("topic") -> find doc -> modify ->
ingest(title="Same Title", content="...", update_if_exists=true, author="my-agent")
```

## Catch-Up Workflow

```
metadata_search(metadata_filter={"type": "decision-log"}, updated_since="2026-03-28T00:00:00Z")
```

## CLI fallback (when MCP is unavailable)

If `cerefox_search` is not in your tool list, your user has likely installed the Cerefox CLI. The canonical invocation is plain **`cerefox <subcommand>`** (the TypeScript CLI, installed via `npm install -g @cerefox/memory`). It uses a resource-verb shape (`cerefox document get`, `cerefox project list`, …). The legacy Python `uv run cerefox` is now a frozen husk as of v0.9 — only `uv run cerefox mcp` still works.

Same operations, same conventions. Full reference: [`docs/guides/cli.md`](docs/guides/cli.md). CLI flag names match MCP parameter names exactly (e.g. `metadata_filter` ↔ `--metadata-filter`); common flags also have single-letter short forms (`-f`, `-p`, `-c`, `-m`, `-u`, `-a`, `-r`). Use the canonical long name (what `--help` shows) or its short form — there are no long-form aliases like `--filter` or `--count`.

| MCP tool | CLI |
|---|---|
| `cerefox_search` | `cerefox search "<q>" --requestor "<your-name>"` |
| `cerefox_ingest` (paste) | `printf '...' \| cerefox document ingest --paste --title "<t>" --author "<your-name>" --author-type agent` |
| `cerefox_ingest` (update by ID) | `printf '...' \| cerefox document ingest --paste --title "<t>" --document-id "<uuid>" --author "<your-name>" --author-type agent` |
| `cerefox_get_document` | `cerefox document get <id> --version-id <vid> --requestor "<your-name>"` |
| `cerefox_list_versions` | `cerefox document version list <id> --requestor "<your-name>"` |
| `cerefox_list_projects` | `cerefox project list --requestor "<your-name>"` |
| `cerefox_list_metadata_keys` | `cerefox metadata keys` |
| `cerefox_metadata_search` | `cerefox metadata search --metadata-filter '<json>' --requestor "<your-name>"` |
| `cerefox_set_document_projects` | _MCP-only; a CLI command will be added in a future release. Until then, run via MCP if available._ |
| `cerefox_get_audit_log` | `cerefox audit list --requestor "<your-name>"` (add `--json` for scripted access) |
| `cerefox_get_help` | `cerefox guides show agent-quick-reference` (or `cerefox guides list` for the full bundled-docs index) |

**Set identity on every call**, exactly as you would on MCP:
- Writes (`document ingest`, `document ingest-dir`): `--author "<your-name>" --author-type agent`
- Reads: `--requestor "<your-name>"`

Or have your user set `CEREFOX_AUTHOR_NAME` / `CEREFOX_AUTHOR_TYPE` / `CEREFOX_REQUESTOR_NAME` in their `.env` to apply defaults once.
