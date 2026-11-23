# Iteration 56: every search mode runs its own search (#377)

Target **v1.25.0**. Client-side only: no schema change.

## Why

`cerefox_search` (both MCP transports) listed four modes and described
`semantic` as "vector-only", but the handler branched only on `fts` and
`hybrid`. `semantic`, and any unknown value (a typo such as `"chunks"`), fell
through to `cerefox_search_docs`, the default document search with keyword
matching and whole documents, and the caller never learned its argument had
been ignored. `GET /api/v1/search` also ran an unknown mode as the docs
search. The web UI and the API ran `semantic` properly
(`cerefox_semantic_search`), and the CLI did not offer it. Three lists of
modes, three different answers.

## Design

- **One list, `SEARCH_MODES`** (`_shared/mcp-tools/search.ts`), with
  `parseSearchMode()`: the MCP tool's schema enum, its validation, the CLI's
  `--mode` and the API route all read it. Each mode maps to one RPC:
  `docs` → `cerefox_search_docs`, `hybrid` → `cerefox_hybrid_search`,
  `fts` → `cerefox_fts_search`, `semantic` → `cerefox_semantic_search`.
- **`semantic` is called as the web route calls it**: embedding, match count,
  project, metadata filter, and a similarity floor only when the caller names
  one (`min_score` / `--min-score`). The RPC's own default is no floor, so it
  returns the nearest chunks ranked by similarity; the docs say to judge them
  by their scores. Chosen over sending the store's configured floor, which
  would make MCP and the CLI disagree with the web UI on the same query.
- **An unknown mode is refused**: an in-band tool error on MCP (invalid
  parameters are reported that way for every tool), a non-zero exit on the
  CLI, a `400` on the API, each listing the valid modes. Only an omitted mode
  (or JSON `null`) is the default; `""` is refused (Codex review).
- **`content: "matches"` stays docs-only**, so `semantic` + `matches` is
  refused like the other chunk modes.
- **Not changed: the `cerefox-search` Edge Function** (GPT Actions). Its
  documented enum is `docs|hybrid|fts`, the Custom GPT schema restricts what
  a GPT sends, and the path retires on 2026-12-11 (#326). Judgment call.

## Verification

- [x] `_shared/__tests__/search-modes.test.ts`: each mode to its RPC, the
      enum equals `SEARCH_MODES`, semantic's parameters, an explicit
      `min_score` passes through, chunk rendering, unknown modes refused
- [x] live on staging (`web-integration/search-modes-live.test.ts`): the CLI's
      `--mode semantic` returns chunks best first; the CLI and the API return
      the same semantic chunks in the same order; unknown modes refused by
      both; `api-schema-truth` gains a semantic case
- [x] remote MCP on staging (`mcp-remote.test.ts`, 28/28 with the new case),
      branch Edge Functions deployed
- [x] full suites (`_shared`, package on staging, frontend, typecheck),
      Playwright 43; Codex review: two Medium findings fixed (an empty mode
      ran the docs search; the CLI guide's `--min-score` row)
