# MCP Client Configuration Templates

Copy the appropriate template into your project root as `.mcp.json` and replace the
placeholders with your Supabase project values.

## Which template to use

| Template | Client | Transport | Notes |
|----------|--------|-----------|-------|
| `claude-code-remote.json` | Claude Code | stdio via `mcp-remote` | **Recommended for Claude Code.** Avoids SSE polling overhead (see below). |
| `claude-desktop-remote.json` | Claude Desktop | stdio via `supergateway` | Required — Claude Desktop needs a local subprocess. |
| `cursor-remote.json` | Cursor | native HTTP | Cursor supports remote MCP natively. |
| `local-stdio.json` | Any stdio client | stdio via `uv` | Runs the MCP server locally. Zero Edge Function cost. Requires Python + uv + local clone. |

## Setup

1. Copy the template for your client:
   ```bash
   cp examples/mcp-configs/claude-code-remote.json /path/to/your/project/.mcp.json
   ```

2. Replace the placeholders:
   - `<your-project-ref>` — your Supabase project reference (from Project Settings > General)
   - `<your-anon-key>` — your Supabase anon/public key (from Project Settings > API)
   - `/path/to/cerefox` — (local-stdio only) absolute path to your cerefox clone

3. Restart your MCP client.

## Why `mcp-remote` for Claude Code?

Claude Code's native Streamable HTTP transport maintains an SSE (Server-Sent Events)
connection that generates continuous GET polling at ~5 requests/second — even when idle.
This burns through Supabase Edge Function invocations at ~130-198K/day, quickly exhausting
the 2M/month Pro Plan quota.

The `mcp-remote` stdio bridge wraps the HTTP endpoint in a local process, eliminating the
SSE polling entirely. Actual tool calls still reach the Edge Function as expected — only the
idle overhead is removed.

See [#7](https://github.com/tdebasis/cerefox/issues/7) for the full investigation and
verification results.

### Why not `mcp-remote` for Claude Desktop?

`mcp-remote` 0.1.x performs OAuth discovery at the Supabase root domain, which fails when
Supabase's built-in auth (GoTrue) rejects dynamic client registration. `supergateway` does
not attempt OAuth — it connects directly with the Bearer token. This issue does not affect
Claude Code, where `mcp-remote --header` works correctly.

## More information

See [docs/guides/connect-agents.md](../../docs/guides/connect-agents.md) for the full
integration guide covering all access paths, prerequisites, and troubleshooting.
