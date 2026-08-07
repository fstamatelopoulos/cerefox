import { apiFetch } from "./client";

export interface ConfigEnvOverride {
  name: string;
  value: string;
}

export interface ConfigEntry {
  key: string;
  /** Stored value, or null when the row is absent (the default applies). */
  value: string | null;
  /** What takes effect: the stored value, else the default. */
  effective: string;
  description: string;
  kind: "boolean" | "number" | "string";
  default: string;
  min: number | null;
  max: number | null;
  group: string;
  /** Flipping this changes what other software sees; confirm before writing. */
  high_impact: boolean;
  impact_note: string | null;
  /** The retired CEREFOX_* variable that used to control this key, if any. */
  env_var?: string | null;
  /**
   * Set when that retired variable is still present in the server's
   * environment. It no longer does anything — the value shown here is what
   * runs — but a stale line that looks applied is worth flagging.
   */
  retired_env_set?: ConfigEnvOverride | null;
}

export interface ConfigListResponse {
  keys: ConfigEntry[];
  /** Path to the .env this server read, so the UI can point at it. */
  config_file: string | null;
}

export async function fetchConfig(): Promise<ConfigListResponse> {
  return apiFetch<ConfigListResponse>("/config");
}

export async function setConfigValue(
  key: string,
  value: string,
): Promise<{ key: string; value: string }> {
  return apiFetch<{ key: string; value: string }>(`/config/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
}
