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

The Bun requirement is new in v0.2.0 — see [Script-language policy](#script-language-policy-effective-from-v020) below. **End users are unaffected**: the published install path stays Python-only until v0.4.0.

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

The first concrete artifact under this policy is [`scripts/cut_release.ts`](scripts/cut_release.ts) — the release-cutting script, shipped with v0.2.0.

Full reasoning in [`docs/specs/polish-and-distribution-design.md` §12f](docs/specs/polish-and-distribution-design.md).

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
