/**
 * The MCP server name must follow CEREFOX_ENV_LABEL (#168).
 *
 * Agent config files are global, and every environment registered under the
 * fixed name `cerefox`, so running `configure-agent` from a staging checkout
 * silently repointed every production agent at staging. It was documented as
 * "don't run this against staging", which is a warning rather than a guard.
 *
 * The default must stay exactly `cerefox`: this is a global key, so a change
 * there would orphan every existing installation's entry.
 */

import { afterEach, describe, expect, test } from "bun:test";

import { mcpServerName } from "../src/cli/util/mcp-config-writers.js";

const original = process.env.CEREFOX_ENV_LABEL;
afterEach(() => {
  if (original === undefined) delete process.env.CEREFOX_ENV_LABEL;
  else process.env.CEREFOX_ENV_LABEL = original;
});

describe("mcpServerName (#168)", () => {
  test("unset label keeps the historical name", () => {
    delete process.env.CEREFOX_ENV_LABEL;
    expect(mcpServerName()).toBe("cerefox");
  });

  test("a blank or whitespace label is not a label", () => {
    // A stray `CEREFOX_ENV_LABEL=` in a .env must not produce `cerefox-`.
    process.env.CEREFOX_ENV_LABEL = "   ";
    expect(mcpServerName()).toBe("cerefox");
    process.env.CEREFOX_ENV_LABEL = "";
    expect(mcpServerName()).toBe("cerefox");
  });

  test("a label suffixes the name, so both can coexist", () => {
    process.env.CEREFOX_ENV_LABEL = "staging";
    expect(mcpServerName()).toBe("cerefox-staging");
  });

  test("labels are slugged to stay valid as a TOML bare key and a CLI argument", () => {
    // Codex writes `[mcp_servers.<name>]`, and the claude-code path passes the
    // name as an argv element — both break on spaces and punctuation.
    process.env.CEREFOX_ENV_LABEL = "Pre Prod!";
    expect(mcpServerName()).toBe("cerefox-pre-prod");
    process.env.CEREFOX_ENV_LABEL = "--";
    expect(mcpServerName()).toBe("cerefox");
  });
});
