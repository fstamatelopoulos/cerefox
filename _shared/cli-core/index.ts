/**
 * `_shared/cli-core/` — runtime-neutral helpers shared by every CLI command.
 *
 * Imported by:
 *   - `packages/memory/src/cli/commands/*.ts` (every command file).
 *   - `packages/memory/src/bin/cerefox.ts` (the top-level error handler).
 *
 * Runtime: Node ≥ 20 / Bun ≥ 1. No Deno usage today (the Edge Functions
 * don't need a CLI surface), but the modules avoid runtime-specific APIs
 * so they stay portable.
 */

export {
  CliError,
  EXIT_NOT_FOUND,
  EXIT_OK,
  EXIT_SYSTEM_ERROR,
  EXIT_USER_ERROR,
  notFound,
  systemError,
  userError,
  type ExitCode,
} from "./exit.ts";

export {
  c,
  cErr,
  eprintln,
  errorln,
  info,
  ok,
  printJson,
  println,
  printTable,
  warn,
} from "./output.ts";

export {
  parseFloat01,
  parseJsonObjectArg,
  parseNonNegativeInt,
  parsePositiveInt,
  resolveAuthor,
  resolveAuthorType,
  resolveRequestor,
} from "./argv.ts";

export { ask, confirm, validators, type AskOptions } from "./prompts.ts";
