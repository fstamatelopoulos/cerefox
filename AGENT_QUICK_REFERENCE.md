# Cerefox Knowledge Base -- Agent Quick Reference

Cerefox is a persistent, shared knowledge base. You have **14 MCP tools** (13 of them have CLI equivalents — `cerefox_get_help` is MCP-only). For the full guide, search Cerefox for "How AI Agents Use Cerefox" or call `cerefox_get_help` to retrieve this content over MCP.

## Tools

| Tool | Purpose | Key params |
|------|---------|------------|
| `cerefox_search` | Find documents (hybrid FTS + semantic) | `query` (required), `project_name`, `metadata_filter`, `requestor` |
| `cerefox_ingest` | Save or update a document | `title`, `content` (required), `document_id` (update by ID), `expected_content_hash` (**required on content updates** — see rule 9), `last_write_wins`, `update_if_exists`, `project_name` (single, non-destructive add on update), `project_names` (list, destructive replace on update), `metadata` (omit on update to keep existing tags; `{}` clears), `author` |
| `cerefox_insert` | **Add** to a document without resending it. Cannot destroy content. | `document_id`, `text`, `position` (`end_of_document`/`end_of_section`/`after_heading`/`before_heading`), `expected_content_hash` (required), `anchor_heading` (unless `end_of_document`), `section_part` |
| `cerefox_edit` | **Change** parts of a document: 1..n operations applied atomically | `document_id`, `operations` (`insert`/`replace_section`/`delete_section`), `expected_content_hash` (required) |
| `cerefox_get_document` | Get full document by ID (header includes `content_hash` — the update token), or with `outline: true` just its heading paths, sizes and hash | `document_id` (required), `outline` |
| `cerefox_list_versions` | Version history of a document | `document_id` (required) |
| `cerefox_set_relation` ⚑ | Link two documents (`source --rel_type--> target`) | `source_id`, `target_id`, `rel_type` (required), `metadata`, `author` |
| `cerefox_delete_relation` ⚑ | Remove a relation | `source_id`, `target_id`, `rel_type` |
| `cerefox_get_relations` ⚑ | All relations touching a document, both directions | `document_id` |
| `cerefox_get_neighbors` ⚑ | Walk the graph along ONE relation type | `document_id`, `rel_type` (required), `depth`, `from_time`, `to_time`, `limit` |
| `cerefox_metadata_search` | Find or list docs by metadata, project, or time (no text query) | `metadata_filter`, `project_name` (list a project's docs), `updated_since`, `include_content` — **at least one** of metadata_filter/project_name/updated_since/created_since |
| `cerefox_list_metadata_keys` | Discover available metadata keys | (none required) |
| `cerefox_list_projects` | List all projects | (none required) |
| `cerefox_set_document_projects` | Set doc's project memberships to exactly the given list (destructive replace; metadata-only, no content change) | `document_id`, `project_names` (required) |
| `cerefox_get_audit_log` | Query write operation history | `document_id`, `author`, `operation`, `since` |
| `cerefox_get_help` | Retrieve Cerefox conventions (this reference) over MCP. **Call this whenever uncertain.** | `topic` (optional, case-insensitive H2 substring match) |

⚑ **Opt-in — usually absent.** The four relation tools are hidden unless the
operator enables them (`relations_enabled`). **Trust your own tool list**: if
they are not in it, the feature is switched off for this deployment. That is
normal, not an error, and not something to work around.

## Editing part of a document (prefer this over re-sending)

**Re-sending a whole document to change part of it is the main way agents lose
data.** You have to reproduce the untouched remainder verbatim, and any drift
silently rewrites content nobody asked you to touch — which the caller cannot
diff. Use the partial-edit tools instead:

1. **Learn the anchors** — `cerefox_get_document(document_id, outline: true)`.
   Returns heading paths, per-section sizes and the `content_hash`, without the
   body. The paths it returns are exactly what `anchor_heading` accepts.
2. **Add** → `cerefox_insert`. `end_of_document` is a plain append;
   `end_of_section` adds inside a named section. It is structurally incapable of
   removing anything, so "I meant to append" cannot become "I replaced the file".
3. **Change or remove** → `cerefox_edit`. Put changes that belong together in
   ONE call: they apply atomically, so a table row and the total it feeds cannot
   end up disagreeing. To change a single line, `replace_section` on its
   smallest enclosing heading — that is the intended granularity, not a
   workaround.
4. Both require `expected_content_hash` and **have no last-write-wins**. A
   conflict means someone else changed the document; re-read and decide, do not
   force it.

**When an anchor is ambiguous the tool refuses and hands you the options** — a
repeated heading returns the qualifying paths, and a section with both its own
content and sub-sections returns both `section_part` choices. That is a
recoverable answer, not a failure: retry with what it gave you.

## Essential Rules

1. **Search before ingesting** -- check if the document exists first.
2. **Prefer ID-based updates** -- pass `document_id` from search results for deterministic updates. Falls back to title-matching with `update_if_exists: true`.
3. **Set `author`/`requestor`** to your name on every call (e.g., "Claude Code", "archiver"). On MCP, pass as parameters. On CLI, pass `--author`/`--author-type`/`--requestor` flags, or rely on `CEREFOX_AUTHOR_NAME`/`CEREFOX_AUTHOR_TYPE`/`CEREFOX_REQUESTOR_NAME` env vars set in the user's `.env`.
4. **Use `document_id` from search results** `[id: uuid]` for get_document and list_versions.
5. **Add metadata** -- at minimum `type` ("decision-log", "research", "design-doc") and `status` ("active", "draft").
6. **Write structured Markdown** with H1/H2/H3 headings for good chunking and search.
7. **Deletes are soft (recoverable); purge is web-UI-only.** If you decide to delete, surface it to the user (`I soft-deleted X — recoverable from the Cerefox web UI trash`). You cannot un-do your own delete from agent code by design.
8. **Cross-doc links inside content**: **always use `[Text](document-uuid)`.** UUIDs are the only fully reliable link form — stable across title changes, never ambiguous, no encoding gotchas. Every `cerefox_search` result shows `[id: <uuid>]` after the title; grab it and use it. Title-based linking (`[Text](<Title With Spaces>)`) is fragile (breaks on colons, parens, ampersands, brackets — silently navigates to wrong page) — **don't write title-based links**; do an extra search to get the UUID instead. Repo-path forms (`[Text](docs/path.md)`) exist for repo-ingested files; don't construct manually. See `AGENT_GUIDE.md → Writing linkable content` for the full rule.
9. **Concurrency: content updates require `expected_content_hash`.** Pass the `content_hash` you read (shown by `cerefox_get_document`, `cerefox_search`, and `cerefox_metadata_search`) when updating a document. If it's stale you get a **conflict** — re-read the document, merge your changes into the latest content, retry with the new hash. **Never resolve a conflict by overwriting blindly** — the current content includes another writer's work. `last_write_wins: true` skips the check; use it ONLY when an external source of truth makes conflicts meaningless (file re-sync), never to silence a conflict.
10. **Search: prefer a few distinctive terms; heed `below confidence`.** When nothing clears the relevance threshold, `cerefox_search` returns the closest candidates prefixed with a `below confidence` warning instead of an empty set — that flag means **weak signal, not absent knowledge**: check the candidates' scores and titles before concluding the KB lacks the content. A truly empty response means nothing even weakly related exists.
11. **Relations express how documents relate; lifecycle tells you if knowledge is still good.** Use `cerefox_set_relation` when one document supersedes, contradicts, references, or continues another. `supersedes` marks the target **superseded**; `contradicts` marks **both** stale; `related_to`/`duplicates`/`contradicts` are symmetric (both directions written). Any other type string is accepted without special behaviour. When a search result or `cerefox_get_relations` shows a neighbour marked `[superseded]` or `[stale]`, say so rather than presenting it as current.
12. **Project memberships — non-destructive by default**: on `cerefox_ingest` updates, **`project_name` (singular) is a non-destructive add** (ensures membership, preserves others). Use **`project_names` (list)** when you want to set the doc's full project set in one call (destructive replace). For metadata-only project changes without writing content, use **`cerefox_set_document_projects(document_id, project_names)`** — that tool is the destructive-replace contract made explicit. Never call `cerefox_set_document_projects` with a single name when you mean "add" — that would REMOVE the doc from all other projects. When in doubt, use `cerefox_ingest` with singular `project_name`.

## Update Workflow (ID-based -- preferred)

```
search("topic") -> find doc [id: abc123] -> get_document(abc123) -> note its content_hash -> modify ->
ingest(title="Same Title", content="...", document_id="abc123",
       expected_content_hash="<the hash you read>", author="my-agent")
```

On a **conflict** error: get_document again (fresh content + fresh hash) -> merge your changes -> retry with the new hash.

## Update Workflow (title-based -- fallback)

```
search("topic") -> find doc (note its hash) -> modify ->
ingest(title="Same Title", content="...", update_if_exists=true,
       expected_content_hash="<the hash you read>", author="my-agent")
```

## Catch-Up Workflow

```
metadata_search(metadata_filter={"type": "decision-log"}, updated_since="2026-03-28T00:00:00Z")
```

## CLI fallback (when MCP is unavailable)

If `cerefox_search` is not in your tool list, your user has likely installed the Cerefox CLI. The canonical invocation is plain **`cerefox <subcommand>`** (the TypeScript CLI, installed via `npm install -g @cerefox/memory`). It uses a resource-verb shape (`cerefox document get`, `cerefox project list`, …).

Same operations, same conventions. Full reference: [`docs/guides/cli.md`](docs/guides/cli.md). CLI flag names match MCP parameter names exactly (e.g. `metadata_filter` ↔ `--metadata-filter`); common flags also have single-letter short forms (`-f`, `-p`, `-c`, `-m`, `-u`, `-a`, `-r`). Use the canonical long name (what `--help` shows) or its short form — there are no long-form aliases like `--filter` or `--count`.

| MCP tool | CLI |
|---|---|
| `cerefox_search` | `cerefox search "<q>" --requestor "<your-name>"` |
| `cerefox_ingest` (paste) | `printf '...' \| cerefox document ingest --paste --title "<t>" --author "<your-name>" --author-type agent` |
| `cerefox_ingest` (update by ID) | `printf '...' \| cerefox document ingest --paste --title "<t>" --document-id "<uuid>" --expected-content-hash "<hash>" --author "<your-name>" --author-type agent` |
| `cerefox_get_document` | `cerefox document get <id> --version-id <vid> --requestor "<your-name>"` |
| `cerefox_list_versions` | `cerefox document version list <id> --requestor "<your-name>"` |
| `cerefox_list_projects` | `cerefox project list --requestor "<your-name>"` |
| `cerefox_list_metadata_keys` | `cerefox metadata keys` |
| `cerefox_set_relation` ⚑ | Link two documents (`source --rel_type--> target`) | `source_id`, `target_id`, `rel_type` (required), `metadata`, `author` |
| `cerefox_delete_relation` ⚑ | Remove a relation | `source_id`, `target_id`, `rel_type` |
| `cerefox_get_relations` ⚑ | All relations touching a document, both directions | `document_id` |
| `cerefox_get_neighbors` ⚑ | Walk the graph along ONE relation type | `document_id`, `rel_type` (required), `depth`, `from_time`, `to_time`, `limit` |
| `cerefox_metadata_search` | `cerefox metadata search --metadata-filter '<json>' --requestor "<your-name>"` (list a project: `cerefox document list --project <name>`) |
| `cerefox_set_document_projects` | `cerefox document set-projects <id> <name...> --author "<your-name>" --author-type agent` (or `--clear` to remove all) |
| `cerefox_get_audit_log` | `cerefox audit list --requestor "<your-name>"` (add `--json` for scripted access) |
| `cerefox_get_help` | `cerefox guides show agent-quick-reference` (or `cerefox guides list` for the full bundled-docs index) |

**Set identity on every call**, exactly as you would on MCP:
- Writes (`document ingest`, `document ingest-dir`): `--author "<your-name>" --author-type agent`
- Reads: `--requestor "<your-name>"`

Or have your user set `CEREFOX_AUTHOR_NAME` / `CEREFOX_AUTHOR_TYPE` / `CEREFOX_REQUESTOR_NAME` in their `.env` to apply defaults once.
