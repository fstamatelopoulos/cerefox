import { apiFetch, buildQueryString } from "./client";

export interface UsageLogEntry {
  id: string;
  logged_at: string;
  operation: string;
  access_path: string;
  requestor: string | null;
  document_id: string | null;
  doc_title: string | null;
  project_id: string | null;
  query_text: string | null;
  result_count: number | null;
  extra: Record<string, unknown>;
}

export interface UsageSummary {
  total_count: number;
  ops_by_day: Array<{ day: string; count: number }>;
  ops_by_operation: Array<{ operation: string; count: number }>;
  ops_by_access_path: Array<{ access_path: string; count: number }>;
  top_documents: Array<{ document_id: string; doc_title: string; count: number }>;
  top_requestors: Array<{ requestor: string; count: number }>;
}

export interface UsageFilters {
  start?: string;
  end?: string;
  operation?: string;
  access_path?: string;
  project_id?: string;
}

export async function fetchUsageSummary(filters: UsageFilters = {}): Promise<UsageSummary> {
  const qs = buildQueryString({ ...filters } as Record<string, string | number | undefined>);
  return apiFetch<UsageSummary>(`/usage-log/summary${qs}`);
}

export async function fetchUsageLog(
  filters: UsageFilters & { limit?: number } = {},
): Promise<UsageLogEntry[]> {
  const qs = buildQueryString({ ...filters, limit: filters.limit ?? 100 } as Record<string, string | number | undefined>);
  return apiFetch<UsageLogEntry[]>(`/usage-log${qs}`);
}

export function getUsageExportUrl(filters: UsageFilters = {}): string {
  const qs = buildQueryString({ ...filters } as Record<string, string | number | undefined>);
  return `/api/v1/usage-log/export.csv${qs}`;
}

export async function getConfig(key: string): Promise<string | null> {
  const data = await apiFetch<{ key: string; value: string | null }>(`/config/${key}`);
  return data.value;
}

export async function setConfig(key: string, value: string): Promise<void> {
  await apiFetch(`/config/${key}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
}
