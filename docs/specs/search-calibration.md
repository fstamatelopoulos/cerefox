# Search calibration (iteration 48, target v1.17.0)

Status: **design; benchmark first.** No change to how search scores ships until the
benchmark below has measured the current behaviour and every candidate.

## Why

Two searches for one person, by full first name and by its short form (the
"Robert Keane" / "Bob Keane" shape), returned very different results on a real store. Measured per mode, the semantic half behaved: both queries
found the same documents with similar similarity (0.38 and 0.44). The disagreement was
entirely in how hybrid search **combines** its two signals:

```
score = alpha × vector_similarity + (1 − alpha) × ts_rank_cd(fts, query)   -- alpha = 0.7
```

- `vector_similarity` is a cosine in [0, 1]. `ts_rank_cd(…)` is **unbounded**: it
  reached 3.86 on that store. So when every query term matches, the keyword term
  outweighs the semantic one by about 5×, and when one term does not ("Bob" ≠
  "Robert"), it contributes almost nothing. `alpha = 0.7` was meant to favour
  semantics; in practice keyword dominance flips on and off with a single token, and
  scores are not comparable across queries (1.16 vs 0.27 for the same person).
- A result is kept if it matched lexically, **or** its vector similarity is at least
  `min_search_score` (0.5 for OpenAI). Short queries such as names score 0.33 to 0.44,
  so vector-only matches are dropped and hybrid collapses to "keyword or nothing".

Tuning on one example would just move the bias somewhere else. Hence the benchmark.

## The calibration vocabulary (benchmark)

A committed, **synthetic** corpus and query set. Invented people, projects and
content only: nothing from any real store (see the parity-fixture scrub, 2026-10-01).

**Corpus:** 50 to 70 short Markdown documents across unrelated domains, sized like
real notes, with structure (titles, headings) and realistic overlap and distractors.
For example: engineering how-tos, incident reports, meeting notes with people,
contact cards, product specs, policies, recipes, travel logs, and research summaries.

**Queries,** each labelled with the documents that are relevant (graded: 2 = the
answer, 1 = related), grouped by category so no single category decides:

| Category | What it probes | Example shape |
|---|---|---|
| exact title | the title boost works | the document's title verbatim |
| distinctive keyword | one rare term | "Kestrel" |
| multi-word topic | several ordinary words | "database backup schedule" |
| paraphrase / synonym | meaning without shared words | "automobile insurance" for a "car cover" note |
| abbreviation / acronym | short vs long form | "k8s upgrade" / "Kubernetes upgrade" |
| short name / nickname | partial or familiar names | "Liz Moreau" / "Elizabeth Moreau" |
| misspelling | a typo in one term | "kuberentes" |
| word order | same words, different order | "Moreau Elizabeth" |
| inflection | stems | "deploying" / "deployment" |
| natural-language question | how people ask agents | "how do I rotate the api key" |
| identifier | codes, ticket ids, error codes | "E4012", "OPS-217" |
| long query | a sentence of context | 15+ words |
| negative | nothing relevant exists | should come back low or below-confidence |

**Variant groups:** queries that should retrieve the same documents are tied together
(the short-name shape, generalised: acronym vs expansion, typo vs correct, reordered,
inflected). Consistency within a group is measured separately from accuracy.

## Metrics

Per query: **MRR@10**, **Hit@1**, **Recall@5** (graded relevance: nDCG@10 as well).
Per variant group: **Jaccard of the top-5 documents** across variants, and the spread
of the best relevant document's rank. Negatives: **confident false positives**
(results not flagged below-confidence). Score sanity: the distribution of top
scores, so "a good match" means a comparable number across queries.

Reported **per category and per embedder** (OpenAI `text-embedding-3-small` on a
cloud store; nomic via the Local image), because the two have different similarity
scales and `min_search_score` defaults (0.5 and 0.6).

## Candidates

1. **Current:** raw `ts_rank_cd`, alpha 0.7.
2. **Bounded keyword score:** `ts_rank_cd(fts, q, 32)`, i.e. rank/(rank + 1) in [0, 1),
   with alpha and `min_search_score` retuned on the benchmark.
3. **Reciprocal-rank fusion (RRF, k = 60):** combine by rank rather than score,
   indifferent to either scale (the #141 backlog item).
4. Whichever of 2 or 3 wins, with the vector-side gate (`min_search_score`) retuned
   per embedder, since name-like short queries sit below today's gate.

## Decision rule

A candidate replaces the current formula only if, on **both** embedders:

- overall MRR@10 and nDCG@10 improve;
- variant-group consistency improves;
- **no category regresses** by more than a small, stated tolerance; any regression is
  reported, not averaged away;
- negatives do not produce more confident false positives.

The benchmark results, for every candidate, go in the PR and in this document before
the change ships.

## Results (2026-09-30, shipped in v1.17.0 / schema 0.18.0)

Measured on the full vocabulary (158 documents, 147 queries) on a cloud staging
store (OpenAI) and a throwaway Cerefox Local (nomic). On both, the harness
reproduced the live `cerefox_search_docs` ranking exactly for every query, under
the old formula and again under the new one, before any number was compared.

**Chosen:** bounded keyword score (`ts_rank_cd` normalisation 32, `r/(r+1)`),
`search_alpha` 0.7, `min_term_coverage` 0.67 (was 0.5), `min_search_score`
unchanged per embedder (0.5 OpenAI, 0.6 nomic), now derived from the store's
embeddings when no row is stored.

| | OpenAI before | OpenAI after | nomic before | nomic after |
|---|---|---|---|---|
| MRR@10 | 0.881 | **0.912** | 0.865 | **0.892** |
| Hit@1 | 0.836 | **0.873** | 0.806 | **0.843** |
| nDCG@10 | 0.877 | **0.901** | 0.877 | **0.895** |
| Target score spread across variants | 0.680 | **0.463** | 0.611 | **0.370** |
| Top-5 overlap across variants | 0.545 | 0.541 | 0.507 | 0.498 |
| Confident false positives (13 no-answer queries) | 4 | **0** | 6 | **2** |
| Top score p50 / p90 | 0.86 / 2.01 | 0.50 / 0.71 | 0.98 / 2.12 | 0.63 / 0.79 |

"Before" is the old formula at the defaults a store actually had (unbounded rank,
coverage 0.5, the embedder's floor).

Per category, paraphrase moved most (OpenAI 0.31 → 0.53, nomic 0.22 → 0.34),
then question, short name (nomic 0.88 → 0.94), misspelling, long query and
multi-word topic. **One category regressed**: identifier on OpenAI, 0.923 →
0.885, a single query. For "E4012" the new formula ranks the ticket titled
"Split E4012 into E4012 and E4014" above the postmortem where the error
occurred; both are reasonable answers, and the drop is within tolerance.

**Deviation from the decision rule, stated:** top-5 overlap across variants did
not improve (flat, slightly lower). It was chosen as the consistency measure
before any results existed, and it turned out to be decided mostly by positions
2 to 5, which on this corpus are unlabelled distractors. The measure that
captures the original complaint, how far the *right* document's score moves
between phrasings of one need, improved by about a third on both embedders, and
Hit@1 rose with it. The change ships on that basis; the rule should name the
target-score spread for future decisions.

Also measured and rejected: reciprocal-rank fusion (k 20 and 60) lost on MRR on
both embedders; alpha 0.6 and 0.8 were within noise of 0.7, with 0.8 costing
single-keyword queries on OpenAI; a lower vector floor (0.4) raised recall but
let no-answer queries through.

Two defects surfaced along the way and are fixed in the same release:

- A fresh Cerefox Local never got its 0.6 floor: the seed lived in a start path
  the current image does not run, so MCP and CLI searches on new containers used
  0.5, at which nomic returned all ten original no-answer queries as confident
  results. The RPC now derives the floor from the store's embeddings.
- The web UI and `/api/v1` search sent their own floor and alpha, overriding the
  store's settings, so they searched differently from every agent on the same
  store. They now leave both to the store.

## Correction (v1.17.1, v1.17.2): what the synthetic benchmark missed

An evaluation on real data on a staging environment (thousands of known-item
queries generated from its documents, AI-written paraphrases and no-answer queries;
paired statistics with document-clustered bootstrap intervals and Holm-corrected
McNemar tests) found two things the synthetic vocabulary did not. Its detailed
figures are kept out of the repository because they describe a private store.

1. **The vector candidates came from an approximate index.** Ordering by the bare
   `embedding <=> query` distance let Postgres answer from the HNSW index, which
   returns at most `hnsw.ef_search` (40) rows and, after heavy version churn, not
   the nearest ones. The bounded keyword score of 0.18.0 made the gap visible.
   Fixed in 0.18.1 (exact scan; also faster at this scale). The benchmark searched
   one project, where Postgres scans exactly, so it never exercised the index path.
2. **`min_term_coverage` 0.67 meant three of three.** The gate is
   `matched >= coverage x terms`; 0.67 x 3 = 2.01. Multi-word keyword queries
   ranked markedly worse than in 1.16.1. Fixed in 0.18.2 (0.66). The synthetic
   vocabulary has few three-word keyword queries whose words sit in different
   chunks, which is where the rule bites.

With both fixed, search measured significantly better than 1.16.1 overall on that
data, and `search_alpha` 0.6 was indistinguishable from 0.7 (so 0.7 stays).

Lessons kept in the process: a ranking change is checked on real data on staging as
well as on the vocabulary; the benchmark's results are only as broad as its query
shapes; and a parameter is tested by its arithmetic, not its description.

## Wiring

- `scripts/search_benchmark.ts`: ingests the corpus into a dedicated project on a
  **labelled** (non-production) target, runs every query through the real RPCs, and
  writes a report (per-category tables plus JSON). It can run candidate formulas side
  by side.
- A live test (`liveTest`, probe-and-skip, write-guarded) runs the vocabulary against
  staging and asserts **floors**: the chosen formula's per-category metrics minus a
  tolerance. A future change to search that silently regresses a category fails it.
- Unit tests for the metric arithmetic, which must be right before any number is
  believed.

## Documentation

`docs/solution-design.md` (the scoring section), `docs/guides/configuration.md`
(what `search_alpha`, `min_search_score` and `min_term_coverage` mean after the
change), `AGENT_GUIDE.md` (what a score means), and the CHANGELOG with the measured
before/after.
