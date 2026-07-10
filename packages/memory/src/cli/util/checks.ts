/**
 * Diagnostic checks shared by `cerefox doctor` and `cerefox status`.
 *
 * Each check returns a typed record so the consumer can choose a
 * rendering (table for doctor, one-liner for status, JSON for both).
 * Checks are independent: a failure in one doesn't short-circuit the
 * others — operators want the complete picture in one shot.
 *
 * v0.7.1: `checkPostgres` runs a real DDL connectivity probe via the
 * `postgres` (Porsager) lib — the same client `scripts/db_deploy.ts`
 * and `scripts/db_migrate.ts` use. `runAllChecks` / `runFastChecks`
 * accept an `onProgress` callback so callers can drive a spinner.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { PKG_VERSION } from "../../meta.ts";
import { EF_VERSION } from "../../../../../_shared/ef-meta/index.ts";
import { loadSettings } from "../../../../../_shared/config/index.ts";
import {
  resolveConfigDir,
  resolveEnvFile,
  USER_STATE_DIR_NAME,
} from "../../../../../_shared/config/index.ts";
import {
  aggregatorUrlFor,
  checkServerCompatibility,
  classifyCompat,
  COMPATIBILITY,
} from "../../../../../_shared/compatibility/index.ts";
import { resolveServerAssets } from "../../../../../_shared/server-assets/index.ts";

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

/** Matches the `-- @version: X.Y.Z` marker at the top of schema.sql. */
const SCHEMA_VERSION_RE = /^--\s*@version:\s*(\S+)/m;

/** Read the schema version this client bundles (from the schema.sql header). */
function readBundledSchemaVersion(): string | null {
  try {
    const assets = resolveServerAssets();
    if (!existsSync(assets.schemaFile)) return null;
    const m = readFileSync(assets.schemaFile, "utf8").match(SCHEMA_VERSION_RE);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const SCHEMA_CHECK_NAME = "schema + RPCs";

export async function checkSchemaVersion(): Promise<CheckResult> {
  const settings = loadSettings();
  if (!settings.supabaseUrl || !settings.supabaseKey) {
    return {
      name: SCHEMA_CHECK_NAME,
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
        name: SCHEMA_CHECK_NAME,
        status: "error",
        detail: `cerefox_schema_version returned ${resp.status} — schema not deployed.`,
        hint: "Deploy the schema + RPCs (see remediation below).",
      };
    }
    const deployed = (await resp.json()) as string;
    // Classify the deployed Postgres schema/RPC version against this client's
    // minimum (blocking) and bundled (informational) versions. The remediation
    // command is owned by the doctor footer, which consolidates schema + EF
    // suggestions into a single `cerefox deploy-server [--schema-only]` line.
    const bundled = readBundledSchemaVersion();
    const level = classifyCompat(deployed, COMPATIBILITY.minSchema, bundled);
    switch (level) {
      case "below-min":
        return {
          name: SCHEMA_CHECK_NAME,
          status: "error",
          detail: `Deployed schema v${deployed} is below the required minimum v${COMPATIBILITY.minSchema}.`,
          hint: "Update the schema + RPCs (see remediation below).",
        };
      case "above-min-but-old":
        return {
          name: SCHEMA_CHECK_NAME,
          status: "warn",
          detail: `Deployed schema v${deployed} works but is older than this client's bundled v${bundled}.`,
          hint: "Update the schema + RPCs (see remediation below).",
        };
      default:
        return {
          name: SCHEMA_CHECK_NAME,
          status: "ok",
          detail: `cerefox_schema_version() → "${deployed}"${bundled ? ` (bundled v${bundled})` : ""}`,
        };
    }
  } catch (err) {
    return {
      name: SCHEMA_CHECK_NAME,
      status: "error",
      detail: `Schema version probe failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

const CONTENT_FORMAT_CHECK_NAME = "content format";

/**
 * Informational (iter-28D): how many documents still use the legacy chunk
 * reconstruction format (format 1). Never a failure — a `skipped` (ℹ) line when
 * some remain, `ok` (✓) when all are converted. Points at the bundled explanation.
 */
export async function checkContentFormat(): Promise<CheckResult> {
  const settings = loadSettings();
  if (!settings.supabaseUrl || !settings.supabaseKey) {
    return { name: CONTENT_FORMAT_CHECK_NAME, status: "skipped", detail: "Supabase config missing; skipped." };
  }
  try {
    const url = `${settings.supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/cerefox_content_format_stats`;
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
      // RPC absent → server not yet on schema 0.8.0. Informational skip, not an error.
      return {
        name: CONTENT_FORMAT_CHECK_NAME,
        status: "skipped",
        detail: `format stats unavailable (${resp.status}); deploy schema 0.8.0 to enable.`,
      };
    }
    const rows = (await resp.json()) as Array<{ legacy_docs: number; total_docs: number }>;
    const legacy = rows[0]?.legacy_docs ?? 0;
    const total = rows[0]?.total_docs ?? 0;
    if (legacy === 0) {
      return {
        name: CONTENT_FORMAT_CHECK_NAME,
        status: "ok",
        detail: total === 0 ? "no documents yet" : `all ${total} document(s) use the current format`,
      };
    }
    return {
      name: CONTENT_FORMAT_CHECK_NAME,
      status: "skipped", // informational (ℹ), never a gate
      detail: `${legacy} of ${total} document(s) use the legacy reconstruction format (format 1).`,
      hint: "They auto-convert on next edit; run `cerefox server reindex` to convert all now. What this means: `cerefox guides show content-format`.",
    };
  } catch (err) {
    return {
      name: CONTENT_FORMAT_CHECK_NAME,
      status: "skipped",
      detail: `content-format check skipped: ${err instanceof Error ? err.message : String(err)}`,
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
      "Shadowed by ~/.cerefox/.env and no longer read by anything (Python was removed at " +
      "v1.0.0). Safe to delete.",
  };
}

export async function checkPostgres(): Promise<CheckResult> {
  if (!process.env.CEREFOX_DATABASE_URL) {
    return {
      name: "postgres",
      status: "skipped",
      detail: "CEREFOX_DATABASE_URL not set; skip if you only use the Data API for reads/writes.",
      hint: "Required for schema deploy (`bun scripts/db_deploy.ts`) and migrations.",
    };
  }
  let postgres: typeof import("postgres").default;
  try {
    postgres = (await import("postgres")).default;
  } catch (err) {
    return {
      name: "postgres",
      status: "error",
      detail: `Could not load the postgres client: ${err instanceof Error ? err.message : String(err)}`,
      hint: "Reinstall: `npm install -g @cerefox/memory`.",
    };
  }
  const sql = postgres(process.env.CEREFOX_DATABASE_URL, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 5,
    prepare: false,
    onnotice: () => {},
  });
  try {
    const rows = (await sql`SELECT version() AS version`) as Array<{ version: string }>;
    // Trim "PostgreSQL 16.10 on aarch64-...,by..." to just the version + arch prefix.
    const short = (rows[0]?.version ?? "").split(",")[0];
    return {
      name: "postgres",
      status: "ok",
      detail: `${short || "connected"} — DDL endpoint reachable`,
    };
  } catch (err) {
    return {
      name: "postgres",
      status: "error",
      detail: `Could not connect: ${err instanceof Error ? err.message : String(err)}`,
      hint:
        "Verify CEREFOX_DATABASE_URL: Session Pooler (port 5432, not Transaction Pooler 6543), " +
        "username must be `postgres.<project-ref>`, append `?sslmode=require`. " +
        "See `docs/guides/setup-supabase.md` → Connection pooling.",
    };
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

/**
 * Edge Function compatibility check (iter-26 Part 26C). Probes the
 * cerefox-mcp `/version?peers=true` aggregator and classifies the deployed
 * EF + schema versions against the client's compatibility matrix.
 *
 * Needs the Cerefox access token (`CEREFOX_ACCESS_TOKEN`, iter-28E) — the
 * aggregator + peer `/version` endpoints are token-gated. Without it (pre
 * `cerefox token generate`), or before the EFs are deployed (aggregator 404),
 * the check reports `skipped` rather than failing — expected transitional states.
 */
export async function checkEdgeFunctionsCompat(): Promise<CheckResult> {
  const settings = loadSettings();
  if (!settings.supabaseUrl) {
    return {
      name: "edge functions",
      status: "skipped",
      detail: "Supabase URL not set; EF version check skipped.",
    };
  }
  if (!settings.accessToken) {
    return {
      name: "edge functions",
      status: "skipped",
      detail: "No CEREFOX_ACCESS_TOKEN set; EF version check skipped.",
      hint: "Run `cerefox token generate` to enable client↔server version checks.",
    };
  }

  let compat;
  try {
    compat = await checkServerCompatibility({
      aggregatorUrl: aggregatorUrlFor(settings.supabaseUrl),
      bearer: settings.accessToken,
      // Baseline against the EF version this package *bundles* (EF_VERSION),
      // not the npm package version (PKG_VERSION). A client-only release bumps
      // PKG_VERSION without changing the EFs, so using PKG_VERSION here made
      // doctor warn "EFs older than client" even right after a fresh redeploy.
      bundledEf: EF_VERSION,
    });
  } catch (err) {
    return {
      name: "edge functions",
      status: "skipped",
      detail: `Version probe failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (compat.efProbeSkipped) {
    return {
      name: "edge functions",
      status: "skipped",
      detail: compat.efSkipReason ?? "EF version check skipped.",
    };
  }

  const deployed = compat.edgeFunctions.deployed ?? "unknown";
  switch (compat.edgeFunctions.level) {
    case "below-min":
      return {
        name: "edge functions",
        status: "error",
        detail: `Deployed EF v${deployed} is below the required minimum v${compat.edgeFunctions.min}.`,
        hint: "Update the Edge Functions (see remediation below).",
      };
    case "above-min-but-old":
      return {
        name: "edge functions",
        status: "warn",
        detail: `Deployed EF v${deployed} works but is older than the bundled Edge Functions (v${EF_VERSION}).`,
        hint: "Update the Edge Functions (see remediation below).",
      };
    default:
      return {
        name: "edge functions",
        status: "ok",
        detail: `Deployed EF v${deployed} (≥ required v${compat.edgeFunctions.min}).`,
      };
  }
}

// ── Aggregations ───────────────────────────────────────────────────────────

/**
 * Progress event emitted before each check starts.
 *
 * `phase` is a human-readable label suitable for a spinner ("Probing
 * Supabase Data API"); `name` matches the eventual `CheckResult.name`.
 */
export interface CheckProgress {
  phase: string;
  name: string;
  index: number;
  total: number;
}

export interface RunChecksOptions {
  onProgress?: (ev: CheckProgress) => void;
}

interface CheckStep {
  name: string;
  phase: string;
  run: () => CheckResult | null | Promise<CheckResult | null>;
}

async function runSteps(
  steps: CheckStep[],
  opts: RunChecksOptions,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    opts.onProgress?.({
      phase: step.phase,
      name: step.name,
      index: i + 1,
      total: steps.length,
    });
    const r = await step.run();
    if (r != null) results.push(r);
  }
  return results;
}

/** Full diagnostic — what `cerefox doctor` runs. */
export async function runAllChecks(opts: RunChecksOptions = {}): Promise<CheckResult[]> {
  const steps: CheckStep[] = [
    { name: "binary", phase: "Locating binary", run: () => checkBinary() },
    { name: "runtime", phase: "Inspecting runtime", run: () => checkRuntime() },
    { name: "version", phase: "Reading package version", run: () => checkVersion() },
    { name: "config", phase: "Resolving config", run: () => checkConfig() },
    { name: "legacy env", phase: "Checking legacy env shadowing", run: () => checkLegacyShadowEnv() },
    { name: "supabase", phase: "Probing Supabase Data API", run: () => checkSupabase() },
    { name: "openai", phase: "Probing OpenAI embeddings", run: () => checkOpenAI() },
    { name: "schema + RPCs", phase: "Reading schema + RPC version", run: () => checkSchemaVersion() },
    { name: "content format", phase: "Checking chunk reconstruction format", run: () => checkContentFormat() },
    { name: "edge functions", phase: "Probing Edge Function versions", run: () => checkEdgeFunctionsCompat() },
    { name: "postgres", phase: "Probing Postgres DDL endpoint", run: () => checkPostgres() },
    { name: "mcp clients", phase: "Scanning MCP client configs", run: () => checkMcpConfigs() },
  ];
  return runSteps(steps, opts);
}

/** Fast subset — what `cerefox status` runs. Skips the heavier network probes. */
export async function runFastChecks(opts: RunChecksOptions = {}): Promise<CheckResult[]> {
  const steps: CheckStep[] = [
    { name: "version", phase: "Reading package version", run: () => checkVersion() },
    { name: "config", phase: "Resolving config", run: () => checkConfig() },
    { name: "supabase", phase: "Probing Supabase Data API", run: () => checkSupabase() },
  ];
  return runSteps(steps, opts);
}
