/**
 * Thin wrapper over `prompts` for the interactive `cerefox init` flow.
 *
 * Why a wrapper? Two reasons:
 *   1. `prompts` is configured here once with the right cancel behaviour
 *      (Ctrl-C exits 130, not "the prompt returned undefined").
 *   2. The non-interactive `--config <file>.json` mode of `init` reuses the
 *      same shape: the JSON file's keys map to prompt names, and the same
 *      validator functions run. Keeping the validators here means both
 *      paths share them.
 */

import promptsImpl from "prompts";
import { userError } from "./exit.ts";

export interface AskOptions {
  type: "text" | "password";
  name: string;
  message: string;
  initial?: string;
  /** Return null/undefined for valid; return a string for invalid (the message). */
  validate?: (value: string) => true | string;
}

/**
 * Ask a single question and return the answer. Throws `CliError` (exit
 * code 130-equivalent) if the user cancels with Ctrl-C.
 *
 * `prompts` returns `{}` (no entry) on cancel rather than rejecting. We
 * normalize: cancel means "abort the whole command" with the standard
 * exit code, not "continue with undefined".
 */
export async function ask(opts: AskOptions): Promise<string> {
  const response = await promptsImpl(
    {
      type: opts.type,
      name: opts.name,
      message: opts.message,
      initial: opts.initial,
      validate: opts.validate
        ? (value: string) => {
            const r = opts.validate!(value);
            return r === true ? true : r;
          }
        : undefined,
    },
    {
      onCancel: () => {
        // Returning false aborts further prompts in the chain. We then
        // raise so the top-level handler exits cleanly.
        return false;
      },
    },
  );
  const value = response[opts.name];
  if (value === undefined) {
    throw userError("Aborted by user (Ctrl-C).");
  }
  return String(value);
}

/**
 * Ask a yes/no question. Default is yes unless `defaultNo` is true.
 */
export async function confirm(message: string, defaultNo: boolean = false): Promise<boolean> {
  const response = await promptsImpl(
    {
      type: "confirm",
      name: "value",
      message,
      initial: !defaultNo,
    },
    {
      onCancel: () => false,
    },
  );
  if (response.value === undefined) {
    throw userError("Aborted by user (Ctrl-C).");
  }
  return Boolean(response.value);
}

// ── reusable validators ─────────────────────────────────────────────────────

export const validators = {
  /** Anything non-empty after trim. */
  nonEmpty(value: string): true | string {
    return value.trim().length > 0 ? true : "Required.";
  },

  /** Must look like an https URL. */
  httpsUrl(value: string): true | string {
    if (value.trim() === "") return "Required.";
    try {
      const u = new URL(value);
      if (u.protocol !== "https:") return "Must be an https:// URL.";
      return true;
    } catch {
      return "Not a valid URL.";
    }
  },

  /** Looks like a Supabase secret-style key (sb_secret_… or legacy eyJ JWT). */
  supabaseKey(value: string): true | string {
    if (value.trim() === "") return "Required.";
    if (value.startsWith("sb_secret_") || value.startsWith("eyJ")) return true;
    return "Expected 'sb_secret_…' (new) or 'eyJ…' (legacy service_role JWT).";
  },

  /** Looks like an OpenAI key. */
  openaiKey(value: string): true | string {
    if (value.trim() === "") return "Required.";
    if (value.startsWith("sk-")) return true;
    return "Expected an OpenAI API key starting with 'sk-'.";
  },

  /** Postgres connection URL — light shape check, not a full parse. */
  postgresUrl(value: string): true | string {
    if (value.trim() === "") return "Required.";
    if (!value.startsWith("postgresql://") && !value.startsWith("postgres://")) {
      return "Expected a 'postgresql://…' connection URL.";
    }
    return true;
  },
};
