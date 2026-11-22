# Iteration 55: search returns each document's best passages (#375)

> Status: in progress (branch `feat/search-passages`, built on PR #376).
> Schema 0.23.0.

## Why

An agent that searches to find which document to read pays for whole
documents in every reply: the default `docs` search returns any document
under 20,000 characters whole. #375 measured a mean reply of 34 KB on a
1,193-note store. The chunk modes (`hybrid`, `fts`) are small, but they rank
chunks on their own, so one long relevant document can fill most of the
result slots, and they do not answer "which document?".

Search now has three result shapes:

| Shape | How | Best for |
|---|---|---|
| (a) Documents | default | answering from the reply; small and medium documents |
| (b) Ranked chunks | `mode: hybrid` / `fts` | the passage is the answer |
| (c) Documents with their best passages | `content: matches` (new) | finding the right document, then reading it or one section |

## Design

- **In the RPC, one place.** `cerefox_search_docs` gains `p_passages` and
  `p_max_passage_chars`. With `p_passages`, the top documents are exactly
  those of (a), in the same order; each carries `passages` (JSONB, best score
  first: chunk_index, heading_path, score, content, chars, truncated) and
  `matched_chunk_count`; `full_content` is NULL. Selection: the document's
  matched chunks (its rows in the hybrid candidate pool), no neighbors,
  ordered by score; the longest prefix of that order whose total fits the
  cap, and always the best chunk. When the best chunk alone is over the cap
  it becomes an excerpt around the query's terms (`ts_headline`, up to three
  fragments sized to the cap; `excerpt` = TRUE), or, when none of the terms
  occur in it (a semantic-only match), its opening cut at a line break.
  Both are flagged `truncated`. Found on staging: chunks run to 4,000
  characters, and cutting the best one to its opening, as the first version
  (and PR #376) did, returned the unrelated section above the match. The cap clamps to 200..20000 (default 1500, the
  value #375 measured). `is_partial` is false only when the passages hold the
  whole document.
- **Every surface**: both MCP transports (one shared handler), the CLI
  (`--content matches`, `--max-passage-chars`), `GET /api/v1/search`
  (`content=matches`, `max_passage_chars`). Text rendering is shared
  (`_shared/search-passages/`) so the MCP tool and the CLI read the same.
  Not the web UI (an agent-facing shape; the API carries it if a toggle is
  wanted later), and not the `cerefox-search` Edge Function (Custom GPTs
  retire on 2026-12-11).
- **Refusals**: `content: matches` with a chunk mode is an error, not ignored.
  An older server (no `p_passages`) gets an error naming
  `cerefox server deploy`. `minSchema` is not raised: (a) and (b) work
  against older servers.
- **Why not in the adapter** (PR #376 as first submitted): an adapter-side cut
  served only MCP, cut the concatenation in document order (so the best
  passage could be the part cut away), and cut mid-chunk. The RPC has each
  chunk's score; the adapter did not.

## Changes

- `src/cerefox/db/rpcs.sql`: `cerefox_search_docs` (params, return columns,
  passage CTEs; the small-to-big CTEs are skipped under `p_passages`).
  Schema 0.22.0 → 0.23.0 (`schema.sql` marker and `cerefox_schema_version()`).
  No migration: `rpcs.sql` already drops and recreates the function.
- `_shared/search-passages/index.ts` (new): cap bounds, old-server error,
  rendering.
- `_shared/mcp-tools/search.ts`: `content`, `max_passage_chars`, schema text
  built around the three shapes.
- `packages/memory/src/cli/commands/search.ts`, `packages/memory/src/web/routes/discovery.ts`,
  `_shared/schemas/discovery.ts`, `docs/api/openapi.json`, `docs/guides/api.md`.
- Docs: `AGENT_GUIDE.md` ("Three result shapes"), `AGENT_QUICK_REFERENCE.md`
  (rule 11), the bundled help, CHANGELOG.
- Tests: `search-passages.test.ts` (new, unit), passage shapes in the budget
  invariant grid, `search-passages-live.test.ts` (new, live on staging).

## Verification

- [ ] SQL on a throwaway Postgres (pgvector): ordering, cap, truncation,
      `is_partial`, same documents as (a), idempotent re-apply
- [ ] typecheck; `_shared`, frontend and package suites
- [ ] staging: schema deploy, live passages test, Playwright, search
      benchmark `--check-floors` (ranking unchanged)
- [ ] Opus review (read-only)
- [ ] after the cut: production schema deploy (with go-ahead)
