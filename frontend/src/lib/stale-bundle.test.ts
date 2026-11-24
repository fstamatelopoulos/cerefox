import { describe, expect, test } from "bun:test";

import { isStaleBundleError } from "./stale-bundle";

describe("isStaleBundleError (#381)", () => {
  test.each([
    // The exact report: Chromium, an export chunk deleted by an upgrade.
    "Failed to fetch dynamically imported module: http://127.0.0.1:8000/app/assets/markdown-D6ZljOkv.js",
    "error loading dynamically imported module: http://localhost:8000/app/assets/docx-abc.js",
    "Importing a module script failed.",
    "Unable to preload CSS for /app/assets/pdf-x.css",
  ])("recognizes %p", (message) => {
    expect(isStaleBundleError(new TypeError(message))).toBe(true);
  });

  test("a plain string is checked too", () => {
    expect(isStaleBundleError("Failed to fetch dynamically imported module: x")).toBe(true);
  });

  test.each([
    "Failed to fetch",
    "HTTP 404: Not found",
    "Document not found",
    "NetworkError when attempting to fetch resource.",
  ])("leaves an ordinary failure alone: %p", (message) => {
    expect(isStaleBundleError(new Error(message))).toBe(false);
  });

  test("non-errors are not stale bundles", () => {
    expect(isStaleBundleError(undefined)).toBe(false);
    expect(isStaleBundleError({ message: 42 })).toBe(false);
  });
});
