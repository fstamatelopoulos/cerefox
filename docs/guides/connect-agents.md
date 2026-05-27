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

Three top-level paths plus a few special cases:

- **Path A** — MCP server (local subprocess or remote Edge Function). Best for purpose-built agent clients like Claude Desktop, Cursor, and Claude Code's MCP integration.
- **Path B** — direct Edge Function HTTP. Best for ChatGPT Custom GPTs and any HTTP caller (curl, scripts).
- **Path C** — local shell CLI invoked by a coding agent's Bash tool. Best for Claude Code, Codex CLI, opencode, OpenClaw, Hermes, and similar local-agent CLIs **when the user prefers not to configure MCP** but still wants the agent to read and write Cerefox.

| Client | Path | Search | Requirements / caveats |
|--------|------|--------|-----------------------|
| Claude Desktop (remote) | Path A-Remote — `cerefox-mcp` Edge Function | Hybrid | Node.js for `npx supergateway` or `npx mcp-remote`; no Python needed |
| Claude Code (remote) | Path A-Remote — `cerefox-mcp` Edge Function | Hybrid | URL + anon key only; no local install |
| Cursor (remote) | Path A-Remote — `cerefox-mcp` Edge Function | Hybrid | URL + anon key only; no local install |
| OpenAI Codex CLI (remote) | Path A-Remote — `cerefox-mcp` Edge Function | Hybrid | URL + anon key env var; TOML config |
| ChatGPT (chatgpt.com or desktop) | Path B — Custom GPT → Edge Functions | Hybrid | ChatGPT Plus required |
| Claude Desktop (local) | Path A-Local — `@cerefox/memory` via `npx` (recommended) or `cerefox mcp` (Python fallback) | Hybrid | Local alternative; Node.js (npm path) or Python + uv + local clone (legacy path); zero Edge Function invocations |
| Claude Code (local) | Path A-Local — `@cerefox/memory` via `npx` or `cerefox mcp` | Hybrid | Local alternative; zero Edge Function invocations |
| Cursor (local) | Path A-Local — `@cerefox/memory` via `npx` or `cerefox mcp` | Hybrid | Local alternative; zero Edge Function invocations |
| Cloud Claude (claude.ai web) | Remote Supabase MCP | FTS only | No install; search quality limited |
| Gemini CLI (remote) | Path A-Remote — `cerefox-mcp` Edge Function | Hybrid | URL + anon key only; no local install |
| Local coding agents (Claude Code, Codex CLI, opencode, OpenClaw, Hermes, …) | Path C — Shell CLI (Bash tool) | Hybrid | Local clone + `uv`; agent runs `uv run cerefox …` as a shell command. Useful when MCP setup is friction. |
| curl / scripts | Path B — Edge Functions directly | Hybrid | Direct HTTP; no client needed |
| Custom Python agents | Python SDK directly | Hybrid | Local Python required |

> **"Hybrid"** = FTS + semantic, document-level (complete reconstructed notes, not isolated chunks).
> **"FTS only"** = keyword search only; no semantic/vector search.

> **Cloud hybrid for all clients (future)**: deploying the MCP server to Cloud Run would give
> cloud clients (claude.ai, chatgpt.com) full hybrid search. Tracked in `docs/TODO.md`.

> **Perplexity** supports stdio-only MCP on macOS Desktop (via Helper App). Remote MCP is
> "coming soon." Perplexity's CTO has signalled a strategic shift away from MCP (March 2026),
> so API-based integration may be the long-term path. Not a priority.
>
> **Gemini web** (gemini.google.com) does not support custom MCP servers. No integration path.

> **Quick start with templates:** Copy-pasteable `.mcp.json` templates for each client are
> available in [`examples/mcp-configs/`](../examples/mcp-configs/). Pick the one for your
> client, replace the placeholders, and you're connected.

---

## Prerequisites

**For all paths:**
- Supabase project set up and schema deployed (see `setup-supabase.md`)
- Some content ingested (`cerefox ingest my-notes.md`)

**For Path A-Local only:**
- **Recommended (v0.4.0+):** [Node.js ≥20](https://nodejs.org) (for `npx --package=@cerefox/memory cerefox mcp`)
  + `.env` file in the working directory the client launches the server from (see "env block"
  in the per-client configs below if your client can't see the file)
- **Alternative:** [`uv`](https://docs.astral.sh/uv/getting-started/installation/) installed on your machine + Cerefox repository cloned locally (e.g. `/Users/yourname/src/cerefox`)
  + `.env` in the checkout
- Either way, `.env` must define `CEREFOX_SUPABASE_URL`, `CEREFOX_SUPABASE_KEY`, and your
  embedding API key (`OPENAI_API_KEY`)

> **Important — which anon key to use (2026):** Path A-Remote and Path B both require an
> "anon key" as a Bearer token. As of 2026, you **must** use the **legacy anon JWT**
> (`eyJ…`) — the new `sb_publishable_…` key is rejected by the Supabase Edge Function
> gateway with `UNAUTHORIZED_INVALID_JWT_FORMAT`. Find the legacy key in **Project
> Settings → API Keys → Legacy → anon**. This is a Supabase platform constraint;
> see [`setup-supabase.md` → Supabase API keys (2026)](setup-supabase.md#supabase-api-keys-2026)
> for the full story.

**For Path A-Remote (remote MCP Edge Function) — recommended:**
- `cerefox-mcp` Edge Function deployed (`npx supabase functions deploy cerefox-mcp`)
- Your **legacy anon JWT** (see callout above): Supabase Dashboard → Project Settings → API Keys → Legacy → anon
- For Claude Desktop: [Node.js](https://nodejs.org) installed (for `npx supergateway` or `npx mcp-remote`)
- For Claude Code: [Node.js](https://nodejs.org) for `npx mcp-remote` (recommended), or no extra deps for native HTTP

**For Path B (Edge Functions / GPT Actions) only:**
- Supabase Edge Functions deployed: `cerefox-search`, `cerefox-ingest`, `cerefox-metadata`,
  `cerefox-get-document`, `cerefox-list-versions`, `cerefox-get-audit-log`,
  `cerefox-metadata-search`, `cerefox-list-projects` --
  see `setup-supabase.md` for the deploy procedure (`npx supabase functions deploy`)
- Your **legacy anon JWT** (see callout above): Supabase Dashboard → Project Settings → API Keys → Legacy → anon
- Your **project ref**: visible in the Supabase Dashboard URL
  (`app.supabase.com/project/<project-ref>`)

**For cloud Claude.ai only:**
- A **Personal Access Token** (PAT): create at `https://supabase.com/dashboard/account/tokens`

---

## Path A-Local — Local MCP server

### What it is

The local Cerefox MCP server runs on your machine and exposes the same 10 tools as the remote
Edge Function, communicating with clients over stdio.

As of **v0.4.0** the local server ships as an npm package — **[`@cerefox/memory`](https://www.npmjs.com/package/@cerefox/memory)** — built with the official `@modelcontextprotocol/sdk`.
The bin entry is `cerefox` (run as `cerefox mcp`). The recommended client config is `npx -y --package=@cerefox/memory cerefox mcp`.

The legacy `uv run cerefox mcp` invocation **still works** and is preserved as a soft
wrapper: it tries `npx --no-install @cerefox/memory cerefox mcp` first and falls back to the
Python MCP server if npm is unavailable or `@cerefox/memory` isn't installed. New users
should prefer the npm-native config; existing users don't have to change anything.

- Embeddings are computed locally using your `.env` key (no extra credentials)
- Works offline except for the OpenAI embedding API call per query
- One setup, all compatible local clients (Claude Desktop, Cursor, Claude Code, Codex CLI, …)

See [`docs/guides/migration-v0.4.md`](migration-v0.4.md) for before/after config snippets
per client.

> **Why not `mcp-server-fetch`?** The generic fetch MCP only supports GET requests and cannot
> make authenticated POST calls to the Edge Functions. The built-in local server is
> the correct solution.

### Path A MCP tools

Once configured, every Path A client has these tools:

| Tool | Description |
|------|-------------|
| `cerefox_search` | Hybrid (FTS + semantic) document-level search. Filter by `project_name` or `metadata_filter`. |
| `cerefox_ingest` | Save a note or document to the knowledge base. Pass `document_id` to update by ID (deterministic); or `update_if_exists: true` to update by title match. Accepts optional `author` and `project_name`. |
| `cerefox_list_metadata_keys` | List all metadata keys in use across documents |
| `cerefox_get_document` | Retrieve the full content of a document (current or archived version) |
| `cerefox_list_versions` | List all archived versions of a document |
| `cerefox_get_audit_log` | Query audit log entries with filters (document, author, operation, time range) |
| `cerefox_list_projects` | List all projects with names and IDs. Use for discovering available projects. |
| `cerefox_metadata_search` | Find documents by metadata key-value criteria without a text search term. Supports project, date, and content filters. |
| `cerefox_set_document_projects` | Set a document's project memberships to exactly the given list (destructive replace; metadata-only, no content change). Use `cerefox_ingest` with singular `project_name` for non-destructive "add". |
| `cerefox_get_help` | Retrieve Cerefox conventions (the same content as `AGENT_QUICK_REFERENCE.md`) over MCP. Optional `topic` parameter does a case-insensitive H2 substring match. Call this whenever you are uncertain. |

> All 10 tools are available on both Path A (local and remote MCP) and Path B (GPT Actions
> via dedicated Edge Functions, except `cerefox_get_help` which is MCP-only). MCP tools use
> `project_name` (human-readable); primitive Edge Functions (Path B) use `project_id` (UUID).

### Path A system prompt

Set this as Custom Instructions / System Prompt in your client:

```
You have access to a personal knowledge base via Cerefox MCP tools.
When answering questions, always call cerefox_search first with a relevant query.
Cite doc_title for every claim drawn from the knowledge base.
Use cerefox_ingest to save anything the user asks you to remember.
Always set your requestor/author parameter to identify yourself.
For the full tool reference, search Cerefox for "How AI Agents Use Cerefox".
```

> **Agent reference docs**: `AGENT_GUIDE.md` (comprehensive) and `AGENT_QUICK_REFERENCE.md` (quick
> reference) in the repo root contain the full tool reference for AI agents. These are also
> ingested into the Cerefox KB via `sync_docs.py`, so agents can find them by searching.

### Path A verification prompts

After setup, ask your client:

> "What tools do you have available?"
> Expected: 10 tools listed (`cerefox_search`, `cerefox_ingest`, `cerefox_get_document`,
> `cerefox_list_versions`, `cerefox_list_projects`, `cerefox_list_metadata_keys`,
> `cerefox_metadata_search`, `cerefox_set_document_projects`, `cerefox_get_audit_log`,
> `cerefox_get_help`).

> "Use cerefox_search with query='second brain' and match_count=3. What did you find?"

> "Save a note titled 'Test Note' with content '# Test\nThis is a test.' using cerefox_ingest."

> "Call cerefox_get_help with no topic. What sections are listed?"

---

### Claude Desktop

**Config file location:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

**Recommended — npm (`@cerefox/memory`, v0.4.0+):**

```json
{
  "mcpServers": {
    "cerefox": {
      "command": "npx",
      "args": ["-y", "--package=@cerefox/memory", "cerefox", "mcp"],
      "env": {
        "CEREFOX_SUPABASE_URL": "https://<your-project-ref>.supabase.co",
        "CEREFOX_SUPABASE_KEY": "<your-service-role-or-sb_secret-key>",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

The `env` block is only needed if you don't already have a `.env` file in a directory the
server can find — the server resolves `.env` from the current working directory.

**Alternative — local checkout (Python or pre-v0.4 setups):**

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
This invocation soft-wraps `npx --package=@cerefox/memory cerefox mcp` when available; otherwise the
legacy Python MCP server takes over.

**Important:**
- Merge the `mcpServers` block into any existing `claude_desktop_config.json` — do not wrap it
  in an extra `{}` or replace the whole file.
- Restart Claude Desktop fully (Cmd+Q on macOS, not just close the window) after saving.

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
2. Paste either of the following into the MCP config JSON:

**Recommended — npm:**

```json
{
  "mcpServers": {
    "cerefox": {
      "command": "npx",
      "args": ["-y", "--package=@cerefox/memory", "cerefox", "mcp"],
      "env": {
        "CEREFOX_SUPABASE_URL": "https://<your-project-ref>.supabase.co",
        "CEREFOX_SUPABASE_KEY": "<your-service-role-or-sb_secret-key>",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

**Alternative — local checkout:**

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

**Option 1: CLI command — npm (recommended)**

```bash
claude mcp add --scope user cerefox \
  npx -- -y --package=@cerefox/memory cerefox mcp
```

- `--scope user` makes the server available in every project (stored in `~/.claude/mcp.json`).
- Use `--scope project` instead to limit it to the current directory (stored in `.mcp.json`).

If you don't already have `.env` resolvable from your shell's CWD, add the credentials inline
by editing the resulting JSON config to add an `env` block (see the Claude Desktop example
above).

Verify:
```bash
claude mcp list
```

**Option 2: CLI command — local checkout (uv)**

```bash
claude mcp add --scope user cerefox \
  uv -- --directory /path/to/cerefox run cerefox mcp
```

This soft-wraps `npx --package=@cerefox/memory cerefox mcp` when available; otherwise falls back to
the legacy Python MCP server.

**Option 3: `.mcp.json` in project root (project-scoped, committable)**

Create `.mcp.json` in the root of the repo you work in:

```json
{
  "mcpServers": {
    "cerefox": {
      "command": "npx",
      "args": ["-y", "--package=@cerefox/memory", "cerefox", "mcp"]
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
(spec 2025-03-26). It calls Postgres RPCs directly via per-tool handlers -- no delegation
to primitive Edge Functions. This means each MCP tool call costs a single Edge Function
invocation.

A single HTTPS URL gives any remote-capable MCP client all 10 tools with full hybrid
search -- no Python, no `uv`, no local repository clone needed.

**URL format:**
```
https://<your-project-ref>.supabase.co/functions/v1/cerefox-mcp
```

**When to choose Path A-Remote vs Path A-Local:**

| Scenario | Prefer |
|----------|--------|
| Default / new setup | Path A-Remote -- no Python, no local clone, one URL works everywhere |
| Multiple machines / cloud dev environments | Path A-Remote |
| Minimise Supabase Edge Function usage (free tier limits) | Path A-Local -- zero Edge Function invocations |
| Offline use or development on the cerefox codebase | Path A-Local -- no network dependency |
| Lowest latency (same machine, no HTTPS round-trip) | Path A-Local -- slightly faster |

**Deploy the Edge Function** (once, after cloning the repo):
```bash
npx supabase functions deploy cerefox-mcp
```

---

### Path A-Remote: Claude Code

> **Recommended: use `mcp-remote` stdio bridge.** While the SSE idle polling issue has been
> fixed server-side (v0.1.12 -- the server returns 405 for GET per the MCP spec), `mcp-remote`
> is still recommended because it cleanly bypasses Supabase's GoTrace OAuth discovery conflict
> via `--header`. See [issue #17](https://github.com/fstamatelopoulos/cerefox/issues/17) for
> the full investigation.

**Option 1 — `mcp-remote` (recommended):**

Add to your project's `.mcp.json` (or copy
[`examples/mcp-configs/claude-code-remote.json`](../examples/mcp-configs/claude-code-remote.json)):

```json
{
  "mcpServers": {
    "cerefox": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://<your-project-ref>.supabase.co/functions/v1/cerefox-mcp",
        "--header",
        "Authorization: Bearer <your-anon-key>"
      ]
    }
  }
}
```

**Option 2 — native HTTP:**

Claude Code also supports Streamable HTTP natively. This works and no longer has idle polling
overhead (fixed in v0.1.12). However, `mcp-remote` is still preferred for the OAuth bypass.

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

Claude Desktop does not support remote MCP servers natively -- it requires a local subprocess
(`command` field). Use [`supergateway`](https://www.npmjs.com/package/supergateway) or
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote) as a stdio-to-HTTP bridge.

> **`supergateway` vs `mcp-remote` for Claude Desktop:** `mcp-remote --header` works for
> Claude Code (tested). For Claude Desktop, `supergateway` is the tested and confirmed option.
> `mcp-remote` may also work for Claude Desktop now that the 405 SSE fix is in place, but
> this has not been verified. If you try it, use the same config as Claude Code.

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

### Path A-Remote: OpenAI Codex CLI

[Codex](https://github.com/openai/codex) supports remote MCP servers natively via Streamable
HTTP. Configuration uses TOML (not JSON like most other MCP clients).

**Step 1 — Set the anon key as an environment variable:**

Codex references Bearer tokens by environment variable name, not by value. Add to your
`~/.zshrc` (or `~/.bashrc`):

```bash
export CEREFOX_ANON_KEY="<your-anon-key>"
```

Then reload: `source ~/.zshrc`

**Step 2 — Add the server to `~/.codex/config.toml`:**

```toml
[mcp_servers.cerefox]
url = "https://<your-project-ref>.supabase.co/functions/v1/cerefox-mcp"
bearer_token_env_var = "CEREFOX_ANON_KEY"
```

Replace `<your-project-ref>` with your Supabase project ref.

**Step 3 — Verify:**

Launch Codex and use the `/mcp` slash command to confirm the `cerefox` server is connected
and all 10 tools are listed.

**Notes:**
- `bearer_token_env_var` is the **name** of the env var (e.g. `"CEREFOX_ANON_KEY"`), not the
  token itself. Codex reads the value at runtime.
- No Python, no local repo clone needed — just the URL and anon key.
- No idle SSE polling cost — the 405 GET fix in `cerefox-mcp` prevents it.

---

### Path A-Remote: Gemini CLI

[Gemini CLI](https://github.com/google-gemini/gemini-cli) supports Streamable HTTP with static
Bearer token headers natively — no bridge needed. Architecturally identical to Claude Code and
Cursor.

**Config file location:**
- Global: `~/.gemini/settings.json`
- Project: `.gemini/settings.json` in the project root

Add (or merge into) the file:

```json
{
  "mcpServers": {
    "cerefox": {
      "httpUrl": "https://<your-project-ref>.supabase.co/functions/v1/cerefox-mcp",
      "headers": {
        "Authorization": "Bearer <your-anon-key>"
      }
    }
  }
}
```

Replace `<your-project-ref>` and `<your-anon-key>` with your actual values.

**Verify:**

Launch `gemini` and use `/mcp` to confirm tools are listed, or ask:
> "What tools do you have available?"

**Notes:**
- Use `httpUrl` (not `url`) for Streamable HTTP transport.
- Static headers bypass OAuth discovery entirely — no GoTrue conflict.
- No Python, no local repo clone needed.
- Status: **untested** — expected to work based on architecture match with Claude Code/Cursor.

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

Find your anon key: **Supabase Dashboard → Project Settings → API Keys → Legacy → anon** (use the legacy JWT, not the new `sb_publishable_…` — see the API keys callout in the Prerequisites section).

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
  version: 1.7.0
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
                requestor:
                  type: string
                  description: >
                    Name of the agent making this request (e.g., "ChatGPT").
                    Recorded in the usage log for attribution. Optional.
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
                document_id:
                  type: string
                  description: >
                    UUID of an existing document to update. When provided, updates
                    that document directly regardless of update_if_exists. Returns
                    an error if the document does not exist. Workflow: search for
                    the document, note the document_id, pass it here.
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
                    (no re-indexing). Ignored when document_id is provided.
                author:
                  type: string
                  description: >
                    Name of the agent or tool performing the ingestion (e.g.,
                    "ChatGPT", "Claude Code"). Recorded in the audit log for
                    attribution. Defaults to "agent" if not provided.
                author_type:
                  type: string
                  enum: [user, agent]
                  default: agent
                  description: >
                    Whether this write is from a human user or an AI agent.
                    Controls review_status auto-transition: agent writes set
                    the document to pending_review, user writes set it to approved.
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
              properties:
                requestor:
                  type: string
                  description: Name of the agent making this request. Optional.
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
                requestor:
                  type: string
                  description: Name of the agent making this request. Optional.
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
                requestor:
                  type: string
                  description: Name of the agent making this request. Optional.
      responses:
        '200':
          description: >
            Array of version objects (empty array if no versions exist):
            [{ version_id, version_number, source, chunk_count, total_chars, archived, created_at }]
  /cerefox-get-audit-log:
    post:
      operationId: getAuditLog
      summary: >
        Query audit log entries with optional filters. Returns entries with document
        titles, author attribution, operation types, size changes, and descriptions.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                document_id:
                  type: string
                  description: Filter by document UUID (optional)
                author:
                  type: string
                  description: Filter by author name (optional)
                operation:
                  type: string
                  description: >
                    Filter by operation type: create, update-content, update-metadata,
                    delete, status-change, archive, unarchive (optional)
                since:
                  type: string
                  description: ISO timestamp lower bound for temporal queries (optional)
                limit:
                  type: integer
                  default: 50
                  description: Max entries to return (max 200)
                requestor:
                  type: string
                  description: Name of the agent making this request. Optional.
      responses:
        '200':
          description: >
            Array of audit log entries:
            [{ id, document_id, doc_title, version_id, operation, author, author_type,
               size_before, size_after, description, created_at }]
  /cerefox-list-projects:
    post:
      operationId: listProjects
      summary: List all projects with their names, IDs, and descriptions
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                requestor:
                  type: string
                  description: Name of the agent making this request. Optional.
      responses:
        '200':
          description: >
            Array of projects: [{ id, name, description }]
  /cerefox-metadata-search:
    post:
      operationId: metadataSearch
      summary: >
        Find documents by metadata key-value criteria without a text search term.
        Use to discover documents tagged with specific attributes or browse by taxonomy.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [metadata_filter]
              properties:
                metadata_filter:
                  type: object
                  additionalProperties:
                    type: string
                  description: >
                    Key-value pairs; ALL must match (AND semantics).
                    Example: {"type": "decision", "status": "active"}.
                project_id:
                  type: string
                  description: Filter by project UUID (optional)
                updated_since:
                  type: string
                  description: ISO-8601 timestamp; only docs updated on/after (optional)
                created_since:
                  type: string
                  description: ISO-8601 timestamp; only docs created on/after (optional)
                limit:
                  type: integer
                  default: 10
                include_content:
                  type: boolean
                  default: false
                  description: Include full document text in results
                requestor:
                  type: string
                  description: Name of the agent making this request. Optional.
      responses:
        '200':
          description: >
            Array of matching documents:
            [{ document_id, title, doc_metadata, review_status, source, created_at,
               updated_at, total_chars, chunk_count, project_ids, project_names,
               version_count, content }]
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

## Path C — Shell CLI for local coding agents

### What it is

Modern local coding agents — Claude Code, OpenAI Codex CLI, opencode, OpenClaw, Hermes, and many others — all expose a **Bash tool** (or similar shell-execution tool) to their underlying model. If the agent's user grants the agent access to a checked-out Cerefox repo, the agent can read and write the knowledge base by running `uv run cerefox …` exactly the same way a human would.

This is **not a separate Cerefox installation path** — it's the same Layer 2 access (Python REST + service-role key) that you already use as a human via the CLI. What's new is the *usage model*: the user authorizes a local agent to use that CLI on their behalf, instead of (or alongside) configuring MCP.

When to choose Path C over Path A:

- **No MCP setup friction** — the agent already has a Bash tool; no `.mcp.json`, no `claude mcp add`, no Claude Desktop config edits.
- **One Cerefox checkout serves any number of local agents** — Claude Code, Codex CLI, opencode, etc. running in the same project all use the same `uv run cerefox …` commands.
- **Best for power users who already use the CLI themselves** — the agent and the user share one mental model and one set of conventions.

When Path A is still better:

- Cleaner agent UX — named tool calls (`cerefox_search(...)`) read better in agent transcripts than `Bash("uv run cerefox search 'foo'")`.
- Some agents may rate-limit or budget Bash calls separately from MCP calls.
- Cloud-only agents (claude.ai, chatgpt.com) cannot use Path C at all — they have no Bash tool.

### Prerequisites

Same as **Path A-Local**:

- [`uv`](https://docs.astral.sh/uv/getting-started/installation/) installed on your machine
- Cerefox repository cloned locally (e.g. `/Users/yourname/src/cerefox`)
- `.env` configured with `CEREFOX_SUPABASE_URL`, `CEREFOX_SUPABASE_KEY` (service-role / new secret key), and your embedding API key (`OPENAI_API_KEY`)

Quick sanity check before pointing an agent at it:

```bash
cd /path/to/cerefox
uv run cerefox search "any query"
uv run cerefox list-projects
```

If both work for you, they'll work for the agent.

### How to enable it for an agent

The pattern is the same across Claude Code, Codex CLI, opencode, OpenClaw, Hermes, and similar tools:

1. **Tell the agent the Cerefox checkout path** (e.g. via system prompt, project memory, or your agent's equivalent of `CLAUDE.md`).
2. **Point the agent at the agent docs** in that checkout: `AGENT_GUIDE.md` and `AGENT_QUICK_REFERENCE.md`. These already describe what to read, what to write, and the audit/metadata conventions. They cover MCP usage; the CLI mapping is in `AGENT_GUIDE.md` ("Using Cerefox via the CLI").
3. **Optionally**: add a one-line reminder in the agent's system prompt so the model defaults to using Cerefox proactively.

Example system-prompt snippet (adapt for your agent — Claude Code's `CLAUDE.md`, Codex's `AGENTS.md`, opencode's project config, etc.):

```
You have access to a personal Cerefox knowledge base via a local CLI.

- Path: /path/to/cerefox  (cd here before running commands)
- Run any command with: uv run cerefox <subcommand>
- Read AGENT_GUIDE.md and AGENT_QUICK_REFERENCE.md in that directory for
  conventions, metadata rules, and the MCP-tool → CLI-command mapping.
  Full per-flag reference: docs/guides/cli.md.

Identify yourself on every call:
- Writes (ingest, ingest-dir): pass --author "<your-name>" --author-type agent
- Reads (search, get-doc, list-versions, list-projects, metadata-search,
  get-audit-log): pass --requestor "<your-name>"

When answering questions, search Cerefox first. When the user asks you to
remember something, ingest it. Cite document titles for every claim drawn
from the knowledge base.
```

### MCP tool ↔ CLI command mapping

The agent docs are written around MCP tool names. **CLI flag names match MCP parameter names exactly** (kebab-cased) — short forms like `--project`, `--filter`, `--count`, `--update`, `--version` are accepted as aliases. Full per-flag reference: [`docs/guides/cli.md`](cli.md).

| MCP tool | CLI command |
|---|---|
| `cerefox_search` | `uv run cerefox search "<query>" --match-count N --project-name <n> --metadata-filter '<json>' --requestor <name>` (CLI-only: `--mode`, `--alpha`, `--min-score`) |
| `cerefox_ingest` (file) | `uv run cerefox ingest <path> --title <t> --project-name <n> --metadata '<json>' --update-if-exists\|--document-id <uuid> --source <s> --author <a> --author-type user\|agent` |
| `cerefox_ingest` (paste) | `printf '...' \| uv run cerefox ingest --paste --title "<title>"` (same flags) |
| `cerefox_get_document` | `uv run cerefox get-doc <document-id> --version-id <vid> --requestor <name>` |
| `cerefox_list_versions` | `uv run cerefox list-versions <document-id> --requestor <name>` |
| `cerefox_list_projects` | `uv run cerefox list-projects --requestor <name>` |
| `cerefox_list_metadata_keys` | `uv run cerefox list-metadata-keys` |
| `cerefox_metadata_search` | `uv run cerefox metadata-search --metadata-filter '<json>' --project-name <n> --requestor <name>` |
| `cerefox_get_audit_log` | `uv run cerefox get-audit-log --document-id <id> --author <a> --operation <op> --since <iso> --until <iso> --limit N --json --requestor <name>` |

### Path C verification prompts

After pointing your agent at the repo, ask it:

> "Run a Cerefox search for 'second brain'. What did you find?"
> Expected: agent runs `uv run cerefox search "second brain"` via its Bash tool and reports results.

> "Save a note titled 'Test Note' to Cerefox with the content '# Test\nThis is a Path C test.'"
> Expected: agent runs `cerefox ingest --paste --title "Test Note"` (or equivalent) and reports the new document ID.

> "List my Cerefox projects."
> Expected: agent runs `uv run cerefox list-projects`.

### Caveats

- **Privilege level**: the CLI uses the **service-role key** (`CEREFOX_SUPABASE_KEY`), which bypasses Row Level Security. An agent with Bash access has the same full read/write power you do. Only enable Path C for agents you trust to act on your behalf — the same trust level you'd grant Cursor/Claude Code for editing your source code.
- **Audit attribution**: Path C records `access_path = "cli"` in usage logs, distinct from `"local-mcp"` / `"remote-mcp"`. **Agents must set `--author <name> --author-type agent` on writes and `--requestor <name>` on reads** (or rely on `CEREFOX_AUTHOR_NAME` / `CEREFOX_AUTHOR_TYPE` / `CEREFOX_REQUESTOR_NAME` env vars). Without these flags, writes attribute to `"unknown"` / `"user"`, which under-reports agent activity. See the 2026-05-18 Decision Log Q2 entry for the design rationale (`author_type` is caller-declared on ambiguous channels — CLI and Edge Functions — but `access_path` is always derived from the code layer).
- **Soft-delete is reachable; purge and restore are not** — by design. `cerefox delete-doc` is exposed on the CLI and sends documents to trash with an audit entry. **Permanent purge** (irreversible) and **restore from trash** (un-doing a destructive action) are intentionally web-UI-only and require human-in-the-loop confirmation. If an agent on Path C decides to delete content, it should surface that to the user explicitly so they can review and either restore or commit. See [`access-paths.md` → Destructive operations and the trust model](access-paths.md#destructive-operations-and-the-trust-model) for the full rationale and contributor guidance.
- **Cross-doc links in content you ingest** become clickable when the user views them in the Cerefox web UI. Author them as `[Text](uuid)` (most stable), `[Text](docs/path.md)` (repo files), or `[Text](<Title With Spaces>)` (angle-bracket form — bare spaces break markdown). See [`AGENT_GUIDE.md` → "Writing linkable content"](../../AGENT_GUIDE.md#writing-linkable-content) for the full set of rules.
- **One repo per machine**: the agent needs your checkout — there's no "Path C without a local clone". If you skip the local install entirely, Path A-Remote or Path B is the only option.
- **No sandboxing beyond the agent's existing Bash sandbox**: the CLI is just shell. If your agent's tool framework restricts which commands run, allowlist `uv run cerefox …` explicitly.

### Path C is configuration-free, but here's the per-agent footprint

| Agent | Where to mention the Cerefox path |
|---|---|
| Claude Code | `CLAUDE.md` in the project, or `~/.claude/CLAUDE.md` globally. No MCP entry needed. |
| OpenAI Codex CLI | `AGENTS.md` or the project's instructions file. |
| opencode | Project config / agent system prompt. |
| OpenClaw, Hermes, custom local agents | Whatever the tool's system-prompt / memory mechanism is. |

There is nothing Cerefox-specific to install for the agent itself — just the repo + your `.env`.

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
| `document_id` | string | optional | UUID of an existing document to update. When provided, updates that document directly regardless of `update_if_exists`. Returns an error if the document does not exist. Workflow: `cerefox_search` → note `[id: ...]` → pass here. |
| `project_name` | string | optional | Assign to a project (created if absent) |
| `source` | string | `"agent"` | Origin label |
| `metadata` | object | `{}` | Arbitrary JSON metadata |
| `update_if_exists` | boolean | `false` | When true, update an existing document with the same title instead of creating a new one. The previous version is archived automatically. Content is re-indexed only if it changed. Ignored when `document_id` is provided. |

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
