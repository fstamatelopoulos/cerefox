import { apiFetch } from "./client";
import type { DashboardResponse } from "./types";

export async function fetchDashboard(projectId?: string): Promise<DashboardResponse> {
  const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
  return apiFetch<DashboardResponse>(`/dashboard${qs}`);
}
