/**
 * The Supabase CLI pin and its consent guard (#363).
 *
 * The refusal strings are the CLI's own replies: the agent one from a deploy
 * an AI agent ran on 2026-11-07, the other from a person's `cerefox server
 * deploy --functions-only` in a terminal on 2026-11-11, which failed because
 * the deploy captures the CLI's output and the CLI could not ask.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AGENT_ENV_VARS,
  agentDetected,
  consentRefusal,
  personAtTerminal,
  SUPABASE_CLI_VERSION,
  supabaseNpxArgs,
} from "../src/cli/util/supabase-cli.ts";

const AGENT_REFUSAL =
  "HostedMutationConsentRequiredError: Confirmation required: Deploy 1 Function (target: project x). " +
  "This run can't ask because it is running in agent mode. Nothing was changed.";
const NO_TERMINAL_REFUSAL =
  "Confirmation required: Deploy 1 Function (target: project cerefox (abc) · production). " +
  "This run can't ask because stdout is not a terminal. Nothing was changed.\nRe-run with --yes to confirm.";

describe("consentRefusal", () => {
  test("tells an agent refusal from a run that could not ask", () => {
    expect(consentRefusal(AGENT_REFUSAL)).toBe("agent");
    expect(consentRefusal(NO_TERMINAL_REFUSAL)).toBe("non-interactive");
  });

  test("ignores other failures", () => {
    expect(consentRefusal("Failed to bundle the function (reason: Could not find npm package 'x')")).toBeNull();
    expect(consentRefusal("unexpected deploy status 401: Unauthorized")).toBeNull();
    expect(consentRefusal("")).toBeNull();
  });
});

describe("personAtTerminal", () => {
  const person = {};
  test("needs both stdin and stdout to be a terminal", () => {
    expect(personAtTerminal({ isTTY: true }, { isTTY: true }, person)).toBe(true);
    // `echo y | cerefox server deploy`: piped input is not a person answering.
    expect(personAtTerminal({ isTTY: false }, { isTTY: true }, person)).toBe(false);
    expect(personAtTerminal({}, { isTTY: true }, person)).toBe(false);
    expect(personAtTerminal({ isTTY: true }, {}, person)).toBe(false);
  });

  test("an agent driving a real terminal is not a person", () => {
    for (const name of AGENT_ENV_VARS) {
      expect(personAtTerminal({ isTTY: true }, { isTTY: true }, { [name]: "1" })).toBe(false);
    }
  });
});

describe("agentDetected", () => {
  test("reads the variables the Supabase CLI 3.1.0 reads", () => {
    // From the 3.1.0 binary. Bump with the pin: a new CLI may add names.
    expect([...AGENT_ENV_VARS].sort()).toEqual([
      "AI_AGENT", "CLAUDECODE", "CLAUDE_CODE", "CODEX_CI", "CODEX_SANDBOX", "CODEX_THREAD_ID",
      "CURSOR_AGENT", "GEMINI_CLI",
    ]);
    expect(agentDetected({})).toBe(false);
    expect(agentDetected({ CLAUDECODE: "1" })).toBe(true);
    expect(agentDetected({ CLAUDECODE: "" })).toBe(false);
  });
});

describe("the pin", () => {
  test("is an exact version", () => {
    expect(SUPABASE_CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(supabaseNpxArgs("--version")).toEqual(["--yes", `supabase@${SUPABASE_CLI_VERSION}`, "--version"]);
  });

  test("every spawn of the Supabase CLI goes through the pinned arguments", () => {
    // An unpinned `npx supabase` takes whatever release is latest, which is
    // how Supabase CLI 3.0 changed the deploy with no Cerefox release.
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.ts$/.test(e)) files.push(p);
      }
    };
    walk(root);
    // A literal "supabase" or "supabase@…" element in a spawn's arguments, or
    // the bare binary, instead of supabaseNpxArgs(...).
    const spawnsCli =
      /spawn(?:Sync)?\(\s*["'`]npx["'`]\s*,\s*\[[^\]]*["'`]supabase(?:@[^"'`]*)?["'`]|spawn(?:Sync)?\(\s*["'`]supabase["'`]/;
    // The same arguments built in a variable first, the shape that shipped unpinned.
    const literalArgs = /\[\s*["'`]--yes["'`]\s*,\s*["'`]supabase(?:@[^"'`]*)?["'`]/;
    const offenders = files
      .filter((f) => !f.endsWith("supabase-cli.ts"))
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        return spawnsCli.test(src) || literalArgs.test(src);
      });
    expect(offenders).toEqual([]);
  });
});
