# MCP Client Configuration Templates

> **Easiest path: let the CLI write it for you.** `cerefox configure-agent --tool
> <claude-code|claude-desktop|cursor|codex|gemini>` writes the correct config for
> your client automatically. These templates are for manual setup, reference, or
> clients `configure-agent` doesn't cover.

Copy the appropriate template into your project root as `.mcp.json` and replace the
placeholders with your Supabase project values.

## Which template to use

| Template | Client | Transport | Notes |
|----------|--------|-----------|-------|
| `claude-code-remote.json` | Claude Code | stdio via `mcp-remote` | Works. Claude Code also supports **native HTTP** — `claude mcp add --transport http cerefox <url> --header "Authorization: Bearer <anon-key>"` (what `configure-agent --tool claude-code` uses). |
| `claude-desktop-remote.json` | Claude Desktop | stdio via `mcp-remote` | Requires Node.js. `supergateway` is the tested bridge (see connect-agents.md). |
| `cursor-remote.json` | Cursor | native HTTP | Cursor supports remote MCP natively. |
| `local-stdio.json` | Any stdio client | stdio via the `@cerefox/memory` npm package | Runs the MCP server locally (`npx --package=@cerefox/memory cerefox mcp`). Zero Edge Function cost, lower latency. Requires Node ≥ 20 or Bun — **no repo clone, no Python**. |

## Setup

1. Copy the template for your client:
   ```bash
   cp docs/examples/mcp-configs/claude-code-remote.json /path/to/your/project/.mcp.json
   ```

2. Replace the placeholders:
   - `<your-project-ref>` -- your Supabase project reference (from Project Settings > General)
   - `<your-anon-key>` -- your Supabase **legacy anon JWT** (Project Settings > API Keys > Legacy > anon). Do **not** use the new `sb_publishable_…` key — Edge Function gateway rejects it. See [`docs/guides/setup-supabase.md` → Supabase API keys (2026)](../../guides/setup-supabase.md#supabase-api-keys-2026).
   (The `local-stdio.json` template needs no placeholders — `npx` fetches
   `@cerefox/memory` on demand. It reads your `~/.cerefox/.env` for Supabase
   credentials, so run `cerefox init` first.)

3. Restart your MCP client.

## Why `mcp-remote`?

`mcp-remote` is the recommended stdio bridge for all remote MCP clients connecting to
Cerefox. It wraps the HTTP endpoint in a local stdio process, providing:

- **OAuth bypass**: the `--header` flag provides auth directly, bypassing Supabase's
  GoTrue OAuth discovery conflict that previously broke some MCP connections.
- **Clean stdio interface**: works with any client that expects a local subprocess.

### SSE polling (fixed in v0.1.12)

Prior to v0.1.12, MCP clients using native Streamable HTTP would poll the Edge Function
at ~1-5 GET requests/second while idle, burning through the Supabase Edge Function quota.
This was fixed by returning HTTP 405 for GET requests per the MCP spec. Both `mcp-remote`
and native HTTP now work without idle overhead.

See [issue #17](https://github.com/fstamatelopoulos/cerefox/issues/17) for the full
investigation.

## More information

See [docs/guides/connect-agents.md](../../guides/connect-agents.md) for the full
integration guide covering all access paths, prerequisites, and troubleshooting.
