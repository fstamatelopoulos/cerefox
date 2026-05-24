import { apiFetch, buildQueryString } from "./client";
import type { LinkResolveResponse } from "./types";

/**
 * Best-effort resolve a relative markdown link to a Cerefox document.
 *
 * Used by MarkdownLink to make repo-internal markdown links (like
 * `[Quickstart](docs/guides/quickstart.md)` inside README.md) clickable
 * when the document is viewed in the web UI.
 *
 * Returns a typed result the caller uses to decide between:
 *   - matches.length === 1  → navigate
 *   - matches.length  > 1   → show a chooser
 *   - matches.length === 0  → show "couldn't resolve — search?" UX
 *
 * Soft-deleted documents are excluded. `fromDocId` lets the caller suppress
 * self-links so a doc linking back to itself does not dominate the results.
 */
export async function resolveLink(
  path: string,
  fromDocId?: string,
): Promise<LinkResolveResponse> {
  const qs = buildQueryString({ path, from_doc_id: fromDocId });
  return apiFetch<LinkResolveResponse>(`/resolve-link${qs}`);
}
