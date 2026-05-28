/**
 * Unit tests for `_shared/ingest/pipeline-helpers.ts`.
 *
 * Covers normalize+hash parity with Python, source_path derivation
 * from titles, and the project-id resolution precedence (issue #38).
 */

import { describe, expect, test } from "bun:test";

import {
  contentHash,
  deriveSourcePath,
  normalizeForHash,
  resolveProjectIds,
} from "../ingest/pipeline-helpers.js";

describe("normalizeForHash", () => {
  test("CRLF → LF", () => {
    expect(normalizeForHash("a\r\nb")).toBe("a\nb");
  });
  test("bare CR → LF", () => {
    expect(normalizeForHash("a\rb")).toBe("a\nb");
  });
  test("strips leading + trailing whitespace", () => {
    expect(normalizeForHash("  hello\n  ")).toBe("hello");
  });
  test("collapses 3+ newlines to 2", () => {
    expect(normalizeForHash("a\n\n\n\nb")).toBe("a\n\nb");
    expect(normalizeForHash("a\n\n\nb")).toBe("a\n\nb");
    // 2 newlines stay 2
    expect(normalizeForHash("a\n\nb")).toBe("a\n\nb");
  });
  test("full Python parity for the canonical edit-form input", () => {
    // Browser textareas submit CRLF; we trim and collapse.
    const input = "  # Title\r\n\r\n\r\n\r\nBody.\r\n\r\n";
    expect(normalizeForHash(input)).toBe("# Title\n\nBody.");
  });
});

describe("contentHash", () => {
  test("returns 64-char lowercase hex", () => {
    const h = contentHash("hello");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
  test("CRLF input matches LF input (normalization)", () => {
    expect(contentHash("a\r\nb")).toBe(contentHash("a\nb"));
  });
  test("trailing whitespace doesn't affect the hash", () => {
    expect(contentHash("hello\n\n\n")).toBe(contentHash("hello"));
  });
  test("byte-equal Python reference for known input", () => {
    // sha256("hello") = 2cf24...; but we hash normalize("hello") = "hello".
    // Computed via: python -c 'import hashlib; print(hashlib.sha256("hello".encode()).hexdigest())'
    expect(contentHash("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
});

describe("deriveSourcePath", () => {
  test("simple title → kebab-case .md", () => {
    expect(deriveSourcePath("My Note")).toBe("my-note.md");
  });
  test("strips punctuation", () => {
    expect(deriveSourcePath("Hello, World!")).toBe("hello-world.md");
  });
  test("collapses multiple separators", () => {
    expect(deriveSourcePath("a  b__c--d")).toBe("a-b-c-d.md");
  });
  test("strips leading/trailing dashes", () => {
    expect(deriveSourcePath("--Hello--")).toBe("hello.md");
  });
  test("empty / all-stripped → 'document.md'", () => {
    expect(deriveSourcePath("")).toBe("document.md");
    expect(deriveSourcePath("!!!")).toBe("document.md");
  });
  test("preserves unicode word chars", () => {
    // café gets kept (\p{L} matches letters).
    expect(deriveSourcePath("Café notes")).toBe("café-notes.md");
  });
});

describe("resolveProjectIds — issue #38 precedence", () => {
  const mockGetOrCreate = async (name: string) => ({
    id: `id-of-${name}`,
  });

  test("(1) projectIds wins over all others", async () => {
    const out = await resolveProjectIds(
      {
        projectIds: ["a", "b"],
        projectNames: ["should-be-ignored"],
        projectId: "ignored",
        projectName: "ignored",
      },
      mockGetOrCreate,
    );
    expect(out).toEqual(["a", "b"]);
  });

  test("(1) projectIds filters empties", async () => {
    const out = await resolveProjectIds(
      { projectIds: ["a", "", "b", ""] },
      mockGetOrCreate,
    );
    expect(out).toEqual(["a", "b"]);
  });

  test("(2) projectNames resolves via getOrCreate", async () => {
    const out = await resolveProjectIds(
      { projectNames: ["foo", "bar"] },
      mockGetOrCreate,
    );
    expect(out).toEqual(["id-of-foo", "id-of-bar"]);
  });

  test("(2) projectNames skips empties", async () => {
    const out = await resolveProjectIds(
      { projectNames: ["foo", "", "bar"] },
      mockGetOrCreate,
    );
    expect(out).toEqual(["id-of-foo", "id-of-bar"]);
  });

  test("(3) projectId (singular UUID) wrapped in list", async () => {
    const out = await resolveProjectIds(
      { projectId: "my-id" },
      mockGetOrCreate,
    );
    expect(out).toEqual(["my-id"]);
  });

  test("(4) projectName (singular name) resolved + wrapped", async () => {
    const out = await resolveProjectIds(
      { projectName: "my-project" },
      mockGetOrCreate,
    );
    expect(out).toEqual(["id-of-my-project"]);
  });

  test("nothing provided → empty list", async () => {
    const out = await resolveProjectIds({}, mockGetOrCreate);
    expect(out).toEqual([]);
  });

  test("empty projectIds list is honored (means 'set to nothing')", async () => {
    // Distinct from undefined (means 'unchanged'). Caller-side semantics.
    const out = await resolveProjectIds(
      { projectIds: [] },
      mockGetOrCreate,
    );
    expect(out).toEqual([]);
  });
});
