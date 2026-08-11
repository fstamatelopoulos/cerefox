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

import { mcpServerName, WRITERS } from "../src/cli/util/mcp-config-writers.ts";

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

describe("a labelled entry pins its own config directory (review bug_010)", () => {
  // Naming the entry `cerefox-staging` is only half the job. MCP clients spawn
  // the stdio server with the CLIENT's environment, not the shell where
  // configure-agent ran — and a GUI client launched from the dock has no shell
  // environment at all. Without an env on the entry, CEREFOX_CONFIG_DIR is
  // absent at spawn time, resolveConfigDir falls back to ~/.cerefox, and the
  // entry labelled "staging" quietly serves PRODUCTION.
  //
  // That is worse than the bug #168 fixed: the old behaviour clobbered the
  // production entry visibly, whereas this leaves both in place, both looking
  // right, both writing to production.
  const entryFor = (id: string) => WRITERS[id].buildServerEntry();

  test("production entries carry no env at all", () => {
    delete process.env.CEREFOX_ENV_LABEL;
    const e = entryFor("cursor");
    expect(e.env).toBeUndefined();
    // Byte-identical to what every existing install already has.
    expect(e.command).toBe("npx");
  });

  test("a labelled entry carries the resolved config dir and the label", () => {
    process.env.CEREFOX_ENV_LABEL = "staging";
    const e = entryFor("cursor");
    expect(e.env).toBeDefined();
    expect(e.env!.CEREFOX_CONFIG_DIR).toBeTruthy();
    expect(e.env!.CEREFOX_ENV_LABEL).toBe("staging");
  });

  test("the Claude Code delegation passes env before the -- separator", () => {
    // After `--`, `--env` would be parsed as an argument to the spawned command
    // rather than by `claude mcp add`, leaving Claude Code users as the only
    // ones still silently on production.
    process.env.CEREFOX_ENV_LABEL = "staging";
    const w = WRITERS["claude-code"];
    const argv = w.delegated!(w.buildServerEntry());
    const sep = argv.args.indexOf("--");
    const envAt = argv.args.indexOf("--env");
    expect(envAt).toBeGreaterThan(-1);
    expect(envAt).toBeLessThan(sep);
    expect(argv.args[envAt + 1]).toMatch(/^CEREFOX_CONFIG_DIR=/);
  });
});
