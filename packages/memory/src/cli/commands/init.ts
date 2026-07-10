/**
 * `cerefox init` — interactive first-run bootstrap.
 *
 * Default target: `~/.cerefox/.env`. The CLI's path-resolution precedence
 * (`_shared/config/paths.ts`) prefers this location once it exists, so
 * writing here makes `~/.cerefox/.env` the canonical config from then on.
 *
 * Three resolution scenarios init handles:
 *
 *   1. **Fresh install** — neither `~/.cerefox/.env` nor `<cwd>/.env`
 *      exists. Standard 5-step interactive flow, writes the home file.
 *
 *   2. **Migrating from Python** — `<cwd>/.env` exists but `~/.cerefox/.env`
 *      doesn't. Init detects this and offers three choices:
 *      `[c]` copy the existing file to `~/.cerefox/.env` (recommended —
 *      TS reads the new home, Python keeps reading the repo file for
 *      backward compat); `[u]` use the repo file as-is, skip writing
 *      anything (defer the migration); `[f]` fresh start (ignore the
 *      existing file, prompt for new answers, write to the home).
 *
 *   3. **Reconfiguring** — `~/.cerefox/.env` already exists. Standard
 *      overwrite confirmation as before.
 *
 * `CEREFOX_CONFIG_DIR` honors the explicit override: when set, init writes
 * there and skips the migration prompt entirely.
 *
 * Modes:
 *   - Interactive (default): prompts for each field with sensible
 *     defaults and validators.
 *   - Non-interactive (`--config <file>.json`): same pipeline minus the
 *     prompts. JSON keys match the env-var names exactly:
 *
 *     {
 *       "CEREFOX_SUPABASE_URL": "https://xxx.supabase.co",
 *       "CEREFOX_SUPABASE_KEY": "sb_secret_…",
 *       "OPENAI_API_KEY": "sk-…",
 *       "CEREFOX_DATABASE_URL": "postgresql://…",  // optional
 *       "CEREFOX_AUTHOR_NAME": "fotis",            // optional
 *       "CEREFOX_AUTHOR_TYPE": "user"              // optional
 *     }
 *
 * v0.5 scope: writes the .env, validates Supabase + OpenAI, and
 * triggers sync-self-docs (Part 23F) + configure-agent (Part 23E.5).
 * Schema deploy is **NOT** in scope — the npm CLI doesn't yet have the
 * Postgres direct connection that ddl needs. Init prints the
 * `uv run python scripts/db_deploy.py` command and links the relevant
 * doc; v0.6 ports this.
 */

import type { Command } from "commander";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  ask,
  c,
  confirm,
  println,
  systemError,
  userError,
  validators,
  warn,
} from "../../../../../_shared/cli-core/index.ts";
import {
  loadSettings,
  resolveEnvFile,
  USER_STATE_DIR_NAME,
} from "../../../../../_shared/config/index.ts";
import { COMPATIBILITY, compareSemver } from "../../../../../_shared/compatibility/index.ts";
import { WRITERS, writeMcpConfig } from "../util/mcp-config-writers.ts";

interface InitOptions {
  config?: string;
  force?: boolean;
  skipSchema?: boolean;
  skipSelfDocs?: boolean;
  skipAgentConfig?: boolean;
}

interface ConfigAnswers {
  CEREFOX_SUPABASE_URL: string;
  CEREFOX_SUPABASE_KEY: string;
  OPENAI_API_KEY: string;
  CEREFOX_DATABASE_URL?: string;
  CEREFOX_AUTHOR_NAME?: string;
  CEREFOX_AUTHOR_TYPE?: string;
}

async function readConfigFile(path: string): Promise<ConfigAnswers> {
  if (!existsSync(path)) {
    throw userError(`--config file not found: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw userError(
      `--config: invalid JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw userError(`--config: must be a JSON object.`);
  }
  const obj = parsed as Record<string, unknown>;
  const required = ["CEREFOX_SUPABASE_URL", "CEREFOX_SUPABASE_KEY", "OPENAI_API_KEY"] as const;
  for (const key of required) {
    if (typeof obj[key] !== "string" || (obj[key] as string).trim() === "") {
      throw userError(`--config: missing required key "${key}".`);
    }
  }
  return {
    CEREFOX_SUPABASE_URL: obj.CEREFOX_SUPABASE_URL as string,
    CEREFOX_SUPABASE_KEY: obj.CEREFOX_SUPABASE_KEY as string,
    OPENAI_API_KEY: obj.OPENAI_API_KEY as string,
    CEREFOX_DATABASE_URL: typeof obj.CEREFOX_DATABASE_URL === "string" ? obj.CEREFOX_DATABASE_URL : undefined,
    CEREFOX_AUTHOR_NAME: typeof obj.CEREFOX_AUTHOR_NAME === "string" ? obj.CEREFOX_AUTHOR_NAME : undefined,
    CEREFOX_AUTHOR_TYPE: typeof obj.CEREFOX_AUTHOR_TYPE === "string" ? obj.CEREFOX_AUTHOR_TYPE : undefined,
  };
}

/**
 * Tiny `KEY=VALUE` parser used to validate an existing `.env` (during
 * the [c] copy or [u] use-as-is paths) without polluting `process.env`.
 * Existing dotenv libraries set `process.env` as a side effect, which
 * would shadow values from a subsequent re-read.
 */
function parseDotEnvFile(content: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    // Strip surrounding quotes if balanced.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map[key] = value;
  }
  return map;
}

function answersFromEnvFile(path: string): ConfigAnswers {
  const parsed = parseDotEnvFile(readFileSync(path, "utf8"));
  const required = ["CEREFOX_SUPABASE_URL", "CEREFOX_SUPABASE_KEY", "OPENAI_API_KEY"] as const;
  for (const key of required) {
    if (!parsed[key] || parsed[key].trim() === "") {
      throw userError(
        `Existing .env at ${path} is missing required key "${key}".`,
        `Fix it manually or run \`cerefox init --force\` to start fresh.`,
      );
    }
  }
  return {
    CEREFOX_SUPABASE_URL: parsed.CEREFOX_SUPABASE_URL,
    CEREFOX_SUPABASE_KEY: parsed.CEREFOX_SUPABASE_KEY,
    OPENAI_API_KEY: parsed.OPENAI_API_KEY,
    CEREFOX_DATABASE_URL: parsed.CEREFOX_DATABASE_URL,
    CEREFOX_AUTHOR_NAME: parsed.CEREFOX_AUTHOR_NAME,
    CEREFOX_AUTHOR_TYPE: parsed.CEREFOX_AUTHOR_TYPE,
  };
}

async function promptForAnswers(): Promise<ConfigAnswers> {
  println(c.bold("Cerefox first-run setup."));
  println(
    c.dim(
      "This will write configuration to ~/.cerefox/.env (or CEREFOX_CONFIG_DIR if set).\n" +
        "Step 1/5 ─ Supabase URL · 2/5 ─ Supabase key · 3/5 ─ OpenAI key · 4/5 ─ Postgres URL (optional) · 5/5 ─ Identity.\n",
    ),
  );

  println(c.cyan("▶ Step 1/5 — Supabase project URL"));
  println(c.dim("  Project Settings → API → Project URL."));
  const supabaseUrl = await ask({
    type: "text",
    name: "supabaseUrl",
    message: "CEREFOX_SUPABASE_URL",
    validate: validators.httpsUrl,
  });

  println("");
  println(c.cyan("▶ Step 2/5 — Supabase Data API key"));
  println(c.dim("  Project Settings → API Keys → Secret key (sb_secret_…) or legacy service_role JWT (eyJ…)."));
  const supabaseKey = await ask({
    type: "password",
    name: "supabaseKey",
    message: "CEREFOX_SUPABASE_KEY",
    validate: validators.supabaseKey,
  });

  println("");
  println(c.cyan("▶ Step 3/5 — OpenAI API key"));
  println(c.dim("  https://platform.openai.com/api-keys — used for embeddings."));
  const openaiKey = await ask({
    type: "password",
    name: "openaiKey",
    message: "OPENAI_API_KEY",
    validate: validators.openaiKey,
  });

  println("");
  println(c.cyan("▶ Step 4/5 — Direct Postgres connection (optional for npm-installed users)"));
  println(
    c.dim(
      "  Only needed for `cerefox server deploy` (schema deploy + migrations).\n" +
        "  You can skip this and set CEREFOX_DATABASE_URL later — press Enter.\n" +
        "  Format: postgresql://postgres.<project-ref>:<pw>@…:5432/postgres?sslmode=require",
    ),
  );
  const databaseUrl = await ask({
    type: "text",
    name: "databaseUrl",
    message: "CEREFOX_DATABASE_URL (optional — press Enter to skip)",
    initial: "",
  });

  println("");
  println(c.cyan("▶ Step 5/5 — Caller identity (optional; default 'unknown' / 'user')"));
  println(c.dim("  Recorded in the audit log for every write you make via this CLI."));
  const authorName = await ask({
    type: "text",
    name: "authorName",
    message: "CEREFOX_AUTHOR_NAME [unknown]",
    initial: "",
  });
  const authorType = await ask({
    type: "text",
    name: "authorType",
    message: "CEREFOX_AUTHOR_TYPE (user/agent) [user]",
    initial: "user",
    validate: (v) => v === "user" || v === "agent" || v === "" || "Expected 'user' or 'agent'.",
  });

  return {
    CEREFOX_SUPABASE_URL: supabaseUrl,
    CEREFOX_SUPABASE_KEY: supabaseKey,
    OPENAI_API_KEY: openaiKey,
    CEREFOX_DATABASE_URL: databaseUrl.trim() || undefined,
    CEREFOX_AUTHOR_NAME: authorName.trim() || undefined,
    CEREFOX_AUTHOR_TYPE: (authorType.trim() || "user") as string,
  };
}

function buildEnvFile(answers: ConfigAnswers): string {
  const lines = [
    "# Cerefox configuration — generated by `cerefox init`.",
    "# Tighten the file mode with: chmod 600 ~/.cerefox/.env",
    "",
    `CEREFOX_SUPABASE_URL=${answers.CEREFOX_SUPABASE_URL}`,
    `CEREFOX_SUPABASE_KEY=${answers.CEREFOX_SUPABASE_KEY}`,
    `OPENAI_API_KEY=${answers.OPENAI_API_KEY}`,
  ];
  if (answers.CEREFOX_DATABASE_URL) {
    lines.push(`CEREFOX_DATABASE_URL=${answers.CEREFOX_DATABASE_URL}`);
  }
  if (answers.CEREFOX_AUTHOR_NAME) {
    lines.push(`CEREFOX_AUTHOR_NAME=${answers.CEREFOX_AUTHOR_NAME}`);
  }
  if (answers.CEREFOX_AUTHOR_TYPE) {
    lines.push(`CEREFOX_AUTHOR_TYPE=${answers.CEREFOX_AUTHOR_TYPE}`);
  }
  lines.push(
    "",
    "# ── Optional: connect cloud/mobile Claude over OAuth (setup-supabase.md Step 7) ──",
    "# These are only needed for the optional claude.ai / Claude-mobile OAuth feature.",
    "# The Cerefox access token gates the Edge Functions (GPT Actions, remote MCP,",
    "# and doctor's version check). It is written here automatically by",
    "# `cerefox token generate` — you don't set it by hand:",
    "# CEREFOX_ACCESS_TOKEN=cfx_pat_...",
    "# The PUBLISHABLE key is public-safe (no KB access) — used by the consent-page",
    "# Cloudflare Worker deploy (cloudflare/cerefox-consent/deploy.sh reads this):",
    "# CEREFOX_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...",
  );
  return lines.join("\n") + "\n";
}

async function validateSupabase(url: string, key: string): Promise<void> {
  const resp = await fetch(`${url.replace(/\/$/, "")}/rest/v1/cerefox_projects?select=id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!resp.ok) {
    if (resp.status === 401) {
      throw userError(
        "Supabase rejected the key (401).",
        "Use the service-role (sb_secret_…) key, not the legacy anon JWT.",
      );
    }
    if (resp.status === 404 || resp.status === 400) {
      // Schema may not be deployed yet — that's expected on first run.
      warn(
        `Supabase reached, but cerefox_projects table is missing (${resp.status}). Schema deploy needed.`,
      );
      return;
    }
    throw systemError(`Supabase check failed: ${resp.status} ${resp.statusText}`);
  }
}

async function validateOpenAI(key: string): Promise<void> {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ input: "test", model: "text-embedding-3-small", dimensions: 768 }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw userError(
      `OpenAI key validation failed: ${resp.status} ${body.slice(0, 100)}`,
      "Verify the key on https://platform.openai.com/api-keys.",
    );
  }
}

/** Print the [c]/[u]/[f] migration menu once. */
function printMigrationMenu(cwdEnv: string, homeEnv: string): void {
  println("");
  println(c.yellow(`⚠ Found existing config at ${cwdEnv}.`));
  println("");
  println("This may be from an earlier install. The CLI can use the");
  println("same .env — env-var names are identical, no rewrite needed.");
  println("");
  println("  " + c.bold("[c]") + " Copy to " + homeEnv + "  " + c.green("(recommended)"));
  println(c.dim("      • The CLI reads the new home from now on"));
  println(c.dim("      • Edit ~/.cerefox/.env going forward; the repo .env is legacy"));
  println("");
  println("  " + c.bold("[u]") + " Use " + cwdEnv + " as-is, skip writing anything");
  println(c.dim("      • The CLI keeps reading the existing file"));
  println(c.dim("      • Defer the migration"));
  println("");
  println("  " + c.bold("[f]") + " Fresh start — interactive prompts, write to " + homeEnv);
  println(c.dim("      • Use if the existing file is stale or wrong"));
  println("");
}

async function promptMigrationChoice(): Promise<"c" | "u" | "f"> {
  const choice = await ask({
    type: "text",
    name: "choice",
    message: "Choice (c/u/f) [c]",
    initial: "c",
    validate: (v) => /^[cuf]?$/i.test(v.trim()) || "Expected c, u, or f.",
  });
  const ch = (choice.trim().toLowerCase() || "c") as "c" | "u" | "f";
  return ch;
}

/**
 * Probe the deployed Postgres schema version via the REST RPC.
 * Returns the version string, or null when the schema isn't deployed
 * (404 / missing function) or the probe couldn't run.
 */
async function probeSchemaVersion(url: string, key: string): Promise<string | null> {
  try {
    const resp = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/cerefox_schema_version`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: "{}",
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as unknown;
    return typeof data === "string" ? data : null;
  } catch {
    return null;
  }
}

/** Spawn `cerefox server deploy` (inherit stdio) and await it. */
function launchDeployServer(extraArgs: string[] = []): number {
  const r = spawnSync(process.execPath, [process.argv[1], "server", "deploy", ...extraArgs], {
    stdio: "inherit",
  });
  return r.status ?? 1;
}

/**
 * iter-26 Part 26E: offer to deploy the server side when the schema is
 * missing (404) or below the client's minimum. Three cases:
 *   (a) no schema      → "Deploy now?" → deploy-server (fresh)
 *   (b) below minSchema → "Update now?" → deploy-server (applies pending
 *       migrations + refreshes RPCs in place; v0.8.1 — no longer --reset)
 *   (c) compatible      → silent pass
 * Declining at any prompt continues init; `cerefox doctor` nudges again.
 */
async function maybeOfferServerDeploy(): Promise<void> {
  const settings = loadSettings();
  if (!settings.supabaseUrl || !settings.supabaseKey) return; // can't probe

  const deployed = await probeSchemaVersion(settings.supabaseUrl, settings.supabaseKey);

  if (deployed === null) {
    println(c.bold("Schema deploy"));
    println(c.dim("  No Cerefox schema detected on this Supabase project."));
    const yes = await confirm("  Deploy the server now (schema + RPCs + Edge Functions)?", false);
    if (yes) launchDeployServer();
    else println(c.dim("  Skipped. Run `cerefox server deploy` later (or `cerefox doctor` to recheck)."));
    println("");
    return;
  }

  if (compareSemver(deployed, COMPATIBILITY.minSchema) < 0) {
    println(c.bold("Schema deploy"));
    println(
      c.yellow(
        `  Deployed schema v${deployed} is below the required v${COMPATIBILITY.minSchema}.`,
      ),
    );
    const yes = await confirm("  Update the server now (applies pending migrations, refreshes RPCs + EFs)?", true);
    if (yes) launchDeployServer();
    else println(c.dim("  Skipped. Run `cerefox server deploy` when ready."));
    println("");
    return;
  }

  // Compatible — no prompt (just a quiet confirmation line).
  println(c.dim(`Schema v${deployed} already deployed (≥ required v${COMPATIBILITY.minSchema}).`));
  println("");
}

/** Continue the lifecycle steps (self-docs + MCP wiring) after the .env
 * is in place. Shared by all three branches. */
async function postWriteLifecycle(envPath: string, options: InitOptions): Promise<void> {
  // Schema deploy (iter-26 Part 26E): probe the deployed schema version and
  // offer to run `cerefox server deploy` when it's missing or below the
  // client's minimum. Existing, compatible installs see no prompt.
  if (!options.skipSchema) {
    await maybeOfferServerDeploy();
  }

  // Self-doc ingest (Layer 2 of MCP discoverability, Part 23F).
  if (!options.skipSelfDocs) {
    println(c.bold("Self-doc ingest"));
    println(c.dim("  Ingesting bundled Cerefox docs into the `_cerefox-self-docs` project…"));
    println("");
    try {
      const { runSyncSelfDocs } = await import("./sync-self-docs.ts");
      await runSyncSelfDocs({});
    } catch (err) {
      warn(
        `Self-doc ingest failed: ${err instanceof Error ? err.message : String(err)}. Run \`cerefox sync-self-docs\` manually after init.`,
      );
    }
    println("");
  }

  // Optional MCP client config.
  if (!options.skipAgentConfig) {
    const wantConfig = await confirm(
      "Wire up an MCP client now? (claude-code / claude-desktop)",
      true,
    );
    if (wantConfig) {
      const tool = await ask({
        type: "text",
        name: "tool",
        message: "Which client? (claude-code or claude-desktop)",
        initial: "claude-code",
        validate: (v) =>
          WRITERS[v] ? true : `Unknown client "${v}". Try claude-code or claude-desktop.`,
      });
      const writer = WRITERS[tool];
      const result = writeMcpConfig(writer);
      println(c.green(`✓ ${writer.label} configured at ${result.configPath}`));
      if (result.backupPath) {
        println(c.dim(`  Backup: ${result.backupPath}`));
      }
    }
  }

  println("");
  println(c.green("Done. Try:"));
  println(c.dim("  cerefox doctor              # verify everything"));
  println(c.dim("  cerefox search \"…\"          # search the KB"));
  println(c.dim("  cerefox ingest <file>       # add a doc"));
  // Help users locate the file we just touched.
  println("");
  println(c.dim(`  Config in effect: ${envPath}`));
}

function writeAnswersTo(target: string, answers: ConfigAnswers): void {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, buildEnvFile(answers), "utf8");
  if (process.platform !== "win32") {
    try {
      chmodSync(target, 0o600);
    } catch {
      warn(`Could not chmod 0600 ${target}.`);
    }
  }
}

async function action(options: InitOptions): Promise<void> {
  const homeEnv = join(homedir(), USER_STATE_DIR_NAME, ".env");
  const cwdEnv = join(process.cwd(), ".env");
  const explicitDir = (process.env.CEREFOX_CONFIG_DIR ?? "").trim();

  // ─── Path A: CEREFOX_CONFIG_DIR override ──────────────────────────────
  // Advanced users with an explicit override skip the migration prompt
  // entirely. resolveEnvFile() honors the override.
  if (explicitDir) {
    const target = resolveEnvFile();
    if (existsSync(target) && !options.force) {
      println(c.yellow(`⚠ Config already exists at ${target}.`));
      const ok = await confirm("Overwrite?", true);
      if (!ok) {
        println(c.dim("Aborted. Use `--force` to skip this prompt next time."));
        return;
      }
    }
    const answers = options.config
      ? await readConfigFile(options.config)
      : await promptForAnswers();
    println("");
    println(c.bold("Validating credentials…"));
    await validateSupabase(answers.CEREFOX_SUPABASE_URL, answers.CEREFOX_SUPABASE_KEY);
    println(c.green("  ✓ Supabase reachable"));
    await validateOpenAI(answers.OPENAI_API_KEY);
    println(c.green("  ✓ OpenAI key valid (test embedding succeeded)"));
    writeAnswersTo(target, answers);
    println("");
    println(c.green(`✓ Wrote ${target}`));
    println("");
    await postWriteLifecycle(target, options);
    return;
  }

  // ─── Path B: ~/.cerefox/.env already exists (reconfigure) ─────────────
  if (existsSync(homeEnv) && !options.force) {
    println(c.yellow(`⚠ Config already exists at ${homeEnv}.`));
    const ok = await confirm("Overwrite?", true);
    if (!ok) {
      println(c.dim("Aborted. Use `--force` to skip this prompt next time."));
      return;
    }
    const answers = options.config
      ? await readConfigFile(options.config)
      : await promptForAnswers();
    println("");
    println(c.bold("Validating credentials…"));
    await validateSupabase(answers.CEREFOX_SUPABASE_URL, answers.CEREFOX_SUPABASE_KEY);
    println(c.green("  ✓ Supabase reachable"));
    await validateOpenAI(answers.OPENAI_API_KEY);
    println(c.green("  ✓ OpenAI key valid (test embedding succeeded)"));
    writeAnswersTo(homeEnv, answers);
    println("");
    println(c.green(`✓ Wrote ${homeEnv}`));
    println("");
    await postWriteLifecycle(homeEnv, options);
    return;
  }

  // ─── Path C: legacy <cwd>/.env exists, ~/.cerefox/.env doesn't ────────
  // Migration scenario. Offer [c]opy / [u]se-as-is / [f]resh.
  if (existsSync(cwdEnv) && !options.force && !options.config) {
    printMigrationMenu(cwdEnv, homeEnv);
    const ch = await promptMigrationChoice();
    println("");

    if (ch === "c") {
      // Copy + validate + lifecycle.
      mkdirSync(dirname(homeEnv), { recursive: true });
      copyFileSync(cwdEnv, homeEnv);
      if (process.platform !== "win32") {
        try {
          chmodSync(homeEnv, 0o600);
        } catch {
          warn(`Could not chmod 0600 ${homeEnv}.`);
        }
      }
      println(c.green(`✓ Copied ${cwdEnv} → ${homeEnv}`));
      println(c.dim(`  Repo file left unchanged — safe to delete once the new location works.`));
      println("");

      // Validate the copied config against live services.
      const answers = answersFromEnvFile(homeEnv);
      println(c.bold("Validating credentials…"));
      await validateSupabase(answers.CEREFOX_SUPABASE_URL, answers.CEREFOX_SUPABASE_KEY);
      println(c.green("  ✓ Supabase reachable"));
      await validateOpenAI(answers.OPENAI_API_KEY);
      println(c.green("  ✓ OpenAI key valid (test embedding succeeded)"));
      println("");
      await postWriteLifecycle(homeEnv, options);
      return;
    }

    if (ch === "u") {
      // Use-as-is — validate the existing file, skip the write entirely.
      const answers = answersFromEnvFile(cwdEnv);
      println(c.bold("Validating existing config…"));
      await validateSupabase(answers.CEREFOX_SUPABASE_URL, answers.CEREFOX_SUPABASE_KEY);
      println(c.green("  ✓ Supabase reachable"));
      await validateOpenAI(answers.OPENAI_API_KEY);
      println(c.green("  ✓ OpenAI key valid (test embedding succeeded)"));
      println("");
      println(c.green(`✓ Using existing config at ${cwdEnv}`));
      println(c.dim(`  TS reads it via the legacy dev-mode fallback (~/.cerefox/.env not present).`));
      println(c.dim(`  Run \`cerefox init\` again later to migrate to the new home.`));
      println("");
      await postWriteLifecycle(cwdEnv, options);
      return;
    }

    // ch === "f" — fall through to fresh prompts targeting the home file.
    println(c.dim(`Fresh start. Ignoring ${cwdEnv}; writing a new config to ${homeEnv}.`));
    println("");
  }

  // ─── Path D: fresh install (no config anywhere) OR [f] fresh-start ───
  const target = homeEnv;
  const answers = options.config
    ? await readConfigFile(options.config)
    : await promptForAnswers();
  println("");
  println(c.bold("Validating credentials…"));
  await validateSupabase(answers.CEREFOX_SUPABASE_URL, answers.CEREFOX_SUPABASE_KEY);
  println(c.green("  ✓ Supabase reachable"));
  await validateOpenAI(answers.OPENAI_API_KEY);
  println(c.green("  ✓ OpenAI key valid (test embedding succeeded)"));
  writeAnswersTo(target, answers);
  println("");
  println(c.green(`✓ Wrote ${target}`));
  println("");
  await postWriteLifecycle(target, options);
}

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Interactive first-run setup (config, schema deploy stub, optional MCP wiring).")
    .option("-c, --config <file>", "Non-interactive mode: read answers from a JSON file.")
    .option("--force", "Overwrite existing configuration without prompting.")
    .option("--skip-schema", "Skip the schema deploy step.")
    .option("--skip-self-docs", "Skip the bundled self-doc ingest.")
    .option("--skip-agent-config", "Skip the optional MCP agent wiring.")
    .action(action);
}
