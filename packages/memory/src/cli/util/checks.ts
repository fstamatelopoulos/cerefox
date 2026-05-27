/**
 * Diagnostic checks shared by `cerefox doctor` and `cerefox status`.
 *
 * Each check returns a typed record so the consumer can choose a
 * rendering (table for doctor, one-liner for status, JSON for both).
 * Checks are independent: a failure in one doesn't short-circuit the
 * others — operators want the complete picture in one shot.
 *
 * Designed for v0.5; the Postgres direct-connection check (DDL-capable
 * Session Pooler) is deliberately not yet implemented — v0.5 npm-only
 * users typically don't have CEREFOX_DATABASE_URL set, and the schema
 * deploy still goes via `uv run scripts/db_deploy.py` (port pending in
 * v0.6). The check stub reports "skipped (v0.6)".
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { PKG_VERSION } from "../../meta.ts";
import { loadSettings } from "../../../../../_shared/config/index.ts";
import {
  resolveConfigDir,
  resolveEnvFile,
  USER_STATE_DIR_NAME,
} from "../../../../../_shared/config/index.ts";

export type CheckStatus = "ok" | "warn" | "error" | "skipped";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
}

// ── Individual checks ───────────────────────────────────────────────────────

export function checkBinary(): CheckResult {
  return {
    name: "binary",
    status: "ok",
    detail: process.argv[1] ?? "(unknown)",
  };
}

export function checkRuntime(): CheckResult {
  // Bun and Node both populate process.versions.
  const bun = (process.versions as Record<string, string | undefined>).bun;
  const node = process.versions.node;
  if (bun) {
    return { name: "runtime", status: "ok", detail: `Bun ${bun}` };
  }
  if (node) {
    const major = Number.parseInt(node.split(".")[0], 10);
    if (major < 20) {
      return {
        name: "runtime",
        status: "error",
        detail: `Node ${node} (< 20)`,
        hint: "Cerefox requires Node 20+; upgrade or install Bun.",
      };
    }
    return { name: "runtime", status: "ok", detail: `Node ${node}` };
  }
  return {
    name: "runtime",
    status: "error",
    detail: "Unknown JS runtime (neither Bun nor Node detected).",
  };
}

export function checkVersion(): CheckResult {
  return {
    name: "version",
    status: "ok",
    detail: `cerefox v${PKG_VERSION}`,
  };
}

export function checkConfig(): CheckResult {
  let envPath: string;
  try {
    envPath = resolveEnvFile();
  } catch (err) {
    return {
      name: "config",
      status: "error",
      detail: `Could not resolve config dir: ${err instanceof Error ? err.message : String(err)}`,
      hint: "Run `cerefox init` to bootstrap.",
    };
  }
  if (!existsSync(envPath)) {
    return {
      name: "config",
      status: "error",
      detail: `No config file at ${envPath}`,
      hint: "Run `cerefox init` to create one.",
    };
  }
  // Mode check: warn (not error) if .env is world-readable. UNIX only.
  let modeDetail = "";
  if (process.platform !== "win32") {
    try {
      const mode = statSync(envPath).mode & 0o777;
      if (mode & 0o077) {
        return {
          name: "config",
          status: "warn",
          detail: `${envPath} (mode 0${mode.toString(8)})`,
          hint: `Tighten with: chmod 600 ${envPath}`,
        };
      }
      modeDetail = ` (mode 0${mode.toString(8)})`;
    } catch {
      // Couldn't stat; surface as a warn but don't block.
    }
  }
  return {
    name: "config",
    status: "ok",
    detail: `${envPath}${modeDetail}`,
  };
}

export async function checkSupabase(): Promise<CheckResult> {
  let settings;
  try {
    settings = loadSettings();
  } catch (err) {
    return {
      name: "supabase",
      status: "error",
      detail: `Could not load settings: ${err instanceof Error ? err.message : String(err)}`,
      hint: "Run `cerefox init`.",
    };
  }
  if (!settings.supabaseUrl || !settings.supabaseKey) {
    return {
      name: "supabase",
      status: "error",
      detail: "CEREFOX_SUPABASE_URL or CEREFOX_SUPABASE_KEY is not set.",
      hint: "Run `cerefox init` to bootstrap.",
    };
  }
  try {
    // Use the REST endpoint to verify Data API access. We hit
    // `/rest/v1/cerefox_projects?limit=1` which is cheap and covers
    // auth + schema visibility in one round-trip.
    const url = `${settings.supabaseUrl.replace(/\/$/, "")}/rest/v1/cerefox_projects?select=id&limit=1`;
    const resp = await fetch(url, {
      headers: {
        apikey: settings.supabaseKey,
        Authorization: `Bearer ${settings.supabaseKey}`,
      },
    });
    if (!resp.ok) {
      return {
        name: "supabase",
        status: "error",
        detail: `Data API returned ${resp.status} ${resp.statusText}`,
        hint:
          resp.status === 401
            ? "Verify CEREFOX_SUPABASE_KEY (use the service-role / sb_secret key)."
            : "Verify CEREFOX_SUPABASE_URL.",
      };
    }
    return {
      name: "supabase",
      status: "ok",
      detail: `${settings.supabaseUrl} — Data API reachable`,
    };
  } catch (err) {
    return {
      name: "supabase",
      status: "error",
      detail: `Could not reach Supabase: ${err instanceof Error ? err.message : String(err)}`,
      hint: "Check your network and CEREFOX_SUPABASE_URL.",
    };
  }
}

export async function checkOpenAI(): Promise<CheckResult> {
  const settings = loadSettings();
  if (!settings.openaiApiKey) {
    return {
      name: "openai",
      status: "warn",
      detail: "No OPENAI_API_KEY / CEREFOX_OPENAI_API_KEY set.",
      hint: "Required for `cerefox search` (semantic mode) and ingest. Set in your .env.",
    };
  }
  try {
    // Cheap test embedding — single 4-char input keeps the bill at
    // ~$0.0000000004 per check.
    const resp = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.openaiApiKey}`,
      },
      body: JSON.stringify({
        input: "test",
        model: "text-embedding-3-small",
        dimensions: 768,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      return {
        name: "openai",
        status: "error",
        detail: `OpenAI returned ${resp.status}: ${body.slice(0, 100)}`,
        hint: "Verify the API key and that the model is available on your account.",
      };
    }
    return {
      name: "openai",
      status: "ok",
      detail: "OpenAI text-embedding-3-small — test embedding succeeded",
    };
  } catch (err) {
    return {
      name: "openai",
      status: "error",
      detail: `Could not reach OpenAI: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function checkSchemaVersion(): Promise<CheckResult> {
  const settings = loadSettings();
  if (!settings.supabaseUrl || !settings.supabaseKey) {
    return {
      name: "schema",
      status: "skipped",
      detail: "Supabase config missing; skipped.",
    };
  }
  try {
    const url = `${settings.supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/cerefox_schema_version`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: settings.supabaseKey,
        Authorization: `Bearer ${settings.supabaseKey}`,
      },
      body: "{}",
    });
    if (!resp.ok) {
      return {
        name: "schema",
        status: "error",
        detail: `cerefox_schema_version returned ${resp.status}`,
        hint: "Deploy the schema: `uv run python scripts/db_deploy.py`",
      };
    }
    const deployed = (await resp.json()) as string;
    // Schema version is independent of the npm package version — they
    // ratchet on different cadences. The web UI's mismatch banner
    // (v0.3.0) is for "I rebuilt my server but forgot to redeploy the
    // schema"; the doctor check here just surfaces the deployed value
    // matter-of-factly.
    return {
      name: "schema",
      status: "ok",
      detail: `cerefox_schema_version() → "${deployed}"`,
    };
  } catch (err) {
    return {
      name: "schema",
      status: "error",
      detail: `Schema version probe failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Read `mcpServers.cerefox` from a JSON file, if present. Returns null
 * when the file is missing, malformed, or doesn't have a cerefox entry.
 */
function hasCerefoxInJsonFile(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const mcpServers = parsed.mcpServers as Record<string, unknown> | undefined;
    return Boolean(mcpServers && typeof mcpServers === "object" && "cerefox" in mcpServers);
  } catch {
    return false;
  }
}

export function checkMcpConfigs(): CheckResult {
  // Walk known MCP client config locations and report which ones have
  // a `cerefox` server entry registered.
  //
  // v0.5.4 fix: Claude Code's user-scope MCP servers live in
  // `~/.claude.json` (the dot-file in $HOME) under the `.mcpServers`
  // key, not in `~/.claude/mcp.json`. The latter was scanned through
  // v0.5.3 — a stale file written by the v0.5.0–v0.5.3 configure-agent
  // bug. We now scan the right place.
  const home = homedir();
  const claudeCodeUser = join(home, ".claude.json");
  const claudeCodeProj = join(process.cwd(), ".mcp.json");
  const claudeDesktop =
    process.platform === "darwin"
      ? join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
      : process.platform === "win32"
        ? join(process.env.APPDATA ?? "", "Claude", "claude_desktop_config.json")
        : join(home, ".config", "Claude", "claude_desktop_config.json");

  const found: string[] = [];
  if (hasCerefoxInJsonFile(claudeCodeUser)) found.push("Claude Code (user)");
  if (hasCerefoxInJsonFile(claudeCodeProj)) found.push("Claude Code (proj)");
  if (hasCerefoxInJsonFile(claudeDesktop)) found.push("Claude Desktop");

  if (found.length === 0) {
    return {
      name: "mcp clients",
      status: "warn",
      detail: "No MCP client configs reference Cerefox.",
      hint: "Run `cerefox configure-agent --tool claude-code` (or `--tool claude-desktop`) to wire up a client.",
    };
  }
  return {
    name: "mcp clients",
    status: "ok",
    detail: found.join(", "),
  };
}

/**
 * v0.5.3: when `~/.cerefox/.env` exists AND a different `<cwd>/.env` exists,
 * report the CWD file as a shadowed legacy config. The TS CLI reads the
 * home file (new precedence), but Python's `uv run cerefox …` still reads
 * the CWD file during the migration window — safe to delete in v0.9+.
 *
 * Returns `null` when there's nothing interesting to report (no shadowing,
 * or the two paths resolve to the same physical file via symlink).
 */
export function checkLegacyShadowEnv(): CheckResult | null {
  const home = homedir();
  const homeEnv = join(home, USER_STATE_DIR_NAME, ".env");
  const cwdEnv = join(process.cwd(), ".env");
  if (!existsSync(homeEnv) || !existsSync(cwdEnv)) return null;
  // Same file via symlink? Skip.
  try {
    if (realpathSync(homeEnv) === realpathSync(cwdEnv)) return null;
  } catch {
    // realpath failed on one of them — fall through to reporting.
  }
  return {
    name: "legacy env",
    status: "skipped",
    detail: `${cwdEnv} (shadowed by ~/.cerefox/.env)`,
    hint:
      "Python `uv run cerefox …` still reads this file during the v0.5–v0.7 migration window. " +
      "Safe to delete once Python support is removed (v0.9+).",
  };
}

export function checkPostgres(): CheckResult {
  // v0.5: not yet ported. The Python CLI uses CEREFOX_DATABASE_URL for
  // DDL operations (schema deploy + migrations). For npm-installed users
  // who only need read/write, this check is informational.
  if (process.env.CEREFOX_DATABASE_URL) {
    return {
      name: "postgres",
      status: "skipped",
      detail: "DDL check deferred to v0.6 (use `uv run scripts/db_status.py` for now).",
    };
  }
  return {
    name: "postgres",
    status: "skipped",
    detail: "CEREFOX_DATABASE_URL not set; DDL operations require the Python CLI (v0.5).",
    hint: "Schema deploy: `uv run python scripts/db_deploy.py`.",
  };
}

// ── Aggregations ───────────────────────────────────────────────────────────

/** Full diagnostic — what `cerefox doctor` runs. */
export async function runAllChecks(): Promise<CheckResult[]> {
  const legacy = checkLegacyShadowEnv();
  return [
    checkBinary(),
    checkRuntime(),
    checkVersion(),
    checkConfig(),
    ...(legacy ? [legacy] : []),
    await checkSupabase(),
    await checkOpenAI(),
    await checkSchemaVersion(),
    checkPostgres(),
    checkMcpConfigs(),
  ];
}

/** Fast subset — what `cerefox status` runs. Skips the network probes. */
export async function runFastChecks(): Promise<CheckResult[]> {
  return [
    checkVersion(),
    checkConfig(),
    await checkSupabase(),
  ];
}
