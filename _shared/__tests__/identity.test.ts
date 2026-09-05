/**
 * `callerIdentity()` — the single identity parameter (v1.13.1).
 *
 * Every MCP tool schema lists `author`; `requestor` (the pre-1.13.1 name on
 * most tools) is accepted silently so existing callers keep working.
 */
import { describe, expect, test } from "bun:test";

import { auditLogIdentity, callerIdentity, DEFAULT_IDENTITY } from "../mcp-tools/identity.ts";

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

describe("auditLogIdentity", () => {
  test("current shape: author is the caller, by_author the filter", () => {
    expect(auditLogIdentity({ author: "me", by_author: "alice" })).toEqual({ identity: "me", byAuthor: "alice" });
    expect(auditLogIdentity({ author: "me" })).toEqual({ identity: "me", byAuthor: undefined });
  });

  test("legacy shape (requestor + author-as-filter) keeps its meaning", () => {
    // A pre-1.13.1 MCP client or a pre-4.0.0 GPT Actions block sends this.
    // The filter must not become a phantom reader in the usage log.
    expect(auditLogIdentity({ requestor: "ChatGPT", author: "alice" })).toEqual({ identity: "ChatGPT", byAuthor: "alice" });
    expect(auditLogIdentity({ requestor: "ChatGPT" })).toEqual({ identity: "ChatGPT", byAuthor: undefined });
  });

  test("by_author present means the current shape, whatever else is sent", () => {
    expect(auditLogIdentity({ requestor: "old", author: "me", by_author: "alice" })).toEqual({ identity: "me", byAuthor: "alice" });
  });

  test("blank values count as absent", () => {
    expect(auditLogIdentity({ author: " ", by_author: "" })).toEqual({ identity: undefined, byAuthor: undefined });
  });
});
