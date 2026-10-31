/**
 * The environment for an `npx <tool>` that the CLI spawns (the Supabase CLI).
 *
 * When cerefox itself runs as `npx --package=@cerefox/memory cerefox …`, npm
 * puts `npm_config_package` in the environment, and a nested `npx supabase`
 * inherits it: npm then looks for a `supabase` bin inside @cerefox/memory and
 * fails with "command not found". `server deploy` reported the Supabase CLI as
 * unreachable for exactly that reason. Dropping the variable gives the nested
 * call a clean resolution; nothing else npm sets changes which package it runs.
 */
export function nestedNpxEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const { npm_config_package: _leaked, ...rest } = env;
  return rest;
}
