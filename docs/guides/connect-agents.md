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
| Claude Code (remote) | Path A-Remote — `cerefox-mcp` Edge Function | Hybrid | URL + Cerefox token only; no local install. Advanced/fallback — prefer Path A-Local |
| Cursor (remote) | Path A-Remote — `cerefox-mcp` Edge Function | Hybrid | URL + Cerefox token only; no local install. Advanced/fallback — prefer Path A-Local |
| OpenAI Codex CLI (remote) | Path A-Remote — `cerefox-mcp` Edge Function | Hybrid | URL + Cerefox token env var; TOML config. Advanced/fallback — prefer Path A-Local |
| ChatGPT (chatgpt.com or desktop) | Path B — Custom GPT → Edge Functions | Hybrid | ChatGPT Plus required |
| Claude Desktop (local) | Path A-Local — `@cerefox/memory` via `npx` | Hybrid | Local alternative; Node.js; zero Edge Function invocations |
| Claude Code (local) | Path A-Local — `@cerefox/memory` via `npx` | Hybrid | Local alternative; zero Edge Function invocations |
| Cursor (local) | Path A-Local — `@cerefox/memory` via `npx` | Hybrid | Local alternative; zero Edge Function invocations |
| Cloud Claude (claude.ai web + mobile) | Path A-Remote — `cerefox-mcp` over **OAuth** | Hybrid | No install; **optional** one-time OAuth setup + a free Cloudflare Worker consent page ([setup-supabase Step 7](setup-supabase.md#step-7--oauth-for-cloud-agents-claudeai--mobile-optional)) |
| Gemini CLI (remote) | Path A-Remote — `cerefox-mcp` Edge Function | Hybrid | URL + Cerefox token only; no local install. Advanced/fallback — prefer Path A-Local |
| Local coding agents (Claude Code, Codex CLI, opencode, OpenClaw, Hermes, …) | Path C — Shell CLI (Bash tool) | Hybrid | `npm install -g @cerefox/memory`; agent runs `cerefox …` as a shell command. Useful when MCP setup is friction. |
| curl / scripts | Path B — Edge Functions directly | Hybrid | Direct HTTP; no client needed |

> **"Hybrid"** = FTS + semantic, document-level (complete reconstructed notes, not isolated chunks).
> **"FTS only"** = keyword search only; no semantic/vector search.

> **Cloud hybrid for claude.ai / mobile (iter-28A)**: `cerefox-mcp` is now an OAuth 2.1
> protected resource, so claude.ai web and the Claude mobile app get **full hybrid search**
> over the standard tool surface — no Cloud Run needed. Setup:
> [setup-supabase Step 7](setup-supabase.md#step-7--oauth-for-cloud-agents-claudeai--mobile-optional)
> + [Cloud Claude](#cloud-claude-claudeai-web--mobile-oauth) below. (An OAuth connector for
> ChatGPT becomes possible on the same server but is not yet documented.)

> **Perplexity** supports stdio-only MCP on macOS Desktop (via Helper App). Remote MCP is
> "coming soon." Perplexity's CTO has signalled a strategic shift away from MCP (March 2026),
> so API-based integration may be the long-term path. Not a priority.
>
> **Gemini web** (gemini.google.com) does not support custom MCP servers. No integration path.

> **Quick start with templates:** Copy-pasteable `.mcp.json` templates for each client are
> available in [`examples/mcp-configs/`](../examples/mcp-configs/). Pick the one for your
> client, replace the placeholders, and you're connected.

### Local / self-hosted (World B)

If you run the **Docker backend** ([`setup-local.md`](setup-local.md)) instead of cloud, the
MCP path is different: the server runs **inside the container**, launched per session over
`docker exec`. There's no URL or bearer token in the client config — the access token stays
in the container.

- **Easiest:** `cerefox-local configure-agent` wires it up (registers an MCP server named
  `cerefox-local` with Claude Code if the `claude` CLI is present, else prints the snippet).
- **Manual:** point the client at `command: cerefox-local, args: ["mcp"]` (stdio). That proxies
  to `cerefox mcp` in the container; the same 15 core tools, identical behavior to every other path.
- The cloud paths above (remote Edge Function, GPT Actions) **do not apply** to a local-only
  install — there are no Edge Functions.

---

## Prerequisites

**For all paths:**
- Supabase project set up and schema deployed (see `setup-supabase.md`)
- Some content ingested (`cerefox document ingest my-notes.md`)

**For Path A-Local only:**
- [Node.js ≥20](https://nodejs.org) (for `npx --package=@cerefox/memory cerefox mcp`, or a
  global `npm install -g @cerefox/memory`)
  + `.env` file in the working directory the client launches the server from (see "env block"
  in the per-client configs below if your client can't see the file)
- `.env` must define `CEREFOX_SUPABASE_URL`, `CEREFOX_SUPABASE_KEY`, and your
  embedding API key (`OPENAI_API_KEY`)

> **Important — the Cerefox access token (iter-28E):** Path A-Remote and Path B both require a
> **Bearer token** on every request. That credential is now the **Cerefox access token**
> (`cfx_pat_…`), a random, Cerefox-managed secret validated in-function — **not** the legacy
> Supabase anon JWT (which is retired for all Edge Function paths). Generate it with
> `cerefox token generate`: it sets the accepted token set on Supabase (the
> `CEREFOX_ACCESS_TOKENS` Function secret) and writes the value to your local `.env` as
> `CEREFOX_ACCESS_TOKEN`, printing it once so you can paste it into client configs. Lose it →
> `cerefox token rotate`. See [`setup-supabase.md` → Step 7](setup-supabase.md#step-7--oauth-for-cloud-agents-claudeai--mobile-optional)
> for the server-side setup.

**For Path A-Remote (remote MCP Edge Function) — advanced / fallback:**
> For **local agents** (Claude Code, Cursor, Codex, Gemini, Claude Desktop) the **local MCP**
> (Path A-Local, via `cerefox configure-agent`) is the preferred path — zero Edge Function
> cost and no token to distribute. Use Path A-Remote when you specifically want a hosted URL
> (multiple machines, cloud dev environments) or as a fallback.
- `cerefox-mcp` Edge Function deployed (`npx supabase functions deploy cerefox-mcp`)
- Your **Cerefox access token** (see callout above): run `cerefox token generate`
- For Claude Desktop: [Node.js](https://nodejs.org) installed (for `npx supergateway` or `npx mcp-remote`)
- For Claude Code: [Node.js](https://nodejs.org) for `npx mcp-remote` (recommended), or no extra deps for native HTTP

**For Path B (Edge Functions / GPT Actions) only:**
- Supabase Edge Functions deployed (all 9, including `cerefox-mcp`): `cerefox-search`,
  `cerefox-ingest`, `cerefox-metadata`, `cerefox-get-document`, `cerefox-list-versions`,
  `cerefox-get-audit-log`, `cerefox-metadata-search`, `cerefox-list-projects`, `cerefox-mcp`.
  End-user path: `cerefox server deploy`. Contributor/manual path: `npx supabase functions
  deploy` (see `setup-supabase.md`).
- Your **Cerefox access token** (see callout above): run `cerefox token generate`
- Your **project ref**: visible in the Supabase Dashboard URL
  (`app.supabase.com/project/<project-ref>`)

**For cloud Claude.ai only:**
- A **Personal Access Token** (PAT): create at `https://supabase.com/dashboard/account/tokens`

---

## Path A-Local — Local MCP server

### What it is

The local Cerefox MCP server runs on your machine and exposes the same 15 core tools as the remote
Edge Function, communicating with clients over stdio.

The local server ships as an npm package — **[`@cerefox/memory`](https://www.npmjs.com/package/@cerefox/memory)** — built with the official `@modelcontextprotocol/sdk`.
The bin entry is `cerefox` (run as `cerefox mcp`). The recommended client config is `npx -y --package=@cerefox/memory cerefox mcp`, or if you've installed the package globally, just `cerefox mcp`.

- Embeddings are computed locally using your `.env` key (no extra credentials)
- Works offline except for the OpenAI embedding API call per query
- One setup, all compatible local clients (Claude Desktop, Cursor, Claude Code, Codex CLI, …)

`cerefox configure-agent --tool <client>` writes the per-client config for you
(manual snippets are in the appendix below); for the upgrade path see
[`docs/guides/upgrading.md`](upgrading.md).

> **Why not `mcp-server-fetch`?** The generic fetch MCP only supports GET requests and cannot
> make authenticated POST calls to the Edge Functions. The built-in local server is
> the correct solution.

### Fastest setup: `cerefox configure-agent`

You don't have to hand-edit the per-client config files below. `cerefox configure-agent
--tool <client>` writes the correct local-stdio entry (`npx -y --package=@cerefox/memory
cerefox mcp`) into the right config file for you. Supported clients:

```bash
cerefox configure-agent --tool claude-code      # ~/.claude.json (via `claude mcp add`)
cerefox configure-agent --tool claude-desktop   # Claude Desktop config
cerefox configure-agent --tool cursor           # ~/.cursor/mcp.json
cerefox configure-agent --tool codex            # ~/.codex/config.toml
cerefox configure-agent --tool gemini           # ~/.gemini/settings.json
```

Useful flags: `--dry-run` (print the planned write without touching any file), `--json`
(machine-readable result), `--config-path <path>` (override the target file), `--no-backup`
(skip the `.pre-cerefox.bak` backup). The command is idempotent and backs up any existing
config before writing.

The entry is registered under the server name `cerefox`. If `CEREFOX_ENV_LABEL` is
set — as it is for a [staging environment](staging-env.md) — the name becomes
`cerefox-<label>` instead, so a second environment sits **alongside** your production
entry rather than replacing it, and an agent can hold both at once (v1.4.0, #168).
The command prints the name it used.

A labelled entry additionally carries `CEREFOX_CONFIG_DIR` and `CEREFOX_ENV_LABEL`
in its `env` block. That is what makes it actually reach the environment it is named
after: MCP clients spawn a stdio server with the **client's** environment, not the
shell you ran `configure-agent` in, and a desktop client launched from the dock has
no shell environment at all. A production entry carries no `env` — unchanged from
earlier releases. The per-client sections below document the same entries for anyone
who prefers to edit by hand or needs the remote (`Path A-Remote`) HTTP transport instead.

### Path A MCP tools

Once configured, every Path A client has these tools:

| Tool | Description |
|------|-------------|
| `cerefox_search` | Hybrid (FTS + semantic) document-level search. Filter by `project_name` or `metadata_filter`. |
| `cerefox_ingest` | Save a note or document to the knowledge base. Pass `document_id` to update by ID (deterministic); or `update_if_exists: true` to update by title match. Accepts optional `author` and `project_name`. |
| `cerefox_insert` | Add text to a document without resending it (additive only — structurally cannot remove content) |
| `cerefox_edit` | Change parts of a document: 1..n operations (`insert`/`replace_section`/`delete_section`/`rename_section`) applied atomically |
| `cerefox_delete_document` | Soft-delete a document to the trash (requires the caller's read-hash; permanent purge is web-UI-only) |
| `cerefox_restore_document` | Restore a soft-deleted document from the trash (audited inverse of delete) |
| `cerefox_list_metadata_keys` | List all metadata keys in use across documents |
| `cerefox_get_document` | Retrieve the full content of a document (current or archived version) |
| `cerefox_list_versions` | List all archived versions of a document |
| `cerefox_get_audit_log` | Query audit log entries with filters (document, author, operation, time range) |
| `cerefox_list_projects` | List all projects with names and IDs. Use for discovering available projects. |
| `cerefox_metadata_search` | Find documents by metadata key-value criteria without a text search term. Supports project, date, and content filters. |
| `cerefox_set_document_metadata` | Change a document's metadata without resending its content. **Merges** by default (keys you pass are set, others left alone); a `null` value removes a key (RFC 7386); `replace: true` sets exactly the object given. No re-chunk, no re-embed, no new version. |
| `cerefox_set_document_projects` | Set a document's project memberships to exactly the given list (destructive replace; metadata-only, no content change). Use `cerefox_ingest` with singular `project_name` for non-destructive "add". |
| `cerefox_get_help` | Retrieve Cerefox conventions (the same content as `AGENT_QUICK_REFERENCE.md`) over MCP. Optional `topic` parameter does a case-insensitive H2 substring match. Call this whenever you are uncertain. |

> All 15 core tools are available on Path A (local and remote MCP). Path B (GPT Actions via
> dedicated Edge Functions) exposes the 8 primitive operations: search, ingest, metadata keys,
> get-document, list-versions, audit log, metadata-search, and list-projects. The rest are
> MCP-only: the partial-edit tools (`cerefox_insert`/`cerefox_edit`),
> `cerefox_delete_document`/`cerefox_restore_document`, the metadata/project setters, and
> `cerefox_get_help`. MCP tools use `project_name` (human-readable); primitive Edge
> Functions (Path B) use `project_id` (UUID).

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
> ingested into the Cerefox KB via `bun scripts/sync_docs.ts`, so agents can find them by searching.

### Path A verification prompts

After setup, ask your client:

> "What tools do you have available?"
> Expected: 15 tools listed (`cerefox_search`, `cerefox_ingest`, `cerefox_insert`, `cerefox_edit`,
> `cerefox_delete_document`, `cerefox_restore_document`, `cerefox_get_document`,
> `cerefox_list_versions`, `cerefox_list_projects`, `cerefox_list_metadata_keys`,
> `cerefox_metadata_search`, `cerefox_set_document_projects`,
> `cerefox_set_document_metadata`, `cerefox_get_audit_log`,
> `cerefox_get_help`).

> "Use cerefox_search with query='second brain' and match_count=3. What did you find?"

> "Save a note titled 'Test Note' with content '# Test\nThis is a test.' using cerefox_ingest."

> "Call cerefox_get_help with no topic. What sections are listed?"

---

### Claude Desktop

**Recommended — let the CLI write it:**

```bash
cerefox configure-agent --tool claude-desktop
```

This writes the local-stdio entry into your `claude_desktop_config.json` and backs up the
existing file. Then restart Claude Desktop fully (Cmd+Q on macOS, not just close the window).

For the manual JSON (for the curious, or to debug if the CLI can't write your config), see
[Appendix: manual per-client config](#appendix-manual-per-client-config).

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

**Recommended — let the CLI write it:**

```bash
cerefox configure-agent --tool cursor
```

This writes the local-stdio entry into `~/.cursor/mcp.json`. Save and restart Cursor.

For project-scoped access, copy the generated entry into a `.cursor/mcp.json` in your project
root (committed to git, shared with your team). For the manual JSON, see
[Appendix: manual per-client config](#appendix-manual-per-client-config).

---

### Claude Code

Claude Code (the CLI tool and the **Code** tab inside Claude Desktop) uses its own MCP config —
separate from `claude_desktop_config.json`. Changes made in one do not affect the other.

**Recommended — let the CLI write it:**

```bash
cerefox configure-agent --tool claude-code
```

This runs the right `claude mcp add` for you. Verify with:
```bash
claude mcp list
```

If you don't already have `.env` resolvable from your shell's CWD, edit the resulting JSON
config to add an `env` block (see the manual config in the
[Appendix](#appendix-manual-per-client-config)). For project-scoped access, drop a `.mcp.json`
in the repo root with the same local-stdio entry (committable, shared with your team).

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

A single HTTPS URL gives any remote-capable MCP client all 15 core tools with full hybrid
search -- no Python, no `uv`, no local repository clone needed.

**URL format:**
```
https://<your-project-ref>.supabase.co/functions/v1/cerefox-mcp
```

**When to choose Path A-Remote vs Path A-Local:**

| Scenario | Prefer |
|----------|--------|
| Default local agent (Claude Code, Cursor, Codex, Gemini, Claude Desktop) | Path A-Local -- preferred; `cerefox configure-agent`, zero Edge Function cost, no token to distribute |
| Multiple machines / cloud dev environments | Path A-Remote -- one hosted URL works everywhere (needs a Cerefox token) |
| Minimise Supabase Edge Function usage (free tier limits) | Path A-Local -- zero Edge Function invocations |
| Offline use or development on the cerefox codebase | Path A-Local -- no network dependency |
| Lowest latency (same machine, no HTTPS round-trip) | Path A-Local -- slightly faster |

**Deploy the Edge Functions** (end-user path — deploys schema, RPCs, and all 9 Edge Functions
from assets bundled in the npm package, no repo clone):
```bash
cerefox server deploy
```
Contributors working from a repo clone can deploy a single function manually with
`npx supabase functions deploy cerefox-mcp`.

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
        "Authorization: Bearer <your-cerefox-token>"
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
  --header "Authorization: Bearer <your-cerefox-token>"
```

Verify:
```bash
claude mcp list
```

For a user-scoped server (available in all projects), add `--scope user`:
```bash
claude mcp add --transport http --scope user cerefox \
  https://<your-project-ref>.supabase.co/functions/v1/cerefox-mcp \
  --header "Authorization: Bearer <your-cerefox-token>"
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
        "Authorization": "Bearer <your-cerefox-token>"
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
        "--oauth2Bearer", "<your-cerefox-token>"
      ]
    }
  }
}
```

Replace `<your-project-ref>` and `<your-cerefox-token>` with your actual values.

**Important:**
- Restart Claude Desktop fully (Cmd+Q on macOS) after saving the config.
- `-y` tells npx to auto-install `supergateway` without prompting.
- No Python, no local repo clone, no `.env` file needed — just the URL and Cerefox token.

---

### Path A-Remote: OpenAI Codex CLI

[Codex](https://github.com/openai/codex) supports remote MCP servers natively via Streamable
HTTP. Configuration uses TOML (not JSON like most other MCP clients).

**Step 1 — Set the Cerefox token as an environment variable:**

Codex references Bearer tokens by environment variable name, not by value. Add to your
`~/.zshrc` (or `~/.bashrc`):

```bash
export CEREFOX_ACCESS_TOKEN="<your-cerefox-token>"
```

Then reload: `source ~/.zshrc`

**Step 2 — Add the server to `~/.codex/config.toml`:**

```toml
[mcp_servers.cerefox]
url = "https://<your-project-ref>.supabase.co/functions/v1/cerefox-mcp"
bearer_token_env_var = "CEREFOX_ACCESS_TOKEN"
```

Replace `<your-project-ref>` with your Supabase project ref.

**Step 3 — Verify:**

Launch Codex and use the `/mcp` slash command to confirm the `cerefox` server is connected
and all 15 tools are listed.

**Notes:**
- `bearer_token_env_var` is the **name** of the env var (e.g. `"CEREFOX_ACCESS_TOKEN"`), not the
  token itself. Codex reads the value at runtime.
- No Python, no local repo clone needed — just the URL and Cerefox token.
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
        "Authorization": "Bearer <your-cerefox-token>"
      }
    }
  }
}
```

Replace `<your-project-ref>` and `<your-cerefox-token>` with your actual values.

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
Authorization: Bearer <your-cerefox-token>
Content-Type: application/json
```

Generate your token: run `cerefox token generate` (it prints the `cfx_pat_…` Cerefox access token once and sets it on Supabase). The legacy Supabase anon JWT is no longer accepted for Edge Function calls — see the token callout in the Prerequisites section.

### Path B system prompt

For ChatGPT Custom GPT:
```
You have access to a personal knowledge base via the searchKnowledgeBase action.
When the user asks a question, always search the knowledge base first using a
relevant query. Present results by document title, citing the source for every claim.
Use ingestNote to save any new information the user asks you to remember.
When UPDATING an existing document, first call getDocument and note its
content_hash, then pass it as expected_content_hash on ingestNote. If you get a
409 conflict, the document changed underneath you: call getDocument again, merge
your changes into the latest content, and retry with the new hash — never
overwrite blindly.
```

### Path B verification

```bash
curl -s -X POST \
  "https://<your-project-ref>.supabase.co/functions/v1/cerefox-search" \
  -H "Authorization: Bearer <your-cerefox-token>" \
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
  version: 3.1.0
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
                  enum: [docs, hybrid, fts]
                  default: docs
                  description: >
                    docs = document-level hybrid (recommended); hybrid = chunk-level
                    semantic+FTS; fts = keyword-only (no embedding).
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
                alpha:
                  type: number
                  default: 0.7
                  description: >
                    Semantic weight for hybrid/docs modes (0 = pure FTS, 1 = pure
                    semantic). Advanced; leave unset for the default blend.
                min_score:
                  type: number
                  default: 0.5
                  description: >
                    Minimum cosine similarity for a vector-only match to be included.
                    Advanced; leave unset for the default threshold.
                max_bytes:
                  type: integer
                  default: 200000
                  description: >
                    Response size budget in bytes (server hard ceiling 200000).
                    Whole results are dropped (never truncated mid-document) until
                    the budget is met; the response sets `truncated: true` when this
                    happens. Advanced; leave unset for the default.
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
                  description: >
                    Add the document to this project (non-destructive — keeps any
                    existing project memberships). Looked up by name.
                project_names:
                  type: array
                  items:
                    type: string
                  description: >
                    Destructive full-set project assignment: the document's project
                    memberships are replaced with exactly this list. Use project_name
                    (singular) to add without removing. If both are given, project_names
                    wins.
                source:
                  type: string
                  default: agent
                metadata:
                  type: object
                  description: >
                    Arbitrary JSON metadata. On an UPDATE, omitting this keeps
                    the document's existing metadata (v2.1.0); pass {} to
                    deliberately clear all tags.
                update_if_exists:
                  type: boolean
                  default: false
                  description: >
                    When true, update an existing document with the same title
                    instead of creating a new one. The previous content is archived
                    as a version. If content is unchanged, the document is skipped
                    (no re-indexing). Ignored when document_id is provided.
                expected_content_hash:
                  type: string
                  description: >
                    REQUIRED on content updates (optimistic concurrency, v2.0.0):
                    the content_hash of the version this edit was based on, as
                    returned by getDocument / searchKnowledgeBase / metadataSearch.
                    If the document changed since it was read, the update fails
                    with HTTP 409 — re-read the document, merge your changes,
                    retry with the new hash. Not needed when creating.
                last_write_wins:
                  type: boolean
                  default: false
                  description: >
                    Explicitly skip the concurrency check and overwrite regardless
                    of concurrent changes. Use ONLY when an external source of
                    truth makes conflicts meaningless. Recorded in the audit log.
                    Never use it to silence a 409 conflict.
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
          description: >
            Ingest result. Fields vary by outcome:
            { document_id, title, chunk_count, total_chars,
              project_id?, project_name?,   # set when a project was assigned on create
              skipped?,                      # true when identical content was deduplicated
              updated?,                      # true when an existing doc was updated
              content_hash,                  # the new hash — returned on CREATE as well as
                                             # update, so a new document is born holding
                                             # its own concurrency token (#189)
              message?,                      # human note on dedup/skip/update
              note? }                        # note when a flag (e.g. update_if_exists) was overridden
        '400':
          description: >
            Missing expected_content_hash on a content update (and
            last_write_wins not set). Read the document first, then retry
            with its content_hash.
        '409':
          description: >
            Conflict — the document changed since it was read. Call getDocument
            for the latest content + content_hash, merge your changes, and
            retry with the new hash. Do not overwrite blindly.
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
              is_archived, version_id, content_hash }.
            content_hash is the document's CURRENT hash — pass it back as
            expected_content_hash when updating via ingestNote.
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
                until:
                  type: string
                  description: ISO timestamp upper bound for temporal queries (optional)
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
        Find or list documents by metadata key-value criteria without a text
        search term. Use to discover documents tagged with specific attributes,
        browse by taxonomy, or list a project's documents (pass project_id alone).
        At least one of metadata_filter, project_id, updated_since, or
        created_since must be supplied.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                metadata_filter:
                  type: object
                  additionalProperties:
                    type: string
                  description: >
                    Key-value pairs; ALL must match (AND semantics).
                    Example: {"type": "decision", "status": "active"}.
                    Optional — omit (or pass {}) to list by project_id / time
                    range alone. At least one filter (metadata_filter, project_id,
                    updated_since, or created_since) is required.
                project_id:
                  type: string
                  description: >
                    Filter by project UUID (optional). Sufficient on its own to
                    list that project's documents. NOTE: this is the project
                    UUID, not its name — unlike searchKnowledgeBase / ingestNote
                    which take project_name. Get UUIDs from listProjects.
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
                max_bytes:
                  type: integer
                  default: 200000
                  description: >
                    Response size budget in bytes when include_content is true
                    (whole results dropped to fit). Advanced; leave unset for the default.
                requestor:
                  type: string
                  description: Name of the agent making this request. Optional.
      responses:
        '200':
          description: >
            Array of matching documents:
            [{ document_id, title, doc_metadata, review_status, source, created_at,
               updated_at, total_chars, chunk_count, project_ids, project_names,
               version_count, content_hash, content }].
            content_hash is the concurrency token — pass it back as
            expected_content_hash when updating via ingestNote.
```

**Step 3 — Configure authentication**

In the action's **Authentication** settings:
- Type: **API Key**
- Auth type: **Bearer**
- API key: your **Cerefox access token** (`cfx_pat_…`). Generate it with
  `cerefox token generate` (it prints the token once and sets it on Supabase).
  The legacy Supabase anon key is no longer accepted (iter-28E).

> **Important:** ChatGPT resets the stored API key when you update the action
> schema. This release bumps the schema `info.version`, so on your next schema
> paste ChatGPT will clear the key — re-enter your **Cerefox access token** in the
> authentication settings. (That reset is expected here: it's what swaps you off
> the old anon key.)

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
  -H "Authorization: Bearer <your-cerefox-token>" \
  -H "Content-Type: application/json" \
  -d '{"query": "knowledge management", "match_count": 5}'
```

**Ingest:**
```bash
curl -s -X POST \
  "https://<your-project-ref>.supabase.co/functions/v1/cerefox-ingest" \
  -H "Authorization: Bearer <your-cerefox-token>" \
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
| `is_partial` | boolean | `true` when `full_content` contains only matched chunks + neighbours instead of the complete document. Triggered when the document exceeds the small-to-big threshold (default 20 000 chars). Use `getDocument` to retrieve the full text. |
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

### Cloud Claude (claude.ai web + mobile — OAuth) <a id="cloud-claude-claudeai-web--mobile-oauth"></a>

> **Optional feature.** This is the only path that needs the OAuth setup + a hosted
> consent page. If you don't use claude.ai web / mobile, skip it — every other client
> works without it. Design + rationale:
> [`docs/specs/oauth-mcp-server-design.md`](../specs/oauth-mcp-server-design.md).

Claude.ai web **and the Claude mobile app** connect to your own `cerefox-mcp` Edge
Function over **OAuth**, with the **full hybrid-search tool surface** — no local install.
This replaces the old FTS-only `mcp.supabase.com` approach (raw keyword search over the
tables, no semantic search, no Cerefox tool ergonomics).

**Prerequisite:** complete the one-time Supabase OAuth setup in
[`setup-supabase.md` → Step 7](setup-supabase.md#step-7--oauth-for-cloud-agents-claudeai--mobile-optional)
— enable the OAuth 2.1 Server, deploy the Cloudflare Worker consent page, create the owner
user + `CEREFOX_OAUTH_OWNER_ID` pin, and register the Claude OAuth App
(**`client_secret_post`**) whose Client ID/Secret you paste below.

1. In Claude.ai (web): **Settings → Connectors → Add custom connector**.
2. **Name**: `CerefoxMCP` (distinct from the local `cerefox` server, so both can coexist).
3. **URL** (must be the `*.supabase.co` host — custom domains break OAuth discovery):
   ```
   https://<your-project-ref>.supabase.co/functions/v1/cerefox-mcp
   ```
4. **Advanced settings → OAuth Client ID / OAuth Client Secret**: paste the Client ID and
   Client Secret from the pre-registered OAuth App (setup-supabase Step 7d).
5. Save. Claude runs the OAuth flow → redirects you to the **Cerefox consent page** (sign
   in with the owner email/password from Step 7c, then **Allow**) → returns to Claude. The
   connector shows as connected with **15 tools** (19 if you have enabled document relations). (If you've approved before, Supabase
   auto-consents and the page just flashes through — that's expected.)
6. **Mobile**: connectors are account-level, so `CerefoxMCP` appears in the Claude mobile
   app automatically — run one search from your phone to confirm.

**Verify**: in a new chat with the connector enabled, ask *"Using CerefoxMCP, search the
Cerefox Decision Log and give the title of the latest part."* A correct answer proves
search + document reconstruction over the OAuth path.

> **If the connect fails right after consent** with an `ofid_…` reference: the OAuth App's
> token endpoint auth method is wrong. It must be **`request body` (`client_secret_post`)**,
> not HTTP Basic — see setup-supabase Step 7d. This is the most common mistake.

> **Cost note**: each cloud tool call is ~1 Edge Function invocation. Fine for interactive
> use; for heavy/automated work prefer the local stdio server (zero EF cost). Your local
> and static-Bearer clients (Claude Code, Cursor, Codex, Gemini, Desktop) are unchanged.

---

## Path C — Shell CLI for local coding agents

### What it is

Modern local coding agents — Claude Code, OpenAI Codex CLI, opencode, OpenClaw, Hermes, and many others — all expose a **Bash tool** (or similar shell-execution tool) to their underlying model. If the agent's user has installed the Cerefox CLI (`npm install -g @cerefox/memory`), the agent can read and write the knowledge base by running `cerefox …` exactly the same way a human would.

This is **not a separate Cerefox installation path** — it's the same Layer 2 access (REST + service-role key) that you already use as a human via the CLI. What's new is the *usage model*: the user authorizes a local agent to use that CLI on their behalf, instead of (or alongside) configuring MCP.

When to choose Path C over Path A:

- **No MCP setup friction** — the agent already has a Bash tool; no `.mcp.json`, no `claude mcp add`, no Claude Desktop config edits.
- **One Cerefox CLI install serves any number of local agents** — Claude Code, Codex CLI, opencode, etc. running in the same project all use the same `cerefox …` commands.
- **Best for power users who already use the CLI themselves** — the agent and the user share one mental model and one set of conventions.

When Path A is still better:

- Cleaner agent UX — named tool calls (`cerefox_search(...)`) read better in agent transcripts than `Bash("cerefox search 'foo'")`.
- Some agents may rate-limit or budget Bash calls separately from MCP calls.
- Cloud-only agents (claude.ai, chatgpt.com) cannot use Path C at all — they have no Bash tool.

### Prerequisites

Same as **Path A-Local**:

- [Node.js ≥20](https://nodejs.org) + the CLI installed: `npm install -g @cerefox/memory`
- `.env` configured (resolved from the working directory) with `CEREFOX_SUPABASE_URL`, `CEREFOX_SUPABASE_KEY` (service-role / new secret key), and your embedding API key (`OPENAI_API_KEY`)

Quick sanity check before pointing an agent at it:

```bash
cerefox search "any query"
cerefox project list
```

If both work for you, they'll work for the agent.

### How to enable it for an agent

The pattern is the same across Claude Code, Codex CLI, opencode, OpenClaw, Hermes, and similar tools:

1. **Confirm the `cerefox` CLI is installed and on PATH** (`npm install -g @cerefox/memory`) with a resolvable `.env`.
2. **Point the agent at the agent docs**: `AGENT_GUIDE.md` and `AGENT_QUICK_REFERENCE.md` (repo root, also retrievable over MCP via `cerefox_get_help`). These describe what to read, what to write, and the audit/metadata conventions. They cover MCP usage; the CLI mapping is in `AGENT_GUIDE.md` ("Using Cerefox via the CLI").
3. **Optionally**: add a one-line reminder in the agent's system prompt so the model defaults to using Cerefox proactively.

Example system-prompt snippet (adapt for your agent — Claude Code's `CLAUDE.md`, Codex's `AGENTS.md`, opencode's project config, etc.):

```
You have access to a personal Cerefox knowledge base via a local CLI.

- Run any command with: cerefox <subcommand>  (resource-verb shape, e.g.
  `cerefox document get`, `cerefox project list`, `cerefox metadata search`)
- Read AGENT_GUIDE.md and AGENT_QUICK_REFERENCE.md for conventions, metadata
  rules, and the MCP-tool → CLI-command mapping. Full per-flag reference:
  docs/guides/cli.md.

Identify yourself on every call:
- Writes (document ingest, document ingest-dir): pass --author "<your-name>" --author-type agent
- Reads (search, document get, document version list, project list,
  metadata search, audit list): pass --requestor "<your-name>"

When answering questions, search Cerefox first. When the user asks you to
remember something, ingest it. Cite document titles for every claim drawn
from the knowledge base.
```

### MCP tool ↔ CLI command mapping

The agent docs are written around MCP tool names. **CLI flag names match MCP parameter names exactly** (kebab-cased), each with a single-letter short form (`-p`, `-f`, `-c`, `-m`, `-u`, `-a`, `-r`). There are no long-form aliases like `--project` or `--count` — use the canonical long name or its short form. Full per-flag reference: [`docs/guides/cli.md`](cli.md).

| MCP tool | CLI command |
|---|---|
| `cerefox_search` | `cerefox search "<query>" --match-count N --project-name <n> --metadata-filter '<json>' --requestor <name>` (CLI-only: `--mode`, `--alpha`, `--min-score`, `--only-metadata`) |
| `cerefox_ingest` (file) | `cerefox document ingest <path> --title <t> --project-name <n> --metadata '<json>' --update-if-exists\|--document-id <uuid> --source <s> --author <a> --author-type user\|agent` |
| `cerefox_ingest` (paste) | `printf '...' \| cerefox document ingest --paste --title "<title>"` (same flags) |
| `cerefox_get_document` | `cerefox document get <document-id> --version-id <vid> --requestor <name>` |
| `cerefox_list_versions` | `cerefox document version list <document-id> --requestor <name>` |
| `cerefox_list_projects` | `cerefox project list --requestor <name>` |
| `cerefox_set_document_metadata` | `cerefox document set-metadata <document-id> --set key=value` (also `--remove key`, `--json '{...}'`, `--replace`) |
| `cerefox_set_document_projects` | `cerefox document set-projects <document-id> <name...> --author <a> --author-type user\|agent` (or `--clear`) |
| `cerefox_list_metadata_keys` | `cerefox metadata keys` |
| `cerefox_metadata_search` | `cerefox metadata search --metadata-filter '<json>' --project-name <n> --requestor <name>` |
| `cerefox_get_audit_log` | `cerefox audit list --document-id <id> --author <a> --operation <op> --since <iso> --until <iso> --limit N --json --requestor <name>` |

> CLI verbs with no MCP equivalent: `cerefox document edit`, `cerefox document restore`, `cerefox project create` / `cerefox project edit`, `cerefox config list`.

### Path C verification prompts

After pointing your agent at the repo, ask it:

> "Run a Cerefox search for 'second brain'. What did you find?"
> Expected: agent runs `cerefox search "second brain"` via its Bash tool and reports results.

> "Save a note titled 'Test Note' to Cerefox with the content '# Test\nThis is a Path C test.'"
> Expected: agent runs `cerefox document ingest --paste --title "Test Note"` (or equivalent) and reports the new document ID.

> "List my Cerefox projects."
> Expected: agent runs `cerefox project list`.

### Caveats

- **Privilege level**: the CLI uses the **service-role key** (`CEREFOX_SUPABASE_KEY`), which bypasses Row Level Security. An agent with Bash access has the same full read/write power you do. Only enable Path C for agents you trust to act on your behalf — the same trust level you'd grant Cursor/Claude Code for editing your source code.
- **Audit attribution**: Path C records `access_path = "cli"` in usage logs, distinct from `"local-mcp"` / `"remote-mcp"`. **Agents must set `--author <name> --author-type agent` on writes and `--requestor <name>` on reads** (or rely on `CEREFOX_AUTHOR_NAME` / `CEREFOX_AUTHOR_TYPE` / `CEREFOX_REQUESTOR_NAME` env vars). Without these flags, writes attribute to `"unknown"` / `"user"`, which under-reports agent activity. See the 2026-05-18 Decision Log Q2 entry for the design rationale (`author_type` is caller-declared on ambiguous channels — CLI and Edge Functions — but `access_path` is always derived from the code layer).
- **Soft-delete and restore are reachable; permanent purge is not** — by design. `cerefox document delete` / `cerefox document restore` on the CLI, `cerefox_delete_document` / `cerefox_restore_document` over MCP (v1.7.0, #208/#210): both audited with author attribution. **Permanent purge** (irreversible) stays web-UI-only with human-in-the-loop confirmation. If an agent deletes or restores content, it should surface that to the user explicitly so they can follow it in the audit trail. See [`access-paths.md` → Destructive operations and the trust model](access-paths.md#destructive-operations-and-the-trust-model) for the full rationale and contributor guidance.
- **Cross-doc links in content you ingest** become clickable when the user views them in the Cerefox web UI. Author them as `[Text](uuid)` (most stable), `[Text](docs/path.md)` (repo files), or `[Text](<Title With Spaces>)` (angle-bracket form — bare spaces break markdown). See [`AGENT_GUIDE.md` → "Writing linkable content"](../../AGENT_GUIDE.md#writing-linkable-content) for the full set of rules.
- **CLI install per machine**: the agent needs the `cerefox` binary installed (`npm install -g @cerefox/memory`) with a resolvable `.env`. If you skip the local install entirely, Path A-Remote or Path B is the only option.
- **No sandboxing beyond the agent's existing Bash sandbox**: the CLI is just shell. If your agent's tool framework restricts which commands run, allowlist `cerefox …` explicitly.

### Path C is configuration-free, but here's the per-agent footprint

| Agent | Where to remind the agent about Cerefox |
|---|---|
| Claude Code | `CLAUDE.md` in the project, or `~/.claude/CLAUDE.md` globally. No MCP entry needed. |
| OpenAI Codex CLI | `AGENTS.md` or the project's instructions file. |
| opencode | Project config / agent system prompt. |
| OpenClaw, Hermes, custom local agents | Whatever the tool's system-prompt / memory mechanism is. |

There is nothing Cerefox-specific to configure for the agent itself — just the globally-installed `cerefox` CLI + your `.env`.

---

## Keeping both paths in sync

Both paths use the same Postgres RPCs and the same stored embeddings, but embed queries
independently. If you change the embedding model, **update both paths** before searching:

1. Update `.env` + run `cerefox server reindex` (re-embeds stored chunks)
2. Update the TypeScript constants in `supabase/functions/*/index.ts` + redeploy Edge Functions (`cerefox server deploy`)

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
| `p_small_to_big_threshold` | INT | 20000 | Documents larger than this return matched chunks + neighbours instead of the full document. Set to `0` to always return full content. Change the DEFAULT in `rpcs.sql` to apply server-wide. |
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

---

## Appendix: manual per-client config

`cerefox configure-agent --tool <client>` writes these entries for you (recommended). The raw
config below is here for the curious, or for debugging if the CLI can't write your config. Each
block is the local-stdio Path A-Local entry — the `npx -y --package=@cerefox/memory cerefox mcp`
invocation. The `env` block is only needed if you don't already have a `.env` file in a
directory the server can find (the server resolves `.env` from the current working directory).

### Claude Desktop (manual)

Config file location:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

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

Merge the `mcpServers` block into any existing file — do not wrap it in an extra `{}` or
replace the whole file. Restart Claude Desktop fully (Cmd+Q on macOS) after saving.

### Cursor (manual)

Open **Cursor Settings** (`Cmd+,`) → **Tools & Integrations** → **MCP** → **Add new global MCP
server**, then paste the same block as Claude Desktop (above). Save and restart Cursor. For
project-scoped access, put the same content in `.cursor/mcp.json` in your project root.

### Claude Code (manual)

```bash
claude mcp add --scope user cerefox \
  npx -- -y --package=@cerefox/memory cerefox mcp
```

- `--scope user` makes the server available in every project (stored in `~/.claude/mcp.json`).
- Use `--scope project` instead to limit it to the current directory (stored in `.mcp.json`).

If `.env` isn't resolvable from your shell's CWD, edit the resulting JSON config to add an
`env` block (see the Claude Desktop block above). The **Code** tab inside Claude Desktop uses
this same config — run the `claude mcp add` above and it picks it up automatically.
