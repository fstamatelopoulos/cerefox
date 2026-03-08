# Cerefox Solution Design

## 1. System Overview

Cerefox is a **cloud-native personal knowledge backend** — it stores, indexes, and serves a single user's knowledge to AI agents via MCP. It is *not* a note-taking app; it is the retrieval and access layer that sits behind whichever writing tool the user prefers.

**Layer model:**
```
[Writing layer]   Obsidian, Bear, Notion, plain files, agent write-back
                        ↓ (ingest: CLI, folder sync, upload, MCP write)
[Cerefox layer]   Chunking → Embeddings → Supabase (Postgres + pgvector)
                        ↓ (MCP tools: search, retrieve, write)
[Agent layer]     Claude, Cursor, ChatGPT, custom agents — anywhere
```

The web UI covers management (browse, metadata, projects) and ingestion (upload, paste). It deliberately has no rich authoring features — that's the writing layer's responsibility.

```
┌─────────────────────────────────────────────────────────────────┐
│                        AI Agents                                │
│  Claude ─ Cursor ─ ChatGPT ─ Custom Agents ─ OpenClaw          │
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
│  └─────────────────┘  └──────────────────┘  └───────────────┘  │
│                                                                  │
│  RPCs: hybrid_search ─ fts_search ─ semantic_search             │
│        reconstruct_doc ─ expand_context                          │
└─────────────────────────────────────────────────────────────────┘
                           ▲
                           │
┌──────────────────────────┴──────────────────────────────────────┐
│                   Ingestion Layer                                │
│                                                                  │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌─────────────┐ │
│  │   CLI    │   │  Web UI  │   │Converters│   │  Embedders  │  │
│  │(click)   │   │(FastAPI) │   │PDF→MD    │   │mpnet/ollama │  │
│  │          │   │          │   │DOCX→MD   │   │vertex/openai│  │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘   └──────┬──────┘ │
│       └───────────────┴──────────────┴────────────────┘         │
│                           │                                      │
│                   Ingestion Pipeline                             │
│            (parse → chunk → embed → store)                      │
└─────────────────────────────────────────────────────────────────┘
```

## 2. Data Model

### 2.1 Design Rationale: Two-Table Schema

The original spec used a single `cerefox_notes` table. This design splits into **documents** and **chunks** for several reasons:

- **Document lifecycle**: delete/update a whole document cleanly (cascade deletes its chunks)
- **Small-to-big retrieval**: find a chunk, then efficiently pull its siblings
- **Document-level metadata**: tags, project, source — live on the document, not duplicated per chunk
- **Deduplication**: content hash on documents prevents re-ingesting the same file

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

One row per ingested document (markdown file, pasted note, etc.).

```sql
CREATE TABLE cerefox_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',     -- 'file', 'web', 'paste', 'api'
  source_path TEXT,                           -- original file path or URL
  content_hash TEXT NOT NULL,                 -- SHA-256 of raw content for dedup
  project_id UUID REFERENCES cerefox_projects(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  -- Example metadata:
  -- {"tags": ["AI", "agents"], "category": "research",
  --  "importance": "high", "author": "fotis"}
  chunk_count INT DEFAULT 0,
  total_chars INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(content_hash)
);
```

#### cerefox_chunks

One row per chunk of a document. This is where embeddings and FTS live.

```sql
CREATE TABLE cerefox_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES cerefox_documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  heading_path TEXT[],                        -- e.g., ARRAY['Overview', 'Architecture']
  heading_level INT,                          -- deepest heading level (1, 2, 3)
  title TEXT,                                 -- section heading text
  content TEXT NOT NULL,
  char_count INT NOT NULL,

  -- Embeddings (768 dims)
  embedding_primary VECTOR(768) NOT NULL,     -- default: all-mpnet-base-v2
  embedding_upgrade VECTOR(768),              -- optional: Ollama/Vertex/OpenAI

  -- Full Text Search
  fts tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
    setweight(to_tsvector('english', content), 'B')
  ) STORED,

  -- Embedder tracking
  embedder_primary TEXT NOT NULL DEFAULT 'all-mpnet-base-v2',
  embedder_upgrade TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(document_id, chunk_index)
);
```

#### Indexes

```sql
-- FTS
CREATE INDEX idx_cerefox_chunks_fts ON cerefox_chunks USING GIN(fts);

-- Vector similarity (HNSW)
CREATE INDEX idx_cerefox_chunks_emb_primary
  ON cerefox_chunks USING hnsw (embedding_primary vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_cerefox_chunks_emb_upgrade
  ON cerefox_chunks USING hnsw (embedding_upgrade vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Metadata and lookups
CREATE INDEX idx_cerefox_docs_metadata ON cerefox_documents USING GIN(metadata);
CREATE INDEX idx_cerefox_docs_project ON cerefox_documents(project_id);
CREATE INDEX idx_cerefox_chunks_doc ON cerefox_chunks(document_id, chunk_index);
```

### 2.3 Entity Relationships

```
cerefox_projects (1) ──< (many) cerefox_documents (1) ──< (many) cerefox_chunks
```

- A project has many documents
- A document has many chunks (ordered by chunk_index)
- Deleting a document cascades to its chunks
- Deleting a project nullifies project_id on its documents (SET NULL)

## 3. Chunking Strategy

### 3.1 Heading-Based Splitting

All content is markdown. The chunker splits at heading boundaries to preserve semantic coherence:

```
Priority cascade:
  1. Split at H1 (# ) boundaries
  2. Within each H1 section, split at H2 (## ) boundaries
  3. If any resulting chunk exceeds MAX_CHUNK_CHARS, split at H3 (### )
  4. If still too large, split at paragraph boundaries with overlap
```

### 3.2 Chunk Metadata

Each chunk carries a `heading_path` array that records its position in the document hierarchy:

```
Document: "AI Agents Overview.md"
├── Chunk 0: heading_path=["Introduction"], heading_level=1
├── Chunk 1: heading_path=["Architecture", "Components"], heading_level=2
├── Chunk 2: heading_path=["Architecture", "Data Flow"], heading_level=2
└── Chunk 3: heading_path=["Future Work"], heading_level=1
```

This heading context helps agents understand where a chunk fits in the larger document, even when viewing a single search result.

### 3.3 Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| MAX_CHUNK_CHARS | 4000 | Max characters per chunk before fallback splitting |
| MIN_CHUNK_CHARS | 100 | Minimum chunk size (merge small sections upward) |
| OVERLAP_CHARS | 200 | Overlap when splitting at paragraph level |

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
| all-mpnet-base-v2 | 768 | Free (local) | Fast | Good | Default primary |
| nomic-embed-text (Ollama) | 768 | Free (local) | Medium | Good | Alternative primary |
| mxbai-embed-large (Ollama) | 1024→768* | Free (local) | Slower | Better | Upgrade embedder |
| Vertex text-embedding-005 | 768 | API cost | Fast | Best | Future upgrade |

*Models with different dimensions will use Matryoshka truncation or PCA projection to 768 dims.

### 4.3 Dual Embedding Strategy

- `embedding_primary`: always computed, uses the configured default embedder (local, free)
- `embedding_upgrade`: optionally computed for "high importance" documents or as a second pass
- Search RPCs accept a flag to choose which embedding to use
- This allows A/B comparison and gradual migration between embedders

## 5. Search & Retrieval

### 5.1 Search RPCs

Four main RPCs exposed via Supabase MCP:

1. **`cerefox_hybrid_search`** — fuses FTS and vector similarity with configurable alpha weight
2. **`cerefox_fts_search`** — keyword/exact search only (names, dates, tags)
3. **`cerefox_semantic_search`** — pure vector similarity (conceptual questions)
4. **`cerefox_reconstruct_doc`** — reassemble a full document from its chunks

### 5.2 Small-to-Big Retrieval

When a search returns chunks, agents often need more context. The retrieval strategy:

```
1. Chunk-level search (fast, targeted)
     ↓
2. For top results, identify parent documents
     ↓
3. Expand to include sibling chunks from same document
     ↓
4. Assemble expanded content, respecting MAX_RESPONSE_BYTES
     ↓
5. Return with metadata indicating what was included/truncated
```

**Algorithm (V1 - simplified):**
- Return individual chunks with `document_id` in metadata
- Agent can call `cerefox_reconstruct_doc` for full document context
- Response size is checked against `MAX_RESPONSE_BYTES` (default: 65000)

**Algorithm (V2 - planned):**
- `cerefox_expand_context` RPC: given a chunk ID, return the chunk plus N adjacent siblings
- Automatically assemble content that fits within response limit
- Track total bytes, stop adding when limit approached

### 5.3 Response Size Management

Supabase MCP has a ~65K bytes limit on responses. This is parameterized:

- `MAX_RESPONSE_BYTES` config setting (default: 65000)
- RPCs that return content check accumulated size
- When limit is near, response includes a `truncated: true` flag and `remaining_chunks: N` count
- Agent can make follow-up calls to retrieve remaining content

## 6. Ingestion Pipeline

### 6.1 Flow

```
Input (MD file, paste, PDF, DOCX)
  ↓
[Convert to Markdown] (if not already MD)
  ↓
[Compute content hash] (dedup check)
  ↓
[Parse markdown structure]
  ↓
[Split into chunks] (heading-based)
  ↓
[Compute embeddings] (primary, optionally upgrade)
  ↓
[Store document + chunks in DB]
  ↓
[Backup raw markdown] (file system / git)
  ↓
[Report status] (success / error event)
```

### 6.2 Fire-and-Forget Design

Ingestion is designed to be asynchronous and non-blocking:
- CLI/API returns immediately after accepting the input
- Processing happens in background (asyncio task or thread)
- Errors are logged and surfaced in the web UI status panel
- No blocking waits — if embedding takes minutes (large model, big doc), that's fine

### 6.3 Deduplication

- Content hash (SHA-256) computed on raw markdown
- If hash exists in `cerefox_documents`, ingestion is skipped (or optionally updates metadata)
- This prevents accidental double-ingestion of the same file

## 7. Backup Strategy

### 7.1 Options

| Approach | When | Pros | Cons |
|----------|------|------|------|
| File system | Local deployment | Simple, fast, browsable | Only local |
| Git repo | Any | Versioned, diffable, pushable to remote | Git overhead, large repos |
| Cloud storage | GCP deployment | Durable, scalable | Cost, complexity |

### 7.2 Recommended Approach

- **V1**: File system backup — store raw markdown files in a structured directory
  - `backups/YYYY/MM/document-title-hash.md`
  - Fast, zero cost, works locally
- **V2**: Optional git backup — commit each ingested file to a dedicated git repo
  - Useful for version tracking, can push to GitHub for offsite backup
- **V3**: Cloud storage — if deploying to Cloud Run, use GCS bucket

## 8. Web Application

### 8.1 Technology Choice

FastAPI + Jinja2 + HTMX for a lightweight, interactive web UI with no JavaScript build step.

Rationale:
- FastAPI is already used for the API layer
- Jinja2 templates are simple and maintainable
- HTMX provides interactivity (search-as-you-type, partial page updates) without a JS framework
- Can be deployed locally or on Cloud Run with minimal config

### 8.2 Pages/Features

1. **Dashboard**: recent documents, ingestion status, project counts
2. **Knowledge Browser**: search and navigate stored content by project, tags, date
3. **Document Viewer**: view a reconstructed document with its chunks highlighted
4. **Ingest**: upload markdown files or paste content
5. **Projects/Metadata**: manage projects, view/edit metadata schema
6. **Status**: ingestion queue, errors, system health

## 9. MCP Integration

### 9.1 Supabase MCP (Primary)

Supabase natively exposes Postgres RPCs as MCP tools. This means:
- Define RPCs in Postgres → automatically available via MCP
- No custom MCP server needed for V1
- Any agent that supports MCP can connect to Cerefox

### 9.2 MCP Tool Inventory

| Tool (RPC) | Direction | Description |
|------------|-----------|-------------|
| `cerefox_hybrid_search` | Read | Fused FTS + semantic search |
| `cerefox_fts_search` | Read | Keyword/exact search |
| `cerefox_semantic_search` | Read | Pure vector similarity |
| `cerefox_reconstruct_doc` | Read | Reassemble full document from chunks |
| `cerefox_save_note` | **Write** | Agent saves a note/insight into the knowledge base |

### 9.3 Agent Write: `cerefox_save_note`

Agents are first-class contributors to the knowledge base, not just consumers. The write tool lets an agent save a note, research summary, or insight directly — without the user needing to manually ingest it.

**RPC signature (conceptual):**
```sql
CREATE OR REPLACE FUNCTION cerefox_save_note(
  p_title TEXT,
  p_content TEXT,                    -- Markdown content
  p_agent_name TEXT,                 -- e.g. 'claude-3-7-sonnet'
  p_project_name TEXT DEFAULT NULL,  -- optional project association
  p_tags TEXT[] DEFAULT '{}',        -- optional tags
  p_agent_session_id TEXT DEFAULT NULL,
  p_confidence NUMERIC DEFAULT NULL  -- agent's self-assessed confidence (0–1)
)
RETURNS UUID  -- returns the new document_id
```

**How it works:**
1. Agent calls `cerefox_save_note` with content and its identity
2. Supabase RPC creates a document record with `source = 'agent'`, `created_by = 'ai-agent'`
3. Content is chunked and embedded asynchronously (or synchronously in V1)
4. Returns the document ID for the agent's reference

**Agent metadata stored:**
```json
{
  "source": "agent",
  "created_by": "ai-agent",
  "agent_name": "claude-3-7-sonnet",
  "agent_session_id": "optional-session-id",
  "tags": ["summary", "research"],
  "confidence": 0.9
}
```

This metadata makes it easy to later filter agent-contributed content (e.g., "only search human-authored notes") or audit what agents have added.

### 9.4 Custom MCP Server (Future)

For enhanced capabilities beyond what Supabase MCP provides:
- Query embedding computation on the server side (agents don't need their own embedder)
- Smarter small-to-big context assembly in a single tool call
- Rate limiting, usage tracking
- Multi-tool workflows (search + expand + format in one call)

## 10. Deployment Topologies

### 10.1 Local Development

```
Local machine
├── Python app (CLI + web UI)
├── Ollama (embedding models)
└── Supabase (cloud, free tier)
    └── PostgreSQL + pgvector
```

### 10.2 Full Local

```
Local machine (Docker Compose)
├── Python app container
├── Ollama container
└── PostgreSQL + pgvector container
```

### 10.3 Cloud (GCP)

```
GCP
├── Cloud Run (Python app)
├── Supabase (managed Postgres)
└── GCS (backups)
```

## 11. Deployment & Operations Scripts

All scripts live in `scripts/` and are standalone Python files. They import from `src/cerefox/` for shared config and DB client logic, but are not part of the application runtime.

### 11.1 Script Inventory

| Script | Purpose | Key flags |
|--------|---------|-----------|
| `db_deploy.py` | Apply full schema to a fresh DB (tables, indexes, extensions, RPCs) | `--dry-run`, `--reset` |
| `db_migrate.py` | Apply incremental migrations (idempotent, tracks applied migrations) | `--dry-run`, `--list` |
| `db_status.py` | Verify schema, check extensions, report table row counts and index health | — |
| `backup_create.py` | Export all documents + metadata to a local directory of markdown files | `--output-dir`, `--project` |
| `backup_restore.py` | Re-ingest a backup directory into a fresh (or existing) database | `--input-dir`, `--dry-run` |

### 11.2 Schema Deployment Flow

```
1. Provision Supabase project (or start local Docker Postgres)
2. Set environment variables (.env file)
3. Run: python scripts/db_deploy.py
   - Creates extensions (pgvector, uuid-ossp)
   - Creates tables (cerefox_projects, cerefox_documents, cerefox_chunks)
   - Creates indexes (GIN, HNSW)
   - Creates triggers (updated_at)
   - Creates RPCs (cerefox_hybrid_search, cerefox_fts_search, etc.)
   - Prints summary of created objects
4. Run: python scripts/db_status.py (verify everything is in place)
```

### 11.3 Backup & Restore Flow

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

### 11.4 Migration Strategy

Schema changes are applied as numbered SQL files:
```
src/cerefox/db/migrations/
  0001_initial_schema.sql
  0002_add_chunk_heading_level.sql
  ...
```
`db_migrate.py` tracks applied migrations in a `cerefox_migrations` table and applies only new ones, in order, idempotently.
