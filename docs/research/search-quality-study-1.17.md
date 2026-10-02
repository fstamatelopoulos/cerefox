# Search quality study: Cerefox 1.16.1 → 1.17.x on real deployments

*2026-10-01. An evaluation of Cerefox search across versions 1.16.1 to 1.17.2, on two real deployments of one personal knowledge base. Aggregates only: no document titles, query text or identifiers appear here, and store sizes are rounded.*

**The two deployments.** The study ran on two deployments of the same personal knowledge base, which differ in ways that matter for search. **Deployment B** is the one in daily use. It is about twice the size of A and has kept growing since A was taken from it, so it covers more material, and it carries a long version history (several archived versions behind most documents). **Deployment A** is an older, smaller snapshot of B with a lighter history. B also turned out to have a degraded vector index, which A did not. Comparing the two separates the effect of the scoring changes, visible on both, from the effect of the index defect, visible mainly on B.

## Summary

- **1.17.0 shipped two defects that the synthetic benchmark could not see.** Together they made Deployment B search no better than 1.16.1 overall (macro MRR 0.715 against 0.714) and clearly worse for short and multi-word keyword queries:
  - the vector candidates came from an approximate index (fixed in 1.17.1);
  - `min_term_coverage` 0.67 meant "all three of three words" (fixed in 1.17.2).
- **With both fixed (1.17.2, schema 0.18.2), search is significantly better than 1.16.1 on both real stores:**

  | Store | macro MRR, 1.16.1 → 1.17.2 | ΔMRR (95% CI) | Hit@1 wins / losses |
  |---|---|---|---|
  | Deployment B (read-only, simulated, live behavior reproduced 98%) | 0.714 → **0.774** | +0.058 [+0.050, +0.066] | 227 / 41 |
  | Deployment A (older snapshot, live) | 0.826 → **0.840** | +0.014 [+0.006, +0.022] | 81 / 41 |

  Against 1.17.0 as it ran on Deployment B, the gain is +0.066 MRR (184 / 21).
- **The largest gains are on typos, paraphrases and section-heading queries.**
  - Typos: +0.26 MRR on Deployment B.
  - Paraphrases: +0.10 on Deployment B.
  - Section headings: +0.04.
  - The same document now scores much more consistently across phrasings: mean spread 0.83 → 0.41 on Deployment B.
- **No-answer queries answered with confidence fall from about two thirds to about a quarter:** 69% → 28% on Deployment B, 62% → 21% on Deployment A.
- **`search_alpha` 0.6 against 0.7 makes no significant difference** on either real store (+0.001 and +0.004 MRR). The synthetic benchmark prefers 0.7. **Recommendation: keep 0.7.**
- **Outcome:** 1.17.2 was released with both fixes.

## What changed in each version

| Version | Schema | Search change |
|---|---|---|
| 1.16.1 | 0.17.0 | Hybrid score = 0.7·cosine + 0.3·raw `ts_rank_cd` (unbounded, up to ~4); `min_term_coverage` 0.5 |
| 1.17.0 | 0.18.0 | Keyword score bounded to [0, 1) (`ts_rank_cd` normalization 32); `min_term_coverage` 0.67; built-in confidence floor derived from the store's embedder |
| 1.17.1 | 0.18.1 | Exact vector candidates (no approximate HNSW scan); keyword matches carry their exact cosine |
| 1.17.2 | 0.18.2 | `min_term_coverage` 0.66: a true two-of-three rule |

## Method

### Deployments

Two deployments of the same personal knowledge base. **Deployment A** is an older snapshot of **Deployment B**, the one in daily use.

| | Deployment A | Deployment B |
|---|---|---|
| Size | ~500 documents | ~1,000 documents, a few thousand current chunks |
| Version history | Moderate | Heavy: several archived chunks for every current one |
| Embedder | OpenAI `text-embedding-3-small` | same |
| Vector index | Healthy: Postgres scanned exactly in practice | Degraded: the HNSW index returned ~38 of 250 requested candidates, 13% recall@250 |
| Confidence floor | Stored setting 0.7 | Stored setting 0.7 |
| Access | Read and write (scratch functions, dropped afterwards) | **Read-only** (`default_transaction_read_only`); nothing created or written |

The local embedder (nomic) was evaluated only on the synthetic vocabulary (see below). The two Cerefox Local stores are small enough that Postgres scans exactly, so they never had the index defect.

### Query families (built automatically from each store's own documents)

Each query has one target document, the one it was built from (known-item retrieval).

| Family | How it is built | A | B |
|---|---|---|---|
| title | the exact title | 319 | 360 |
| title-prefix | the first two words of the title | 239 | 322 |
| title-reordered | title words reversed, lowercased | 239 | 322 |
| title-typo | two adjacent letters swapped in the title's longest word | 311 | 343 |
| distinctive-terms | the document's three rarest body words, excluding title words | 319 | 360 |
| body-sentence | a sentence from the middle of the document | 319 | 360 |
| section-heading | an H2/H3 heading unique to the document | 255 | 176 |
| paraphrase | a natural question written by an AI agent from the title and an excerpt, sharing **no** 4+-letter word with the title | 150 | 120 |
| no-answer | off-topic questions verified to have **no** full keyword match in the store | 29 | 29 |

Documents were sampled deterministically (hash order): about two thirds of A's documents and about a third of B's.

### Conditions

- **Deployment A:** every version ran live on the same store with identical query vectors. 1.16.1 and 1.17.0 were installed as temporary functions taken verbatim from their git tags; 1.17.1 and 1.17.2 were the deployed functions, with parameters overridden per call.
- **Deployment B:** 1.17.0 ran live. 1.16.1 and 1.17.x were computed from per-chunk signals read with plain SELECTs, using a model of each version that includes what the index actually returns (1.16.1, 1.17.0) or the exact candidate pool (1.17.x).
  - **The model reproduced live 1.17.0 for 2,347 of 2,392 queries (98.1%) on one connection**; most misses were typo queries.
  - **With four parallel connections, reproduction fell to 86%.** Live 1.17.0 on Deployment B switches between the approximate index and an exact scan depending on the database connection that serves it, most likely per-connection plan caching behind the pooler. So the results users saw from 1.17.0 varied with the connection.

### Statistics

- Metrics: MRR@10, Hit@1 (target ranked first), and the share of no-answer queries returned without the below-confidence flag.
- Paired comparisons on identical queries.
- ΔMRR with a 95% bootstrap interval that resamples **documents** (5,000 draws), because the queries built from one document are not independent.
- Hit@1 compared with an exact McNemar test on the queries where the two versions disagree, Holm-corrected across all 45 tests of a store.
- No-answer rates with Wilson 95% intervals.

## Results: Deployment B (macro MRR / Hit@1 by family)

1.17.0 is live; the other rows are the reproduced model.

| Family | 1.16.1 | 1.17.0 live | 1.17.1 | 1.17.2 | 1.17.2 at α 0.6 |
|---|---|---|---|---|---|
| title | 0.996 | 0.979 | 0.994 | 0.994 | 0.999 |
| title-prefix | 0.680 | 0.635 | 0.702 | 0.702 | 0.701 |
| title-reordered | 0.983 | 0.968 | 0.983 | 0.983 | 0.987 |
| title-typo | 0.573 | 0.809 | 0.832 | 0.835 | 0.819 |
| distinctive-terms | 0.606 | 0.386 | 0.535 | 0.666 | 0.673 |
| body-sentence | 0.760 | 0.751 | 0.760 | 0.758 | 0.762 |
| section-heading | 0.838 | 0.833 | 0.882 | 0.882 | 0.906 |
| paraphrase | 0.278 | 0.357 | 0.350 | 0.374 | 0.352 |
| **macro MRR** | **0.714** | **0.715** | **0.755** | **0.774** | **0.775** |
| **macro Hit@1** | 0.642 | 0.661 | 0.705 | 0.726 | 0.728 |

Significant per-family effects (Holm-adjusted p < 0.05, CI excluding 0):
- **1.17.2 vs 1.16.1:**
  - typo +0.262 (144 / 10);
  - section heading +0.044 (12 / 0);
  - paraphrase +0.096 (21 / 3);
  - all families +0.058 (227 / 41).
  - The rare-word family improves (+0.060) but misses significance after correction.
- **1.17.2 vs 1.17.0 live:**
  - title prefix +0.067 (34 / 5);
  - rare words +0.280 (97 / 9);
  - section heading +0.049 (14 / 0);
  - all families +0.066 (184 / 21).
- **1.17.0 live vs 1.16.1:** typo +0.236, but rare words −0.220 (5 / 77). That is the regression that was noticed in use.

## Results: Deployment A (macro MRR / Hit@1 by family)

All rows are live.

| Family | 1.16.1 | 1.17.0 | 1.17.1 | 1.17.2 | 1.17.2 at α 0.6 |
|---|---|---|---|---|---|
| title | 0.992 | 0.995 | 0.995 | 0.995 | 0.997 |
| title-prefix | 0.803 | 0.790 | 0.794 | 0.794 | 0.805 |
| title-reordered | 0.953 | 0.952 | 0.952 | 0.952 | 0.956 |
| title-typo | 0.754 | 0.827 | 0.827 | 0.836 | 0.835 |
| distinctive-terms | 0.845 | 0.708 | 0.710 | 0.849 | 0.848 |
| body-sentence | 0.931 | 0.933 | 0.933 | 0.931 | 0.936 |
| section-heading | 0.920 | 0.914 | 0.921 | 0.921 | 0.935 |
| paraphrase | 0.414 | 0.448 | 0.448 | 0.443 | 0.441 |
| **macro MRR** | **0.826** | **0.821** | **0.823** | **0.840** | **0.844** |
| **macro Hit@1** | 0.773 | 0.774 | 0.774 | 0.793 | 0.800 |

- **1.17.2 vs 1.16.1:** +0.014 MRR overall [+0.006, +0.022] (81 / 41, p = 0.012); typo +0.082 (49 / 15).
- **1.17.2 vs 1.17.1:** rare words +0.139 (56 / 1).
- **Why Deployment A gains less than Deployment B:** Deployment A's index is healthy, so 1.16.1 there was not handicapped by the index defect.

## No-answer queries answered with confidence (lower is better)

| | 1.16.1 | 1.17.0 / 1.17.1 | 1.17.2 |
|---|---|---|---|
| Deployment B | 20/29 (69%, 51–83%) | 2/29 (7%, 2–22%) | 8/29 (28%, 15–46%) |
| Deployment A | 18/29 (62%, 44–77%) | 2/29 (7%, 2–22%) | 6/29 (21%, 10–38%) |

1.17.0's strictness here came from the same coverage bug that hurt rare-word queries. A true two-of-three rule gives back part of it, and 1.17.2 still answers no-answer queries confidently at about a third of 1.16.1's rate. Coverage 0.5 was also measured: 62% on Deployment A, no better than 1.16.1, so it was rejected.

## Consistency across phrasings

For documents with all four title variants (exact, prefix, reordered, typo), we measured how far the document's own score moves between them and how often it ranks first under all four.

| | 1.16.1 | 1.17.0 | 1.17.2 |
|---|---|---|---|
| Deployment B: mean score spread | 0.829 | 0.587 (live) | **0.414** |
| Deployment B: first under all four | 25% | 38% | **45%** |
| Deployment A: mean score spread | 0.757 | n/a | **0.319** |
| Deployment A: first under all four | 53% | n/a | **58%** |

This is the original complaint (the same document scoring very differently for a full name and a short name), measured across every kind of variant.

## search_alpha: 0.6 vs 0.7

| | ΔMRR (0.6 − 0.7), 1.17.2 | Hit@1 wins / losses | Holm p |
|---|---|---|---|
| Deployment B | +0.001 [−0.003, +0.005] | 28 / 24 | 1.0 |
| Deployment A | +0.004 [+0.000, +0.007] | 23 / 9 | 0.60 |
| Synthetic, OpenAI | −0.007 (paraphrase −0.07) | n/a | n/a |
| Synthetic, nomic | −0.008 (short names −0.06) | n/a | n/a |

No real store shows a significant difference, and the synthetic benchmark prefers 0.7, so the default stays 0.7. A store can set `search_alpha` itself; a per-search `--alpha` makes it easy to compare.

## Latency

- **Deployment B, live 1.17.0:** median 104 ms, p95 160 ms.
- **Deployment A:** median 218–234 ms for every version (exact scan included). The client-to-database round trip dominates, so the exact scan costs nothing measurable at this scale.
- **Deployment B, measured separately for 250 candidates:** exact scan 121 ms against 283 ms for the index.

## Synthetic benchmark (for completeness)

On the synthetic calibration vocabulary (158 documents, 147 labeled queries, 13 categories, both embedders), 1.17.2 equals 1.17.0's results except for one more confident false positive per embedder. The per-category floors in `floors.json` are unchanged.

The vocabulary missed both defects:
- **The index defect:** it searches one project, where Postgres always scans exactly.
- **The coverage defect:** it has few three-word keyword queries whose words sit in different chunks.

That is the reason for this study, and the process now requires a real-data check on a staging deployment for any ranking change.

## A rejected change: credit for partial keyword matches

After 1.17.2 a search for a document's subject in different words ("search assessment report" for a document titled "Search quality study") did not find it. The cause is how keyword matching escalates. When any document contains every query word, search runs in all-words mode, and documents containing only some of the words get no keyword credit. The two-of-three rule applies only when no document contains them all. Several guides contained all four words, so the target, with three of them, could compete on meaning alone.

The obvious change is to always give partial matches proportional credit and keep the two-of-three rule for confidence. It was measured on Deployment B (read-only, same method, 2,392 queries plus the failing phrasings) against 1.17.2 as deployed:

| Family | 1.17.2 | Partial credit always | ΔMRR (95% CI) | Hit@1 wins / losses |
|---|---|---|---|---|
| title | 0.994 | 0.884 | −0.110 [−0.140, −0.082] | 0 / 54 |
| title-prefix | 0.701 | 0.562 | −0.139 [−0.169, −0.111] | 4 / 65 |
| title-reordered | 0.983 | 0.840 | −0.143 [−0.179, −0.110] | 1 / 65 |
| body-sentence | 0.758 | 0.602 | −0.156 [−0.186, −0.126] | 0 / 74 |
| section-heading | 0.882 | 0.658 | −0.225 [−0.275, −0.174] | 1 / 50 |
| distinctive-terms | 0.666 | 0.647 | −0.019 [−0.033, −0.005] | 1 / 11 |
| title-typo | 0.835 | 0.834 | −0.001 | 0 / 1 |
| paraphrase | 0.374 | 0.386 | +0.013 (not significant) | 2 / 2 |
| **all** | | | **−0.098 [−0.111, −0.085]** | **10 / 322** |

**Rejected.** All-words mode is what lets a precise query win: an exact title, heading or sentence beats documents that merely share some of its words. Without it those families lose 0.11 to 0.23 MRR, while the phrasings that motivated the change gained little. A document whose title and text use different words from the query is a vocabulary mismatch, best fixed by a more descriptive title, not by weakening precise queries.

The same run checked 1.17.2 after deployment: the model reproduced live search for 97.8% of queries, the rest again mostly typo queries.

## Limitations

- **Known-item relevance:** each query has one correct document. Near-duplicate documents (dated series, multi-part logs) can make a sensible answer count as a miss, which depresses absolute scores equally for all versions. The comparisons are paired, so the differences are still valid.
- **Most families are built from the document's own text and so favor keyword matching.** Paraphrases (150 and 120) are the only meaning-only family; they were written by an AI agent with a no-shared-title-word rule, and their intervals are wide.
- **No-answer queries are few (29 per store).** Their intervals are wide; the 1.16.1 → 1.17.2 drop is clear, while 7% against 21–28% within 1.17.x is less certain.
- **The Deployment B numbers for 1.16.1 and 1.17.x are simulated.** The model reproduced live 1.17.0 for 98% of queries; the rest, mostly typo queries, are a known gap.
- **Both stores use OpenAI embeddings and a stored confidence floor of 0.7** (the built-in default is 0.5). At 0.5, every version did slightly worse on Deployment A. The local embedder is covered only by the synthetic benchmark.
- **One personal knowledge base, in two deployments.** Other collections may differ.

## Defects found during the study

1. **Approximate vector candidates (fixed in 1.17.1).** Ordering by the bare distance let the planner use the HNSW index, which returns at most `ef_search` (40) rows and, after heavy version churn, not the nearest ones. Search now orders by the computed similarity, which forces an exact scan.
2. **`min_term_coverage` 0.67 meant three of three (fixed in 1.17.2).** The gate is `matched ≥ coverage × words`, and 0.67 × 3 = 2.01. A test now pins the arithmetic.
3. **Live behavior depended on the connection.** On Deployment B, the same search used the index on some database connections and an exact scan on others. Resolved by (1), since the index is no longer usable for this query.
4. **The model download could splice two responses (fixed in 1.17.1, #314).** On a dropped connection, the runtime's fetch can re-issue the request and append the second body to the first. Downloads now use verified fixed-size ranges.

## Outcome

- **1.17.1** (schema 0.18.1) made the vector candidates exact.
- **1.17.2** (schema 0.18.2) set `min_term_coverage` to 0.66.
- `search_alpha` stays 0.7.
- The process now requires two things for any ranking change: the synthetic floors on both embedders (`RELEASING.md`), and a real-data check on a staging deployment.
