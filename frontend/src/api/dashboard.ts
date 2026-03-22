import { apiFetch } from "./client";
import type { DashboardResponse } from "./types";

export async function fetchDashboard(): Promise<DashboardResponse> {
  return apiFetch<DashboardResponse>("/dashboard");
}
