/**
 * Retention for `cerefox backup create --keep <n>`.
 *
 * Pure: takes the names in the output directory and returns the ones to
 * delete. The caller passes regular files only (no directories), so a
 * subfolder or a `.git` dir can never be selected.
 *
 * A name is a candidate only when it is exactly what `backup create` would
 * write for the same environment and label:
 *
 *   cerefox-[<envLabel>-]<YYYYMMDDTHHMMSSZ>[-<label>].json
 *
 * Scoping is strict on both axes. Without a label only unlabeled snapshots
 * are candidates, so `--keep 14` on a nightly job never eats a hand-made
 * `-before-upgrade` snapshot. The env label is matched too: a staging job
 * writing into a shared folder must not prune production's snapshots.
 */

export interface PruneInput {
  /** Every regular file name in the output directory. */
  filenames: string[];
  /** The snapshot this run just wrote; never deleted. */
  justWritten: string;
  /** Sanitized CEREFOX_ENV_LABEL, or "" when unset. */
  envLabel: string;
  /** The --label value, or undefined. */
  label: string | undefined;
  /** Snapshots to retain, including the one just written. Integer >= 1. */
  keep: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The timestamp a matching name embeds, or null when the name does not match. */
export function snapshotStamp(
  filename: string,
  envLabel: string,
  label: string | undefined,
): string | null {
  const prefix = `cerefox-${envLabel ? escapeRegExp(envLabel) + "-" : ""}`;
  const suffix = `${label ? "-" + escapeRegExp(label) : ""}\\.json`;
  const m = new RegExp(`^${prefix}(\\d{8}T\\d{6}Z)${suffix}$`).exec(filename);
  return m ? m[1] : null;
}

export function snapshotsToPrune(input: PruneInput): string[] {
  const { filenames, justWritten, envLabel, label, keep } = input;
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error(`keep must be an integer >= 1, got ${keep}`);
  }
  const others = filenames
    .filter((name) => name !== justWritten)
    .map((name) => ({ name, stamp: snapshotStamp(name, envLabel, label) }))
    .filter((s): s is { name: string; stamp: string } => s.stamp !== null)
    // Newest first; the fixed-width stamp sorts lexically. Name breaks ties
    // so the result is deterministic.
    .sort((a, b) =>
      a.stamp === b.stamp ? b.name.localeCompare(a.name) : b.stamp.localeCompare(a.stamp),
    );
  // The just-written snapshot takes one of the `keep` slots.
  return others.slice(keep - 1).map((s) => s.name);
}
