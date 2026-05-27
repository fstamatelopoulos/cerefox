/**
 * Typed exit codes for the Cerefox CLI.
 *
 * Per CONTRIBUTING.md (and the v0.5.0 documented exit-codes commitment), the
 * CLI uses a small, stable set of codes. Every command that exits with a
 * non-zero status routes through `exitWith()` so the mapping is enforced in
 * one place.
 *
 *   0  Success — operation completed normally.
 *   1  User error — invalid input, missing required arg, bad flag combo,
 *      validation failure. The user can fix this by re-running with
 *      corrected arguments.
 *   2  System error — couldn't reach Supabase, couldn't read a file we
 *      needed, RPC returned an unexpected shape, an embedding call timed
 *      out. The user typically can't fix this directly; the message
 *      includes a hint (try `cerefox doctor`, check credentials, etc.).
 *   3  Not found — the entity the command targets (document, project,
 *      version) doesn't exist. Separate code so scripts can branch on
 *      "missing" vs "broken".
 *
 * Anything not covered by the above is a 2.
 */

export const EXIT_OK = 0;
export const EXIT_USER_ERROR = 1;
export const EXIT_SYSTEM_ERROR = 2;
export const EXIT_NOT_FOUND = 3;

export type ExitCode =
  | typeof EXIT_OK
  | typeof EXIT_USER_ERROR
  | typeof EXIT_SYSTEM_ERROR
  | typeof EXIT_NOT_FOUND;

/**
 * Error class that carries an exit code. Throwing this from a command
 * handler is the idiomatic way to abort with a specific code; the top-level
 * handler in `bin/cerefox.ts` catches it and calls `process.exit(code)`.
 */
export class CliError extends Error {
  readonly code: ExitCode;
  readonly hint?: string;

  constructor(message: string, code: ExitCode = EXIT_USER_ERROR, hint?: string) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.hint = hint;
  }
}

/** Convenience for the most common shapes. */
export function userError(message: string, hint?: string): CliError {
  return new CliError(message, EXIT_USER_ERROR, hint);
}

export function systemError(message: string, hint?: string): CliError {
  return new CliError(message, EXIT_SYSTEM_ERROR, hint);
}

export function notFound(message: string, hint?: string): CliError {
  return new CliError(message, EXIT_NOT_FOUND, hint);
}
