/**
 * `cerefox token <generate|rotate|list>` — manage the Cerefox Edge Function
 * access token(s) (iter-28E). The token is the credential the primitive EFs and
 * `cerefox-mcp`'s static path validate in-function (design:
 * docs/specs/ef-auth-migration-design.md).
 *
 * The command automates the SERVER side (sets the `CEREFOX_ACCESS_TOKENS`
 * Function secret) and the LOCAL side (upserts `CEREFOX_ACCESS_TOKEN` into
 * `.env`), then GUIDES the client side: it prints the token once and where to
 * paste it — it cannot auto-install into a Custom GPT (OpenAI exposes no API for
 * that). Two env names: `CEREFOX_ACCESS_TOKENS` (plural = server-side accepted
 * set, enables rotation) vs `CEREFOX_ACCESS_TOKEN` (singular = the one token this
 * machine presents; used by `doctor`, live tests, the optional remote-MCP client).
 */

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { Command } from "commander";

import { c, eprintln, println, userError } from "../../../../../_shared/cli-core/index.ts";
import { loadSettings, resolveEnvFile } from "../../../../../_shared/config/index.ts";
import { envGitignoreWarning, readEnvVar, upsertEnvVar } from "../util/env-file.ts";

const SECRET_NAME = "CEREFOX_ACCESS_TOKENS"; // server-side accepted set (plural)
const LOCAL_NAME = "CEREFOX_ACCESS_TOKEN"; // local .env, what this machine presents
const PREFIX = "cfx_pat_";

interface TokenOptions {
  projectRef?: string;
  env: boolean; // --no-env => false
  backup: boolean; // --no-backup => false
  dryRun?: boolean;
  finalize?: boolean; // rotate only
}

/** 256-bit random token, base64url, prefixed for recognizability (gitleaks/humans). */
function mintToken(): string {
  return PREFIX + randomBytes(32).toString("base64url");
}

/** Mask a token for display: keep the prefix + last 4, hide the middle. */
function mask(token: string): string {
  return token.length <= 16 ? "…" : `${token.slice(0, PREFIX.length + 4)}…${token.slice(-4)}`;
}

/** Derive the Supabase project ref from CEREFOX_SUPABASE_URL (else null). */
function parseProjectRef(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) return null;
  try {
    const label = new URL(supabaseUrl).hostname.split(".")[0];
    return /^[a-z0-9]{20}$/.test(label) ? label : null;
  } catch {
    return null;
  }
}

/**
 * Set the server-side accepted set. `setValue` is the full comma-joined value.
 * Passed as a spawn arg (never through a shell, never logged in full).
 */
function setSecret(setValue: string, projectRef: string | null, dryRun?: boolean): void {
  const args = ["--yes", "supabase", "secrets", "set", `${SECRET_NAME}=${setValue}`];
  if (projectRef) args.push("--project-ref", projectRef);
  if (dryRun) {
    const shown = setValue.split(",").map(mask).join(",");
    println(c.dim(`   (dry-run) npx supabase secrets set ${SECRET_NAME}=${shown}` +
      (projectRef ? ` --project-ref ${projectRef}` : "")));
    return;
  }
  const r = spawnSync("npx", args, { encoding: "utf8", stdio: "inherit" });
  if (r.status !== 0) {
    throw userError(
      `Failed to set the ${SECRET_NAME} Function secret.`,
      "Install the Supabase CLI and link the project (or pass --project-ref <ref>).",
    );
  }
  println(c.green(`   ✓ Set ${SECRET_NAME} on Supabase.`));
}

/** Upsert CEREFOX_ACCESS_TOKEN into the canonical .env; warn if that .env isn't gitignored. */
function writeLocalEnv(token: string, opts: TokenOptions): void {
  if (!opts.env) return;
  if (opts.dryRun) {
    println(c.dim(`   (dry-run) would upsert ${LOCAL_NAME} in ${resolveEnvFile()}`));
    return;
  }
  const envPath = resolveEnvFile();
  const r = upsertEnvVar(envPath, LOCAL_NAME, token, { noBackup: !opts.backup });
  println(c.green(`   ✓ ${r.action === "created" ? "Wrote" : "Updated"} ${LOCAL_NAME} in ${r.path}`));
  if (r.backupPath) println(c.dim(`     backup: ${r.backupPath}`));
  const warn = envGitignoreWarning(envPath);
  if (warn) eprintln(c.yellow(`   ⚠  ${warn}`));
}

function printTokenOnce(token: string): void {
  println("");
  println(c.bold("   Your Cerefox access token (shown once — store it securely):"));
  println(`   ${c.green(token)}`);
  println("");
  println(c.dim("   Paste it into any token-bearing client:"));
  println(c.dim("     • Custom GPT → Configure → Actions → Authentication → API Key (Bearer)"));
  println(c.dim("     • Remote HTTP MCP → the Authorization: Bearer header"));
  println(c.dim("   If the GPT Actions schema changed this release, re-paste it too"));
  println(c.dim("   (see docs/guides/connect-agents.md). Lose the token → `cerefox token rotate`."));
}

function generateAction(opts: TokenOptions): void {
  const projectRef = opts.projectRef ?? parseProjectRef(loadSettings().supabaseUrl);
  const token = mintToken();
  println(c.bold("Generating a Cerefox access token…"));
  setSecret(token, projectRef, opts.dryRun); // fresh single-token set
  writeLocalEnv(token, opts);
  if (!opts.dryRun) printTokenOnce(token);
}

function rotateAction(opts: TokenOptions): void {
  const projectRef = opts.projectRef ?? parseProjectRef(loadSettings().supabaseUrl);
  const envPath = resolveEnvFile();
  const current = readEnvVar(envPath, LOCAL_NAME);

  if (opts.finalize) {
    // Narrow the accepted set to just the current .env token (drop the old one
    // that rotation left accepted). Run this AFTER every client uses the new token.
    if (!current) {
      throw userError(
        `No ${LOCAL_NAME} in ${envPath} to finalize to.`,
        "Run `cerefox token generate` or `cerefox token rotate` first.",
      );
    }
    println(c.bold("Finalizing rotation (dropping the previous token)…"));
    setSecret(current, projectRef, opts.dryRun);
    if (!opts.dryRun) println(c.green("   ✓ Only the current token is accepted now."));
    return;
  }

  // Widen: accept BOTH the new token and the current one (zero-downtime), write
  // the new one locally, then guide the client migration + finalize step.
  const token = mintToken();
  const setValue = current ? `${token},${current}` : token;
  println(c.bold("Rotating the Cerefox access token…"));
  setSecret(setValue, projectRef, opts.dryRun);
  writeLocalEnv(token, opts);
  if (!opts.dryRun) {
    printTokenOnce(token);
    println("");
    println(
      c.yellow(
        "   Both the new and previous tokens are accepted right now. Update every\n" +
          "   client to the new token, then run `cerefox token rotate --finalize`\n" +
          "   to stop accepting the old one.",
      ),
    );
  }
}

function listAction(): void {
  const envPath = resolveEnvFile();
  const local = readEnvVar(envPath, LOCAL_NAME);
  println(c.bold("Cerefox access token"));
  println(
    local
      ? `   local (${LOCAL_NAME} in ${envPath}): ${c.green(mask(local))}`
      : c.dim(`   no ${LOCAL_NAME} in ${envPath} — run \`cerefox token generate\``),
  );
  println(
    c.dim(
      `   The server-side accepted set (${SECRET_NAME}) is write-only; list names/digests\n` +
        "   with: npx supabase secrets list",
    ),
  );
}

export function registerToken(program: Command): void {
  const token = program
    .command("token")
    .description("Manage the Cerefox Edge Function access token(s).");

  token
    .command("generate")
    .description("Mint a token, set the Supabase secret, and write it to .env.")
    .option("--project-ref <ref>", "Supabase project ref (default: derived from CEREFOX_SUPABASE_URL).")
    .option("--no-env", "Do not write CEREFOX_ACCESS_TOKEN to .env.")
    .option("--no-backup", "Skip the .pre-cerefox.bak backup of an existing .env.")
    .option("--dry-run", "Print the plan without minting or writing anything.")
    .action(generateAction);

  token
    .command("rotate")
    .description("Mint a new token accepted alongside the old (zero-downtime); --finalize drops the old.")
    .option("--finalize", "Stop accepting the previous token (run after clients migrate).")
    .option("--project-ref <ref>", "Supabase project ref (default: derived from CEREFOX_SUPABASE_URL).")
    .option("--no-env", "Do not write CEREFOX_ACCESS_TOKEN to .env.")
    .option("--no-backup", "Skip the .pre-cerefox.bak backup of an existing .env.")
    .option("--dry-run", "Print the plan without minting or writing anything.")
    .action(rotateAction);

  token
    .command("list")
    .description("Show the local token (masked) and where the server-side set lives.")
    .action(listAction);
}
