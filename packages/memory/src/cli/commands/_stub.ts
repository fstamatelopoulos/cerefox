/**
 * Stub helper used by command files during iter-23 incremental ports.
 *
 * A command's `register*()` function calls `stubAction(...)` for its
 * action body when the real handler hasn't been ported yet. The stub
 * surfaces a clear "not yet implemented" message and exits 2 (system
 * error), pointing at the relevant plan.md Part for context.
 *
 * Once the command lands, replace the `.action(stubAction(...))` call
 * with `.action(async (...args) => { ... })`. Don't leave stub callers
 * in `main` past iter-23.
 */

import { CliError, EXIT_SYSTEM_ERROR } from "../../../../../_shared/cli-core/index.ts";

export function stubAction(commandName: string, planPart: string): () => never {
  return () => {
    throw new CliError(
      `\`cerefox ${commandName}\` is not yet implemented in the TypeScript CLI.\n` +
        `Tracked under \`docs/plan.md\` § Iteration 23 / Part ${planPart}.\n` +
        `For now, run \`uv run cerefox ${commandName}\` from a Cerefox checkout.`,
      EXIT_SYSTEM_ERROR,
      `Track progress at https://github.com/fstamatelopoulos/cerefox/pulls?q=v0.5.0`,
    );
  };
}
