/**
 * Search score ring colors (v1.17.3).
 *
 * Since schema 0.18.0 hybrid scores are 0 to 1 on every store, so the ring can no
 * longer rescale a list against its top result (which painted the first hit green
 * whatever it scored). The bands below are anchored on the scores of SUCCESSFUL
 * results, measured on real OpenAI stores (docs/research/search-quality-study-1.17.md):
 * when the top result is the right document, about half score 0.55 or more and about
 * 80% score 0.35 or more. So the colors read "strong / typical / weak compared with
 * matches that turned out right". A score alone cannot prove a result right; the
 * below-confidence flag is search's own verdict, and it dims a result whatever its score.
 *
 * The local (nomic) model scores everything higher (about +0.13 at the median on the
 * synthetic vocabulary), so its bands are shifted. They are PROVISIONAL: no populated
 * local store has been measured yet.
 */

export type EmbedderKind = "openai" | "local";
export type ScoreTone = "strong" | "typical" | "weak" | "dim";

export const SCORE_BANDS: Record<EmbedderKind, { strong: number; typical: number }> = {
  openai: { strong: 0.55, typical: 0.35 },
  local: { strong: 0.65, typical: 0.45 }, // provisional, see above
};

/** Keyword-only mode still returns raw, unbounded ranks: those are ranked against the list's best. */
const RELATIVE_BANDS = { strong: 0.7, typical: 0.4 };

export function scoreTone(
  score: number,
  opts: { embedder?: EmbedderKind; relative?: boolean; belowConfidence?: boolean },
): ScoreTone {
  if (opts.belowConfidence) return "dim";
  const bands = opts.relative ? RELATIVE_BANDS : SCORE_BANDS[opts.embedder ?? "openai"];
  if (score >= bands.strong) return "strong";
  if (score >= bands.typical) return "typical";
  return "weak";
}

/**
 * What the ring displays (0 to 1). Bounded modes show the score itself; keyword mode
 * (and any pre-0.18 server, whose scores could exceed 1) shows it relative to the best.
 */
export function displayScore(score: number, maxScore: number, relative: boolean): number {
  if (relative && maxScore > 0) return Math.max(0, Math.min(1, score / maxScore));
  return Math.max(0, Math.min(1, score));
}

/** Keyword mode returns raw ranks, and so does a server older than 0.18.0. */
export function isRelativeScale(mode: string, maxScore: number): boolean {
  return mode === "fts" || maxScore > 1;
}
