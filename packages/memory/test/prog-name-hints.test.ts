/**
 * Hints name the command the user actually types (#352).
 *
 * A hint that says `cerefox …` while the user is on `cerefox-local` or on an
 * alias for a second environment runs against the default environment when
 * copied. The source scan keeps new hints from hard-coding the name.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { progName } from "../src/cli/util/prog-name.ts";

const saved = {
  prog: process.env.CEREFOX_PROG_NAME,
  dir: process.env.CEREFOX_CONFIG_DIR,
};
afterEach(() => {
  for (const [k, v] of [["CEREFOX_PROG_NAME", saved.prog], ["CEREFOX_CONFIG_DIR", saved.dir]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("progName", () => {
  test("plain cerefox by default", () => {
    delete process.env.CEREFOX_PROG_NAME;
    delete process.env.CEREFOX_CONFIG_DIR;
    expect(progName()).toBe("cerefox");
  });

  test("CEREFOX_PROG_NAME wins, including over a config dir", () => {
    process.env.CEREFOX_PROG_NAME = "cerefox-lan";
    process.env.CEREFOX_CONFIG_DIR = "~/.cerefox/lan";
    expect(progName()).toBe("cerefox-lan");
  });

  test("a config dir without a name spells out the full, copy-safe form", () => {
    delete process.env.CEREFOX_PROG_NAME;
    process.env.CEREFOX_CONFIG_DIR = "~/.cerefox/staging";
    expect(progName()).toBe("CEREFOX_CONFIG_DIR=~/.cerefox/staging cerefox");
    process.env.CEREFOX_CONFIG_DIR = "/tmp/my envs/it's";
    expect(progName()).toBe(`CEREFOX_CONFIG_DIR='/tmp/my envs/it'\\''s' cerefox`);
  });

  test("blank values count as unset", () => {
    process.env.CEREFOX_PROG_NAME = "  ";
    process.env.CEREFOX_CONFIG_DIR = " ";
    expect(progName()).toBe("cerefox");
  });
});

/**
 * Lines that may keep a literal `cerefox `, each with its reason. Matched by
 * file and a substring of the line.
 */
const ALLOWED: [file: string, fragment: string, reason: string][] = [
  ["src/web/auth.ts", "cerefox api-key show", "sent to network callers: must not carry the server's config path"],
  ["src/ingestion/pipeline.ts", "cerefox document restore", "reaches /api/v1 callers: same reason"],
  ["src/cli/program.ts", "cerefox sync-docs", "names a removed command"],
  ["src/cli/util/checks.ts", "cerefox v${PKG_VERSION}", "the product version, not a command"],
  ["src/cli/commands/init.ts", "# Cerefox configuration", "a comment written into .env"],
  ["src/cli/commands/init.ts", "# `cerefox token generate`", "a comment written into .env"],
  ["src/cli/commands/token.ts", "managed by `cerefox token`", "a comment written into .env"],
  ["src/cli/commands/deploy-server.ts", "shells out to the Supabase CLI", "describes the command, does not suggest one"],
  // --help text: commander's program name already follows CEREFOX_PROG_NAME.
  ["src/cli/commands/status.ts", ".description(", "--help text"],
  ["src/cli/commands/search.ts", "WITHOUT their content", "--help text"],
  ["src/cli/commands/self-update.ts", "const desc =", "--help text"],
  ["src/cli/commands/restore.ts", ".argument(", "--help text"],
  ["src/cli/commands/version-archive.ts", ".argument(", "--help text"],
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith(".ts") ? [p] : [];
  });
}

test("no runtime message hard-codes `cerefox ` as the command to run", () => {
  const root = join(import.meta.dir, "..");
  const offenders: string[] = [];
  for (const file of sources(join(root, "src"))) {
    const rel = relative(root, file);
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      if (!/`cerefox [a-z-]|["'`]\s+cerefox [a-z-]/.test(line)) return;
      if (ALLOWED.some(([f, frag]) => f === rel && line.includes(frag))) return;
      offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  expect(offenders).toEqual([]);
});
