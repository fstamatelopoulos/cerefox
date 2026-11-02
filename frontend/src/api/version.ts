import { apiFetch } from "./client";

export interface VersionInfo {
  version: string;
  git_commit_short: string | null;
  build_date: string | null;
  /**
   * `CEREFOX_ENV_LABEL` — names a non-production environment (e.g. "staging").
   * Null on a normal install, which is the overwhelmingly common case, so
   * nothing is rendered unless the operator explicitly opted in.
   */
  env_label?: string | null;
  /** The newest release on npm, as the server last checked it (#323). */
  latest?: string | null;
  /** True when `latest` is newer than `version`. */
  update_available?: boolean;
  /** What to run to upgrade, when the server knows; null inside a container (#360). */
  update_command?: string | null;
}

export async function fetchVersion(): Promise<VersionInfo> {
  return apiFetch<VersionInfo>("/version");
}
