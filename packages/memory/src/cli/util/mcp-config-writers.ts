/**
 * MCP client config writers.
 *
 * Each supported client has its own config-file location and JSON
 * shape, but the contract is the same: read the existing file (if any),
 * back it up to `<file>.pre-cerefox.bak`, merge the Cerefox server
 * config into the `mcpServers` block, write back.
 *
 * The merge is non-destructive: existing server entries are preserved;
 * only the `cerefox` key is overwritten (or added).
 *
 * Phase 1 (v0.5): Claude Code + Claude Desktop. Cursor + Codex + Gemini
 * ship in v0.5.x or v0.6 — adding one means adding a `Writer` entry to
 * `WRITERS` below.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

export interface ConfigWriter {
  /** Stable client identifier used as the --tool flag value. */
  id: "claude-code" | "claude-desktop";
  /** Human-readable label for log lines. */
  label: string;
  /** Resolved absolute path to the config file the writer manages. */
  configPath: string;
  /**
   * Build the JSON the writer needs to set under
   * `mcpServers.cerefox` (or equivalent path). Returns the value, not
   * a partial — the merge code installs it under the right key.
   */
  buildServerEntry: () => Record<string, unknown>;
}

/**
 * Cerefox MCP server entry. Same shape for both Claude Code and Desktop.
 *
 * v0.5.1: switched from invoking the legacy `cerefox-mcp` bin (dropped
 * in v0.5.1) to invoking the canonical `cerefox` bin with the `mcp`
 * subcommand. The third positional arg `mcp` is passed to the bin as
 * argv[1] — same MCP server, one bin to maintain.
 */
function defaultCerefoxEntry(): Record<string, unknown> {
  return {
    command: "npx",
    args: ["-y", "--package=@cerefox/memory", "cerefox", "mcp"],
  };
}

function claudeCodeConfigPath(): string {
  return join(homedir(), ".claude", "mcp.json");
}

function claudeDesktopConfigPath(): string {
  const home = homedir();
  if (platform() === "darwin") {
    return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (platform() === "win32") {
    return join(process.env.APPDATA ?? home, "Claude", "claude_desktop_config.json");
  }
  return join(home, ".config", "Claude", "claude_desktop_config.json");
}

export const WRITERS: Record<string, ConfigWriter> = {
  "claude-code": {
    id: "claude-code",
    label: "Claude Code",
    configPath: claudeCodeConfigPath(),
    buildServerEntry: defaultCerefoxEntry,
  },
  "claude-desktop": {
    id: "claude-desktop",
    label: "Claude Desktop",
    configPath: claudeDesktopConfigPath(),
    buildServerEntry: defaultCerefoxEntry,
  },
};

export interface WriteResult {
  configPath: string;
  backupPath: string | null;
  action: "created" | "merged" | "replaced";
  serverEntry: Record<string, unknown>;
}

/**
 * Merge a Cerefox server entry into the target client's config file.
 *
 * - If the file doesn't exist: create it with `mcpServers.cerefox = entry`.
 * - If it exists: back it up to `<file>.pre-cerefox.bak` (unless
 *   `noBackup`), merge into `mcpServers`, write back. Preserves all
 *   other content.
 *
 * `customPath` overrides the writer's default location (used by tests
 * + the `--config-path` flag).
 */
export function writeMcpConfig(
  writer: ConfigWriter,
  opts: { customPath?: string; noBackup?: boolean; dryRun?: boolean } = {},
): WriteResult {
  const configPath = opts.customPath ?? writer.configPath;
  const entry = writer.buildServerEntry();

  // Ensure parent dir exists (Claude Desktop ones can be missing).
  if (!opts.dryRun) mkdirSync(dirname(configPath), { recursive: true });

  let existing: Record<string, unknown> = {};
  let action: WriteResult["action"] = "created";
  let backupPath: string | null = null;

  if (existsSync(configPath)) {
    try {
      existing = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
      action = (existing.mcpServers as Record<string, unknown> | undefined)?.cerefox
        ? "replaced"
        : "merged";
    } catch {
      // Malformed JSON — treat as no existing config, but still back up
      // the broken file so the user can recover.
      action = "replaced";
    }
    if (!opts.noBackup && !opts.dryRun) {
      backupPath = configPath + ".pre-cerefox.bak";
      copyFileSync(configPath, backupPath);
    }
  }

  const mcpServers =
    (existing.mcpServers && typeof existing.mcpServers === "object"
      ? (existing.mcpServers as Record<string, unknown>)
      : {}) ?? {};
  mcpServers.cerefox = entry;
  existing.mcpServers = mcpServers;

  if (!opts.dryRun) {
    writeFileSync(configPath, JSON.stringify(existing, null, 2) + "\n", "utf8");
  }

  return { configPath, backupPath, action, serverEntry: entry };
}
