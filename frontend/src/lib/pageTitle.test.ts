/**
 * Browser tab titles (#253), tested without a browser.
 *
 * The rule the tests encode: the page's own name IS the title, and the app
 * name is not repeated in front of it.
 */
import { describe, expect, test } from "bun:test";

import { pageTitle, truncateTitle, TITLE_MAX } from "./pageTitle";

describe("pageTitle", () => {
  test("a page's own name is the whole title; the app name is not repeated", () => {
    // Tabs truncate from the right, so "Cerefox: X" would make every tab look
    // identical. The favicon identifies the app.
    expect(pageTitle({ page: "Trash" })).toBe("Trash");
    expect(pageTitle({ page: "Contact - Josh Cohen" })).toBe("Contact - Josh Cohen");
  });

  test("no page (the dashboard, or data still loading) falls back to the app name", () => {
    expect(pageTitle({})).toBe("Cerefox");
    expect(pageTitle({ page: null })).toBe("Cerefox");
    expect(pageTitle({ page: "   " })).toBe("Cerefox");
  });

  test("unsaved changes show a leading dot", () => {
    expect(pageTitle({ page: "Editing: Notes", dirty: true })).toBe("• Editing: Notes");
    expect(pageTitle({ page: "Editing: Notes" })).toBe("Editing: Notes");
  });

  test("long titles are truncated, so the tab never carries a whole heading", () => {
    const long = "A".repeat(TITLE_MAX + 40);
    const out = pageTitle({ page: long });
    expect(out.length).toBe(TITLE_MAX);
    expect(out.endsWith("…")).toBe(true);
  });

  test("truncation collapses whitespace and does not leave a dangling space", () => {
    expect(truncateTitle("  spaced   out  ")).toBe("spaced out");
    expect(truncateTitle("word ".repeat(30)).endsWith(" …")).toBe(false);
  });

  test("a title exactly at the limit is left alone", () => {
    const exact = "B".repeat(TITLE_MAX);
    expect(truncateTitle(exact)).toBe(exact);
  });
});
