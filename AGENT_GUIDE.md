# How AI Agents Use Cerefox

Reference guide for AI agents interacting with the Cerefox knowledge base via MCP tools.
Read this before your first interaction. For a minimal quick reference, see `AGENT_QUICK_REFERENCE.md`.

---

## What Cerefox Is

Cerefox is a persistent, shared knowledge base that multiple AI agents can read and write.
Knowledge written by one agent (or a human) is immediately searchable by any other agent.
It is not a message bus -- it is curated, versioned, searchable memory backed by Postgres + pgvector.

You interact with Cerefox through 8 MCP tools described below.

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
| `update_if_exists` | No | When `true`, updates the document with the same title (versions the old content). Default `false`. |
| `project_name` | No | Assign to a project (created automatically if it doesn't exist). |
| `metadata` | No | Arbitrary JSON. Use at minimum: `type` and `status`. |
| `author` | No | Your agent name for audit attribution. Always set this. |
| `source` | No | Origin label (default "agent"). |

**The update workflow (critical)**:
1. Search for the document first.
2. Call `cerefox_ingest` with the **exact same title** and `update_if_exists: true`.
3. The old content is automatically versioned and recoverable.
4. If you use a different title, a **new** document is created (the old one remains). This is almost never what you want when revising.

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

### Search then act

```
1. cerefox_search("topic")           -- find relevant docs, note [id: uuid]
2. cerefox_get_document(id)          -- get full text if partial
3. cerefox_ingest(title, content,    -- update with same title
     update_if_exists=true)
```

### Save new knowledge

```
1. cerefox_search("topic")           -- check if it already exists
2. If not found: cerefox_ingest(title, content, project_name, metadata)
3. If found: cerefox_ingest(same_title, new_content, update_if_exists=true)
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
2. **Use `update_if_exists: true` with the exact same title** to update. Different title = new document.
3. **Always set `author`/`requestor`** to your agent name for attribution.
4. **Use the `document_id` from search results** for `cerefox_get_document` and `cerefox_list_versions`.
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

## Governance

- **Review status**: agent writes set `pending_review`; human edits set `approved`. Both are searchable.
- **Soft delete**: deleted documents go to trash (recoverable). They are excluded from search.
- **Versioning**: every update via `update_if_exists` creates an archived version. Old content is always recoverable.
- **Audit log**: all write operations are recorded with author, timestamp, and size changes.

This is a human-on-the-loop model: agents write freely, humans monitor and correct.
