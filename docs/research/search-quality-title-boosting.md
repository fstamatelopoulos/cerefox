# Search Quality: Title Boosting and Contextual Chunk Enrichment

*Research date: 2026-03-30*

## Problem Statement

Cerefox currently does not include document titles in search indexes. The title lives on
`cerefox_documents.title` but is not part of any chunk's FTS tsvector or embedding. If a
user searches for a document by its exact title, FTS won't find it unless the title words
happen to appear in the body text.

This is a significant search quality gap for a knowledge management system where agents
and users frequently search by document name.

## Research Findings

### PostgreSQL Full-Text Search: Weighted Title Boosting

The standard PostgreSQL approach for multi-field search is weighted tsvector using
`setweight()`. PostgreSQL supports four weights (A, B, C, D) where A is highest priority.

```sql
-- Standard pattern: title at weight A, content at weight B
setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', content), 'B')
```

PostgreSQL's `ts_rank` and `ts_rank_cd` natively score weight A terms ~10x higher than
weight D. A title match on "Disney" would score dramatically higher than a passing mention
in the body.

**Sources:**
- [PostgreSQL setweight documentation](https://www.postgresql.org/docs/current/textsearch-controls.html)
- [Postgres Full-Text Search: A Search Engine in a Database (Crunchy Data)](https://www.crunchydata.com/blog/postgres-full-text-search-a-search-engine-in-a-database)
- [Advanced Search Engine with PostgreSQL (Xata)](https://xata.io/blog/postgres-full-text-search-engine)
- [Using setweight to Prioritize Fields (Sling Academy)](https://www.slingacademy.com/article/using-setweight-to-prioritize-fields-in-postgresql-full-text-search/)

### RAG Chunking: Contextual Retrieval

Anthropic introduced "contextual retrieval" in 2024 -- prepending document-level context
(title, heading path, short summary) to each chunk before embedding. This makes chunks
self-contained for vector search, so the embedding captures both the chunk's specific
content and its relationship to the parent document.

Cerefox already stores `heading_path` per chunk (a form of contextual enrichment). Adding
the document title to the chunk content before embedding would complete this pattern.

**Sources:**
- [Document Chunking for RAG: 9 Strategies Tested (LangCopilot)](https://langcopilot.com/posts/2025-10-11-document-chunking-for-rag-practical-guide)
- [Best Chunking Strategies for RAG 2026 (Firecrawl)](https://www.firecrawl.dev/blog/best-chunking-strategies-rag)
- [Chunking Strategies (Weaviate)](https://weaviate.io/blog/chunking-strategies-for-rag)

### Industry Consensus (2025-2026)

The consensus across PostgreSQL, RAG, and knowledge base literature is:

1. **FTS**: use weighted tsvector with title at weight A and content at weight B
2. **Semantic search**: prepend document context (title, heading path) to chunk text before embedding
3. **Don't use a separate title index** -- merging results from two separate indexes requires complex cross-score ranking. The weighted tsvector handles this natively in one pass.

## Proposed Solution for Cerefox

### Tier 1: Weighted FTS with Title Boosting

**Change**: replace the current GENERATED tsvector column on `cerefox_chunks` with one that
includes the parent document's title at weight A.

**Current** (schema.sql):
```sql
fts tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
```

**Proposed**: compute the tsvector at ingestion time (not GENERATED) so it can include the
parent document's title:
```sql
fts tsvector  -- no longer GENERATED; set by the ingestion pipeline
```

At ingestion time (in `cerefox_ingest_document` RPC or the Python/TypeScript chunking pipeline):
```sql
setweight(to_tsvector('english', doc_title), 'A') || setweight(to_tsvector('english', chunk_content), 'B')
```

**Why not GENERATED**: a GENERATED column can only reference columns in the same row. The
document title lives in `cerefox_documents`, not `cerefox_chunks`. A trigger could work but
adds complexity. Computing the tsvector at ingestion time is simpler and consistent with how
embeddings are already computed (at ingestion, not generated).

**Trade-off**: if a document title is changed without re-ingesting, the FTS index becomes
stale. This is acceptable because title changes are rare and `cerefox reindex` can fix it.

### Tier 2: Contextual Chunk Enrichment for Semantic Search

**Change**: prepend `# {title}\n` to chunk text before computing embeddings.

In the chunking pipeline (both Python `chunkMarkdown()` and TypeScript `chunkMarkdown()`),
before calling the embedding API:

```python
embedding_text = f"# {doc_title}\n{chunk.content}"
embedding = embedder.embed(embedding_text)
```

The stored `chunk.content` remains unchanged (for reconstruction). Only the embedding
input includes the title prefix. This means:
- Vector search captures the title's semantic meaning
- Document reconstruction (`STRING_AGG(content, ...)`) is unaffected
- The title is not duplicated in stored content

### Tier 3: Hybrid Approach (Recommended)

Implement both Tier 1 and Tier 2 together:

1. **FTS index**: `setweight(title, 'A') || setweight(content, 'B')` -- title matches rank highest
2. **Embeddings**: prepend `# {title}\n` to chunk content for embedding computation
3. **Stored content**: unchanged (for clean document reconstruction)

### Migration Path

1. **Schema migration**: change `fts` column from GENERATED to regular tsvector
2. **Tsvector computation (Option B -- decided)**: computed inside `cerefox_ingest_document` RPC
   using the `p_title` parameter it already receives -- no pre-computed tsvector passed from caller,
   no denormalization of title into `cerefox_chunks`, no trigger needed. Python and TypeScript
   callers only need to handle the embedding prefix (17A.2, 17A.4, 17A.5).
3. **Embedding prefix**: both Python `IngestionPipeline` and TypeScript ingest handlers prepend
   `# {title}\n` before calling the embedding API; stored `content` unchanged
4. **Reindex existing documents (optional)**: `scripts/reindex_all.py` re-embeds and updates
   tsvectors for all current documents. Not required -- new documents get title boosting
   automatically; old documents work without it until reindexed. Archived chunks are NOT
   reindexed (excluded from search; manual re-ingestion required if restored).
5. **RPC updates**: search RPCs need no changes -- `ts_rank` natively respects the A/B weights
   encoded in the tsvector

### Reindex Script

The existing `cerefox reindex` command (updated to use the new pipeline) re-chunks,
re-embeds with title prefix, and replaces current chunks via `cerefox_ingest_document`.
`scripts/reindex_all.py` is a convenience wrapper for reindexing all documents in sequence.

Reindexing is **optional**. Only current-version chunks are reindexed. Archived chunks are
deliberately skipped -- they are excluded from all search indexes and if a specific version
ever needs to be restored, re-ingestion is required anyway (the same process also reindexes).

### Title Change Behavior (decided)

When a document's title is updated without a content change, the FTS index and embeddings
for existing chunks reference the old title. Rather than requiring manual reindex, the
pipeline auto-updates when a title change is detected:

1. Detect title changed (old title != new title) in `update_document()`
2. Re-embed all current chunks with new title prefix (external API call, one per chunk)
3. Call `cerefox_update_chunk_fts(document_id, new_title)` RPC to update FTS in-place
4. No version snapshot (content unchanged), audit entry records the title change

**Trade-offs**:
- Title-only edits now involve an embedding API call -- adds latency proportional to doc size
- Cost is small (a few small API calls per document) and predictable
- The alternative (stale indexes until manual reindex) is worse UX for a frequent operation

### Impact on Existing Features

| Feature | Impact |
|---------|--------|
| FTS search | Improved -- title matches rank highest |
| Semantic search | Improved -- embeddings capture title meaning |
| Hybrid search | Improved -- both FTS and vector benefit |
| Small-to-big retrieval | No change -- operates on chunks as before |
| Document reconstruction | No change -- stored content unchanged |
| Metadata search | No change -- doesn't use FTS or embeddings |
| Version archival | Minor -- archived chunks retain old tsvectors (acceptable) |

### Estimated Effort

- Schema migration: small (column type change + trigger or ingestion logic)
- Python pipeline update: medium (tsvector computation + embedding prefix)
- TypeScript pipeline update: medium (same changes in Edge Function and MCP)
- Reindex script update: small (already exists, just needs the new pipeline)
- RPC updates: small (possibly none if ts_rank works the same)
- Tests: medium (search quality tests, regression tests)
- Total: one focused iteration
