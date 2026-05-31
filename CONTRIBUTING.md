# Contributing to Cerefox

Thank you for your interest in contributing to Cerefox! This guide explains what kinds of contributions are most valuable and how to get started.

---

## Where to Start

Check `docs/TODO.md` for the current backlog of ideas and planned features. Pick something that interests you and fits your expertise. If you have a new idea, open an issue to discuss it before starting work.

---

## Contribution Areas

The most valuable contributions fall into these categories:

**AI agent integrations**: extend Cerefox to work with AI agents and runtimes not yet supported. This could mean new MCP transport adapters, new Edge Functions for specific platforms, or documentation for connecting new tools.

**Bug fixes**: if you find a bug, a fix with a test case is always welcome.

**Performance and security improvements**: profiling, query optimization, security hardening, input validation.

**Ingestion formats**: ingestion is Markdown/`.txt`-only as of v0.7 (PDF/DOCX converters were dropped). If you want to support new source formats (e.g., HTML, EPUB, Notion exports, Obsidian vaults), the conversion-to-Markdown step would need to be reintroduced — open an issue to discuss before starting.

**Knowledge system integrations**: two-way sync with knowledge management systems (Obsidian, Logseq, Notion, etc.) is an area with significant potential. If you use Cerefox alongside another knowledge tool, an integration that keeps them in sync would be a meaningful contribution.

**Real-world extensions**: if you extended Cerefox to solve a specific problem in your workflow, consider contributing that extension back. Practical, battle-tested features are the most useful kind.

---

## Architecture Principles

All contributions must follow Cerefox's architecture:

**Single implementation principle**: business logic lives in Postgres RPCs (`src/cerefox/db/rpcs.sql`). Python, Edge Functions, and the MCP server are thin adapters that call RPCs. Do not duplicate logic across access paths.

**Markdown-first**: all content is stored as Markdown documents. Derived structures (embeddings, indexes, metadata) are regenerable from the document corpus.

**Cloud embeddings**: Cerefox uses cloud embedding APIs (OpenAI, Fireworks AI). New embedders must implement the `Embedder` protocol in `src/cerefox/embeddings/base.py` and output 768-dimensional vectors.

See `docs/solution-design.md` and `docs/research/vision.md` for the full architecture and project direction.

---

## Development Setup

Cerefox is a Python + TypeScript project. As of v0.2.0, contributors need **three** runtimes installed locally:

| Tool | Why | Install |
|---|---|---|
| **Python 3.11+** with [`uv`](https://docs.astral.sh/uv/) | Backend, CLI, MCP server, ingestion pipeline | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| **Node 20+** with `npm` | Frontend (React + Vite), Supabase Edge Functions | [nodejs.org](https://nodejs.org/) or `nvm install 20` |
| **[Bun](https://bun.sh) 1.x** | TypeScript scripts (`scripts/*.ts`, starting with `cut_release.ts` in v0.2.0) | `curl -fsSL https://bun.sh/install \| bash` |

The Bun requirement is new in v0.2.0 — see [Script-language policy](#script-language-policy-effective-from-v020) below. From v0.5.0 the local MCP server **and** the main CLI both ship as bins inside the npm package [`@cerefox/memory`](https://www.npmjs.com/package/@cerefox/memory); end users install via `npm`/`bun install -g` and don't need uv or a clone. Contributors still need all three runtimes (Python for the schema deploy + web server + ingestion pipeline until v0.6/v0.7, Node for the frontend + npm publish, Bun for TS scripts and `_shared/`/`packages/memory/` tests).

```bash
# Clone and install
git clone https://github.com/fstamatelopoulos/cerefox.git
cd cerefox
uv sync

# Run tests (`bun test` is the only runner; pytest is retired)
cd _shared && bun test                                  # TS unit tests (mocked)
cd packages/memory && bun run build && bun test         # CLI/MCP smokes + live read/write
cd frontend && bun run test:e2e                         # UI e2e (Playwright)
CEREFOX_LIVE_E2E=1 bun test test/edge-functions test/mcp-remote  # live EF e2e (opt-in)

# Lint and format
uv run ruff check . && uv run ruff format .

# Build frontend
cd frontend && bun install && bun run build

# Run a TypeScript script (Bun)
bun scripts/cut_release.ts --check

# TS unit tests (_shared/) + package tests (CLI/web/MCP smokes + live e2e)
cd _shared && bun test
cd packages/memory && bun run build && bun test

# Edge Function + remote-MCP e2e (TS, ported from pytest in v0.8 — auto-skip
# without Supabase/anon-key; create [E2E-EF]/[E2E-MCP] docs and self-clean)
cd packages/memory && bun test test/edge-functions test/mcp-remote

# UI e2e (Playwright, TS — ported from pytest in v0.8). One-time browser
# install, then run against a `cerefox web` server (auto-started by the config):
cd frontend && bunx playwright install chromium   # ~150 MB, one-time
cd frontend && bun run build && bun run test:e2e
```

---

## SemVer & Deprecation Policy

Cerefox follows [Semantic Versioning](https://semver.org). Until **v1.0.0** the policy is aspirational; from v1.0.0 onward it is binding. The full rationale lives in [`docs/specs/polish-and-distribution-design.md` §11](docs/specs/polish-and-distribution-design.md).

**Under contract** (breaking any of these requires a major version bump from v1.0 onward):

- CLI commands, flags, and exit codes
- CLI environment variables (`CEREFOX_*`)
- MCP tool signatures (names, parameters, return shapes)
- Postgres RPC signatures (`cerefox_*`)
- Edge Function HTTP paths and request/response shapes
- `/api/v1/*` web API paths and shapes
- Database schema (table and column names, types)

**Not under contract** (free to change at minor versions): internal module paths, helper functions, frontend component structure, log message formats, RPC bodies, build/test infrastructure.

**Deprecation cycle**: renames get one minor-version deprecation cycle with both old and new names working; hard removals only at major versions; internal-only changes need no deprecation.

**The "force-move tags only on objective failure" rule**: once a release tag (`vX.Y.Z`) is pushed to origin and a GitHub Release is published, the tag **never moves**. If anything needs fixing after publish — even if you noticed seconds later — ship a new patch version. The single exception is an objective failure of the release pipeline itself (e.g. CI failed mid-release, half the artifacts didn't publish). Reasoning: a moved tag silently invalidates anyone who already fetched it; a new patch version is honest about what changed.

### Client ↔ server compatibility matrix (from v0.8.0)

Cerefox splits into a **client** (the `@cerefox/memory` npm package: CLI, MCP, web) and a **server** (your Supabase project: Postgres schema + RPCs + Edge Functions). They version independently and a user can run a new client against an old server (or vice versa). The client carries a minimum-required-server matrix in [`_shared/compatibility/index.ts`](_shared/compatibility/index.ts):

```ts
export const COMPATIBILITY = {
  minSchema: "0.3.1",         // min deployed Postgres schema version
  minEdgeFunctions: "0.6.0",  // min deployed Edge Function version
};
```

`cerefox doctor` asserts against it (error below-min, warn above-min-but-old), `cerefox web` refuses to bind against a below-min server, and the web `SchemaVersionBanner` shows a red (below-min) or yellow (old-but-ok) banner.

**Bump policy — raise a minimum ONLY when a client release genuinely needs the newer server surface:**

- **Raise `minSchema`** when the client starts depending on a schema/RPC change that an older deployment won't have (new column, new RPC, changed RPC signature). Requires a **minor** client bump.
- **Raise `minEdgeFunctions`** when the client depends on an EF request/response shape that older EFs don't produce. Requires a **minor** client bump.
- **Client patch releases never raise a minimum.** A patch must run against the same server range as the minor it patches.
- Each bump is intentional and reviewed at PR time — don't raise a minimum "just because" the server moved. The minimum is the *oldest server this client still works with*, not *the newest server available*.

Two versions track the server side: the **schema version** (`@version:` marker in `src/cerefox/db/schema.sql`, covers schema + RPCs since they deploy atomically) and **`EF_VERSION`** (`_shared/ef-meta/index.ts`, covers all Edge Functions). `cut_release.ts` bumps `EF_VERSION` only when EF source changed since the last tag; the schema version is bumped by hand when `schema.sql`/`rpcs.sql` change.

---

## Script-Language Policy (effective from v0.2.0)

Cerefox is in a Python → TypeScript strangler-fig migration that runs through the v0.2.0 → v1.0.0 polish-and-distribution arc. The policy:

1. **All new scripts, CLI tools, and installer pieces are written in TypeScript.** Bun-runnable, Node 20+ compatible. New scripts go in `scripts/*.ts`.
2. **Existing Python scripts get migrated when they're extended.** Trivial extension (add a flag, fix a small bug): port to TS first, then make the change. Complex extension (real new functionality): defer the port to its scheduled iteration; do the extension in Python.
3. **Untouched Python scripts stay Python** until their scheduled port. Don't migrate for migration's sake.
4. **Bun is a contributor prerequisite from v0.2.0**, but end users are unaffected (Python install path stays the same until v0.4.0).

When in doubt, open an issue before starting work on a new script. We'll point you at the TS skeleton.

The first concrete artifact under this policy is [`scripts/cut_release.ts`](scripts/cut_release.ts) — the release-cutting script, shipped with v0.2.0. v0.3.0 ports `scripts/sync_docs.ts` and `scripts/db_status.ts` (both extended in that release).

Full reasoning in [`docs/specs/polish-and-distribution-design.md` §12f](docs/specs/polish-and-distribution-design.md).

### `_shared/` — cross-context TypeScript modules

Starting in v0.3.0, TS code that's consumed by more than one entry point (scripts, the local TS MCP server, the upcoming TS CLI in v0.5.0) lives in [`_shared/`](_shared/) at the repo root:

```
_shared/
  config/      env resolver, dotenv loader (TS mirror of src/cerefox/paths.py)
  db-client/   thin @supabase/supabase-js wrapper with zod-typed responses
  db-status/   reusable schema-introspection (used by db_status.ts; v0.5's
               `cerefox doctor` will import the same module)
  embeddings/  OpenAI / Fireworks embedding helpers (extracted from EFs)
  mcp-tools/   the 10 MCP tool handlers, shared by the remote Edge Function
               and the local @cerefox/memory server
  __tests__/   Bun tests — run `cd _shared && bun test`
```

It's at the repo root (not under `src/`) so it doesn't tangle with hatchling's Python wheel build or pytest discovery. As of v0.4.0 it is part of an npm workspace alongside `packages/memory/`. The directory will grow with `ingest/` (v0.7+).

### `packages/memory/` — the `@cerefox/memory` npm package

The local MCP server bin **and** (from v0.5+) the main `cerefox` CLI bin both live in [`packages/memory/`](packages/memory/). Same npm package, two bins, growing surface:

```
packages/memory/
  src/
    meta.ts                       PKG_VERSION constant — single source of truth in the bundle
    server.ts                     buildServer() factory — wires _shared/mcp-tools/ into the MCP SDK
    bin/cerefox.ts                the package's bin — top-level error handler + commander dispatch
    cli/
      program.ts                  commander program assembly; one registerXyz() per subcommand
      commands/                   28 subcommand files (including `mcp` which runs buildServer())
      util/                       checks (doctor/status), mcp-config-writers, bundled-docs, client, embed
  test/
    stdio-smoke.test.ts           spawn `cerefox mcp` and walk an MCP handshake
    cli-smoke.test.ts             --version / --help / --help-grouping / bare entry
    read-commands.test.ts         live tests (skip if Supabase unreachable)
    write-commands.test.ts        live tests (creates + cleans up [E2E v0.5-test] docs)
    lifecycle-commands.test.ts    doctor / status / configure-agent / self-update
  README.md                       npm landing card — refreshed each release
  package.json                    name: @cerefox/memory, bin: {cerefox}, type: module
```

Build: `bun run build` (from `packages/memory/`) → `dist/bin/cerefox.js` (single-file ESM). The MCP server is `cerefox mcp`; v0.4–v0.5.0 shipped a separate `cerefox-mcp` bin, dropped in v0.5.1 as redundant.

Doc bundling: `scripts/bundle_package_docs.ts` (invoked by `prepublishOnly`) copies the curated `docs/guides/`, `AGENT_GUIDE.md`, and `AGENT_QUICK_REFERENCE.md` into the package tree before `npm publish`. The bundled copies are gitignored — source of truth stays at the repo root.

Publish is driven by `.github/workflows/release.yml` with OIDC trusted publishing; the maintainer triggers it via `bun scripts/cut_release.ts X.Y.Z --npm-publish`.

Because `_shared/mcp-tools/*.ts` is imported by both Edge Functions (Deno) and this package (Node/Bun), the shared modules use structural typing rather than concrete `SupabaseClient` types — same logic, two runtimes, one source.

### Release workflow

The normal release flow for v0.3.0+ is:

1. PRs land on `main` without touching `VERSION`. `VERSION` sits at the last released value (e.g. `0.5.1` at the time of writing) while you accumulate changes.
2. When ready to cut, fill in the `## [Unreleased]` section of `CHANGELOG.md` with the release notes.
3. From `main`, on a clean tree:
   ```bash
   bun scripts/cut_release.ts 0.3.0
   ```
   The script bumps `VERSION` as part of the `chore: cut v0.3.0` commit, promotes `[Unreleased]` to `[v0.3.0]`, tags, pushes, and creates the GitHub Release.

**Exception**: v0.2.0 itself pre-bumped `VERSION` on the feature branch because the VERSION-file mechanism was the v0.2.0 deliverable — there was no other way to demonstrate that `cerefox --version` worked. From v0.3.0 onward, leave `VERSION` alone in feature branches.

If something needs fixing after a tag is published, **cut a new patch version**. `cut_release.ts` refuses to overwrite an existing tag — see the SemVer & Deprecation Policy section above and Cerefox Decision Log Q2 Part 2.

### Continuous integration

`.github/workflows/ci.yml` runs on every PR targeting `main` and on every direct push to `main`. Two parallel jobs:

| Job | What runs |
|---|---|
| **TS — `_shared/` unit tests** | `bun install` from the repo root (hoists workspace deps), then `cd _shared && bun test`. |
| **TS — `@cerefox/memory` build + smoke** | Builds `dist/bin/cerefox.js`, verifies the three smoke invocations (`--version`, `--help`, `mcp --help`), checks the `cerefox_get_help` bundle stays in sync with `AGENT_QUICK_REFERENCE.md`, runs the package's tests (cli-smoke always; stdio-smoke + live read/write/lifecycle tests auto-skip when Supabase isn't reachable — same probe pattern). |

PRs must pass these jobs before merge. Cold-cache wall clock is ~60-90 seconds. Live e2e tests (`CEREFOX_LIVE_E2E=1 bun test test/edge-functions test/mcp-remote`, `scripts/check_ef_parity.ts`) need Supabase credentials and are run manually by the maintainer before each cut — see `docs/research/v0.7-manual-test-plan.md` (the rolling test plan that spans v0.5 → v0.7).

**Lint enforcement** (`ruff check` + `ruff format --check`) is intentionally NOT in CI yet — `main` carries ~28 pre-existing warnings + ~28 files that would be reformatted, accumulated before lint was wired up. Adding it now would block every PR until that debt is cleaned. That cleanup deserves its own focused PR; once it lands, the ruff steps will be added to `ci.yml`.

---

## Git Workflow

1. **Fork** the repository and create a feature branch from `main`
2. Make your changes with clear, focused commits
3. Write tests for new functionality
4. Open a PR against `main`

**Commit messages**: imperative mood ("Add", "Fix", "Update"), first line under 72 chars, body explains *why* not *what*. One logical change per commit.

**PR conventions**: short title (under 70 chars), body with summary bullets and test plan checklist. Squash and merge by default.

---

## Code Style

- **Formatter/linter**: ruff (line length 100)
- **Type hints**: required on all public functions
- **Tests**: new code is TypeScript; add tests alongside it in `packages/memory/test/` or `_shared/__tests__/` (`bun test`)
- **Imports**: lazy-import heavy dependencies inside functions
