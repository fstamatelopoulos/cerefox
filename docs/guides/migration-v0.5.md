# Migrating to Cerefox v0.5.0

**TL;DR:** the Cerefox CLI is now a TypeScript binary published to npm.
You can keep using the Python CLI through v0.7.x (it just prints a
one-line ⚠ banner now), but the npm path is faster, doesn't need a
local clone, and adds new lifecycle commands (`init`, `doctor`,
`configure-agent`, `self-update`).

> **Existing v0.4.x users:** your MCP client configs keep working.
> v0.4.0 already shipped the `cerefox-mcp` bin on npm; v0.5 adds the
> `cerefox` CLI bin **inside the same `@cerefox/memory` package**. One
> install, both bins.

---

## What changed

### `cerefox` is now an npm-installable binary

```bash
npm install -g @cerefox/memory     # or: bun install -g @cerefox/memory
cerefox doctor                     # callable from any directory
```

The Python `cerefox` CLI (installed via `uv sync` in a Cerefox checkout)
keeps working, but now prints a deprecation banner. Removal is v0.8 /
v0.9 — see iter-23 plan / Decision Log Q2 for the schedule.

### New lifecycle commands

| Command | What it does |
|---|---|
| `cerefox init` | Interactive 5-step bootstrap (Supabase URL, key, OpenAI, Postgres URL, identity). Writes `~/.cerefox/.env`, validates credentials, ingests bundled self-docs, optionally wires Claude Code or Claude Desktop. |
| `cerefox doctor` | 9 diagnostic checks (runtime, config, Supabase, OpenAI, schema version, MCP clients, …). |
| `cerefox status` | Fast 3-check subset of `doctor`. |
| `cerefox configure-agent --tool claude-code` | Writes `~/.claude/mcp.json` (or merges) to wire up the `cerefox` MCP server. Phase 1: Claude Code + Claude Desktop. Cursor / Codex / Gemini ship in v0.5.x. |
| `cerefox self-update` (alias `cerefox upgrade`) | Detects installer (bun / npm / yarn / pnpm) and upgrades in place. Also refreshes the bundled-docs ingest. |
| `cerefox sync-self-docs` | Ingests bundled `AGENT_GUIDE.md` + `AGENT_QUICK_REFERENCE.md` + curated `docs/guides/*.md` under the `_cerefox-self-docs` project. Layer 2 of the MCP discoverability story (§10d in the design doc). |

### Improved help + tab completion

```bash
cerefox --help                     # commands grouped READS / WRITES / SERVERS / LIFECYCLE / OPS
cerefox completion bash > ~/.cerefox-completion.bash
echo 'source ~/.cerefox-completion.bash' >> ~/.bashrc
```

### Documented exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | User error (bad flag, missing arg, malformed JSON) |
| 2 | System error (Supabase unreachable, RPC failure) |
| 3 | Not found (document / version / project) |

---

## Install paths

### Option A — one-line install (recommended for new machines)

```bash
curl -fsSL https://github.com/fstamatelopoulos/cerefox/releases/latest/download/install.sh | sh
```

The script detects Bun first, falls back to npm, bootstraps Bun if
neither is available. Then runs `<runtime> install -g @cerefox/memory`.

### Option B — direct npm install

```bash
npm install -g @cerefox/memory       # Node ≥ 20 required
# or
bun install -g @cerefox/memory       # faster install + bin start
# or
pnpm add -g @cerefox/memory
yarn global add @cerefox/memory
```

### Option C — keep the Python install (no change required)

Your existing `uv run cerefox …` keeps working. You'll see a one-line ⚠
banner pointing at the migration path; suppress with
`CEREFOX_NO_DEPRECATION_BANNER=1`.

---

## What's NOT in v0.5

Three commands are deliberately Python-only (or deferred) for v0.5:

- **`cerefox web`** — the TypeScript web server lands in v0.6. For now,
  the npm-installed `cerefox web` prints a "use `uv run cerefox web` from
  a clone" message and exits 0. The Python web server keeps working.
- **`cerefox reindex`** — depends on the v0.7 TS ingestion pipeline.
  Same "use uv" message; exit 0.
- **Schema deploy in `cerefox init`** — needs a Postgres direct
  connection that v0.5 doesn't ship. `init` prints the
  `uv run python scripts/db_deploy.py` command at the right moment; v0.6
  ports the deploy step.

If your usage hits any of these, keep your Python install around for now.

---

## Upgrading an existing MCP client config

The v0.4.x config you may have written looked like:

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

**That keeps working.** v0.5 ships the **same** `cerefox-mcp` bin in
the **same** npm package. No change required.

If you want the v0.5 `cerefox configure-agent` to (re)write the config
for you, the command is non-destructive: it backs up the existing file
to `<file>.pre-cerefox.bak` and merges. Existing `mcpServers` entries
are preserved.

```bash
cerefox configure-agent --tool claude-code --dry-run    # preview
cerefox configure-agent --tool claude-code              # apply
```

---

## Known gotchas

### `npx` from inside an npm workspace

The v0.4 gotcha still applies: running `npx -y --package=@cerefox/memory
cerefox-mcp` from inside another npm workspace can fail with "command
not found." Use `bunx` instead, run from outside any workspace, or
`npm install -g`.

Doesn't affect MCP-client launches (the client controls the launched
process's CWD).

### Schema-version banner in the web UI

If you upgrade `@cerefox/memory` but haven't redeployed the schema, the
v0.3.0+ schema-version-mismatch banner fires. Run
`uv run python scripts/db_deploy.py` to sync.

This isn't unique to v0.5 — it's the same banner v0.3.0 introduced.

---

## Where to go next

- `cerefox docs --list` — bundled docs, offline.
- `cerefox doctor` — see what's missing / configured.
- [`docs/guides/connect-agents.md`](connect-agents.md) — full MCP client guide.
- [`docs/guides/cli.md`](cli.md) — every command and flag, in detail.
- [`CHANGELOG.md`](../../CHANGELOG.md) — what shipped in v0.5.0.
