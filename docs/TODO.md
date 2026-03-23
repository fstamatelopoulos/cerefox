# Cerefox TODO & Ideas Backlog

> Active work is tracked in `plan.md`. This file captures ideas, future enhancements,
> and tasks that aren't yet scheduled into an iteration.

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
- [x] OpenAI embedder — `CloudEmbedder` (Iteration 8, default)
- [x] Fireworks AI embedder — same class, different base_url/model (Iteration 8)
- [x] Embedding migration tool — `cerefox reindex` re-embeds all chunks in-place (Iteration 8)
- [ ] Vertex AI text-embedding-005 embedder (add as another cloud provider)
- [ ] Benchmark: compare retrieval quality across OpenAI vs Fireworks embedders on real data
- [ ] Matryoshka/PCA dimensionality reduction for models that don't output 768-dim

### Ingestion
- [ ] **Bug: rollback document insert if embedding/chunk-insert fails** — currently if the pipeline crashes after inserting the document row but before inserting chunks, the document exists with no chunks and subsequent retries are silently skipped as duplicates. Fix: delete the document row on any exception after insert, or use a DB transaction.
- [ ] Support ingesting from URLs (fetch page, convert to markdown)
- [ ] Support ingesting from clipboard
- [ ] EPUB → Markdown converter
- [ ] HTML → Markdown converter (for saved web pages)
- [ ] Watch folder mode (auto-ingest new files dropped into a directory)
- [ ] **Refactor `sync_docs.py` to use the Edge Function path** — currently uses the local `IngestionPipeline` (Python chunker + direct embedding API call), which is a separate implementation from the `cerefox-ingest` Edge Function (TypeScript chunker). This violates the single implementation principle and risks drift between the two code paths. Switch to calling the `cerefox-ingest` Edge Function via HTTP (anon key auth) so all ingestion flows through the same RPC.

### Writing Layer Adapters (input sources)
These are "input adapters" — Cerefox is the backend, these tools are the authoring front-end. The integration is always one-way: writing tool → Cerefox (not the reverse).
- [ ] Obsidian vault adapter — Obsidian is the dominant markdown-first PKM tool and stores everything as plain `.md` files; Cerefox is complementary (not competing): Obsidian handles writing/organization, Cerefox handles cloud indexing and AI agent access. Implementation: `cerefox sync --source obsidian --vault ~/Documents/MyVault` does a one-shot ingest of all vault files; `cerefox watch --vault ~/Documents/MyVault` watches for changes and ingests incrementally. No Obsidian plugins needed — just plain folder access.
- [ ] Notion export adapter (parse Notion HTML/MD export format)
- [ ] Bear notes adapter (Bear uses `.md` files in iCloud; similar to Obsidian approach)
- [ ] Logseq vault adapter (Logseq stores as `.md` files with some own syntax quirks)
- [ ] Incremental re-ingestion (detect changes in a file, update only changed chunks)

### Retrieval
- [ ] **True small-to-big retrieval** — for documents above a configurable size threshold,
  return the matched chunks with N adjacent siblings (before + after) rather than the full
  document. This keeps context tight around the relevant passage and avoids diluting the
  agent's context window with unrelated sections of large documents.
  - Configurable: `CEREFOX_SMALL_TO_BIG_THRESHOLD` (doc size in chars, default e.g. 8 000)
    and `CEREFOX_CONTEXT_WINDOW` (number of sibling chunks on each side, default 1)
  - Below the threshold → current behaviour: return full reconstructed document
  - Above the threshold → return matched chunk(s) + N preceding + N following chunks,
    assembled in order with heading breadcrumbs preserved
  - Implement as a new RPC (`cerefox_expand_context`) callable from both the MCP server
    and the Edge Function search path
  - Edge Function: add `expand_context: boolean` request param (default false for back-compat)
- [ ] Retrieval chain: search → expand → summarize (multi-step RPC)
- [ ] Citation/source tracking in retrieved content
- [ ] Relevance feedback loop (mark results as relevant/irrelevant to improve ranking)

### Web UI
- [ ] Pagination for document lists — Browse project view (`/search?project_id=X` with no query) currently caps at 100 docs; add page controls or infinite-scroll when project grows large
- [x] Metadata entry on ingest form — dynamic key/value editor with `<datalist>` autocomplete from `cerefox_list_metadata_keys` (Iteration 9)
- [x] ~~Collapse "Full content" section~~ — done: Accordion component in React SPA
- [ ] **"No Project Assigned" row in dashboard** — show a row in the Projects table for documents not in any project. Needs `client.get_unassigned_doc_count()` and a browse/list view filtered to unassigned docs.
- [ ] Search-as-you-type (debounced query in React)
- [ ] Chunk boundary visualization in document viewer
- [ ] Embedding similarity heatmap (visualize chunk relationships)
- [x] ~~Markdown editor for editing stored content~~ — done: Edit/Preview toggle in Document Edit page
- [ ] Bulk operations (tag multiple docs, move to project, delete) — deferred from 14C.3
- [ ] Refactor `sync_docs.py` to use Edge Function path instead of local ingestion pipeline (single implementation principle)
- [ ] Dark mode
- [ ] Mobile-responsive layout

### Infrastructure
- [ ] Row-Level Security (RLS) policies for multi-user future
- [ ] Rate limiting on API endpoints
- [ ] Health check endpoint
- [ ] Usage statistics (docs stored, searches performed, storage used)
- [x] Database migration tool (for schema evolution) — `scripts/db_migrate.py` with `--dry-run`, `--status` flags (Iteration 12)
- [ ] CI/CD pipeline (GitHub Actions: lint, test, build)
- [ ] **Local integration test suite** — `@pytest.mark.integration_local` tests that run against
  Supabase local stack (`supabase start`); covers schema deploy, ingest, search, Edge Functions
  end-to-end. Depends on Iteration 11 local dev setup (11.19).
- [ ] **CI with Supabase local stack** — GitHub Actions workflow that runs `supabase start` in a
  service container, deploys schema, runs integration tests. Enables automated regression testing.
- [ ] **Local dev workflow guide** — `docs/guides/setup-local-dev.md` covering `supabase start`,
  `supabase functions serve`, local secrets, and how to switch between local and cloud backends.
- [ ] **Validate Docker/local deployment** — `Dockerfile` and `docker-compose.yml` have never been
  tested end-to-end. Verify the local stack (Postgres+pgvector + web UI) works with the current
  cloud-only embedder config. Low priority — focus is on Supabase production environment.
- [ ] **Local Supabase dev environment** — set up a full local Supabase stack for offline
  development and Edge Function testing. Tasks: (1) `supabase start` with `supabase/config.toml`
  configured for Postgres+pgvector, Edge Functions runtime, GoTrue; verify schema deploys and
  Edge Functions serve locally. (2) Test `cerefox-search`, `cerefox-ingest`, `cerefox-mcp`
  against local Postgres via `supabase functions serve`. (Previously planned as Iteration 15,
  moved to backlog.)

### Backup & Sync
- [ ] Scheduled automatic backups
- [ ] Backup verification (compare DB state with backup)
- [ ] Export knowledge base as a zip of markdown files
- [x] Import from backup (restore) — `scripts/backup_restore.py` with `--dry-run` (Iteration 12)
- [ ] Sync between local Postgres and Supabase

### MCP & Agent Integration
- [x] **Supabase Edge Functions** — `cerefox-search` and `cerefox-ingest` deployed to Supabase;
  callable over HTTPS from any HTTP client; server-side OpenAI embedding means no local model needed.
  Note: `invoke_edge_function` does NOT exist in `@supabase/mcp-server-supabase` v0.7.0.
- [x] **Built-in MCP server** (`cerefox mcp`) — local stdio MCP server using the MCP Python SDK;
  exposes `cerefox_search` and `cerefox_ingest` as named tools; reads `.env`; works with Claude
  Desktop, Cursor, Claude Code. Note: ChatGPT Desktop does NOT support local stdio MCP — use
  Custom GPT + Edge Functions for all ChatGPT access.
- [x] **ChatGPT Custom GPT (GPT Actions)** — OpenAPI spec pointing at Edge Functions; Bearer auth
  with Supabase anon key; free with ChatGPT Plus; full hybrid search from cloud ChatGPT.
- [x] **`cerefox-mcp` Edge Function — universal remote MCP endpoint** (P1)
  MCP Streamable HTTP transport as a Supabase Edge Function. A single
  `https://<project>.supabase.co/functions/v1/cerefox-mcp` URL serves all remote-capable
  clients with no extra hosting cost (Supabase free tier). Thin protocol adapter — delegates
  all 5 tool calls via internal fetch to dedicated Edge Functions
  (`cerefox-search`, `cerefox-ingest`, `cerefox-metadata`, `cerefox-get-document`,
  `cerefox-list-versions`). Auth via Supabase anon key Bearer token.

  **Client compatibility (tested):**
  | Client | How to connect | Status |
  |---|---|---|
  | Claude Desktop | `npx -y supergateway --streamableHttp <url> --header "Authorization: Bearer <anon-key>"` | Confirmed working |
  | Claude Code | `claude mcp add --transport http cerefox <url> --header "Authorization: Bearer <anon-key>"` | Confirmed working |
  | Cursor | `url` + `headers.Authorization` in mcp.json | Expected to work (same as Claude Code) |
  | ChatGPT | Not supported — use Custom GPT + GPT Actions instead | N/A |
  | Claude.ai web | Not supported — no native Streamable HTTP MCP | N/A |

  **Note**: `mcp-remote` does NOT work with Supabase — it proactively discovers Supabase's
  GoTrue OAuth server and fails at dynamic client registration. `supergateway` is the correct
  bridge for Claude Desktop.

- [ ] **OpenClaw** integration — OpenClaw (open-source AI agent) MCP config; same Path A
  approach as Cursor/Claude Code; track once the tool matures.
- [ ] Usage analytics (which tools agents call most, common query patterns)
- [ ] Perplexity — web connector CONFIRMED broken (Iteration 11 testing): GoTrue OAuth
  discovery conflict prevents reaching Supabase Edge Functions. Desktop app + Helper App path
  (local stdio MCP) is untested but likely works. Low priority: Perplexity CTO announced
  moving away from MCP (March 2026) in favor of traditional APIs. Sonar API / Agent API are
  alternative programmatic paths. See `docs/research/oauth-mcp-auth.md` §8 for full analysis.

---

## Ideas & Research

### Content Intelligence
- Automatic tagging via LLM (ingest a document, ask LLM to suggest tags)
- Content summarization at document level (store as metadata)
- Relationship extraction (link related documents automatically)
- Knowledge graph overlay on top of chunk/document storage
- Spaced repetition integration (surface forgotten but important notes)

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
| 2026-03-07 | 768-dim vectors standardized | Compatible with OpenAI text-embedding-3-small and Fireworks AI alternatives |
| 2026-03-07 | JSONB for metadata | Evolvable without schema changes |
| 2026-03-07 | FastAPI + Jinja2 + HTMX for web UI | Lightweight, no JS build step, still interactive |
| 2026-03-07 | Supabase MCP as primary agent access | Zero custom server needed, agents get direct RPC access |
| 2026-03-12 | ChatGPT Desktop excluded from local MCP path | OpenAI only supports remote MCP (SSE/streaming HTTP) — local stdio not documented or functional. All ChatGPT access uses Custom GPT + Edge Functions. |
| 2026-03-07 | Cloud-only embeddings (OpenAI API) | Eliminates local model complexity (no PyTorch, no platform-specific wheels); low per-use cost suitable for personal use |
| 2026-03-07 | No predefined project/category taxonomy | Open source project — users define their own categories |
| 2026-03-07 | Tests written alongside code (not deferred) | Prevents regression accumulation; easier to test small units |
| 2026-03-07 | Numbered SQL migration files | Idempotent, trackable schema evolution |
| 2026-03-07 | Backup as structured markdown + JSON | Human-readable, versionable, easy to inspect and restore |
| 2026-03-07 | Cerefox is a knowledge backend, not a writing tool | Authoring is solved by Obsidian/Bear/Notion; Cerefox's value is cloud indexing + MCP agent access |
| 2026-03-07 | Writing layer tools (Obsidian etc.) are input adapters, not competition | They handle capture/organization; Cerefox handles cloud retrieval — complementary, not competing |
| 2026-03-14 | Custom GPT + GPT Actions is the recommended ChatGPT path (not remote MCP) | ChatGPT Developer Mode MCP disables Memory and shows high-risk warning; Custom GPT works on Plus with no warnings and memory enabled. The `cerefox-mcp` Edge Function is the universal remote endpoint for Claude Code/Cursor/Desktop, not a ChatGPT fix. |
| 2026-03-14 | `cerefox-mcp` Edge Function preferred over Cloud Run for remote MCP | Zero additional hosting cost (Supabase free tier), same auth as existing Edge Functions, no new infra. Streamable HTTP transport; static Bearer token (anon key) sufficient for all target clients. |
| 2026-03-15 | `supergateway` replaces `mcp-remote` for Claude Desktop remote MCP | `mcp-remote` 0.1.x proactively discovers Supabase GoTrue OAuth at the root domain and crashes at dynamic client registration. `supergateway` connects directly via Streamable HTTP without OAuth. |
| 2026-03-15 | Remove custom auth check from `cerefox-mcp`; forward caller's Authorization header | Supabase API gateway validates JWT; custom `SUPABASE_ANON_KEY` comparison was redundant and broken (env var not reliably available). Internal Edge Function calls now use the forwarded caller token. |
| 2026-03-15 | Remote MCP (Path A-Remote) is the recommended default; local stdio MCP is legacy fallback | Remote path requires only URL + anon key + npx; no Python, no repo clone. Local path retained for offline use and development. |
| 2026-03-19 | Chunks-anchored versioning: version_id IS NULL = current, non-NULL = archived | No separate content table; single retrieval path; partial indexes automatically exclude archived chunks from search |
| 2026-03-19 | Edge Function = thin HTTP adapter over Postgres RPC (single implementation principle) | Logic in SQL RPCs; Python + TypeScript call the same RPCs; cerefox-mcp delegates to dedicated Edge Functions via fetch |
| 2026-03-19 | Source path derived and stored at ingestion time (paste docs get slug-based path) | Download route uses source_path directly; no extension guessing; always correct filename |
