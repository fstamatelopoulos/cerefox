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

1. **MCP tools (default)** — 12 named tools (`cerefox_search`, `cerefox_ingest`, …, `cerefox_get_help`) exposed by either a local MCP server (`@cerefox/memory` via npm, run as `cerefox mcp`) or the remote `cerefox-mcp` Edge Function. Tool names and parameters are documented in **The 12 Tools** below. This is the recommended path for purpose-built agent clients.
2. **Shell CLI (Bash tool)** — the same operations exposed as a local `cerefox …` command (the TypeScript CLI from `@cerefox/memory`, resource-verb shape — e.g. `cerefox document get`, `cerefox project list`), invoked via your Bash tool. Used when your user prefers not to install/configure an MCP server. The semantics are identical; only the surface differs. See **Using Cerefox via the CLI** near the bottom of this guide for the MCP-tool → CLI-command mapping and the small list of behavioural differences.

If you're not sure which mode you're in: check whether `cerefox_search` shows up in your tool list. If yes, use MCP. If no, ask your user where the Cerefox checkout lives — they'll have told you, typically in `CLAUDE.md`, `AGENTS.md`, or an equivalent project memory file.

The rest of this guide is written around the MCP tool names, since those are stable across both modes. The CLI section maps each tool name to its CLI command.

### Self-help via MCP

If you have MCP access and you're uncertain about any convention in this guide, call **`cerefox_get_help`** — it returns the contents of `AGENT_QUICK_REFERENCE.md` (the same conventions, rules, and workflow snippets) as MCP-native text, no file-system reads required.

- No arguments → full reference + an index of `## H2` topics.
- `topic: "tools"` (or any case-insensitive H2 substring) → just that section.
- `topic: "made-up-name"` → an "unknown topic" message plus the available-topics list.

The tool is intentionally MCP-only so an agent that has been dropped into Cerefox without filesystem access (e.g. a remote MCP client) can still bootstrap its own conventions. Treat it as a fallback: this guide and `AGENT_QUICK_REFERENCE.md` are the canonical surface; `cerefox_get_help` is the in-band escape hatch.

---

## The 12 Tools

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
| `expected_content_hash` | **Yes, on content updates** | Optimistic-concurrency token: the `content_hash` of the version you based your edit on. **Every read AND every write returns one** — `cerefox_get_document` (including outline mode), `cerefox_search`, `cerefox_metadata_search`, and since v1.3.0 `cerefox_ingest` itself, *including on create* (#189). A document is born holding its token, so you never need to re-read something you just wrote. Stale → **conflict error** (re-read, merge, retry). Absent → **token-required error**. Not needed *as input* when creating. See "Concurrent writers" below. |
| `last_write_wins` | No | Explicitly skip the concurrency check (default `false`). Use ONLY when an external source of truth makes conflicts meaningless (file re-sync). Recorded in the audit log. **Never use it to silence a conflict.** |
| `project_name` | No | **Single** project name (created if absent). On update: **non-destructive add** — ensures this membership exists, preserves others. See "Project membership semantics" below. |
| `project_names` | No | **List** of project names (each created if absent). On update: **destructive replace** — sets the document's full project set to exactly this list. Use when you want to set multiple projects at once, or deliberately change the membership list. Wins over `project_name` when both are passed. |
| `metadata` | No | Arbitrary JSON. Use at minimum: `type` and `status`. **On update, omitting this keeps the document's existing metadata** (v0.11.1); pass `{}` to deliberately clear all tags. |
| `author` | No | Your agent name for audit attribution. Always set this. |
| `source` | No | Origin label (default "agent"). |

**The update workflow (preferred -- ID-based)**:
1. Search for the document. Note the `[id: abc123]` in the result.
2. `cerefox_get_document("abc123")` — read the current content and note its `content_hash`.
3. Call `cerefox_ingest` with `document_id: "abc123"`, the new content, and `expected_content_hash: "<the hash you read>"`.
4. The old content is automatically versioned and recoverable.

**The update workflow (fallback -- title-based)**:
1. Search for the document first (note its hash).
2. Call `cerefox_ingest` with the **exact same title**, `update_if_exists: true`, and `expected_content_hash`.
3. If you use a different title, a **new** document is created (the old one remains). This is almost never what you want when revising.

**Deduplication**: Content is SHA-256 hashed. Identical content is skipped (no re-indexing, no concurrency check needed — identical content cannot lose data). Metadata-only changes update metadata without creating a version.

#### Concurrent writers (optimistic concurrency)

Cerefox is **shared** memory — another agent (or the user) may update a document between your read and your write. Content updates therefore require proof of freshness: `expected_content_hash` must equal the document's current `content_hash` at write time, checked atomically inside the database.

- **Conflict error** ("document changed since it was read"): the document moved underneath you. `cerefox_get_document` again → **merge your changes into the latest content** → retry with the new hash. Never resolve a conflict by overwriting blindly — the current content includes another writer's work.
- **Token-required error**: you attempted a content update without `expected_content_hash`. Read the document first; if you already did, pass the hash you read.
- `last_write_wins: true` bypasses the check — reserved for re-sync flows where an external source of truth (e.g., files on disk) makes conflicts meaningless. It is recorded in the audit log.

**What to ingest**: Distilled summaries, decisions with rationale, curated insights. Not raw dumps, logs, or transcripts. Use Markdown headings for structure.

#### Project membership semantics

This is subtle but important — a document can belong to multiple projects (many-to-many), and an operator may have curated the project list via the web UI. **You must not silently strip their work when updating content.** The rules:

| What you pass on update | What happens to memberships |
|---|---|
| `project_name: "X"` (singular) | **Non-destructive add.** Ensures the doc is in project X. Other memberships untouched. |
| `project_names: ["X", "Y"]` (list) | **Destructive replace.** Sets the doc's project set to exactly `{X, Y}`. Other memberships are removed. Use when you want this. |
| Neither | **No change** to project memberships. |

**Rule of thumb**: if you just want to ensure a doc is *associated with* a project, use singular `project_name`. If you want to *change* the project list, use `project_names`. If you don't know — use singular. When in doubt, use the dedicated `cerefox_set_document_projects` tool, which makes the destructive replace intent explicit and doesn't require also writing content.

---

### cerefox_get_document

Retrieve the complete text of a document by its UUID.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `document_id` | Yes | UUID from search results `[id: ...]`. |
| `version_id` | No | UUID of an archived version (from `cerefox_list_versions`). |
| `outline` | No | `true` returns the document's **structure instead of its content**: heading paths, levels, per-section sizes, plus `content_hash` and total size. Much cheaper than a full read. The paths are exactly what the edit tools take as `anchor_heading`. |
| `requestor` | No | Your agent name. |

Use this when search returns partial results, or to read a previous version before restoring it. The response header includes the document's current `content_hash` — pass it back as `expected_content_hash` when updating via `cerefox_ingest` or editing via `cerefox_insert` / `cerefox_edit`.

**Before editing a document you have not read this session, call it with `outline: true` first.** It answers the three questions an edit needs — what are the anchors, how big is each section, what is the current hash — without pulling the body into your context.

---

### cerefox_insert

Add text to a document **without resending it**. Purely additive: this tool cannot remove or overwrite existing content, so a mistaken call cannot destroy anything.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `document_id` | Yes | UUID of the document. |
| `text` | Yes | Markdown to insert. Blank-line separation from surrounding content is handled for you. |
| `position` | Yes | `end_of_document` (plain append) · `end_of_section` (add to a section's body — the most common mid-document add) · `after_heading` (lead-in text) · `before_heading` (a new block above a section). |
| `anchor_heading` | Unless `end_of_document` | The exact heading line (`## Intake`) or a ` > ` parent path (`## Intake > ### Notes`) when a heading appears more than once. |
| `section_part` | Sometimes | Only when the target section has BOTH its own content and child sections: `own_body` (before the first child) or `subtree` (after everything nested under it). If it is needed, the error tells you and lists both options. |
| `expected_content_hash` | **Yes** | The hash of the version you are basing this on. There is **no `last_write_wins` on this tool**. |
| `requestor` | No | Your agent name. |

Returns the **new `content_hash` and size — not the document**. Chain edits by passing each response's hash into the next call.

Prefer this over re-ingesting for any addition: a decision-log entry, a bullet under a heading, a new section. Re-sending a whole document to add three paragraphs means reproducing every untouched character verbatim, and any drift silently corrupts content nobody asked you to touch.

---

### cerefox_edit

Change parts of a document: **one to many operations applied atomically in a single write**.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `document_id` | Yes | UUID of the document. |
| `operations` | Yes | Array of operations, applied **in order, all-or-nothing**. Each is `{op, ...}` with `op` one of `insert` (same fields as `cerefox_insert`), `replace_section` (`anchor_heading`, `text`; swaps the body, keeps the heading), `delete_section` (`anchor_heading`, optional `scope`: `body_only` default keeps the heading, `heading_and_body` removes it too). |
| `expected_content_hash` | **Yes** | One token for the whole call. No `last_write_wins`. |
| `requestor` | No | Your agent name. |

**Put changes that belong together in ONE call.** Operations apply in order against the evolving document (op 2 sees op 1's result), and a half-applied state is impossible — so a table row and the running total it feeds cannot end up disagreeing. If any operation fails (bad anchor, ambiguity), nothing at all is written and the error names the failing operation.

**One sharp edge worth knowing.** A section runs to the next heading of the same
or higher level — **or to the end of the document**. So the last section owns
everything appended after it: an `end_of_document` insert becomes part of that
section's body, and a later `replace_section` or `delete_section` on that heading
removes it along with the rest. This is correct addressing, not a bug, but it is
silent. If a write reports a large shrink, that is the warning; the previous
content is in `cerefox_list_versions`. To append somewhere a later section edit
cannot swallow, give the appended material its own heading.

**To change a single line**, `replace_section` on its smallest enclosing heading and resend just that section. That is the intended granularity — line-level anchors were deliberately excluded because they silently edit the wrong place.

The audit trail records each operation distinctly (`insert` / `replace-section` / `delete-section`), so *added to*, *rewrote* and *removed* stay distinguishable from a full rewrite.

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
| `metadata_filter` | No† | JSON key-value pairs (AND semantics). Example: `{"type": "decision-log"}` |
| `project_name` | No† | Restrict to a project. Sufficient on its own to **list that project's documents**. |
| `include_content` | No | Include full text (default false). |
| `limit` | No | Max results (default 10). |
| `updated_since` | No† | ISO-8601 timestamp. Only docs updated on/after. |
| `created_since` | No† | ISO-8601 timestamp. Only docs created on/after. |
| `max_bytes` | No | Response size budget when include_content is true. |
| `requestor` | No | Your agent name. |

† **At least one** of `metadata_filter`, `project_name`, `updated_since`, or `created_since` must be supplied (so this never becomes an unbounded whole-KB dump). An empty `metadata_filter` plus `project_name` lists that project's documents.

Use for browsing by category, catching up on recent changes (`updated_since`), listing all documents in a project (`project_name` alone), or finding all documents of a specific type. Results are ordered newest-updated first.

---

### cerefox_list_projects

List all projects with names, IDs, and descriptions.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `requestor` | No | Your agent name. |

Call once per session to discover available projects before filtering search results by `project_name`.

---

### cerefox_set_document_projects

Set the document's project memberships to EXACTLY the given list. **Destructive replace.** Any existing memberships not in the list are removed. Content is untouched. Logged as `update-metadata` in the audit log.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `document_id` | Yes | UUID of the document. Get from a prior `cerefox_search` result (the `[id: ...]` tag). |
| `project_names` | Yes | Explicit list of project names. Each created if absent (case-insensitive lookup). Empty list = clear all memberships. Order is preserved. |
| `author` | No | Your agent name for audit attribution. |

**Use cases**:
- You want to change project membership without rewriting the document body. This tool is faster and clearer than calling `cerefox_ingest` again.
- You want to add a doc to multiple projects in one call (cleaner than N separate `cerefox_ingest` calls).
- You want to *remove* a project from a doc's set (use the list of remaining projects without the one to drop).
- An operator asked you to consolidate or clean up a doc's project list.

**Use `cerefox_ingest` with `project_names` instead** if you're updating the content anyway — same destructive-replace semantics, one call instead of two.

**Never use this tool to "just ensure X is in the list"** — that's what `cerefox_ingest` with singular `project_name` does, non-destructively. If you call this tool with only one name, you will REMOVE the document from every other project it was in.

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

### cerefox_get_help

Retrieve Cerefox conventions and quick reference content over MCP — the same content as `AGENT_QUICK_REFERENCE.md` in the repo. Designed for agents who lack filesystem access (remote MCP) or just want an in-band refresher.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `topic` | No | Case-insensitive substring match against `## H2` section titles. Omit to get the full reference plus a section index. |
| `requestor` | No | Your agent name (recorded with `access_path = "remote-mcp"` or `"local-mcp"`). |

**Behaviour:**
- No `topic` → full quick-reference markdown + an `## Available topics` index.
- `topic: "tools"` → just the `## Tools` section (no index footer).
- `topic` matches nothing → `No help topic matched "<topic>"` + available-topics list.

Cheap and idempotent. Call it any time you're uncertain about a convention (link forms, project-membership semantics, identity flags, etc.).

---

## Choosing a retrieval tool: `cerefox_search` vs `cerefox_metadata_search`

These two tools have **different contracts**. Picking the wrong one is the most common retrieval mistake.

| Reach for `cerefox_search` when… | Reach for `cerefox_metadata_search` when… |
|---|---|
| You want the *most relevant* docs for a topic or question | You want *every* doc matching exact criteria |
| The query is fuzzy or conceptual (it blends full-text + semantic) | You're filtering by structured metadata (`type`/`status`/tags), project, or date |
| Top-N ranked hits are enough to answer | You need a complete, exhaustive set (e.g. an inventory or a catch-up) |

- **`cerefox_search` is relevance-ranked top-N.** It returns the best `match_count` matches (**default 5** — raise it via `match_count`). It is **not** an enumeration tool: if more docs match than `match_count`, the rest sit silently below the cutoff — and the one you most want (e.g. the *newest*) may be exactly the one dropped.
- **`cerefox_metadata_search` is exhaustive enumeration by criteria.** No text query. Filters by `metadata_filter`, `project_name`, `updated_since` / `created_since` — supply **at least one** (an empty `metadata_filter` plus `project_name` lists that project's documents). It returns **metadata only by default** (`include_content=false`) — ids + titles + tags, which is cheap — so raise `limit` (**default 10**) freely to get the whole set. Discover available keys with `cerefox_list_metadata_keys`.

### Examples

- *"Find our OAuth design notes"* (relevance) → `cerefox_search(query="OAuth design", match_count=5)`
- *"List every decision-log doc"* (enumeration) → `cerefox_metadata_search(metadata_filter={"type":"decision-log"}, limit=50, include_content=false)`
- *"What changed since I last looked?"* → `cerefox_metadata_search(metadata_filter={"type":"decision-log"}, updated_since="2026-05-01T00:00:00Z")`
- *"Just the ids of all active research docs"* → `cerefox_metadata_search(metadata_filter={"type":"research","status":"active"}, limit=100)`
- *"List everything in the Cerefox project"* → `cerefox_metadata_search(project_name="Cerefox", limit=100)` (no `metadata_filter` needed)

### Pattern: finding the newest item in a growing series

Don't lean on `cerefox_search` ranking to find "the latest X" — as the series grows, the newest item is the one most likely to fall outside the top-N window. Instead, tag exactly one doc with a pointer (e.g. `latest:"true"`) and fetch it directly:
```
cerefox_metadata_search(metadata_filter={"type":"<your-type>", "latest":"true"})
```
Metadata is matched as **strings**, so store the flag as the string `"true"` (not a boolean). When the current item is superseded, set the new one's flag first, then clear the old one's — so a reader never sees zero matches.

---

## Key Workflows

### Add to or change part of a document (preferred over re-sending)

```
1. cerefox_get_document(id, outline=true)   -- anchors + sizes + content_hash,
                                               no body in your context
2a. Adding?   cerefox_insert(id, text, position, anchor_heading?,
                             expected_content_hash)
2b. Changing? cerefox_edit(id, operations=[...], expected_content_hash)
    -- put coordinated changes in ONE call; they apply atomically
3. Each response returns the NEW content_hash — chain further edits with it.
On a conflict: re-read (outline is enough to re-anchor), decide whether your
edit still applies, retry with the current hash. These tools cannot overwrite
a concurrent writer's work.
```

Re-send the full document (the workflows below) only when the change genuinely
spans most of it — a restructure, a rewrite. For anything less, partial edits
remove the transcription risk entirely: you never reproduce content you are not
changing.

### Search then update (ID-based -- preferred for full rewrites)

```
1. cerefox_search("topic")           -- find relevant docs, note [id: uuid]
2. cerefox_get_document(id)          -- get full text + content_hash
3. cerefox_ingest(title, content,    -- update by document ID (deterministic)
     document_id="uuid",
     expected_content_hash="<hash from step 2>")
4. On a conflict error: repeat from step 2, merging your changes into
   the latest content before retrying with the fresh hash.
```

### Search then update (title-based -- fallback)

```
1. cerefox_search("topic")           -- find relevant docs (note the hash)
2. cerefox_get_document(id)          -- get full text + content_hash
3. cerefox_ingest(title, content,    -- update with same title
     update_if_exists=true,
     expected_content_hash="<hash from step 2>")
```

### Save new knowledge

```
1. cerefox_search("topic")           -- check if it already exists
2. If not found: cerefox_ingest(title, content, project_name, metadata)
3. If found: cerefox_ingest(same_title, new_content, document_id="uuid",
     expected_content_hash="<its current hash>")
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
8. **Prove freshness on updates.** Pass `expected_content_hash` (the hash you read) on every content update. On conflict: re-read → merge → retry. Never `last_write_wins` your way out of a conflict.

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

Documents you ingest may contain markdown links to other Cerefox documents. The Cerefox web UI intercepts these links at click time and resolves them to the target document. The resolution happens entirely in the browser; the stored markdown is untouched.

### The rule for agents: use document UUIDs

**For any cross-reference you author, use the target document's UUID.** Period.

```markdown
[Opportunity Index](c937b70f-77af-43d3-b9bc-9f31e0d2041d)
```

UUIDs are the only link form that is fully reliable:

- **Stable**: survives title changes. If the target gets renamed, the link still resolves.
- **Unambiguous**: a UUID matches exactly one document. No "multiple matches" popover, no surprise navigations.
- **Encoding-safe**: no spaces, no colons, no parentheses, no characters that the markdown parser, URL sanitizer, or HTML attribute layer will trip over.
- **Discoverable**: every `cerefox_search` result includes `[id: <uuid>]` after the title. Every `cerefox_ingest` response returns the document_id. **Capture and use these IDs.**

### Workflow

```
1. cerefox_search "topic"  →  result includes [id: abc123]
2. In your written content, link as: [Topic Name](abc123)
3. Done.
```

If you're writing about a document you haven't searched for yet, search for it first, grab the ID, then write the link. Don't guess by title — searching costs one tool call and gives you the stable link form.

### Other link forms (best-effort, NOT for agent-authored content)

The resolver also accepts three other link forms, but **agents should not write them**. They exist primarily for repo-ingested files (where the source markdown naturally uses paths) and as best-effort fallbacks for legacy or human-authored content.

| Form | Example | Reliable for agents? |
|---|---|---|
| Repo-relative path | `[Quickstart](docs/guides/quickstart.md)` | Only when the target has a `source_path` from repo ingest. Don't construct manually. |
| Basename only | `[Quickstart](quickstart.md)` | Same — best-effort path fallback. Don't construct manually. |
| Angle-bracket title | `[Career Coach](<Career Coach: Lisa Nichols>)` | **Fragile**. Breaks on titles containing colons, parentheses, ampersands, brackets, or other punctuation. Web UI's URL sanitizer strips suspicious-looking URLs (e.g. anything before a `:` that looks like a scheme) → link silently navigates to current page. **Never use this form in agent-authored content.** |

If you're tempted to write `[Title With Spaces](<Title With Spaces>)` because you don't have the ID, **do an extra `cerefox_search` and use the ID instead**. The one extra tool call is much cheaper than the user encountering a broken link.

### Always set meaningful link text

The `[Link Text](target)` syntax has two halves:

- **Link text** (`[…]`): what the human reader sees. Use the actual title.
- **Target** (`(…)`): what the resolver consumes. Always a UUID for agent-authored content.

Bad: `[c937b70f-77af-...](c937b70f-77af-...)` — opaque to the reader.
Good: `[Job Hunting - Opportunity Index](c937b70f-77af-43d3-b9bc-9f31e0d2041d)`.

### What you don't need to do

- **You don't need to escape `#` anchors.** `[Section](abc123#configuration)` works — the resolver splits the anchor off and reattaches it to the target document URL.
- **You don't need to handle external URLs.** Links starting with `http://`, `https://`, `mailto:`, etc. pass through unchanged and open in a new tab.
- **You don't need to handle absolute SPA paths.** Links starting with `/` (e.g. `/search?q=foo`) pass through to the SPA router unchanged.
- **You don't need to create relation rows** for these links. The resolver does not populate the relation graph — that is a separate feature. Explicit relations are available via `cerefox_set_relation`, but they are **off by default**: the four relation tools are hidden unless the operator sets `relations_enabled`. If you do not see them in your tool list, they are switched off — do not try to call them, and do not treat their absence as an error.

### A note on agents on Path C (CLI via Bash tool)

If you're using Cerefox via the local CLI (Path C from `connect-agents.md`), the same writing conventions apply. The web UI is where resolution happens; the CLI is just how you wrote the content. A user reading your ingested document later in the web UI gets clickable behaviour for free — **as long as you authored the links by UUID**.

---

## Governance

- **Review status**: agent writes set `pending_review`; human edits set `approved`. Both are searchable.
- **Soft delete**: deleted documents go to trash (recoverable). They are excluded from search. There is no delete MCP tool — soft-delete is done via the CLI (`cerefox document delete --yes --author <you> --author-type agent`) or the web UI.
- **Permanent purge and restore-from-trash are web-UI-only**, by design. If you decide to delete something, **tell the user explicitly** that you soft-deleted it and that they can review or restore it via the Cerefox web UI. You cannot un-do your own soft-delete from agent code; only the human can. See [`docs/guides/access-paths.md` → Destructive operations and the trust model](docs/guides/access-paths.md#destructive-operations-and-the-trust-model).
- **Versioning**: every update via `update_if_exists` creates an archived version. Old content is always recoverable.
- **Audit log**: all write operations are recorded with author, timestamp, and size changes.

This is a human-on-the-loop model: agents write and soft-delete freely with full audit attribution; humans review the trash, restore mistakes, and decide when to purge.

---

## Using Cerefox via the CLI

Read this section only if you do **not** have MCP tools available (no `cerefox_search` in your tool list) and your user has pointed you at a local Cerefox checkout. The semantics of every operation are identical to MCP — only the calling surface differs. The conventions above (when to search, when to ingest, metadata rules, ID-based update workflow, governance) all still apply.

### Setup

The Cerefox CLI is the TypeScript binary from `@cerefox/memory` (`npm install -g @cerefox/memory`), invoked as plain `cerefox <subcommand>` on your `PATH` — no repo checkout or `uv` required. It uses a resource-verb shape (`cerefox document get`, `cerefox project list`, `cerefox metadata search`, …). Credentials come from a `.env` file resolved from the working directory, or from environment variables.

The Python implementation was fully removed at v1.0.0; every command is the TypeScript `cerefox` binary (`npm install -g @cerefox/memory`).

> Full per-flag reference lives in [`docs/guides/cli.md`](docs/guides/cli.md). The mapping table below is the agent-facing summary. **CLI flag names match MCP parameter names exactly** (kebab-case), each with a single-letter short form (`-p`, `-f`, `-c`, `-m`, `-u`, `-a`, `-r`). Use the canonical long name or its short form — there are no long-form aliases like `--project` or `--count`.

### MCP tool ↔ CLI command mapping

| MCP tool | CLI command |
|---|---|
| `cerefox_search(query, match_count, project_name, metadata_filter, requestor)` | `cerefox search "<query>" --match-count N --project-name <n> --metadata-filter '<json>' --requestor <name>` (also `--mode`, `--alpha`, `--min-score`, `--only-metadata` — CLI-only) |
| `cerefox_ingest(title, content, project_name, metadata, update_if_exists, document_id, expected_content_hash, last_write_wins, source, author, author_type)` (file) | `cerefox document ingest <path> --title <t> --project-name <n> --metadata '<json>' --update-if-exists\|--document-id <uuid> --expected-content-hash <hash>\|--last-write-wins --source <s> --author <a> --author-type user\|agent` |
| `cerefox_ingest(...)` (paste) | `printf '%s' "<content>" \| cerefox document ingest --paste --title "<title>"` (same flags) |
| `cerefox_get_document(document_id, version_id, requestor)` | `cerefox document get <document-id> --version-id <vid> --requestor <name>` |
| `cerefox_list_versions(document_id, requestor)` | `cerefox document version list <document-id> --requestor <name>` |
| `cerefox_list_projects(requestor)` | `cerefox project list --requestor <name>` |
| `cerefox_set_document_projects(document_id, project_names, author)` | `cerefox document set-projects <document-id> <name...> --author <a> --author-type user\|agent` (or `--clear` to remove all) |
| `cerefox_list_metadata_keys()` | `cerefox metadata keys` |
| `cerefox_metadata_search(metadata_filter, project_name, updated_since, created_since, limit, include_content, requestor)` | `cerefox metadata search --metadata-filter '<json>' --project-name <n> --updated-since <iso> --created-since <iso> --limit N --include-content --requestor <name>` |
| `cerefox_get_audit_log(document_id, author, operation, since, until, limit, requestor)` | `cerefox audit list --document-id <id> --author <a> --operation <op> --since <iso> --until <iso> --limit N --json --requestor <name>` |

> Other CLI verbs with no MCP equivalent: `cerefox document edit` (title/metadata patch), `cerefox document delete` / `cerefox document restore`, `cerefox project create` / `cerefox project edit`, `cerefox config list/get/set`, `cerefox server reindex`, `cerefox guides list/show`.

### Caller-identity flags (set these the same way you would on MCP)

You **MUST** identify yourself on every CLI invocation, exactly as you do via MCP:

- **Writes** (`document ingest`, `document ingest-dir`): set `--author "<your-agent-name>" --author-type "agent"`. The `author_type=agent` value auto-routes the write to `pending_review` (governance signal), matching the MCP path.
- **Reads** (`search`, `document get`, `document version list`, `project list`, `metadata search`, `audit list`): set `--requestor "<your-agent-name>"`.

Alternative: have your user set `CEREFOX_AUTHOR_NAME`, `CEREFOX_AUTHOR_TYPE`, `CEREFOX_REQUESTOR_NAME` in their `.env` once. The CLI picks them up automatically — see [`docs/guides/cli.md`](docs/guides/cli.md) for the precedence rules.

### Behavioural differences worth knowing

1. **CLI output is human-formatted by default.** In the default `docs` mode, `cerefox search` prints, per match, a header line `## <title> [id: <uuid>] · score · N chunks · M chars · partial|full` followed by the document body. Grab the document ID from the `[id: <uuid>]` tag, or use `cerefox document list` for a clean tabular listing. For structured output, `cerefox search --json` and `cerefox audit list --json` emit machine-readable JSON (the latter one object per line, ideal for `jq`). `cerefox document get <id>` prints raw Markdown to stdout.

2. **Every invocation is independent.** With MCP, your tool framework can pass `requestor` once per session. With the CLI, every command is a separate process — pass `--requestor` / `--author` / `--author-type` on every relevant invocation, or set the env-var defaults once at the start.

3. **Errors come back on stderr with a non-zero exit code.** Check both — a successful command prints results on stdout and exits 0; a failure prints to stderr and exits non-zero.

### Quick patterns

**Search before answering:**
```bash
cerefox search "OAuth design notes" --match-count 5 --requestor "claude-code"
```

**Search then read full content of a hit:**
```bash
cerefox search "OAuth design" --match-count 3 --requestor "claude-code"
# Note the [n] entries. Pick one and grab the doc id from `cerefox document list` or the result preview.
cerefox document get <document-id> --requestor "claude-code"
```

**Ingest a note (agent identity):**
```bash
printf '# Title\n\nBody markdown with H2s for chunking.\n' \
  | cerefox document ingest --paste \
      --title "Stable Title" \
      --project-name "Cerefox" \
      --metadata '{"type":"decision-log","status":"active"}' \
      --author "claude-code" --author-type "agent"
```

**ID-based update (preferred — deterministic):**
```bash
# Step 1: search and note the [id: abc12345-...] in the result
cerefox search "the exact doc" --match-count 1 --requestor "claude-code"

# Step 2: read it — the header shows `content_hash:` (the concurrency token)
cerefox document get "abc12345-..." --requestor "claude-code"

# Step 3: update by ID, proving freshness with the hash from step 2
printf '...new content...' \
  | cerefox document ingest --paste \
      --title "Exact Same Title" \
      --document-id "abc12345-..." \
      --expected-content-hash "<hash from step 2>" \
      --author "claude-code" --author-type "agent"

# Conflict error? Repeat from step 2, merge into the latest content, retry.
```

**Title-based update (fallback when ID isn't available):**
```bash
printf '...new content...' \
  | cerefox document ingest --paste --title "Exact Same Title" --update-if-exists \
      --author "claude-code" --author-type "agent"
```

**Audit-log access (scripted, JSON):**
```bash
cerefox audit list --json --limit 1000 --requestor "claude-code" \
  | jq 'select(.author_type == "agent")'
```
