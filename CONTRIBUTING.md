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

**Ingestion formats**: new document converters (e.g., HTML, EPUB, Notion exports, Obsidian vaults). Converters live in `src/cerefox/chunking/converters.py` and take a file path, returning a Markdown string.

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

# Run tests
uv run pytest                     # unit tests
uv run pytest -m e2e              # API e2e (needs live Supabase)
uv run pytest -m ui               # UI e2e (needs running app + Playwright)

# Lint and format
uv run ruff check . && uv run ruff format .

# Build frontend
cd frontend && npm install && npm run build

# Run a TypeScript script (Bun)
bun scripts/cut_release.ts --check

# TS unit tests (_shared/mcp-tools, _shared/db-status, etc.)
cd _shared && bun test

# Build and smoke-test the local MCP server (npm package)
cd packages/memory && bun run build && bun test
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

1. PRs land on `main` without touching `VERSION`. `VERSION` sits at the last released value (e.g. `0.2.0`) while you accumulate changes.
2. When ready to cut, fill in the `## [Unreleased]` section of `CHANGELOG.md` with the release notes.
3. From `main`, on a clean tree:
   ```bash
   bun scripts/cut_release.ts 0.3.0
   ```
   The script bumps `VERSION` as part of the `chore: cut v0.3.0` commit, promotes `[Unreleased]` to `[v0.3.0]`, tags, pushes, and creates the GitHub Release.

**Exception**: v0.2.0 itself pre-bumped `VERSION` on the feature branch because the VERSION-file mechanism was the v0.2.0 deliverable — there was no other way to demonstrate that `cerefox --version` worked. From v0.3.0 onward, leave `VERSION` alone in feature branches.

If something needs fixing after a tag is published, **cut a new patch version**. `cut_release.ts` refuses to overwrite an existing tag — see the SemVer & Deprecation Policy section above and Cerefox Decision Log Q2 Part 2.

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
- **Tests**: every new module in `src/cerefox/` gets corresponding tests in `tests/`
- **Imports**: lazy-import heavy dependencies inside functions
