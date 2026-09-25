/**
 * Unit tests for cerefox_export.ts pure helpers (iter-26 Part 26M).
 *
 * `slugify` + `uniqueFilename` are deterministic and importable (the
 * script guards `main()` behind `import.meta.main`). The live export
 * (DB → markdown files) is exercised in the staging walk; here we cover
 * the filename logic that decides on-disk layout.
 */

import { describe, expect, test } from "bun:test";

import { renderMetadata, slugify, uniqueFilename } from "../../scripts/cerefox_export.ts";

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

// ── Metadata sidecar (#286) ──────────────────────────────────────────────────

describe("renderMetadata", () => {
  const base = {
    document_id: "11111111-2222-3333-4444-555555555555",
    doc_title: "Cerefox Access Paths",
    doc_source: "cerefox-self-docs",
    content_hash: "a".repeat(64),
    created_at: "2026-03-21T06:25:55.720796+00:00",
    updated_at: "2026-08-15T21:37:04.277583+00:00",
    total_chars: 18_572,
    chunk_count: 5,
    review_status: "pending_review",
    doc_metadata: { type: "agent-guide", topic: "access-paths" },
  };

  test("renders the identity, timings and the concurrency token", () => {
    const out = renderMetadata(base, ["Cerefox"], { showReview: true });
    expect(out).toContain("# Cerefox Access Paths — metadata");
    expect(out).toContain(base.document_id);
    expect(out).toContain("| Created | 2026-03-21T06:25:55.720796+00:00 |");
    expect(out).toContain("| Updated | 2026-08-15T21:37:04.277583+00:00 |");
    // The hash is what makes an exported copy usable as the basis of an update.
    expect(out).toContain(base.content_hash);
    expect(out).toContain("expected_content_hash");
  });

  test("lists EVERY project, not just the folder this copy is in", () => {
    // A document in three projects is written three times, and a copy that named
    // only its own folder would misreport where the document lives.
    const out = renderMetadata(
      { ...base, doc_project_names: ["Zeta", "Alpha"] },
      ["Alpha"],
      { showReview: true },
    );
    expect(out).toContain("| Projects | Alpha, Zeta |");
  });

  test("omits review status when the store has the workflow off", () => {
    // With the flag off the field is absent from every other surface (#241), so
    // an export that printed it would be the one place a reader saw a value the
    // store has disclaimed.
    expect(renderMetadata(base, [], { showReview: true })).toContain("Review status");
    expect(renderMetadata(base, [], { showReview: false })).not.toContain("Review status");
  });

  test("a pipe in a value cannot break the table", () => {
    const out = renderMetadata(
      { ...base, doc_title: "A | B", doc_metadata: { note: "x | y" } },
      [],
      { showReview: false },
    );
    // Escaped, so the row still has the cell count the renderer intended.
    expect(out).toContain("A \\| B");
    expect(out).toContain("x \\| y");
  });

  test("says so plainly when there are no metadata keys", () => {
    const out = renderMetadata({ ...base, doc_metadata: {} }, [], { showReview: false });
    expect(out).toContain("_No metadata keys._");
  });

  test("a sidecar name cannot silently overwrite a real document", () => {
    // The hazard is real and present in the store: a document titled
    // "… and Lifecycle Metadata" slugifies to `…-lifecycle-metadata`, which is
    // exactly the sidecar name for a document titled "… and Lifecycle". Sharing
    // the uniqueness domain is what stops one clobbering the other.
    const used = new Set<string>();
    const contentA = uniqueFilename(slugify("Iteration 18 Design Lifecycle"), used);
    const sidecarA = uniqueFilename(`${contentA.replace(/\.md$/, "")}-metadata`, used);
    const contentB = uniqueFilename(slugify("Iteration 18 Design Lifecycle Metadata"), used);
    expect(contentA).toBe("iteration-18-design-lifecycle.md");
    expect(sidecarA).toBe("iteration-18-design-lifecycle-metadata.md");
    // B wanted the same name as A's sidecar and was given a distinct one.
    expect(contentB).not.toBe(sidecarA);
    expect(new Set([contentA, sidecarA, contentB]).size).toBe(3);
  });
});
