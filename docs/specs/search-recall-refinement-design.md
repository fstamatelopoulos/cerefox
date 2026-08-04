# Search Recall Refinement (v1.0.3)

Status: designed 2026-08-03, targeted at v1.0.3. Origin: **voice-of-the-customer
feedback from AI agents using Cerefox as their memory layer** — the primary
consumers of `cerefox_search`. An agent working against a production KB reported
that hybrid search behaved "like a strong title matcher with weak body recall":
concept-first, multi-term queries returned empty even when the target document
contained most of the query's terms verbatim, forcing the agent to fall back to
guessing document titles. Diagnosis against that instance confirmed two
interacting mechanisms, both fixable at the RPC layer.

## Diagnosis

Reproduced pattern (terms anonymized): a four-term query `A B C D` where the
target document contains `A`, `C`, and `D` verbatim in its body — but not `B`.

1. **FTS AND-brittleness.** `cerefox_hybrid_search` and `cerefox_fts_search`
   build their query with `plainto_tsquery('english', q)`, which requires
   **every** term to match. The single absent term `B` vetoes the three matching
   ones: the document scores zero on the lexical side. Consequence: **adding
   more true, relevant terms makes recall strictly worse** — the opposite of
   evidence accumulation, and directly hostile to how agents naturally search
   (keyword sets, not sentences).
2. **Vector threshold knife-edge.** With FTS dead, the document must clear
   `p_min_score` (default 0.50, OpenAI) on cosine similarity alone. Measured
   score in the repro: **≈ 0.47**. Short keyword-bag queries embed far from
   prose chunks (known query/document asymmetry), so genuinely relevant
   documents hover just under the floor. The pass-filter is
   `has_fts_match OR vec_score >= p_min_score` — so losing FTS (mechanism 1)
   silently raises the effective bar to "semantic-only".
3. **Empty results mislead agents.** When the two mechanisms combine (often
   with a project filter removing an irrelevant survivor), the caller gets
   zero results. For an agent, an empty result reads as *"this knowledge does
   not exist"* — the most expensive wrong conclusion a memory layer can
   produce. Three low-confidence candidates with visible scores would have let
   the agent decide.

**Explicitly cleared by the diagnosis** (the agent's other hypotheses):
*title boosting is not dominating* — title-echo queries win simply because all
their terms exist (passing the AND gate) and rank well; that is FTS working,
not title bias. *Chunking is not hurting retrieval* — the repro document was a
small 2-chunk doc, and the "partial N of M chars" the agent saw elsewhere is
the response byte budget truncating display, not retrieval.

## Design

### 1. Progressive FTS relaxation (AND-first, OR-fallback)

In `cerefox_hybrid_search` and `cerefox_fts_search`:

- Keep the existing `plainto_tsquery` AND query as the **primary** match — when
  it matches anything, behavior is byte-identical to today (precision
  preserved; no re-ranking of currently-working queries).
- When the AND query matches **zero chunks** (cheap `EXISTS` probe against the
  partial FTS index), fall back to an **OR-composed** query: tokenize the
  input, `plainto_tsquery` each token, fold with the tsquery `||` (OR)
  operator, skipping empty/stopword-only tokens. `ts_rank_cd` then naturally
  rewards chunks matching *more* of the terms, so multi-term evidence
  accumulates instead of vetoing. Fusion (`alpha * vec + (1-alpha) * fts`) is
  unchanged.
- Two-phase (rather than always-OR) is deliberate: it guarantees zero behavior
  change for every query that works today, and confines the new code path to
  queries that currently return nothing from FTS.

### 2. Below-confidence fallback (never silently empty)

In `cerefox_hybrid_search` (and surfaced through `cerefox_search_docs`):

- When the pass-filter (`has_fts_match OR vec_score >= p_min_score`) yields
  **zero rows**, return the **top 3 candidates by combined score** anyway,
  marked with a new `below_confidence BOOLEAN` output column (always present;
  `false` on normal results).
- Response layers (`_shared/mcp-tools/`, CLI, web) annotate these results
  clearly (e.g. `⚠ below confidence threshold — judge relevance yourself`) and
  keep scores visible. Agents get candidates + scores instead of a void;
  "truly nothing" still returns empty only when the corpus has nothing even
  weakly related.
- The `p_min_score` default (0.50 OpenAI / 0.60 local) is **unchanged**: with
  the fallback in place it stops acting as a cliff and becomes a confidence
  label. Lowering it instead would re-import the noise problem the
  embedder-aware defaults fixed.

### 3. Agent guidance

One addition to `AGENT_QUICK_REFERENCE.md` / `get_help` (and re-bundle via
`bun scripts/bundle_help.ts`): prefer a few distinctive terms over long keyword
lists; if a search comes back below-confidence, the flag means "weak signal",
not "absent". (After change 1, keyword lists stop being punished — this is
guidance, not a workaround.)

## Addendum (v1.0.4): the term-coverage gate

Dogfooding v1.0.3 for a day surfaced the symmetric failure: the "FTS match ⇒
unconditional pass" rule predates the OR-fallback, where a match meant **all**
terms were present. Under OR it fires on **any single term** — a query of five
nonsense tokens plus one common word (observed live: `sh`, matching every
shell-command snippet in the KB) returned five *confident-looking* irrelevant
results. Fix: in OR-fallback mode the unconditional pass must be **earned by
term coverage** — the chunk must match at least `p_min_term_coverage`
(default **0.5**) of the query's meaningful terms (stopword-free, deduplicated
by normalized lexeme, so "run running" counts once). Chunks below the bar keep
contributing their rank to the fusion but pass only via the vector threshold,
else they surface as below-confidence candidates — so nothing is hidden,
miscalibration degrades to "honestly labeled". AND-mode matches have 100%
coverage by construction: byte-identical behavior, zero added cost on the
common path. `cerefox_fts_search` (explicit keyword mode, no fallback flag)
returns only coverage-passing rows — honest-empty otherwise. The parameter is
exposed through `cerefox_search_docs` and the CLI (`--min-term-coverage`;
sent only when explicitly set, so older servers keep working); `0` restores
the pre-gate OR behavior. Schema 0.9.0 → 0.9.1 (signature change: the old
overloads are dropped). Known interaction: non-English content has no
stopword filtering under the hardcoded `english` config, so common foreign
words count as meaningful terms — tracked as #129 (multi-language FTS).

## Non-goals

- No threshold retuning, no chunking changes, no title-boost rework — all
  cleared by the diagnosis.
- No RRF / rank-fusion overhaul (tracked separately in TODO's Search & Ranking
  backlog; the linear alpha blend is not implicated here).
- `cerefox_semantic_search` keeps strict threshold semantics (its callers ask
  for "semantic matches above X" explicitly); only hybrid (the default agent
  path) and FTS gain the new behaviors.

## Mechanics / compatibility

- Adding the `below_confidence` output column changes the RPCs' return shape:
  `CREATE OR REPLACE` cannot alter OUT parameters, so the migration must
  `DROP FUNCTION` + recreate (same pattern as prior signature changes; RPCs
  redeploy atomically via `cerefox server deploy`).
- **Schema version bumps** (both literals, lockstep) per the standing rule.
- Old clients against a new server: PostgREST returns the extra JSON key,
  which existing clients ignore — no `minSchema` / `minEdgeFunctions` change
  required. New clients against an old server: the client ships with the
  matching server assets and `doctor` already flags schema drift.
- No Edge Function source changes beyond the shared handlers' annotation pass
  (`_shared/mcp-tools/` is imported by both the remote EF and the local MCP,
  so both transports pick the change up together).

## Validation

- Unit tests (`_shared/__tests__/`, mocked): OR-fold tokenization (incl.
  stopword-only and single-term inputs), two-phase selection, below-confidence
  flag shape.
- Live (maintainer instance, probe-and-skip pattern): a seeded `[E2E …]`
  document reproducing the anonymized pattern — four-term query, three terms
  present — must return the document (via OR-fallback) with `below_confidence`
  as appropriate; a currently-working title-echo query must return
  byte-identical results pre/post (precision regression guard).
- The agent-reported queries re-run against the production instance before
  cutting v1.0.3 (manual, maintainer).

## Release

Ships as **v1.0.3** (recall fix + additive flag; patch semantics) together
with #127 (doctor: suppress the EF-drift info line when the version delta is
label-only) and, as a repo-infra rider, the gitleaks CI step from the 28B
backlog. Requires `cerefox server deploy` (schema bump). CHANGELOG under
**Fixed**; the release note should credit agent feedback as the origin.
