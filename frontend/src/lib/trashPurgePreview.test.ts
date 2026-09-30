import { describe, expect, test } from "bun:test";

import { purgeCutoff, purgePreviewText } from "./trashPurgePreview";

const now = new Date("2026-10-01T00:00:00Z");
const base = { currentEnabled: "false", currentDays: "60", now };

describe("purgeCutoff", () => {
  test("turning auto-purge on counts against the current period", () => {
    expect(purgeCutoff({ ...base, key: "trash_auto_purge_enabled", value: "true" })).toEqual(
      new Date("2026-08-02T00:00:00Z"),
    );
  });

  test("changing the period while on counts against the NEW period", () => {
    const c = purgeCutoff({ ...base, currentEnabled: "true", key: "trash_retention_days", value: "7" });
    expect(c).toEqual(new Date("2026-09-24T00:00:00Z"));
  });

  test("no preview when the result is off", () => {
    expect(purgeCutoff({ ...base, key: "trash_retention_days", value: "7" })).toBeNull();
    expect(purgeCutoff({ ...base, currentEnabled: "true", key: "trash_auto_purge_enabled", value: "false" })).toBeNull();
  });

  test("no preview for a period the server would refuse to act on", () => {
    for (const v of ["0", "-3", "1.5", "abc", ""]) {
      expect(purgeCutoff({ ...base, currentEnabled: "true", key: "trash_retention_days", value: v })).toBeNull();
    }
  });

  test("unrelated keys have no preview", () => {
    expect(purgeCutoff({ ...base, key: "relations_enabled", value: "true" })).toBeNull();
  });
});

describe("purgePreviewText", () => {
  test("says when nothing is eligible", () => {
    expect(purgePreviewText(0, 60)).toContain("purge nothing");
  });
  test("names the count, and the per-delete cap when it applies", () => {
    expect(purgePreviewText(12, 60)).toContain("all 12");
    expect(purgePreviewText(250, 60)).toContain("100 of them");
  });
});
