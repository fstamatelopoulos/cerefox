/**
 * Candidate ranking formulas for the search-calibration benchmark (iteration 48),
 * applied client-side to the per-chunk signals from `probe.sql`.
 *
 * `current` reproduces cerefox_hybrid_search + cerefox_search_docs exactly; the
 * runner proves that against the live RPC before any candidate is scored.
 */

export interface ChunkSignals {
  chunk_id: string;
  document_id: string;
  vec_score: number;
  in_and: boolean;
  in_or: boolean;
  rank_and: number;
  rank_or: number;
  tokens_matched: number;
  total_tokens: number;
}

export interface Gates {
  /** Vector-side confidence gate (min_search_score). */
  minScore: number;
  /** OR-fallback coverage bar (min_term_coverage). */
  minCoverage: number;
}

export interface Candidate {
  name: string;
  gates: Gates;
  /** Chunk scores, given the keyword side's per-chunk rank and match flags. */
  score: (chunks: KeywordView[]) => Map<string, number>;
}

/** A chunk as the keyword side sees it for this query (AND unless nothing matches AND). */
export interface KeywordView extends ChunkSignals {
  in_fts: boolean;
  fts_raw: number;
  coverage_ok: boolean;
}

export interface DocResult {
  document_id: string;
  score: number;
}

export interface RankedDocs {
  docs: DocResult[];
  below_confidence: boolean;
}

/** Keyword view exactly as cerefox_hybrid_search builds it. */
export function keywordView(chunks: ChunkSignals[], minCoverage: number): KeywordView[] {
  const andMatches = chunks.some((c) => c.in_and);
  return chunks.map((c) => {
    const in_fts = andMatches ? c.in_and : c.in_or;
    const fts_raw = in_fts ? (andMatches ? c.rank_and : c.rank_or) : 0;
    const coverage_ok = andMatches || c.total_tokens === 0 || c.tokens_matched >= minCoverage * c.total_tokens;
    return { ...c, in_fts, fts_raw, coverage_ok };
  });
}

/**
 * Rank documents the way cerefox_search_docs does, given chunk scores:
 * a chunk passes if it has a covered keyword match or its vector score clears the
 * gate; if nothing passes, the best chunk of each document is returned instead and
 * the result is flagged below confidence (at most 3 then). A document's score is its
 * best chunk's.
 */
export function rankDocuments(view: KeywordView[], scores: Map<string, number>, gates: Gates, count: number): RankedDocs {
  const flagged = view.map((c) => ({
    c,
    score: scores.get(c.chunk_id) ?? 0,
    passes: (c.in_fts && c.coverage_ok) || c.vec_score >= gates.minScore,
  }));
  const anyPass = flagged.some((f) => f.passes);
  const bestPerDoc = new Map<string, { score: number; passes: boolean }>();
  for (const f of flagged) {
    const prev = bestPerDoc.get(f.c.document_id);
    if (!prev || f.score > prev.score) bestPerDoc.set(f.c.document_id, { score: f.score, passes: f.passes });
  }
  // Mirrors the RPC: chunk-level filter first (passes, or the per-document top chunk
  // when nothing passes), then cerefox_hybrid_search's chunk LIMIT (search_docs asks
  // it for count × 10 chunks), then best score per document. The chunk limit matters:
  // a document whose chunks all rank below the first count × 10 never reaches the
  // document level at all.
  const eligible = flagged
    .filter((f) => f.passes || (!anyPass && bestPerDoc.get(f.c.document_id)!.score === f.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, anyPass ? count * 10 : Math.min(count * 10, 3));
  const kept = new Map<string, number>();
  for (const f of eligible) {
    kept.set(f.c.document_id, Math.max(kept.get(f.c.document_id) ?? -Infinity, f.score));
  }
  const docs = [...kept.entries()]
    .map(([document_id, score]) => ({ document_id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, anyPass ? count : Math.min(count, 3));
  return { docs, below_confidence: !anyPass };
}

/** Today's formula: alpha·cosine + (1 − alpha)·raw ts_rank_cd (unbounded). */
export function linear(name: string, alpha: number, gates: Gates, bound: (r: number) => number): Candidate {
  return {
    name,
    gates,
    score: (view) =>
      new Map(view.map((c) => [c.chunk_id, alpha * c.vec_score + (1 - alpha) * (c.in_fts ? bound(c.fts_raw) : 0)])),
  };
}

export const raw = (r: number) => r;
/** ts_rank_cd normalization 32: rank / (rank + 1), in [0, 1). */
export const bounded = (r: number) => r / (r + 1);

/** Reciprocal-rank fusion: Σ 1/(k + rank) over the keyword and vector lists. */
export function rrf(name: string, k: number, gates: Gates, wVec = 1, wFts = 1): Candidate {
  return {
    name,
    gates,
    score: (view) => {
      const byVec = [...view].sort((a, b) => b.vec_score - a.vec_score);
      const byFts = view.filter((c) => c.in_fts).sort((a, b) => b.fts_raw - a.fts_raw);
      const s = new Map<string, number>();
      byVec.forEach((c, i) => s.set(c.chunk_id, (s.get(c.chunk_id) ?? 0) + wVec / (k + i + 1)));
      byFts.forEach((c, i) => s.set(c.chunk_id, (s.get(c.chunk_id) ?? 0) + wFts / (k + i + 1)));
      return s;
    },
  };
}

export function run(candidate: Candidate, chunks: ChunkSignals[], count = 10): RankedDocs {
  const view = keywordView(chunks, candidate.gates.minCoverage);
  return rankDocuments(view, candidate.score(view), candidate.gates, count);
}
