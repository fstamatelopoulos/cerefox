import { apiFetch } from "./client";

export type ThemePref = "auto" | "light" | "dark";

export interface Preferences {
  theme: ThemePref;
}

export async function fetchPreferences(): Promise<Preferences> {
  return apiFetch<Preferences>("/preferences");
}

export async function savePreferences(prefs: Preferences): Promise<void> {
  await apiFetch("/preferences", {
    method: "PUT",
    body: JSON.stringify(prefs),
  });
}
