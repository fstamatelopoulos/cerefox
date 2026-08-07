/**
 * Unit tests for the client↔server compatibility matrix (iter-26 Part 26C).
 *
 * Pure logic (compareSemver, classifyCompat) + checkServerCompatibility
 * with a mocked fetch — no network. Live aggregator integration is
 * validated in Part 26G / the staging walk.
 */

import { describe, expect, test } from "bun:test";

// Fixtures track the CURRENT minimum rather than a hardcoded version. These
// tests are about the classification logic — "at the minimum", "below it" — not
// about any particular release, and hardcoding a version means every bump of
// COMPATIBILITY.minSchema breaks them for no real reason (it did, at 1.1.0).
const AT_MIN = () => COMPATIBILITY.minSchema;

import {
  aggregatorUrlFor,
  checkServerCompatibility,
  classifyCompat,
  COMPATIBILITY,
  compareSemver,
} from "../compatibility/index.js";

describe("compareSemver", () => {
  test("orders by major.minor.patch", () => {
    expect(compareSemver("0.6.0", "0.7.0")).toBe(-1);
    expect(compareSemver("0.7.0", "0.6.0")).toBe(1);
    expect(compareSemver("0.7.2", "0.7.2")).toBe(0);
    expect(compareSemver("1.0.0", "0.9.9")).toBe(1);
  });

  test("pre-release sorts below its stable (SemVer §11 — was 'ignored' pre-1.0)", () => {
    expect(compareSemver("0.8.0-rc.1", "0.8.0")).toBe(-1);
    expect(compareSemver("0.8.0-rc.1", "0.7.9")).toBe(1);
  });

  test("treats missing components as 0", () => {
    expect(compareSemver("1", "1.0.0")).toBe(0);
    expect(compareSemver("1.2", "1.2.0")).toBe(0);
  });
});

describe("classifyCompat", () => {
  test("null deployed → unknown", () => {
    expect(classifyCompat(null, "0.6.0")).toBe("unknown");
  });
  test("below minimum → below-min", () => {
    expect(classifyCompat("0.5.0", "0.6.0")).toBe("below-min");
  });
  test("at/above min, no bundled → ok", () => {
    expect(classifyCompat("0.6.0", "0.6.0")).toBe("ok");
    expect(classifyCompat("0.7.0", "0.6.0")).toBe("ok");
  });
  test("above min but below bundled → above-min-but-old", () => {
    expect(classifyCompat("0.6.0", "0.6.0", "0.8.0")).toBe("above-min-but-old");
  });
  test("at bundled → ok", () => {
    expect(classifyCompat("0.8.0", "0.6.0", "0.8.0")).toBe("ok");
  });
});

describe("aggregatorUrlFor", () => {
  test("builds the cerefox-mcp aggregator URL, trimming trailing slash", () => {
    expect(aggregatorUrlFor("https://abc.supabase.co/")).toBe(
      "https://abc.supabase.co/functions/v1/cerefox-mcp/version?peers=true",
    );
    expect(aggregatorUrlFor("https://abc.supabase.co")).toBe(
      "https://abc.supabase.co/functions/v1/cerefox-mcp/version?peers=true",
    );
  });
});

function mockFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("checkServerCompatibility", () => {
  const url = aggregatorUrlFor("https://abc.supabase.co");

  test("skips EF probe when no bearer (not blocking)", async () => {
    const r = await checkServerCompatibility({ aggregatorUrl: url });
    expect(r.efProbeSkipped).toBe(true);
    expect(r.blocking).toBe(false);
    expect(r.edgeFunctions.level).toBe("unknown");
  });

  test("404 aggregator → skipped with pre-0.8 note, not blocking", async () => {
    const r = await checkServerCompatibility({
      aggregatorUrl: url,
      bearer: "eyJ-fake",
      fetchImpl: mockFetch(404, {}),
    });
    expect(r.efProbeSkipped).toBe(true);
    expect(r.blocking).toBe(false);
    expect(r.efSkipReason).toContain("predate v0.8");
  });

  test("405 aggregator (pre-0.8 cerefox-mcp GET behaviour) → skipped, not blocking", async () => {
    const r = await checkServerCompatibility({
      aggregatorUrl: url,
      bearer: "eyJ-fake",
      fetchImpl: mockFetch(405, {}),
    });
    expect(r.efProbeSkipped).toBe(true);
    expect(r.blocking).toBe(false);
    expect(r.efSkipReason).toContain("predate v0.8");
  });

  test("healthy server at bundled versions → all ok, not blocking", async () => {
    const r = await checkServerCompatibility({
      aggregatorUrl: url,
      bearer: "eyJ-fake",
      bundledSchema: AT_MIN(),
      bundledEf: "0.8.0",
      fetchImpl: mockFetch(200, {
        name: "cerefox-mcp",
        version: "0.8.0",
        schema: AT_MIN(),
        efs: [
          { name: "cerefox-search", version: "0.8.0" },
          { name: "cerefox-ingest", version: "0.8.0" },
        ],
        errors: [],
      }),
    });
    expect(r.schema.level).toBe("ok");
    expect(r.edgeFunctions.level).toBe("ok");
    expect(r.edgeFunctions.deployed).toBe("0.8.0");
    expect(r.blocking).toBe(false);
  });

  test("one EF below min → weakest wins → blocking", async () => {
    const r = await checkServerCompatibility({
      aggregatorUrl: url,
      bearer: "eyJ-fake",
      fetchImpl: mockFetch(200, {
        name: "cerefox-mcp",
        version: "0.8.0",
        schema: AT_MIN(),
        efs: [
          { name: "cerefox-search", version: "0.8.0" },
          { name: "cerefox-ingest", version: "0.5.0" }, // stale peer
        ],
        errors: [],
      }),
    });
    expect(r.edgeFunctions.deployed).toBe("0.5.0");
    expect(r.edgeFunctions.level).toBe("below-min");
    expect(r.blocking).toBe(true);
  });

  test("schema below min → blocking", async () => {
    const r = await checkServerCompatibility({
      aggregatorUrl: url,
      bearer: "eyJ-fake",
      fetchImpl: mockFetch(200, {
        name: "cerefox-mcp",
        version: "0.8.0",
        schema: "0.2.0", // below minSchema 0.3.1
        efs: [{ name: "cerefox-search", version: "0.8.0" }],
        errors: [],
      }),
    });
    expect(r.schema.level).toBe("below-min");
    expect(r.blocking).toBe(true);
  });

  test("deployed below bundled but above min → above-min-but-old, not blocking", async () => {
    const r = await checkServerCompatibility({
      aggregatorUrl: url,
      bearer: "eyJ-fake",
      bundledSchema: AT_MIN(),
      bundledEf: "0.9.0",
      fetchImpl: mockFetch(200, {
        name: "cerefox-mcp",
        version: "0.7.0",
        schema: AT_MIN(),
        efs: [{ name: "cerefox-search", version: "0.7.0" }],
        errors: [],
      }),
    });
    expect(r.edgeFunctions.level).toBe("above-min-but-old");
    expect(r.blocking).toBe(false);
  });

  test("matrix constants are semver strings", () => {
    expect(COMPATIBILITY.minSchema).toMatch(/^\d+\.\d+\.\d+/);
    expect(COMPATIBILITY.minEdgeFunctions).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("compareSemver — pre-release precedence (SemVer §11)", () => {
  test("pre-releases order within a line; all below the stable", () => {
    expect(compareSemver("1.0.0-beta.3", "1.0.0-beta.4")).toBe(-1);
    expect(compareSemver("1.0.0-beta.4", "1.0.0-rc.1")).toBe(-1);
    expect(compareSemver("1.0.0-rc.1", "1.0.0")).toBe(-1);
    expect(compareSemver("1.0.0", "1.0.0-beta.9")).toBe(1);
    expect(compareSemver("1.0.0-beta", "1.0.0-beta.1")).toBe(-1);
    expect(compareSemver("0.11.1", "1.0.0-beta.1")).toBe(-1);
    expect(compareSemver("1.0.0-beta.4", "1.0.0-beta.4")).toBe(0);
  });
});
