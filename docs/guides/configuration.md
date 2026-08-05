# Cerefox Configuration Reference

All settings use the `CEREFOX_` environment variable prefix and can be set in a `.env` file (location resolved per the rule below) or as actual environment variables.

Copy `.env.example` to `.env` to get started:
```bash
cp .env.example .env
```

## Where Cerefox looks for `.env` (v0.3.0+)

Resolved at process start, highest precedence wins:

1. **`CEREFOX_CONFIG_DIR`** environment variable — explicit override; supports `~` expansion.
2. **`./.env`** in the current working directory — dev mode. Wins for anyone running `cd /path/to/cerefox && cerefox …` from a repo clone.
3. **`~/.cerefox/.env`** — the user-state root; default for installed setups.

For most contributors, option 2 (repo-local `.env`) wins automatically. For an installed CLI (no repo checkout), option 3 is the default. Use option 1 to point a single machine at multiple Cerefox knowledge bases:

```bash
CEREFOX_CONFIG_DIR=~/.cerefox-work cerefox search "…"
CEREFOX_CONFIG_DIR=~/.cerefox-personal cerefox search "…"
```

Full rule documented in [`docs/specs/polish-and-distribution-design.md` §7](../specs/polish-and-distribution-design.md).

> **Local / self-hosted (World B).** For the Docker backend (`cerefox-local`), do **not**
> set the Supabase or `CEREFOX_DATABASE_URL` vars below — the container generates and owns
> them. Put `OPENAI_API_KEY` plus any of the `CEREFOX_*` **tuning** options on this page
> (search, chunking, retrieval, versioning, embedding base-url/model, caller identity) in
> `~/.cerefox/local/.env`; the installer + `cerefox-local` forward them into the container.
> Apply changes with `cerefox-local init`. See [`setup-local.md`](setup-local.md).

---

## Supabase / Database

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `CEREFOX_SUPABASE_URL` | `""` | For app | Supabase project URL. Found in: Project Settings → API → Project URL |
| `CEREFOX_SUPABASE_KEY` | `""` | For app | New **secret key** (`sb_secret_…`) from Project Settings → API Keys → Secret key. Legacy `service_role` JWT also works. **Keep secret.** See [`setup-supabase.md` → Supabase API keys (2026)](setup-supabase.md#supabase-api-keys-2026). |
| `CEREFOX_ACCESS_TOKEN` | `""` | For Edge Functions / e2e | **Cerefox access token** (`cfx_pat_…`), the single token this machine presents. Written to local `.env` by `cerefox token generate`. Used as the `Authorization: Bearer …` credential for remote MCP / GPT Actions / direct Edge Function calls, and read by `cerefox doctor` + the live e2e tests. Rotatable via `cerefox token rotate`. |
| `CEREFOX_ACCESS_TOKENS` | `""` | Server-side (Function secret) | The **server-side accepted set** — a comma-separated list of Cerefox tokens, set as a Supabase **Function secret** (not local `.env`). A request is accepted if its Bearer matches any token in the set, enabling zero-downtime rotation. Managed by `cerefox token generate` / `rotate`. |
| `CEREFOX_SUPABASE_ANON_KEY` | `""` | *(deprecated / unused)* | Formerly the legacy anon JWT Bearer for Edge Function calls. **Retired in iter-28E** — Edge Functions now authenticate the Cerefox access token in-function. Retained only so an old `.env` still parses; no longer read. |
| `CEREFOX_DATABASE_URL` | `""` | For scripts | Direct Postgres URL for deployment scripts. **Use the Session Pooler** (port `5432`) — Transaction Pooler (`6543`) does not support DDL. Username must include the project-ref suffix (`postgres.<project-ref>`). Append `?sslmode=require`. See [`setup-supabase.md` → Connection pooling (2026)](setup-supabase.md#connection-pooling-2026). |
| `SUPABASE_ACCESS_TOKEN` | *(unset)* | For EF deploys (optional) | Supabase **personal access token** (`sbp_…`, from [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens)), read by the **Supabase CLI** that `cerefox server deploy` shells out to for Edge Function deploys. Optional — without it the CLI falls back to its `supabase login` credential, which on **macOS lives in the Keychain and triggers a password dialog per function deploy** (9 per full deploy; a denied dialog fails that function with `LegacyPlatformAuthRequiredError`). Setting it in `~/.cerefox/.env` avoids the dialogs entirely: Cerefox exports every key from its `.env` to the environment, so the child CLI inherits it. Not a `CEREFOX_` variable — the name is the Supabase CLI's own. **Keep secret** (it grants management access to your Supabase account). |

**When each is needed:**
- `CEREFOX_SUPABASE_URL` + `CEREFOX_SUPABASE_KEY` — used by the CLI, web UI, and local MCP server (ingestion, search) via the Supabase Data API
- `CEREFOX_ACCESS_TOKEN` — used to call the Edge Functions (remote MCP, GPT Actions, direct HTTP) and by `cerefox doctor` / the live e2e tests; `CEREFOX_ACCESS_TOKENS` is its server-side counterpart (the accepted set). Generate both with `cerefox token generate`.
- `CEREFOX_DATABASE_URL` — used only for schema deploys (`cerefox server deploy`, or the contributor scripts `bun scripts/db_*.ts`) via a direct Postgres connection
- `SUPABASE_ACCESS_TOKEN` — optional; only consumed by the Supabase CLI during `cerefox server deploy` Edge Function deploys (recommended on macOS to avoid per-function Keychain dialogs)

---

## Embeddings

Cerefox uses cloud-based embedding APIs. Local models (mpnet, Ollama) are not supported — they require large downloads, fail on some hardware, and add installation complexity.

> **Two embedders.** `CEREFOX_EMBEDDER` selects the backend: `openai` (default —
> `text-embedding-3-small` via API) or `local` (the in-container `nomic-embed-text-v1.5`
> ONNX model — **Cerefox Local only**; the cloud/Supabase deployment embeds inside the
> Edge Functions, which a local model can't serve, so `local` has no effect there).
> Set it via the Cerefox Local installer (`--local-embedder`) or `cerefox-local init` —
> not by hand on existing data (switching requires `server reindex`; see
> [setup-local.md](setup-local.md#choose-your-embedder-openai-vs-fully-local)).
> The `CEREFOX_FIREWORKS_*` variables remain documented but **not wired** (no-ops).

### OpenAI (default, recommended)

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | `""` | OpenAI API key. Also accepted as `CEREFOX_OPENAI_API_KEY`. Get one at [platform.openai.com/api-keys](https://platform.openai.com/api-keys). |
| `CEREFOX_OPENAI_BASE_URL` | `https://api.openai.com/v1` | API base URL. Safe to override for proxies or OpenAI-compatible gateways. |
| `CEREFOX_OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | OpenAI embedding model. ⚠ see warning below. |
| `CEREFOX_OPENAI_EMBEDDING_DIMENSIONS` | `768` | Output dimensions. Must match the DB schema (`VECTOR(768)`). ⚠ see warning below. |

> **⚠ Changing the model or dimensions is breaking.** Query vectors must match the stored
> vectors. After changing `CEREFOX_OPENAI_EMBEDDING_MODEL` you MUST re-embed the whole
> corpus (`cerefox server reindex`); changing `CEREFOX_OPENAI_EMBEDDING_DIMENSIONS` away
> from 768 also requires a schema change. `CEREFOX_OPENAI_BASE_URL` is the only one safe to
> flip on an existing knowledge base.

For cost estimates see `docs/guides/operational-cost.md`.

### Edge Functions (for agents)

The `cerefox-search` and `cerefox-ingest` Supabase Edge Functions handle embeddings server-side -- agents don't need to set up any embedder locally. The Edge Functions read `OPENAI_API_KEY` from the Supabase project's secrets. See `docs/guides/connect-agents.md`.

### Embedding API retry

All embedding API calls (TS embedder and Edge Functions) include automatic retry with exponential backoff for transient failures:

- **3 attempts** with backoff: 500ms, 1s, 2s
- **Retried**: HTTP 5xx server errors, network timeouts, connection failures
- **Not retried**: HTTP 4xx client errors (invalid API key, bad request)
- **Logged**: every retry attempt is logged with the failure reason and attempt number

This handles intermittent OpenAI API errors (500s) that would otherwise cause search or ingestion failures. The retry logic is consistent across both the local path (local MCP, web UI, CLI) and the Edge Function path (remote MCP, GPT Actions).

---

## Chunking

| Variable | Default | Description |
|----------|---------|-------------|
| `CEREFOX_MAX_CHUNK_CHARS` | `4000` | Maximum characters per chunk before splitting at paragraph boundaries |
| `CEREFOX_MIN_CHUNK_CHARS` | `100` | Minimum chunk size. Chunks smaller than this are merged into the preceding chunk |

**Tuning advice:**
- Smaller `MAX_CHUNK_CHARS` → more precise chunk retrieval, but more DB rows and more embedding calls
- Larger `MAX_CHUNK_CHARS` → fewer chunks, coarser retrieval
- Default (4000) is a good balance for typical markdown notes
- Heading-bounded chunks are always kept whole regardless of size — `MIN_CHUNK_CHARS` only affects paragraph-level splits within oversized sections

---

## Retrieval

> **Deployment-wide defaults (v1.1.0+).** `min_search_score`,
> `min_term_coverage`, and `search_alpha` can also be set **once, in the
> database**, and every access path obeys — CLI, local and remote MCP, Edge
> Functions, web — because they all resolve through the same search RPCs:
>
> ```bash
> cerefox config set min_search_score 0.6
> cerefox config list          # shows every settable key
> ```
>
> Resolution order, highest first: **per-call argument** (`--min-score`, the
> `min_score` MCP parameter) → **client env var** below → **`cerefox_config`**
> → built-in default. A malformed stored value is ignored in favour of the
> built-in, so a bad setting can never break search.

> **Which paths read these?** Client-side tunables in this section are read
> from *your* `.env` by the **CLI**, the **local MCP server**, and `cerefox
> web`. Since **v1.0.6** the same values are also honored on the **remote MCP /
> Edge Function path** when set as Supabase **Function secrets**
> (`supabase secrets set CEREFOX_MIN_SEARCH_SCORE=0.55 --project-ref <ref>`) —
> the shared helpers read `Deno.env` as well as `process.env`. Per-call
> parameters (`min_score`, `min_term_coverage`, `alpha` on `cerefox_search`)
> override both. A single setting that governs every path without secrets is
> tracked as issue #133 (DB-backed config).

| Variable | Default | Description |
|----------|---------|-------------|
| `CEREFOX_MAX_RESPONSE_BYTES` | `200000` | Maximum bytes in a single search response (local MCP path). See explanation below. |
| `CEREFOX_MIN_SEARCH_SCORE` | `0.50` (`0.60` with the local embedder) | Minimum cosine similarity for hybrid and semantic search results (0.0–1.0). The default is embedder-aware: nomic scores unrelated text higher than OpenAI, so `CEREFOX_EMBEDDER=local` raises the floor to 0.60. In **hybrid search**, chunks that matched the FTS keyword operator (`@@`) always pass through regardless of their vector score — the threshold only filters vector-only results. In **semantic search**, all results are filtered. The pure **FTS search** mode is unaffected. Increase for stricter precision; decrease for wider recall. |
| `CEREFOX_SEARCH_ALPHA` | `0.7` | Hybrid fusion weight (0.0–1.0): `1.0` = pure semantic, `0.0` = pure keyword. Applies to hybrid and document-mode search. Per-call override: `cerefox search --alpha`, or the `alpha` parameter on the `cerefox_search` MCP tool. |
| `CEREFOX_MIN_TERM_COVERAGE` | *(unset — server default `0.5`)* | Confidence bar for the keyword OR-fallback (v1.0.4, schema ≥ 0.9.1): when a strict all-terms match fails and search relaxes to any-term matching, a result counts as a confident hit only if it matches at least this fraction of the query's meaningful terms; weaker matches surface as below-confidence candidates. `0` restores pre-gate behavior (any matching term passes); `1` requires every term. Per-call override: `cerefox search --min-term-coverage`. Leave unset against pre-0.9.1 servers. |
| `CEREFOX_EMBED_MAX_INPUT_CHARS` | `20000` | Safety cap on the characters sent to the embedding model per input. The full chunk content is always stored and reconstructed untouched; only the embedding uses the (rare) truncated prefix, so an oversized chunk can never fail an ingest. |
| `CEREFOX_MODELS_DIR` | `~/.cerefox/models` (in-container: inside the data volume) | Where the local embedder caches downloaded model weights (Cerefox Local; `CEREFOX_EMBEDDER=local`). |
| `CEREFOX_ONNX_BATCH` | `4` | Texts per local-embedder inference call. Peak memory scales with this; the small default keeps ingest/reindex safe on small Docker VMs. |

### Metadata filter

The `metadata_filter` search parameter (available in all search modes, all access paths) performs **server-side JSONB containment filtering** before vector ranking. It is not a configuration variable — it is passed per request.

- Filters are expressed as a JSON object: `{"type": "decision", "status": "active"}`
- All key-value pairs must match (AND semantics via PostgreSQL `@>` operator)
- Uses the existing GIN index on `cerefox_documents.metadata` — no additional schema changes needed
- `NULL` filter = no restriction (backwards-compatible default)
- Discover available keys via `cerefox_list_metadata_keys` MCP tool or `cerefox metadata keys` CLI

Access paths:
- **MCP tool**: `metadata_filter` argument on `cerefox_search`
- **CLI**: `cerefox search "query" --metadata-filter '{"type": "decision"}'` (short form: `-f`)
- **Web UI**: Metadata Filter section (collapsible) in the Knowledge Browser
- **GPT Actions**: `metadata_filter` field in `searchKnowledgeBase` request body (schema v1.4.0)
- **HTTP API**: `metadata_filter` JSON key in the `cerefox-search` Edge Function POST body

**Score threshold guidance (OpenAI text-embedding-3-small):**

| Score | Meaning |
|-------|---------|
| 0.0 – 0.20 | Noise floor — unrelated content |
| 0.20 – 0.45 | Weak/tangential overlap — same domain, different topic |
| 0.45 – 0.70 | Genuine semantic match — related concepts, paraphrases |
| 0.70 – 1.0 | High similarity — near-duplicate or very direct answer |

Recommended values:
- `0.50` (default) — filters noise, keeps genuine results
- `0.40`–`0.45` — wider recall; useful for small corpora or exploratory search
- `0.70`–`0.80` — high precision; only very close semantic matches
- `0.0` — disable filtering entirely (returns all RPC results, not recommended)

### Response size limits

Response size limits are **opt-in per call** — they apply only on the MCP and Edge Function
paths where an AI agent's context window matters. The web UI and CLI always return all results
with no truncation.

| Path | Default limit | Ceiling | How to change |
|------|--------------|---------|---------------|
| Web UI / CLI | None | None | — |
| Local MCP server (`cerefox mcp`) | `CEREFOX_MAX_RESPONSE_BYTES` | Same | `.env` |
| Remote MCP / Edge Function | 200 000 bytes | 200 000 bytes | Agent passes `max_bytes` |

**`CEREFOX_MAX_RESPONSE_BYTES`** sets the default and ceiling for the local MCP server. Agents
can pass a smaller `max_bytes` in the `cerefox_search` tool call; larger values are silently
capped at this setting.

**Why 200 000 as the default?** At the default `match_count=5` and small-to-big threshold of
20 000 chars, the worst case is 5 × 20 KB ≈ 100 KB — comfortably under 200 KB. The limit
protects against high `match_count` + large documents without cutting legitimate results at
defaults. (The original 65 KB default was driven by the Supabase MCP protocol limit, which no
longer applies.)

**Agent `max_bytes` parameter**: pass this when your model's context window is limited:
- MCP tool: `{"query": "...", "max_bytes": 50000}`
- Edge Function body: `{"query": "...", "max_bytes": 50000}`

See `docs/guides/response-limits.md` for the full guide including behaviour details and examples.

### RPC-level retrieval parameters

Two retrieval parameters are configured directly in `src/cerefox/db/rpcs.sql` rather than in `.env`. They follow the same convention as `OPENAI_MODEL` and `EMBEDDING_DIMENSIONS` in the Edge Functions: they are system-level tuning knobs that rarely change, and changing them requires a SQL re-deploy (`cerefox server deploy`) rather than a restart.

| Parameter | Default | Location | Description |
|-----------|---------|----------|-------------|
| `p_small_to_big_threshold` | `20000` chars | `rpcs.sql` — `cerefox_search_docs` | Documents larger than this return matched chunks + neighbours instead of the full document. Set to `0` to always return full content. |
| `p_context_window` | `1` | `rpcs.sql` — `cerefox_search_docs` | Neighbour chunks on each side of each matched chunk. `N=1` → up to 3 contiguous chunks per hit. `N=0` → matched chunks only. `N=2` → up to 5. |

To change these values, edit the `DEFAULT` values in `cerefox_search_docs` in `src/cerefox/db/rpcs.sql` and redeploy:
```bash
cerefox server deploy        # contributors with a repo clone: bun scripts/db_deploy.ts
```

---

## Versioning

Cerefox automatically archives previous document content whenever a document is updated with new content. Archived chunks are preserved and searchable via the versioning API, but excluded from live search results.

| Variable | Default | Description |
|----------|---------|-------------|
| `CEREFOX_VERSION_RETENTION_HOURS` | `48` | How many hours to keep archived document versions. Versions older than this are lazily deleted the next time the same document is updated. Always keeps at least the most recent version regardless of age. |
| `CEREFOX_VERSION_CLEANUP_ENABLED` | `true` | When `true`, old versions are lazily deleted during updates (respecting `VERSION_RETENTION_HOURS`). Versions marked as `archived` are always protected. When `false`, all versions are retained indefinitely (immutable mode). |

**How versioning works:**

When a document's content changes during ingestion, Cerefox calls the `cerefox_snapshot_version` database function before writing new chunks. This function:
1. Creates a version record in `cerefox_document_versions`
2. Moves all current chunks to that version (by setting their `version_id`)
3. If `CEREFOX_VERSION_CLEANUP_ENABLED` is `true`, deletes stale versions older than `CEREFOX_VERSION_RETENTION_HOURS` (skipping archived versions)

Metadata-only updates (same content, different title or project) do **not** create a new version.

To view and retrieve previous versions:
```bash
cerefox document version list <document-id>
cerefox document get <document-id> --version-id <version-id>
```

---

## Storage & Backup

| Variable | Default | Description |
|----------|---------|-------------|
| `CEREFOX_BACKUP_DIR` | dev mode: `./backups` · user-state mode: `~/.cerefox/backups` (v0.3.0+) | Local directory where file system backups are stored. Created automatically if it doesn't exist. The default tracks the resolved config dir — dev users see no change. |
| `CEREFOX_VERSION_RETENTION_HOURS` | `48` | How long to retain archived document versions (hours). The most recent version is always kept regardless of this setting. |

---

## Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `CEREFOX_LOG_LEVEL` | `INFO` | Logging level. Valid values: `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL` |

Set to `DEBUG` during development to see detailed operation logs.

---

## Example: Minimal Production `.env`

```bash
# Required
CEREFOX_SUPABASE_URL=https://abcdefghijkl.supabase.co
CEREFOX_SUPABASE_KEY=eyJhbGciOiJIUzI1NiIs...

# Required for scripts only
CEREFOX_DATABASE_URL=postgresql://postgres.abcdefghijkl:MyPassword@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require

# Embeddings — OpenAI (default)
OPENAI_API_KEY=sk-...

# All other settings use defaults
```

> **Fireworks is not wired yet** — `CEREFOX_EMBEDDER=fireworks` / `CEREFOX_FIREWORKS_*`
> are documented but currently no-ops. The wired embedders are `openai` (default) and
> `local` (Cerefox Local only). Fireworks is tracked for a future release.

---

## Changing the embedding model

Cerefox has **two independent access paths**, each with its own embedding configuration:

| Path | Where embedding happens | Config location |
|------|------------------------|-----------------|
| Local MCP server + CLI + web UI | Local embedder (reads `.env`) | `.env` (`CEREFOX_OPENAI_EMBEDDING_MODEL`, etc.) |
| Edge Functions (GPT Actions, curl) | TypeScript constants in Edge Function code | Hardcoded in `supabase/functions/*/index.ts` |

When you change the embedding model, **both paths must be updated and kept in sync** — they must use the same model and dimensions, or search results will be incoherent (queries embedded by one model won't match chunks embedded by another).

### Step 1 — Update `.env`

Change `CEREFOX_OPENAI_EMBEDDING_MODEL` and `CEREFOX_OPENAI_EMBEDDING_DIMENSIONS` to the new values.

### Step 2 — Re-embed all stored chunks

```bash
cerefox server reindex
```

This re-embeds every chunk in the database using the model now configured in `.env`.
Preserves document IDs and project assignments. Run this before using the new model for searches.

### Step 3 — Update and redeploy the Edge Functions (if you use them)

The Edge Functions have the model hardcoded as TypeScript constants. Edit both files:

```
supabase/functions/cerefox-search/index.ts   (lines ~29–30)
supabase/functions/cerefox-ingest/index.ts   (lines ~25–26)
```

Change:
```typescript
const OPENAI_MODEL = "text-embedding-3-small";  // ← update this
const EMBEDDING_DIMENSIONS = 768;               // ← and this if dimensions change
```

Then redeploy the Edge Functions:
```bash
cerefox server deploy --functions-only
```

Contributors with a repo clone can instead redeploy individual functions with `npx supabase functions deploy cerefox-search` (and `cerefox-ingest`), or through the Supabase Dashboard → Edge Functions → Deploy.

> **If you only use the local MCP server** (Claude Desktop, ChatGPT Desktop, Cursor), Step 3 is
> optional — the Edge Functions are only used for GPT Actions and direct HTTP access.

> **Future improvement**: the Edge Functions will be updated to read model config from Supabase
> secrets, eliminating the need to edit TypeScript and redeploy when the model changes.

---

## Usage Tracking

Cerefox can optionally log all operations (both reads and writes) across all access paths.
This includes search, metadata search, get document, list versions, get audit log, list
metadata keys, list projects, and ingest. This data feeds the analytics page and CSV export.

**Usage tracking is opt-in and disabled by default.** No data is collected until you explicitly
enable it.

### How it works

A `cerefox_config` table in Postgres stores runtime configuration as key-value pairs. The only
key currently in use is `usage_tracking_enabled`. Every usage logging call goes through the
`cerefox_log_usage` RPC, which checks this config value first:

- If `usage_tracking_enabled` is `"true"` -- the RPC inserts a row into `cerefox_usage_log`
- If `usage_tracking_enabled` is anything else (including missing) -- the RPC returns immediately without inserting

The check happens **inside Postgres on every call**. All callers (Edge Functions, MCP tools,
CLI) call `cerefox_log_usage` unconditionally -- the RPC decides whether to
actually log. Callers never wait for the logging result or handle errors from it
(fire-and-forget).

This means:
- **No redeploy needed** to toggle tracking on or off -- just change the config value
- **No performance impact when disabled** -- the RPC exits immediately
- **One implementation** -- the check is in the RPC, not duplicated across callers

### Enabling and disabling

**Via CLI:**
```bash
# Enable
cerefox config set usage_tracking_enabled true

# Disable
cerefox config set usage_tracking_enabled false

# Check current state
cerefox config get usage_tracking_enabled
```

The canonical path is the CLI (`cerefox config set <key> <value>` / `cerefox config get <key>`) above; it works regardless of whether the web server is running. The web UI's JSON API exposes the same config under `/api/v1/config/<key>` if you need programmatic access while `cerefox web` is running.

### What gets logged

Each usage log entry records:

| Field | Description |
|-------|-------------|
| `operation` | What was called: `search`, `metadata_search`, `get_document`, `list_versions`, `get_audit_log`, `list_metadata_keys`, `list_projects` |
| `access_path` | Where the call came from: `remote-mcp`, `local-mcp`, `edge-function`, `webapp`, `cli` |
| `requestor` | Who made the call: agent name (e.g., "Claude Code", "mcp-agent") or "user" for webapp/CLI |
| `document_id` | Optional: which document was accessed (for get_document, list_versions) |
| `project_id` | Optional: which project was filtered on |
| `query_text` | The search query or metadata filter |
| `result_count` | Number of results returned |
| `extra` | Flexible JSONB for additional context |

The `access_path` is set by the caller layer (not the end user):
- Edge Functions set `"edge-function"` (GPT Actions, direct HTTP callers)
- `cerefox-mcp` tool handlers set `"remote-mcp"` (Claude Code, Cursor, Claude Desktop)
- The web UI's JSON API routes set `"webapp"`
- Local MCP server sets `"local-mcp"`
- CLI sets `"cli"` for read/search commands

### Viewing and exporting usage data

**REST API endpoints:**
- `GET /api/v1/usage-log` -- filtered list of entries (params: start, end, operation, access_path, requestor, project_id, limit)
- `GET /api/v1/usage-log/summary` -- aggregated stats (by day, operation, access path, top documents, top requestors)
- `GET /api/v1/usage-log/export.csv` -- CSV download with all columns

**CLI:**
```bash
cerefox config get usage_tracking_enabled
```

---

## Requestor Identity Enforcement

By default, the `requestor` parameter on MCP read tools (and `author` on ingest) is
optional. When omitted, it defaults to `"mcp-agent"`. This means the usage log shows
`"mcp-agent"` for all calls that don't explicitly identify themselves, making analytics
less useful in multi-agent setups.

You can optionally enforce caller identification so that all MCP tool calls must include
a requestor/author identity. Calls without identity receive a JSON-RPC `-32602` error
with a helpful message telling the agent what to provide.

### Enabling enforcement

```bash
# Require all MCP tool calls to include requestor/author
cerefox config set require_requestor_identity true

# Optionally override the default naming format (regex)
# Default: ^[a-zA-Z0-9_:.\- ]+$ (letters, numbers, underscores, colons, dots, hyphens, spaces)
cerefox config set requestor_identity_format "^[a-z]+:[a-z]+$"
```

### Format examples

| Format regex | Allows | Use case |
|-------------|--------|----------|
| `^[a-zA-Z0-9_:.\- ]+$` | Letters, numbers, underscores, colons, dots, hyphens, spaces | **Default** -- covers "Claude Code", "mcp-agent", "personal:steward", "user" |
| `^[a-z]+:[a-z]+$` | `conclave:agent` format only | Multi-conclave setups (e.g., `personal:steward`) |
| (empty string) | Any non-empty string | No format restriction |

The format is applied to both `requestor` (read tools) and `author` (ingest).

### Disabling enforcement

```bash
cerefox config set require_requestor_identity false
```

When disabled, the requestor parameter remains optional with the `"mcp-agent"` default.
This is the default state -- no configuration needed for backward compatibility.

---

## Checking Your Configuration

Run the doctor to verify everything is connected (credentials, DB reachability, schema version):

```bash
cerefox doctor       # or: cerefox status
```

If it reports all checks green, your configuration is correct.
