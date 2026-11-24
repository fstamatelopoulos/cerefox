/**
 * Recognize the error a browser raises when a lazily loaded module of THIS
 * build no longer exists on the server (#381).
 *
 * The page keeps running the bundle it loaded. After an upgrade and restart,
 * the server holds a new build with new hashed file names, so the first
 * `import()` of a chunk the old page never loaded (the Word/PDF export) asks
 * for a file that was deleted. Only a reload helps, and the raw message does
 * not say so. Each engine words it differently.
 */
const STALE_BUNDLE_PATTERNS = [
  /Failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari
  /Unable to preload CSS/i, // Vite's own preload helper
];

export function isStaleBundleError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return STALE_BUNDLE_PATTERNS.some((p) => p.test(message));
}

export const STALE_BUNDLE_TITLE = "Cerefox was updated";
export const STALE_BUNDLE_MESSAGE =
  "This page is from the previous version. Reload the page, then try again.";
