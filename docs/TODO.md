# Cerefox TODO & Ideas Backlog

> Active work is tracked in `plan.md`. This file captures ideas, future enhancements,
> and tasks that aren't yet scheduled into a phase.

---

## Known Tasks (Not Yet Scheduled)

### Search & Ranking
- [ ] Reciprocal Rank Fusion (RRF) for hybrid search instead of linear alpha blending
- [ ] True BM25 ranking via pg_textsearch or ParadeDB extension
- [ ] Query embedding caching (avoid re-embedding repeated queries)
- [ ] Search result re-ranking with cross-encoder models
- [ ] Multi-language FTS support (beyond English tsvector config)
- [ ] Metadata-filtered search (e.g., search only within a project or tag)

### Embeddings
- [ ] Vertex AI text-embedding-005 embedder
- [ ] OpenAI embedder
- [ ] Embedding refresh/migration tool (re-embed all content with a new model)
- [ ] Benchmark: compare retrieval quality across embedders on real data
- [ ] Matryoshka/PCA dimensionality reduction for models that don't output 768-dim
- [ ] Investigate smaller/faster models (e.g., all-MiniLM-L6-v2) for quick primary embeddings

### Ingestion
- [ ] Support ingesting from URLs (fetch page, convert to markdown)
- [ ] Support ingesting from clipboard
- [ ] EPUB → Markdown converter
- [ ] HTML → Markdown converter (for saved web pages)
- [ ] Watch folder mode (auto-ingest new files dropped into a directory)

### Writing Layer Adapters (input sources)
These are "input adapters" — Cerefox is the backend, these tools are the authoring front-end. The integration is always one-way: writing tool → Cerefox (not the reverse).
- [ ] Obsidian vault adapter — Obsidian is the dominant markdown-first PKM tool and stores everything as plain `.md` files; Cerefox is complementary (not competing): Obsidian handles writing/organization, Cerefox handles cloud indexing and AI agent access. Implementation: `cerefox sync --source obsidian --vault ~/Documents/MyVault` does a one-shot ingest of all vault files; `cerefox watch --vault ~/Documents/MyVault` watches for changes and ingests incrementally. No Obsidian plugins needed — just plain folder access.
- [ ] Notion export adapter (parse Notion HTML/MD export format)
- [ ] Bear notes adapter (Bear uses `.md` files in iCloud; similar to Obsidian approach)
- [ ] Logseq vault adapter (Logseq stores as `.md` files with some own syntax quirks)
- [ ] Incremental re-ingestion (detect changes in a file, update only changed chunks)

### Retrieval
- [ ] Small-to-big V2: `cerefox_expand_context` RPC with automatic sibling assembly
- [ ] Retrieval chain: search → expand → summarize (multi-step RPC)
- [ ] Citation/source tracking in retrieved content
- [ ] Relevance feedback loop (mark results as relevant/irrelevant to improve ranking)

### Web UI
- [ ] Search-as-you-type with HTMX
- [ ] Chunk boundary visualization in document viewer
- [ ] Embedding similarity heatmap (visualize chunk relationships)
- [ ] Markdown editor for editing stored content
- [ ] Bulk operations (tag multiple docs, move to project, delete)
- [ ] Dark mode
- [ ] Mobile-responsive layout

### Infrastructure
- [ ] Row-Level Security (RLS) policies for multi-user future
- [ ] Rate limiting on API endpoints
- [ ] Health check endpoint
- [ ] Usage statistics (docs stored, searches performed, storage used)
- [ ] Database migration tool (for schema evolution)
- [ ] CI/CD pipeline (GitHub Actions: lint, test, build)

### Backup & Sync
- [ ] Scheduled automatic backups
- [ ] Backup verification (compare DB state with backup)
- [ ] Export knowledge base as a zip of markdown files
- [ ] Import from backup (restore)
- [ ] Sync between local Postgres and Supabase

### MCP & Agent Integration
- [ ] Custom MCP server (for server-side embedding, richer tools)
- [ ] Agent-side embedding helper (provide embedding via API so agents don't need their own)
- [ ] Usage analytics (which tools agents call most, common query patterns)
- [ ] Tool for agents to add notes directly (`cerefox_save_note` RPC) — now in plan Phase 4; track enhanced features here: agent-authored content filtering in search, agent contribution audit log, per-agent note quotas
- [ ] Plugins for non-MCP agents (ChatGPT plugin, etc.)

---

## Ideas & Research

### Content Intelligence
- Automatic tagging via LLM (ingest a document, ask LLM to suggest tags)
- Content summarization at document level (store as metadata)
- Relationship extraction (link related documents automatically)
- Knowledge graph overlay on top of chunk/document storage
- Spaced repetition integration (surface forgotten but important notes)

### Teliboria-Specific
- World-building structured data (characters, locations, timelines)
- Cross-reference checks (consistency validation across world-building docs)
- Publication workflow integration

### UX
- Browser extension for quick capture (clip a paragraph → ingest)
- Mobile app for quick note capture
- Telegram/Slack bot for quick note input
- Voice note transcription → markdown → ingest

### Performance
- Query plan analysis for search RPCs
- Connection pooling optimization
- Lazy embedding computation (embed on first search, not on ingest)
- Batch embedding optimization (process multiple chunks in one model call)

---

## Decisions Log

Record important decisions here for future reference.

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-07 | Two-table schema (documents + chunks) | Cleaner lifecycle, better small-to-big retrieval |
| 2026-03-07 | 768-dim vectors standardized | Compatible with all-mpnet-base-v2, most Ollama models |
| 2026-03-07 | JSONB for metadata | Evolvable without schema changes |
| 2026-03-07 | FastAPI + Jinja2 + HTMX for web UI | Lightweight, no JS build step, still interactive |
| 2026-03-07 | Supabase MCP as primary agent access | Zero custom server needed, agents get direct RPC access |
| 2026-03-07 | Local-first embeddings (no API costs) | Free to operate, parameterized for future paid embedders |
| 2026-03-07 | No predefined project/category taxonomy | Open source project — users define their own categories |
| 2026-03-07 | Tests written alongside code (not deferred) | Prevents regression accumulation; easier to test small units |
| 2026-03-07 | Numbered SQL migration files | Idempotent, trackable schema evolution |
| 2026-03-07 | Backup as structured markdown + JSON | Human-readable, versionable, easy to inspect and restore |
| 2026-03-07 | Cerefox is a knowledge backend, not a writing tool | Authoring is solved by Obsidian/Bear/Notion; Cerefox's value is cloud indexing + MCP agent access |
| 2026-03-07 | Writing layer tools (Obsidian etc.) are input adapters, not competition | They handle capture/organization; Cerefox handles cloud retrieval — complementary, not competing |
