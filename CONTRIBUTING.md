# Contributing to Cerefox

Thank you for your interest in contributing to Cerefox! This guide explains what kinds of contributions are most valuable and how to get started.

---

## Where to Start

Check the [GitHub issues](https://github.com/fstamatelopoulos/cerefox/issues) for the current backlog — bugs, planned work, and unscheduled ideas all live there (`docs/TODO.md` was retired at v1.0.6). Pick something that interests you and fits your expertise; `docs/plan.md` shows what is actively in flight. If you have a new idea, open an issue to discuss it before starting work.

---

## Contribution Areas

The most valuable contributions fall into these categories:

**AI agent integrations**: extend Cerefox to work with AI agents and runtimes not yet supported. This could mean new MCP transport adapters, new Edge Functions for specific platforms, or documentation for connecting new tools.

**Bug fixes**: if you find a bug, a fix with a test case is always welcome.

**Performance and security improvements**: profiling, query optimization, security hardening, input validation.

**Ingestion formats**: Markdown / `.txt` / `.docx` (`.docx` is converted to Markdown via `mammoth` on ingest; fidelity varies). **PDF is not supported** (dropped in v0.7 — convert to Markdown upstream). To add new source formats (HTML, EPUB, Notion exports, Obsidian vaults), extend the conversion step in `packages/memory/src/ingestion/file-to-markdown.ts` — open an issue to discuss before starting.

**Knowledge system integrations**: two-way sync with knowledge management systems (Obsidian, Logseq, Notion, etc.) is an area with significant potential. If you use Cerefox alongside another knowledge tool, an integration that keeps them in sync would be a meaningful contribution.

**Real-world extensions**: if you extended Cerefox to solve a specific problem in your workflow, consider contributing that extension back. Practical, battle-tested features are the most useful kind.

---

## Architecture Principles

All contributions must follow Cerefox's architecture:

**Single implementation principle**: business logic lives in Postgres RPCs (`src/cerefox/db/rpcs.sql` — still the live SQL source of truth). The TS client (`packages/memory`), the Edge Functions, and the shared MCP tool handlers (`_shared/mcp-tools/`) are thin adapters that call those RPCs. Do not duplicate logic across access paths.

**Markdown-first**: all content is stored as Markdown documents. Derived structures (embeddings, indexes, metadata) are regenerable from the document corpus.

**Embeddings**: the embedders are TypeScript in `_shared/embeddings/`. Two are wired: OpenAI `text-embedding-3-small` (cloud, default) and the local ONNX `nomic-embed-text-v1.5` (`CEREFOX_EMBEDDER=local`, Cerefox Local only — v1.0.0). A Fireworks/OpenAI-compatible option is roadmap, not implemented. Any embedder must output **768-dim** vectors to match the `vector(768)` schema; switching embedders is a breaking change requiring `cerefox server reindex`.

See `docs/solution-design.md` and `docs/research/vision.md` for the full architecture and project direction.

---

## Development Setup

Cerefox is a **TypeScript** project (Bun/Node). The entire runtime — CLI, MCP server, web
server, and ingestion pipeline — is TypeScript in [`@cerefox/memory`](https://www.npmjs.com/package/@cerefox/memory).
The Python implementation was **fully removed at v1.0.0**; the only non-Python thing left
under `src/cerefox/` is the SQL schema (`db/*.sql`), which the TS deploy bundles.

| Tool | Why | Install |
|---|---|---|
| **[Bun](https://bun.sh) 1.x** | The whole TS runtime + `scripts/*.ts` + tests (`bun test`) | `curl -fsSL https://bun.sh/install \| bash` |
| **Node 20+** with `npm` | Frontend (React + Vite) build + npm publish; an alternative TS runtime | [nodejs.org](https://nodejs.org/) or `nvm install 20` |

End users install via `npm`/`bun install -g @cerefox/memory` (or the one-liner installer) and
need no clone. The **local / self-hosted (Docker) backend** is separate again
— see [`docs/guides/setup-local.md`](docs/guides/setup-local.md).

```bash
# Clone and install (TS deps for root + packages/memory + frontend)
git clone https://github.com/fstamatelopoulos/cerefox.git
cd cerefox
bun install

# Run tests (`bun test` is the only runner)
cd _shared && bun test                                  # TS unit tests (mocked)
cd packages/memory && bun run build && bun test         # CLI/MCP smokes + live read/write

# The live suites WRITE real documents, and resolve credentials exactly as the
# CLI does — so a bare `bun test` targets whatever your default config points
# at. Since v1.4.0 they skip unless the target is labelled; run them against a
# scratch environment:
CEREFOX_CONFIG_DIR=~/.cerefox/staging bun test

# UI end-to-end (Playwright). Deliberately NOT in CI: it needs live Supabase and
# OpenAI credentials plus a labelled target, and putting those in repository
# secrets is a bigger exposure than the coverage is worth. So it is a local step
# — run it before pushing anything that touches `frontend/`:
cd frontend && CEREFOX_CONFIG_DIR=~/.cerefox/staging bun run test:e2e

# Playwright starts its OWN `cerefox web` on port 8123 from packages/memory/dist,
# so a run always tests the build in this repo. `CEREFOX_E2E_PORT` picks the
# port; `CEREFOX_E2E_REUSE=1` tests a server already running there instead of
# starting one — a post-deploy smoke test, never a regression run. Those were one
# setting until v1.5.0, and the coupling is what made #155 look like eight broken
# tests when the suite was simply pointed at a developer's own daemon.
cd frontend && bun run test:e2e                         # UI e2e (Playwright)
CEREFOX_LIVE_E2E=1 bun test test/edge-functions test/mcp-remote  # live EF e2e (opt-in)

# Type-check
bun run typecheck            # tsc --noEmit across _shared

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

Two versions track the server side: the **schema version** (`@version:` marker in `src/cerefox/db/schema.sql`, covers schema + RPCs since they deploy atomically) and **`EF_VERSION`** (`_shared/ef-meta/index.ts`, covers all Edge Functions). `cut_release.ts` bumps `EF_VERSION` automatically when EF source changed since the last tag, and **gates** the schema version: it fails the cut if `schema.sql`/`rpcs.sql` changed without a matching `@version:` bump (both the `schema.sql` marker and the `cerefox_schema_version()` literal in `rpcs.sql` must move together).

---

## Script-Language Policy

**Everything is TypeScript.** The Python → TypeScript strangler-fig migration (v0.2.0 →
v1.0.0) is complete — the last Python was removed at v1.0.0. All scripts, CLI tools, and
installer pieces are TypeScript (Bun-runnable, Node 20+ compatible); new scripts go in
`scripts/*.ts`.

Historical reasoning for the migration: [`docs/specs/polish-and-distribution-design.md` §12f](docs/specs/polish-and-distribution-design.md).

### `_shared/` — cross-context TypeScript modules

Starting in v0.3.0, TS code that's consumed by more than one entry point (scripts, the local TS MCP server, the upcoming TS CLI in v0.5.0) lives in [`_shared/`](_shared/) at the repo root:

```
_shared/
  config/      env resolver, dotenv loader
  db-client/   thin @supabase/supabase-js wrapper with zod-typed responses
  db-status/   reusable schema-introspection (used by db_status.ts; v0.5's
               `cerefox doctor` will import the same module)
  embeddings/  OpenAI + local ONNX (nomic) embedding helpers
  mcp-tools/   the 15 MCP tool handlers, shared by the remote Edge Function
               and the local @cerefox/memory server
  __tests__/   Bun tests — run `cd _shared && bun test`
```

It's at the repo root (not under `src/`) because it's imported by both the Deno Edge Functions and the Node/Bun `@cerefox/memory` package — it can't live inside either. It's part of an npm workspace alongside `packages/memory/`, and now spans config, db-client, db-status, db-deploy, embeddings, mcp-tools, ingest, cli-core, ef-meta, compatibility, backup, schemas, and server-assets (see `_shared/README.md`).

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
      commands/                   35 subcommand files (including `mcp` which runs buildServer())
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

**Type-checking**: `bun run typecheck` (`tsc --noEmit` across `_shared`) is the TS quality gate. A dedicated formatter/linter (biome) is not yet wired.

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

- **Type-checking**: `tsc --noEmit` (`bun run typecheck`); annotate public function signatures
- **Tests**: new code is TypeScript; add tests alongside it in `packages/memory/test/` or `_shared/__tests__/` (`bun test`)
- **Imports**: lazy-import heavy dependencies inside functions
