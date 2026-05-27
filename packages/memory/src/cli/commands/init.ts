/**
 * `cerefox init` — interactive first-run bootstrap.
 *
 * Five-step flow that produces a working `~/.cerefox/.env` (or the
 * `CEREFOX_CONFIG_DIR`-pointed file), validates each entry against the
 * live service, and optionally ingests the bundled self-docs + wires up
 * an MCP client.
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
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

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
import { resolveEnvFile } from "../../../../../_shared/config/index.ts";
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
      "  Only needed for `uv run python scripts/db_deploy.py` (schema deploy + migrations).\n" +
        "  npm-installed users without Python can skip — press Enter.\n" +
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

async function action(options: InitOptions): Promise<void> {
  const envPath = resolveEnvFile();

  if (existsSync(envPath) && !options.force) {
    println(
      c.yellow(`⚠ Config already exists at ${envPath}.`),
    );
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

  // Write the .env (chmod 600).
  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(envPath, buildEnvFile(answers), "utf8");
  if (process.platform !== "win32") {
    try {
      chmodSync(envPath, 0o600);
    } catch {
      // Couldn't chmod — surface as warning, don't block.
      warn(`Could not chmod 0600 ${envPath}.`);
    }
  }
  println("");
  println(c.green(`✓ Wrote ${envPath}`));
  println("");

  // Schema deploy: v0.5 deferred.
  if (!options.skipSchema) {
    println(c.bold("Schema deploy"));
    println(
      c.dim(
        "  v0.5 doesn't yet bundle the schema-deploy path (it needs the direct\n" +
          "  Postgres connection ported, scheduled for v0.6). For now:",
      ),
    );
    println(c.cyan("    uv run python scripts/db_deploy.py"));
    println(c.dim("  Skip this if your Supabase already has the schema."));
    println("");
  }

  // Self-doc ingest (Part 23F).
  if (!options.skipSelfDocs) {
    println(c.bold("Self-doc ingest"));
    println(c.dim("  Ingests bundled Cerefox docs under the `_cerefox-self-docs` project."));
    println(c.dim("  Wait until Part 23F lands — for now, this step is a no-op."));
    // TODO(23F): import { run as syncSelfDocs } from "./sync-self-docs.ts";
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
