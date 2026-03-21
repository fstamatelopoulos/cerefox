# Connecting AI Agents to Cerefox

Cerefox exposes your knowledge base through two access paths. Choose the one that fits your
client; you can also run both in parallel.

> **OpenAI API key — known glitch (all paths):** The simplest setup is an **unrestricted**
> OpenAI API key — it just works. If you prefer a restricted key and hit a
> `Missing scopes: model.request` or 401 error despite the key looking correct in the
> dashboard, this is a [known OpenAI UI bug](https://community.openai.com/t/missing-scopes-model-request-on-restricted-api-key/1371602):
> narrowing sub-scopes after setting the top-level **Model Capabilities → Write** permission
> corrupts the internal permission state silently. The fix is either to switch to an
> unrestricted key, or to open the key in the
> [OpenAI dashboard](https://platform.openai.com/api-keys), save it without any changes, and
> retry — this resets the internal state immediately.
>
> This applies to all paths (A-Local, A-Remote, Path B) — any path that calls the OpenAI
> embedding API can be affected. If you're on Fireworks AI instead, see
> `docs/guides/configuration.md` → "Changing the embedding model".

---

## Access paths at a glance

| Client | Path | Search | Requirements / caveats |
|--------|------|--------|-----------------------|
| Claude Desktop (remote) | Path A-Remote — `cerefox-mcp` Edge Function | Hybrid | Node.js for `npx supergateway`; no Python needed |
| Claude Code (remote) | Path A-Remote — `cerefox-mcp` Edge Function | Hybrid | URL + anon key only; no local install |
| Cursor (remote) | Path A-Remote — `cerefox-mcp` Edge Function | Hybrid | URL + anon key only; no local install |
| ChatGPT (chatgpt.com or desktop) | Path B — Custom GPT → Edge Functions | Hybrid | ChatGPT Plus required |
| Claude Desktop (local) | Path A-Local — `cerefox mcp` | Hybrid | Legacy fallback; Python + uv + local clone |
| Claude Code (local) | Path A-Local — `cerefox mcp` | Hybrid | Legacy fallback; Python + uv + local clone |
| Cursor (local) | Path A-Local — `cerefox mcp` | Hybrid | Legacy fallback; Python + uv + local clone |
| Cloud Claude (claude.ai web) | Remote Supabase MCP | FTS only | No install; search quality limited |
| curl / scripts | Path B — Edge Functions directly | Hybrid | Direct HTTP; no client needed |
| Custom Python agents | Python SDK directly | Hybrid | Local Python required |

> **"Hybrid"** = FTS + semantic, document-level (complete reconstructed notes, not isolated chunks).
> **"FTS only"** = keyword search only; no semantic/vector search.

> **Cloud hybrid for all clients (future)**: deploying the MCP server to Cloud Run would give
> cloud clients (claude.ai, chatgpt.com) full hybrid search. Tracked in `docs/TODO.md`.

> **Perplexity** does not support MCP and has no integration path at this time.

---

## Prerequisites

**For all paths:**
- Supabase project set up and schema deployed (see `setup-supabase.md`)
- Some content ingested (`cerefox ingest my-notes.md`)

**For Path A-Local only:**
- [`uv`](https://docs.astral.sh/uv/getting-started/installation/) installed on your machine
- Cerefox repository cloned locally (e.g. `/Users/yourname/src/cerefox`)
- `.env` file configured with `CEREFOX_SUPABASE_URL`, `CEREFOX_SUPABASE_KEY`,
  and your embedding API key (`OPENAI_API_KEY`)

**For Path A-Remote (remote MCP Edge Function) — recommended:**
- `cerefox-mcp` Edge Function deployed (`npx supabase functions deploy cerefox-mcp`)
- Your **anon key**: Supabase Dashboard → Project Settings → API → `anon public`
- For Claude Desktop: [Node.js](https://nodejs.org) installed (for `npx supergateway`)
- For Claude Code: no extra dependencies (native HTTP transport)

**For Path B (Edge Functions / GPT Actions) only:**
- Supabase Edge Functions deployed: `cerefox-search`, `cerefox-ingest`, `cerefox-metadata`,
  `cerefox-get-document`, `cerefox-list-versions` —
  see `setup-supabase.md` → Step 8 for the deploy procedure (`npx supabase functions deploy`)
- Your **anon key**: Supabase Dashboard → Project Settings → API → `anon public`
- Your **project ref**: visible in the Supabase Dashboard URL
  (`app.supabase.com/project/<project-ref>`)

**For cloud Claude.ai only:**
- A **Personal Access Token** (PAT): create at `https://supabase.com/dashboard/account/tokens`

---

## Path A-Local — Local MCP server (`cerefox mcp`)

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

Once configured, every Path A client has these tools:

| Tool | Description |
|------|-------------|
| `cerefox_search` | Hybrid (FTS + semantic) document-level search |
| `cerefox_ingest` | Save a note or document to the knowledge base |
| `cerefox_list_metadata_keys` | List all metadata keys in use across documents |
| `cerefox_get_document` | Retrieve the full content of a document (current or archived version) |
| `cerefox_list_versions` | List all archived versions of a document |

> The versioning tools (`cerefox_get_document`, `cerefox_list_versions`) are available on
> all paths — Path A (local and remote MCP) and Path B (GPT Actions via
> `cerefox-get-document` and `cerefox-list-versions` Edge Functions).

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

## Path A-Remote — Remote MCP Edge Function (`cerefox-mcp`)

### What it is

`cerefox-mcp` is a Supabase Edge Function that speaks the MCP Streamable HTTP protocol
(spec 2025-03-26). It is a thin adapter over the existing `cerefox-search` and
`cerefox-ingest` Edge Functions — it handles the JSON-RPC layer and delegates all business
logic to those functions internally.

A single HTTPS URL gives any remote-capable MCP client the same two tools
(`cerefox_search` and `cerefox_ingest`) with full hybrid search — no Python, no `uv`, no
local repository clone needed.

**URL format:**
```
https://<your-project-ref>.supabase.co/functions/v1/cerefox-mcp
```

**When to choose Path A-Remote (recommended) vs Path A-Local (legacy fallback):**

| Scenario | Prefer |
|----------|--------|
| Default / new setup | Path A-Remote — no Python, no local clone, one URL works everywhere |
| Multiple machines / cloud dev environments | Path A-Remote |
| Offline use or development on the cerefox codebase | Path A-Local — no network dependency |
| Lowest latency (same machine, no HTTPS round-trip) | Path A-Local — slightly faster |

**Deploy the Edge Function** (once, after cloning the repo):
```bash
npx supabase functions deploy cerefox-mcp
```

---

### Path A-Remote: Claude Code

Claude Code supports Streamable HTTP MCP natively — no proxy needed.

```bash
claude mcp add --transport http cerefox \
  https://<your-project-ref>.supabase.co/functions/v1/cerefox-mcp \
  --header "Authorization: Bearer <your-anon-key>"
```

Verify:
```bash
claude mcp list
```

For a user-scoped server (available in all projects), add `--scope user`:
```bash
claude mcp add --transport http --scope user cerefox \
  https://<your-project-ref>.supabase.co/functions/v1/cerefox-mcp \
  --header "Authorization: Bearer <your-anon-key>"
```

---

### Path A-Remote: Cursor

Cursor supports remote MCP servers natively via `url` + `headers` in `mcp.json`.

1. Open **Cursor Settings** (`Cmd+,`) → **Tools & Integrations** → **MCP** → **Add new global MCP server**
2. Paste this config (replace the placeholders):

```json
{
  "mcpServers": {
    "cerefox": {
      "url": "https://<your-project-ref>.supabase.co/functions/v1/cerefox-mcp",
      "headers": {
        "Authorization": "Bearer <your-anon-key>"
      }
    }
  }
}
```

3. Save and restart Cursor.

Alternatively, add `.cursor/mcp.json` in your project root with the same content for
project-scoped access.

---

### Path A-Remote: Claude Desktop

Claude Desktop does not support remote MCP servers natively — it requires a local subprocess
(`command` field). Use [`supergateway`](https://www.npmjs.com/package/supergateway) as a
stdio-to-HTTP bridge. It translates between Claude Desktop's stdio transport and the Edge
Function's Streamable HTTP endpoint.

> **Why supergateway and not `mcp-remote`?** `mcp-remote` 0.1.x proactively discovers OAuth
> servers at the Supabase root domain and fails when Supabase's built-in auth (GoTrue) rejects
> dynamic client registration. `supergateway` does not attempt OAuth — it connects directly
> with the Bearer token. Tested and confirmed working with Supabase Edge Functions.

**Requirements:** [Node.js](https://nodejs.org) installed (for `npx`).

**Config file location:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add (or merge into) the file:

```json
{
  "mcpServers": {
    "cerefox": {
      "command": "npx",
      "args": [
        "-y", "supergateway",
        "--streamableHttp", "https://<your-project-ref>.supabase.co/functions/v1/cerefox-mcp",
        "--oauth2Bearer", "<your-anon-key>"
      ]
    }
  }
}
```

Replace `<your-project-ref>` and `<your-anon-key>` with your actual values.

**Important:**
- Restart Claude Desktop fully (Cmd+Q on macOS) after saving the config.
- `-y` tells npx to auto-install `supergateway` without prompting.
- No Python, no local repo clone, no `.env` file needed — just the URL and anon key.

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
  version: 1.4.0
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
                metadata_filter:
                  type: object
                  additionalProperties:
                    type: string
                  description: >
                    Optional JSONB containment filter. Only documents whose metadata
                    contains ALL specified key-value pairs are returned.
                    Example: {"type": "decision", "status": "active"}.
                    Call listMetadataKeys to discover available keys and their values.
                    Omit or set to null to search all documents.
      responses:
        '200':
          description: >
            { results, query, mode, match_count, project_name, metadata_filter, truncated, response_bytes }.
            Each item in results (docs mode) contains: document_id, doc_title, full_content,
            chunk_count, total_chars, best_score, is_partial.
            is_partial is true when the document exceeded the small-to-big threshold — in that
            case full_content contains matched chunks plus their neighbours rather than the
            complete document, and total_chars still reflects the full document size.
  /cerefox-ingest:
    post:
      operationId: ingestNote
      summary: >
        Save a note to the knowledge base. When update_if_exists is true and the
        document already exists, the previous version is archived automatically —
        you can retrieve it later with getDocument.
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
                    instead of creating a new one. The previous content is archived
                    as a version. If content is unchanged, the document is skipped
                    (no re-indexing).
      responses:
        '200':
          description: Ingest result
  /cerefox-metadata:
    post:
      operationId: listMetadataKeys
      summary: List all metadata keys in use across documents with counts and example values
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties: {}
      responses:
        '200':
          description: Array of metadata keys with doc_count and example_values
  /cerefox-get-document:
    post:
      operationId: getDocument
      summary: >
        Retrieve the full reconstructed content of a document (current version or a specific
        archived version). Use listVersions first to discover available version UUIDs.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [document_id]
              properties:
                document_id:
                  type: string
                  description: UUID of the document to retrieve
                version_id:
                  type: string
                  description: >
                    UUID of a specific archived version to retrieve. Omit (or pass null)
                    for the current version. Version UUIDs are returned by listVersions.
      responses:
        '200':
          description: >
            Document content and metadata:
            { document_id, doc_title, full_content, chunk_count, total_chars,
              is_archived, version_id }
        '404':
          description: Document not found
  /cerefox-list-versions:
    post:
      operationId: listVersions
      summary: >
        List all archived versions of a document, newest first. Returns version UUIDs
        to pass to getDocument for historical content retrieval.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [document_id]
              properties:
                document_id:
                  type: string
                  description: UUID of the document whose version history to list
      responses:
        '200':
          description: >
            Array of version objects (empty array if no versions exist):
            [{ version_id, version_number, source, chunk_count, total_chars, created_at }]
```

**Step 3 — Configure authentication**

In the action's **Authentication** settings:
- Type: **API Key**
- Auth type: **Bearer**
- API key: your Supabase **anon key**

> **Important:** ChatGPT may reset the API key when you update the action schema.
> If you get a 403 error after changing the schema, re-enter the anon key in the
> authentication settings — the functions themselves are fine.

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
| `max_bytes` | number | 200000 | Response size budget in bytes. Results are dropped whole (never truncated mid-document) once the budget is reached. The response includes `truncated: true` and `response_bytes` when the limit was hit. See "Response size limit" below. |

**Response envelope fields:**

| Field | Type | Description |
|-------|------|-------------|
| `results` | array | Matched documents or chunks (see per-row fields below) |
| `query` | string | The original query |
| `mode` | string | Search mode used |
| `match_count` | number | `match_count` value used |
| `project_name` | string\|null | Project filter applied (if any) |
| `truncated` | boolean | `true` when results were dropped to stay within `max_bytes` |
| `response_bytes` | number | Actual bytes in the returned `results` array |

**Per-result row fields (`docs` mode — the recommended default):**

| Field | Type | Description |
|-------|------|-------------|
| `document_id` | string | UUID of the matched document |
| `doc_title` | string | Document title |
| `doc_source` | string | Origin: `"file"`, `"paste"`, `"agent"` |
| `doc_metadata` | object | Arbitrary JSON metadata |
| `best_score` | number | Highest chunk relevance score (0–1) |
| `best_chunk_heading_path` | string[] | Heading breadcrumb of the best-scoring chunk |
| `full_content` | string | Reconstructed document content (may be partial — see `is_partial`) |
| `chunk_count` | integer | Number of chunks in `full_content` |
| `total_chars` | integer | Full document size in characters (always the whole doc, even when `is_partial` is true) |
| `is_partial` | boolean | `true` when `full_content` contains only matched chunks + neighbours instead of the complete document. Triggered when the document exceeds the small-to-big threshold (default 40 000 chars). Use `getDocument` to retrieve the full text. |
| `doc_updated_at` | string | ISO 8601 timestamp of the last document update |
| `version_count` | integer | Number of archived versions (0 if never updated) |
| `doc_project_ids` | string[] | Project UUIDs the document belongs to |

**Response size limit (`max_bytes`):**

200 KB is a safety ceiling that prevents runaway responses under unusual settings (e.g. very high `match_count`). Under normal usage the small-to-big retrieval path already keeps individual large-document results compact (matched chunks + neighbours only), so this limit is rarely reached.

You can override it per-request if needed:
```json
{ "query": "deployment checklist", "max_bytes": 400000 }
```

See `docs/guides/configuration.md` → "Response size limit" for full details.

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

Each result includes `doc_title`, `best_score`, `full_content`, `chunk_count`, `total_chars`, and `is_partial`. When `is_partial` is true, the document exceeded the small-to-big threshold: `full_content` contains the best-matching chunks and their neighbours rather than the whole document. The heading for such results includes a `— partial (N of M chars)` annotation. Use `cerefox_get_document` to retrieve the full text when needed.

### `cerefox_ingest`

Save a note or document to the knowledge base.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `title` | string | required | Document title |
| `content` | string | required | Markdown content |
| `project_name` | string | optional | Assign to a project (created if absent) |
| `source` | string | `"agent"` | Origin label |
| `metadata` | object | `{}` | Arbitrary JSON metadata |
| `update_if_exists` | boolean | `false` | When true, update an existing document with the same title instead of creating a new one. The previous version is archived automatically. Content is re-indexed only if it changed. |

### `cerefox_list_metadata_keys`

No parameters. Returns all distinct metadata keys currently in use across documents, with document counts and up to 5 example values per key.

### `cerefox_get_document`

Retrieve the full reconstructed content of a document. Pass `version_id` to retrieve an archived version; omit it for the current version. Version UUIDs are returned by `cerefox_list_versions`.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `document_id` | string | required | UUID of the document to retrieve |
| `version_id` | string | optional | UUID of a specific archived version; omit for current |

### `cerefox_list_versions`

List all archived versions of a document, newest first. Returns `version_id` (use with `cerefox_get_document`), `version_number`, `source`, `chunk_count`, `total_chars`, and `created_at`.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `document_id` | string | required | UUID of the document whose version history to list |

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
| `p_small_to_big_threshold` | INT | 40000 | Documents larger than this return matched chunks + neighbours instead of the full document. Set to `0` to always return full content. Change the DEFAULT in `rpcs.sql` to apply server-wide. |
| `p_context_window` | INT | 1 | Neighbour chunks on each side of each matched chunk. `1` → up to 3 contiguous chunks per hit. `0` → matched chunks only. |

Returns: `document_id`, `doc_title`, `doc_source`, `doc_metadata`, `doc_project_ids`,
`best_score`, `best_chunk_heading_path`, `full_content`, `chunk_count`, `total_chars`,
`doc_updated_at`, `version_count`, `is_partial`.

`is_partial` is `TRUE` when the document exceeded `p_small_to_big_threshold` — in that
case `full_content` contains matched chunks + up to `p_context_window` neighbours on each
side, deduplicated and sorted by `chunk_index`. `total_chars` always reflects the full
document size regardless of whether the result is partial.

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

#### `cerefox_list_metadata_keys`

No parameters. Returns all distinct metadata keys currently in use across documents.

| Column | Type | Description |
|--------|------|-------------|
| `key` | TEXT | Metadata key name |
| `doc_count` | BIGINT | Number of documents using this key |
| `example_values` | TEXT[] | Up to 5 sample values |

This RPC derives keys from actual `doc_metadata` JSONB — no separate registry table.

---

## Response size

Cerefox's default `max_response_bytes = 200000` is a safety ceiling; small-to-big retrieval
keeps individual results compact so this limit is rarely reached in practice. If your MCP
client has a lower context limit, reduce it via `CEREFOX_MAX_RESPONSE_BYTES` in your `.env`.
