# Connecting AI Agents to Cerefox

Cerefox exposes your knowledge base through two access paths. Choose the one that fits your
client; you can also run both in parallel.

---

## Access paths at a glance

| Client | Path | Search capability |
|--------|------|-------------------|
| Claude Desktop (local) | Path A — `cerefox mcp` | Hybrid (FTS + semantic), document-level |
| Cursor (local) | Path A — `cerefox mcp` | Hybrid (FTS + semantic), document-level |
| Claude Code (CLI / Desktop Code tab) | Path A — `cerefox mcp` | Hybrid (FTS + semantic), document-level |
| ChatGPT (chatgpt.com or desktop app) | Path B — Custom GPT → Edge Functions | Hybrid (FTS + semantic), document-level |
| Cloud Claude (claude.ai web) | Remote Supabase MCP | FTS keyword only (no semantic) |
| curl / scripts | Path B — Edge Functions directly | Hybrid (FTS + semantic), document-level |
| Custom Python agents | Python SDK directly | Hybrid (FTS + semantic), document-level |

> **"Document-level"** means agents receive complete reconstructed notes, not isolated chunks.

> **Cloud hybrid for all clients (future)**: deploying the MCP server to Cloud Run would give
> cloud clients (claude.ai, chatgpt.com) full hybrid search. Tracked in `docs/TODO.md`.

> **Perplexity** does not support MCP and has no integration path at this time.

---

## Prerequisites

**For all paths:**
- Supabase project set up and schema deployed (see `setup-supabase.md`)
- Some content ingested (`cerefox ingest my-notes.md`)

**For Path A (local MCP) only:**
- [`uv`](https://docs.astral.sh/uv/getting-started/installation/) installed on your machine
- Cerefox repository cloned locally (e.g. `/Users/yourname/src/cerefox`)
- `.env` file configured with `CEREFOX_SUPABASE_URL`, `CEREFOX_SUPABASE_KEY`,
  and your embedding API key (`OPENAI_API_KEY`)

**For Path B (Edge Functions / GPT Actions) only:**
- Supabase Edge Functions deployed (`cerefox-search` and `cerefox-ingest`) —
  see `setup-supabase.md` → Step 8 for the deploy procedure (`npx supabase functions deploy`)
- Your **anon key**: Supabase Dashboard → Project Settings → API → `anon public`
- Your **project ref**: visible in the Supabase Dashboard URL
  (`app.supabase.com/project/<project-ref>`)

**For cloud Claude.ai only:**
- A **Personal Access Token** (PAT): create at `https://supabase.com/dashboard/account/tokens`

---

## Path A — Local MCP server (`cerefox mcp`)

### What it is

`cerefox mcp` is a Python process that runs on your machine. Desktop AI clients launch it as a
subprocess over stdio. It exposes named `cerefox_search` and `cerefox_ingest` tools directly —
no HTTP calls, no GET-only limitations.

- Embeddings are computed locally using your `.env` key (no extra credentials)
- Works offline except for the OpenAI embedding API call per query
- One setup, all compatible local clients (Claude Desktop, Cursor, Claude Code)

> **Why not `mcp-server-fetch`?** The generic fetch MCP only supports GET requests and cannot
> make authenticated POST calls to the Edge Functions. The built-in `cerefox mcp` server is
> the correct solution.

### Path A MCP tools

Once configured, every Path A client has these two tools:

| Tool | Description |
|------|-------------|
| `cerefox_search` | Hybrid (FTS + semantic) document-level search |
| `cerefox_ingest` | Save a note or document to the knowledge base |

### Path A system prompt

Set this as Custom Instructions / System Prompt in your client:

```
You have access to a personal knowledge base via the cerefox_search tool.
When answering questions, always call cerefox_search first with a relevant query.
Cite doc_title for every claim drawn from the knowledge base.
Use cerefox_ingest to save anything the user asks you to remember.
```

### Path A verification prompts

After setup, ask your client:

> "What tools do you have available?"
> Expected: `cerefox_search` and `cerefox_ingest` listed.

> "Use cerefox_search with query='second brain' and match_count=3. What did you find?"

> "Save a note titled 'Test Note' with content '# Test\nThis is a test.' using cerefox_ingest."

---

### Claude Desktop

**Config file location:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add (or merge into) the file:

```json
{
  "mcpServers": {
    "cerefox": {
      "command": "uv",
      "args": ["--directory", "/path/to/cerefox", "run", "cerefox", "mcp"]
    }
  }
}
```

Replace `/path/to/cerefox` with the absolute path to your Cerefox checkout
(e.g. `/Users/yourname/src/cerefox` on macOS, `C:\Users\yourname\src\cerefox` on Windows).

**Important:**
- Merge the `mcpServers` block into any existing `claude_desktop_config.json` — do not wrap it
  in an extra `{}` or replace the whole file.
- Restart Claude Desktop fully (Cmd+Q on macOS, not just close the window) after saving.
- No extra environment variables needed — the server reads `CEREFOX_*` settings from your `.env`.

---

### ChatGPT Desktop

> **ChatGPT Desktop does not support local stdio MCP servers.**
> OpenAI's MCP implementation for ChatGPT only supports remote servers via SSE or
> streaming HTTP — not local subprocess (stdio) servers like `cerefox mcp`.
> The "dev mode" MCP connector visible in the app also requires a public URL.
>
> **Use Path B (Custom GPT + Edge Functions) for all ChatGPT access** — both the web
> app and the desktop app. The Custom GPT approach is fully validated and works well.

---

### Cursor

1. Open **Cursor Settings** (`Cmd+,`) → **Tools & Integrations** → **MCP** → **Add new global MCP server**
2. Paste this into the MCP config JSON:

```json
{
  "mcpServers": {
    "cerefox": {
      "command": "uv",
      "args": ["--directory", "/path/to/cerefox", "run", "cerefox", "mcp"]
    }
  }
}
```

3. Save and restart Cursor.

Alternatively, add a `.cursor/mcp.json` file in your project root with the same content for
project-scoped access (committed to git, shared with your team).

---

### Claude Code

Claude Code (the CLI tool and the **Code** tab inside Claude Desktop) uses its own MCP config —
separate from `claude_desktop_config.json`. Changes made in one do not affect the other.

**Option 1: CLI command (recommended — persists across all projects)**

```bash
claude mcp add --scope user cerefox \
  uv -- --directory /path/to/cerefox run cerefox mcp
```

- `--scope user` makes the server available in every project (stored in `~/.claude/mcp.json`).
- Use `--scope project` instead to limit it to the current directory (stored in `.mcp.json`).

Verify:
```bash
claude mcp list
```

**Option 2: `.mcp.json` in project root (project-scoped, committable)**

Create `.mcp.json` in the root of the repo you work in:

```json
{
  "mcpServers": {
    "cerefox": {
      "command": "uv",
      "args": ["--directory", "/path/to/cerefox", "run", "cerefox", "mcp"]
    }
  }
}
```

**Code tab inside Claude Desktop:**
The **Code** tab in Claude Desktop uses the same config as the Claude Code CLI, not
`claude_desktop_config.json`. Run the `claude mcp add` command above — the Code tab will
pick it up automatically.

---

## Path B — Supabase Edge Functions (HTTP)

### What they are

TypeScript functions deployed to Supabase, callable over HTTPS from anywhere — no local install,
no MCP client needed. Embeddings are computed server-side using the `OPENAI_API_KEY` secret
stored in Supabase.

- Works from cloud agents (ChatGPT GPT Actions, scripts, CI pipelines)
- No user machine required; Supabase handles all infrastructure
- Constraint: embedding model is hardcoded in TypeScript — requires redeployment when changed
  (see `docs/guides/configuration.md` → "Changing the embedding model")

### Path B authentication

All Edge Function calls require:

```
Authorization: Bearer <your-anon-key>
Content-Type: application/json
```

Find your anon key: **Supabase Dashboard → Project Settings → API → `anon public`**

### Path B system prompt

For ChatGPT Custom GPT:
```
You have access to a personal knowledge base via the searchKnowledgeBase action.
When the user asks a question, always search the knowledge base first using a
relevant query. Present results by document title, citing the source for every claim.
Use ingestNote to save any new information the user asks you to remember.
```

### Path B verification

```bash
curl -s -X POST \
  "https://<your-project-ref>.supabase.co/functions/v1/cerefox-search" \
  -H "Authorization: Bearer <your-anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"query": "second brain", "match_count": 3}'
```

Expected: JSON response with `results` array containing documents.

---

### ChatGPT Custom GPT (cloud — chatgpt.com)

A Custom GPT with Actions pointing at the Edge Functions gives ChatGPT full hybrid search from
any browser — no local install, no MCP client, works free with ChatGPT Plus.

**Step 1 — Create the Custom GPT**

1. Go to **chatgpt.com → Explore GPTs → Create**
2. Name it (e.g. "Cerefox Assistant")
3. Paste the system prompt from "Path B system prompt" above into the **Instructions** field
4. Click **Create new action**

**Step 2 — Paste the OpenAPI schema**

In the action editor, paste this schema (replace `<your-project-ref>`):

```yaml
openapi: 3.1.0
info:
  title: Cerefox Knowledge Base
  version: 1.0.1
servers:
  - url: https://<your-project-ref>.supabase.co/functions/v1
paths:
  /cerefox-search:
    post:
      operationId: searchKnowledgeBase
      summary: Search the knowledge base (hybrid FTS + semantic, document-level)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [query]
              properties:
                query:
                  type: string
                match_count:
                  type: integer
                  default: 5
                project_name:
                  type: string
                mode:
                  type: string
                  default: docs
      responses:
        '200':
          description: Search results
  /cerefox-ingest:
    post:
      operationId: ingestNote
      summary: Save a note to the knowledge base
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [title, content]
              properties:
                title:
                  type: string
                content:
                  type: string
                project_name:
                  type: string
                source:
                  type: string
                  default: agent
                metadata:
                  type: object
                update_if_exists:
                  type: boolean
                  default: false
                  description: >
                    When true, update an existing document with the same title
                    instead of creating a new one. If content is unchanged,
                    the document is skipped (no re-indexing).
      responses:
        '200':
          description: Ingest result
```

**Step 3 — Configure authentication**

In the action's **Authentication** settings:
- Type: **API Key**
- Auth type: **Bearer**
- API key: your Supabase **anon key**

**Step 4 — Save and test**

Save the GPT. In a new chat, ask:
> "Search my knowledge base for 'second brain'."

> **Cost**: GPT Actions are free with ChatGPT Plus. Each search call uses a small amount of
> OpenAI API credits for embedding the query. See `docs/guides/operational-cost.md`.

---

### curl / scripts

Direct HTTP access — useful for shell scripts, CI pipelines, or one-off queries.

**Search:**
```bash
curl -s -X POST \
  "https://<your-project-ref>.supabase.co/functions/v1/cerefox-search" \
  -H "Authorization: Bearer <your-anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"query": "knowledge management", "match_count": 5}'
```

**Ingest:**
```bash
curl -s -X POST \
  "https://<your-project-ref>.supabase.co/functions/v1/cerefox-ingest" \
  -H "Authorization: Bearer <your-anon-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Meeting Notes 2026-03-11",
    "content": "# Meeting Notes\n\n## Q1 Roadmap\n\nWe agreed to prioritize...",
    "project_name": "Work",
    "source": "agent"
  }'
```

If the same content was already ingested (SHA-256 hash match), returns `"skipped": true`.

**Edge Function parameters — `cerefox-search`:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | required | Natural-language search query |
| `project_name` | string | optional | Filter by project name (case-insensitive) |
| `match_count` | number | 5 | Maximum **documents** to return |
| `mode` | string | `"docs"` | `"docs"` = full document results (recommended) |
| `alpha` | number | 0.7 | Semantic weight (0 = FTS only, 1 = semantic only) |
| `min_score` | number | 0.5 | Minimum cosine similarity threshold |
| `max_bytes` | number | 65000 | Response size budget in bytes. Results are dropped whole (never truncated mid-document) once the budget is reached. The response includes `truncated: true` and `response_bytes` when the limit was hit. See "Response size limit" below. |

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `results` | array | Matched documents or chunks |
| `query` | string | The original query |
| `mode` | string | Search mode used |
| `match_count` | number | `match_count` value used |
| `project_name` | string\|null | Project filter applied (if any) |
| `truncated` | boolean | `true` when results were dropped to stay within `max_bytes` |
| `response_bytes` | number | Actual bytes in the returned `results` array |

**Response size limit (`max_bytes`):**

The default of 65 000 bytes matches the Supabase MCP protocol's hard limit, so both the local MCP path and the Edge Function path return an identical amount of content out of the box. This is intentional — if you run both paths in parallel (e.g. Claude Desktop via local MCP + ChatGPT via GPT Actions), agents always receive the same results regardless of which path they use.

Even on the Edge Function path, where no protocol ceiling exists, 65 KB is a sensible practical ceiling: returning more content than a model can meaningfully use wastes tokens and can degrade response quality. Most queries need only a handful of relevant documents.

You can raise `max_bytes` on the Edge Function if you exclusively use that path and your LLM client has a large enough context window — for example for a Custom GPT ingesting large reference documents:
```json
{ "query": "deployment checklist", "max_bytes": 120000 }
```

Do **not** raise `CEREFOX_MAX_RESPONSE_BYTES` (the local MCP setting) above ~65 000 — the Supabase MCP protocol will silently truncate the JSON response, which can confuse the agent. See `docs/guides/configuration.md` → "Response size limit" for the full breakdown.

---

### Cloud Claude (claude.ai web)

Claude.ai web can connect to the Supabase-hosted remote MCP (no local install):

1. In Claude.ai: **Settings → Integrations → Add integration**
2. Enter the MCP URL:
   ```
   https://mcp.supabase.com/sse?project_ref=<your-project-ref>
   ```
3. Authenticate with your Personal Access Token when prompted.

> **Limitation**: The cloud Supabase MCP only supports **FTS keyword search** — no hybrid or
> semantic search. For full hybrid search from the web, deploy the MCP server to Cloud Run
> (see `docs/TODO.md` → "Remote HTTP MCP server").

---

## Custom agents (Python SDK)

Use the Cerefox Python client directly for scripted or embedded agents:

```python
from cerefox.config import Settings
from cerefox.db.client import CerefoxClient
from cerefox.embeddings.cloud import CloudEmbedder
from cerefox.retrieval.search import SearchClient

settings = Settings()            # reads from .env
client = CerefoxClient(settings)
embedder = CloudEmbedder(
    api_key=settings.get_embedder_api_key(),
    base_url=settings.get_embedder_base_url(),
    model=settings.get_embedder_model(),
    dimensions=settings.get_embedder_dimensions(),
)
sc = SearchClient(client, embedder, settings)

resp = sc.search_docs("what did I write about Rust?", match_count=5)
for hit in resp.results:
    print(f"[{hit.best_score:.2f}] {hit.doc_title}")
    print(hit.full_content[:400])
```

---

## Keeping both paths in sync

Both paths use the same Postgres RPCs and the same stored embeddings, but embed queries
independently. If you change the embedding model, **update both paths** before searching:

1. Update `.env` + run `cerefox reindex` (re-embeds stored chunks via Python)
2. Update the TypeScript constants in `supabase/functions/*/index.ts` + redeploy Edge Functions

See `docs/guides/configuration.md` → "Changing the embedding model" for the full procedure.

---

## MCP tool reference

### `cerefox_search`

Search the knowledge base. Returns complete documents ranked by hybrid (FTS + semantic) relevance.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | required | Natural-language search query |
| `match_count` | integer | 5 | Maximum **documents** to return |
| `project_name` | string | optional | Filter to a specific project |

### `cerefox_ingest`

Save a note or document to the knowledge base.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `title` | string | required | Document title |
| `content` | string | required | Markdown content |
| `project_name` | string | optional | Assign to a project (created if absent) |
| `source` | string | `"agent"` | Origin label |
| `metadata` | object | `{}` | Arbitrary JSON metadata |
| `update_if_exists` | boolean | `false` | When true, update an existing document with the same title instead of creating a new one. Content is re-indexed only if it changed. |

---

## RPC reference

All RPCs are defined in `src/cerefox/db/rpcs.sql`.

### Search RPCs

Every chunk-level RPC returns these fields:

| Field | Type | Description |
|-------|------|-------------|
| `chunk_id` | UUID | ID of the matching chunk |
| `document_id` | UUID | ID of the parent document |
| `chunk_index` | INT | Position within the document |
| `title` | TEXT | Chunk heading (H1/H2/H3) |
| `content` | TEXT | Full chunk text |
| `heading_path` | TEXT[] | Breadcrumb: e.g. `["Doc Title", "Section", "Sub"]` |
| `heading_level` | INT | 0–3 |
| `score` | FLOAT | Relevance score (higher = more relevant) |
| `doc_title` | TEXT | Parent document title |
| `doc_source` | TEXT | Origin: `"file"`, `"paste"`, `"agent"` |
| `doc_project_ids` | UUID[] | Project UUIDs assigned to the document |
| `doc_metadata` | JSONB | Document metadata |

#### `cerefox_fts_search`

Full-text keyword search. Does not require an embedding model.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `p_query_text` | TEXT | required | Keyword query |
| `p_match_count` | INT | 10 | Results to return |
| `p_project_id` | UUID | null | Filter by project |

#### `cerefox_semantic_search`

Vector similarity search. Requires a pre-computed query embedding.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `p_query_embedding` | VECTOR(768) | required | Query embedding |
| `p_match_count` | INT | 10 | Results to return |
| `p_use_upgrade` | BOOL | false | Use upgrade embedding column |
| `p_project_id` | UUID | null | Filter by project |
| `p_min_score` | FLOAT | 0.0 | Minimum cosine similarity |

#### `cerefox_hybrid_search`

Combines FTS and semantic search via linear alpha blending. Two overloads (with/without `p_project_id`).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `p_query_text` | TEXT | required | Query string for FTS |
| `p_query_embedding` | VECTOR(768) | required | Query embedding |
| `p_match_count` | INT | 10 | Results to return |
| `p_alpha` | FLOAT | 0.7 | Semantic weight (0=FTS only, 1=semantic only) |
| `p_use_upgrade` | BOOL | false | Use upgrade embedding column |
| `p_project_id` | UUID | null | Filter by project |
| `p_min_score` | FLOAT | 0.0 | Minimum cosine similarity |

#### `cerefox_search_docs`

Document-level search. Runs hybrid search internally, deduplicates by document, then returns up to
`p_match_count` **distinct documents** with their full reconstructed content. **This is the
recommended RPC for agent use** — agents receive complete notes, not isolated chunks.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `p_query_text` | TEXT | required | Query string for FTS |
| `p_query_embedding` | VECTOR(768) | required | Query embedding |
| `p_match_count` | INT | 5 | Max documents to return |
| `p_alpha` | FLOAT | 0.7 | Semantic weight |
| `p_project_id` | UUID | null | Filter by project |
| `p_min_score` | FLOAT | 0.0 | Minimum cosine similarity |

Returns: `document_id`, `doc_title`, `doc_source`, `doc_metadata`, `best_score`,
`best_chunk_heading_path`, `full_content`, `chunk_count`, `total_chars`

---

### Document RPCs

#### `cerefox_reconstruct_doc`

Fetch a full document by ID, concatenating all chunks in order.

| Parameter | Type | Description |
|-----------|------|-------------|
| `p_document_id` | UUID | Document to reconstruct |

Returns: `document_id`, `doc_title`, `doc_source`, `doc_metadata`, `full_content`,
`chunk_count`, `total_chars`

#### `cerefox_context_expand`

Small-to-big retrieval: given a set of chunk IDs, returns those chunks **plus their immediate
neighbours** (±`p_window_size` chunks within the same document).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `p_chunk_ids` | UUID[] | required | Array of chunk UUIDs from search results |
| `p_window_size` | INT | 1 | Chunks to expand in each direction |

Returns: `chunk_id`, `document_id`, `chunk_index`, `title`, `content`, `heading_path`,
`heading_level`, `doc_title`, `is_seed` (TRUE for the original seed chunks)

#### `cerefox_save_note`

Create a document record directly. The note is stored but **not embedded** — use `cerefox-ingest`
Edge Function instead for notes that need to be immediately searchable.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `p_title` | TEXT | required | Note title |
| `p_content` | TEXT | required | Markdown content |
| `p_source` | TEXT | `'agent'` | Origin label |
| `p_project_id` | UUID | null | Project to assign |
| `p_metadata` | JSONB | `{}` | Metadata (agent name, tags, etc.) |

Returns: `id`, `title`, `created_at`

---

### Metadata RPCs

#### `cerefox_upsert_metadata_key`

| Parameter | Type | Description |
|-----------|------|-------------|
| `p_key` | TEXT | Key name (snake_case) |
| `p_label` | TEXT | Human-readable label (optional) |
| `p_description` | TEXT | Description (optional) |

#### `cerefox_delete_metadata_key`

| Parameter | Type | Description |
|-----------|------|-------------|
| `p_key` | TEXT | Key to remove |

#### `cerefox_list_metadata_keys`

No parameters. Returns: `key`, `label`, `description`, `created_at`, `updated_at`.

---

## Response size

Cerefox's default `max_response_bytes = 65000` matches the Supabase MCP limit. If you're
using a different MCP client with a lower limit, reduce it via `CEREFOX_MAX_RESPONSE_BYTES`
in your `.env`.
