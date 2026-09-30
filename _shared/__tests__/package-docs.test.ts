/**
 * Which guides ship in the npm package (and so in the Cerefox Local image).
 *
 * `bundle_package_docs.ts` used to copy a hand-written list of 15 guides, and
 * every guide written after it was left out — including `api.md` and
 * `securing-local-access.md`, so a store could not serve its own API guide
 * (#303). Every guide now ships unless GUIDE_EXCLUSIONS names it with a reason.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { GUIDE_EXCLUSIONS, guidesToBundle } from "../../scripts/bundle_package_docs.ts";

const GUIDES_DIR = join(import.meta.dir, "..", "..", "docs", "guides");
const guides = readdirSync(GUIDES_DIR).filter((n) => n.endsWith(".md"));

describe("bundled guides", () => {
  test("every guide ships unless excluded, so bundled + excluded is the whole directory", () => {
    const bundled = guidesToBundle(readdirSync(GUIDES_DIR));
    expect(bundled.length + Object.keys(GUIDE_EXCLUSIONS).length).toBe(guides.length);
    expect(guides.length).toBeGreaterThanOrEqual(19); // the detector still sees the directory
  });

  test("the four the hand-written list lost are bundled", () => {
    const bundled = guidesToBundle(guides);
    for (const g of ["api.md", "securing-local-access.md", "linking.md", "staging-env.md"]) {
      expect({ g, bundled: bundled.includes(g) }).toEqual({ g, bundled: true });
    }
  });

  test("every exclusion names a guide that exists, with a real reason", () => {
    // Both directions: a deleted guide must not leave a stale excuse behind for
    // a future guide of the same name.
    for (const [name, reason] of Object.entries(GUIDE_EXCLUSIONS)) {
      expect({ name, exists: guides.includes(name) }).toEqual({ name, exists: true });
      expect(reason.trim().length).toBeGreaterThan(20);
    }
  });

  test("an exclusion actually excludes", () => {
    // The filter must honour the map; checked with a synthetic name so it holds
    // while the real map is empty.
    (GUIDE_EXCLUSIONS as Record<string, string>)["__probe__.md"] = "synthetic, for this test only";
    try {
      expect(guidesToBundle(["a.md", "__probe__.md", "notes.txt"])).toEqual(["a.md"]);
    } finally {
      delete (GUIDE_EXCLUSIONS as Record<string, string>)["__probe__.md"];
    }
  });
});
