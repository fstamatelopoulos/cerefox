import { apiFetch, buildQueryString, downloadApiFile, fetchApiFile, saveBlob } from "./client";
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
    /** The metadata_revision the document was loaded with: this form replaces
     * the metadata, so a tag changed elsewhere meanwhile → HTTP 409 (#333). */
    expected_metadata_revision?: number | null;
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
  /** Sent with update_existing (#298): see IngestPage. */
  last_write_wins?: boolean;
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

export type DownloadFormat = "md" | "docx" | "pdf";

/**
 * Download the document (or one stored version of it) as Markdown, Word or PDF.
 *
 * Word and PDF are converted in the browser from the same Markdown download,
 * so they carry its file name and version, and work on a gated server. The
 * converters load only when asked for.
 */
export async function downloadDocument(
  documentId: string,
  versionId?: string,
  format: DownloadFormat = "md",
  title = "document",
): Promise<void> {
  const base = `/documents/${documentId}/download`;
  const path = versionId ? `${base}?version_id=${versionId}` : base;
  if (format === "md") return downloadApiFile(path, "document.md");

  const { blob, filename } = await fetchApiFile(path, "document.md");
  const markdown = await blob.text();
  const { withExtension } = await import("../lib/export/markdown");
  const out =
    format === "docx"
      ? await (await import("../lib/export/docx")).markdownToDocx(markdown, title)
      : await (await import("../lib/export/pdf")).markdownToPdf(markdown, title);
  saveBlob(out, withExtension(filename, format));
}
