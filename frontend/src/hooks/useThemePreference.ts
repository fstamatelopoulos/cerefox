import { useMantineColorScheme } from "@mantine/core";
import { useEffect, useSyncExternalStore } from "react";

import { fetchPreferences, savePreferences, type ThemePref } from "../api/preferences";
import { getApiKey, subscribeApiKey } from "../lib/apiKey";

/**
 * Color-scheme state with two storage layers (mirrors cfcf's useTheme):
 *   1. Mantine's own localStorage — per-browser fast path; drives the
 *      first paint with no flash before this hook runs.
 *   2. ~/.cerefox/web-prefs.json (via /api/v1/preferences) — durable,
 *      machine-local source reconciled on mount; survives cache clears.
 *
 * "auto" follows the OS. Server wins on mount when the two disagree.
 */
export function useThemePreference(): { theme: ThemePref; setTheme: (t: ThemePref) => void } {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  // On a gated server the read at mount is refused until the key is entered
  // (#346), so it runs again when a key appears.
  const hasKey = useSyncExternalStore(subscribeApiKey, () => getApiKey() !== null);

  useEffect(() => {
    let cancelled = false;
    fetchPreferences()
      .then((p) => {
        if (!cancelled && p.theme && p.theme !== colorScheme) setColorScheme(p.theme);
      })
      .catch(() => {
        /* offline / not configured: keep the localStorage value */
      });
    return () => {
      cancelled = true;
    };
    // Run on mount and when a key appears; later changes go through setTheme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasKey]);

  const setTheme = (next: ThemePref) => {
    setColorScheme(next);
    savePreferences({ theme: next }).catch(() => {
      /* ignore: localStorage already captured the choice */
    });
  };

  return { theme: colorScheme as ThemePref, setTheme };
}
