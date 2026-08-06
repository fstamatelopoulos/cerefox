/**
 * Warn before a bulk rewrite large enough to strain a small Postgres instance.
 *
 * **Provenance, corrected.** This warning was originally added because a
 * contributor's Supabase project depleted its Disk IO Budget after a large
 * reindex, and the reindex looked like the cause. It was not. The real cause
 * was an infinite retry loop: `cerefox_ingest_document` raised its
 * optimistic-concurrency conflict under SQLSTATE 40001 (serialization_failure),
 * which promises "transient, retry me", so retry-aware infrastructure replayed
 * a permanently-failing request ~47 million times over about a day. That is
 * fixed at the source (PT409 → HTTP 409; see `rpcs.sql` and migration 0015),
 * and it had nothing to do with bulk rewrites.
 *
 * The warning is kept because the underlying point stands on its own: rewriting
 * thousands of rows on a small instance is genuinely heavy, and an operator
 * about to do it deserves to know. But the thresholds are now set for "this is
 * objectively a large job", not for a scale that was wrongly blamed for an
 * incident.
 *
 * `migrate-format` is the heavier of the two: every document is re-chunked, its
 * previous chunks are archived as a version snapshot, and new rows are
 * inserted — several writes per document, versus one embedding update per chunk
 * for reindex.
 *
 * Advisory only. It never blocks: the operator's store, the operator's call.
 */

import { c, println } from "../../../../../_shared/cli-core/index.ts";

export interface BulkWriteWarningOptions {
  /** How many units of work (documents / chunks) this run will write. */
  count: number;
  /** Warn at or above this count. */
  threshold: number;
  /** What the count measures, e.g. "document" or "chunk". */
  unit: string;
  /** How to split the work, phrased as an action, e.g. "run it in batches with `--limit 200`". */
  batchHint: string;
}

/** Returns true when a warning was printed. */
export function warnLargeBulkWrite(opts: BulkWriteWarningOptions): boolean {
  if (opts.count < opts.threshold) return false;

  println("");
  println(
    c.yellow("⚠ ") +
      `${opts.count.toLocaleString()} ${opts.unit}(s) is a large bulk rewrite.`,
  );
  println(
    c.dim(
      "  On Supabase (especially the free tier and small compute add-ons) this can\n" +
        "  deplete the project's Disk IO Budget. Symptoms: slower responses, CPU\n" +
        "  climbing on IO wait, and in the worst case a briefly unresponsive\n" +
        "  instance. It recovers on its own once the budget refills.",
    ),
  );
  println(
    c.dim(
      `  Gentler: ${opts.batchHint}, leaving time between runs and ideally\n` +
        "  picking a quiet period. The work is resumable — re-run to continue.",
    ),
  );
  println("");
  return true;
}
