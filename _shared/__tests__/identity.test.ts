/**
 * `callerIdentity()` — the single identity parameter (v1.13.1).
 *
 * Every MCP tool schema lists `author`; `requestor` (the pre-1.13.1 name on
 * most tools) is accepted silently so existing callers keep working.
 */
import { describe, expect, test } from "bun:test";

import { callerIdentity, DEFAULT_IDENTITY } from "../mcp-tools/identity.ts";

describe("callerIdentity", () => {
  test("author is the canonical name", () => {
    expect(callerIdentity({ author: "Claude Code" })).toBe("Claude Code");
  });

  test("requestor is accepted as a compatibility alias", () => {
    expect(callerIdentity({ requestor: "old-agent" })).toBe("old-agent");
  });

  test("author wins when both are supplied", () => {
    expect(callerIdentity({ author: "a", requestor: "r" })).toBe("a");
  });

  test("a blank author falls through to requestor", () => {
    expect(callerIdentity({ author: "  ", requestor: "r" })).toBe("r");
  });

  test("absent, blank or non-string values mean no identity", () => {
    expect(callerIdentity({})).toBeUndefined();
    expect(callerIdentity({ author: "" })).toBeUndefined();
    expect(callerIdentity({ author: 42, requestor: null })).toBeUndefined();
  });

  test("the default identity is the historical one", () => {
    expect(DEFAULT_IDENTITY).toBe("mcp-agent");
  });
});
