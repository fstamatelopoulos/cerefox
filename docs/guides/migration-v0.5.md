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
| `@cerefox/memory` v0.5.0 or v0.5.1 (npm) | "v0.5.2 fixed the soft wrapper" + "v0.5.3 migrated `.env`" + "v0.5.4 fixed configure-agent claude-code" |
| `@cerefox/memory` v0.5.2 (npm) | "v0.5.3 migrated `.env`" + "v0.5.4 fixed configure-agent claude-code" |
| `@cerefox/memory` v0.5.3 (npm) | **"v0.5.4 fixed configure-agent claude-code"** — re-run configure-agent |

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

## v0.5.4 fixed `cerefox configure-agent --tool claude-code`

**If you ran `cerefox configure-agent --tool claude-code` on any version
from v0.5.0 through v0.5.3, Claude Code did not actually pick up the
config.** The writer wrote to `~/.claude/mcp.json` — a path Claude Code
doesn't read. Claude Code's user-scope MCP servers live in
**`~/.claude.json`** (a dot-file in `$HOME`) under the `.mcpServers` key.

The bug went unnoticed because `cerefox doctor` was scanning the same
wrong path — both surfaces were consistently lying.

### What v0.5.4 changed

- **`configure-agent --tool claude-code`** now shells out to Claude Code's
  own `claude mcp add --scope user` CLI. Claude Code manages its own
  config schema; delegating is future-proof. Requires the `claude` CLI
  on PATH (fair assumption — you're configuring it).
- Before invoking the delegated CLI, the writer takes a defensive backup
  of `~/.claude.json` to `~/.claude.json.pre-cerefox.bak`.
- **`cerefox doctor`** now scans `~/.claude.json` for a `mcpServers.cerefox`
  entry (not the orphaned `~/.claude/mcp.json` from the bug window).
- **`--tool claude-desktop` is unchanged** — Claude Desktop has no CLI
  helper, so its writer remains direct-file-write.

### What you need to do

Anyone who ran `configure-agent --tool claude-code` on v0.5.0–v0.5.3:

```bash
# 1. Upgrade
bun update -g @cerefox/memory      # or: npm update -g @cerefox/memory

# 2. (Optional) Remove the orphaned file the buggy versions wrote.
#    It does nothing — Claude Code never read it. Safe to delete.
rm -f ~/.claude/mcp.json

# 3. Re-run configure-agent to write the config at the correct path.
cerefox configure-agent --tool claude-code

# 4. Verify
claude mcp list                    # should now show 'cerefox'
cerefox doctor                     # 'mcp clients' should list 'Claude Code (user)'

# 5. Start a fresh Claude Code session — the cerefox tools appear.
```

Running sessions cache the MCP server list at startup, so an
**already-open Claude Code session won't pick up the new server**.
Open a new session.

### `--config-path FILE` override (advanced)

If you pass `--config-path FILE` explicitly, configure-agent does a
direct-write to FILE instead of shelling out — preserves the v0.5.0–v0.5.3
test path and works for power users who want a specific file location.

---

## v0.6.0 moved the web server to TypeScript

**TL;DR**: `cerefox web` from the npm package now boots an in-process
Hono server (TypeScript on Bun) instead of pointing you at
`uv run cerefox web`. Three ingestion endpoints temporarily return
503; the web UI shows a friendly toast pointing at the working CLI
fallback. Full ingestion support lands in v0.7.

### What's new

- **`cerefox web` works from npm.** No clone, no `uv`. `npm install
  -g @cerefox/memory` followed by `cerefox web` boots the local web
  UI + JSON API on `http://127.0.0.1:8000/`.
- **React SPA bundled** into `@cerefox/memory`. The web UI is part
  of the npm tarball; you get the same UI Python's `uv run cerefox
  web` serves, no extra install.
- **Configure-agent grew Phase 2 writers**: `cerefox configure-agent
  --tool cursor` / `--tool codex` / `--tool gemini` join the existing
  `--tool claude-code` / `--tool claude-desktop`. Codex's config is
  TOML (`~/.codex/config.toml`); the rest are JSON.

### The 503-ingestion-stubs window

Three endpoints return 503 with `{error: "Ingestion lands in v0.7",
see: <url>, note: …}`:

- `POST /api/v1/ingest` (paste)
- `POST /api/v1/ingest/file` (file upload)
- `POST /api/v1/documents/{id}/upload` (replace)

The web UI detects this and shows a yellow Mantine toast — no scary
error banner. `/documents/{id}/edit` also returns 503 if you try to
change content (it compares SHA-256 hashes against the stored
`content_hash` — title / metadata / project changes work fine).

### Working fallbacks during the v0.6 window

Both fully functional, no behaviour change:

```bash
# Option A — npm-installed CLI hits the deployed Edge Function.
cerefox ingest my-notes.md
cerefox ingest-dir docs/

# Option B — keep using the Python web for ingestion until v0.7.
uv run cerefox web
```

v0.7 swaps the 503 stubs for in-process pipeline calls. The toast
just stops firing — no frontend changes, no config changes, no
re-install.

### Should I upgrade from v0.5.4 to v0.6.0?

| Workflow | Recommendation |
|---|---|
| MCP client only (Claude Code, Cursor, etc.) | Yes — Phase 2 writers + faster install matter. No risk. |
| `cerefox` CLI for ingest / search | Yes — same CLI, no API changes. Ingest still works via the Edge Function. |
| Web UI to ingest documents | Optional — wait a few days for v0.7 if ingestion-via-web is your main flow. Or upgrade and use the CLI for ingest until v0.7. |
| `uv run cerefox web` | Keep using it through v0.7; the Python web is unchanged. The deprecation banner lands in v0.7 once the TS web is feature-complete. |

### Python web kept through v0.7.x

`src/cerefox/api/app.py` and `routes_api.py` ship unchanged in v0.6.
The Python web-specific deprecation banner is **deferred to v0.7's
Part 25L** — we won't nudge users away from a fully-working Python
web while the TS web's 3 ingest endpoints are still 503. v0.8 makes
the banner prominent; v0.9 deletes the Python web code.

---

## v0.7.0 completes the TS migration arc

**TL;DR**: the 3 ingestion endpoints that returned 503 in v0.6 now
work. `cerefox ingest` and `cerefox ingest-dir` run in-process (no
Edge Function round-trip). `cerefox reindex` (a v0.5 deferred stub)
is a real command. PDF/DOCX support dropped. Python web prints a
deprecation banner. Python MCP server keeps working unchanged.

### The 503 toast is gone

If you saw "Ingestion lands in v0.7 — use `cerefox ingest <file>` from
the CLI for now" anywhere in the web UI during v0.6, that's gone in
v0.7. The 3 ingestion endpoints (`POST /api/v1/ingest`,
`POST /api/v1/ingest/file`, `POST /api/v1/documents/{id}/upload`) now
call the in-process TS pipeline. The frontend's
`V07IngestionDeferredError` toast detector stays in `api/client.ts`
as dead code — no churn there, just stops firing.

### CLI gets faster (no EF round-trip)

`cerefox ingest <file>` and `cerefox ingest-dir <dir>` pre-v0.7 made
an HTTP call to the `cerefox-ingest` Edge Function (Deno on Supabase).
In v0.7+ they run the in-process TS pipeline directly: chunk +
embed + atomic RPC, all in the same Bun/Node process. Faster + no
network egress to Supabase Functions (only to Postgres + OpenAI).

`cerefox reindex` is no longer a v0.5 stub. It re-embeds chunks via
the same in-process pipeline. Defaults to stale-only (chunks with a
different embedder model recorded); `--all` reindexes everything.
`--batch <n>` controls the batch size. `--document-id <uuid>` scopes
to one doc. `--dry-run` previews.

### PDF / DOCX support dropped

The `src/cerefox/chunking/converters.py` module and its tests are
deleted. The Python CLI's `.pdf` / `.docx` branches now print a clear
"support dropped in v0.7.0" error pointing at pandoc / docling for
client-side conversion. The TS surfaces never had PDF/DOCX support;
no UX change there.

If you were using the Python CLI to ingest PDFs/DOCXs: convert them
to markdown client-side first (`pandoc input.pdf -o input.md` or
similar), then ingest the .md.

### Python web shows a deprecation banner

`uv run cerefox web` now prints a yellow ⚠ deprecation banner at
startup:

```
  ⚠ Cerefox Python web server is deprecated as of v0.7.0.
    The canonical web UI is `cerefox web` from `@cerefox/memory`
    (npm install -g @cerefox/memory). The Python web stays through
    v0.7.x and v0.8 as a husk; consider switching now.
    See docs/guides/migration-v0.5.md § v0.7 for the migration path.
```

The Python web stays through v0.7.x and v0.8 (likely as a husk that
returns 503 on every route in v0.8). v0.9's call on the Python web is
TBD per the iter-26 design pass. Switch to `cerefox web` from npm
when you can — it's been functionally complete since v0.6 + has had
ingestion since v0.7.

### Python MCP server stays unchanged

Per the "Python minimization, not removal" policy locked at iter-24,
the Python MCP server stays fully functional through v0.9+. If you
check out the repo and run `uv run cerefox mcp`, that keeps working
indefinitely. `CerefoxClient` stays in the Python tree for the same
reason — MCP uses it.

### Scripts: 3 ported, 2 stay Python

| Script | Status in v0.7.0 |
|---|---|
| `scripts/db_deploy.py` | Husk; use `bun scripts/db_deploy.ts` |
| `scripts/db_migrate.py` | Husk; use `bun scripts/db_migrate.ts` |
| `scripts/reindex_all.py` | Husk; use `bun scripts/reindex_all.ts` |
| `scripts/backup_create.py` | Stays Python through v0.7.x (port deferred) |
| `scripts/backup_restore.py` | Stays Python through v0.7.x (port deferred) |

The Postgres client used by `db_deploy.ts` / `db_migrate.ts` is the
`postgres` (Porsager) library — small, well-typed, no native deps.
Cross-runtime (Bun + Node).

### Should I upgrade from v0.6.0 to v0.7.0?

| Workflow | Recommendation |
|---|---|
| Web UI for ingestion | **Yes — that's the whole point.** v0.6 sent you to the CLI for ingest; v0.7 has it in the browser. |
| MCP client only (Claude Code, Cursor, etc.) | Yes — no functional change for you, but you'll get the v0.7 npm cleanup. |
| `cerefox` CLI | Yes — faster ingest paths + working reindex. |
| `uv run cerefox web` (Python) | Optional — banner appears; can ignore for now. v0.8 will make this prominent. |
| `uv run cerefox mcp` (Python) | No-op — Python MCP unchanged. |
| PDF/DOCX ingest via Python CLI | Convert to markdown client-side before upgrading. |

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
