/**
 * MCP client config writers.
 *
 * Two implementation kinds, per client:
 *
 *   - **direct-write**: the writer manages a JSON config file directly
 *     (read existing → back up to `<file>.pre-cerefox.bak` → merge the
 *     Cerefox server entry into `mcpServers` → write back). Used for
 *     **Claude Desktop**, which has no dedicated CLI helper for editing
 *     its config.
 *
 *   - **delegated**: the writer shells out to the target client's own
 *     CLI to register the server (e.g. `claude mcp add --scope user`).
 *     The target CLI knows its own config schema and stable storage
 *     location, so delegating is future-proof and avoids the risk of
 *     corrupting a large user-config file. Used for **Claude Code**.
 *     A defensive backup of the canonical user-config (`~/.claude.json`)
 *     is taken before invoking the delegated CLI.
 *
 * v0.5.0–v0.5.3 history: the Claude Code writer was direct-write to
 * `~/.claude/mcp.json` — but that's not a path Claude Code reads. The
 * canonical Claude Code user-scope config is `~/.claude.json` (a
 * dot-file in `$HOME`) under the `mcpServers` key. v0.5.4 switches the
 * Claude Code writer to delegated (`claude mcp add --scope user`) so
 * the target client manages its own config. See the Cerefox Decision
 * Log entry "2026-05-27 — v0.5.4 claude-code writer shell-out" for the
 * rationale.
 *
 * Phase 1 (v0.5): Claude Code + Claude Desktop. Cursor + Codex + Gemini
 * ship in v0.5.x or v0.6 — adding one means adding a `Writer` entry to
 * `WRITERS` below.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

export type WriterKind = "direct-write" | "delegated";
export type WriterFormat = "json" | "toml";

export interface ConfigWriter {
  /** Stable client identifier used as the --tool flag value. */
  id: "claude-code" | "claude-desktop" | "cursor" | "codex" | "gemini";
  /** Human-readable label for log lines. */
  label: string;
  /**
   * "direct-write": this writer manages the config file itself.
   * "delegated": this writer shells out to the target client's CLI.
   */
  kind: WriterKind;
  /**
   * Wire format the config file uses. Defaults to "json"; "toml" is set
   * for Codex CLI (R1 default plan — extends the writer with file
   * format support so a single direct-write path serves both JSON and
   * TOML clients).
   */
  format?: WriterFormat;
  /**
   * For direct-write: absolute path the writer manages.
   * For delegated: the canonical path that the delegated CLI typically
   * updates (used for the defensive backup and for the doctor check).
   */
  configPath: string;
  /**
   * The MCP server JSON entry — `{ command, args }`. Same shape for both
   * kinds; the dispatcher decides how to install it.
   */
  buildServerEntry: () => { command: string; args: string[] };
  /**
   * For delegated writers: the external command + args used to register
   * the server. The first element is the executable; remaining elements
   * are its arguments. Resolved into a full command line at run time.
   */
  delegated?: (entry: { command: string; args: string[] }) => { cmd: string; args: string[] };
}

/**
 * Cerefox MCP server entry.
 *
 * v0.5.1: switched from invoking the legacy `cerefox-mcp` bin (dropped
 * in v0.5.1) to invoking the canonical `cerefox` bin with the `mcp`
 * subcommand.
 *
 * Uses the npx form (rather than direct `cerefox mcp`) so the MCP client
 * doesn't need cerefox on its launch PATH — npx resolves from the npm
 * cache regardless of shell PATH augmentations.
 */
function defaultCerefoxEntry(): { command: string; args: string[] } {
  return {
    command: "npx",
    args: ["-y", "--package=@cerefox/memory", "cerefox", "mcp"],
  };
}

/**
 * MCP server entry for the LOCAL / self-hosted (World-B) backend: launch the
 * host `cerefox-local` shim, which proxies `mcp` (stdio) into the Docker
 * container. The command path is overridable via `CEREFOX_LOCAL_CMD` (the
 * `cerefox-local configure-agent` host path passes the resolved absolute path so
 * MCP clients with a minimal PATH still find it). Used when `--local` is passed.
 */
export function localCerefoxEntry(): { command: string; args: string[] } {
  return {
    command: process.env.CEREFOX_LOCAL_CMD || "cerefox-local",
    args: ["mcp"],
  };
}

function claudeCodeUserConfigPath(): string {
  // Claude Code's user-scope config — the single dot-file in $HOME.
  // `~/.claude/` is a directory for Claude Code's caches and history,
  // NOT for MCP servers.
  return join(homedir(), ".claude.json");
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

/** Build the `claude mcp add ...` argv for the Claude Code delegation. */
function claudeCodeDelegated(entry: { command: string; args: string[] }): { cmd: string; args: string[] } {
  // `claude mcp add <name> --scope user -- <cmd> [args...]`
  return {
    cmd: "claude",
    args: ["mcp", "add", mcpServerName(), "--scope", "user", "--", entry.command, ...entry.args],
  };
}

function cursorConfigPath(): string {
  return join(homedir(), ".cursor", "mcp.json");
}

function codexConfigPath(): string {
  return join(homedir(), ".codex", "config.toml");
}

function geminiConfigPath(): string {
  return join(homedir(), ".gemini", "settings.json");
}

export const WRITERS: Record<string, ConfigWriter> = {
  "claude-code": {
    id: "claude-code",
    label: "Claude Code",
    kind: "delegated",
    configPath: claudeCodeUserConfigPath(),
    buildServerEntry: defaultCerefoxEntry,
    delegated: claudeCodeDelegated,
  },
  "claude-desktop": {
    id: "claude-desktop",
    label: "Claude Desktop",
    kind: "direct-write",
    configPath: claudeDesktopConfigPath(),
    buildServerEntry: defaultCerefoxEntry,
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    kind: "direct-write",
    format: "json",
    configPath: cursorConfigPath(),
    buildServerEntry: defaultCerefoxEntry,
  },
  codex: {
    id: "codex",
    label: "OpenAI Codex CLI",
    kind: "direct-write",
    format: "toml",
    configPath: codexConfigPath(),
    buildServerEntry: defaultCerefoxEntry,
  },
  gemini: {
    id: "gemini",
    label: "Gemini CLI",
    kind: "direct-write",
    format: "json",
    configPath: geminiConfigPath(),
    buildServerEntry: defaultCerefoxEntry,
  },
};

export interface WriteResult {
  configPath: string;
  backupPath: string | null;
  action: "created" | "merged" | "replaced" | "delegated";
  serverEntry: { command: string; args: string[] };
  /** For delegated writers: the command line we invoked (for logging). */
  delegatedCommand?: string;
}

/**
 * Merge a Cerefox server entry into the target client's config.
 *
 * `customPath` overrides the writer's default file location (used by
 * tests + the `--config-path` flag). When `customPath` is provided AND
 * the writer is `delegated`, this falls back to a direct write at
 * `customPath` — the override is treated as "write here, skip the
 * delegated CLI". This keeps the legacy test path working.
 */
export interface WriteOpts {
  customPath?: string;
  noBackup?: boolean;
  dryRun?: boolean;
  /** Override the MCP server entry (e.g. the local `cerefox-local mcp` shim). */
  entry?: { command: string; args: string[] };
}

export function writeMcpConfig(writer: ConfigWriter, opts: WriteOpts = {}): WriteResult {
  // --config-path always wins. If the writer is delegated but the user
  // (or a test) asked for a specific file, do a direct write there.
  if (opts.customPath) {
    return directWrite({ ...writer, kind: "direct-write" }, opts.customPath, opts);
  }
  if (writer.kind === "delegated") {
    return delegatedWrite(writer, opts);
  }
  return directWrite(writer, writer.configPath, opts);
}

function directWrite(
  writer: ConfigWriter,
  configPath: string,
  opts: WriteOpts,
): WriteResult {
  const entry = opts.entry ?? writer.buildServerEntry();
  const format = writer.format ?? "json";

  if (!opts.dryRun) mkdirSync(dirname(configPath), { recursive: true });

  let existing: Record<string, unknown> = {};
  let action: WriteResult["action"] = "created";
  let backupPath: string | null = null;

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf8");
      existing =
        format === "toml"
          ? (parseToml(raw) as Record<string, unknown>)
          : (JSON.parse(raw) as Record<string, unknown>);
      action = hasCerefoxEntry(existing, format) ? "replaced" : "merged";
    } catch {
      // Malformed config — treat as no existing config, but still back up
      // the broken file so the user can recover.
      action = "replaced";
    }
    if (!opts.noBackup && !opts.dryRun) {
      backupPath = configPath + ".pre-cerefox.bak";
      copyFileSync(configPath, backupPath);
    }
  }

  // Codex uses a snake_case TOML table name (`[mcp_servers.cerefox]`);
  // every JSON-format client we support uses `mcpServers`.
  const serversKey = format === "toml" ? "mcp_servers" : "mcpServers";
  const servers =
    (existing[serversKey] && typeof existing[serversKey] === "object"
      ? (existing[serversKey] as Record<string, unknown>)
      : {}) ?? {};
  servers[mcpServerName()] = entry;
  existing[serversKey] = servers;

  if (!opts.dryRun) {
    const body =
      format === "toml"
        ? stringifyToml(existing) + "\n"
        : JSON.stringify(existing, null, 2) + "\n";
    writeFileSync(configPath, body, "utf8");
  }

  return { configPath, backupPath, action, serverEntry: entry };
}

/**
 * The MCP server name to register under (#168).
 *
 * Agent config files are GLOBAL — `~/.claude.json`, `~/.codex/config.toml`,
 * Claude Desktop's config — and every environment registered under the same
 * fixed name `cerefox`. So running `configure-agent` from a staging checkout
 * silently overwrote the production entry and repointed every agent at
 * staging, with no indication that it had happened. It was documented as
 * "don't run this against staging", which is a warning, not a guard.
 *
 * `CEREFOX_ENV_LABEL` already marks non-production environments everywhere
 * else (the web banner, `doctor`'s title line, backup filenames), so it names
 * the server too: `cerefox-staging` sits alongside `cerefox` instead of
 * replacing it, and an agent can hold both at once — which is the point, since
 * exercising MCP behaviour against a pre-release server is exactly why staging
 * exists.
 *
 * Unset (the default, and every production install) → `cerefox`, unchanged.
 */
export function mcpServerName(): string {
  const label = (process.env.CEREFOX_ENV_LABEL ?? "").trim();
  if (!label) return "cerefox";
  // Config keys and CLI arguments both have to accept it, so keep it to the
  // characters that are safe unquoted in a TOML bare key.
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `cerefox-${slug}` : "cerefox";
}

function hasCerefoxEntry(
  existing: Record<string, unknown>,
  format: WriterFormat,
): boolean {
  const key = format === "toml" ? "mcp_servers" : "mcpServers";
  const servers = existing[key];
  return (
    typeof servers === "object" &&
    servers !== null &&
    (servers as Record<string, unknown>)[mcpServerName()] !== undefined
  );
}

/**
 * Shell out to the target client's CLI (e.g. `claude mcp add ...`).
 *
 * Takes a defensive backup of the writer's canonical configPath BEFORE
 * invoking the delegated CLI, so the user has a recovery point if the
 * external CLI behaves unexpectedly.
 *
 * Throws if the delegated CLI isn't on PATH or returns a non-zero exit.
 */
function delegatedWrite(
  writer: ConfigWriter,
  opts: WriteOpts,
): WriteResult {
  if (!writer.delegated) {
    throw new Error(`${writer.label}: kind=delegated but no delegated() factory`);
  }
  const entry = opts.entry ?? writer.buildServerEntry();
  const { cmd, args } = writer.delegated(entry);
  const delegatedCommand = `${cmd} ${args.join(" ")}`;

  if (opts.dryRun) {
    return {
      configPath: writer.configPath,
      backupPath: null,
      action: "delegated",
      serverEntry: entry,
      delegatedCommand,
    };
  }

  // Defensive backup of the canonical user-config — the delegated CLI
  // typically updates this file. Even if it writes elsewhere, having a
  // pre-cerefox snapshot of $HOME/.claude.json is cheap insurance.
  let backupPath: string | null = null;
  if (!opts.noBackup && existsSync(writer.configPath)) {
    backupPath = writer.configPath + ".pre-cerefox.bak";
    copyFileSync(writer.configPath, backupPath);
  }

  // Invoke the delegated CLI synchronously, inheriting stdio so the user
  // sees its messages directly.
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new Error(
        `${writer.label}: \`${cmd}\` not found on PATH. ` +
          `Install ${writer.label} (https://docs.claude.com/en/docs/claude-code) ` +
          `and re-run \`cerefox configure-agent --tool ${writer.id}\`.`,
      );
    }
    throw new Error(`${writer.label}: failed to spawn \`${cmd}\`: ${err.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${writer.label}: \`${delegatedCommand}\` exited with status ${result.status ?? "unknown"}. ` +
        `Check the output above; you may need to update or re-authenticate ${writer.label}.`,
    );
  }

  return {
    configPath: writer.configPath,
    backupPath,
    action: "delegated",
    serverEntry: entry,
    delegatedCommand,
  };
}
