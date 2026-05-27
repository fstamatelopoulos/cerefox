/**
 * Argument / environment resolution helpers shared by all CLI commands.
 *
 * Identity flags (`--author`, `--author-type`, `--requestor`) cascade in a
 * specific order: CLI flag > environment variable > default. Each command
 * that writes (ingest, ingest-dir, delete-doc) or reads with attribution
 * (search, get-doc, list-projects, get-audit-log, etc.) plumbs these
 * resolutions in a consistent way — matching the Python CLI's behaviour
 * exactly so an agent that learned the Python contract sees no shift.
 *
 * `--metadata` and `--metadata-filter` arrive as JSON strings on the
 * command line and parse here, with stable error messages that map to
 * exit-code 1.
 */

import { userError } from "./exit.ts";

// ── identity resolution ─────────────────────────────────────────────────────

/**
 * Resolve the agent / user name for a WRITE operation.
 *
 * Order: explicit CLI flag > `CEREFOX_AUTHOR_NAME` env > "unknown".
 *
 * Returning "unknown" (rather than throwing) matches the Python behaviour:
 * if neither flag nor env is set, the write still happens but the audit
 * log entry attributes to "unknown". The CLI prints a one-line ⚠ when this
 * happens (handled in the command, not here).
 */
export function resolveAuthor(cliValue: string | undefined): string {
  if (cliValue && cliValue.trim() !== "") return cliValue;
  const fromEnv = process.env.CEREFOX_AUTHOR_NAME;
  if (fromEnv && fromEnv.trim() !== "") return fromEnv;
  return "unknown";
}

/**
 * Resolve the `author_type` for a write: 'user' | 'agent'.
 *
 * Order: explicit CLI flag > `CEREFOX_AUTHOR_TYPE` env > "user".
 *
 * Validation happens here — anything other than 'user' / 'agent' raises
 * `CliError` (exit 1). The default is 'user' because the CLI is run by a
 * human shell most of the time; agents using the CLI via a Bash tool are
 * expected to set `--author-type agent` (or `CEREFOX_AUTHOR_TYPE=agent`).
 */
export function resolveAuthorType(
  cliValue: string | undefined,
): "user" | "agent" {
  const raw = (cliValue || process.env.CEREFOX_AUTHOR_TYPE || "user").trim();
  if (raw !== "user" && raw !== "agent") {
    throw userError(
      `Invalid --author-type "${raw}". Expected "user" or "agent".`,
      "Pass --author-type user or --author-type agent, or set CEREFOX_AUTHOR_TYPE.",
    );
  }
  return raw;
}

/**
 * Resolve the `requestor` for a READ operation.
 *
 * Order: explicit CLI flag > `CEREFOX_REQUESTOR_NAME` env > `CEREFOX_AUTHOR_NAME` env > "unknown".
 *
 * The cascade includes `CEREFOX_AUTHOR_NAME` as a backstop so a user who set
 * one author env var doesn't have to set both — reads inherit the write
 * identity by default.
 */
export function resolveRequestor(cliValue: string | undefined): string {
  if (cliValue && cliValue.trim() !== "") return cliValue;
  const fromEnv =
    process.env.CEREFOX_REQUESTOR_NAME || process.env.CEREFOX_AUTHOR_NAME;
  if (fromEnv && fromEnv.trim() !== "") return fromEnv;
  return "unknown";
}

// ── JSON-arg parsing ────────────────────────────────────────────────────────

/**
 * Parse a JSON-string argument (typically from `--metadata` or
 * `--metadata-filter`) into an object, raising a user-facing error with a
 * pointer to the offending input if parse fails.
 *
 * `null` / `undefined` / empty-string input returns `undefined` (the flag
 * was not provided). An explicit `--metadata '{}'` returns `{}`.
 */
export function parseJsonObjectArg(
  value: string | undefined,
  flagName: string,
): Record<string, unknown> | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw userError(
      `${flagName}: not valid JSON (${msg})`,
      `Pass a JSON object, e.g. --metadata-filter '{"type":"decision-log"}'.`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw userError(
      `${flagName}: must be a JSON object, got ${describeJsonShape(parsed)}.`,
      `Pass a JSON object, e.g. --metadata '{"key":"value"}'.`,
    );
  }
  return parsed as Record<string, unknown>;
}

function describeJsonShape(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}

// ── numeric-arg parsing ─────────────────────────────────────────────────────

/**
 * Parse a CLI string into a positive integer. Used for `--match-count`,
 * `--limit`, `--batch`, etc. Returns the default if the flag wasn't passed.
 */
export function parsePositiveInt(
  value: string | undefined,
  flagName: string,
  defaultValue: number,
): number {
  if (value === undefined || value === null || value === "") return defaultValue;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0 || String(n) !== value.trim()) {
    throw userError(
      `${flagName}: expected a positive integer, got "${value}".`,
    );
  }
  return n;
}

/**
 * Parse a CLI string into a non-negative integer (allows 0). Used for
 * `--max-bytes`, `--alpha` (well, that's a float — see below).
 */
export function parseNonNegativeInt(
  value: string | undefined,
  flagName: string,
  defaultValue: number,
): number {
  if (value === undefined || value === null || value === "") return defaultValue;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0 || String(n) !== value.trim()) {
    throw userError(
      `${flagName}: expected a non-negative integer, got "${value}".`,
    );
  }
  return n;
}

/** Parse a CLI string into a float in [0, 1]. Used for `--alpha`. */
export function parseFloat01(
  value: string | undefined,
  flagName: string,
  defaultValue: number,
): number {
  if (value === undefined || value === null || value === "") return defaultValue;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw userError(
      `${flagName}: expected a number in [0, 1], got "${value}".`,
    );
  }
  return n;
}
