/**
 * Optional-feature gating (iteration 29): document relations must be invisible
 * until a deployment opts in. A tool an agent can SEE is a tool an agent may
 * use, so dormancy has to mean hidden, not merely unused.
 */

import { afterEach, describe, expect, test } from "bun:test";

import { ALL_TOOLS, assertToolEnabled, listEnabledTools } from "../mcp-tools/index.ts";
import { resetFeatureFlagCache } from "../mcp-tools/feature-flags.ts";
import type { MCPSupabaseClient } from "../mcp-tools/types.ts";

/** Client whose cerefox_get_config returns the given value (or throws). */
function configClient(value: string | null, opts: { fail?: boolean } = {}): MCPSupabaseClient {
  return {
    rpc: (name: string) => {
      if (name !== "cerefox_get_config") return { data: null, error: null };
      if (opts.fail) return { data: null, error: { message: "boom" } };
      return { data: value, error: null };
    },
  } as unknown as MCPSupabaseClient;
}

const RELATION_TOOLS = [
  "cerefox_set_relation",
  "cerefox_delete_relation",
  "cerefox_get_relations",
  "cerefox_get_neighbors",
];

afterEach(() => resetFeatureFlagCache());

describe("relation tools are hidden by default", () => {
  test("unset config → relation tools are not listed", async () => {
    const names = (await listEnabledTools(configClient(null))).map((t) => t.name);
    for (const t of RELATION_TOOLS) expect(names).not.toContain(t);
    expect(names.length).toBe(ALL_TOOLS.length - RELATION_TOOLS.length);
  });

  test("'false' → hidden", async () => {
    const names = (await listEnabledTools(configClient("false"))).map((t) => t.name);
    expect(names).not.toContain("cerefox_set_relation");
  });

  test("'true' → the full surface appears", async () => {
    const names = (await listEnabledTools(configClient("true"))).map((t) => t.name);
    for (const t of RELATION_TOOLS) expect(names).toContain(t);
    expect(names.length).toBe(ALL_TOOLS.length);
  });

  test("value is parsed leniently but safely", async () => {
    expect((await listEnabledTools(configClient(" TRUE "))).length).toBe(ALL_TOOLS.length);
    resetFeatureFlagCache();
    expect((await listEnabledTools(configClient("yes"))).length).toBe(
      ALL_TOOLS.length - RELATION_TOOLS.length,
    );
  });

  test("a config read failure fails CLOSED, not open", async () => {
    const names = (await listEnabledTools(configClient(null, { fail: true }))).map((t) => t.name);
    expect(names).not.toContain("cerefox_set_relation");
  });

  test("non-gated tools are never affected", async () => {
    const names = (await listEnabledTools(configClient("false"))).map((t) => t.name);
    expect(names).toContain("cerefox_search");
    expect(names).toContain("cerefox_ingest");
    expect(names).toContain("cerefox_get_help");
  });
});

describe("call-path guard", () => {
  test("calling a gated tool while disabled explains how to enable it", async () => {
    await expect(
      assertToolEnabled(configClient("false"), "cerefox_set_relation"),
    ).rejects.toThrow(/relations_enabled true/);
  });

  test("enabled → the call passes the guard", async () => {
    await expect(
      assertToolEnabled(configClient("true"), "cerefox_set_relation"),
    ).resolves.toBeUndefined();
  });

  test("ungated tools skip the check entirely (no config read needed)", async () => {
    const throwing = {
      rpc: () => {
        throw new Error("config should not be consulted for ungated tools");
      },
    } as unknown as MCPSupabaseClient;
    await expect(assertToolEnabled(throwing, "cerefox_search")).resolves.toBeUndefined();
  });
});
