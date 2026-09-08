/**
 * What the browser tab says (#253).
 *
 * The distinguishing part is the whole title and the app name is dropped:
 * tabs truncate from the right, so "Cerefox: My Document" collapses to
 * "Cerefox: My Do…" and every tab looks the same. The favicon already says
 * which app this is.
 */

/** Long document titles get cut here; a tab shows far less than this anyway. */
export const TITLE_MAX = 60;

export function truncateTitle(text: string, max = TITLE_MAX): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

export interface PageTitleParts {
  /** The page-specific part. Empty or absent means the app name alone. */
  page?: string | null;
  /** Unsaved changes: shown the way editors do, with a leading dot. */
  dirty?: boolean;
}

/** The full `document.title` string for a page. */
export function pageTitle({ page, dirty }: PageTitleParts): string {
  const base = page?.trim() ? truncateTitle(page) : "Cerefox";
  return `${dirty ? "• " : ""}${base}`;
}
