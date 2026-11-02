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
    // Shell metacharacters stay inside one quoted word.
    process.env.CEREFOX_CONFIG_DIR = "/tmp/a;b";
    expect(progName()).toBe("CEREFOX_CONFIG_DIR='/tmp/a;b' cerefox");
    process.env.CEREFOX_CONFIG_DIR = "/tmp/a(b)";
    expect(progName()).toBe("CEREFOX_CONFIG_DIR='/tmp/a(b)' cerefox");
    process.env.CEREFOX_CONFIG_DIR = "/tmp/a&b|c*";
    expect(progName()).toBe("CEREFOX_CONFIG_DIR='/tmp/a&b|c*' cerefox");
  });

  test("blank values count as unset", () => {
    process.env.CEREFOX_PROG_NAME = "  ";
    process.env.CEREFOX_CONFIG_DIR = " ";
    expect(progName()).toBe("cerefox");
  });
});

/**
 * Lines that may keep a literal `cerefox <command>`, each with its reason.
 * Matched by file and a substring of the line.
 */
const ALLOWED: [file: string, fragment: string, reason: string][] = [
  // Network callers: must not carry the server's config path.
  ["src/web/auth.ts", "cerefox api-key show", "401 body sent to network callers"],
  ["src/ingestion/pipeline.ts", "cerefox document restore", "reaches /api/v1 callers"],
  ["src/web/routes/documents-write.ts", "cerefox config set review_workflow_enabled", "an /api/v1 error body"],
  ["src/web/routes/discovery.ts", "cerefox config set review_workflow_enabled", "an /api/v1 error body"],
  ["src/update-check.ts", "cerefox self-update", "the update command, also served to the web UI over the API"],
  // Not a suggestion to run something in this environment.
  ["src/cli/util/checks.ts", "cerefox v${PKG_VERSION}", "the product version"],
  ["src/cli/commands/init.ts", "# Cerefox configuration", "a comment written into .env"],
  ["src/cli/commands/init.ts", "# `cerefox token generate`", "a comment written into .env"],
  ["src/cli/commands/token.ts", "managed by `cerefox token`", "a comment written into .env"],
  ["src/cli/commands/api-key.ts", "(cerefox api-key)", "a comment written into .env"],
  ["src/cli/commands/deploy-server.ts", "shells out to the Supabase CLI", "describes the command"],
  // --help text: commander's program name already follows CEREFOX_PROG_NAME.
  ["src/cli/commands/status.ts", ".description(", "--help text"],
  ["src/cli/commands/search.ts", "WITHOUT their content", "--help text"],
  ["src/cli/commands/self-update.ts", "const desc =", "--help text"],
  ["src/cli/commands/restore.ts", ".argument(", "--help text"],
  ["src/cli/commands/version-archive.ts", ".argument(", "--help text"],
  ["src/cli/commands/document-partial-edit.ts", "content_hash you are basing this on", "--help text"],
];

// Every top-level command and group, so a hint is caught with or without
// backticks ("Run cerefox doctor" and "Run `cerefox doctor`").
const COMMANDS = [
  "init", "doctor", "status", "search", "document", "project", "metadata", "audit", "config",
  "backup", "server", "guides", "configure-agent", "self-update", "upgrade", "mcp", "web",
  "completion", "token", "api-key", "embedder-warmup", "version",
];
const HARD_CODED = new RegExp(`(?<![\\w$./-])cerefox (?:${COMMANDS.join("|")})\\b`);

/** Lines of `source` that name `cerefox <command>` outside a comment. */
function hardCoded(source: string): number[] {
  const hits: number[] = [];
  source.split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    if (HARD_CODED.test(line)) hits.push(i + 1);
  });
  return hits;
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("the hard-coded hint scan", () => {
  test("catches a hint in either string form, with or without backticks", () => {
    expect(hardCoded('println("Run cerefox doctor");')).toEqual([1]);
    expect(hardCoded("println(`Run cerefox doctor`);")).toEqual([1]);
    expect(hardCoded('hint: "Run `cerefox config set x 1`",')).toEqual([1]);
    expect(hardCoded("hint: `Run \\`cerefox server deploy\\``,")).toEqual([1]);
  });

  test("ignores comments, the helper, cerefox-local and non-commands", () => {
    expect(hardCoded("// Run cerefox doctor")).toEqual([]);
    expect(hardCoded(" * `cerefox doctor` runs this")).toEqual([]);
    expect(hardCoded("hint: `Run \\`${progName()} doctor\\``,")).toEqual([]);
    expect(hardCoded('"cerefox-local embedder-warmup"')).toEqual([]);
    expect(hardCoded('"cerefox_config table"')).toEqual([]);
  });

  test("no runtime message hard-codes the command", () => {
    const root = join(import.meta.dir, "..");
    const offenders: string[] = [];
    for (const file of sources(join(root, "src"))) {
      const rel = relative(root, file);
      const lines = readFileSync(file, "utf8").split("\n");
      for (const n of hardCoded(lines.join("\n"))) {
        const line = lines[n - 1];
        if (ALLOWED.some(([f, frag]) => f === rel && line.includes(frag))) continue;
        offenders.push(`${rel}:${n}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
