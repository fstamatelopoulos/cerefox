import { apiFetch } from "./client";

export interface DeletedDocument {
  id: string;
  title: string;
  source: string | null;
  chunk_count: number;
  total_chars: number;
  review_status: string;
  deleted_at: string;
  updated_at: string | null;
}

export async function fetchTrash(limit = 50): Promise<DeletedDocument[]> {
  return apiFetch<DeletedDocument[]>(`/documents/trash?limit=${limit}`);
}

export async function restoreDocument(documentId: string): Promise<void> {
  await apiFetch(`/documents/${documentId}/restore`, { method: "POST" });
}

export async function purgeDocument(documentId: string): Promise<void> {
  await apiFetch(`/documents/${documentId}/purge`, { method: "DELETE" });
}
