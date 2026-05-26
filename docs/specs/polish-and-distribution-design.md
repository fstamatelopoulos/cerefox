# Cerefox: Polish & Distribution Design

**Status**: design-of-record. **Aspirational** snapshot from 2026-05-24, kept verbatim as the architectural record. As the arc is executed iteration-by-iteration, individual decisions get refined based on what we learn. **For the current, executed design, read `docs/plan.md`** — its per-iteration sections are the live source of truth.

---

## Living design notes — refinements vs. this doc

Captured here so a reader who arrives at this doc cold isn't misled by an
outdated bullet. Each item links to the plan.md section that holds the
current definitive version. The body of this design doc is **not edited**
to apply these refinements; they're tracked here at the top, the way an
errata sheet sits at the front of a printed book.

| Refinement | Original design says | Current plan says | Where to read more |
|---|---|---|---|
| **Single npm package vs. multi-package workspace** | "Open Question 2" (§17) flagged this as an open question, with a recommendation to start single-package in v0.4 and evaluate workspaces in v0.6 | **Locked: single package, `@cerefox/memory`, contains everything (CLI + MCP server + web server + ingestion).** §13's per-iteration entries referencing `packages/cli/`, `packages/web-server/`, `packages/ingestion/` are all replaced by directories *inside* `packages/memory/src/`. Internal layout, single npm publish unit, single `cerefox` binary with subcommands. Mirrors cfcf's `@cerefox/codefactory` shape. | `docs/plan.md` § Iteration 22 (refinement #7), § Iteration 23 (v0.5.0), § Iteration 24 (v0.6.0), § Iteration 25 (v0.7.0) |
| **First npm publish naming** | v0.4 ships `@cerefox/mcp-local`; v0.5 introduces `@cerefox/memory` "superseding" it (rename + abandoned package on npm) | v0.4 ships `@cerefox/memory` directly with only the `cerefox-mcp` bin. v0.5 adds the `cerefox` CLI bin to the same package. No rename, no orphan. | `docs/plan.md` § Iteration 22 refinement #7 |
| **`cut_release.ts` + npm publish coupling** | Implied integrated ("CI picks up tag → builds → publishes to npm") | Decoupled. `--npm-publish` flag (default `false`) triggers a separate GitHub Actions workflow via `gh workflow run`. Two confirmation surfaces. | `docs/plan.md` § Iteration 22 refinement #8 + 22F |
| **Python `cerefox mcp` after v0.4** | "shells out to `npx @cerefox/mcp-local` (transitional)" — hard shell-out | Soft wrapper: tries `npx @cerefox/memory cerefox-mcp`, falls back to legacy Python `mcp_server.py` with a stderr nudge if npm/Bun isn't installed. No hard break of existing configs. | `docs/plan.md` § Iteration 22 refinement #1, 22E |
| **`cerefox configure-agent` in v0.4** | Listed as a v0.4 task | Deferred to v0.5 (the command doesn't exist yet; it's CLI work). v0.4 ships `docs/guides/migration-v0.4.md` instead. | `docs/plan.md` § Iteration 22 refinement #2 |
| **`cerefox_get_help` content shape** | Curated subset of `AGENT_QUICK_REFERENCE.md` | Inline the whole file (73 lines — small enough). Topic param filters by H2 heading. | `docs/plan.md` § Iteration 22 refinement #3 |
| **Hard-removal of `mcp_server.py`** | Implicit ("Python deprecated v0.8, removed v0.9") | The shim policy that emerged in v0.3.0 applies here too: kept indefinitely as a fallback. No "to be removed in v0.X.0" promises. | `docs/plan.md` § Iteration 22 refinement #6 |
| **Hard-removal of `sync_docs.py` / `db_status.py` shims** | v0.4.0 in v0.3.0's CHANGELOG | **Not scheduled.** Walked back to "indefinite migration aid". | `docs/plan.md` § Iteration 20 → 20C.7 + Deferred section |
| **`.env` resolution precedence** | Implicit (every section assumes `~/.cerefox/.env`) | **Defensive for v0.x line**: `CEREFOX_CONFIG_DIR` env → `./.env` (dev mode wins) → `~/.cerefox/.env`. v1.0 revisit committed to flip toward installed-CLI-default. | `docs/plan.md` § Iteration 20 → "v1.0 revisit" + Decision Log Q2 Part 2 |
| **`@cerefox` npm org creation** | Listed as a v0.4 prereq | Org already exists (publishes `@cerefox/codefactory` for cfcf) — no creation step needed. | `docs/plan.md` § Iteration 22 "Manual prerequisites" |
| **PostgREST RPC introspection** | Not in design | Helper RPC `cerefox_pg_function_exists` (v0.3.0). v0.3.1 hardened: never probe write-side RPCs by side-effect; introspection-only. | Decision Log entries: 2026-05-26 v0.3.0 "Lesson 1"; 2026-05-26 v0.3.1 "never probe write-side RPCs" |

When a section of this doc is contradicted by `docs/plan.md`, **plan.md wins**.

---

**Last updated**: 2026-05-24 — major revision: strategic shift to a full TypeScript/Bun migration of the local Python components via a strangler-fig pattern, collapsing the existing Iteration 18 (TS port of just the MCP server) into a larger migration arc that ships as v0.2.0 through v1.0.0.

**Goal**: Turn Cerefox from a "clone the repo, `uv sync`, run from inside the repo" project into a polished OSS product with a one-liner npm install, a globally-available `cerefox` command, a frictionless first-run UX, a single TypeScript/Bun runtime for all local components, and a strict SemVer commitment from v1.0 onward. Take inspiration from cfcf's npm-based installer pattern. Land the TypeScript migration incrementally so every release ships real user value, not just "we moved languages."

**Non-goals**: hosted Cerefox SaaS. Changes to the agent-facing protocols (MCP, Edge Functions, GPT Actions stay unchanged). A Postgres-or-SQL rewrite. A web UI rewrite (already TypeScript). Multi-tenancy or auth model changes.

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

That works, and it's what every dev install needs anyway. But for end users — especially the AI-agent ecosystem audience that Cerefox actually targets — every one of these steps is a barrier. The current pattern also has four structural awkwardnesses that compound:

| Awkwardness | What's broken | Why it matters |
|---|---|---|
| **Working-directory dependence** | Every `cerefox` invocation must be from the repo root, because `Settings()` reads `.env` from the working directory. | Users have to `cd` first, or remember `--directory` in scripts. Agent MCP configs spell out absolute paths. |
| **No global install path** | The CLI is callable only via `uv run` inside the project venv. | Users write wrapper aliases. Scripts hardcode `cd /path/to/cerefox && uv run cerefox …`. |
| **No interactive bootstrap** | `.env` setup is documented, not automated. Schema deploy is a separate manual step. | "First successful search" requires ~15 minutes of doc-reading and copy-pasting. cfcf gets to "it works" in under 5. |
| **Language mismatch with the ecosystem** | Local components (CLI, MCP server, web server, ingestion) are Python. The agent ecosystem (Claude Code, Cursor, Codex CLI, opencode, OpenClaw, MCP servers in the wild) is overwhelmingly TypeScript/Node. Users install `pip` packages occasionally; they install `npm` packages daily. | Friction asymmetry. Python install conflicts (multiple Python versions, virtualenv confusion) hit users that don't otherwise touch Python. |

Solving the first three gives Cerefox the same install UX as cfcf, uv, ruff, and the Astral CLI ecosystem. Solving the fourth aligns Cerefox with where its users actually live — and makes `npm install -g @cerefox/memory` the canonical install command.

---

## 2. Reference: how cfcf does it

cfcf (`/Users/fotis/src/cfcf`, currently `v0.17.0` on npm) is the model the user pointed at. Concrete patterns we copy:

1. **One-line install** via `install.sh` that bootstraps the runtime (Bun) if missing, then installs the package.
2. **Direct install for users who already have the runtime**: `npm install -g @cerefox/<package>`.
3. **State lives in `~/.cfcf/`**, not the install directory. Install/upgrade never touches it.
4. **Interactive `cfcf init`** — detects what's already configured, asks targeted questions, validates as it goes.
5. **`cfcf doctor`** — diagnostic; first thing the install banner recommends.
6. **`cfcf self-update`** — wraps the underlying package manager; supports both npm and tarball-from-GitHub sources; user data untouched.
7. **Per-platform native deps** via separate npm packages, dependencies on the main one.
8. **Dev vs end-user split in docs** — one page for "install Cerefox to use it", a separate page for "build Cerefox from source".

The whole pattern translates 1:1.

---

## 3. Target user experience

After landing this proposal:

### 3a. First-time install (end user, never run Cerefox before)

```bash
# One line. No prereqs beyond curl + a shell.
curl -fsSL https://github.com/fstamatelopoulos/cerefox/releases/latest/download/install.sh | sh
```

The script:
1. Detects `bun` on PATH; bootstraps via `curl -fsSL https://bun.sh/install | bash` if missing.
2. Runs `bun install -g @cerefox/memory` (or `npm install -g @cerefox/memory` as fallback).
3. Prints a banner:
   ```
   ✓ Cerefox v0.5.0 installed at ~/.bun/bin/cerefox

   Next steps:
     1. cerefox init               # interactive setup (Supabase, OpenAI, schema deploy)
     2. cerefox doctor             # verify everything works
     3. cerefox web                # launch the web UI at http://127.0.0.1:8000/app/

   Connect AI agents: cerefox configure-agent --tool claude-code
   Update later:      cerefox self-update
   ```

### 3b. Interactive bootstrap (`cerefox init`)

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
  Use port 5432 (Session), not 6543 (Transaction — doesn't support DDL).
  Username must include .<project-ref> suffix.
  CEREFOX_DATABASE_URL: postgresql://postgres.xxx:…@…:5432/postgres?sslmode=require

▶ Step 5/5 — Caller identity (optional; default "unknown")
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

Wire up Claude Code's MCP config so Claude can read/write Cerefox? [Y/n]: y
✓ Wrote ~/.claude/mcp.json
  (merged into existing config; backed up to mcp.json.pre-cerefox.bak)

Done. Try: cerefox search "what is cerefox"
```

### 3c. Day-to-day use (any directory, just type `cerefox …`)

```bash
cd ~/anywhere
cerefox search "OAuth design"
cerefox ingest ~/Downloads/meeting-notes.md --author "fotis" --author-type "user"
cerefox web                                 # opens web UI
cerefox doctor                              # sanity check
cerefox self-update                         # upgrade in place
```

No more `uv run`, no more `cd /path/to/cerefox` first, no more working-directory dependence, no more Python in the install path.

### 3d. Agent integration paths get dramatically simpler

**Path A (MCP)** — Claude Code config today:
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

Generated automatically by `cerefox configure-agent --tool claude-code` (or `--tool cursor` / `--tool codex` / etc.).

**Path C (agent-via-CLI)** — instructions in `CLAUDE.md` / `AGENTS.md` no longer need the user to spell out the cerefox checkout path. The agent just runs `cerefox <subcommand>` like any other CLI tool.

### 3e. Developers (building from source)

```bash
git clone https://github.com/fstamatelopoulos/cerefox.git
cd cerefox
bun install
bun run dev          # runs the local CLI against the source tree
```

The end-user install path and the dev path coexist. CONTRIBUTING.md spells out the difference.

---

## 4. Strategic shift: Python → TypeScript migration

This is the largest single decision in this design. It supersedes the previous Iteration 18 plan (narrow TS port of just the MCP server) with a broader migration arc.

### 4a. Why migrate now

| Factor | Why it matters now |
|---|---|
| **Ecosystem fit** | Cerefox lives in the AI-agent ecosystem (Claude Code, Cursor, Codex CLI, opencode, OpenClaw, MCP itself). All TS/Node. Python is the data-science ecosystem; TS is the agent-tooling ecosystem. Cerefox is in the wrong one for its actual users. |
| **Half the codebase is already TS** | Web UI (React + TS), Edge Functions (9 of them in TS), `cerefox-mcp` Edge Function in TS. The Python local components duplicate logic that already exists in TS. |
| **Distribution friction** | PyPI publish + `uv tool install` works but is alien to the agent-ecosystem audience. `npm install -g` is the universal pattern. |
| **Single source of truth for client logic** | Today: `db/client.py` (Python) and Edge Function clients (TS) duplicate validation, formatting, error handling. After: one TS implementation. |
| **MCP cloud-registration future** | When Anthropic's MCP Registry / hosted-MCP story matures, Cerefox needs to ship a registerable TS MCP server. Having the local AND cloud MCP both in TS makes this trivial — one codebase, two transports. |

### 4b. What stays as-is

| Component | Status |
|---|---|
| Database schema (`schema.sql`, `rpcs.sql`, `migrations/*.sql`) | **Stays SQL.** Language-agnostic. Business logic lives here. |
| Edge Functions (`supabase/functions/*`) | **Already TS.** No change needed (continues to be the cloud-side canonical MCP). |
| Web UI (`frontend/`) | **Already React + TS.** Polished further in v0.5.0. |

The "single source of truth" argument is partly already true: **Postgres RPCs are the canonical behavior layer**. Both Python `client.py` and TS Edge Function tool handlers are thin wrappers around them. The migration removes the language asymmetry of the wrappers; the RPCs already hold the truth.

### 4c. What migrates Python → TypeScript

| Current Python | TS replacement | Migration notes |
|---|---|---|
| `cli.py` (Click) | TS CLI via `commander` or `oclif`; runs on Bun | Click-to-Commander port is mechanical; ~15 subcommands |
| `mcp_server.py` (stdio MCP) | TS stdio MCP via `@modelcontextprotocol/sdk`; shares tool handlers with `cerefox-mcp` Edge Function | Tool handler code already exists in TS in the Edge Function — extract to a `_shared/` module |
| `api/app.py`, `api/routes_api.py` (FastAPI) | Hono (preferred) or Fastify on Bun | 30+ endpoints; route-by-route port |
| `db/client.py` (Supabase Python client) | `@supabase/supabase-js` v2 | Already used heavily in Edge Functions; mature |
| `ingestion/pipeline.py` | TS equivalent | Orchestration logic; ~500 lines |
| `chunking/markdown.py` (heading-aware splitter) | TS port | Pure logic, no library dep; carefully unit-tested |
| `embeddings/cloud.py` (OpenAI/Fireworks) | OpenAI Node SDK / fetch | Equivalent |
| `backup/fs_backup.py` | TS equivalent | Small; FS + git ops |
| `scripts/db_deploy.py`, `scripts/db_migrate.py` | TS equivalents using `postgres` (porsager/postgres) or `pg` | SQL file loading via `Bun.file()` or `fs`; pg driver well-established |
| `scripts/sync_docs.py`, `scripts/reindex_all.py`, `scripts/backup_*.py` | TS equivalents | Orchestration scripts |
| `tests/` (483 unit + 80 e2e in pytest) | `vitest` (unit) + `vitest` or native test runner (integration) + Playwright (web UI e2e) | Rewrite, not port; idioms differ |
| `pyproject.toml` | `package.json` | Replace, with hatch-equivalent build via Bun bundler / tsup / unbuild |

### 4d. What gets dropped

- **PDF ingestion** (`chunking/converters.py:pdf_to_markdown`). Reason: `pypdf` has no good TS equivalent — TS PDF text-extraction libs are weaker, especially on multi-column / scanned / complex layouts. **The maintainer has never used this path.** Cerefox is markdown-first; users (human or agent) convert to markdown upstream. Dropping simplifies the migration and aligns the codebase with the actual usage pattern. Document in CHANGELOG as a removal in v0.7.0.
- **DOCX ingestion** (`chunking/converters.py:docx_to_markdown`). Either drop (same reasoning as PDF — never used) or port to `mammoth` (good TS equivalent). **Default: drop**; revisit if a real user surfaces a need.
- **`pydantic-settings`** — replaced by zod-based config schema with `.env` loader.
- **`Click`** — replaced by `commander` or `oclif`.

### 4e. Strangler-fig vs Big Bang

Considered four migration framings:

| Framing | Description | Choice |
|---|---|---|
| A. Polish-then-migrate | Ship full v0.2-v0.6 polish on Python, then start TS rewrite as v0.7+ | Rejected — ~40% of polish work gets re-done in TS; PyPI distribution becomes throwaway. |
| **B. Polish-while-migrating (strangler-fig)** | Each v0.x release migrates one Python component to TS while shipping real polish for that component. Iteration 18 becomes v0.4.0. CLI = v0.5. Web server = v0.6. Ingestion = v0.7. Python removed by v0.9. | **Chosen.** No throwaway work; every release ships real user value AND moves toward destination; lets us validate the npm/bun model on a small component first. |
| C. Polish-on-Python-only | Ship polished v1.0 on Python. No TS migration. | Rejected — ecosystem mismatch persists permanently; same migration question would surface later with even more code to move. |
| D. Migrate-first | 4-8 week head-down TS rewrite (parity only), then polish | Rejected — too long with zero user-visible improvement; brand risk for an active OSS project. |

### 4f. The previous "Iteration 18" dissolves into this

The pre-existing Iteration 18 (Python → TS port of just `mcp_server.py`) is **absorbed into v0.4.0** of this plan. Its motivation (dedup MCP tool handler drift between Python and TS) was correct but too narrow — it solved one symptom of a broader language-fit problem. **Plan.md's Iteration 18 entry is replaced by the v0.4.0 entry in §13 below.**

### 4g. The "back-out" criterion

If at any point during the migration (v0.4 through v0.7), we discover the TS migration costs are exceeding our estimates by >2x, the back-out plan is:
- Keep the migrated components (whatever has shipped works).
- Halt further migration.
- Continue polishing the remaining Python components.
- Document the partial migration as the new steady state.

The strangler-fig pattern makes this safe: every shipped TS component works independently of the unmigrated Python components, communicating via Postgres RPCs and the web API.

---

## 5. Architecture after migration

### 5a. Language summary

| Layer | Language | Runtime | Reason |
|---|---|---|---|
| Database | SQL | Postgres / Supabase | Behavior canon |
| Cloud Edge Functions | TypeScript | Deno (Supabase) | Already TS |
| Local MCP server | TypeScript | Bun (preferred) / Node | Shares tool handlers with Edge Function |
| Local CLI | TypeScript | Bun (preferred) / Node | Agent-ecosystem native |
| Local web server | TypeScript | Bun (preferred) / Node | Same runtime as CLI |
| Local ingestion pipeline | TypeScript | Bun (preferred) / Node | Same runtime as CLI |
| Web UI | TypeScript + React | Browser | Already TS |

Only Postgres SQL and the JS/TS ecosystem. Two languages total, one of which is universal infrastructure.

### 5b. Runtime: Bun-first, Node-compatible

- **Bun-first**: installer prefers Bun (`curl -fsSL https://bun.sh/install | bash`), default `cerefox` shebang is `#!/usr/bin/env bun`.
- **Node-compatible**: published as standard ESM npm package. Works with `node` 20+ if the user prefers. CI tests both runtimes.
- **Why Bun-first**: faster cold start (matters for CLI), faster install (single binary, no separate `npm`), better TS-out-of-the-box, cleaner shell scripting via `Bun.$`. cfcf's experience with Bun has been positive.
- **Bun risks**: ~5-10% of npm packages have Bun-incompatibility quirks. We route around them or fall back to Node when needed. No package selection should be Bun-only without a Node-compatible fallback.

### 5c. Shared schema / types across boundaries

- Single `_shared/schemas/` module with zod schemas for every JSON shape that crosses any boundary (CLI ↔ web server, web UI ↔ web API, MCP tool params, Edge Function bodies).
- Type-derived: `type DocumentVersionInfo = z.infer<typeof DocumentVersionInfoSchema>`.
- Used by all four current TS contexts (Edge Functions, local MCP, local CLI, local web server) and the web UI.

### 5d. Build / bundling

- **Library code** (`_shared/`, `_lib/`) — published as ESM with type declarations via `tsup` or Bun's built-in bundler.
- **Binary** (the `cerefox` CLI entry point) — bundled as a single executable JS file with shebang. Bun supports `bun build --compile` for actual native binaries; that's Phase 2.
- **Frontend `dist/`** — built via existing Vite pipeline; bundled into the npm package via `files` in package.json. No change to web UI build.

---

## 6. Distribution

### 6a. npm under `@cerefox` org

The `@cerefox` npm org already exists (currently hosts `@cerefox/codefactory`). We add:

| Package | Purpose |
|---|---|
| `@cerefox/memory` | Main package — `cerefox` CLI binary, local MCP server, local web server, ingestion pipeline. Depends on `@supabase/supabase-js`, `zod`, etc. |
| `@cerefox/mcp-local` (optional split) | If we want a smaller install for users who only want the MCP server. Decided in v0.4.0 — likely **not** split; cleaner to ship everything in `@cerefox/memory`. |
| `cerefox` (unscoped, if available) | Thin alias package that re-exports `@cerefox/memory`. So `npm install -g cerefox` works for users who don't think in scopes. **Open question:** check `npm view cerefox` for availability. |

### 6b. Install paths

| Path | Command |
|---|---|
| One-liner | `curl -fsSL https://github.com/fstamatelopoulos/cerefox/releases/latest/download/install.sh \| sh` |
| Direct (Bun) | `bun install -g @cerefox/memory` |
| Direct (npm) | `npm install -g @cerefox/memory` |
| Direct (yarn) | `yarn global add @cerefox/memory` |
| Direct (pnpm) | `pnpm add -g @cerefox/memory` |

### 6c. `cerefox self-update`

```bash
cerefox self-update                 # check + interactive upgrade
cerefox self-update --check         # show latest vs current; do nothing
cerefox self-update --yes           # non-interactive
cerefox self-update --version 0.6.0 # pin
```

Implementation: detects install path (which `npm` / `bun` / `yarn` / `pnpm` actually installed it), wraps the corresponding update command, reports the version transition. User data in `~/.cerefox/` untouched.

### 6d. Phase 2: standalone binaries

When/if we ship platform-native binaries (no Bun/Node runtime needed):

- `bun build --compile` produces single-file binaries for darwin-arm64, darwin-x64, linux-x64, linux-arm64, win-x64.
- Distributed via GitHub Releases.
- macOS notarization decision deferred until binaries are actually shipping (costs $99/year Apple Developer Program; alternative is documenting the `xattr -d com.apple.quarantine` workaround).
- Optional Homebrew tap (`fstamatelopoulos/tap/cerefox`) once binaries exist.

Not in scope for the v0.2 → v1.0 arc. Open as Phase 2 work after v1.0.

---

## 7. Config & state

### 7a. `~/.cerefox/` as user state root

```
~/.cerefox/
  .env             # CEREFOX_* env vars; chmod 600
  backups/         # cerefox backup output (configurable via CEREFOX_BACKUP_DIR)
  logs/            # reserved for future use
  cache/           # reserved for future use
  docs/            # bundled docs copy, refreshed on every self-update
```

Single directory. Easy to back up. Easy to nuke for clean reinstall. No conflict with the project repo (which keeps its own `.env` for dev mode).

### 7b. `resolveConfigDir()` precedence

Same logic as the existing design, now in TS:

```typescript
function resolveConfigDir(): string {
  if (process.env.CEREFOX_CONFIG_DIR) {
    return expandHome(process.env.CEREFOX_CONFIG_DIR);
  }
  if (existsSync(".env")) {
    return process.cwd();  // dev mode — repo-local .env wins
  }
  return path.join(homedir(), ".cerefox");
}
```

Highest wins. Backward-compatible for users with an existing repo-local `.env`.

### 7c. Multi-instance support

`CEREFOX_CONFIG_DIR=~/.cerefox-work cerefox search "…"` — point one machine at multiple Cerefox knowledge bases (personal vs work). Free with the resolver above.

### 7d. Schema files via package resources

Bun: `Bun.file(import.meta.dir + "/db/schema.sql")`. Node: `fs.readFileSync(path.join(__dirname, "db", "schema.sql"))`. Schema files bundled in the npm package via `files` in package.json. No more "script reads from `src/cerefox/db/`" assumption.

---

## 8. CLI UX polish

### 8a. Command surface (unchanged from Python)

Strict SemVer means we preserve every existing CLI command/flag through the migration. The TS version is a parity port at the user-facing layer:

- `cerefox search`, `cerefox get-doc`, `cerefox list-docs`, `cerefox list-versions`, `cerefox list-projects`, `cerefox metadata-search`, `cerefox get-audit-log` (reads)
- `cerefox ingest`, `cerefox ingest-dir`, `cerefox delete-doc` (writes)
- `cerefox web`, `cerefox mcp` (servers)
- `cerefox init`, `cerefox doctor`, `cerefox status`, `cerefox configure-agent`, `cerefox self-update`, `cerefox docs` (lifecycle)
- `cerefox backup`, `cerefox restore`, `cerefox reindex`, `cerefox sync-docs` (operations)

All existing flags preserved (including the v0.1.18 long-form / short-form alias pattern). All env vars (`CEREFOX_*`) preserved.

### 8b. New polish items

- **Tab completion** for bash, zsh, fish (commander/oclif both support natively).
- **Subcommand grouping** in `--help` (today flat).
- **`--json` mode uniformly** on all read commands.
- **Documented exit codes** (0 success, 1 user error, 2 system error, 3 not-found).
- **Progress bars** for long ops (`ingest-dir`, `reindex`, `sync-docs`) via `ora` or `cli-progress`.
- **Better error messages**: every error includes "try `cerefox X`" hint or doc link.
- **`cerefox` (no args)** — friendly entry point that detects state and suggests next action.

### 8c. `cerefox doctor`

```
$ cerefox doctor
Cerefox v0.5.0 — diagnostic

✓ Binary:        /Users/fotis/.bun/bin/cerefox
✓ Runtime:       Bun 1.x.x
✓ Config:        ~/.cerefox/.env (mode 0600)
✓ Supabase:      https://xxxx.supabase.co — Data API reachable (auth: sb_secret_…)
✓ Embeddings:    OpenAI text-embedding-3-small — test embedding OK
✓ Database:      Session Pooler @ aws-1-us-east-1.pooler.supabase.com:5432 — DDL-capable
✓ Schema:        8 tables, 32 RPCs (current as of v0.5.0)
⚠ MCP config:    Claude Code wired ✓, Cursor not detected
ℹ Web UI:        not running (start with `cerefox web`)

Run `cerefox configure-agent --tool cursor` to wire up Cursor.
```

Per-row check returns `{name, status, detail, hint}`. Exit code 0 if all green, 1 if any error.

### 8d. `cerefox configure-agent`

Single command for every agent tool:

```bash
cerefox configure-agent --tool claude-code     # writes ~/.claude/mcp.json
cerefox configure-agent --tool claude-desktop  # writes platform-specific Claude Desktop config
cerefox configure-agent --tool cursor          # writes Cursor's mcp.json
cerefox configure-agent --tool codex           # writes ~/.codex/config.toml
cerefox configure-agent --tool opencode        # writes opencode's MCP config
cerefox configure-agent --tool openclaw        # writes OpenClaw's MCP config
cerefox configure-agent --tool gemini          # writes ~/.gemini/settings.json
```

Phase 1 (v0.4): Claude Code + Claude Desktop. Phase 2 (v0.5+): Cursor + Codex. Phase 3 (when surfaced): others. Each backs up existing config before merging; never replaces wholesale.

---

## 9. Web UI polish

| Item | Notes |
|---|---|
| **Version in footer** (small, link to GitHub Release) | First-class visibility — fixes the "no version surface anywhere" problem |
| **`/app/about`** page — version, build SHA, Cerefox doc count, last DB write | Health at a glance |
| **`/app/help`** page — renders bundled markdown (quickstart, AGENT_GUIDE, troubleshooting) offline | No round-trip through Supabase; works with empty KB |
| **`/app/settings`** page — toggle usage tracking, set requestor identity, view config (today CLI-only) | Self-service for non-CLI users |
| **First-run empty state** — when `cerefox_documents` is empty, show getting-started panel (link to `cerefox init` instructions, sample queries) | Today the empty state is just empty |
| **Schema-version-mismatch banner** — when bundled schema is newer than deployed | Catches the "forgot to run `db_deploy`" footgun (the v0.1.19 lesson) |

---

## 10. Documentation strategy

### 10a. Three audiences

| Audience | Lives in | Consumed via |
|---|---|---|
| **End users** (install + use Cerefox) | `docs/guides/` | GitHub repo, bundled in npm package, web UI `/app/help` page, `cerefox docs` CLI |
| **Agent authors** (writing agents that use Cerefox) | `AGENT_GUIDE.md`, `AGENT_QUICK_REFERENCE.md` | Same channels + `cerefox docs --agent` shortcut |
| **Contributors** (hacking on Cerefox source) | `CONTRIBUTING.md`, `CLAUDE.md`, `docs/research/*` | GitHub repo only (not bundled) |

### 10b. Bundled-in-package

`@cerefox/memory` package includes `docs/guides/` and `AGENT_GUIDE.md` as data files. The installer puts a copy under `~/.cerefox/docs/` on install and refreshes on every `cerefox self-update`. Three benefits:

1. `cerefox docs` opens local docs in browser — works offline.
2. Web UI `/app/help` page renders these directly — no Supabase needed.
3. Docs match the installed version exactly — no "I'm reading docs for v0.5 but running v0.4" confusion.

### 10c. `cerefox.org` website (Phase 3, free)

User owns `cerefox.org`. When ready (post-v1.0), set up:
- GitHub Pages on `cerefox.org` serving mkdocs-material (or similar) built from `docs/guides/`.
- Same content as bundled docs, but indexable by Google and shareable as URLs.
- Auto-rebuilt on every release tag.

Cost: $0 (domain is owned; GitHub Pages is free; mkdocs-material is free). Effort: ~1 iteration, deferred until after v1.0.

### 10d. The MCP discoverability gap (and the three-pronged response)

**The gap**: Agent-facing docs (`AGENT_GUIDE.md`, `AGENT_QUICK_REFERENCE.md`) live in the repo. Today only agents with filesystem access can read them — Path A-Local (Claude Code, Codex CLI running locally on a Cerefox checkout) and Path C (Bash agents with the repo cloned). And even those agents only find the docs if `CLAUDE.md` / `AGENTS.md` points to them.

**Agents connected via remote MCP, hosted MCP, or GPT Actions have no way to discover Cerefox's own usage conventions.** They call MCP tools using whatever conventions they were last trained on. When agent-trained conventions diverge from Cerefox's recommendations — e.g. writing `[Text](<Title With Spaces>)` instead of `[Text](document-uuid)` for cross-references — there's no discoverable correction path. The user finds out only when something breaks visibly.

This is a real architectural gap, surfaced when an agent populated a Cerefox doc with title-based links that broke silently in the web UI (see the v0.1.19 agent-guidance refinement entry in `CHANGELOG.md`). The bug was easy to diagnose once observed, but the agent that wrote it had no way of knowing the convention.

**The response is three-layered, defence in depth**:

#### Layer 1 — Tactical / operational (today, zero code)

The deployment owner ingests `AGENT_GUIDE.md` and `AGENT_QUICK_REFERENCE.md` into their own Cerefox under a dedicated project (e.g., `_cerefox-self-docs`) with conventional metadata (`{"type":"agent-guide","source":"cerefox-self-docs"}`). Any agent connected via MCP can then `cerefox_search "writing linkable content"` and find the guidance, same as any other doc. This costs nothing, requires no code change, and works today. Disadvantage: every deployment owner has to do this manually; new versions of the guidance don't auto-propagate.

#### Layer 2 — Automatic self-doc ingest in `cerefox init` (v0.5.0)

`cerefox init` already (in the design) offers to ingest Cerefox's own docs as one of the optional setup steps. **Promote this from optional to automatic and unconditional**: every `cerefox init` ingests the bundled `AGENT_GUIDE.md`, `AGENT_QUICK_REFERENCE.md`, and a curated subset of `docs/guides/` under a dedicated project `_cerefox-self-docs` with consistent metadata. The user is informed but not asked.

Add `cerefox sync-self-docs` as a maintenance command: re-runs the ingest using the docs bundled with the currently-installed version. Called automatically as the final step of `cerefox self-update` so the docs stay in sync with the code.

Project name starts with `_` so user-facing project listings can filter it out by default (with a `--include-system` flag for the curious). Metadata tag `{"type":"agent-guide","source":"cerefox-self-docs","version":"<release>"}` so agents can disambiguate "Cerefox's official guidance" from user-authored notes that happen to mention agent patterns.

Advantage over Layer 1: every Cerefox deployment automatically has searchable agent guidance from day one. Updates flow through `self-update`. Cross-deployment-owner consistency.

Disadvantage: requires the deployment owner to have run `cerefox init` (or its v0.5 equivalent). For Cerefox deployments where MCP is configured but `init` was never run — possible with `cerefox-mcp` Edge Function alone — Layer 2 doesn't help.

#### Layer 3 — `cerefox_get_help` MCP tool (v0.4.0)

A new MCP tool: `cerefox_get_help` (or `cerefox_about`) that returns a curated subset of `AGENT_QUICK_REFERENCE.md` content as a single tool response. Frozen at Edge Function deploy time; refreshed when the Edge Function is redeployed.

| Aspect | Detail |
|---|---|
| Tool surface | `cerefox_get_help(topic?: string)` — optional topic ("links", "updates", "metadata", etc.) returns the relevant section; no topic returns the index |
| Content source | Bundled at Edge Function build time from the canonical `AGENT_QUICK_REFERENCE.md` in the repo. CI step verifies it's in sync on every deploy |
| Cognitive cost | One additional MCP tool in the agent's tool list. Justified because the tool name is itself the hint — agents see `cerefox_get_help` and may call it speculatively when uncertain |
| Update path | Redeploy `cerefox-mcp` Edge Function on every release that changes agent guidance — same cadence as the underlying tool surface itself |

**This is the answer for hosted / remote / Edge-Function-only deployments** where Layers 1 and 2 are unavailable. Always-available, always-current with the deployed Edge Function, zero deployment-owner setup.

#### Why all three (not just one)

| Layer | Effort | When does it help? |
|---|---|---|
| 1. Manual ingest | Zero code; ~1 minute operational | Now, this deployment, until v0.5 ships |
| 2. Auto-ingest in init | v0.5 task | Every fresh deployment from v0.5 forward |
| 3. `cerefox_get_help` MCP tool | v0.4 task | Every deployment with `cerefox-mcp` Edge Function deployed, regardless of CLI setup; survives "user never ran init" |

Each layer covers a population the others miss. Together they ensure agent guidance is discoverable through every supported access path.

---

## 11. SemVer & deprecation policy

### 11a. What's under contract

Going forward, breaking any of these requires a **major version bump**:

| Surface | Examples of breaking |
|---|---|
| **CLI commands & flags** | Removing or renaming `cerefox search`, `--match-count`, `--project-name`, etc. |
| **CLI env vars** | Renaming `CEREFOX_SUPABASE_KEY`, changing accepted values. |
| **CLI exit codes** | Changing the exit code returned for a given condition. |
| **MCP tool signatures** | Renaming tools, removing parameters, changing parameter types, changing return shapes. |
| **Postgres RPC signatures** | Renaming `cerefox_*` RPCs, changing parameter signatures, changing return shapes. |
| **Edge Function HTTP API** | Changing URL paths or request/response JSON shapes. |
| **Web API** (`/api/v1/*`) | Changing paths under `/api/v1` or JSON shapes. (The `v1` prefix already telegraphs this.) |
| **Database schema** | Renaming or removing table/column names; type changes. |

**Not under contract** (free to change at minor versions): internal module paths, helper functions, frontend component structure, log message formats, RPC bodies (only signatures), build/test infrastructure.

### 11b. Deprecation cycle

```
Soft removal (the default for renames):
  v0.X.0:  introduce the new name; old name still works; emit deprecation warning
  v0.X+1.0 or v1.X+1.0:  remove the old name
  
Hard removal (immediate, no deprecation cycle):
  Only at major version bumps (v0.x → v1.0, v1.x → v2.0).
  Listed in the CHANGELOG migration guide for that major.

Silent removal (no deprecation):
  Internal-only surface (not under contract).
  Always allowed at minor versions.
```

### 11c. v1.0.0 trigger

v1.0 ships **after**:
1. All polish items in §13 v0.2-v0.9 shipped.
2. TS migration complete (no Python in the active code paths).
3. ~2-3 months of v0.9 in the wild without breaking changes.
4. At least one outside user has installed and used Cerefox without help.

v1.0 is the release where we commit contractually to strict SemVer going forward. Before v1.0, the policy is aspirational; after v1.0, it's binding.

---

## 12. Release process (PDLC)

### 12a. `VERSION` file at repo root

Plain text, one line, e.g. `0.2.0`. **Single source of truth** for the project version.

| Surface | How it gets the version |
|---|---|
| `package.json` | Read at build time by the release script |
| `cerefox --version` | Imported from `_lib/version.ts` (generated from `VERSION`) |
| Web UI footer | `<Version>` component reads from compile-time-injected env var |
| `cerefox doctor` "Cerefox v0.X.Y — diagnostic" line | Same as `--version` |
| Git tag | Created by `scripts/cut-release.ts` to match `VERSION` |
| GitHub Release | Created by CI when the matching tag is pushed |
| npm package | `package.json` version (synced from `VERSION` at build time) |

Fixing today's `cerefox --version` saying `0.1.0` (eight tags behind reality) is a v0.2.0 task and the easiest "we're starting" signal.

### 12b. `scripts/cut-release.ts`

```bash
bun scripts/cut-release.ts 0.3.0           # bump VERSION, update CHANGELOG, tag, push, create GitHub Release
bun scripts/cut-release.ts 0.3.0 --dry-run # show what would happen
bun scripts/cut-release.ts --check         # show what the next bump should be
```

**Written in TypeScript from v0.2.0** (per the script-language policy in §12f). Bun-runnable. This is the first piece of TS we own outside the existing TS surfaces (Edge Functions, frontend) — chosen deliberately to set the direction.

Steps:
1. Verify clean working tree, on `main`, up to date with origin.
2. Verify CHANGELOG `[Unreleased]` section has content.
3. Update `VERSION` file to the new version.
4. Sync `pyproject.toml` version from `VERSION` (and `package.json` once it exists in v0.4+).
5. Move `[Unreleased]` heading to `[vX.Y.Z] -- <today>` in CHANGELOG.
6. Add a fresh empty `[Unreleased]` section.
7. Commit: `chore: cut vX.Y.Z`.
8. Tag annotated: `vX.Y.Z` with the CHANGELOG section as the tag message.
9. Push commit + tag to origin.
10. **Create GitHub Release** via `gh release create vX.Y.Z --notes-file <extracted-changelog-section>`. (Today's release process skips this step — `gh release list` returns empty. v0.2.0 closes that gap.)
11. (Future, v0.5+) CI picks up tag → builds → publishes to npm.

### 12c. CI: trusted publishing on tag

GitHub Actions workflow on `v*` tag push:
1. Checkout, install Bun, install deps.
2. Run unit + e2e tests.
3. Build frontend dist.
4. `bun publish --access public` (uses GitHub OIDC trusted publishing — no npm token in repo).
5. Create GitHub Release with CHANGELOG excerpt and checksum of the npm tarball.

### 12d. Pre-release channel

`bun scripts/cut-release.ts 0.5.0-rc.1` cuts a release candidate. Published as `@cerefox/memory@0.5.0-rc.1` (not on the `latest` tag, only on `next`). Users opt in with `bun install -g @cerefox/memory@next`. Used for risky changes (e.g., the v0.7.0 ingestion migration).

### 12e. Project hygiene files (one-time, v0.2.0)

- `.github/ISSUE_TEMPLATE/bug.yml`, `feature.yml`, `install-problem.yml`, `question.yml`
- `.github/pull_request_template.md`
- `SECURITY.md` (how to report security issues responsibly)
- `CODE_OF_CONDUCT.md` (Contributor Covenant boilerplate)
- `.github/FUNDING.yml` (empty placeholder; can be filled later)
- `CONTRIBUTING.md` updated with SemVer policy, dev-install path, and the script-language policy (§12f)

### 12f. Script-language policy (effective from v0.2.0)

A direct consequence of the strangler-fig migration framing: **TypeScript becomes the preferred language for all new CLI tooling, scripts, and installation surfaces from v0.2.0 onward**, even while the bulk of the local codebase is still Python. The rule:

1. **All new scripts, CLI tools, and installer pieces are written in TypeScript.** Bun-runnable, Node 20+ compatible. Reduces migration debt by default; every new artifact is born on the destination side.
2. **Existing Python scripts get migrated when they're extended.**
   - *Trivial extensions* (add a flag, change a default, fix a small bug): port to TS first, then make the change.
   - *Complex extensions* (real new functionality, restructure): defer the port to its scheduled iteration (v0.5 for CLI-invoked scripts, v0.7 for the remaining ops scripts); do the extension in Python.
3. **Untouched Python scripts stay Python.** Don't migrate for migration's sake. The point is to amortise migration into work you're already doing, not to create busywork.
4. **Bun becomes a contributor prerequisite from v0.2.0.** End users are unaffected (no install changes for them until v0.4); contributors add one line to their dev-setup (`curl -fsSL https://bun.sh/install | bash`). Documented in `CONTRIBUTING.md`.

**Application to the v0.2 → v1.0 arc**:

| Script | Status in v0.2.0 | Migration | Reason |
|---|---|---|---|
| `cut_release` (new) | Born TS | n/a | New artifact — policy rule 1 |
| `scripts/sync_docs.py` | Python | Port in v0.3 | Extended in v0.3 for bundled-docs work — policy rule 2 |
| `scripts/db_status.py` | Python | Port in v0.3 | Becomes basis for `cerefox doctor` prototype in v0.3; later extended fully in v0.5 |
| `scripts/db_deploy.py` | Python | Port in v0.5 | TS CLI's `cerefox init` needs to call schema-deploy logic |
| `scripts/db_migrate.py` | Python | Port in v0.5 | TS CLI's `cerefox init` needs migration logic |
| `scripts/reindex_all.py` | Python | Port in v0.7 | TS ingestion pipeline lands then; reindex is part of that |
| `scripts/backup_create.py` / `backup_restore.py` | Python | Port in v0.7 | Both relate to ingestion / chunk handling; port alongside |

**Why this matters beyond mechanics**: it's a consistency signal. From v0.2.0 a contributor opening a PR with a new Python script gets reviewed-out and pointed at the TS-first rule. By v0.5 the muscle memory is established. By v0.7 the codebase is mostly TS. By v0.9 Python is gone. The policy makes the migration feel like a steady current rather than a periodic Big Push.

---

## 13. Phased plan (v0.2 → v1.0)

Each phase ships as its own minor version with a tight, defensible scope. Numbered iterations in `docs/plan.md` follow this sequence.

### v0.2.0 — "Real Release" (~1-2 weeks)

**Theme**: foundations + first TS artifact. Version source-of-truth, OSS hygiene, and the project's first piece of TypeScript outside the existing TS surfaces — `scripts/cut_release.ts` (per §12f). Bun becomes a contributor prereq; end users unaffected (no install-path changes for them until v0.4). No migration of EXISTING Python code yet (that starts in v0.3 with the script ports). Backward-compatible at every user-facing surface.

| # | Item |
|---|---|
| 1 | `VERSION` file at repo root (`0.2.0`) |
| 2 | `pyproject.toml` reads version from `VERSION` (build hook) |
| 3 | `cerefox.__version__` reads from `VERSION` |
| 4 | `cerefox --version` shows the real version |
| 5 | Web UI footer shows version (small text, link to GitHub Release) |
| 6 | `scripts/cut_release.ts` — **written in TS** (Bun-runnable). Includes the new `gh release create` step that today's release process skips |
| 7 | Bun added as contributor prerequisite — bootstrap line documented in CONTRIBUTING.md |
| 8 | `.github/ISSUE_TEMPLATE/`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, PR template, `.github/FUNDING.yml` (empty) |
| 9 | SemVer + deprecation policy + **script-language policy (§12f)** added to `CONTRIBUTING.md` |
| 10 | This design doc moved from `research/` to `specs/` (now "design-of-record") |

**Tests / risk**: trivial. Version reading is a 5-line change per surface. Hygiene files are templated. The cut-release script is the only meaningful new code; test by using it to cut v0.2.0 itself.

### v0.3.0 — "Install Anywhere" (~3-4 weeks)

**Theme**: config-state refactor + working-directory independence. Mostly still Python at the CLI/MCP/web-server level, but the **first two scripts migrate to TS** (per §12f script-language policy — they're touched here, so they port now).

| # | Item |
|---|---|
| 1 | `_resolve_config_dir()` precedence: `CEREFOX_CONFIG_DIR` → `./.env` → `~/.cerefox/.env` |
| 2 | `~/.cerefox/` becomes user state root (.env, backups default move here) |
| 3 | `importlib.resources` for SQL files (so `db_deploy.py` works from any directory; still Python) |
| 4 | Frontend `dist/` bundled into wheel via hatchling config |
| 5 | `cerefox docs` opens bundled docs in browser (still Python CLI calling out to the OS browser) |
| 6 | Web UI `/app/help` page renders bundled docs (no Supabase dependency) |
| 7 | Schema-version-mismatch banner in web UI |
| 8 | **`scripts/sync_docs.ts`** replaces `scripts/sync_docs.py`. Extended here for bundled-docs work; ported instead of extended-in-Python. Python script removed in same commit |
| 9 | **`scripts/db_status.ts`** replaces `scripts/db_status.py`. Refactored into a reusable TS module under `_shared/db-status/` so the v0.5 `cerefox doctor` command imports the same logic. Python script removed |
| 10 | `_shared/` directory created (TS-only, ESM, zod schemas) — the first piece of the cross-context shared code that will grow through v0.4-v0.7 |
| 11 | Update CONTRIBUTING.md: confirm Bun prerequisite + document the `_shared/` layout |
| 12 | Update `docs/guides/ops-scripts.md` to document the new TS scripts; mark the remaining Python scripts as "will be ported in v0.5/v0.7" |

**Tests / risk**: medium. Touches config loading; test coverage for the precedence rules; backward-compat tests for existing dev installs with repo-local `.env`. New: vitest test suite for the two TS scripts; parity-test that `sync_docs.ts` ingests the same docs the Python version would have.

### v0.4.0 — "TS MCP Server" (~3-4 weeks) — supersedes old Iteration 18

**Theme**: first **runtime component** migrated from Python to TS. The `cerefox mcp` local server becomes a TS Bun script. (Scripts were ported earlier: `cut_release.ts` in v0.2.0; `sync_docs.ts` + `db_status.ts` in v0.3.0.) Shares tool handlers with the existing `cerefox-mcp` Edge Function via a new `_shared/` directory.

| # | Item |
|---|---|
| 1 | Set up `_shared/` npm workspace structure (tool handlers, validation schemas, response formatters) |
| 2 | Extract Edge Function `cerefox-mcp/tools/*.ts` into `_shared/mcp-tools/` |
| 3 | New `packages/mcp-local/` — TS stdio MCP server using `@modelcontextprotocol/sdk` + `_shared/mcp-tools/` |
| 4 | Publish `@cerefox/mcp-local` to npm |
| 5 | Update `cerefox` Python CLI: `cerefox mcp` now shells out to `npx @cerefox/mcp-local` (transitional) |
| 6 | Update `cerefox configure-agent`: writes MCP configs that invoke `npx @cerefox/mcp-local` directly |
| 7 | Documented "Bun is preferred runtime" path; Node 20+ fallback works |
| 8 | Migration guide: existing MCP configs pointing at `uv run cerefox mcp` continue to work; users encouraged to migrate |
| 9 | **New MCP tool: `cerefox_get_help(topic?)`** — returns a curated subset of `AGENT_QUICK_REFERENCE.md` as a tool response. Layer 3 of the MCP discoverability response (§10d). Bundled at Edge Function build time; CI verifies in-sync with `AGENT_QUICK_REFERENCE.md`. Added to both the local TS MCP server and `cerefox-mcp` Edge Function (shared via `_shared/`). Documented as the canonical agent self-help surface |

**Tests / risk**: medium-high. New runtime; new package on npm; existing MCP users need a migration path that doesn't break their setup mid-flight. Both transports (existing Python + new TS) work in parallel during the transition. The new help tool adds one to the MCP tool count (8 → 9); update CLAUDE.md and AGENT_QUICK_REFERENCE.md.

### v0.5.0 — "TS CLI" (~4-6 weeks)

**Theme**: The CLI itself becomes TS. `@cerefox/memory` ships with the `cerefox` binary. Python CLI deprecated but still functional.

| # | Item |
|---|---|
| 1 | New TS CLI in `packages/cli/` using commander.js, all 15+ subcommands ported |
| 2 | Shares `_shared/db-client/` (TS Supabase wrapper) with MCP server |
| 3 | `cerefox init`, `cerefox doctor`, `cerefox status`, `cerefox self-update` (new commands) |
| 4 | Tab completion (bash, zsh, fish) generated |
| 5 | `--json` mode uniformly on all read commands |
| 6 | Documented exit codes |
| 7 | Progress bars on `ingest-dir`, `reindex`, `sync-docs` |
| 8 | `@cerefox/memory` published to npm (includes CLI binary + MCP server, supersedes `@cerefox/mcp-local`) |
| 9 | `install.sh` one-liner published to GitHub Releases |
| 10 | Web UI `/app/about` and `/app/settings` pages |
| 11 | Python CLI deprecated: prints a banner on every invocation pointing at `bun install -g @cerefox/memory` |
| 12 | New `docs/guides/installing.md` (npm-native); old quickstart moved to CONTRIBUTING.md |
| 13 | **`cerefox init` automatic self-doc ingest** (Layer 2 of the MCP discoverability response, §10d). `init` unconditionally ingests bundled `AGENT_GUIDE.md`, `AGENT_QUICK_REFERENCE.md`, and curated `docs/guides/` under a dedicated project `_cerefox-self-docs` with metadata `{"type":"agent-guide","source":"cerefox-self-docs","version":"<release>"}`. User is informed (not asked). Project name prefix `_` makes it filterable in user-facing project listings |
| 14 | **`cerefox sync-self-docs` command** — re-runs the ingest with the docs from the currently-installed version. Called automatically as the final step of `cerefox self-update` so docs stay in sync with code on every upgrade |
| 15 | Web UI project filter: hide `_`-prefixed projects by default; `--include-system` toggle for the curious |

**Tests / risk**: high. Largest single migration; broadest surface area; visible to every user. Vitest test suite covers parity with the pytest suite. Self-doc ingest tested by snapshot — assert the expected set of documents lands under `_cerefox-self-docs` with correct metadata after `cerefox init` runs against a fresh KB.

### v0.6.0 — "TS Web Server" (~4 weeks)

**Theme**: The local web server (currently FastAPI) becomes TS. Web UI unchanged (already TS). `cerefox web` launches a Bun-based Hono server.

| # | Item |
|---|---|
| 1 | New TS web server in `packages/web-server/` using Hono |
| 2 | All `/api/v1/*` endpoints ported with response-shape parity |
| 3 | E2E tests against the new server pass the same suite |
| 4 | `cerefox web` (TS) replaces `cerefox web` (Python) |
| 5 | Web UI footer now shows TS-server version (was Python-server version) |
| 6 | First-run UX in web UI: empty-state getting-started panel |

**Tests / risk**: medium. Web API is well-tested via e2e suite; port maintains JSON shape contracts.

### v0.7.0 — "TS Ingestion Pipeline" (~6 weeks)

**Theme**: The last and largest Python component — chunking, embedding orchestration, version snapshotting — moves to TS. PDF and DOCX support **dropped** (never used; out of scope for TS port).

| # | Item |
|---|---|
| 1 | New TS chunking module in `packages/ingestion/chunking/` — port of `markdown.py` heading-aware splitter |
| 2 | New TS embedding orchestration using OpenAI Node SDK |
| 3 | New TS ingestion pipeline (`packages/ingestion/`) calling the `cerefox_ingest_document` RPC |
| 4 | PDF/DOCX support **dropped**; CHANGELOG announces removal |
| 5 | `cerefox ingest` and `cerefox ingest-dir` now use TS pipeline |
| 6 | `scripts/sync_docs.ts` replaces `scripts/sync_docs.py` |
| 7 | `scripts/reindex_all.ts` replaces `scripts/reindex_all.py` |
| 8 | Backup/restore TS scripts |

**Tests / risk**: high. Chunking parity is critical — must produce byte-identical chunks for the same input as the Python version (or document any intentional changes). E2E suite validates against the live DB.

### v0.8.0 — "Deprecate Python" (~2 weeks)

**Theme**: All user-visible flows now run TS. Python kept for one minor version under `python-legacy/` as a fallback.

| # | Item |
|---|---|
| 1 | All Python entry points print prominent deprecation banner |
| 2 | Python code moved to `python-legacy/` subdirectory in repo |
| 3 | `docs/guides/installing.md` removes Python install instructions |
| 4 | CONTRIBUTING.md's "Building from source" section uses Bun, not uv |
| 5 | `pyproject.toml` marked as legacy in its description |
| 6 | Final Python release (`cerefox-py` on PyPI?) — open question whether we ever publish to PyPI at all |

### v0.9.0 — "Python Removal" (~1 week)

**Theme**: Repo is pure TS + SQL + React. Python gone.

| # | Item |
|---|---|
| 1 | `python-legacy/` deleted |
| 2 | `pyproject.toml`, `uv.lock`, `.python-version` deleted |
| 3 | Single `package.json` at repo root (or workspaces structure) |
| 4 | CI runs only on Bun + Node |
| 5 | All tests in vitest |
| 6 | Decision log entry summarising the migration |

### v1.0.0 — "Stability Commitment" (when ready)

**Theme**: Not a feature release. The contract release.

| Item | Notes |
|---|---|
| Strict SemVer enforced going forward | The policy in §11 becomes binding |
| All "under contract" surfaces frozen except via deprecation cycle | No more "we'll just rename this flag, who's using it anyway" |
| Release cadence commitment | e.g., "monthly minor releases, patches as needed" |
| README updated for "production-ready" framing | New badges, new positioning |
| Migration guide for v0.9 → v1.0 (likely no breaking changes; just the contract starting) | Reassures existing users |

**Trigger**: ~2-3 months of v0.9 in the wild + at least one outside user installing without help.

---

## 14. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Bun-incompatible npm package surfaces mid-migration | Medium | Low | Always have a Node-compatible fallback; CI tests both |
| TS chunking parity bugs (chunks differ from Python's output for the same input) | High | Medium | Snapshot tests against Python's output before migration; document any intentional changes in v0.7 CHANGELOG |
| MCP client compatibility regression (config still pointing at old Python entry point) | Medium | Medium | v0.4-v0.5 keeps Python entry points working in parallel; deprecation banner |
| Migration effort exceeds estimates by >2x | Medium | High | §4g back-out plan: halt migration, ship what we have, continue polish on remaining Python |
| Lose data through migration testing on live Supabase | Low | High | All e2e tests use `[E2E]`-prefixed cleanup pattern; never run untested migrations on real KB |
| User churn from "yet another rewrite" perception | Low | Low | Strangler-fig means every release ships real user value, not "we're rewriting"; CHANGELOG framing matters |
| PyPI never published — users who expected a Python package | Low | Low | Document explicitly in installing.md that Cerefox is npm-distributed; provide migration path |

---

## 15. Paid options summary

(Full analysis archived in Cerefox internal note `Cerefox Polish: Cost Options Analysis`.)

**$0 to ship v0.2 through v1.0.** The only recurring cost on the horizon is the Apple Developer Program ($99/year) for Phase 2 standalone macOS binaries — that decision is deferred until binaries are actually shipping (post-v1.0).

| Option | Cost | When | Decision |
|---|---|---|---|
| Apple Developer Program | $99/year recurring | Phase 2 standalone binaries | Defer until binaries ship |
| GitHub Pages on cerefox.org | $0 (domain owned) | Phase 3, post-v1.0 | When ready |
| GitHub Sponsors | $0 to enable | Whenever | Free hygiene |
| PyPI organization | $0 | If we ever publish a Python alias | Free; do once if needed |
| Supabase Pro ($25/mo) | Recurring | If we outgrow free tier | Not relevant; nowhere near limits |

---

## 16. Future direction (out of scope for this plan)

### 16a. MCP cloud registration

When Anthropic's MCP Registry / hosted-MCP story matures, Cerefox is well-positioned: `cerefox-mcp` Edge Function is already stateless, HTTP-based, RPC-backed — the canonical shape for a hosted MCP server. Polish work should preserve this:
- Keep the Edge Function thin (validate → call RPC → return).
- Keep auth swappable (Bearer JWT today → potentially OAuth or per-tenant tokens later).
- Keep RPCs the only place business logic lives.

### 16b. `cerefox.org` site

User owns the domain. GitHub Pages + mkdocs-material is the obvious free path. Defer until post-v1.0.

### 16c. Multi-tenancy

Cerefox is single-user today. The audit-log governance work (Iteration 15+) was deliberately designed to be multi-tenant-ready, but no actual multi-tenancy is implemented. Out of scope.

### 16d. Local embeddings / on-device models

Cloud embeddings only today. Out of scope; revisit if a strong privacy-first user surfaces a real need.

---

## 17. Open questions

1. **Unscoped `cerefox` npm name availability** — need to `npm view cerefox` before committing. If taken, fall back to `@cerefox/memory` being the canonical install name.
2. **Workspaces structure** — single `package.json` with internal directory layout, OR npm workspaces with `packages/cli`, `packages/mcp-local`, `packages/web-server`, `packages/ingestion`, `packages/shared`. Workspaces are cleaner for large projects but heavier setup. **Recommend**: start single-package in v0.4, evaluate workspaces in v0.6 if the codebase justifies it.
3. **Edge Function shared code** — Edge Functions run on Deno; local TS runs on Bun. They can share TS source but the import maps and runtime APIs differ. Test the shared-code strategy in v0.4 before committing to it broadly.
4. **CI cost** — Bun + Node matrix + Playwright for web UI e2e + live Supabase for backend e2e. GitHub Actions free tier should be enough; monitor.
5. **PyPI placeholder** — do we publish anything to PyPI ever, even just a redirect package that prints "Cerefox is now distributed via npm: `npm install -g @cerefox/memory`"? Probably yes (low effort, helps Python users who guess `pip install cerefox`). Decide in v0.5.
6. **DOCX in TS** — do we port DOCX support via `mammoth` in v0.7, or drop entirely? Default is drop; revisit if a real user surfaces a need.

---

## 18. What this is **not**

- **Not a Supabase replacement.** Postgres + Edge Functions stay.
- **Not a web UI rewrite.** React + TS stays unchanged.
- **Not a hosted Cerefox SaaS.** Users still bring their own Supabase project.
- **Not a change to the agent-facing protocols.** MCP tool signatures, Edge Function HTTP shapes, GPT Actions OpenAPI — all preserved (per the SemVer policy).
- **Not a Big Bang.** Strangler-fig: every release ships real user value; back-out is always available (§4g).
- **Not blocked on anything.** Iteration 18 (the old narrow-MCP-port plan) collapses into v0.4. cerefox#26 (Supabase role-grants) is independent. cerefox#36 (installer) IS this plan.

---

## 19. References

- cfcf installer pattern: `/Users/fotis/src/cfcf/docs/guides/installing.md`, README, `scripts/local-install.sh`.
- Bun: <https://bun.sh>.
- `@modelcontextprotocol/sdk`: <https://github.com/modelcontextprotocol/typescript-sdk>.
- Commander.js: <https://github.com/tj/commander.js>.
- Hono: <https://hono.dev>.
- supabase-js: <https://github.com/supabase/supabase-js>.
- npm trusted publishing via GitHub OIDC: <https://docs.npmjs.com/trusted-publishers>.
- Astral CLI distribution model (uv, ruff): <https://astral.sh/uv/install.sh>.
- Cerefox internal: `Cerefox Polish: Cost Options Analysis` (Cerefox project, ID `d4c3df92-4305-42eb-861e-3112450d684b`).

---

*Next action*: this design doc is the design-of-record. Implementation breaks into v0.2.0 + subsequent iterations in `docs/plan.md`. When v0.2.0 is locked, file each item as a GitHub issue and start implementation.
