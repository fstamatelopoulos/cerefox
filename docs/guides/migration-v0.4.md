# Migrating to Cerefox v0.4.0 (historical)

> ## ⚠ Historical document — do not use the snippets in this file
>
> This guide documents the **v0.4.0 → v0.4.3 migration window** (May 2026).
> The `cerefox-mcp` bin name referenced throughout was dropped in **v0.5.1**;
> the soft-wrapper described in some sections was removed in **v0.5.2**.
> The per-client config snippets below **will not work on @cerefox/memory v0.5+**.
>
> **If you're upgrading today, use the current guide instead:**
> → [`migration-v0.5.md`](migration-v0.5.md) — covers Python `cerefox` → v0.5.x
>   AND v0.4.x → v0.5.x in a single document, with the v0.5.0/v0.5.1/v0.5.2/v0.5.3
>   transitions all explained.
>
> This file is preserved so historical CHANGELOG entries that reference it
> still resolve. It's not maintained.

---

**Original TL;DR (preserved verbatim)**: nothing urgent. Your existing `cerefox mcp` configs keep
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
- **`cerefox mcp` (Python CLI)** starts the in-tree Python MCP server.
  (v0.4–v0.5.1 advertised a "soft wrapper" that tried to delegate to the
  npm package's TS MCP server via npx, but the probe was unreliable
  under `uv run`-launched MCP-client contexts and caused infinite
  recursion. v0.5.2 stripped the wrapper; the Python path is now
  always the Python server, and the npm/TS path is configured
  explicitly. See `docs/guides/migration-v0.5.md` § "v0.5.2 fixed the
  soft wrapper" for the migration story.)

## The optional one-time upgrade

If you have Node 20+ installed, install `@cerefox/memory` globally:

```bash
npm install -g @cerefox/memory
# or, if you have Bun:
bun install -g @cerefox/memory
```

After this, the npm `cerefox` is on your PATH. To actually have your
MCP client use the TS server, you need to **update your MCP client
config explicitly** — v0.5.2 removed the auto-delegation. The
canonical config invokes the npm bin directly; see the next section.

(v0.4–v0.5.1 *thought* it had auto-delegation, but the soft wrapper
was unreliable under `uv run`-launched contexts and caused infinite
recursion when the MCP client launched it. v0.5.2 took the simpler
"each path is explicit" stance.)

You can also point your MCP client directly at `cerefox mcp` (the
TS-CLI subcommand) and bypass the Python path entirely:

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

## Known gotchas

- **`npx` from inside an npm workspace can fail with "command not
  found"** even when the package is correctly published. Running
  `npx -y --package=@cerefox/memory cerefox-mcp` from the root of a
  surrounding npm-workspace monorepo (your own project) confuses npx's
  bin-resolution path. Symptoms: `sh: cerefox-mcp: command not found`
  even though the published package has the bin entry. Workarounds —
  any one of these works:
  - Use `bunx` instead: `bunx --package @cerefox/memory cerefox-mcp` —
    cleanly handles workspace contexts.
  - Run from a non-workspace directory (e.g. `cd /tmp` first).
  - Install globally and invoke from PATH:
    `npm install -g @cerefox/memory` then `cerefox-mcp`.
  - When configuring an MCP client (Claude Code, Cursor, Claude
    Desktop, Codex CLI), the launched process inherits the client's
    own working directory rather than your shell's, so this gotcha
    usually doesn't bite real MCP usage — only manual `npx` smoke
    tests run from a project root.

- **The minimum npm version for OIDC publish is 11.5.1.** The shipped
  `release.yml` workflow already pins this; only relevant if you're
  forking the project for your own publish target.

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
