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
   * Set when a CEREFOX_* variable on this server overrides the stored value.
   * The DB value is then not what this server actually uses.
   */
  env_override: ConfigEnvOverride | null;
}

export async function fetchConfig(): Promise<{ keys: ConfigEntry[] }> {
  return apiFetch<{ keys: ConfigEntry[] }>("/config");
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
