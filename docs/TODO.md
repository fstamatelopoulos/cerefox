# Cerefox TODO & Ideas Backlog

> **⚠ Outdated — pending a full cleanup pass.** This backlog has only been
> partially reconciled against the code (most recently during the v0.9.3 doc
> sweep, when the clearly-shipped entries were removed). Some remaining items
> may already be implemented or obsolete. Verify against the current codebase
> and `plan.md` before picking anything up.

> Active work is tracked in `plan.md`. This file captures ideas, future enhancements,
> and tasks that aren't yet scheduled into an iteration.

---

## Known Tasks (Not Yet Scheduled)

### Data Safety
- [ ] **Metadata versioning / recovery** — version snapshots capture content only;
  a metadata wipe is unrecoverable (bit us in the v0.11.1 incident). Proposal with
  options (audit-log before/after values, and/or metadata on version rows):
  [`docs/research/metadata-versioning.md`](research/metadata-versioning.md).

### Search & Ranking
- [ ] Reciprocal Rank Fusion (RRF) for hybrid search instead of linear alpha blending
- [ ] True BM25 ranking via pg_textsearch or ParadeDB extension
- [ ] Query embedding caching (avoid re-embedding repeated queries)
- [ ] Search result re-ranking with cross-encoder models or LLM-based reranking (see vision doc)
- [ ] Multi-language FTS support (beyond English tsvector config)

### Embeddings
- [ ] Vertex AI text-embedding-005 embedder (add as another cloud provider)
- [ ] Benchmark: compare retrieval quality across OpenAI vs Fireworks embedders on real data
- [ ] Matryoshka/PCA dimensionality reduction for models that don't output 768-dim

### Ingestion
- [ ] **Bug: rollback document insert if embedding/chunk-insert fails** -- currently if the pipeline crashes after inserting the document row but before inserting chunks, the document exists with no chunks and subsequent retries are silently skipped as duplicates. Fix: delete the document row on any exception after insert, or use a DB transaction.
- [ ] Support ingesting from URLs (fetch page, convert to markdown)
- [ ] EPUB to Markdown converter
- [ ] HTML to Markdown converter (for saved web pages)
- [ ] Watch folder mode (auto-ingest new files dropped into a directory)
- [ ] **Refactor `sync_docs.py` to use the Edge Function path** -- currently uses the local `IngestionPipeline` (Python chunker + direct embedding API call), which is a separate implementation from the `cerefox-ingest` Edge Function (TypeScript chunker). This violates the single implementation principle. Switch to calling the `cerefox-ingest` Edge Function via HTTP (Cerefox access token auth, `CEREFOX_ACCESS_TOKEN`).

### Writing Layer Adapters (input sources)
These are "input adapters" -- Cerefox is the backend, these tools are the authoring front-end. The integration is always one-way: writing tool to Cerefox (not the reverse).
- [ ] Obsidian vault adapter -- `cerefox sync --source obsidian --vault ~/Documents/MyVault` does a one-shot ingest of all vault files; `cerefox watch --vault` watches for changes and ingests incrementally. No Obsidian plugins needed, just plain folder access.
- [ ] Notion export adapter (parse Notion HTML/MD export format)
- [ ] Logseq vault adapter (Logseq stores as `.md` files with some syntax quirks)
- [ ] Incremental re-ingestion (detect changes in a file, update only changed chunks)

### Retrieval
- [ ] Retrieval chain: search, expand, summarize (multi-step RPC)
- [ ] Citation/source tracking in retrieved content
- [ ] Relevance feedback loop (mark results as relevant/irrelevant to improve ranking)

### Web UI
- [ ] Pagination for document lists -- project documents page currently caps at 100 docs; add page controls or infinite-scroll for large projects
- [ ] **"No Project Assigned" row in dashboard** -- show a row in the Projects table for documents not in any project
- [ ] Search-as-you-type (debounced query)
- [ ] Chunk boundary visualization in document viewer
- [ ] Bulk operations (tag multiple docs, move to project, delete) -- deferred from 14C.3
- [ ] Mobile-responsive layout improvements
- [ ] Side-by-side diff view (requires table-based layout with paired rows for alignment)

### Audit & Governance
- [ ] Audit log entries for project operations (create, edit, delete) -- currently only document operations are tracked
- [ ] Audit log FTS query integration -- FTS index exists on description column but no dedicated search endpoint
- [ ] Automated knowledge processing via external LLM (anomaly detection, consistency checking, staleness assessment) -- see vision doc

### Infrastructure
- [ ] Row-Level Security (RLS) policies for multi-user future
- [ ] Rate limiting on API endpoints
- [ ] Usage statistics (docs stored, searches performed, storage used)
- [ ] **Local Supabase dev environment** -- set up a full local Supabase stack for offline development and Edge Function testing. Moved from iteration plan to backlog.
- [ ] **Validate Docker/local deployment** -- `Dockerfile` and `docker-compose.yml` have never been tested end-to-end. Low priority.
- [ ] **Standalone binaries** (`cerefox`, `cerefox.exe`) per design doc §6d "Phase 2". Bundle Bun/Node runtime + JS code into a single executable per OS/arch (macOS-arm64, macOS-x86_64, Linux-x86_64, Windows-x86_64). ~70 MB per binary, ~280 MB total per release. Eliminates the Node/Bun install step for end users. **Deferred** beyond v1.0 per 2026-05-29 maintainer call (Fotis-23): the complexity (cross-compile gotchas, code-signing — $99/year Apple Developer Program for macOS, security concerns around bundling runtimes) doesn't justify the friction reduction for Cerefox's tech-savvy user base. Revisit if a real demand surfaces post-v1.0.

### Backup & Sync
- [ ] Scheduled automatic backups
- [ ] Backup verification (compare DB state with backup)
- [ ] Sync between local Postgres and Supabase

### MCP & Agent Integration
- [ ] Usage analytics (which tools agents call most, common query patterns)
- [ ] **OpenClaw** integration -- track once the tool matures
- [ ] Perplexity -- web connector confirmed broken (GoTrue OAuth conflict). Desktop app + local stdio MCP untested. Low priority: Perplexity moving away from MCP.

---

## Ideas & Research

### Automated Knowledge Processing (see vision doc)
- Optional LLM-based judge for anomaly detection, consistency checking, knowledge enhancement
- Automated summarization and consolidation of redundant documents
- Knowledge graph overlay (lightweight `cerefox_edges` table for document relationships)
- Context bundles: pre-composed packages of knowledge for specific projects or domains

### UX
- Browser extension for quick capture (clip a paragraph, ingest)
- Mobile app for quick note capture
- Telegram/Slack bot for quick note input
- Voice note transcription to markdown to ingest

### Performance
- Query plan analysis for search RPCs
- Connection pooling optimization
- Batch embedding optimization (process multiple chunks in one model call)
