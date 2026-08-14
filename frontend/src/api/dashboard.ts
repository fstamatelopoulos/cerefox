import { apiFetch } from "./client";
import type { DashboardDoc, DashboardResponse } from "./types";

export async function fetchDashboard(): Promise<DashboardResponse> {
  return apiFetch<DashboardResponse>("/dashboard");
}

/** The recently-changed tile's data, standalone: scoping it to a project must
 *  not re-run the whole dashboard aggregate. */
export async function fetchDashboardRecent(
  projectId?: string,
): Promise<{ recent_docs: DashboardDoc[] }> {
  const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
  return apiFetch<{ recent_docs: DashboardDoc[] }>(`/dashboard/recent-docs${qs}`);
}
