# Cerefox Knowledge Base -- Agent Quick Reference

Cerefox is a persistent, shared knowledge base. You have 8 MCP tools.
For the full guide, search Cerefox for "How AI Agents Use Cerefox".

## Tools

| Tool | Purpose | Key params |
|------|---------|------------|
| `cerefox_search` | Find documents (hybrid FTS + semantic) | `query` (required), `project_name`, `metadata_filter`, `requestor` |
| `cerefox_ingest` | Save or update a document | `title`, `content` (required), `document_id` (update by ID), `update_if_exists`, `project_name`, `metadata`, `author` |
| `cerefox_get_document` | Get full document by ID | `document_id` (required) |
| `cerefox_list_versions` | Version history of a document | `document_id` (required) |
| `cerefox_metadata_search` | Find docs by metadata (no text query) | `metadata_filter` (required), `include_content`, `updated_since` |
| `cerefox_list_metadata_keys` | Discover available metadata keys | (none required) |
| `cerefox_list_projects` | List all projects | (none required) |
| `cerefox_get_audit_log` | Query write operation history | `document_id`, `author`, `operation`, `since` |

## Essential Rules

1. **Search before ingesting** -- check if the document exists first.
2. **Prefer ID-based updates** -- pass `document_id` from search results for deterministic updates. Falls back to title-matching with `update_if_exists: true`.
3. **Set `author`/`requestor`** to your name on every call (e.g., "Claude Code", "archiver").
4. **Use `document_id` from search results** `[id: uuid]` for get_document and list_versions.
5. **Add metadata** -- at minimum `type` ("decision-log", "research", "design-doc") and `status` ("active", "draft").
6. **Write structured Markdown** with H1/H2/H3 headings for good chunking and search.

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
