/**
 * `_shared/cli-core/` — unit tests.
 *
 * Covers:
 *   - Exit codes + CliError shape.
 *   - argv parsing helpers (resolveAuthor/AuthorType/Requestor, parseJsonObjectArg,
 *     parsePositiveInt / parseNonNegativeInt / parseFloat01).
 *
 * Output helpers (`printTable`, `printJson`, ANSI gating) are mostly
 * stdout-side-effect — covered indirectly via the CLI smoke test, not
 * unit-tested here.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  CliError,
  EXIT_NOT_FOUND,
  EXIT_SYSTEM_ERROR,
  EXIT_USER_ERROR,
  notFound,
  systemError,
  userError,
} from "../cli-core/exit.ts";
import {
  parseFloat01,
  parseJsonObjectArg,
  parseNonNegativeInt,
  parsePositiveInt,
  resolveAuthor,
  resolveAuthorType,
  resolveRequestor,
} from "../cli-core/argv.ts";

// ── exit ─────────────────────────────────────────────────────────────────

describe("CliError + helpers", () => {
  test("userError defaults to exit 1", () => {
    const e = userError("bad input");
    expect(e).toBeInstanceOf(CliError);
    expect(e.code).toBe(EXIT_USER_ERROR);
    expect(e.message).toBe("bad input");
  });

  test("systemError exits 2", () => {
    expect(systemError("oops").code).toBe(EXIT_SYSTEM_ERROR);
  });

  test("notFound exits 3", () => {
    expect(notFound("no doc").code).toBe(EXIT_NOT_FOUND);
  });

  test("hint is preserved", () => {
    expect(userError("m", "try foo").hint).toBe("try foo");
    expect(userError("m").hint).toBeUndefined();
  });
});

// ── argv: identity ───────────────────────────────────────────────────────

describe("resolveAuthor / AuthorType / Requestor", () => {
  const savedEnv = {
    name: process.env.CEREFOX_AUTHOR_NAME,
    type: process.env.CEREFOX_AUTHOR_TYPE,
    requestor: process.env.CEREFOX_REQUESTOR_NAME,
  };

  beforeEach(() => {
    delete process.env.CEREFOX_AUTHOR_NAME;
    delete process.env.CEREFOX_AUTHOR_TYPE;
    delete process.env.CEREFOX_REQUESTOR_NAME;
  });

  afterEach(() => {
    if (savedEnv.name) process.env.CEREFOX_AUTHOR_NAME = savedEnv.name;
    if (savedEnv.type) process.env.CEREFOX_AUTHOR_TYPE = savedEnv.type;
    if (savedEnv.requestor) process.env.CEREFOX_REQUESTOR_NAME = savedEnv.requestor;
  });

  test("resolveAuthor: cli flag wins over env", () => {
    process.env.CEREFOX_AUTHOR_NAME = "from-env";
    expect(resolveAuthor("from-cli")).toBe("from-cli");
  });

  test("resolveAuthor: env used when no cli flag", () => {
    process.env.CEREFOX_AUTHOR_NAME = "from-env";
    expect(resolveAuthor(undefined)).toBe("from-env");
  });

  test("resolveAuthor: falls back to 'unknown'", () => {
    expect(resolveAuthor(undefined)).toBe("unknown");
    expect(resolveAuthor("")).toBe("unknown");
  });

  test("resolveAuthorType: validates user/agent", () => {
    expect(resolveAuthorType("user")).toBe("user");
    expect(resolveAuthorType("agent")).toBe("agent");
    expect(resolveAuthorType(undefined)).toBe("user");
  });

  test("resolveAuthorType: rejects invalid values", () => {
    expect(() => resolveAuthorType("admin")).toThrow(CliError);
    try {
      resolveAuthorType("bot");
    } catch (err) {
      expect((err as CliError).code).toBe(EXIT_USER_ERROR);
    }
  });

  test("resolveRequestor: env cascade includes CEREFOX_AUTHOR_NAME backstop", () => {
    process.env.CEREFOX_AUTHOR_NAME = "fotis";
    expect(resolveRequestor(undefined)).toBe("fotis");
  });

  test("resolveRequestor: CEREFOX_REQUESTOR_NAME wins over author backstop", () => {
    process.env.CEREFOX_AUTHOR_NAME = "fotis";
    process.env.CEREFOX_REQUESTOR_NAME = "agent-x";
    expect(resolveRequestor(undefined)).toBe("agent-x");
  });
});

// ── argv: JSON / numeric ─────────────────────────────────────────────────

describe("parseJsonObjectArg", () => {
  test("undefined / empty returns undefined", () => {
    expect(parseJsonObjectArg(undefined, "--metadata")).toBeUndefined();
    expect(parseJsonObjectArg("", "--metadata")).toBeUndefined();
  });

  test("valid object returns the object", () => {
    expect(parseJsonObjectArg('{"a":1}', "--metadata")).toEqual({ a: 1 });
    expect(parseJsonObjectArg("{}", "--metadata")).toEqual({});
  });

  test("invalid JSON throws CliError exit 1", () => {
    expect(() => parseJsonObjectArg("not-json", "--metadata")).toThrow(CliError);
    try {
      parseJsonObjectArg("not-json", "--metadata");
    } catch (err) {
      expect((err as CliError).code).toBe(EXIT_USER_ERROR);
      expect((err as CliError).message).toContain("--metadata");
    }
  });

  test("array / null / number rejected (must be object)", () => {
    expect(() => parseJsonObjectArg("[]", "--metadata")).toThrow(CliError);
    expect(() => parseJsonObjectArg("null", "--metadata")).toThrow(CliError);
    expect(() => parseJsonObjectArg("42", "--metadata")).toThrow(CliError);
  });
});

describe("parsePositiveInt / parseNonNegativeInt / parseFloat01", () => {
  test("parsePositiveInt: positive int round-trips", () => {
    expect(parsePositiveInt("5", "--match-count", 1)).toBe(5);
    expect(parsePositiveInt(undefined, "--match-count", 1)).toBe(1);
  });

  test("parsePositiveInt: rejects 0 / negative / float / non-numeric", () => {
    expect(() => parsePositiveInt("0", "--n", 1)).toThrow(CliError);
    expect(() => parsePositiveInt("-3", "--n", 1)).toThrow(CliError);
    expect(() => parsePositiveInt("3.5", "--n", 1)).toThrow(CliError);
    expect(() => parsePositiveInt("abc", "--n", 1)).toThrow(CliError);
  });

  test("parseNonNegativeInt: accepts 0", () => {
    expect(parseNonNegativeInt("0", "--n", 5)).toBe(0);
    expect(parseNonNegativeInt(undefined, "--n", 5)).toBe(5);
  });

  test("parseFloat01: accepts [0, 1] inclusive", () => {
    expect(parseFloat01("0", "--alpha", 0.7)).toBe(0);
    expect(parseFloat01("1", "--alpha", 0.7)).toBe(1);
    expect(parseFloat01("0.5", "--alpha", 0.7)).toBe(0.5);
    expect(parseFloat01(undefined, "--alpha", 0.7)).toBe(0.7);
  });

  test("parseFloat01: rejects out-of-range", () => {
    expect(() => parseFloat01("-0.1", "--alpha", 0.7)).toThrow(CliError);
    expect(() => parseFloat01("1.1", "--alpha", 0.7)).toThrow(CliError);
    expect(() => parseFloat01("foo", "--alpha", 0.7)).toThrow(CliError);
  });
});
