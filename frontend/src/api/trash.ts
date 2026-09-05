import { apiFetch, apiFetchResponse } from "./client";

export interface DeletedDocument {
  id: string;
  title: string;
  source: string | null;
  chunk_count: number;
  total_chars: number;
  /** Absent when the review workflow is off (#241). */
  review_status?: string;
  deleted_at: string;
  updated_at: string | null;
  /** Projects the document belonged to before deletion (junction is preserved). */
  project_ids: string[];
}

/** The server caps a trash listing at this many rows; `total` is exact regardless. */
export const TRASH_LIST_CAP = 500;

export interface TrashPage {
  /** The `limit` most recently deleted documents. */
  rows: DeletedDocument[];
  /** How many documents are in the trash in total (`X-Total-Count`). */
  total: number;
}

export async function fetchTrash(limit = TRASH_LIST_CAP): Promise<TrashPage> {
  const resp = await apiFetchResponse(`/documents/trash?limit=${limit}`);
  const rows = (await resp.json()) as DeletedDocument[];
  const header = Number(resp.headers.get("X-Total-Count"));
  // A server older than v1.14.1 sends no header: the page is all we know.
  return { rows, total: Number.isFinite(header) && header >= rows.length ? header : rows.length };
}

export async function restoreDocument(documentId: string): Promise<void> {
  await apiFetch(`/documents/${documentId}/restore`, { method: "POST" });
}

/**
 * Permanent delete. `purged: false` means the document was no longer in the
 * trash when the call landed (restored meanwhile) and is still live. A server
 * older than v1.14.0 omits the field; treated as purged.
 */
export async function purgeDocument(documentId: string): Promise<{ purged: boolean }> {
  const r = await apiFetch<{ success: boolean; purged?: boolean }>(`/documents/${documentId}/purge`, {
    method: "DELETE",
  });
  return { purged: r.purged ?? true };
}
