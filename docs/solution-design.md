# Cerefox Solution Design

## 1. System Overview

Cerefox is a **user-owned knowledge memory layer**: a persistent, curated knowledge base that sits between the user and the AI tools they use. It is *not* a note-taking app; it is the shared memory substrate that multiple AI agents can read and write, owned and curated by the user.

The primary use case is **shared memory across AI agents**: knowledge written by one tool becomes immediately available to all others, preventing context fragmentation across sessions and AI tools.

> For the full project vision, core principles, and future direction, see [`docs/research/vision.md`](../research/vision.md).

**Layer model:**
```
[Human layer]     Write, curate, and validate knowledge
                        ↓ (ingest: CLI, folder sync, upload, web UI)
[Cerefox layer]   Chunking → Embeddings → Supabase (Postgres + pgvector)
                        ↑↓ (MCP tools: search, retrieve, write)
[Agent layer]     Claude, Cursor, ChatGPT, custom agents — read AND write
```

The web UI covers management (browse, metadata, projects) and ingestion (upload, paste). It deliberately has no rich authoring features — that's the human/writing layer's responsibility. Agents write directly via MCP tools.

```
┌─────────────────────────────────────────────────────────────────┐
│                        AI Agents                                │
│  Claude ─ Cursor ─ ChatGPT ─ Custom Agents                      │
│                          │                                      │
│                     MCP Protocol                                │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                    Supabase MCP Layer                            │
│              (exposes RPCs as MCP tools)                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                   PostgreSQL + pgvector                          │
│                                                                  │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │cerefox_documents│  │  cerefox_chunks   │  │cerefox_projects│ │
│  │  (doc metadata) │──│  (content+embeds) │  │  (categories) │  │
│  └────────┬────────┘  └──────────────────┘  └───────────────┘  │
│           │                                                      │
│  ┌────────▼──────────────┐                                      │
│  │cerefox_document_vers. │                                      │
│  │  (content snapshots)  │                                      │
│  └───────────────────────┘                                      │
│                                                                  │
│  RPCs: hybrid_search ─ fts_search ─ semantic_search             │
│        get_document ─ list_versions                              │
└─────────────────────────────────────────────────────────────────┘
                           ▲
                           │
┌──────────────────────────┴──────────────────────────────────────┐
│                   Ingestion Layer                                │
│                                                                  │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌─────────────┐ │
│  │   CLI    │   │  Web UI  │   │Converters│   │  Embedders  │  │
│  │(click)   │   │(FastAPI) │   │PDF→MD    │   │openai/      │  │
│  │          │   │          │   │DOCX→MD   │   │fireworks    │  │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘   └──────┬──────┘ │
│       └───────────────┴──────────────┴────────────────┘         │
│                           │                                      │
│                   Ingestion Pipeline                             │
│            (parse → version → chunk → embed → store)            │
└─────────────────────────────────────────────────────────────────┘
```

## 2. Data Model

### 2.1 Design Rationale: Chunks-Anchored Versioning

The original spec used a single `cerefox_notes` table. The current design uses:

- **`cerefox_documents`** — document-level metadata (no content column — content lives in chunks)
- **`cerefox_chunks`** — search corpus and version store. Current chunks have `version_id IS NULL`; archived chunks have `version_id` pointing to their version row. All embeddings and FTS live here.
- **`cerefox_document_versions`** — lightweight version metadata rows. No content TEXT — content for any version is reconstructed from its archived chunks. Created only when content actually changes.

Key design properties:
- **Document lifecycle**: delete/update a whole document cleanly (cascade deletes its chunks and versions)
- **Chunks-first**: content is always authoritative in chunks, never duplicated in the documents table
- **Unified version store**: current and archived content share the same table — no separate content column, no redundant storage
- **Search isolation**: all search RPCs filter `version_id IS NULL` so only current chunks are searchable
- **Small-to-big retrieval**: find a current chunk, then pull its current siblings by chunk_index
- **Document-level metadata**: tags, project, source — live on the document, not duplicated per chunk
- **Deduplication**: content hash on documents prevents re-ingesting the same file
- **Versioning is additive**: the search path (documents → current chunks) is unchanged; archived chunks are invisible to search

### 2.2 Schema

#### cerefox_projects

Lightweight table for organizing content into projects/categories. These are evolvable — add new ones any time via the web UI or CLI.

```sql
CREATE TABLE cerefox_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Examples: "Creative Projects", "Work", "Research", "Personal", "Side Projects"
Projects are entirely user-defined with no predefined taxonomy.

#### cerefox_documents

One row per ingested document (markdown file, pasted note, etc.). No `content` column — content lives in `cerefox_chunks`. The `content_hash` covers the full markdown content and is used for deduplication.

```sql
CREATE TABLE cerefox_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',      -- 'file', 'paste', 'agent', 'url', 'manual'
  source_path TEXT,                            -- original file path or URL
  content_hash TEXT NOT NULL,                  -- SHA-256 of raw markdown; used for dedup
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  chunk_count INT NOT NULL DEFAULT 0,          -- count of current-version chunks (version_id IS NULL)
  total_chars INT NOT NULL DEFAULT 0,          -- sum of char_count for current-version chunks
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(content_hash)
);

-- Many-to-many: one document can belong to zero or more projects.
CREATE TABLE cerefox_document_projects (
  document_id UUID NOT NULL REFERENCES cerefox_documents(id) ON DELETE CASCADE,
  project_id  UUID NOT NULL REFERENCES cerefox_projects(id)  ON DELETE CASCADE,
  PRIMARY KEY (document_id, project_id)
);
```

#### cerefox_chunks

One row per chunk, for both the current and all archived versions. Current chunks have `version_id IS NULL`; archived chunks have `version_id` pointing to their `cerefox_document_versions` row.

Chunks are **never updated in place** and are **never deleted on a document update**. On update, current chunks are archived (their `version_id` is set to the new version row's id) and new current chunks are inserted (`version_id IS NULL`). Archived chunks are deleted lazily when their version expires.

```sql
CREATE TABLE cerefox_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES cerefox_documents(id) ON DELETE CASCADE,
  -- version_id IS NULL  → current version (searchable, indexed)
  -- version_id non-NULL → archived version (not searchable, retained until version cleanup)
  version_id  UUID REFERENCES cerefox_document_versions(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  heading_path TEXT[],                         -- e.g., ARRAY['Overview', 'Architecture']
  heading_level INT,                           -- deepest heading level (1, 2, 3)
  title TEXT,                                  -- section heading text
  content TEXT NOT NULL,
  char_count INT NOT NULL,

  -- Embeddings (768 dims, cloud-only: OpenAI text-embedding-3-small default)
  -- Only current chunks (version_id IS NULL) need embeddings; archived chunks retain their
  -- original embeddings but are excluded from search.
  embedding_primary VECTOR(768) NOT NULL,
  embedding_upgrade VECTOR(768),               -- optional: alternative embedder

  -- Full Text Search (generated column — always in sync with content)
  fts tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
    setweight(to_tsvector('english', content), 'B')
  ) STORED,

  -- Embedder tracking
  embedder_primary TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  embedder_upgrade TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- No updated_at: chunks are immutable once created
);
```

Note: there is no `UNIQUE(document_id, chunk_index)` constraint — multiple versions of the same chunk co-exist. Uniqueness of current-version chunks is enforced by a **partial unique index** (see Indexes below).

#### cerefox_document_versions

One row per historical version of a document. Created automatically on every content-changing update before the document is overwritten. **No content TEXT column** — version content is reconstructed from the archived chunks that reference this version's `id` via `version_id`.

```sql
CREATE TABLE cerefox_document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES cerefox_documents(id) ON DELETE CASCADE,
  version_number INT NOT NULL,                 -- monotonically increasing per document (1, 2, 3…)
  content_hash TEXT NOT NULL,                  -- SHA-256 of the content at snapshot time
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb, -- metadata snapshot at time of version
  chunk_count INT NOT NULL DEFAULT 0,          -- chunk_count at time of snapshot
  total_chars INT NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',       -- who triggered the update that displaced this version
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(document_id, version_number)
);
```

Retrieving version content: `SELECT content FROM cerefox_chunks WHERE version_id = '<version_id>' ORDER BY chunk_index`. This reconstruction mirrors how current content is retrieved (`version_id IS NULL`), keeping a single code path for both.

#### Indexes

```sql
-- FTS (current chunks only — partial index covers only searchable chunks)
CREATE INDEX idx_cerefox_chunks_fts ON cerefox_chunks USING GIN(fts)
  WHERE version_id IS NULL;

-- Vector similarity — HNSW (current chunks only)
CREATE INDEX idx_cerefox_chunks_emb_primary
  ON cerefox_chunks USING hnsw (embedding_primary vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE version_id IS NULL;

CREATE INDEX idx_cerefox_chunks_emb_upgrade
  ON cerefox_chunks USING hnsw (embedding_upgrade vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE version_id IS NULL;

-- Uniqueness of current-version chunks per document: one chunk_index per doc in the current version
-- Partial index (WHERE version_id IS NULL) allows the same chunk_index in archived versions.
CREATE UNIQUE INDEX idx_cerefox_chunks_current_unique
  ON cerefox_chunks(document_id, chunk_index)
  WHERE version_id IS NULL;

-- Document lookup by chunk (covers both current and archived chunks within a document)
CREATE INDEX idx_cerefox_chunks_document ON cerefox_chunks(document_id, chunk_index);

-- Version-specific chunk retrieval (for full document retrieval of a historical version)
CREATE INDEX idx_cerefox_chunks_version ON cerefox_chunks(version_id, chunk_index)
  WHERE version_id IS NOT NULL;

-- Document metadata (JSONB) — enables fast filtering by tags, source, etc.
CREATE INDEX idx_cerefox_docs_metadata ON cerefox_documents USING GIN(metadata);

-- Version lookups (latest version first)
CREATE INDEX idx_cerefox_versions_doc ON cerefox_document_versions(document_id, version_number DESC);
```

**Important**: the partial FTS and HNSW indexes (`WHERE version_id IS NULL`) mean that archived chunks are automatically excluded from all FTS and vector searches at the index level — no explicit filter needed in queries. All search RPCs must still include `AND c.version_id IS NULL` in their WHERE clauses for clarity and correctness on small tables where indexes may not be used.

### 2.3 Entity Relationships

```
cerefox_projects (many) >──< (many) cerefox_documents (1) ──< (many) cerefox_chunks [version_id IS NULL]
                          via cerefox_document_projects        (current version — searchable)

cerefox_documents (1) ──< (many) cerefox_document_versions (1) ──< (many) cerefox_chunks [version_id = id]
                                  (version metadata)                 (archived chunks — not searchable)
```

- A project has many documents; a document can belong to many projects (many-to-many via junction table)
- A document has many chunks: those with `version_id IS NULL` are the current (searchable) version
- A document has zero or more version rows — only created when content changes
- Each version row owns its archived chunks via the `version_id` FK on chunks
- Deleting a document cascades to all its chunks (current + archived) and all its version rows
- Deleting a version row cascades to its archived chunks
- Deleting a project cascades only to junction table rows (documents are not deleted)

## 3. Chunking Strategy

### 3.1 Heading-Based Greedy Chunking

All content is markdown. The chunker uses a greedy section-accumulation strategy to keep chunks close to `MAX_CHUNK_CHARS`:

```
Algorithm:
  1. Short-circuit: if the entire document fits within MAX_CHUNK_CHARS, return
     it as a single chunk (no splitting — preserves holistic context).
  2. Parse the document into H1/H2/H3 sections (preamble = level 0).
  3. Greedy accumulation: add sections to a buffer until the next section would
     overflow MAX_CHUNK_CHARS, then flush the buffer as one chunk.
     H1, H2, and H3 are treated equally — size alone controls flushing.
  4. Oversized single sections (> MAX_CHUNK_CHARS) are split at paragraph
     boundaries. Resulting pieces below MIN_CHUNK_CHARS merge into the preceding.
```

Headings H4–H6 are treated as plain body text and do not create boundaries. No overlaps are added — the heading breadcrumb embedded in each chunk's content provides sufficient context, and overlaps cause duplication when chunks are concatenated for document reconstruction.

### 3.2 Chunk Metadata

Each chunk carries a `heading_path` array anchored to the **first section** in the chunk (relevant when multiple small sections are merged):

```
Document: "AI Agents Overview.md"
├── Chunk 0: heading_path=["Introduction"], heading_level=1
│            (may contain Introduction body + small sub-sections merged in)
├── Chunk 1: heading_path=["Architecture", "Components"], heading_level=2
└── Chunk 2: heading_path=["Future Work"], heading_level=1
```

This heading context helps agents understand where a chunk fits in the larger document, even when viewing a single search result.

### 3.3 Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| MAX_CHUNK_CHARS | 4000 | Target maximum characters per chunk. Sections accumulate up to this limit. |
| MIN_CHUNK_CHARS | 100 | Minimum size for paragraph-level pieces within an oversized section. |

## 4. Embeddings Architecture

### 4.1 Pluggable Embedder Interface

```python
from typing import Protocol

class Embedder(Protocol):
    name: str
    dimensions: int

    def embed(self, text: str) -> list[float]: ...
    def embed_batch(self, texts: list[str]) -> list[list[float]]: ...
```

### 4.2 Available Embedders

| Embedder | Dimensions | Cost | Speed | Quality | Use Case |
|----------|-----------|------|-------|---------|----------|
| OpenAI text-embedding-3-small | 768 | Low (per token) | Fast | Good | Default primary |
| Fireworks AI (nomic-embed-text) | 768 | Low (per token) | Fast | Good | Alternative primary |
| Vertex text-embedding-005 | 768 | Per token | Fast | Best | Future upgrade |

### 4.3 Dual Embedding Strategy

- `embedding_primary`: always computed, uses the configured cloud embedder (OpenAI by default)
- `embedding_upgrade`: optionally computed for "high importance" documents or as a second pass
- Search RPCs accept a flag to choose which embedding to use
- This allows A/B comparison and gradual migration between embedders

## 5. Search & Retrieval

### 5.1 Search RPCs

RPCs exposed via Supabase MCP / Edge Functions:

| RPC | Description |
|-----|-------------|
| `cerefox_hybrid_search` | Chunk-level FTS + vector similarity, returns raw chunks |
| `cerefox_fts_search` | Keyword/exact search only, returns raw chunks |
| `cerefox_semantic_search` | Pure vector similarity, returns raw chunks |
| `cerefox_get_document` | Return full document content + metadata by ID, optionally a specific version |
| `cerefox_list_document_versions` | List available versions for a document (ID, version_number, size, created_at) |

The `cerefox_search` MCP tool (exposed via Edge Function) wraps `cerefox_hybrid_search` and applies automatic threshold-based retrieval assembly — agents never call raw RPCs directly.

### 5.2 Automatic Small-to-Big Retrieval

The `cerefox_search` tool automatically adjusts how results are assembled based on document size. Agents always call the same tool; the threshold logic is internal.

**Decision point**: `total_chars` on the matched document vs `p_small_to_big_threshold` (default: 20000 chars).

```
cerefox_search(query) →
  1. Run hybrid search → get top-N chunk matches (across all documents)
  2. Group matches by document
  3. For each matched document:
     │
     ├─ total_chars ≤ p_small_to_big_threshold (20 000)
     │    └─ Return full document content (current behavior, unchanged)
     │
     └─ total_chars > p_small_to_big_threshold (20 000)
          └─ For each matched chunk in this document:
               - Include the chunk itself
               - Include CEREFOX_CONTEXT_WINDOW chunks before and after (by chunk_index)
             Deduplicate (overlapping windows produce each chunk once)
             Sort by chunk_index
             Include metadata: is_partial=true, chunks_returned/chunks_total
  4. Assemble results respecting MAX_RESPONSE_BYTES
```

**Why automatic (not a parameter)**: agents shouldn't need to know document sizes or manage retrieval strategy. The threshold is a system-level setting, not a per-query choice.

**Implementation location — Postgres only (single-implementation principle)**: all threshold/expansion logic lives in two Postgres RPCs:
- `cerefox_expand_context(p_document_id, p_chunk_ids UUID[], p_context_window INT)` — returns ordered, deduplicated sibling chunks for a set of matched chunk IDs.
- `cerefox_search_docs` — extended with `p_small_to_big_threshold INT` and `p_context_window INT` params. Internally: if `total_chars > threshold`, calls `cerefox_expand_context`; otherwise reconstructs the full document (current behaviour). Returns `is_partial` flag so callers know which path was taken.

Python (`search.py`) and the `cerefox-search` Edge Function are thin pass-throughs that supply the config values as RPC params — no retrieval logic lives outside Postgres. `cerefox-mcp` requires no changes as it already delegates entirely to `cerefox-search`.

**`match_count` semantics**: the parameter controls the number of **distinct documents** returned, not raw chunks. For large documents, each document match expands into multiple chunks (up to `(CEREFOX_CONTEXT_WINDOW * 2 + 1)` chunks per matched chunk hit). The total chunk count returned can exceed `match_count`.

**Context window default (1)**: each matched chunk gains one neighbor on each side — returning 3 contiguous chunks per hit at minimum. Configurable via `CEREFOX_CONTEXT_WINDOW`.

**Metadata in search results**: every result includes:

| Field | Small doc | Large doc |
|-------|-----------|-----------|
| `doc_id` | ✓ | ✓ |
| `title` | ✓ | ✓ |
| `total_chars` | ✓ | ✓ |
| `chunk_count` | ✓ | ✓ |
| `is_partial` | `false` | `true` |
| `chunks_returned` | = chunk_count | < chunk_count |
| `version_count` | ✓ | ✓ |
| `created_at` | ✓ | ✓ |
| `updated_at` | ✓ | ✓ |

`version_count` = number of historical snapshots in `cerefox_document_versions` for this document. `0` means the document has never been updated (no previous versions exist). Agents can use this to decide whether to call `cerefox_list_versions`.

When `is_partial=true`, agents can retrieve the complete document via `cerefox_get_document`.

### 5.3 Full Document Retrieval

A separate primitive from search: retrieve the **complete text** of a specific document by ID, bypassing threshold logic entirely. This is the correct tool for:

- Viewing the full text of a large document that search returns only chunks from
- Retrieving a previous version for comparison or manual restore
- Backup and export pipelines that need complete content
- Agents that need the full document for re-ingestion, translation, or analysis

**MCP tool: `cerefox_get_document`**

Parameters:
- `document_id` (required) — UUID of the document
- `version_id` (optional) — UUID of a specific version; omit for current content

Returns: full `content`, all `metadata`, `created_at`, `updated_at`, and a `versions` summary (count, latest version number, latest version timestamp).

**MCP tool: `cerefox_list_versions`**

Parameters:
- `document_id` (required)

Returns: list of version rows — `id`, `version_number`, `total_chars`, `chunk_count`, `source`, `created_at`.

**REST API**: `GET /api/documents/{id}` and `GET /api/documents/{id}/versions` — same semantics as the MCP tools, for use by the web UI and scripting.

**CLI**: `cerefox get-doc <id>` (current content) and `cerefox get-doc <id> --version <version-id>` (specific version). `cerefox list-versions <id>` lists version history.

### 5.4 Response Size Management

Cerefox uses **opt-in, per-call** size limits. Limits apply only on the MCP and Edge
Function paths where an AI agent's context window matters. The web UI and CLI are always
unlimited.

**Limit semantics**: results are dropped whole (never truncated mid-content) until the
running total fits within the budget. The response includes `truncated: true` and
`response_bytes` metadata when results are dropped.

**Server ceiling model**: agents can request a smaller `max_bytes` budget, but never
a larger one — the server enforces `effective_max = min(agent_max, SERVER_MAX)`.

| Path | Default | Ceiling |
|------|---------|---------|
| Web UI / CLI | No limit | No limit |
| Local MCP server (`cerefox mcp`) | `CEREFOX_MAX_RESPONSE_BYTES` (200 000) | Same |
| Remote MCP (`cerefox-mcp` Edge Function) | 200 000 | 200 000 (TypeScript constant) |
| `cerefox-search` Edge Function (direct) | 200 000 | 200 000 (TypeScript constant) |

**Why 200 KB?** At the default `match_count=5` and small-to-big threshold of 20 000 chars,
worst case is 5 × 20 KB ≈ 100 KB — comfortably under 200 KB. The limit protects against
high `match_count` + large documents without ever cutting legitimate results at defaults.
The original 65 KB default was driven by the Supabase MCP protocol limit, which no longer
applies (Cerefox now uses a dedicated `cerefox-mcp` Edge Function).

**Agent `max_bytes` parameter**: both the local MCP `cerefox_search` tool and the
`cerefox-search` Edge Function accept an optional `max_bytes` parameter. Agents use this
to request a smaller budget when their context window is limited.

Note: `cerefox_get_document` is exempt from this limit (single-document retrieval, not
multi-document search assembly). See `docs/guides/response-limits.md` for the full guide.

### 5.5 Metadata-Filtered Search

Metadata filtering lets callers narrow search results to documents whose `doc_metadata` JSONB
field contains a specific set of key-value pairs, in addition to the normal FTS + vector
ranking. It is a **hard filter** (applied before ranking, not a scoring signal) and is
orthogonal to — and composable with — the project filter and all three search modes (hybrid,
FTS, semantic).

#### Design rationale

`cerefox_documents.doc_metadata` is an open-ended JSONB column. Users and agents add
structured metadata at ingest time (e.g. `{"type": "decision", "project": "cerefox",
"status": "active"}`). Without a filter, agents must retrieve documents and post-filter
client-side. A server-side filter:

- narrows the candidate pool **before** scoring — fewer rows for the vector index to evaluate
- uses the existing `GIN(metadata)` index on `cerefox_documents` — no new schema changes
- returns only relevant documents, reducing token consumption in the agent's context window
- enables workflows like "search for decisions only" or "find all documents tagged research"

#### Filter semantics — JSONB containment (`@>`)

The filter is expressed as a JSON object. A document matches when its `doc_metadata` **contains
all** of the specified key-value pairs:

```
p_metadata_filter = '{"type": "decision", "status": "active"}'

Matches:  {"type": "decision", "status": "active", "project": "cerefox"}
Matches:  {"type": "decision", "status": "active"}
No match: {"type": "decision"}               -- missing "status"
No match: {"type": "note", "status": "active"}  -- wrong value for "type"
```

The PostgreSQL `@>` containment operator is used directly:

```sql
AND (p_metadata_filter IS NULL OR d.doc_metadata @> p_metadata_filter)
```

When `p_metadata_filter` is `NULL` (omitted), the filter clause is vacuously true and
behaviour is identical to today — no regression.

The `GIN(metadata)` index supports `@>` natively, so filtering over large document sets
is efficient even before any vector ranking occurs.

#### SQL: changes to search RPCs

A new optional parameter `p_metadata_filter JSONB DEFAULT NULL` is added to all four
search RPCs. The WHERE clause in each RPC gains one line:

```sql
-- cerefox_hybrid_search, cerefox_fts_search, cerefox_semantic_search, cerefox_search_docs
AND (p_metadata_filter IS NULL OR d.doc_metadata @> p_metadata_filter)
```

No new RPC is created. No schema migration is needed (GIN index already exists).
`db_deploy.py` re-creates all RPCs from `rpcs.sql` on every run — adding the parameter and
WHERE clause is sufficient.

Affected RPCs:

| RPC | Change |
|-----|--------|
| `cerefox_hybrid_search` | Add `p_metadata_filter JSONB DEFAULT NULL`; add `@>` filter |
| `cerefox_fts_search` | Same |
| `cerefox_semantic_search` | Same |
| `cerefox_search_docs` | Same (the primary search path for agents via `cerefox_search` tool) |

#### Layer-by-layer propagation (single-implementation principle)

Every access path passes the filter as an opaque JSON object down to the RPC. No filtering
logic is duplicated in Python or TypeScript.

```
Caller                   Access path              RPC call
──────                   ───────────              ────────
Agent (MCP)          →   cerefox-mcp              delegates to cerefox-search
                     →   cerefox-search Edge Fn   .rpc("cerefox_search_docs", { p_metadata_filter: {...} })
GPT Action           →   cerefox-search Edge Fn   same
Python CLI           →   search.py                client.search_docs(metadata_filter={...})
                     →   client.py                supabase.rpc("cerefox_search_docs", ...)
Web UI               →   /search route            calls client.search_docs(metadata_filter=...)
```

**`cerefox-search` Edge Function** — accepts an optional `metadata_filter` field in the
request body (JSON object or null). Passes it as `p_metadata_filter` to the RPC. No filter
logic in TypeScript.

**`cerefox-mcp` Edge Function** — the `cerefox_search` tool schema gains an optional
`metadata_filter` parameter (`object`, nullable). Passed through to `cerefox-search` in the
internal fetch body. No other changes.

**Local MCP server (`mcp_server.py`)** — `cerefox_search` tool schema gains an optional
`metadata_filter` input property (JSON object). Passed to `client.search_docs()`.

**Python `search.py` / `client.py`** — `search_docs()` gains `metadata_filter: dict | None = None`.
Serialises to JSON when calling the RPC. The `SearchResponse` dataclass is unchanged.

**Python CLI (`cerefox search`)** — gains a `--filter` / `-f` option accepting a JSON string:
`cerefox search "my query" --filter '{"type": "decision"}'`. Parsed with `json.loads()` and
passed to `search_docs()`.

#### Web UI: metadata filter in the Knowledge Browser

The search page (`/app/search`) includes a **Metadata Filter** section
below the Project filter. It is collapsible (hidden by default, expanded when any
filter is active) to keep the UI uncluttered for simple queries.

**Filter UI design:**

```
┌─────────────────────────────────────────────────┐
│  Search  [___________________________]  [Search] │
│                                                  │
│  Mode: ● Hybrid  ○ FTS  ○ Semantic  ○ Docs       │
│                                                  │
│  Project: [All projects ▼]                       │
│                                                  │
│  ▼ Metadata filter  (+ Add filter)               │
│  ┌──────────────────────────────────────────┐   │
│  │  Key [type_________▼]  Value [decision_] │ ✕ │
│  │  Key [status_______▼]  Value [active___] │ ✕ │
│  │  + Add filter row                         │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

Implementation notes:

- Key inputs are `<input>` elements with a `<datalist>` populated by
  `cerefox_list_metadata_keys` (same autocomplete pattern as the ingest form).
- Value inputs are free-text `<input>` elements.
- "Add filter" adds a new key-value row via JavaScript (same pattern as the ingest/edit
  metadata editor).
- Each row has an ✕ button to remove it.
- On form submit, the route collects paired `meta_filter_key[]` / `meta_filter_value[]`
  arrays and assembles `{"key": "value", ...}`. Empty keys or values are ignored.
- If all rows are empty/removed, `metadata_filter` is `None` — no filter applied.
- The assembled filter is passed to `client.search_docs(metadata_filter=...)`.
- Active filter state is managed as React component state and included in search API calls.

**Frontend interaction**: the metadata filter section is part of the `SearchControls`
component in the React SPA. Filter changes update local state; the search is triggered
on form submit. Filters are passed as query parameters to `GET /api/v1/search`.

**API route** (`routes_api.py`):

```python
# In GET /api/v1/search:
meta_filter_keys   = request.query_params.getlist("meta_filter_key")
meta_filter_values = request.query_params.getlist("meta_filter_value")
metadata_filter = {
    k: v for k, v in zip(meta_filter_keys, meta_filter_values) if k and v
} or None

results = await client.search_docs(
    query=query,
    project_id=project_id,
    metadata_filter=metadata_filter,
    ...
)
```

#### OpenAPI schema update (GPT Actions)

The `searchKnowledgeBase` operation in the GPT Actions schema gains a new optional request
body field:

```yaml
metadata_filter:
  type: object
  additionalProperties:
    type: string
  description: >
    Optional JSONB containment filter. Only documents whose metadata contains ALL
    of the specified key-value pairs are returned. Example: {"type": "decision", "status": "active"}.
    Omit or set to null to search all documents.
```

Schema version bumped from v1.3.1 → **v1.4.0** (new optional field, backwards-compatible).

#### MCP tool description update

The `cerefox_search` tool description gains a `metadata_filter` input field:

```
metadata_filter (optional object): JSONB containment filter.
  Restricts results to documents whose metadata contains ALL specified key-value pairs.
  Example: {"type": "decision", "status": "active"}
  Use cerefox_list_metadata_keys first to discover available keys and values.
  Omit to search all documents.
```

#### No changes needed

- `cerefox-ingest` Edge Function — unchanged (filter is search-only)
- `cerefox-mcp` for `cerefox_ingest` / `cerefox_get_document` / `cerefox_list_versions` / `cerefox_list_metadata_keys` — unchanged
- Schema (SQL tables, indexes) — GIN index on `doc_metadata` already exists; no migration needed
- `cerefox_expand_context` RPC — operates on pre-filtered chunk IDs, unaffected

---

## 6. Ingestion Pipeline

### 6.1 Flow

```
Input (MD file, paste, PDF, DOCX)
  ↓
[Convert to Markdown] (if not already MD)
  ↓
[Compute content hash] (dedup check)
  ↓
[IF document exists AND update_if_exists=True AND content changed]
  │
  │  ↓ CALL cerefox_snapshot_version(document_id, source) RPC
  │    → creates version row (version_number = max + 1, metadata/hash snapshot)
  │    → UPDATE cerefox_chunks SET version_id = <new_version_id>
  │         WHERE document_id = <id> AND version_id IS NULL
  │         (archives all current chunks — makes document temporarily empty)
  │    → runs lazy cleanup inline:
  │         DELETE versions WHERE created_at < NOW() - retention_window
  │         AND version_number < max(version_number)  [always-one-backup]
  │         → cascades to delete expired archived chunks
  │    → returns: version_id, archived chunk_count, archived total_chars
  │
  ↓
[Parse markdown structure]
  ↓
[Split into chunks] (heading-based)
  ↓
[Compute embeddings via cloud API] (primary, optionally upgrade)
  ↓
[INSERT new chunks with version_id = NULL] (these are now the current version)
  ↓
[UPDATE cerefox_documents: title, content_hash, chunk_count, total_chars, metadata]
  ↓
[Report status] (success / error event)
```

**Key property**: between `cerefox_snapshot_version` and the new chunk insert, the document temporarily has zero current chunks. This window is short (a single transaction or tight sequence of operations). The document row's `chunk_count` is updated atomically at the end.

**Unified caller pattern**: both the Python pipeline and the TypeScript Edge Functions call `cerefox_snapshot_version` as an RPC before inserting new chunks. No parallel implementations.

### 6.2 Fire-and-Forget Design

Ingestion is designed to be asynchronous and non-blocking:
- CLI/API returns immediately after accepting the input
- Processing happens in background (asyncio task or thread)
- Errors are logged and surfaced in the web UI status panel
- No blocking waits — if embedding takes minutes (large model, big doc), that's fine

### 6.3 Deduplication

- Content hash (SHA-256) computed on raw markdown
- If hash exists in `cerefox_documents.content_hash`, ingestion is skipped (or optionally updates metadata if `update_if_exists=True` and content is identical — skip re-chunking, skip version snapshot since content unchanged)
- This prevents accidental double-ingestion of the same file

### 6.4 Update vs. Create

When `update_if_exists=True`:

| Case | Action |
|------|--------|
| Document not found (by title) | Create new document — no version snapshot needed |
| Document found, content unchanged (same hash) | Update metadata only — no version snapshot, no re-chunking |
| Document found, content changed | `cerefox_snapshot_version` RPC → insert new chunks → update document metadata |

The version snapshot captures the state *before* the update: `content_hash`, `metadata`, `chunk_count`, `total_chars`, and `source` of the outgoing version. Content itself is retained in the archived chunks (no TEXT copy needed).

**Metadata-only updates do not create a version**: when only title or metadata changes (content hash matches), the document is updated directly. No version row is created. This is documented in the web UI and CLI — version history tracks content changes only.

**Title matching note**: there is no `UNIQUE` constraint on `title` in `cerefox_documents`. If multiple documents share the same title (e.g., different versions manually ingested), `update_if_exists` matches the first result (by `created_at` ascending). For reliable update behavior, titles should be treated as unique identifiers by the caller — a convention, not a DB constraint. A uniqueness warning is surfaced when a match returns multiple rows.

## 7. Document Versioning Design

### 7.1 Architecture: Chunks-Anchored Versioning

Versioning is implemented by repurposing `cerefox_chunks` as a unified store for both current and archived content. The `version_id` column on chunks is the single discriminator:

```
version_id IS NULL  →  current version (indexed, searchable, shown in UI)
version_id = <uuid> →  archived version (not indexed, recoverable, lazily deleted)
```

When a document is updated with changed content:
1. `cerefox_snapshot_version(document_id, source)` RPC runs atomically:
   - Creates a `cerefox_document_versions` row (version_number = max+1, metadata/hash snapshot)
   - `UPDATE cerefox_chunks SET version_id = <new_version_id> WHERE document_id = <id> AND version_id IS NULL` — archives all current chunks
   - Runs lazy cleanup (see §7.2)
   - Returns the new version_id so the caller can proceed
2. Caller inserts new chunks with `version_id = NULL` (these become the new current version)
3. Caller updates the document row (content_hash, chunk_count, total_chars, title, metadata)

This RPC is callable from both Python and TypeScript — it is the **single implementation** of the snapshot logic. No parallel Python-vs-TypeScript divergence.

### 7.2 Retention Policy

Versions use a **lazy, retention-based** cleanup policy. No background jobs, no cron. Cleanup runs inside `cerefox_snapshot_version` on every content-changing update.

**Rules** (applied in order):

1. **Always-one-backup**: the most recently created version snapshot (`max(version_number)`) is always retained, regardless of age. A document that is updated daily always has exactly 1 recoverable version.
2. **Time-window retention**: all versions created within the last `CEREFOX_VERSION_RETENTION_HOURS` (default 48) are retained.
3. **Lazy cleanup**: candidates for deletion are versions where `created_at < cutoff AND version_number < max(version_number)`. Deleting a version cascades to its archived chunks via FK.

**Cleanup SQL** (runs inside `cerefox_snapshot_version` after creating the new snapshot):

```sql
DELETE FROM cerefox_document_versions
WHERE document_id = p_document_id
  AND created_at < (NOW() - (p_retention_hours || ' hours')::INTERVAL)
  AND version_number < (
    SELECT MAX(version_number) FROM cerefox_document_versions
    WHERE document_id = p_document_id
  );
-- Cascade: deleted version rows → archived chunks with that version_id are also deleted
```

**Behavior examples:**

| Update pattern | Versions retained |
|---------------|-------------------|
| Updated once per day | Always exactly 1 version (yesterday's chunks) |
| Updated 10× in 2 hours, then no updates for 3 days | All 10 retained for 48h; then reduced to 1 on next update |
| Never updated | No versions, no archived chunks (zero storage cost) |
| Content identical on update | No new version created (dedup check prevents redundant snapshot) |
| Metadata-only update | No new version created (content unchanged) |

### 7.3 What Versions Store

**Version row** (`cerefox_document_versions`):

| Field | Description |
|-------|-------------|
| `version_number` | Monotonically increasing per document (1, 2, 3…) |
| `content_hash` | SHA-256 of content at snapshot time |
| `metadata` | JSONB metadata snapshot at time of displacement |
| `chunk_count` | How many chunks the document had at snapshot time |
| `total_chars` | Character count at snapshot time |
| `source` | Who triggered the update that displaced this version |
| `created_at` | When this version was created (= when the update happened) |

**Version content** (in `cerefox_chunks` WHERE `version_id = <id>`):
Full chunk rows including content, heading_path, and embeddings. Retrieved via:
```sql
SELECT content FROM cerefox_chunks
WHERE version_id = '<version_id>'
ORDER BY chunk_index;
```

### 7.4 Restore Workflow

There is no in-place restore API. Restore is a user operation:

```
1. cerefox_list_document_versions(document_id) → pick target version_id
2. cerefox_get_document(document_id, version_id=<target>) → get old content (from archived chunks)
3. cerefox_ingest(title=<same title>, content=<old content>, update_if_exists=True)
   → snapshots the current (bad) state and installs the old content as the new current
```

This preserves a full audit trail — the "bad" state becomes a version, and the restored content becomes the new current. No data is destroyed.

### 7.5 Why Versions Are Not Searchable

Archived chunks exist in `cerefox_chunks` but are excluded from all search indexes (`WHERE version_id IS NULL` on FTS and HNSW partial indexes). This means:
- Search always operates on current-version content only
- The HNSW index does not grow with version history (predictable performance)
- No search RPC changes are needed to prevent version leakage into results

For time-series or journaling use cases, the correct pattern is **append, not update** — each entry is a separate document. Versioning is a safety net for accidental overwrites, not a temporal search feature.

### 7.6 New RPC: cerefox_snapshot_version

```sql
CREATE FUNCTION cerefox_snapshot_version(
    p_document_id      UUID,
    p_source           TEXT DEFAULT 'manual',
    p_retention_hours  INT  DEFAULT 48
)
RETURNS TABLE (
    version_id      UUID,
    version_number  INT,
    chunk_count     INT,
    total_chars     INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_version_id      UUID;
    v_version_number  INT;
    v_chunk_count     INT;
    v_total_chars     INT;
    v_content_hash    TEXT;
    v_metadata        JSONB;
BEGIN
    -- Read current document state for the snapshot
    SELECT d.content_hash, d.metadata, d.chunk_count, d.total_chars
    INTO v_content_hash, v_metadata, v_chunk_count, v_total_chars
    FROM cerefox_documents d WHERE d.id = p_document_id;

    -- Determine next version_number
    SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_version_number
    FROM cerefox_document_versions WHERE document_id = p_document_id;

    -- Create the version row
    INSERT INTO cerefox_document_versions
        (document_id, version_number, content_hash, metadata, chunk_count, total_chars, source)
    VALUES
        (p_document_id, v_version_number, v_content_hash, v_metadata, v_chunk_count, v_total_chars, p_source)
    RETURNING id INTO v_version_id;

    -- Archive current chunks by pointing them to the new version
    UPDATE cerefox_chunks
    SET version_id = v_version_id
    WHERE document_id = p_document_id AND version_id IS NULL;

    -- Lazy cleanup: delete expired versions (cascade deletes their archived chunks)
    DELETE FROM cerefox_document_versions
    WHERE document_id = p_document_id
      AND created_at < (NOW() - (p_retention_hours || ' hours')::INTERVAL)
      AND version_number < v_version_number;  -- never delete the one we just created

    RETURN QUERY SELECT v_version_id, v_version_number, v_chunk_count, v_total_chars;
END;
$$;
```

## 8. Backup Strategy

### 8.1 Options

| Approach | When | Pros | Cons |
|----------|------|------|------|
| File system | Local deployment | Simple, fast, browsable | Only local |
| Git repo | Any | Versioned, diffable, pushable to remote | Git overhead, large repos |
| Cloud storage | GCP deployment | Durable, scalable | Cost, complexity |

### 8.2 Recommended Approach

- **V1**: File system backup — store raw markdown files in a structured directory
  - `backups/YYYY/MM/document-title-hash.md`
  - Fast, zero cost, works locally
- **V2**: Optional git backup — commit each ingested file to a dedicated git repo
  - Useful for version tracking, can push to GitHub for offsite backup
- **V3**: Cloud storage — if deploying to Cloud Run, use GCS bucket

## 9. Web Application

### 9.1 Technology Choice

React + TypeScript SPA (Mantine UI, TanStack Query, React Router) served by FastAPI at `/app/`.
FastAPI provides the JSON API backend at `/api/v1/`.

Rationale:
- FastAPI is already used for the API layer and MCP integration
- React SPA provides the interactive UI needed for governance workflows (review status, version promotion, audit log browsing)
- Mantine UI provides a comprehensive component library with responsive layout and dark mode support
- TanStack Query handles data fetching, caching, and cache invalidation
- Vite handles the build pipeline with fast HMR during development
- Production: FastAPI serves the built SPA as static assets (single process deployment)

The original Jinja2 + HTMX stack (v0.1.0-v0.1.6) was replaced in Iteration 14.
See `docs/specs/ui-redesign-spa-python-api.md` for the migration design document.

### 9.2 Pages/Features

1. **Dashboard** (`/app/`): stat cards, recent documents table, projects table with doc counts, quick search
2. **Search** (`/app/search`): 4 search modes (docs, hybrid, FTS, semantic), project and metadata filters, Markdown content accordion with Full/Excerpt badges
3. **Document Detail** (`/app/document/:id`): Markdown viewer with Rendered/Raw toggle, collapsible version history, metadata accordion, chunks view, edit/download/delete actions
4. **Document Edit** (`/app/document/:id/edit`): Edit/Preview content toggle, multi-select projects, dynamic metadata key/value editor
5. **Ingest** (`/app/ingest`): two-tab layout (Paste Content / Upload File), project and metadata assignment, filename existence check
6. **Projects** (`/app/projects`): project list with create form, edit modal, delete with confirmation
7. **Project Documents** (`/app/projects/:id/documents`): document listing for a specific project

## 10. MCP Integration

### 10.1 Architecture: Agent Access Paths

Cerefox exposes three access paths, serving different client types:

```
Path 1 — Local stdio MCP (cerefox mcp)
  Desktop clients: Claude Desktop, Cursor, Claude Code
  └── cerefox mcp (local stdio subprocess)
        └── Python SDK → Supabase DB + OpenAI embeddings
              Tools: cerefox_search, cerefox_ingest, cerefox_get_document
  Requires: Python + uv + local repo clone

Path 2 — Remote MCP Edge Function (cerefox-mcp) [RECOMMENDED]
  Claude Code: native --transport http
  Cursor: native url + headers in mcp.json
  Claude Desktop: via supergateway (npx, stdio-to-HTTP bridge)
  └── cerefox-mcp Supabase Edge Function (MCP Streamable HTTP, spec 2025-03-26)
        └── Internal fetch → cerefox-search / cerefox-ingest Edge Functions
              Tools: cerefox_search, cerefox_ingest, cerefox_get_document
  Requires: URL + Supabase anon key; Node.js for Claude Desktop (npx supergateway)
  URL: https://<project>.supabase.co/functions/v1/cerefox-mcp

Path 3 — GPT Actions / HTTP (dedicated Edge Functions)
  Cloud ChatGPT (chatgpt.com)
  └── GPT Actions → Edge Functions (HTTP POST, anon key)
        ├── cerefox-search        (search + embedding)
        ├── cerefox-ingest        (ingest + versioning via RPC)
        ├── cerefox-metadata      (list metadata keys)
        ├── cerefox-get-document  (full document retrieval, current or archived)
        └── cerefox-list-versions (list version history)
              All Edge Functions use service-role key internally; callers use anon key

(Limited) Cloud Claude (claude.ai web)
  └── Remote Supabase MCP (mcp.supabase.com)
        └── execute_sql → cerefox_fts_search RPC
              FTS keyword search only (no server-side embedding)
```

**Key constraint for Path 1**: `cerefox mcp` is a stdio process — it only runs on the local machine. Desktop clients launch it as a subprocess. Cloud clients cannot reach it.

**Path 2 vs Path 1 trade-offs**: Path 2 (remote) requires no local install and works from any machine with just a URL + anon key. Path 1 (local) is slightly faster (no HTTPS round-trip to Supabase) and is preferable if Python + uv are already installed.

### 10.2 MCP Tools

| Tool | Direction | Description |
|------|-----------|-------------|
| `cerefox_search` | Read | Hybrid search (FTS + semantic). Automatically applies small-to-big threshold: returns full doc for small docs, chunks + neighbors for large docs. Always use this for search. |
| `cerefox_ingest` | Write | Save a note or document with full chunking + embedding. Automatically versions previous content if document already exists. |
| `cerefox_get_document` | Read | Retrieve complete document text by ID. Bypasses threshold logic. Optionally specify a version_id for historical content. |
| `cerefox_list_versions` | Read | List available versions for a document (version_number, size, timestamp, source). |
| `cerefox_list_metadata_keys` | Read | Discover metadata keys in use across the knowledge base (key, doc_count, example values). |

**How `cerefox_search` works internally:**
1. Embeds the query with `CloudEmbedder` (OpenAI `text-embedding-3-small`)
2. Calls `cerefox_hybrid_search` RPC — FTS + pgvector cosine similarity
3. Groups results by document
4. For each document: applies threshold logic (full content vs. chunks + neighbors)
5. Returns up to `match_count` documents/chunks, truncating at `max_response_bytes`

**Recommended system prompt for Claude Desktop:**
```
You have access to my personal knowledge base via the cerefox_search tool.
When answering questions in this session, always call cerefox_search first
with a relevant query. Cite doc_title for every claim drawn from the knowledge
base. Use cerefox_ingest to save anything I ask you to save to the knowledge
base (in md format). If search returns partial results for a large document
(is_partial=true), use cerefox_get_document to retrieve the full text.
```

### 10.3 Supabase Edge Functions (HTTP, for GPT Actions / scripts)

The dedicated Edge Functions are deployed to Supabase and callable via HTTP POST with an anon
key. They are the backend for ChatGPT GPT Actions, curl / scripted access, and any HTTP client:

| Edge Function | Operaton | Description |
|--------------|----------|-------------|
| `cerefox-search` | Search | Hybrid FTS + semantic search with server-side embedding |
| `cerefox-ingest` | Write | Ingest/update a document; calls `cerefox_snapshot_version` RPC on update |
| `cerefox-metadata` | Metadata | List all metadata keys across documents |
| `cerefox-get-document` | Read | Full document retrieval (current or archived version) |
| `cerefox-list-versions` | Read | List archived version history for a document |

**Design principle — Edge Function as thin HTTP adapter over Postgres RPC:**

Every Edge Function is a thin HTTP adapter. Business logic lives in Postgres RPCs (SECURITY
DEFINER, service-role access). The Edge Function:
1. Validates the request (required fields, types)
2. Calls the Supabase client with the **service-role key** to execute the RPC
3. Formats and returns the response as JSON

Callers authenticate with the **anon key** (JWT validated by the Supabase API gateway).
The service-role key is never exposed to callers — it is read from `SUPABASE_SERVICE_ROLE_KEY`
at runtime inside the Edge Function.

**Single implementation principle**: each operation is implemented once in a Postgres RPC.
Both the Python pipeline and the TypeScript Edge Functions call the same RPCs — no parallel
implementations. The `cerefox-mcp` Edge Function calls the other dedicated Edge Functions via
internal fetch (not the RPCs directly), keeping the business logic in one place per operation.

For desktop AI clients, the recommended path is the remote `cerefox-mcp` Edge Function (Path
2). The local `cerefox mcp` server (Path 1) is a legacy fallback for offline use.

### 10.4 Postgres RPCs (for direct SQL access)

All search RPCs remain available for direct SQL execution via the Supabase MCP
(`execute_sql` tool) or psql. Useful for cloud Claude.ai (FTS keyword search only):

| RPC | Description |
|-----|-------------|
| `cerefox_fts_search` | Keyword search, returns chunks |
| `cerefox_semantic_search` | Vector search, requires pre-computed embedding |
| `cerefox_hybrid_search` | FTS + vector combined, requires embedding |
| `cerefox_get_document` | Fetch full document by ID; optionally a specific version |
| `cerefox_list_document_versions` | List version history for a document |

### 10.5 Remote MCP Edge Function (`cerefox-mcp`)

`supabase/functions/cerefox-mcp/index.ts` implements the MCP Streamable HTTP transport
(spec 2025-03-26) as a Supabase Edge Function. It is a thin protocol adapter:

- Handles MCP JSON-RPC 2.0 methods: `initialize`, `initialized`, `ping`, `tools/list`, `tools/call`
- For `tools/call`, delegates to the appropriate dedicated Edge Function via internal fetch:
  - `cerefox_search`             → `cerefox-search`
  - `cerefox_ingest`             → `cerefox-ingest`
  - `cerefox_list_metadata_keys` → `cerefox-metadata`
  - `cerefox_get_document`       → `cerefox-get-document`
  - `cerefox_list_versions`      → `cerefox-list-versions`
- Stateless — no session tracking; each request is independent
- Auth: Supabase API gateway validates the JWT (anon key); the caller's Authorization header is forwarded to internal Edge Function calls

## 11. Deployment Topologies

### 11.1 Local Development

```
Local machine
├── Python app (CLI + web UI)
└── Supabase (cloud, free tier)
    └── PostgreSQL + pgvector
        (embeddings via OpenAI API)
```

### 11.2 Full Local

```
Local machine (Docker Compose)
├── Python app container
└── PostgreSQL + pgvector container
    (embeddings via OpenAI API)
```

### 11.3 Cloud (GCP)

```
GCP
├── Cloud Run (Python app)
├── Supabase (managed Postgres)
└── GCS (backups)
```

## 12. Deployment & Operations Scripts

All scripts live in `scripts/` and are standalone Python files. They import from `src/cerefox/` for shared config and DB client logic, but are not part of the application runtime.

### 12.1 Script Inventory

| Script | Purpose | Key flags |
|--------|---------|-----------|
| `db_deploy.py` | Apply full schema to a fresh DB (tables, indexes, extensions, RPCs) | `--dry-run`, `--reset` |
| `db_migrate.py` | Apply incremental migrations (idempotent, tracks applied migrations) | `--dry-run`, `--list` |
| `db_status.py` | Verify schema, check extensions, report table row counts and index health | — |
| `backup_create.py` | Export all documents + metadata to a local directory of markdown files | `--output-dir`, `--project` |
| `backup_restore.py` | Re-ingest a backup directory into a fresh (or existing) database | `--input-dir`, `--dry-run` |

### 12.2 Schema Deployment Flow

```
1. Provision Supabase project (or start local Docker Postgres)
2. Set environment variables (.env file)
3. Run: python scripts/db_deploy.py
   - Creates extensions (pgvector, uuid-ossp)
   - Creates tables (cerefox_projects, cerefox_documents, cerefox_chunks,
                      cerefox_document_versions)
   - Creates indexes (GIN, HNSW, version lookup)
   - Creates triggers (updated_at on documents)
   - Creates RPCs (cerefox_hybrid_search, cerefox_fts_search,
                   cerefox_get_document, cerefox_list_document_versions)
   - Prints summary of created objects
4. Run: python scripts/db_status.py (verify everything is in place)
```

**Migration for existing deployments**: adding `cerefox_document_versions` is a non-destructive `CREATE TABLE` migration. Existing documents and chunks are unaffected. The migration is applied via `db_migrate.py` with migration number `0003_add_document_versions.sql`.

### 12.3 Backup & Restore Flow

```
Backup:
  python scripts/backup_create.py --output-dir ./backup-2026-03-07
  → Creates: ./backup-2026-03-07/
      ├── manifest.json          (metadata: date, doc count, schema version)
      ├── projects.json          (list of projects)
      └── documents/
          ├── <doc-id>.md        (raw markdown content)
          └── <doc-id>.meta.json (document metadata, tags, project)

Restore:
  python scripts/backup_restore.py --input-dir ./backup-2026-03-07
  → Reads manifest, re-ingests all documents preserving metadata
  → Reports: N documents restored, M skipped (already exist), K failed
```

Note: backups export current document content only. Version history is not exported (it is ephemeral by design — retention window applies).

### 12.4 Migration Strategy

Schema changes are applied as numbered SQL files:
```
src/cerefox/db/migrations/
  0001_initial_schema.sql
  0002_add_chunk_heading_level.sql
  0003_add_document_versions.sql
  ...
```
`db_migrate.py` tracks applied migrations in a `cerefox_migrations` table and applies only new ones, in order, idempotently.
