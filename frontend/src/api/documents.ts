import { apiFetch, buildQueryString } from "./client";
import type {
  DocumentChunk,
  DocumentDetail,
  EditResponse,
  FilenameCheckResponse,
  IngestResponse,
} from "./types";

export async function fetchDocument(
  documentId: string,
  versionId?: string,
): Promise<DocumentDetail> {
  const qs = buildQueryString({ version_id: versionId });
  return apiFetch<DocumentDetail>(`/documents/${documentId}${qs}`);
}

export async function fetchChunks(
  documentId: string,
): Promise<DocumentChunk[]> {
  return apiFetch<DocumentChunk[]>(`/documents/${documentId}/chunks`);
}

export async function editDocument(
  documentId: string,
  data: {
    title: string;
    content: string;
    project_ids: string[];
    metadata: Record<string, unknown>;
    /** Optimistic-concurrency token: the content_hash the document was
     * loaded with. A concurrent change → HTTP 409 (iter-32). */
    expected_content_hash?: string | null;
  },
): Promise<EditResponse> {
  return apiFetch<EditResponse>(`/documents/${documentId}/edit`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteDocument(
  documentId: string,
): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/documents/${documentId}`, {
    method: "DELETE",
  });
}

export async function ingestPaste(data: {
  title: string;
  content: string;
  update_existing: boolean;
  project_ids: string[];
  metadata: Record<string, unknown>;
}): Promise<IngestResponse> {
  return apiFetch<IngestResponse>("/ingest", {
    method: "POST",
    body: JSON.stringify({ mode: "paste", ...data }),
  });
}

export async function checkFilename(
  filename: string,
): Promise<FilenameCheckResponse> {
  const qs = buildQueryString({ filename });
  return apiFetch<FilenameCheckResponse>(`/check-filename${qs}`);
}

export async function fetchDocumentVersion(
  documentId: string,
  versionId: string,
): Promise<DocumentDetail> {
  return apiFetch<DocumentDetail>(
    `/documents/${documentId}?version_id=${versionId}`,
  );
}

export function getDownloadUrl(
  documentId: string,
  versionId?: string,
): string {
  const base = `/api/v1/documents/${documentId}/download`;
  if (versionId) return `${base}?version_id=${versionId}`;
  return base;
}
