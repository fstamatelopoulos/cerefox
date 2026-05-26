import { apiFetch } from "./client";

export interface VersionInfo {
  version: string;
  git_commit_short: string | null;
  build_date: string | null;
}

export async function fetchVersion(): Promise<VersionInfo> {
  return apiFetch<VersionInfo>("/version");
}
