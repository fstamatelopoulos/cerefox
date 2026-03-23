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
```

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
