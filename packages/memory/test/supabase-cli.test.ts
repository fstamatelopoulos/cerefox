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
  test("needs both stdin and stdout to be a terminal", () => {
    expect(personAtTerminal({ isTTY: true }, { isTTY: true })).toBe(true);
    // `echo y | cerefox server deploy`: piped input is not a person answering.
    expect(personAtTerminal({ isTTY: false }, { isTTY: true })).toBe(false);
    expect(personAtTerminal({}, { isTTY: true })).toBe(false);
    expect(personAtTerminal({ isTTY: true }, {})).toBe(false);
  });
});

describe("the pin", () => {
  test("is an exact version", () => {
    expect(SUPABASE_CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(supabaseNpxArgs("--version")).toEqual(["--yes", `supabase@${SUPABASE_CLI_VERSION}`, "--version"]);
  });

  test("no CLI source runs an unpinned Supabase CLI through npx", () => {
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
    const offenders = files.filter((f) => /\[\s*"--yes",\s*"supabase"/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
