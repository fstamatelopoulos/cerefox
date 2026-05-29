/**
 * Unit tests for the shared Edge Function metadata helpers (iter-26 Part 26B).
 *
 * These cover the pure, runtime-agnostic helpers (request-shape detection,
 * URL derivation, the version constant + peer list). The live EF behaviour
 * (actual `GET /version` responses + the cerefox-mcp aggregator probing
 * peers) is validated against a deployed Supabase in Part 26G / the staging
 * walk — those paths need a running Deno EF + network.
 */

import { describe, expect, test } from "bun:test";

import {
  EF_VERSION,
  isVersionRequest,
  PEER_EF_NAMES,
  peerVersionUrl,
  versionResponse,
  wantsPeers,
} from "../ef-meta/index.js";

describe("ef-meta constants", () => {
  test("EF_VERSION is a semver string", () => {
    expect(EF_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("PEER_EF_NAMES lists the 8 non-mcp EFs (excludes cerefox-mcp)", () => {
    expect(PEER_EF_NAMES).toHaveLength(8);
    expect(PEER_EF_NAMES).not.toContain("cerefox-mcp");
    expect(PEER_EF_NAMES).toContain("cerefox-search");
    expect(PEER_EF_NAMES).toContain("cerefox-list-projects");
    // All entries follow the cerefox-* naming.
    for (const name of PEER_EF_NAMES) {
      expect(name.startsWith("cerefox-")).toBe(true);
    }
  });
});

describe("isVersionRequest", () => {
  test("true for GET on a /version path", () => {
    const req = new Request("https://x.supabase.co/functions/v1/cerefox-search/version", {
      method: "GET",
    });
    expect(isVersionRequest(req)).toBe(true);
  });

  test("true for the aggregator query form", () => {
    const req = new Request(
      "https://x.supabase.co/functions/v1/cerefox-mcp/version?peers=true",
      { method: "GET" },
    );
    expect(isVersionRequest(req)).toBe(true);
  });

  test("false for POST even on /version", () => {
    const req = new Request("https://x.supabase.co/functions/v1/cerefox-search/version", {
      method: "POST",
    });
    expect(isVersionRequest(req)).toBe(false);
  });

  test("false for GET on a non-version path", () => {
    const req = new Request("https://x.supabase.co/functions/v1/cerefox-search", {
      method: "GET",
    });
    expect(isVersionRequest(req)).toBe(false);
  });
});

describe("wantsPeers", () => {
  test("true only when ?peers=true", () => {
    expect(
      wantsPeers(new Request("https://x/cerefox-mcp/version?peers=true")),
    ).toBe(true);
    expect(wantsPeers(new Request("https://x/cerefox-mcp/version"))).toBe(false);
    expect(
      wantsPeers(new Request("https://x/cerefox-mcp/version?peers=false")),
    ).toBe(false);
  });
});

describe("peerVersionUrl", () => {
  test("derives a peer /version URL from a cerefox-mcp request URL", () => {
    const reqUrl =
      "https://abc.supabase.co/functions/v1/cerefox-mcp/version?peers=true";
    expect(peerVersionUrl(reqUrl, "cerefox-search")).toBe(
      "https://abc.supabase.co/functions/v1/cerefox-search/version",
    );
  });

  test("works when the incoming path is the bare cerefox-mcp (no /version)", () => {
    const reqUrl = "https://abc.supabase.co/functions/v1/cerefox-mcp";
    expect(peerVersionUrl(reqUrl, "cerefox-ingest")).toBe(
      "https://abc.supabase.co/functions/v1/cerefox-ingest/version",
    );
  });

  test("preserves origin + functions base path", () => {
    const reqUrl = "http://localhost:54321/functions/v1/cerefox-mcp/version?peers=true";
    expect(peerVersionUrl(reqUrl, "cerefox-metadata")).toBe(
      "http://localhost:54321/functions/v1/cerefox-metadata/version",
    );
  });
});

describe("versionResponse", () => {
  test("returns 200 JSON with {name, version}", async () => {
    const resp = versionResponse("cerefox-search", { "Content-Type": "application/json" });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { name: string; version: string };
    expect(body.name).toBe("cerefox-search");
    expect(body.version).toBe(EF_VERSION);
  });
});
