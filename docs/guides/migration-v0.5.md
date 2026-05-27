# Migrating to Cerefox v0.5.x

**This is the canonical upgrade guide for any user landing on Cerefox v0.5+.**
It covers the v0.4 → v0.5 transition, the v0.5.x patch trail (v0.5.1, v0.5.2,
v0.5.3), and the Python `cerefox` → TS `cerefox` migration path.

## Where to start

| Coming from | Read |
|---|---|
| Never used Cerefox before | [`quickstart.md`](quickstart.md) first, then come back here only if you hit a `.env` / config question |
| Python `cerefox` (any version through v0.5.x) | "What changed" → "Install paths" → "v0.5.3 migrated `.env`" sections below |
| `@cerefox/memory` v0.4.x (npm) | "Upgrading an existing MCP client config" → "v0.5.2 fixed the soft wrapper" → "v0.5.3 migrated `.env`" |
| `@cerefox/memory` v0.5.0 or v0.5.1 (npm) | "v0.5.2 fixed the soft wrapper" + "v0.5.3 migrated `.env`" |
| `@cerefox/memory` v0.5.2 (npm) | "v0.5.3 migrated `.env`" — the rest is unchanged |

> Looking for `migration-v0.4.md`? It's been demoted to a historical
> record (the bin names it documents no longer exist). Everything you
> need to know about the v0.4 → v0.5 transition lives in this file.

**TL;DR:** the Cerefox CLI is now a TypeScript binary published to npm.
You can keep using the Python CLI through v0.7.x (it just prints a
one-line ⚠ banner now), but the npm path is faster, doesn't need a
local clone, and adds new lifecycle commands (`init`, `doctor`,
`configure-agent`, `self-update`).

> **Existing v0.4.x users:** your MCP client configs need a one-line
> update (the `cerefox-mcp` bin from v0.4 → v0.5.0 was removed in
> v0.5.1 — it's redundant with `cerefox mcp`). See the
> ["Upgrading an existing MCP client config"](#upgrading-an-existing-mcp-client-config) section below for the exact diff.

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

The v0.4.x → v0.5.0 config you may have written looked like:

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

**In v0.5.1 this breaks.** The standalone `cerefox-mcp` bin was removed
in v0.5.1 — it duplicated `cerefox mcp` for no functional gain. Update
the `args` array to invoke the `mcp` subcommand of the main bin
instead:

```diff
   "args": [
     "-y",
     "--package=@cerefox/memory",
-    "cerefox-mcp"
+    "cerefox",
+    "mcp"
   ]
```

The behaviour is identical — same `buildServer()` factory, same 10
MCP tools, same stdio transport. Only the bin name changes.

If you want `cerefox configure-agent` to rewrite the config for you,
the command is non-destructive: it backs up the existing file to
`<file>.pre-cerefox.bak` and merges. Existing `mcpServers` entries
are preserved.

```bash
cerefox configure-agent --tool claude-code --dry-run    # preview
cerefox configure-agent --tool claude-code              # apply
```

---

## v0.5.2 fixed the soft wrapper

v0.4.0 through v0.5.1 advertised that `cerefox mcp` (the Python CLI's
subcommand, used by configs of the form `uv run --directory /path/to/cerefox cerefox mcp`)
was a "soft wrapper": it would try to delegate to the npm package's
TS MCP server via `npx --no-install --package=@cerefox/memory cerefox`
and fall back to the in-tree Python server otherwise.

**The probe was unreliable under `uv run`-launched MCP-client contexts.**
`uv run` puts the project's `.venv/bin/` first on PATH. When the npm
cache only has v0.4.x (which doesn't ship a `cerefox` bin name), npx
falls back to PATH and finds `.venv/bin/cerefox` — the Python CLI
itself — making the probe report success. The execvp then PATH-falls
back to the same `.venv/bin/cerefox`, which calls `_run_mcp()` again
→ infinite recursion → MCP client times out with "Could not attach
to MCP server cerefox."

**v0.5.2 stripped the wrapper.** `cerefox mcp` always starts the
in-tree Python MCP server. To use the TS MCP server, configure your
client to invoke it explicitly:

```json
"command": "npx",
"args": ["-y", "--package=@cerefox/memory", "cerefox", "mcp"]
```

or, if you have `@cerefox/memory` installed globally:

```json
"command": "cerefox",
"args": ["mcp"]
```

The two paths (Python via `uv run`, TS via `cerefox mcp` on PATH or
via `npx`) are functionally equivalent — same 10 MCP tools, same wire
shapes. Pick whichever fits your environment, but the choice is now
explicit instead of "magic delegation".

> **Affected configs**: if your Claude Desktop / Claude Code / Cursor
> config invokes `uv run … cerefox mcp` AND you saw "Could not attach
> to MCP server cerefox" after restarting your client on
> @cerefox/memory v0.5.1 or earlier, this is the bug. Upgrade to
> v0.5.2+ (pull `main` and `uv sync`) — the Python MCP server boots
> directly and your existing config works again.

---

## v0.5.3 migrated `.env` from `<repo>/.env` to `~/.cerefox/.env`

If you've been using the Python `cerefox` CLI, your `.env` lives in your
repo root (`/path/to/cerefox/.env`). The TS CLI v0.5.2 also read that
file, via a "CWD `.env` wins" precedence inherited from Python. v0.5.3
flips that precedence: **once `~/.cerefox/.env` exists, the TS CLI reads
from there**; the repo file becomes a legacy fallback for Python's
`uv run cerefox …` workflows.

**You see zero behavior change until you run `cerefox init`.** If your
home dir doesn't have `~/.cerefox/.env`, the TS CLI keeps reading your
existing repo `.env` (legacy dev-mode precedence). No action required.

When you do run `cerefox init` with a repo `.env` already in place, the
TS CLI offers a three-choice menu:

```
⚠ Found existing config at /path/to/cerefox/.env.

  [c] Copy to /Users/you/.cerefox/.env  (recommended)
      • TS reads the new home from now on
      • Python keeps reading /path/to/cerefox/.env (backward compat)
      • Edit ~/.cerefox/.env going forward; the repo .env is legacy

  [u] Use /path/to/cerefox/.env as-is, skip writing anything
      • Both TS and Python keep reading the existing file
      • Defer the migration

  [f] Fresh start — interactive prompts, write to /Users/you/.cerefox/.env
      • Use if the existing file is stale or wrong
```

Pick **[c]** for the typical Python → TS upgrade. The TS CLI starts
reading `~/.cerefox/.env`; your remaining Python `uv run cerefox …`
commands keep reading the unchanged repo file. The two files diverge
only if you start editing one of them — keep them in sync (or just edit
`~/.cerefox/.env` and accept that Python uses a frozen snapshot until
v0.9).

After v0.9 (Python CLI removed), `cerefox doctor` will say "ok" if you
delete the repo file. Until then, `doctor` reports it as
`legacy env … (shadowed by ~/.cerefox/.env)` so you know it's harmless.

### Python paths.py precedence (unchanged)

`src/cerefox/paths.py` keeps the v0.5.2 precedence (CWD `.env` wins).
Your existing `uv run cerefox …` invocations from inside the repo
continue to read the repo file regardless of what's in `~/.cerefox/`.
When this module goes away in v0.9+, the divergence resolves naturally.

### `CEREFOX_CONFIG_DIR` is unchanged

If you have `CEREFOX_CONFIG_DIR` set (e.g. for a non-standard install),
it still wins over both home and repo `.env` files. Init writes there
and skips the migration prompt.

---

## Known gotchas

### `npx` from inside an npm workspace

The v0.4 gotcha still applies: running `npx -y --package=@cerefox/memory
cerefox mcp` from inside another npm workspace can fail with "command
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
