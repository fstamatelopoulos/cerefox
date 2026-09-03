/**
 * `cerefox api-key <generate|show|rotate>` — the credential for the LOCAL HTTP
 * surface (#229). Design: `docs/specs/api-auth-design.md`.
 *
 * **Not to be confused with `cerefox token`.** Two different credentials for
 * two different surfaces, and mixing them up would be an easy mistake:
 *
 *   - `cerefox token` (`cfx_pat_`) → the Cerefox ACCESS TOKEN, validated
 *     in-function by the 9 deployed Edge Functions. A cloud credential; also
 *     lives as a Supabase Function secret.
 *   - `cerefox api-key` (`cfx_lak_`) → this. A LOCAL API KEY for `/api/v1` and
 *     `/rest/v1` on the machine running `cerefox web`. Never leaves the host,
 *     never goes to Supabase.
 *
 * ## When you need one
 *
 * Usually never. The gate exempts loopback, so the browser, local agents and
 * localhost scripts all work with no key at all. You need one when a caller
 * reaches the server from somewhere that is NOT this machine: a container on a
 * Docker network rather than host networking, or a deliberately widened bind.
 *
 * Minting is always explicit — this command, or the container's boot script.
 * Nothing mints a key as a side effect of serving a page, because a key handed
 * to an unauthenticated page is not a secret.
 */

import { randomBytes } from "node:crypto";
import type { Command } from "commander";

import { c, eprintln, println, userError } from "../../../../../_shared/cli-core/index.ts";
import { resolveEnvFile } from "../../../../../_shared/config/index.ts";
import { envGitignoreWarning, readEnvVar, upsertEnvVar } from "../util/env-file.ts";
import { API_KEY_PREFIX } from "../../web/auth.ts";

const ENV_NAME = "CEREFOX_API_KEY";

interface ApiKeyOptions {
  backup: boolean; // --no-backup => false
  dryRun?: boolean;
}

/** 256 bits, base64url — same shape and strength as `cerefox token`. */
function mint(): string {
  return API_KEY_PREFIX + randomBytes(32).toString("base64url");
}

/** Enough to recognise a key in a log without being enough to use it. */
function mask(key: string): string {
  const body = key.startsWith(API_KEY_PREFIX) ? key.slice(API_KEY_PREFIX.length) : key;
  if (body.length <= 8) return `${API_KEY_PREFIX}****`;
  return `${API_KEY_PREFIX}${body.slice(0, 4)}…${body.slice(-4)}`;
}

function containerHint(): void {
  eprintln(
    c.dim(
      "   Running Cerefox Local (Docker)? This is not the command you want — the\n" +
        "   container mints its own key at boot. Read it with: cerefox-local api-key",
    ),
  );
}

function writeKey(key: string, opts: ApiKeyOptions, verb: string): void {
  const envPath = resolveEnvFile();
  if (opts.dryRun) {
    println(c.dim(`DRY-RUN: would ${verb} ${ENV_NAME} in ${envPath}`));
    return;
  }
  const result = upsertEnvVar(envPath, ENV_NAME, key, {
    noBackup: !opts.backup,
    comment: "Local API key for /api/v1 + /rest/v1 (cerefox api-key). Never sent to Supabase.",
  });
  println(`   ${result.action} ${c.bold(ENV_NAME)} in ${envPath}`);
  if (result.backupPath) println(c.dim(`   backup: ${result.backupPath}`));

  // Printed ONCE, in full. There is no way to recover it from the server later
  // except by reading the same file, and a key you cannot copy is a key nobody
  // configures.
  println("");
  println(c.bold("   Your API key (shown once, in full):"));
  println(`   ${c.green(key)}`);
  println("");
  println(
    c.dim(
      "   A caller that is NOT on this machine sends it as:\n" +
        "     Authorization: Bearer <key>\n" +
        "   Callers on this machine (the web UI, local agents) need nothing.",
    ),
  );
  envGitignoreWarning(envPath);
}

function generateAction(opts: ApiKeyOptions): void {
  const envPath = resolveEnvFile();
  const existing = readEnvVar(envPath, ENV_NAME);
  if (existing) {
    // `userError` RETURNS a CliError; it does not throw. Forgetting the
    // `throw` made this refusal a silent no-op that exited 0 — caught by
    // running the command, not by the type checker.
    throw userError(
      `${ENV_NAME} is already set in ${envPath} (${mask(existing)}).`,
      "Use `cerefox api-key show` to see it, or `cerefox api-key rotate` to replace it. " +
        "Refusing to overwrite silently: any client already configured with the old key " +
        "would start getting 401s with no indication why.",
    );
  }
  println(c.bold("Minting a local API key"));
  writeKey(mint(), opts, "write");
  containerHint();
}

function rotateAction(opts: ApiKeyOptions): void {
  const envPath = resolveEnvFile();
  const existing = readEnvVar(envPath, ENV_NAME);
  if (!existing) {
    throw userError(
      `No ${ENV_NAME} in ${envPath} — nothing to rotate.`,
      "Run `cerefox api-key generate` first.",
    );
  }
  println(c.bold("Rotating the local API key"));
  println(c.dim(`   replacing ${mask(existing)}`));
  writeKey(mint(), opts, "replace");
  println(
    c.yellow(
      "   The previous key stops working as soon as the server restarts.\n" +
        "   Update every remote client, then: cerefox web restart",
    ),
  );
}

function showAction(): void {
  const envPath = resolveEnvFile();
  const key = readEnvVar(envPath, ENV_NAME);
  println(c.bold("Local API key"));
  if (!key) {
    println(c.dim(`   none set in ${envPath}`));
    println(
      c.dim(
        "   The server is not gated: callers from any interface it is bound to can\n" +
          "   reach it without a credential. That is fine while it binds 127.0.0.1.\n" +
          "   Mint one with: cerefox api-key generate",
      ),
    );
    containerHint();
    return;
  }
  // Shown in FULL here, unlike `token list` which masks. The whole purpose of
  // this command is to hand the value to a client that needs it, and it reads
  // a file the caller can already `cat`.
  println(`   ${c.green(key)}   ${c.dim(`(${ENV_NAME} in ${envPath})`)}`);
  println(c.dim("   Remote callers send:  Authorization: Bearer <key>"));
}

export function registerApiKey(program: Command): void {
  const group = program
    .command("api-key")
    .description("Manage the local API key for /api/v1 (loopback callers need none).");

  group
    .command("generate")
    .description("Mint a local API key and write it to .env. Refuses if one exists.")
    .option("--no-backup", "Skip the .pre-cerefox.bak backup of an existing .env.")
    .option("--dry-run", "Print the plan without minting or writing anything.")
    .action(generateAction);

  group
    .command("rotate")
    .description("Replace the existing key. Remote clients must be updated.")
    .option("--no-backup", "Skip the .pre-cerefox.bak backup of an existing .env.")
    .option("--dry-run", "Print the plan without minting or writing anything.")
    .action(rotateAction);

  group
    .command("show")
    .description("Print the local API key, in full, for pasting into a client.")
    .action(showAction);
}
