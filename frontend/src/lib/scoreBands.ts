/**
 * Search score ring colors (v1.17.4).
 *
 * The color says how strong a result is COMPARED WITH THE BEST CONFIDENT RESULT OF THE
 * SAME SEARCH; the number stays the absolute score. Absolute color bands (v1.17.3) did not
 * work: a score measures how literally the text lines up with the query's words, so it
 * depends on the query's shape more than on how good the match is. Measured on a real
 * store, a correct top result for a one- or two-word query (a name, a place) reached 0.55
 * only a third of the time, while title-shaped queries routinely score 0.65 and up
 * (docs/research/search-quality-study-1.17.md). Relative to the best result, a perfect hit
 * is green whatever the query looks like.
 *
 * What keeps a poor search from looking good is search's own verdict: results flagged
 * below confidence are dimmed, whatever their score, and do not set the reference.
 */

export type ScoreTone = "strong" | "typical" | "weak" | "dim";

/** Share of the best confident score at which a result is still "strong" / "typical". */
export const RELATIVE_BANDS = { strong: 0.9, typical: 0.6 };

export function scoreTone(score: number, opts: { best: number; belowConfidence?: boolean }): ScoreTone {
  if (opts.belowConfidence || opts.best <= 0) return "dim";
  const ratio = score / opts.best;
  if (ratio >= RELATIVE_BANDS.strong) return "strong";
  if (ratio >= RELATIVE_BANDS.typical) return "typical";
  return "weak";
}

/** The reference: the best score among the results search is confident about (0 if none). */
export function bestConfidentScore(results: { score: number; belowConfidence: boolean }[]): number {
  return Math.max(0, ...results.filter((r) => !r.belowConfidence).map((r) => r.score));
}

/**
 * What the ring displays (0 to 1). Bounded modes show the score itself; keyword mode
 * (raw, unbounded ranks) and any pre-0.18 server (scores above 1) show it relative to
 * the best, since an absolute raw rank means nothing to a reader.
 */
export function displayScore(score: number, maxScore: number, relative: boolean): number {
  if (relative && maxScore > 0) return Math.max(0, Math.min(1, score / maxScore));
  return Math.max(0, Math.min(1, score));
}

/** Keyword mode returns raw ranks, and so does a server older than 0.18.0. */
export function isRelativeScale(mode: string, maxScore: number): boolean {
  return mode === "fts" || maxScore > 1;
}
