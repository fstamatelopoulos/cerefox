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
