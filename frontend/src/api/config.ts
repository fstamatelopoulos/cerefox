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
  /**
   * Name of the CEREFOX_* variable that CAN override this key on a given
   * machine, or null if the key has no local override. Always reported, so the
   * escape hatch is discoverable before it surprises anyone.
   */
  env_var?: string | null;
  /**
   * Set when that variable IS overriding the stored value on this server —
   * meaning the DB value is not what this server actually uses.
   */
  env_override: ConfigEnvOverride | null;
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
