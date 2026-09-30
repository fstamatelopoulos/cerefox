/**
 * What confirming a trash auto-purge setting would do (#251).
 *
 * The confirmation for `trash_auto_purge_enabled` / `trash_retention_days`
 * must say how many documents ALREADY in the trash the next delete would
 * purge, because that is the irreversible part. Both keys feed the answer, so
 * the one being changed takes its proposed value and the other its current one:
 * shortening the period while auto-purge is on is as consequential as turning
 * it on.
 *
 * Pure, so it is tested without a browser (CI's frontend step runs src/).
 */

export const TRASH_KEYS = ["trash_auto_purge_enabled", "trash_retention_days"] as const;

/** The per-delete cap in cerefox_purge_expired_trash. */
export const SWEEP_CAP = 100;

export interface PurgePreviewInput {
  /** The key being confirmed and its proposed value. */
  key: string;
  value: string;
  /** Current effective values of both keys. */
  currentEnabled: string | null;
  currentDays: string | null;
  now: Date;
}

/**
 * The cutoff to count against (documents trashed before it are eligible), or
 * null when the change leaves auto-purge off or the period is not a whole
 * number of days ≥ 1 (the server would purge nothing).
 */
export function purgeCutoff(input: PurgePreviewInput): Date | null {
  if (!(TRASH_KEYS as readonly string[]).includes(input.key)) return null;
  const enabled = input.key === "trash_auto_purge_enabled" ? input.value : input.currentEnabled;
  const daysText = input.key === "trash_retention_days" ? input.value : input.currentDays;
  if (enabled !== "true") return null;
  const days = Number(daysText);
  if (!Number.isInteger(days) || days < 1) return null;
  return new Date(input.now.getTime() - days * 86_400_000);
}

/** The sentence the confirmation shows, given the eligible count. */
export function purgePreviewText(eligible: number, days: number): string {
  if (eligible === 0) {
    return `Nothing in the trash is older than ${days} day(s) yet, so the next delete will purge nothing.`;
  }
  const now = eligible <= SWEEP_CAP ? `all ${eligible}` : `${SWEEP_CAP} of them, and the rest over the following deletes`;
  return `${eligible} document(s) in the trash are older than ${days} day(s). The next delete will permanently purge ${now}.`;
}
