# Iteration 48 — Search calibration

**Status:** released as v1.17.0 (2026-10-01). Target **v1.17.0** (minor: search scoring changes).
Design: [`docs/specs/search-calibration.md`](../specs/search-calibration.md).

## Decisions

- **Benchmark before any scoring change** (maintainer, 2026-10-01). The trigger was a
  full-name vs short-name pair that ranked very differently; the fix must rest on a
  broad, category-balanced vocabulary, not on names.
- The vocabulary becomes a **wired automatic test**: a live suite asserting per-category
  floors for the chosen formula, so a later change cannot silently regress a category.
- Measured on **both embedders** (OpenAI on a cloud store; nomic on a throwaway Local).

## How candidates are compared without deploying each

The runner does not call a different RPC per candidate. For each query it fetches the
**raw per-chunk signals** a candidate needs (vector similarity, raw `ts_rank_cd`, full
AND match vs OR-fallback coverage) through a temporary probe function on the target,
then applies every candidate formula client-side over the same candidate pool.

**The reproduction check comes first:** the client-side "current" formula must
reproduce the live `cerefox_search_docs` ranking for every query before any candidate's
numbers are trusted. If it does not, the harness is wrong, not the formula.

Probe functions are created for a run and dropped after it (staging SOP: leave it as
you found it).

## Work

| Step | State |
|---|---|
| Spec (categories, metrics, candidates, decision rule) | done |
| Metric arithmetic + unit tests (`_shared/search-benchmark/metrics.ts`) | done |
| Synthetic corpus + labelled query vocabulary (reviewed, no real data) | done: 60 docs, 132 queries, 13 categories, 28 variant groups (4 name groups); `_shared/search-benchmark/vocabulary/`, integrity test |
| Runner: ingest corpus into a labelled target, probe signals, apply candidates, report | done: `scripts/search_benchmark.ts` |
| Reproduction check vs live RPC | done: 132/132 exact on both embedders (needed the RPC's count × 10 chunk limit modelled) |
| Baseline: current formula, both embedders | done (2026-09-30): staging/OpenAI, throwaway Local/nomic |
| Candidates: bounded FTS rank, RRF, retuned gates; per-category results | done. Leading: bounded `ts_rank_cd` (r/(r+1)), alpha 0.7, `min_term_coverage` 0.67, vector gates unchanged (0.5 OpenAI / 0.6 nomic). RRF loses on both. |
| Finding: fresh Local (s6 image) never seeds `min_search_score` 0.6 (only the legacy `entrypoint.sh` did); MCP/CLI then search at 0.5, where nomic returns 10/10 negatives confidently | found; fix in 1.17.0 |
| Maintainer review of results, formula choice | done (2026-09-30): bounded rank + coverage 0.67, gates unchanged; also add distractors before the release so floors are set once |
| Distractor expansion | done: +98 docs, +15 queries (158/147); reviewed, 2 items removed |
| Implement (schema 0.18.0, RPC-only like 0.16.1): bounded `ts_rank_cd` in hybrid, coverage 0.67, `cerefox_default_min_search_score()` from the store's embedder (fixes the Local seed bug); web search route stops sending its own `p_min_score`/`p_alpha`; live floor test | done; deployed to staging + throwaway Local; floors recorded for both embedders; floor test green on staging at defaults |
| Docs: solution-design, configuration, setup-local, ops-scripts, AGENT_GUIDE, CLAUDE.md rule, spec Results; CHANGELOG with before/after | done |
| Release v1.17.0 | released 2026-10-01; staging + Local upgraded and verified; production pending |
