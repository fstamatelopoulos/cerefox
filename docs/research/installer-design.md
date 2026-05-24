# Cerefox Installer Design

**Status**: research / proposal — not yet decided. Iterate on this file in the `research/installer-design` branch before scheduling implementation.

**Goal**: turn Cerefox from a "clone the repo and `uv sync`" project into a one-liner install that gives users a globally-available `cerefox` command, an interactive first-run setup, and a self-update path — without giving up the OSS-hackable nature of the codebase. Take inspiration from cfcf's npm-based installer, adapted for Cerefox's Python codebase.

**Non-goal**: a full Python-to-TypeScript rewrite. See [§2 Background — what plan.md already says](#2-background--what-planmd-already-says) for why the existing Iteration 18 (narrow TS port of just the MCP server) is the right scope and a full rewrite is not.

---

## 1. Why this matters

Today's install (per [`docs/guides/quickstart.md`](../guides/quickstart.md)) is:

1. Install `uv` (system-level)
2. `git clone https://github.com/fstamatelopoulos/cerefox.git`
3. `cd cerefox && uv sync`
4. Set up Supabase (manual)
5. Edit `.env` in the repo directory
6. `uv run python scripts/db_deploy.py`
7. Optional: `cd frontend && npm install && npm run build`
8. Run via `uv run cerefox <subcommand>` — always from the repo directory

That works, and it's what every dev install needs anyway. But for end users — especially non-developers who just want Cerefox as a knowledge backend for their AI agents — every one of these steps is a barrier. The current pattern also has three structural awkwardnesses that compound the friction:

| Awkwardness | What's broken | Why it matters |
|---|---|---|
| **Working-directory dependence** | Every `cerefox` invocation must be from the repo root, because `Settings()` reads `.env` from the working directory. | Users have to `cd` first, or remember `--directory` in scripts. Claude Desktop MCP config has to spell out the full repo path. Path C agents (Claude Code, Codex CLI, etc.) need to be told the repo lives at a specific absolute path. |
| **No global install path** | The CLI is callable only via `uv run` inside the project venv. No way to `cerefox …` from any directory. | Users have to write wrapper aliases. Scripts hardcode `cd /path/to/cerefox && uv run cerefox …`. |
| **No interactive bootstrap** | `.env` setup is documented; not automated. Schema deploy is a separate manual step. Sample-content ingest doesn't exist. | "First successful search" requires ~15 minutes of doc-reading and copy-pasting. Compare cfcf's `cfcf init` flow — interactive, validates as it goes, gets you to "it works" in under 5. |

Solving these three things — global binary, config-not-tied-to-repo, interactive init — gives Cerefox the same kind of frictionless install that cfcf, uv, ruff, and the Astral CLI ecosystem in general have normalised.

---

## 2. Background — what plan.md already says

The repo already has a documented direction for the TypeScript question. **Iteration 18** in [`docs/plan.md`](../plan.md) (line 1626):

> **Goal**: Rewrite the local MCP server from Python to TypeScript to share code with the `cerefox-mcp` Edge Function and eliminate the dual-implementation problem.
>
> **Scope** […]: CLI and web app remain Python — they have deep Python dependencies (ingestion pipeline, embedders, file converters, FastAPI). **The local MCP server is the only piece that benefits from TypeScript because it's the only piece with a parallel TypeScript implementation.**

That decision is the right one and should stand. The user's casual mention of "rewrite all python with typescript" in this conversation was looser than the actual plan-of-record; the narrower TS port is what's scheduled. **This installer proposal explicitly stays Python-native for the CLI, web app, and ingestion pipeline.** A separate "should we go full TS?" debate, if it ever happens, is out of scope here.

What changes is **how the Python is delivered**, not the language itself.

---

## 3. Reference UX: how cfcf does it

cfcf (`/Users/fotis/src/cfcf`, currently `v0.17.0` on npm) is the model the user pointed at. Concrete patterns worth copying:

1. **One-line install**:
   ```bash
   curl -fsSL https://github.com/fstamatelopoulos/cfcf/releases/latest/download/install.sh | bash
   ```
   The script bootstraps Bun if missing, then installs cfcf via npm into `~/.bun/bin/`. Verbose at every step; prints a "next steps" banner at the end. No sudo, no PATH editing of its own (Bun's installer handles PATH).

2. **Direct install for users who already have the runtime**:
   ```bash
   npm install -g --prefix ~/.bun @cerefox/codefactory
   ```
   Documented as a skip-the-wrapper alternative for power users.

3. **State lives in `~/.cfcf/`**, not the install directory:
   - `~/.cfcf/clio.db` (memory database)
   - `~/.cfcf/logs/`
   - `~/.cfcf/models/`
   The install/upgrade flow never touches these.

4. **Interactive `cfcf init`** — runs after install, detects what's already configured, asks targeted questions, validates as it goes, offers to write the integration configs.

5. **`cfcf doctor`** — diagnostic command. Reports adapter detection, configuration health, environmental warnings. The first thing the install banner tells you to run.

6. **`cfcf self-update`** — wraps the underlying package manager (`npm install -g --prefix ~/.bun @cerefox/codefactory@<version>`), supports both npm and tarball-from-GitHub sources, leaves user data untouched. `--check` mode for "tell me what's available without installing".

7. **Per-platform native deps** — `@cerefox/codefactory-native-darwin-arm64` etc., distributed as separate npm packages that the main package depends on.

8. **Dev vs end-user split in docs** — [`docs/guides/installing.md`](../../../cfcf/docs/guides/installing.md) is end-user only; developers are pointed at the README's "For developers (building from source)" section. Don't conflate them.

The whole pattern translates 1:1 to a Python-based Cerefox, swapping npm/Bun for `uv tool` / pipx (or pre-built binaries via PyInstaller in a later phase).

---

## 4. Target user experience

After landing this proposal:

### 4a. First-time install (end user, never run Cerefox before)

```bash
# One line. No prereqs beyond curl + a shell.
curl -fsSL https://github.com/fstamatelopoulos/cerefox/releases/latest/download/install.sh | sh
```

The script:
1. Detects `uv` on PATH; bootstraps via `curl -LsSf https://astral.sh/uv/install.sh | sh` if missing.
2. Runs `uv tool install cerefox` (publishes to PyPI as `cerefox`).
3. Prints a banner:
   ```
   ✓ Cerefox v0.1.18 installed at ~/.local/bin/cerefox

   Next steps:
     1. cerefox init        # interactive setup (Supabase, OpenAI, schema deploy)
     2. cerefox doctor      # verify everything works
     3. cerefox web         # launch the web UI at http://127.0.0.1:8000/app/

   Connect AI agents: cerefox configure-mcp        # writes Claude Desktop/Code config
   Update later:      cerefox self-update
   ```

### 4b. Interactive bootstrap (`cerefox init`)

Runs once after install. Adapts to what's already configured.

```
$ cerefox init
Cerefox first-run setup. This will write configuration to ~/.cerefox/.env
and (optionally) deploy the Cerefox schema to your Supabase project.

▶ Step 1/5 — Supabase project URL
  Open https://supabase.com/dashboard and pick (or create) a project.
  Project Settings → API → Project URL.
  CEREFOX_SUPABASE_URL: https://xxxx.supabase.co

▶ Step 2/5 — Supabase secret key (the Data API key)
  Project Settings → API Keys → Secret key (sb_secret_…), OR legacy service_role JWT.
  See https://github.com/.../setup-supabase.md#supabase-api-keys-2026 for which to use.
  CEREFOX_SUPABASE_KEY: sb_secret_…

▶ Step 3/5 — OpenAI API key (for embeddings)
  https://platform.openai.com/api-keys — recommend creating a key tagged for this machine.
  OPENAI_API_KEY: sk-…

▶ Step 4/5 — Direct Postgres connection (for schema deployment)
  Project Settings → Database → Connection pooling → Session Pooler (port 5432).
  See https://github.com/.../setup-supabase.md#connection-pooling-2026 for the gotcha
  (Transaction Pooler doesn't support DDL; username must include .<project-ref>).
  CEREFOX_DATABASE_URL: postgresql://postgres.xxx:…@…:5432/postgres?sslmode=require

▶ Step 5/5 — Caller identity (optional; default is "unknown")
  Recorded in the audit log for every write you make via the CLI.
  CEREFOX_AUTHOR_NAME [unknown]: fotis
  CEREFOX_AUTHOR_TYPE [user]: user

✓ Wrote ~/.cerefox/.env
✓ Validated Supabase connection
✓ Validated OpenAI API key (test embedding succeeded)

Deploy the Cerefox schema now? (creates 8 tables, 30+ RPCs, ~5 sec) [Y/n]: y
✓ Schema deployed

Ingest the Cerefox docs into your knowledge base so you can search them? [Y/n]: y
✓ Ingested 27 documents (README, CHANGELOG, guides, AGENT_GUIDE, …)

Wire up Claude Desktop's MCP config so Claude can read/write Cerefox? [Y/n]: y
✓ Wrote ~/Library/Application Support/Claude/claude_desktop_config.json
  (merged into existing config; backed up to claude_desktop_config.json.pre-cerefox.bak)

Done. Try: cerefox search "what is cerefox"
```

### 4c. Day-to-day use (any directory, just type `cerefox …`)

```bash
cd ~/anywhere
cerefox search "OAuth design"
cerefox ingest ~/Downloads/meeting-notes.md --author "fotis" --author-type "user"
cerefox web                                 # opens web UI
cerefox doctor                              # sanity check
cerefox self-update                         # upgrade in place
```

No more `uv run`, no more `cd /path/to/cerefox` first, no more working-directory dependence.

### 4d. Path C (agent-via-CLI) gets dramatically simpler

Current Claude Desktop config:
```json
{ "mcpServers": { "cerefox": {
  "command": "/opt/homebrew/bin/uv",
  "args": ["--directory", "/Users/fotis/src/cerefox", "run", "cerefox", "mcp"]
}}}
```

After this proposal:
```json
{ "mcpServers": { "cerefox": {
  "command": "cerefox",
  "args": ["mcp"]
}}}
```

Similarly, Path C agent instructions in `CLAUDE.md` / `AGENTS.md` no longer need the user to spell out the cerefox checkout path. The agent just runs `cerefox <subcommand>` like any other CLI tool. The whole "tell the agent where Cerefox lives" preamble in [`connect-agents.md`](../guides/connect-agents.md) Path C goes away.

### 4e. Developers (building from source) — unchanged

Anyone hacking on Cerefox continues with:
```bash
git clone https://github.com/fstamatelopoulos/cerefox.git
cd cerefox
uv sync
uv run cerefox …    # works against the source tree
```

The installer flow is for end users. Both paths coexist. The CONTRIBUTING.md call-out makes this explicit.

---

## 5. Distribution mechanism options

Five reasonable options for getting a `cerefox` binary onto a user's machine. Trade-offs:

| Option | Mechanism | Requires Python? | Update story | Effort to ship | When to use |
|---|---|---|---|---|---|
| **A. `uv tool install`** | Wraps PyPI install in an isolated venv managed by `uv` | Yes (uv installs CPython if missing) | `uv tool upgrade cerefox` | Low — publish to PyPI, that's it | Phase 1 — fastest, modern, matches the project's existing `uv`-centric tooling |
| **B. `pipx install`** | Same isolation as A, slightly older project | Yes (pipx + Python) | `pipx upgrade cerefox` | Low — same PyPI publish | Phase 1 fallback for users who have pipx but not uv |
| **C. Standalone binary via PyInstaller** | Bundle CPython + all deps into a single binary per platform; ship via GitHub Releases | No | New binary download; `cerefox self-update` orchestrates | Medium — CI matrix per platform (darwin-arm64, darwin-x64, linux-x64), test each, sign for macOS Gatekeeper | Phase 2 — for users without Python or who want minimum friction |
| **D. Homebrew tap** | `brew install cerefox` (or `brew tap cerefox/tap && brew install cerefox`) | Yes (via brew formula deps) | `brew upgrade cerefox` | Medium — maintain a formula repo, sync versions on each release | Phase 2/3 — macOS users with strong Brew preference; nice-to-have not critical |
| **E. npm wrapper** | Package wraps a downloaded binary (option C output) and exposes it via `npm install -g cerefox` | No (uses Node.js) | `npm update -g cerefox` | High — npm packaging + binary fetch via postinstall, contrived for a Python tool | **Don't.** Adds Node dependency for what's fundamentally a Python tool. Only worth doing if/when there's a real TS rewrite. |

### Recommended approach

**Phase 1 (low effort, ship in a 1-week iteration):**
- Publish to PyPI as `cerefox` (assuming the name is available — see [§10 Open questions](#10-open-questions)).
- Curl-bash installer that bootstraps `uv` and runs `uv tool install cerefox`.
- Add `pipx install cerefox` as a documented alternative for users who prefer pipx.
- Document `git clone` + `uv sync` as the dev-install path.

**Phase 2 (do after Phase 1 has been used in anger for ~a month):**
- Standalone PyInstaller binaries via GitHub Releases.
- Installer auto-detects: prefers `uv tool install` (faster, lighter, hackable), falls back to standalone binary if user lacks Python.
- Adds Homebrew formula (low effort once PyPI release is automated).

**Phase 3 (deferred indefinitely; only if the TS-port discussion ever expands):**
- npm-native distribution as an option for users in the JS ecosystem.

The Astral pattern (uv, ruff, biome) is the gold standard for Python CLI distribution today; modelling Phase 1 + Phase 2 on it gives users the same UX they're used to from those tools.

---

## 6. Config-state refactor — the actual hard part

**This is the change that unblocks everything else.** Today, `src/cerefox/config.py` does:

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",   # <-- relative to CWD
        ...
    )
```

That binding to the *current working directory* is why `cerefox` only works when you `cd /path/to/cerefox` first. To make `cerefox` callable from anywhere, the `.env` has to live in a stable per-user location.

### Proposed precedence (highest wins)

1. **`CEREFOX_CONFIG_DIR` env var** — explicit override for testing, ephemeral installs, CI.
2. **`./.env`** — if running from a directory that contains one. Preserves the dev-mode UX: contributors hacking on the repo continue to see their repo-local `.env`.
3. **`$XDG_CONFIG_HOME/cerefox/cerefox.env`** — XDG-compliant location. Defaults to `~/.config/cerefox/cerefox.env` on Linux, `~/Library/Application Support/cerefox/cerefox.env` on macOS via XDG fallback. Or simpler: just **`~/.cerefox/.env`** (mirrors what cfcf does with `~/.cfcf/`). The simpler path wins on consistency with the wider AI-CLI ecosystem.
4. **System env vars** — `CEREFOX_SUPABASE_URL=…` already takes precedence over `.env` per pydantic-settings semantics. Unchanged.

### Implementation sketch

```python
def _resolve_config_dir() -> Path:
    if override := os.environ.get("CEREFOX_CONFIG_DIR"):
        return Path(override).expanduser()
    if Path(".env").exists():
        return Path.cwd()
    return Path.home() / ".cerefox"

CONFIG_DIR = _resolve_config_dir()

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(CONFIG_DIR / ".env"),
        ...
    )
```

Two compatibility notes:

- **Existing users keep working.** If someone already has Cerefox checked out and a `.env` in the repo root, behaviour is identical (rule #2 catches it).
- **`cerefox init` writes to `~/.cerefox/.env`.** New end users get the global pattern by default.

### What about backups, logs, models?

cfcf has `~/.cfcf/clio.db`, `~/.cfcf/logs/`, `~/.cfcf/models/`. Cerefox is lighter:

- **Backups** — already configurable via `CEREFOX_BACKUP_DIR` (defaults to `./backups`). Proposal: default changes to `~/.cerefox/backups` for end-user installs. Dev mode (repo-local `.env`) preserves `./backups`.
- **Logs** — Cerefox doesn't emit log files today. If we ever start, `~/.cerefox/logs/` is the right place.
- **No model state** — Cerefox uses cloud embedders; no local model weights to cache.

Bottom line: `~/.cerefox/` becomes the user-state root. Single directory. Easy to back up, easy to nuke for a clean reinstall.

---

## 7. `cerefox init` — interactive bootstrap detail

The flow in [§4b](#4b-interactive-bootstrap-cerefox-init) above is the user-visible version. Implementation notes:

| Step | What it does | Failure mode |
|---|---|---|
| 0. Prerequisite check | If `~/.cerefox/.env` already exists, ask `Overwrite? [y/N]`. Default no. | n/a |
| 1. Supabase URL | Prompts; validates URL format. | Invalid URL → re-prompt with example. |
| 2. Supabase key | Prompts; sniffs for `sb_secret_` vs `eyJ…` prefix; warns if user pasted `sb_publishable_…` (wrong key class). | Wrong key class → error message linking to the Decision Log entry. |
| 3. OpenAI key | Prompts; makes a `text-embedding-3-small` test call to verify. | Auth fail → re-prompt; rate-limit → warn but accept. |
| 4. Postgres URL | Prompts; parses URL; checks for port `5432` (warns if `6543` = Transaction Pooler); checks for `.<project-ref>` in username (warns if missing); attempts `psycopg2.connect()`. | Each gotcha gets a specific error message + a link to `setup-supabase.md#connection-pooling-2026`. |
| 5. Caller identity | Prompts with defaults. Optional. | n/a |
| 6. Write `.env` | Atomically writes to `~/.cerefox/.env` (write to `.env.tmp`, fsync, rename). `chmod 600`. | n/a |
| 7. Schema deploy | Asks before doing it. Runs the equivalent of `python scripts/db_deploy.py`. | DDL failure → print error, leave .env in place. |
| 8. Sample ingest | Asks before doing it. Runs the equivalent of `scripts/sync_docs.py` against the bundled docs (or fetches the latest from GitHub). | Network failure → skip, print "run `cerefox sync-docs` later". |
| 9. MCP wiring | Asks before doing it. Writes `claude_desktop_config.json` (merge, never replace; backup first); also offers `claude mcp add` for Claude Code (`claude mcp add --scope user cerefox cerefox mcp`). | Existing `mcpServers.cerefox` → ask `Update? [y/N]`. |
| 10. Banner | Prints summary + next-steps. | n/a |

Re-running `cerefox init` is idempotent: it re-reads existing config, only prompts for what's missing, and offers to re-do any step explicitly with `cerefox init --step <name>`.

### Why not a TUI?

cfcf is similarly text-prompt-driven. Click already supports `click.prompt`, `click.confirm`, and choice-prompts. A full TUI (textual, rich) is more work for marginal UX gain, and is harder to test. Text prompts are also more reliable in non-TTY contexts (CI, SSH-without-PTY).

---

## 8. `cerefox doctor` — diagnostic

```
$ cerefox doctor
Cerefox v0.1.18 — diagnostic

✓ Binary:        /Users/fotis/.local/bin/cerefox
✓ Config:        ~/.cerefox/.env (mode 0600)
✓ Python:        3.13.5 (managed by uv)
✓ Supabase:      https://xxxx.supabase.co — Data API reachable (auth: sb_secret_…)
✓ Embeddings:    OpenAI text-embedding-3-small — test embedding OK
✓ Database:      Session Pooler @ aws-1-us-east-1.pooler.supabase.com:5432 — DDL-capable
✓ Schema:        8 tables, 32 RPCs (current as of v0.1.18)
⚠ MCP config:    Claude Desktop wired ✓, Claude Code not detected
ℹ Web UI:        not running (start with `cerefox web`)

Run `cerefox configure-mcp --client claude-code` to wire up Claude Code.
```

Implementation: each row is a check that returns `(name, status, detail, hint)`. Status one of `ok`, `warn`, `error`, `info`. Exit code: `0` if all green, `1` if any error.

---

## 9. `cerefox self-update`

Mirrors cfcf's pattern:

```bash
cerefox self-update                 # check + interactive upgrade
cerefox self-update --check         # show latest vs current; do nothing
cerefox self-update --yes           # non-interactive
cerefox self-update --version v0.1.19  # pin
```

Implementation per phase:
- **Phase 1**: thin wrapper around `uv tool install --upgrade cerefox` (or detects `pipx` and uses `pipx upgrade cerefox`). Reports the version transition.
- **Phase 2**: detects install mode (uv-tool vs standalone binary) and chooses the right path. Standalone-binary mode downloads from GitHub Releases, verifies checksum, atomically swaps.

User data in `~/.cerefox/` is never touched.

---

## 10. Open questions

1. **PyPI name availability**: is `cerefox` taken? `pip install cerefox` against the live PyPI shows what's there. If taken, `cerefox-knowledge` / `@cerefox/core` (using PyPI's user-namespace syntax) are fallbacks. **Action**: check before committing to the name.

2. **Version source-of-truth**: `pyproject.toml` says `version = "0.1.0"`. CHANGELOG and the git tag say `v0.1.18`. Whatever the installer ships needs to match. Options: bump `pyproject.toml` on every release (manual, error-prone), or use `hatch-vcs` to derive the version from the git tag. **Recommend hatch-vcs**.

3. **Frontend build artifact**: `cerefox web` serves `frontend/dist/` (a built React SPA). For a PyPI wheel, the build artifacts need to be included in the package. Hatchling supports this via `[tool.hatch.build.targets.wheel] include = ["src/cerefox", "frontend/dist"]`. **Need to verify** the dist is regenerated on each release (pre-publish step in CI).

4. **`cerefox configure-mcp` scope**: the proposal mentions writing Claude Desktop + Claude Code configs. What about Cursor, Codex CLI, opencode, OpenClaw, Hermes? Each has a different config location and format. Probably do the two most common (Claude Desktop + Claude Code) in Phase 1; add others on demand.

5. **Schema deploy from end-user install**: `db_deploy.py` reads `src/cerefox/db/schema.sql` and `rpcs.sql` from the repo. In a PyPI install those files live inside the installed package (`site-packages/cerefox/db/`). The script needs to use `importlib.resources` instead of `Path(__file__).parent.parent / "src"`. Small refactor; flag for the implementation iteration.

6. **macOS Gatekeeper for standalone binaries** (Phase 2 only): unsigned PyInstaller binaries get the "cannot verify developer" warning. Notarization requires an Apple Developer account ($99/year). Phase 2 needs a call on whether we pay for this or document the `xattr -d com.apple.quarantine` workaround.

7. **What does `cerefox` become for *contributors*?** Today a contributor clones, runs `uv sync`, uses `uv run cerefox`. After this proposal, if they *also* have `cerefox` installed globally via `uv tool install`, which one runs when they type `cerefox`? Answer: whichever is first on PATH. The dev-mode rule (`.env` in CWD → use CWD as config dir) means the global `cerefox` still respects a repo-local `.env`. **But** the global `cerefox` uses the installed package code, not the dev tree. Contributors should be told to either (a) `uv run cerefox` from the repo, or (b) use `uv tool install --editable .` if they want a global `cerefox` that points at the local source.

8. **Multi-Cerefox-instances**: some users will want to point one machine at multiple Cerefox knowledge bases (e.g. personal vs work). The `CEREFOX_CONFIG_DIR` override handles this — `CEREFOX_CONFIG_DIR=~/.cerefox-work cerefox search …`. Worth documenting but no code change needed.

9. **Where does `cerefox init` get its starting `.env.example` from?** From `importlib.resources` (bundled in the wheel). Existing `.env.example` in the repo root needs to be re-pathed to inside the package, or duplicated. Trivial.

10. **What about the GPT Actions OpenAPI schema?** Lives in the repo at `docs/guides/connect-agents.md`. Not touched by the install path. End users who want to wire up a Custom GPT still copy the schema by hand — that's a separate doc, not a per-install action.

---

## 11. Phased plan

### Phase 0 — prerequisites (1 iteration)

These are precondition refactors that unblock everything else. Worth doing first regardless of the installer story.

| # | Work | Why |
|---|---|---|
| P0.1 | Switch `Settings` to use `_resolve_config_dir()` per [§6](#6-config-state-refactor--the-actual-hard-part) | Decouples the CLI from working-directory dependence. Backward-compatible. |
| P0.2 | Switch schema-deploy and migration scripts to use `importlib.resources` for SQL files | So they work when the package is installed via PyPI, not just from a source checkout. |
| P0.3 | Switch `pyproject.toml` to derive version from git tag (`hatch-vcs`) | Single source of truth for version across `__version__`, CHANGELOG, git tag, wheel metadata. |
| P0.4 | Pre-build `frontend/dist/` into a release artifact; include in wheel via hatchling config | Web UI works after `uv tool install cerefox`. |

### Phase 1 — the install pipeline (1-2 iterations)

| # | Work | Why |
|---|---|---|
| P1.1 | Publish `cerefox` to PyPI (claim the name; CI publishes on tag) | Enables `uv tool install cerefox` / `pipx install cerefox`. |
| P1.2 | Write `scripts/install.sh` (curl-bash); host as a GitHub Release asset | One-liner install for users without uv. |
| P1.3 | Implement `cerefox init` (interactive bootstrap per [§7](#7-cerefox-init--interactive-bootstrap-detail)) | First-run UX. |
| P1.4 | Implement `cerefox doctor` per [§8](#8-cerefox-doctor--diagnostic) | Sanity check; cited in install banner. |
| P1.5 | Implement `cerefox self-update` per [§9](#9-cerefox-self-update) | In-band update. |
| P1.6 | Implement `cerefox configure-mcp` (Claude Desktop + Claude Code; merge-not-replace; backup) | Path A-Local config without manual JSON editing. |
| P1.7 | Rewrite end-user install docs: new `docs/guides/installing.md` modelled on cfcf's; demote the current quickstart's "uv sync from clone" path to a dev-install section in CONTRIBUTING.md | Two clear audiences with non-overlapping docs. |
| P1.8 | Update `docs/guides/connect-agents.md` Path A-Local / Path C to assume `cerefox` is on PATH | Cleaner config examples; remove the "set the absolute path to /opt/homebrew/bin/uv" macOS gotcha. |

### Phase 2 — broader reach (1 iteration, decoupled from Phase 1)

| # | Work | Why |
|---|---|---|
| P2.1 | PyInstaller / Nuitka binary builds in CI (darwin-arm64, darwin-x64, linux-x64); publish to GitHub Releases | Removes "must have Python" friction. |
| P2.2 | Update `install.sh` to detect Python availability and choose: uv-tool (preferred, hackable) or standalone binary (no Python) | Smart install. |
| P2.3 | `cerefox self-update` learns to swap standalone binaries atomically | Phase-2 install mode gets a working update path. |
| P2.4 | Homebrew formula (`fstamatelopoulos/tap/cerefox`); CI auto-bumps on release | macOS users with Brew muscle memory. |
| P2.5 | macOS notarization decision (pay for signing, or document `xattr -d` workaround) | Tied to P2.1. |

### Phase 3 — deferred indefinitely

Iteration 18 (TS port of `mcp_server.py`) is **independent** of this proposal — they don't block each other. If it ever happens, it just changes the implementation of `cerefox mcp` from a Python process to a Node.js process; the installer story is unchanged. **Not in scope for this proposal.**

A broader "rewrite all Python in TypeScript" is not recommended and explicitly deferred. See [§2](#2-background--what-planmd-already-says).

---

## 12. What this proposal is **not**

- **Not a TypeScript rewrite.** Python stays. Iteration 18 (narrow TS port of one file) remains a separate, independent decision.
- **Not a hosted-Cerefox SaaS proposal.** Users still bring their own Supabase project. The installer makes the local part easy; the cloud part is unchanged.
- **Not a change to the agent-facing protocols.** MCP, Edge Functions, GPT Actions all continue working unchanged. The only thing that changes is *how the local `cerefox mcp` server gets launched* (cleaner config because `cerefox` is on PATH).
- **Not a replacement for the dev install path.** Contributors keep cloning the repo and using `uv sync`. The two paths coexist.
- **Not blocked on cerefox#26** (Supabase Data API role-grants). That's an independent ticket. `cerefox init` would pick up the eventual schema changes automatically because it deploys the latest schema bundled with the installed version.

---

## 13. Decision points needing user input

Before this becomes an actual iteration, the user should weigh in on:

1. **Phase 1 only, or Phase 1 + Phase 2 together?** Phase 1 alone gives 90% of the UX win for ~30% of the effort. Phase 2 is nice but optional.
2. **PyPI package name** — confirm `cerefox` is the right name and check availability. Fallbacks: `cerefox-cli`, `cerefox-knowledge`.
3. **`~/.cerefox/` vs XDG-strict `~/.config/cerefox/`** — both are defensible. `~/.cerefox/` is what cfcf does and what most modern AI CLIs do (Claude Code = `~/.claude/`, Codex = `~/.codex/`, etc.). XDG is more "correct" on Linux. **Recommend `~/.cerefox/`** for consistency with the surrounding ecosystem.
4. **macOS notarization budget** ($99/year Apple Developer Program) — only matters for Phase 2. Phase 1 has no signing requirement because users install Python packages, which macOS doesn't gate.
5. **`cerefox init` defaults** — should the "deploy schema?" and "wire up Claude Desktop?" prompts default to yes (faster onboarding) or no (more cautious)? cfcf's default is "yes with confirmation"; recommend matching.

---

## 14. References

- cfcf installer pattern: `/Users/fotis/src/cfcf/docs/guides/installing.md`, README, `scripts/local-install.sh`.
- Existing Iteration 18 plan: [`docs/plan.md`](../plan.md) line 1626 — "Unify Local MCP Server in TypeScript (Architectural)".
- Existing Iteration 7 packaging notes: [`docs/plan.md`](../plan.md) line 125 — "Packageable, deployable, and shareable" (the original v0.1.0 release goal; this proposal extends that thinking to end-user installs).
- Astral CLI distribution model (uv, ruff): <https://astral.sh/uv/install.sh>, <https://astral.sh/ruff/install.sh>.
- pydantic-settings env-file precedence: <https://docs.pydantic.dev/latest/concepts/pydantic_settings/>.
- Hatchling wheel artifact inclusion: <https://hatch.pypa.io/latest/config/build/#file-selection>.
- `hatch-vcs` for git-tag-derived versions: <https://github.com/ofek/hatch-vcs>.
- PyInstaller cross-platform CI patterns: <https://pyinstaller.org/en/stable/usage.html#supported-platforms>.

---

*Next action*: iterate on this doc in the `research/installer-design` branch. When the design is locked, the implementation breaks into [Phase 0](#phase-0--prerequisites-1-iteration) + [Phase 1](#phase-1--the-install-pipeline-1-2-iterations) as separate iterations in `docs/plan.md`, each filed as its own GitHub ticket.
