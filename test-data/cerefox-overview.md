# Cerefox Test Document

This document is used to verify that ingestion, chunking, search, and deletion all work correctly end-to-end.

## What Is a Second Brain

A second brain is an external system for storing and retrieving knowledge. Instead of relying on memory alone, you offload notes, ideas, and references to a trusted repository. The concept was popularised by Tiago Forte and draws on earlier ideas from Getting Things Done and Zettelkasten.

Key benefits:
- Reduces cognitive load
- Surfaces connections between ideas
- Persists knowledge across time and context switches

## Search and Retrieval

### Full-Text Search

Full-text search (FTS) works by indexing words and matching them against a query. It is fast and exact — good for finding documents when you remember a specific term. Postgres implements FTS via tsvector and tsquery, which support stemming and stop words.

### Semantic Search

Semantic search uses vector embeddings to find documents by meaning rather than keywords. A query like "storing ideas outside the mind" should find documents about second brains even if those exact words do not appear. This requires an embedding model — Cerefox uses OpenAI `text-embedding-3-small` (768-dim) by default.

### Hybrid Search

Hybrid search combines both approaches. A weighted score (alpha parameter) blends FTS and semantic rankings. Alpha 0.0 is pure FTS, 1.0 is pure semantic. A value around 0.5–0.7 works well for most knowledge base queries.

## Chunking Strategy

Documents are split into chunks at heading boundaries. Each chunk inherits a breadcrumb path from its parent headings (e.g. `["Cerefox Test Document", "Search and Retrieval", "Semantic Search"]`). This preserves context that would otherwise be lost when a chunk is retrieved in isolation.

Large sections that exceed the character limit are further split at paragraph boundaries, with a small overlap to maintain continuity.

## Projects and Organization

Documents can be grouped into projects. A project might represent a domain (work, personal, research) or a specific endeavour. Projects are optional — documents without a project are accessible globally.

## Conclusion

If this document was ingested, chunked, embedded, and is now searchable, the Cerefox pipeline is working correctly. It should be deleted after testing.
