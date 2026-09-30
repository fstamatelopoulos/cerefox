# Iteration 48 — Search calibration

**Status:** in progress. Target **v1.17.0** (minor: search scoring changes).
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
| Maintainer review of results, formula choice | awaiting |
| Implement in `cerefox_hybrid_search` (+ migration, schema bump); live floor test | pending |
| Docs: solution-design, configuration, AGENT_GUIDE; CHANGELOG with before/after | pending |
| Release v1.17.0 | pending |
