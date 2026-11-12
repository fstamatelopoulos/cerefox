/**
 * How Cerefox runs the Supabase CLI (#363).
 *
 * `cerefox server deploy` and `cerefox token` shell out to the Supabase CLI
 * through npx. It used to be unpinned, so every run took the latest release,
 * and Supabase CLI 3.0 changed our deploy with no Cerefox release: it now
 * refuses to change a hosted project unless the run carries consent (`--yes`,
 * or `SUPABASE_YES` exported in the shell). A run whose output is not a
 * terminal cannot ask, and the deploy captures the CLI's output, so every
 * person's deploy failed as well as every agent's.
 *
 * The version is pinned here and bumped deliberately, after checking the
 * flags Cerefox passes still mean the same thing.
 */

export const SUPABASE_CLI_VERSION = "3.1.0";

/** The npx arguments for one Supabase CLI command, at the pinned version. */
export function supabaseNpxArgs(...command: string[]): string[] {
  return ["--yes", `supabase@${SUPABASE_CLI_VERSION}`, ...command];
}

/**
 * Is a person at a terminal? Only then can an answer to Cerefox's own prompt
 * stand for theirs. Piped input (an agent's shell, `echo y |`) is not a person
 * answering, so it never earns the Supabase CLI its `--yes` (the Supabase CLI
 * stopped accepting piped answers in 3.0 for the same reason).
 */
export function personAtTerminal(
  stdin: { isTTY?: boolean } = process.stdin,
  stdout: { isTTY?: boolean } = process.stdout,
): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY);
}

/**
 * Supabase CLI 3's refusal to change a hosted project without consent, read
 * from its output. "agent" when it detected an AI agent (a person must run
 * the command), "non-interactive" when it simply could not ask.
 */
export function consentRefusal(output: string): "agent" | "non-interactive" | null {
  if (!/Confirmation required|HostedMutationConsentRequiredError/.test(output)) return null;
  return /agent mode/i.test(output) ? "agent" : "non-interactive";
}
