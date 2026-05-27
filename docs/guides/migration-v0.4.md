# Migrating to Cerefox v0.4.0

**TL;DR**: nothing urgent. Your existing `cerefox mcp` configs keep
working unchanged. The Python `cerefox mcp` command is now a soft
wrapper that transparently uses the new TypeScript MCP server if it's
installed, falling back to the legacy Python implementation otherwise.
Switch to the npm-installed TS server at your convenience for faster
boot times and fewer Python dependencies.

This guide is for **existing users** of `cerefox mcp` who want to
optionally upgrade. **New users** should follow
[`docs/guides/connect-agents.md`](connect-agents.md) instead — that's
the canonical configuration recipe per MCP client.

## What changed in v0.4.0

- **`@cerefox/memory`** is a new npm package containing the Cerefox
  local stdio MCP server. Same 10 MCP tools, same protocol, faster
  boot.
- **The Edge Function (`cerefox-mcp`) shares tool handlers** with the
  new local server via `_shared/mcp-tools/`. One source of truth; no
  drift.
- **`cerefox_get_help`** is a new MCP tool (10 total now, was 9). Layer
  3 of MCP discoverability — agents can now retrieve
  `AGENT_QUICK_REFERENCE.md` content over MCP without filesystem
  access.
- **`cerefox mcp` (Python CLI) is a soft wrapper**: tries to delegate
  to `npx --package=@cerefox/memory cerefox-mcp` first; falls back to the legacy
  Python implementation if npm/Bun isn't available.

## The optional one-time upgrade

If you have Node 20+ installed, install `@cerefox/memory` globally:

```bash
npm install -g @cerefox/memory
# or, if you have Bun:
bun install -g @cerefox/memory
```

After this, your existing `cerefox mcp` configs automatically use the
TS server (the soft wrapper detects the package and delegates).

You can also point your MCP client directly at `cerefox-mcp` (the bin
shipped by the package) and bypass the Python wrapper entirely:

### Claude Code

**Old:**

```bash
claude mcp add cerefox -- uv run --directory /path/to/cerefox cerefox mcp
```

**New (optional):**

```bash
claude mcp add cerefox -- npx -y --package=@cerefox/memory cerefox-mcp
```

### Cursor

**Old** (`mcp.json` in your project or `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "cerefox": {
      "command": "uv",
      "args": ["run", "--directory", "/path/to/cerefox", "cerefox", "mcp"]
    }
  }
}
```

**New (optional):**

```json
{
  "mcpServers": {
    "cerefox": {
      "command": "npx",
      "args": ["-y", "--package=@cerefox/memory", "cerefox-mcp"]
    }
  }
}
```

### Claude Desktop

**Old** (`claude_desktop_config.json`):

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

**New (optional):**

```json
{
  "mcpServers": {
    "cerefox": {
      "command": "npx",
      "args": ["-y", "--package=@cerefox/memory", "cerefox-mcp"]
    }
  }
}
```

### Codex CLI

**Old** (`~/.codex/config.toml`):

```toml
[mcp_servers.cerefox]
command = "uv"
args = ["--directory", "/path/to/cerefox", "run", "cerefox", "mcp"]
```

**New (optional):**

```toml
[mcp_servers.cerefox]
command = "npx"
args = ["-y", "--package=@cerefox/memory", "cerefox-mcp"]
```

## Environment

The new TS server reads `.env` the same way the Python CLI does (per
v0.3.0's `_resolve_config_dir()`):

1. `CEREFOX_CONFIG_DIR` env var override.
2. `./.env` in the current working directory.
3. `~/.cerefox/.env`.

For most users with an existing Cerefox install, your `.env` is already
where it needs to be. If you want to verify:

```bash
npx --package=@cerefox/memory cerefox-mcp --help
```

(That's the help text, not a server start — safe to run anywhere.)

## Schema-version-mismatch banner

The new server prints a one-line warning to stderr at boot if the
bundled `@cerefox/memory` schema version doesn't match what's deployed
to your Supabase. Run `uv run python scripts/db_deploy.py` from the
repo to update.

## Falling back

If the npm path doesn't work for any reason (npx missing, package not
installed, network issue during `npx` resolution), `cerefox mcp` falls
back to the legacy Python server with a one-line stderr nudge. Your
MCP client never notices — same stdio interface, same tools.

To force the legacy path even when `@cerefox/memory` is installed:
uninstall it (`npm uninstall -g @cerefox/memory`) or invoke the Python
CLI from a shell without `npx` in `$PATH`.

## `cerefox_get_help` — the new tool

If you use Cerefox through an MCP client and ever wonder "wait, what's
the right way to do X in Cerefox?", you can now ask the server
directly:

- `cerefox_get_help()` — returns the full `AGENT_QUICK_REFERENCE.md`
  plus a section index.
- `cerefox_get_help(topic: "links")` — returns just the cross-document
  linking section.
- `cerefox_get_help(topic: "update")` — returns the update workflow
  sections.

The topic match is a case-insensitive substring against H2 headings.
Both the new TS server AND the legacy Python fallback expose this tool
— consistent surface regardless of which path serves your session.

## When v0.5.0 ships

The TypeScript CLI lands in v0.5.0. At that point `@cerefox/memory`
will gain a second binary (`cerefox`) for the full CLI surface
(`cerefox search`, `cerefox ingest`, etc.) plus a `cerefox
configure-agent` command that writes the right MCP config for each
client automatically. For now, the manual recipes above are the way.

## What didn't change

- The Edge Function (remote MCP) URL and auth: unchanged. Same
  Bearer-with-anon-JWT pattern; the EF just shares its tool handlers
  with the local TS server now.
- The Postgres RPC contracts: unchanged. v0.4.0 ships zero schema
  changes — the `cerefox_schema_version()` RPC introduced in v0.3.0
  still returns `0.3.1`. (The mismatch warning at TS server startup
  fires until you redeploy from `main`, which is what you'd do
  whenever the schema version actually bumps.)
- Web UI, ingestion pipeline, CLI subcommands: all unchanged in v0.4.
  Those migrate in v0.6 and v0.7.
