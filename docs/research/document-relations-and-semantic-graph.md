# Iteration 18 Design: Document Relations and Lifecycle Metadata

**Status:** Draft -- evolving, not yet in plan.md
**Date:** April 2026
**Context:** Follows from the background survey "Knowledge Maintenance in Agent Memory Systems"
and design discussion. Incorporates open-question answers and use-case feedback.

---

## 1. Scope and Framing

Iteration 18 adds two capabilities that are prerequisites for almost everything else in the
knowledge maintenance roadmap:

1. **Document Relations** -- explicit typed links between documents, set by agents, the user,
   or later the Archiver. These are the edges in the knowledge graph.

2. **Lifecycle States** -- a lightweight `lifecycle_status` field that captures the
   validity/relevance of a document without over-committing to a complex temporal model.

The survey established that relations and provenance are foundational: the Archiver, conflict
detection, skills repository, and structured collections all depend on them. This iteration
focuses on getting that foundation right.

### What we are NOT building in Iteration 18

- `valid_from` / `valid_until` date columns -- discussed in section 3.3, deferred
- The Archiver/Curator process -- needs relations first
- Collections as a separate concept -- covered naturally by `part_of` relations (section 2.7)
- Skills repository -- Iteration 20+
- NLI-based contradiction detection -- needs relations + Archiver
- GraphRAG / graph-based retrieval (full) -- deferred; the retrieve-then-traverse approach
  in section 4 is the first step in that direction

---

## 2. Document Relations

### 2.1 Why a dedicated table, not metadata embedding

Storing relations as JSONB on the document record was considered and rejected:

- **Queryability.** "Find all documents that supersede document X" requires a JSONB scan
  across all documents. A dedicated table makes this an indexed lookup.
- **Bidirectionality.** The metadata approach requires updating two document records to
  maintain symmetry. A table with source/target columns answers both directions from one row.
- **Atomicity.** A relation row can be inserted in the same RPC transaction that creates the
  document. Updating two documents' JSONB fields requires two separate writes.
- **Provenance.** Relations need their own metadata: who linked them, when, why. Natural
  as table columns, awkward as nested JSONB inside JSONB.
- **Migration cost is low.** A single `CREATE TABLE` + RPC. We are used to this.

### 2.2 Proposed schema

```sql
CREATE TABLE cerefox_document_relations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id    UUID NOT NULL REFERENCES cerefox_documents(id) ON DELETE CASCADE,
  target_id    UUID NOT NULL REFERENCES cerefox_documents(id) ON DELETE CASCADE,
  rel_type     TEXT NOT NULL,
  metadata     JSONB NOT NULL DEFAULT '{}',
  author       TEXT NOT NULL DEFAULT 'unknown',
  author_type  TEXT NOT NULL DEFAULT 'agent',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, target_id, rel_type)
);

CREATE INDEX idx_cerefox_relations_source ON cerefox_document_relations(source_id);
CREATE INDEX idx_cerefox_relations_target ON cerefox_document_relations(target_id);
CREATE INDEX idx_cerefox_relations_type   ON cerefox_document_relations(rel_type);
```

Key decisions:
- `rel_type` is free-form text, not a Postgres enum -- agents can define new types without
  schema migrations (see section 2.3 on the type dictionary).
- `UNIQUE (source_id, target_id, rel_type)` prevents duplicate links of the same type;
  two documents can still have multiple different relation types between them.
- `ON DELETE CASCADE` on both FKs -- deleting either document removes the relation row.
  No orphan edges.
- `metadata` JSONB for optional extended context: notes, confidence, resolution status, etc.

### 2.3 Relation types: free-text with a type dictionary

**Decision:** relation types are free-text strings. A separate **type dictionary** defines
behavior and auto-effects for known types. Unknown types are valid but have no auto-effects
and no special search behavior -- they behave as generic semantic annotations.

This gives us extensibility without schema migrations while still allowing well-defined
behavior for common types. Agents and users can add new types to the dictionary as needed.

#### Built-in types (initial set)

| Type | Direction | Meaning | Auto-effects |
|------|-----------|---------|--------------|
| `supersedes` | A → B | A replaces or is the authoritative version of B | Set B's `lifecycle_status` to `superseded` |
| `related_to` | A ↔ B | General semantic relationship | None |
| `derived_from` | A → B | A was created by transforming, summarizing, or expanding B | None |
| `contradicts` | A ↔ B | A and B make conflicting claims (unresolved) | Flag both `lifecycle_status` = `stale` |
| `depends_on` | A → B | A's validity depends on B being current | If B becomes stale, flag A |
| `part_of` | A → B | A belongs to a group, channel, collection, or thread B | None |
| `follows` | A → B | A is the immediate successor of B in an ordered sequence | None |
| `reply_to` | A → B | A is a direct reply to B (thread reply, email reply) | None |

**Inverse labels** (display only, not stored separately):

| Forward | Inverse |
|---------|---------|
| `supersedes` | `superseded_by` |
| `derived_from` | `source_of` |
| `depends_on` | `dependency_of` |
| `part_of` | `contains` |
| `follows` | `precedes` |
| `reply_to` | `has_reply` |
| `related_to` | `related_to` (symmetric) |
| `contradicts` | `contradicts` (symmetric) |

**Symmetric types** (`related_to`, `contradicts`) are stored as two rows -- A→B and B→A --
inserted atomically by the RPC. This keeps queries simple (always query by source_id) and
avoids a two-direction scan.

#### Type dictionary structure

The dictionary lives in `cerefox_config` (or a small companion table) and maps type names to
behavior flags. For `search_neighbor: true` types, `n_preceding` and `m_following` specify
how many neighbors to include on each side of a search hit (defaults apply when omitted).

```json
{
  "supersedes":  { "direction": "forward",    "search_neighbor": false, "auto_status": "superseded" },
  "related_to":  { "direction": "symmetric",  "search_neighbor": true,  "auto_status": null,        "n_preceding": 0, "m_following": 0 },
  "derived_from":{ "direction": "forward",    "search_neighbor": false, "auto_status": null },
  "contradicts": { "direction": "symmetric",  "search_neighbor": false, "auto_status": "stale" },
  "depends_on":  { "direction": "forward",    "search_neighbor": false, "auto_status": null },
  "part_of":     { "direction": "forward",    "search_neighbor": false, "auto_status": null },
  "follows":     { "direction": "forward",    "search_neighbor": true,  "auto_status": null,        "n_preceding": 2, "m_following": 2 },
  "reply_to":    { "direction": "forward",    "search_neighbor": true,  "auto_status": null,        "n_preceding": 0, "m_following": 3 }
}
```

For `follows`: return the 2 messages before and 2 after the matched document in the ordered
sequence. For `reply_to`: return up to 3 replies that follow the matched message in its
sub-thread (see section 4.2). These defaults can be overridden per query.

`search_neighbor: false` means the relation is metadata-only for search -- it surfaces in
the document's relation list but does not trigger neighbor retrieval.

For now, this dictionary is embedded in the application layer (Python config and TypeScript
constants). A future iteration could expose it via the REST API for user customization.

#### Note: inverse relations with high fan-in

Inbound relations can have unbounded cardinality. A Slack channel document with 10,000
messages all pointing to it via `part_of` cannot return 10,000 `contains` entries in a
response -- this would be unusable and potentially exceed response size limits.

**Proposed handling:**

- **Per-type inbound limit** in the dictionary (e.g. `"max_inbound_display": 10`). When
  the inbound count exceeds this limit, the response returns the first N entries plus a
  summary: `{ "rel_type": "contains", "count": 10000, "sample": [...first 10 items...],
  "truncated": true }`.
- The full inbound list is always retrievable via `cerefox_get_relations(doc_id)` with
  pagination, for cases where the caller needs it.
- For the web UI, the relations panel shows: `← 10,000 documents part_of this [show list]`
  rather than rendering all entries inline.

This is not a deferred concern -- it must be handled from day one for `part_of` and any
other relation type that can have high fan-in. Add `max_inbound_display` to the dictionary
with a default of 10.

### 2.4 Ingesting message-style content: Slack as the canonical example

Slack messages are a good concrete example of how to model sequential, threaded content in
Cerefox using the relation graph. The same structure applies to email threads, forum posts,
recurring meeting notes, and chatbot session transcripts.

**Proposed structure:**

```
[#general channel doc]
  ↑ part_of (from all messages)
[Message A] → follows → [Message B] → follows → [Message C]
                                         ↑ reply_to (from replies)
                                    [Reply 1] → follows → [Reply 2]
```

**Document types in this model:**
- **Channel document** -- one per Slack channel (or DM participant, or group name). Title:
  e.g. `slack-channel: #general`. Content: channel description, scope, members. This is the
  collection anchor. Created once, updated rarely.
- **Message documents** -- one per Slack message. Title format:
  `slack: 2026-04-08 14:32 | alice | #general`. Content: message text. Metadata:
  `{"sender": "alice", "timestamp": "2026-04-08T14:32:00Z", "channel": "general"}`.
- **Relations:**
  - Each message → `part_of` → channel document
  - Each message → `follows` → preceding message (for main thread ordering)
  - Each reply → `reply_to` → the message it replies to
  - Each reply → `follows` → preceding reply in the same sub-thread

**Why this structure works:**

The Slack thread model has two levels: the main channel timeline and 1-level sub-threads
branching from any message. Both are captured by `follows` (ordering within a timeline) and
`reply_to` (branching into a sub-thread). The channel document is the collection anchor via
`part_of`. This is enough to reconstruct the full thread topology.

**Ingestion workflow:**

An ingestion script (cron task, on-demand agent, or similar) handles each message as follows:
1. Ingest the message document -- the response provides its `document_id`
2. Call `cerefox_set_relation(new_msg_id, prev_msg_id, "follows")` to position it in sequence
3. If it's a reply: call `cerefox_set_relation(new_msg_id, parent_msg_id, "reply_to")`
4. Call `cerefox_set_relation(new_msg_id, channel_doc_id, "part_of")`

The channel document must exist before step 4. The ingestion script creates it on first run
(or searches for it by title and reuses it). This is handled by the script using primitive
commands -- no special Cerefox mechanism is required. A future iteration may consider adding
optional implicit relation creation as a JSON parameter on the ingest command, but for now
keeping the steps composable and explicit is simpler.

**Messages containing links:**
When a message contains a link to an external document or another thread, the ingestion
script can create a `related_to` relation to the linked document in Cerefox (if it exists),
ingest the linked document and link it if it doesn't yet exist, or store the unresolved
reference in the message document's metadata for later reconciliation.

**This pattern generalizes:**
The same structure applies to email threads (`reply_to` + `follows`), forum threads
(`reply_to` + `follows` from root post), recurring meeting notes (`follows` between sessions,
`part_of` a "Meeting Series" document), and chatbot session transcripts. The relation types
are the same; the metadata JSONB captures the domain-specific context (sender, timestamp,
channel, etc.).

### 2.5 How relations are managed

**Decision: separate `cerefox_set_relation` and `cerefox_delete_relation` tools**, not
bundled with ingest. Reasoning:
- Relations are often set after the document is created (the agent has the `document_id`
  from the preceding ingest call and the target `document_id` from prior search or context)
- Keeping set_relation separate keeps the ingest API clean and composable
- Both tools accept UUIDs directly (the caller already knows both IDs)
- Parity required: both tools available via MCP, Edge Functions, and CLI

**`cerefox_set_relation` parameters:**
```
source_id    UUID (required) -- the "from" document
target_id    UUID (required) -- the "to" document
rel_type     string (required) -- e.g. "supersedes", "follows", "reply_to", or custom
author       string (optional) -- for attribution
metadata     object (optional) -- notes, confidence, etc.
```

**`cerefox_delete_relation` parameters:**
```
source_id    UUID (required)
target_id    UUID (required)
rel_type     string (required)
```

**User manages relations in the web UI:**
Document detail page shows a relations panel. Each relation is displayed as:

```
(this document) supersedes → Sprint 11 Architecture Decision [view]
(this document) part_of → #general [view]
← Reply 3 reply_to (this document) [view]
```

The `[view]` link navigates to the target document's detail page. Adding a relation uses a
form: type selector (dropdown of known types + free-text option) + target document search.
Removing a relation uses a delete button next to each entry.

A graph visualization (interactive node-link diagram) is explicitly deferred to a future
iteration. The text-based list above is the v1 UI.

### 2.6 Relations in `cerefox_get_document` responses

**Decision: relations are always included in `cerefox_get_document` responses.**

They are essential metadata that affect how the agent interprets the document. Omitting them
would cause agents to miss critical context (e.g., that this document was superseded).

Response structure addition:
```json
{
  "document_id": "...",
  "title": "...",
  "content": "...",
  "relations": {
    "outbound": [
      { "rel_type": "supersedes", "target_id": "...", "target_title": "...", "created_at": "...", "author": "..." }
    ],
    "inbound": [
      { "rel_type": "part_of",    "source_id": "...", "source_title": "...", "created_at": "...", "author": "..." },
      { "rel_type": "part_of",    "truncated": true,  "count": 10000, "shown": 1 }
    ]
  }
}
```

**Handling high fan-in:** inbound relations with high cardinality (e.g., 10,000 message
documents pointing to a channel document via `part_of`) are capped at `max_inbound_display`
entries per type (default 10, defined in the type dictionary). When truncated, the response
includes a summary object: `{ "rel_type": "...", "truncated": true, "count": N, "shown": K }`.
The full list is retrievable via `cerefox_get_relations(doc_id)` with pagination.

In the web UI, high-cardinality inbound relations are rendered as:
`← 10,000 documents [part_of] this  [show list]` rather than an inline list.

Relations are also included in search results as a compact summary (type + title + id per
linked document, same truncation rules), because they affect the agent's interpretation of
relevance and validity.

### 2.7 Obsidian wikilink parsing

Obsidian uses `[[Target Title]]` or `[[Target Title|display text]]` for internal links.
When syncing Obsidian documents into Cerefox (`scripts/sync_docs.py`):

1. Parse all `[[...]]` wikilinks from markdown content.
2. For each wikilink, call `find_document_by_title(target_title)` to resolve the UUID.
3. If resolved: `cerefox_set_relation(source_id, target_id, "related_to", metadata={"source": "obsidian_wikilink"})`.
4. If unresolved: store in the document's metadata as `unresolved_links: ["Title"]` for
   later reconciliation (re-run sync after the target document is ingested).

On export/sync back to Obsidian, `related_to` relations are rendered as `[[Target Title]]`
links in the output markdown, creating a two-way sync between the Cerefox relation graph and
the Obsidian link graph.

Obsidian folder structure and filename date prefixes (daily notes, periodic notes) can seed
`part_of` and `follows` relations automatically during sync.

---

## 3. Lifecycle States

### 3.1 Why lifecycle states instead of explicit temporal fields

The user's instinct is correct: `valid_from` / `valid_until` date fields require advance
prediction -- most documents don't know their validity window at creation time. Lifecycle
states are event-driven: they change in response to actions (a relation is created, the
archiver flags something, a human reviews it), not based on a clock.

**What we already have:** `review_status` (`approved`, `pending_review`, `needs_review`)
covers the human approval workflow. This is orthogonal to lifecycle and is unchanged.

### 3.2 Proposed lifecycle states

Add `lifecycle_status TEXT NOT NULL DEFAULT 'active'` to `cerefox_documents`:

| State | Meaning | Who sets it |
|-------|---------|-------------|
| `active` | Current and trusted. Default on creation. | Default |
| `stale` | Likely outdated; content may no longer reflect reality. | Agent, Archiver, User |
| `superseded` | Replaced by another document (`supersedes` relation exists pointing here). | Auto-set by RPC on relation creation |
| `archived` | Kept for history; excluded from search by default. | Agent, User |

**`superseded` is auto-set.** When a `supersedes` relation is created, the RPC sets the
target document's `lifecycle_status` to `superseded` atomically. Agents do not need to do
this manually -- the graph and lifecycle stay consistent by design.

**`archived` filters search.** Like soft-deleted documents, archived documents are excluded
from default search results. Retrievable explicitly by ID or with an `include_archived` flag.

**`stale` is a soft warning.** Stale documents remain in search results but their status is
surfaced in the response, allowing agents to decide whether to use or discard the result.

### 3.3 On `valid_from` / `valid_until`

These are deferred to metadata JSONB for now. Agents that need time-bounded validity can
write `metadata: {"valid_until": "2026-Q2"}`. The Archiver (future) can read and act on
these fields. We promote them to proper columns only if query performance requires it.

---

## 4. Search with Relations: Retrieve-then-Traverse

### 4.1 The pattern

The approach is a two-phase pattern:

**Phase 1 -- Semantic/hybrid retrieval (what we have today):**
Run the existing hybrid FTS + vector search to identify the most relevant document chunks.
Apply small-to-big expansion to assemble full documents from matched chunks.

**Phase 2 -- Graph traversal (new in Iteration 18+):**
For each matched document, inspect its relations. For relation types with `search_neighbor: true`
(currently `follows`, `reply_to`, `related_to`), retrieve the linked neighbor documents and
include them in the response.

This is analogous to how small-to-big retrieval works: the chunk match is the entry point,
and the surrounding context (neighboring chunks or, now, related documents) is pulled in to
give the agent a fuller picture.

### 4.2 Neighborhood retrieval for message threads

For a Slack search result that matches message B in a thread:

```
... → [Msg A] → follows → [Msg B*] → follows → [Msg C] → ...
                                ↑
                           search hit
```

The response includes:
- Msg B (the match)
- N preceding messages (via `follows` chain, traversed backward from B)
- M following messages (via `follows` chain, traversed forward from B)
- If B has replies (`reply_to` relations pointing to it): up to M messages in that
  sub-thread, following the `follows` chain within the thread

N and M defaults come from the type dictionary (`n_preceding` and `m_following` per type)
and can be overridden per query. The same M parameter governs both forward `follows`
neighbors and `reply_to` thread depth -- the semantics are equivalent: "how many successive
messages after the matched document should be included in context".

**Deduplication** at the result level works the same way as chunk deduplication in small-to-big:
if the same document appears as both a direct search hit and a neighbor of another hit, it
appears once in the merged result, with the highest relevance score.

### 4.3 What graph traversal does NOT do at this stage

- **No multi-hop traversal in Phase 1.** The search is still semantic/hybrid. The graph
  traversal in Phase 2 is one hop: direct neighbors only. Multi-hop ("find documents
  related to the related documents") is a Phase 5 / Iteration 19+ concept.
- **No graph-based re-ranking in Phase 1.** The search ranking is unchanged. Relations
  surface additional context, not a re-ranked ordering. Re-ranking (with or without an NLI
  pass) is a separate, later capability.
- **`supersedes` and `depends_on` do not pull neighbors.** They are metadata that the agent
  uses to interpret validity, not signals to expand the result set.

### 4.4 Research direction

The retrieve-then-traverse pattern is well-established in the GraphRAG literature. The user
wants to review and refine the approach based on what the research and practitioner community
is doing. This is a standing research task: as we build and test the initial implementation,
we will review current GraphRAG approaches (Microsoft's GraphRAG, LightRAG, etc.) and assess
what techniques to incorporate in later iterations.

Key questions for that research:
- When does graph traversal improve precision vs. add noise?
- How do we weight retrieved neighbors vs. direct hits in the response?
- Is one-hop traversal sufficient or do specific use cases (e.g., multi-step reasoning)
  require two hops?
- How do we handle cycles in the graph (A → follows → B → follows → A would be a bug,
  but `related_to` graphs can have cycles legitimately)?

---

## 5. Design Decisions (Resolved)

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | Relations at ingest vs. separate call | Separate `cerefox_set_relation` | Ingest provides the new doc's ID; caller composes the two calls. Keeps ingest API clean. |
| 2 | Fixed vs. custom relation types | Free-text + type dictionary | Extensible without migrations; dictionary defines behavior flags for known types; unknown types are valid but behavior-less |
| 3 | Web UI relation display | Text list with `[view]` links; graph viz deferred | Text is sufficient for v1; graph is a future iteration |
| 4 | Tool naming | Separate `cerefox_set_relation` and `cerefox_delete_relation`, parity across MCP / Edge Functions / CLI | Cleaner than a single "manage" tool; parity ensures all agent environments have the same capability |
| 5 | Relations in search results | Always included | Relations affect validity interpretation; agents need them to reason correctly about retrieved documents |
| 6 | Collections | Covered by `part_of` relation; "Collections" as a separate concept is deferred | A channel or meeting series document with `part_of` edges from all members is a collection. No extra mechanism needed yet. |

---

## 6. What the Type Dictionary Defers

The type dictionary approach intentionally defers several hard problems:

- **User-defined auto-effects.** Currently auto-effects are hardcoded (e.g., `supersedes`
  sets `superseded` on the target). Letting users define their own auto-effects for custom
  types (e.g., "when I create a `closes` relation, set the target's lifecycle_status to
  `archived`") is powerful but complex. Deferred.
- **Type validation.** Whether to validate `rel_type` against the dictionary at write time,
  or only use the dictionary for behavior lookup at read/search time. The simpler approach
  (validate at read time only, allow any string at write time) is easier to implement and
  less brittle. Deferred decision.

**Addressed in this iteration (not deferred):**
- Per-type neighbor counts (`n_preceding`, `m_following`) are now in the dictionary (section 2.3).
- High fan-in truncation (`max_inbound_display`) is in the dictionary and must be handled
  from day one.

---

## 7. Rough Implementation Sketch (for plan.md)

### Schema migration

```sql
-- Relations table
CREATE TABLE cerefox_document_relations (...);  -- see section 2.2

-- Lifecycle status
ALTER TABLE cerefox_documents ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'active';
CREATE INDEX idx_cerefox_docs_lifecycle ON cerefox_documents(lifecycle_status);
```

### New RPCs

- `cerefox_set_relation(p_source_id, p_target_id, p_rel_type, p_author, p_author_type, p_metadata)`
  - Inserts relation row(s); for symmetric types inserts both directions atomically
  - For `supersedes`: sets `target.lifecycle_status = 'superseded'` atomically
  - For `contradicts`: sets both documents' `lifecycle_status = 'stale'`
  - Logs to audit table
- `cerefox_delete_relation(p_source_id, p_target_id, p_rel_type)`
  - Removes the relation row(s) (both directions for symmetric types)
  - Logs to audit table
- `cerefox_get_relations(p_document_id)`
  - Returns all outbound and inbound relations for a document
- `cerefox_get_neighbors(p_document_id, p_rel_type TEXT, p_depth INT DEFAULT 1, p_from_time TIMESTAMPTZ DEFAULT NULL, p_to_time TIMESTAMPTZ DEFAULT NULL)`
  - `p_rel_type` is required -- the caller specifies which relation type to traverse
    (search and `cerefox_get_document` return the full relation list; the caller picks which type to expand)
  - `p_depth` defaults to 1 (direct neighbors only); higher values cascade only for relation
    types where chaining is meaningful (e.g. `follows`, `reply_to`), not for `related_to` or `part_of`
  - `p_from_time` / `p_to_time` filter neighbors by their document `created_at`, useful for
    retrieving messages within a time window without traversing the full chain
  - Exposed as a standalone MCP tool, Edge Function, and CLI command -- not just an internal
    search primitive, as agents may want to navigate the graph directly

### Modified RPCs / search

- `cerefox_hybrid_search` / `cerefox_search_docs`: add Phase 2 graph traversal step for
  `search_neighbor: true` types; include compact relation summaries in result rows
- `cerefox_ingest_document`: no change (relations are set separately)

### Python layer

- `CerefoxClient`: `set_relation()`, `delete_relation()`, `get_relations()`, `get_neighbors()`
- `SearchClient`: extend to call `get_neighbors()` after retrieval and merge results
- `IngestionPipeline`: no change needed (agents call `set_relation` separately)
- `cerefox_get_document` API response: include `relations` field
- `cerefox reindex` CLI: no change

### MCP tools (cerefox-mcp)

- New tool: `cerefox_set_relation` (`tools/relation.ts`)
- New tool: `cerefox_delete_relation` (`tools/relation.ts`)
- Updated `cerefox_get_document`: include relations in response text

### Edge Functions

- New: `cerefox-set-relation` (mirrors MCP tool for GPT Actions / direct HTTP path)
- New: `cerefox-delete-relation`
- Updated: `cerefox-get-document`: include relations in JSON response

### REST API

- `POST /api/v1/relations` -- set a relation
- `DELETE /api/v1/relations` (body: source_id, target_id, rel_type) -- delete a relation
- `GET /api/v1/documents/{id}/relations` -- get relations for a document
- Updated `GET /api/v1/documents/{id}` -- include relations in response

### Web UI

- Document detail page: relations panel (list of outbound + inbound relations with `[view]` links)
- Document detail page: add relation form (type dropdown + target document search input)
- Search results: show compact relation summary per result (e.g. "superseded by [X]")
- `lifecycle_status` badge alongside `review_status` badge

### Obsidian sync (`scripts/sync_docs.py`)

- Wikilink parser: extract `[[Title]]` patterns
- Title resolver: batch `find_document_by_title` calls
- Relation writer: `set_relation(source_id, target_id, "related_to")` for resolved links
- Unresolved link stash: write to document metadata for later reconciliation
