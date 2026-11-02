/**
 * The command a user types to reach this environment, for the hints and
 * messages that tell them what to run next (#352).
 *
 * A hint that says `cerefox …` while the user is on `cerefox-local` or on an
 * alias for a second environment (`cfx-stg`) runs against the default
 * environment when copied, so a `config set` or `server deploy` lands on the
 * wrong store. The CLI cannot see a shell alias, so it is told:
 *
 *   1. `CEREFOX_PROG_NAME`: set by the `cerefox-local` host script, or in an
 *      environment's `.env` (loaded before any command runs; the file's value
 *      wins over an inherited one, see loadEnv).
 *   2. Otherwise, with `CEREFOX_CONFIG_DIR` set, the full form
 *      `CEREFOX_CONFIG_DIR=<dir> cerefox`, which is always safe to copy.
 *   3. Otherwise `cerefox`.
 *
 * Help and usage text use only (1), through commander's program name.
 */
export function progName(): string {
  const name = (process.env.CEREFOX_PROG_NAME ?? "").trim();
  if (name) return name;
  const dir = (process.env.CEREFOX_CONFIG_DIR ?? "").trim();
  if (!dir) return "cerefox";
  // Anything outside a plain path's characters is single-quoted, so the hint
  // stays one shell word ("/tmp/a;b" must not split the command).
  return /^[A-Za-z0-9_\/.~+,:@%=-]+$/.test(dir)
    ? `CEREFOX_CONFIG_DIR=${dir} cerefox`
    : `CEREFOX_CONFIG_DIR='${dir.replace(/'/g, `'\\''`)}' cerefox`;
}
