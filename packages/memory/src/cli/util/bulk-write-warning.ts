/**
 * Warn before a bulk rewrite large enough to strain a small Postgres instance.
 *
 * Reported by a contributor (@tdebasis) after reindexing a ~1,300-document
 * store on Supabase: the project depleted its **Disk IO Budget**, and Supabase
 * emailed to say response times would degrade, CPU would rise on IO wait, and
 * the instance could become unresponsive. Nothing was corrupted — but a user
 * who runs a maintenance command and then finds their database crawling
 * deserves to have been told first.
 *
 * `migrate-format` is the heavier of the two: every document is re-chunked,
 * its previous chunks are archived as a version snapshot, and new rows are
 * inserted — several writes per document, against a shared IO budget.
 *
 * This is advisory only. It never blocks: the operator's store, the operator's
 * call. It exists so the trade-off is visible *before* the run rather than in a
 * support email afterwards.
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
