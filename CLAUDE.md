# Cerefox - Project Guide

## What Is This

Cerefox is a user-owned knowledge memory layer for AI agents. It stores curated Markdown documents in Supabase (Postgres + pgvector), supports hybrid search (FTS + semantic), and exposes everything via MCP and REST so any AI agent can read and write.

Cerefox is **asynchronous shared memory, not a message bus**. It solves the persistent context problem: knowledge written in one context is findable in any other, dissolving boundaries between agents, sessions, human and machine, and across time. It does not handle real-time agent-to-agent communication; protocols like A2A handle that. Cerefox handles persistent memory.

Single-user, open-source (Apache 2.0), designed to be cheap/free to operate. See `docs/research/vision.md` for the full project vision.

## Tech Stack

- **Language**: TypeScript via Bun (CLI, web server, local MCP server, build/release scripts, Edge Functions). The Python implementation was **fully removed at v1.0.0** (iter-28G) — only the SQL schema assets under `src/cerefox/db/` remain (they are not Python).
- **Database**: PostgreSQL 16+ with pgvector (Supabase free tier or local Docker)
- **Embeddings**: OpenAI `text-embedding-3-small` (768-dim, cloud API); Fireworks AI as alternative; Edge Functions handle embedding server-side for agents
- **Web framework**: Hono on Bun/Node (TypeScript), in `packages/memory` — served by `cerefox web`.
- **Web UI**: React + TypeScript SPA (Mantine UI, TanStack Query, Vite); served at `/app/`
- **CLI**: commander (TypeScript) in `@cerefox/memory`; resource-verb shape (v0.9.0).
- **Local MCP server**: `@cerefox/memory` npm package (Node ≥20 / Bun ≥1.0); single artifact growing to host CLI + web server + ingestion in future iterations
- **Shared TS modules**: `_shared/{config,db-client,db-status,embeddings,mcp-tools}/` — imported by both Edge Functions (Deno) and local server (Node/Bun) via structural typing
- **Package management**: bun workspaces for TS
- **Testing**: `bun test` (TypeScript) — the only test runner as of v0.9.0 (pytest retired; `tests/**/*.py` deleted)
- **Linting**: biome/tsc for TS

## Project Structure

```
cerefox/
├── CLAUDE.md                  # This file
├── docs/
│   ├── requirements-and-specs.md  # Source of truth for requirements
│   ├── solution-design.md         # Architecture and design decisions
│   ├── plan.md                    # Implementation plan with progress
│   └── TODO.md                    # Backlog and future ideas
├── src/
│   └── cerefox/
│       └── db/                    # SQL assets ONLY (not Python) — bundled by the TS deploy
│           ├── schema.sql         # Database schema (+ `-- @version:` marker)
│           ├── rpcs.sql           # RPC functions (+ `cerefox_schema_version()`)
│           └── migrations/        # Numbered incremental migrations (00NN_*.sql)
├── _shared/                       # TS modules imported by both EFs (Deno) and local server (Node/Bun)
│   ├── config/                    # paths, env loading
│   ├── db-client/                 # Supabase client, RPC wrapper, introspection helpers
│   ├── db-status/                 # Schema-version-mismatch banner, status checks
│   ├── embeddings/                # OpenAI/Fireworks embedding helpers
│   ├── mcp-tools/                 # 10 MCP tool handlers shared by remote + local
│   └── cli-core/                  # CLI helpers (exit, output, argv, prompts)
├── packages/
│   └── memory/                    # @cerefox/memory npm package — both bins (v0.5+)
│       ├── src/
│       │   ├── bin/cerefox.ts      # single bin (v0.5.1+); commander dispatch + error handler
│       │   ├── cli/                # commander program + 35 subcommand files
│       │   │   ├── commands/       # one file per subcommand (including `mcp` which runs buildServer())
│       │   │   └── util/           # checks, mcp-config-writers, bundled-docs
│       │   ├── server.ts           # buildServer() factory (called by the `mcp` subcommand)
│       │   └── meta.ts             # PKG_VERSION — bumped by cut_release.ts
│       ├── test/                   # stdio smoke + CLI smoke + read/write/lifecycle tests
│       ├── README.md               # npm landing card (refreshed each release)
│       └── package.json
├── supabase/functions/            # Edge Functions (Deno)
│   └── cerefox-mcp/               # Remote MCP server; imports _shared/mcp-tools/
├── frontend/                      # React + TypeScript SPA
│   ├── src/                       # Components, pages, hooks, API client
│   ├── vite.config.ts             # Vite build config (base: /app/)
│   └── package.json
├── web/
│   └── static/                    # Static assets (logo, favicon)
├── scripts/                   # contributor ops (end users use `cerefox server …` / `cerefox backup …`)
│   ├── cut_release.ts         # Cut/tag a release; optional --npm-publish (confirm-first since v0.9.1)
│   ├── bundle_help.ts         # Bundle AGENT_QUICK_REFERENCE.md into _shared/mcp-tools/get-help-content.ts
│   ├── db_deploy.ts           # Low-level fresh schema+RPC deploy (contributor; has --reset)
│   ├── db_migrate.ts          # Low-level apply-pending-migrations (contributor; --status/--dry-run)
│   └── backup_create.ts / backup_restore.ts / reindex_all.ts / sync_docs.ts / cerefox_export.ts
├── packages/memory/test/      # TS test suite (`bun test`) — the only test runner (v0.9)
├── _shared/__tests__/         # TS unit tests for the shared modules
├── frontend/tests/e2e/        # Playwright UI e2e (@playwright/test)
├── docker-compose.yml
└── Dockerfile
```

## Development Conventions

### Code Style
- Use biome for linting and formatting (TypeScript)
- Type hints on all public functions
- Docstrings only where the purpose isn't obvious from the name/signature
- Prefer simple, flat code over abstractions — don't create a helper for something used once

### Naming
- Database tables: `cerefox_` prefix (e.g., `cerefox_documents`, `cerefox_chunks`)
- Database RPCs: `cerefox_` prefix (e.g., `cerefox_hybrid_search`)
- Config: environment variables with `CEREFOX_` prefix

### CLI verb conventions (v0.9.0+)
The CLI uses a **resource-verb** shape: `cerefox <resource> <verb> [args]`.
Resource groups: `document` (get/list/edit/delete/restore/ingest/ingest-dir),
`document version` (list/archive/unarchive), `project`
(list/create/edit/delete), `metadata` (keys/search), `audit` (list),
`config` (list/get/set), `backup` (create/restore), `server` (deploy/reindex),
`guides` (list/open/show/ingest). The primary verb `search` and
lifecycle/server commands (`init`, `doctor`, `status`, `configure-agent`,
`self-update`, `upgrade`, `mcp`, `web`, `completion`) stay **flat**.
(`sync-docs` is now only `bun scripts/sync_docs.ts`, not a CLI command.)
- **Adding a command**: register it under the right resource group in
  `program.ts` via `moveInto(group, registerX, "verb")`. The handler file keeps
  its existing `registerX(program)` shape; `moveInto` renames it under the
  group. New top-level groups are rare — prefer an existing one.
- **Renames are breaking**: the old flat verbs (pre-v0.9) survive as hidden
  husks (`RENAMED_VERBS` in `program.ts`) that exit non-zero with a pointer.
  Remove husks only at a major version (v1.0).
- Genuinely new commands (not renames) are additive/non-breaking and slot into
  a minor (e.g., v0.9.1) — see plan.md Iteration 27's v0.9.1 block.

### Architecture Principles
- **Pluggable embedders**: embedding helpers live in `_shared/embeddings/` (OpenAI today)
- **Markdown-first**: all content is converted to markdown before chunking/storage
- **Fire-and-forget ingestion**: ingestion can be async; failures log errors but don't block
- **Parameterized limits**: response size limits, chunk sizes, etc. are configurable via settings
- **Two-table design**: `cerefox_documents` (document-level) + `cerefox_chunks` (chunk-level) for clean separation
- **Usage tracking**: `cerefox_usage_log` logs all operations (reads and writes); `cerefox_config` stores runtime config (e.g., `usage_tracking_enabled`). Opt-in; controlled via RPC, not env vars. `cerefox_log_usage` RPC checks config on every call and returns immediately when disabled. Each entry records `requestor` (who: agent name or "user") and `access_path` (where: remote-mcp, local-mcp, edge-function, webapp, cli).
- **Requestor enforcement**: optional `require_requestor_identity` config (default false) makes `requestor`/`author` mandatory on MCP tool calls. Optional `requestor_identity_format` config validates against a regex pattern. Both controlled via `cerefox_config`.

### Configuration
- Config is loaded from `.env` / environment via `_shared/config/`
- All config has sensible defaults for local development
- Key settings: `CEREFOX_SUPABASE_URL`, `CEREFOX_SUPABASE_KEY`, `OPENAI_API_KEY`, `CEREFOX_EMBEDDER`, `CEREFOX_MAX_RESPONSE_BYTES`

### Testing
- **`bun test` is the only test runner as of v0.9.0** — `pytest` is retired and `tests/**/*.py` is deleted. Write TS tests alongside new TS code.
- TS tests live in `packages/memory/test/`, `_shared/__tests__/`, and `frontend/tests/e2e/` (Playwright).
- Use mocked clients for unit tests — never hit a real database in unit tests. Live suites are probe-and-skip + self-cleaning.
- Test at least: happy path, edge cases (empty input, max size, malformed input), error conditions.

**Test suites and how to run them:**

| Suite | Command | What it does |
|-------|---------|-------------|
| TS unit tests (`_shared/`) | `cd _shared && bun test` | Fast, mocked, no network |
| Package suite (built bin) | `cd packages/memory && bun run build && bun test` | CLI smoke, MCP stdio handshake, + live read/write commands (probe-and-skip when Supabase isn't reachable); needs `.env` for the live ones |
| UI e2e (Playwright) | `cd frontend && bun run test:e2e` | Browser tests against a local `cerefox web`; needs `bunx playwright install chromium` |
| Live EF e2e (opt-in) | `CEREFOX_LIVE_E2E=1 bun test test/edge-functions/edge-functions.test.ts` | Hits the deployed Edge Functions. Skipped by default. |
| Live remote-MCP e2e (opt-in) | `CEREFOX_LIVE_E2E=1 bun test test/mcp-remote/mcp-remote.test.ts` | Hits the deployed `cerefox-mcp` EF over JSON-RPC. Skipped by default. |

> **Conserve free-tier Edge Function quota.** The two live TS suites
> (`packages/memory/test/edge-functions/`, `.../mcp-remote/`) make real Edge
> Function calls and are **gated behind `CEREFOX_LIVE_E2E=1`** (checked before
> the reachability probe, so a default `bun test` makes ZERO EF calls). Run
> them only when changing EF code (`supabase/functions/**`,
> `_shared/{mcp-tools,embeddings,ef-meta}`) or for pre-release validation — and
> prefer the narrowest file. They tag their calls with `requestor: "e2e-test"`
> so usage-log rows are attributable (not "Unknown"). `cerefox doctor` also
> calls the `/version?peers=true` aggregator (several EF calls), so don't loop it.

- The live read/write command suites (`packages/memory/test/{read,write}-commands.test.ts`) hit the Data API (not Edge Functions), probe-and-skip when Supabase is unreachable, and self-clean `[E2E …]`-prefixed data.
- See `docs/e2e-use-cases.md` for the full use-case matrix and TODO list.

### Git (Lightweight GitHub Flow)

**Branch model:**
- **`main`** is always deployable. All work lands here.
- **Feature branches** (`feat/metadata-overhaul`, `fix/search-empty-content`) for non-trivial changes — anything that touches multiple files or takes more than one session.
- **Direct commits to `main`** are fine for: typo fixes, single-file doc updates, small config tweaks, and hotfixes.
- No `develop` branch, no `release/*` branches.
- No force pushes to main.

**When to use a branch + PR:**
1. The change spans multiple files or multiple logical steps
2. The change could break something and you want a clean rollback point
3. You want a summary artifact (PR description explains *why*)

**When to commit directly to `main`:**
1. Single-file doc fix or typo
2. Small config change (`.gitignore`, version bump)
3. Hotfix for a bug you just introduced

**Commit messages:**
```
<verb> <what changed>

<optional body: why, context, trade-offs>

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```
- Imperative mood: "Add", "Fix", "Update", "Remove"
- First line under 72 characters
- Body explains *why*, not what — the diff shows what changed
- Co-authored-by trailer on every commit where Claude contributed
- One logical change per commit

**PR conventions:**
- Title: short, imperative, under 70 chars
- Body: Summary (bullet points) + Test plan (checklist)
- Merge style: **Squash and merge** by default

**Release tagging:**
- Tag on `main`: `v0.1.0`, `v0.2.0`
- Annotated tags: `git tag -a v0.1.0 -m "First public release"`

## Edge Functions & MCP Architecture

### The Pattern: One Edge Function Per Operation

Every Cerefox operation is implemented **once** in a Postgres RPC (SECURITY DEFINER function). Edge Functions are thin HTTP adapters over those RPCs — nothing more.

```
Agent / MCP client
      │
      ▼  (Cerefox access token OR OAuth JWT, validated in-function)
cerefox-mcp  ──supabase.rpc──▶  cerefox_hybrid_search / cerefox_search_docs
             ──supabase.rpc──▶  cerefox_ingest_document
             ──supabase.rpc──▶  cerefox_list_metadata_keys
             ──supabase.rpc──▶  cerefox_get_document
             ──supabase.rpc──▶  cerefox_list_document_versions
             ──supabase.rpc──▶  cerefox_list_audit_entries
             ──supabase.rpc──▶  cerefox_list_projects
             ──supabase.rpc──▶  cerefox_metadata_search

GPT Actions (Custom GPT) ──────▶  cerefox-search           (primitive Edge Functions, direct HTTP)
                         ──────▶  cerefox-ingest
                         ──────▶  cerefox-metadata
                         ──────▶  cerefox-get-document
                         ──────▶  cerefox-list-versions
                         ──────▶  cerefox-get-audit-log
                         ──────▶  cerefox-metadata-search
                         ──────▶  cerefox-list-projects

cerefox CLI / Web app ─────────▶  Supabase Data API (PostgREST / supabase-js) ─▶  same RPCs
```

Note: `cerefox-mcp` calls RPCs directly (no delegation to primitive Edge Functions). This halves billable invocations for every MCP tool call. Primitive Edge Functions remain unchanged for GPT Actions and direct HTTP clients.

### Auth Pattern — Three Layers

Cerefox has three distinct access layers, each with its own credential:

1. **AI agents / Edge Functions** — callers (GPT Actions, remote MCP, curl) present the **Cerefox access token** (`cfx_pat_…`, iter-28E) as `Authorization: Bearer`. Every data Edge Function runs `--no-verify-jwt` and validates that token **in-function** (constant-time, against the `CEREFOX_ACCESS_TOKENS` Function secret) before using `SUPABASE_SERVICE_ROLE_KEY` internally to call RPCs. Callers never see the service-role key. Generate/rotate the token with `cerefox token generate` / `cerefox token rotate`. The **legacy anon JWT is retired** for this layer (it was unrotatable on ES256-signed projects). Context: `docs/specs/ef-auth-migration-design.md`.
2. **Web app & CLI** — the TS client authenticates via the Supabase REST API (Data API) using either the new **secret key** (`sb_secret_…`) or the legacy **service_role** JWT. Both are accepted and bypass RLS to grant unrestricted read/write access. Never expose this key to clients.
3. **Deployment scripts only** — `bun scripts/db_deploy.ts` / `bun scripts/db_migrate.ts` connect directly to Postgres over TCP using the **database password** (`CEREFOX_DATABASE_URL`). No application code uses this path at runtime.

**OAuth path (iter-28A, `cerefox-mcp`).** As an OPTIONAL feature for cloud/mobile Claude (claude.ai web + app), `cerefox-mcp` is also an OAuth 2.1 protected resource. It does auth **in-function** (`_shared/mcp-auth/`): it accepts EITHER a valid OAuth 2.1 access token (validated against the project JWKS; `sub` pinned to `CEREFOX_OAUTH_OWNER_ID`) OR the **Cerefox access token** (its static path — the same credential the primitive EFs take; the legacy anon static-Bearer was retired in iter-28E). The consent page is a free Cloudflare Worker (`cloudflare/cerefox-consent/`) — a Supabase EF can't serve HTML on the default domain. **All 9 Cerefox Edge Functions now run `--no-verify-jwt` and authenticate in-function** (iter-28E) — the gateway gates none of them; the only unauthenticated surface is `cerefox-mcp`'s RFC 9728 OAuth discovery route + its 401 challenge. Designs: `docs/specs/oauth-mcp-server-design.md`, `docs/specs/ef-auth-migration-design.md`.

See `docs/guides/access-paths.md` for a full breakdown with credential sources and a summary table.

### Single Implementation Principle

Business logic lives **only in Postgres RPCs** wherever feasible. If you need to add logic to a tool:
1. Add or modify the RPC in `src/cerefox/db/rpcs.sql`
2. The TS client (CLI / web app) calls the RPC via `supabase.rpc()`
3. The dedicated primitive Edge Function calls the same RPC via `supabase.rpc()`
4. The MCP tool handler in `_shared/mcp-tools/*.ts` calls the same RPC directly. Both the remote `cerefox-mcp` Edge Function and the local `@cerefox/memory` TS server import the same handlers from `_shared/mcp-tools/`, so a tool's behaviour is identical regardless of which transport an agent uses.

**Do NOT** add business logic directly in Edge Function TypeScript or in the MCP server bin. The only logic in transport-layer code is input validation, RPC call, and JSON response formatting.

**Ingestion**: The ingestion pipeline has two steps: (1) chunking + embedding (requires external HTTP calls, runs in TypeScript), and (2) database writes (insert document, insert chunks, snapshot version, set review_status, create audit entry). Step 2 is handled entirely by the `cerefox_ingest_document` RPC -- a single atomic transaction. Both the TS `IngestionPipeline` and the `cerefox-ingest` Edge Function call this RPC after completing step 1. This ensures all write logic, review_status transitions, and audit entry creation happen in one place.

**Important**: when adding new write logic (e.g., a new field on documents, a new side effect of ingestion), add it to the `cerefox_ingest_document` RPC, not to the pipeline or Edge Function. The callers should only handle chunking, embedding, and parameter preparation.

**Simple CRUD** operations (read/list queries on documents, chunks, projects; project create/update/delete) use the Supabase REST API directly (`client.table(...)`). This is acceptable as these are pure data access with no business logic.

### Edge Function Inventory

| Edge Function | Purpose | Called By |
|---|---|---|
| `cerefox-search` | Hybrid FTS + semantic search; handles server-side embedding | GPT Actions, direct HTTP |
| `cerefox-ingest` | Ingest document; chunks, embeds, versions, stores | GPT Actions, direct HTTP |
| `cerefox-metadata` | List metadata keys with doc counts + example values | GPT Actions, direct HTTP |
| `cerefox-get-document` | Retrieve full doc content; supports archived versions | GPT Actions, direct HTTP |
| `cerefox-list-versions` | List archived version history for a document | GPT Actions, direct HTTP |
| `cerefox-get-audit-log` | Query audit log entries with filters (document, author, operation, time range) | GPT Actions, direct HTTP |
| `cerefox-metadata-search` | Query documents by metadata key-value criteria without text search | GPT Actions, direct HTTP |
| `cerefox-list-projects` | List all projects with names, IDs, and descriptions | GPT Actions, direct HTTP |
| `cerefox-mcp` | Remote MCP Streamable HTTP server; calls RPCs directly via shared tool handlers in `_shared/mcp-tools/`. Also an OAuth 2.1 protected resource (iter-28A, `--no-verify-jwt` + in-function auth) for cloud clients; the static path takes the **Cerefox access token** (iter-28E) | Claude Code, Cursor, Claude Desktop (remote, via the Cerefox token); **claude.ai web + mobile (via OAuth)**. Local agents prefer the local MCP. |

The local `@cerefox/memory` npm package (entry point: the `cerefox` bin with `mcp` subcommand) exposes the **same 10 MCP tools** over stdio, importing the same `_shared/mcp-tools/` handlers. Users who want a local server (no network round-trip, no Edge Function billing) install it with `npx --package=@cerefox/memory cerefox mcp` and point their MCP client at it. See `docs/guides/connect-agents.md`.

### Deploying the server side: `cerefox server deploy`

`cerefox server deploy` (renamed from `cerefox deploy-server` in v0.9.0; the old
name is a husk) is the **catch-all** for both standing up *and updating*
the server side — schema + RPCs (in-process via `_shared/db-deploy/`) and all 9
Edge Functions (`npx supabase functions deploy`), from assets bundled in the
npm package (no repo clone). It detects fresh vs. existing databases: a fresh DB
gets schema + RPCs deployed and migrations stamped; an existing DB gets *pending
migrations applied* and `rpcs.sql` re-applied (an in-place update). So a release
that changes RPCs or adds a migration ships by re-running this command. Flags:
`--schema-only`, `--functions-only`, `--dry-run`. There is deliberately **no
`--reset`** here — a destructive wipe lives only in the low-level
`bun scripts/db_deploy.ts --reset` (contributor, repo clone, typed-`yes` guard).
The migrate/deploy logic is shared with `scripts/db_migrate.ts` /
`scripts/db_deploy.ts` via `_shared/db-deploy/`.

### Edge Function Model Config

`OPENAI_MODEL` and `EMBEDDING_DIMENSIONS` are TypeScript constants inside each Edge Function (not Supabase secrets). They are not sensitive — they're configuration. Changing the model requires editing the constant and redeploying the function (`npx supabase functions deploy <name>`). This is by design: changing the embedding model is a breaking schema change that also requires `cerefox server reindex` to re-embed all existing chunks, so a redeploy is expected.

### Rule: keep the GPT Actions OpenAPI block in sync with the EFs

**When you change an Edge Function's request body or response shape, update the GPT Actions OpenAPI block in `docs/guides/connect-agents.md` in the same PR, and bump its `info.version` per SemVer.** That block is what ChatGPT users paste into a Custom GPT's Actions config; if it drifts from what the EFs actually accept/return, those GPTs silently break. There is no CI gate for this (a path-diff heuristic was too lossy) — the discipline lives here + in the release playbook (`RELEASING.md`). When an EF's `EF_VERSION` surface changes, also consider whether the client compatibility matrix (`_shared/compatibility/index.ts`) needs a `minEdgeFunctions` bump (see CONTRIBUTING.md).

### Rule: bump `schema_version` on any `src/cerefox/db/` change

**Whenever you change `schema.sql`, `rpcs.sql`, or add a migration, bump the
schema version in two places, in lockstep:** the `-- @version:` marker in
`src/cerefox/db/schema.sql` (the *bundled* value the client compares against)
**and** the literal in `cerefox_schema_version()` at the bottom of `rpcs.sql`
(the *deployed* value). Schema and RPCs deploy together via `cerefox server
deploy`, so this single version is the "redeploy required" signal — bumping it
is what makes `cerefox doctor` / the web banner tell users to redeploy.
`cut_release.ts` **fails the cut** if `db/` changed without a bump or if the two
literals disagree (the symmetric counterpart to the `EF_VERSION` guard). It's an
independent semver line — do **not** sync it to the npm package version. This
was missed in v0.9.6 (added RPCs without bumping); the gate exists so it can't
recur.

### Rule: before opening a release-intent PR, follow `RELEASING.md`

**Any PR meant to ship a release (or that a release will be cut from) must run
the `RELEASING.md` pre-release checklist** — CHANGELOG `[Unreleased]` populated,
`schema_version` bumped if `db/` changed, compat-matrix minimums reviewed, GPT
Actions OpenAPI block synced if EFs changed, tests green. `RELEASING.md` is the
authoritative release playbook; read it at the start of any release work.

### Client Compatibility

For **local** agents (Claude Code, Cursor, Codex, Gemini, Desktop) the **preferred** path is the **local MCP** via `cerefox configure-agent` (stdio; reaches Supabase through the Data API with the local server's own secret key; no Edge Function token needed). The remote-HTTP forms below are an Advanced/fallback alternative and now use the **Cerefox access token** (`cerefox token generate`), not the retired anon JWT.

| Client | How to connect | Notes |
|---|---|---|
| Claude Code | Preferred: `cerefox configure-agent --tool claude-code` (local MCP). Advanced (remote): `claude mcp add --transport http cerefox <url> --header "Authorization: Bearer <cerefox-access-token>"` | Direct Streamable HTTP |
| Cursor | `url` + `headers.Authorization` in mcp.json | Same as Claude Code |
| OpenAI Codex CLI | `url` + `bearer_token_env_var` in `~/.codex/config.toml` | Direct Streamable HTTP; TOML config; **tested, working** |
| Gemini CLI | `httpUrl` + `headers` in `~/.gemini/settings.json` | Direct Streamable HTTP; **untested, expected to work** |
| Claude Desktop | `npx supergateway` or `npx mcp-remote` (see connect-agents.md) | `supergateway` tested and working; `mcp-remote` may work (untested for Desktop) |
| ChatGPT | Custom GPT + GPT Actions (OpenAPI spec pointing at Edge Functions) | Streamable HTTP MCP not supported by ChatGPT |
| ChatGPT Desktop | Developer Mode MCP (beta) or Custom GPT + GPT Actions | Dev Mode requires Plus/Pro; **untested for MCP path** |
| Claude.ai web + mobile | Custom connector over **OAuth 2.1** to `cerefox-mcp` | **Working** (iter-28A). Optional feature; needs the Supabase OAuth setup + a free Cloudflare Worker consent page. Register the OAuth App with **`client_secret_post`**. See `docs/guides/setup-supabase.md` Step 7 + `connect-agents.md` → Cloud Claude. |

---

## Key Design Decisions

1. **Two-table schema** (documents + chunks) instead of single flat table — enables clean document lifecycle management and small-to-big retrieval
2. **768-dim vectors** standardized across all embedders — choose models that output 768 dims or use dimensionality reduction
3. **JSONB metadata** on both documents and chunks — evolvable without schema changes
4. **Greedy section accumulation** — sections (H1/H2/H3) are accumulated into a buffer until adding the next would exceed `max_chunk_chars`; no hard heading-level boundaries
5. **Cloud-only embeddings** (OpenAI / Fireworks) — local models (mpnet, Ollama) removed; they caused platform-specific failures and added install complexity
6. **Edge Function per operation** — each operation has a dedicated Edge Function that is a thin HTTP adapter over a Postgres RPC; `cerefox-mcp` calls those same RPCs directly (no delegation/fan-out to other Edge Functions); single implementation principle (see above)
7. **Chunks-anchored versioning** — `version_id IS NULL` = current version; `version_id = <uuid>` = archived; partial indexes automatically exclude archived chunks from search; no separate content table
8. **Title boosting** — `cerefox_chunks.fts` is a regular `TSVECTOR` (not `GENERATED`) because `GENERATED` columns cannot cross-reference another table. The `cerefox_ingest_document` RPC computes `fts` inline using its `p_title` parameter: document title at weight A, chunk heading at weight A, body at weight B. Embeddings are similarly enriched: `# {doc_title}\n{chunk.content}` is the embedding input (stored content is unchanged). Title changes trigger `cerefox_update_chunk_fts` + re-embed of current chunks.
9. **Optimistic concurrency on content updates** (v0.11 / schema 0.5.0) — updates via `cerefox_ingest_document` require `p_expected_content_hash` (compare-and-swap against the document's existing `content_hash`, atomic via `SELECT … FOR UPDATE` in the RPC) or an explicit `p_last_write_wins` (audit-logged). Stale → `CEREFOX_CONFLICT` (40001 / HTTP 409); absent → `CEREFOX_TOKEN_REQUIRED` (22023 / HTTP 400). All document-shaped read RPCs return `content_hash` so writers hold the token. Filesystem-sync flows (`ingest-dir`, `guides ingest`) pass `last_write_wins` internally. Design: `docs/specs/concurrency-control-design.md`.

## Documentation as Source of Truth

Documentation is a **first-class deliverable**, not an afterthought. This is an open source project — the quality of our docs determines whether anyone else can use it. Every iteration includes documentation work.

### Internal Docs (developer/agent context)

Kept accurate and current at all times:

| File | Owner | Update When |
|------|-------|-------------|
| `docs/requirements-and-specs.md` | Requirements | A requirement changes or is added/removed |
| `docs/solution-design.md` | Architecture | A design decision is made or revised |
| `docs/plan.md` | Progress + **cross-session hand-off** | A task starts, completes, or is re-scoped |
| `docs/TODO.md` | Backlog | A new idea or future task surfaces |
| `docs/e2e-use-cases.md` | Testing | An e2e test is added, removed, or changes status |
| `CLAUDE.md` | Conventions | Project conventions or structure changes |

**Rule**: when implementing a feature, update the relevant docs in the same commit/session. Another developer or AI agent should be able to read these files at any point and have an accurate picture of what is built, what is planned, and why.

**`docs/plan.md` is the primary cross-session hand-off artifact** — its main consumer is the *next* AI session continuing the work. Read its `## Current Focus` block (at the bottom) first to learn where the project is and what's next before touching code, and **keep it current as part of finishing any work** (update the relevant iteration entry + `Current Focus` in the same session). It tracks history/progress at a higher level than git; it is NOT a second changelog — release notes live in `CHANGELOG.md`, design rationale in `docs/specs/`. The doc's own header explains its structure and rules in full.

### Cerefox Decision Log (lives in the Cerefox KB, NOT in the repo)

The Cerefox maintainers keep a **"Cerefox Decision Log"** in their Cerefox knowledge base (project `Cerefox`) — the running record of decisions, tradeoffs, and lessons that would clutter the OSS repo. It is **not** in git. This section documents how the maintainers maintain it. (If you've forked Cerefox you're welcome to adopt the same pattern, but nothing here obligates your agent to write to your own KB — it's a maintainer practice, not a required step.)

The log is split across numbered parts (the part number lives in the **title**, e.g. "… (Part 6)", as a human label). Each part is tagged with metadata (**all values are JSON strings**): `type="decision-log"`, `seq` (global chronological order across all parts, e.g. `"8"`), `quarter`, and `latest` (`"true"` on exactly the current part, `"false"` on the rest). Strings are required — the MCP `metadata_filter` matches JSONB as strings (a boolean `latest:true` won't match `{latest:"true"}`); when setting via the CLI, force a string with `--set-meta latest='"false"'`. (There is deliberately no `part` metadata key — it would be per-quarter and non-unique; `seq` is the global ordering key.)

- **Find the current part — via metadata, never text search**: `cerefox_metadata_search {type:"decision-log", latest:"true"}` → the one current part. (`cerefox_search "Cerefox Decision Log"` is unreliable: it returns only top-N ranked hits, and the current part is the one most likely to fall outside the window as the log grows.)
- **Enumerate / order all parts**: `cerefox_metadata_search {type:"decision-log"}` (project `Cerefox`) with an explicit `limit`; order by `seq`.
- **Append, never compress**: add entries via `cerefox_ingest` with the current part's `document_id`. **Keep existing entries verbatim** — accidental compression is data loss. Each entry: date, short title, Context, Decision/Lesson, optional Outcome. Add one when a significant decision is made/revised, a platform behavior surprises us, an experiment fails with a lesson, or a third-party workaround is found.
- **Split protocol (~50K relaxed threshold)**: when the current part exceeds ~50,000 chars, the next entry starts a new part — **create the new part with `latest="true"` first; only after that write succeeds, set `latest="false"` on the previous part** (and bump `seq`). Never the reverse: that ordering guarantees exactly one current part — a brief two-latest transient is safe (pick the highest `seq`), a zero-latest window breaks discovery. Each part repeats a short metadata/process blurb at its top so it stands alone.

### User-Facing Docs (setup guides, how-tos)

These live in `docs/guides/` and are written for someone who has never seen the codebase:

| Guide | Covers |
|-------|--------|
| `quickstart.md` | Zero to first ingested document in < 15 minutes |
| `setup-supabase.md` | Full Supabase deployment (schema, MCP, config) |
| `setup-local.md` | Full local Docker deployment |
| `setup-cloud-run.md` | GCP Cloud Run deployment |
| `access-paths.md` | All access layers, credentials, and integration paths |
| `connect-agents.md` | MCP setup for Claude, Cursor, and generic clients |
| `configuration.md` | All `CEREFOX_` environment variables with defaults |
| `ops-scripts.md` | All `scripts/` — deploy, migrate, backup, restore |
| `operational-cost.md` | Embedding and hosting cost estimates |
| `CONTRIBUTING.md` (repo root) | How to contribute to Cerefox |

**Rule**: a setup guide must be written before (or alongside) the feature it documents — not after the fact.

## Quick Reference

- **Docs**: `docs/plan.md` for current status, `docs/TODO.md` for backlog
- **Agent guides**: `AGENT_GUIDE.md` (comprehensive reference for AI agents using Cerefox tools), `AGENT_QUICK_REFERENCE.md` (minimal quick reference card -- 8 tools, key rules, workflows)
- **Schema**: `src/cerefox/db/schema.sql`
- **Config**: `.env` file or environment variables (see `_shared/config/`)
- **Max response size**: defaults to 200000 bytes, configurable via `CEREFOX_MAX_RESPONSE_BYTES`. Enforced on the MCP / Edge Function paths **and the CLI** (the CLI also accepts a per-call `--max-bytes`). The **web UI is unlimited** (no byte budget).
