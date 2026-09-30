/**
 * Retrieval metrics for the search-calibration benchmark (iteration 48).
 * Design: docs/specs/search-calibration.md.
 *
 * Pure functions over a ranked list of document keys and graded relevance
 * judgements (2 = the answer, 1 = related, absent = irrelevant). Kept separate
 * from the runner so the arithmetic is unit-tested on its own: a benchmark
 * whose numbers are wrong is worse than no benchmark.
 */

export type Grades = Record<string, number>;

/** Reciprocal rank of the first grade-2 document within the top k; 0 if none. */
export function reciprocalRank(ranked: string[], grades: Grades, k = 10): number {
  const i = ranked.slice(0, k).findIndex((d) => (grades[d] ?? 0) >= 2);
  return i === -1 ? 0 : 1 / (i + 1);
}

/** 1 when the top result is a grade-2 document, else 0. */
export function hitAt1(ranked: string[], grades: Grades): number {
  return ranked.length > 0 && (grades[ranked[0]!] ?? 0) >= 2 ? 1 : 0;
}

/** Share of the relevant documents (grade ≥ 1) found in the top k. */
export function recallAtK(ranked: string[], grades: Grades, k = 5): number {
  const relevant = Object.keys(grades).filter((d) => (grades[d] ?? 0) >= 1);
  if (relevant.length === 0) return 0;
  const top = new Set(ranked.slice(0, k));
  return relevant.filter((d) => top.has(d)).length / relevant.length;
}

/** nDCG@k with gain 2^grade − 1 and log2 discount. */
export function ndcgAtK(ranked: string[], grades: Grades, k = 10): number {
  const gain = (g: number) => 2 ** g - 1;
  const dcg = ranked.slice(0, k).reduce((sum, d, i) => sum + gain(grades[d] ?? 0) / Math.log2(i + 2), 0);
  const ideal = Object.values(grades)
    .filter((g) => g > 0)
    .sort((a, b) => b - a)
    .slice(0, k)
    .reduce((sum, g, i) => sum + gain(g) / Math.log2(i + 2), 0);
  return ideal === 0 ? 0 : dcg / ideal;
}

/** Jaccard similarity of two top-k sets. Two empty sets agree perfectly. */
export function jaccardAtK(a: string[], b: string[], k = 5): number {
  const A = new Set(a.slice(0, k));
  const B = new Set(b.slice(0, k));
  const union = new Set([...A, ...B]);
  if (union.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / union.size;
}

/** Mean pairwise Jaccard@k across the variants of one group. */
export function groupConsistency(rankings: string[][], k = 5): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < rankings.length; i++) {
    for (let j = i + 1; j < rankings.length; j++) {
      sum += jaccardAtK(rankings[i]!, rankings[j]!, k);
      n++;
    }
  }
  return n === 0 ? 1 : sum / n;
}

export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}
