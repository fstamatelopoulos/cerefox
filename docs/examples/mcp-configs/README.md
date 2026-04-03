# MCP Client Configuration Templates

Copy the appropriate template into your project root as `.mcp.json` and replace the
placeholders with your Supabase project values.

## Which template to use

| Template | Client | Transport | Notes |
|----------|--------|-----------|-------|
| `claude-code-remote.json` | Claude Code | stdio via `mcp-remote` | **Recommended.** Tested and working. |
| `claude-desktop-remote.json` | Claude Desktop | stdio via `mcp-remote` | Same as Claude Code. Requires Node.js. |
| `cursor-remote.json` | Cursor | native HTTP | Cursor supports remote MCP natively. |
| `local-stdio.json` | Any stdio client | stdio via `uv` | Runs the MCP server locally. Zero Edge Function cost. Requires Python + uv + local clone. |

## Setup

1. Copy the template for your client:
   ```bash
   cp docs/examples/mcp-configs/claude-code-remote.json /path/to/your/project/.mcp.json
   ```

2. Replace the placeholders:
   - `<your-project-ref>` -- your Supabase project reference (from Project Settings > General)
   - `<your-anon-key>` -- your Supabase anon/public key (from Project Settings > API)
   - `/path/to/cerefox` -- (local-stdio only) absolute path to your cerefox clone

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
