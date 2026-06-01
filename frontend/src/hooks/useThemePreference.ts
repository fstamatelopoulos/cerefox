import { useMantineColorScheme } from "@mantine/core";
import { useEffect } from "react";

import { fetchPreferences, savePreferences, type ThemePref } from "../api/preferences";

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
    // Run once on mount; later changes go through setTheme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTheme = (next: ThemePref) => {
    setColorScheme(next);
    savePreferences({ theme: next }).catch(() => {
      /* ignore: localStorage already captured the choice */
    });
  };

  return { theme: colorScheme as ThemePref, setTheme };
}
