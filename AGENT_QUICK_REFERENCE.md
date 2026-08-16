# Cerefox Knowledge Base -- Agent Quick Reference

Cerefox is a persistent, shared knowledge base. You have **15 core MCP tools** (14 with CLI equivalents — `cerefox_get_help` is MCP-only), plus 4 dormant relation tools that appear only when `relations_enabled` is on. For the full guide, search Cerefox for "How AI Agents Use Cerefox" or call `cerefox_get_help` to retrieve this content over MCP.

## Tools

| Tool | Purpose | Key params |
|------|---------|------------|
| `cerefox_search` | Find documents (hybrid FTS + semantic) | `query` (required), `project_name`, `metadata_filter`, `requestor` |
| `cerefox_ingest` | Save or update a document | `title`, `content` (required), `document_id` (update by ID), `expected_content_hash` (**required on content updates** — see rule 9), `last_write_wins`, `update_if_exists`, `project_name` (single, non-destructive add on update), `project_names` (list, destructive replace on update), `metadata` (omit on update to keep existing tags; `{}` clears), `author` |
| `cerefox_insert` | **Add** to a document without resending it. Cannot destroy content. | `document_id`, `text`, `position` (`end_of_document`/`end_of_section`/`after_heading`/`before_heading`), `expected_content_hash` (required), `anchor_heading` (unless `end_of_document`), `section_part` |
| `cerefox_edit` | **Change** parts of a document: 1..n operations applied atomically | `document_id`, `operations` (`insert`/`replace_section`/`delete_section`/`rename_section`), `expected_content_hash` (required) |
| `cerefox_delete_document` | **Soft**-delete a document (to trash; excluded from search; permanent purge is human-only) | `document_id`, `expected_content_hash` (**required** — a delete must follow a read), `reason` (recorded in the audit log — give one), `author` |
| `cerefox_restore_document` | Restore a soft-deleted document from the trash (audited inverse of delete; no-op if not deleted) | `document_id` (required), `reason` (recorded in the audit log), `author` |
| `cerefox_get_document` | Get full document by ID (header includes `content_hash` — the update token), or with `outline: true` just its heading paths, sizes and hash, or with `section: "## Heading"` one section's text | `document_id` (required), `outline`, `section`, `section_part` |
| `cerefox_list_versions` | Version history of a document | `document_id` (required) |
| `cerefox_set_relation` ⚑ | Link two documents (`source --rel_type--> target`) | `source_id`, `target_id`, `rel_type` (required), `metadata`, `author` |
| `cerefox_delete_relation` ⚑ | Remove a relation | `source_id`, `target_id`, `rel_type` |
| `cerefox_get_relations` ⚑ | All relations touching a document, both directions | `document_id` |
| `cerefox_get_neighbors` ⚑ | Walk the graph along ONE relation type | `document_id`, `rel_type` (required), `depth`, `from_time`, `to_time`, `limit` |
| `cerefox_metadata_search` | Find or list docs by metadata, project, or time (no text query) | `metadata_filter`, `project_name` (list a project's docs), `updated_since`, `include_content` — **at least one** of metadata_filter/project_name/updated_since/created_since |
| `cerefox_list_metadata_keys` | Discover available metadata keys | (none required) |
| `cerefox_list_projects` | List all projects | (none required) |
| `cerefox_set_document_metadata` | Change tags WITHOUT resending content. **Merges** by default; a `null` value removes a key | `document_id`, `metadata` (required), `replace` (rare: set exactly this object), `author` |
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
3. **Look before you overwrite** — `cerefox_get_document(document_id,
   section: "## Heading")` returns exactly the text a `replace_section` on that
   anchor would destroy. The outline gives you a section's *size*, never its
   *text*, so on a document you did not write yourself this is the difference
   between a replace and a blind overwrite.
4. **Change or remove** → `cerefox_edit`. Put changes that belong together in
   ONE call: they apply atomically, so a table row and the total it feeds cannot
   end up disagreeing. To change a single line, `replace_section` on its
   smallest enclosing heading — that is the intended granularity, not a
   workaround. To fix a stale heading (`## OPEN TODOs (as of ...)`), use
   `rename_section`: it changes the heading text and leaves the body and
   position alone.
5. All of them require `expected_content_hash` and **have no last-write-wins**. A
   conflict means someone else changed the document; re-read and decide, do not
   force it.

**A section runs to the next same-or-higher heading, or to the end of the
document.** So `end_of_document` inserts land inside the *last* section, and
replacing or deleting that section removes them too. A large shrink in the
response is your warning; `cerefox_list_versions` has the previous content.

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
7. **Deletes are soft (recoverable); permanent purge is web-UI-only.** `cerefox_delete_document` requires the document's `content_hash` as you read it (read before you delete) and takes a `reason` — give one; it is what the human reviewing the trash sees. `cerefox_restore_document` undoes a mistaken delete (also audited, also takes a `reason`). Always surface deletes AND restores to the user. Once a human purges from the web UI, the document is gone for good.
8. **Cross-doc links inside content**: **always use `[Text](document-uuid)`.** UUIDs are the only fully reliable link form — stable across title changes, never ambiguous, no encoding gotchas. Every `cerefox_search` result shows `[id: <uuid>]` after the title; grab it and use it. Title-based linking (`[Text](<Title With Spaces>)`) is fragile (breaks on colons, parens, ampersands, brackets — silently navigates to wrong page) — **don't write title-based links**; do an extra search to get the UUID instead. Repo-path forms (`[Text](docs/path.md)`) exist for repo-ingested files; don't construct manually. **The server validates `](uuid)` links on every write** (v1.7.0): a link to a nonexistent id rejects the write, naming the offender — that means you mangled the UUID; re-read the source and correct it, do not retry unchanged. Example ids go in backticks (code is not validated). `[[Wikilinks]]` may dangle. See `AGENT_GUIDE.md → Writing linkable content` for the full rule.
9. **Concurrency: content updates require `expected_content_hash`.** Pass the `content_hash` you last saw — every read shows one (`cerefox_get_document` incl. outline mode, `cerefox_search`, `cerefox_metadata_search`) and **every write returns the new one, including create** (v1.3.0, #189), so after writing you already hold the token for your next edit; no re-read needed. If it's stale you get a **conflict** — re-read the document, merge your changes into the latest content, retry with the new hash. **Never resolve a conflict by overwriting blindly** — the current content includes another writer's work. `last_write_wins: true` skips the check; use it ONLY when an external source of truth makes conflicts meaningless (file re-sync), never to silence a conflict.
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
| `cerefox_insert` | `cerefox document insert <id> -t "<text>" -p <position> -a "<anchor-heading>" -e "<hash>" --requestor "<your-name>" --author-type agent` |
| `cerefox_edit` | `cerefox document edit-parts <id> --operations '<json>' -e "<hash>" --requestor "<your-name>" --author-type agent` |
| `cerefox_delete_document` | `cerefox document delete <id> --reason "<why>" --author "<your-name>" --author-type agent --yes` (confirms interactively instead of requiring the hash) |
| `cerefox_restore_document` | `cerefox document restore <id> --reason "<why>" --author "<your-name>" --author-type agent` |
| `cerefox_metadata_search` | `cerefox metadata search --metadata-filter '<json>' --requestor "<your-name>"` (list a project: `cerefox document list --project <name>`) |
| `cerefox_set_document_metadata` | `cerefox document set-metadata <id> --set key=value` (also `--remove key`, `--json '{...}'`, `--replace`) |
| `cerefox_set_document_projects` | `cerefox document set-projects <id> <name...> --author "<your-name>" --author-type agent` (or `--clear` to remove all) |
| `cerefox_get_audit_log` | `cerefox audit list --requestor "<your-name>"` (add `--json` for scripted access) |
| `cerefox_get_help` | `cerefox guides show agent-quick-reference` (or `cerefox guides list` for the full bundled-docs index) |

**Set identity on every call**, exactly as you would on MCP:
- Writes (`document ingest`, `document ingest-dir`): `--author "<your-name>" --author-type agent`
- Reads: `--requestor "<your-name>"`

Or have your user set `CEREFOX_AUTHOR_NAME` / `CEREFOX_AUTHOR_TYPE` / `CEREFOX_REQUESTOR_NAME` in their `.env` to apply defaults once.

## Timestamps are UTC

Every timestamp Cerefox returns — `created_at` on audit entries, version
history, document metadata — is **UTC**, and now carries its `Z` marker so it
cannot be mistaken for local time.

**When you write a date into a document's CONTENT, use your own clock, not a
Cerefox timestamp.** These are different things: a timestamp records when the
server stored something; a date in a log entry or a heading is authored content
and belongs to your timezone. An agent working a Pacific afternoon read
`2026-08-11` from version history, wrote "8/11" into its entries, and put a
day's work in the future — the timestamp was correct, and copying it into
content was not.

Cerefox deliberately does not convert to local time on the API or MCP paths.
"Local" has no server-side meaning: the remote MCP server runs in a cloud
function whose local time *is* UTC, while a local MCP server runs in yours, so
the same document would report two different times depending on transport. The
web UI converts because a browser knows the viewer's timezone; nothing
server-side does.

## Mistakes that have actually happened

Each of these comes from a real agent session, and each is easy to make.

- **`cerefox_ingest` always replaces the ENTIRE document.** Never a section.
  Before sending, check that the tool name matches the intent: if the intent is
  "change one section", the call is `cerefox_edit` with `replace_section`. A
  section-sized edit sent as a full ingest truncated a 13,000-character index to
  a single word. It was recovered from version history within the minute, but
  only because it was noticed immediately.

- **Do not include the anchor's own heading in your text.** `replace_section`
  keeps the heading and `insert` places your text inside the section, so
  including it produces two. This is now refused rather than silently applied,
  but the shape is worth knowing: it happened twice in one session, the second
  time while trying to repair the first. A *deeper* sub-heading inside your text
  is fine.

- **Content between sections belongs to the section ABOVE it.** A section runs
  to the next heading of the same or higher level, so a `---` rule, a note, or
  any trailing text sitting just above the next heading is part of the section
  before it — even when it visually reads as belonging below. Replacing that
  section takes it too. An agent hit exactly this: a `---` that separated two
  major sections disappeared when the section above it was replaced. The write
  was correct by the addressing rules; the surprise is that "the end of this
  section" is further down the page than it looks. Note the loss warning will
  not catch it if your replacement text is longer than what it replaced, since
  there is then no net loss to report.

- **To change only tags, use `cerefox_set_document_metadata`, never `cerefox_ingest`.**
  Ingest replaces the whole document, so re-sending it to set one tag carries the
  full transcription risk for no reason. The metadata tool merges: the keys you
  pass are set, everything else is left alone, so you do not need to read the
  document first and cannot drop a tag another agent set. Pass `null` as a value
  to remove a key.

- **Never partial-edit to fix a partial edit.** If a write leaves unexpected
  structure, stop. Use `cerefox_list_versions`, retrieve the last good version,
  and re-ingest cleanly. Repairing edits with more edits compounds the damage.

- **A rejected batch is safe.** Operations in one `cerefox_edit` are
  all-or-nothing: if any is invalid, nothing is written. A refusal costs you a
  retry, not data — so prefer one call for changes that belong together, and do
  not split a batch to "make it more likely to succeed".

- **Read before replacing.** `cerefox_get_document(section: "## Heading")`
  returns exactly what a `replace_section` on that anchor would overwrite. Use it
  for any section you did not write in this session. The outline gives a
  section's *size*, never its *text*.

- **Verify after writing** — read the result back before reporting success, and
  report what the read actually shows.

- **Partial edits cannot change a document's stored TITLE.** `rename_section`
  changes a heading inside the content; the title is a separate field and still
  needs `cerefox_ingest`.

- **If a capability seems missing from one server, suspect your client first.**
  Local and remote run the same code. **Every `cerefox_get_help()` response
  begins with the server's version and the operations it registers** — you do
  not need a special topic, and the *absence* of that block is itself an answer:
  a server that does not print it predates v1.5.0. If that
  disagrees with your tool list, the client is holding a list it fetched before
  an upgrade — clients cache it at connect time. Ask the user to restart the
  client. Do not record a capability difference between servers as a fact; every
  such report so far has been a stale client.
