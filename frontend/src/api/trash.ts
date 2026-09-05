import { apiFetch } from "./client";

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

export async function fetchTrash(limit = 50): Promise<DeletedDocument[]> {
  return apiFetch<DeletedDocument[]>(`/documents/trash?limit=${limit}`);
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
