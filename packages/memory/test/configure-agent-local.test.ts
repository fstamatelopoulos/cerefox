/**
 * `configure-agent --local` wires the MCP entry to the `cerefox-local mcp` shim
 * (World-B) instead of the npx `cerefox mcp` default, honoring CEREFOX_LOCAL_CMD.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  localCerefoxEntry,
  WRITERS,
  writeMcpConfig,
} from "../src/cli/util/mcp-config-writers.ts";

describe("localCerefoxEntry", () => {
  afterEach(() => {
    delete process.env.CEREFOX_LOCAL_CMD;
  });
  it("defaults to `cerefox-local mcp`", () => {
    expect(localCerefoxEntry()).toEqual({ command: "cerefox-local", args: ["mcp"] });
  });
  it("honors CEREFOX_LOCAL_CMD (absolute path from the host shim)", () => {
    process.env.CEREFOX_LOCAL_CMD = "/Users/x/.cerefox/local/cerefox-local";
    expect(localCerefoxEntry().command).toBe("/Users/x/.cerefox/local/cerefox-local");
  });
});

describe("writeMcpConfig with a --local entry override", () => {
  it("writes the cerefox-local entry (not npx) into a JSON client config", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfx-cfg-"));
    const cfg = join(dir, "mcp.json");
    try {
      const res = writeMcpConfig(WRITERS.cursor, {
        customPath: cfg,
        noBackup: true,
        entry: localCerefoxEntry(),
      });
      expect(res.serverEntry).toEqual({ command: "cerefox-local", args: ["mcp"] });
      const written = JSON.parse(readFileSync(cfg, "utf8")) as {
        mcpServers: { cerefox: { command: string; args: string[] } };
      };
      expect(written.mcpServers.cerefox.command).toBe("cerefox-local");
      expect(written.mcpServers.cerefox.args).toEqual(["mcp"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("defaults to the npx entry when no override is given", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfx-cfg-"));
    const cfg = join(dir, "mcp.json");
    try {
      const res = writeMcpConfig(WRITERS.cursor, { customPath: cfg, noBackup: true });
      expect(res.serverEntry.command).toBe("npx");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
