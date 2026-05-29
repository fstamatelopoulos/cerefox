/**
 * Unit tests for cerefox_export.ts pure helpers (iter-26 Part 26M).
 *
 * `slugify` + `uniqueFilename` are deterministic and importable (the
 * script guards `main()` behind `import.meta.main`). The live export
 * (DB → markdown files) is exercised in the staging walk; here we cover
 * the filename logic that decides on-disk layout.
 */

import { describe, expect, test } from "bun:test";

import { slugify, uniqueFilename } from "../../scripts/cerefox_export.ts";

describe("slugify", () => {
  test("lowercases + replaces spaces/punctuation with single dashes", () => {
    expect(slugify("My Great Doc")).toBe("my-great-doc");
    expect(slugify("Foo: Bar / Baz!")).toBe("foo-bar-baz");
  });

  test("trims leading/trailing dashes", () => {
    expect(slugify("  hello  ")).toBe("hello");
    expect(slugify("***wow***")).toBe("wow");
  });

  test("caps length at 80 chars (no trailing dash)", () => {
    const long = "a".repeat(200);
    const s = slugify(long);
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s.endsWith("-")).toBe(false);
  });

  test("falls back to 'untitled' for empty/punctuation-only input", () => {
    expect(slugify("")).toBe("untitled");
    expect(slugify("!!!")).toBe("untitled");
  });

  test("handles unicode by stripping to ascii", () => {
    expect(slugify("Café résumé")).toBe("cafe-resume");
  });
});

describe("uniqueFilename", () => {
  test("first use → <slug>.md", () => {
    const used = new Set<string>();
    expect(uniqueFilename("notes", used)).toBe("notes.md");
  });

  test("collisions get -2, -3 suffixes", () => {
    const used = new Set<string>();
    expect(uniqueFilename("notes", used)).toBe("notes.md");
    expect(uniqueFilename("notes", used)).toBe("notes-2.md");
    expect(uniqueFilename("notes", used)).toBe("notes-3.md");
  });

  test("tracks per-set independently", () => {
    const a = new Set<string>();
    const b = new Set<string>();
    expect(uniqueFilename("x", a)).toBe("x.md");
    expect(uniqueFilename("x", b)).toBe("x.md"); // different folder → fresh
  });
});
