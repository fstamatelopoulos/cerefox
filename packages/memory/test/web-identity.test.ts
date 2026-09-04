/**
 * Caller identity on `/api/v1` (iter-40, #226).
 *
 * The contract these tests exist to hold:
 *
 *  1. **Omitted means nothing changes.** A request with no identity must
 *     resolve to exactly what the API recorded before #226 — `web-ui` / `user`
 *     / `webapp`. Backwards compatibility is the whole design constraint, so it
 *     gets asserted field by field rather than by spot check.
 *  2. **`access_path` is derived, never accepted.** There is deliberately no
 *     way to ask for a particular access path, and no test here grants one:
 *     the only lever is whether the caller identified itself.
 *  3. **A supplied-but-unusable value is an error, not a fallback.** Silently
 *     recording `web-ui` for a caller that tried to name itself is precisely
 *     the failure the feature exists to remove, so it must not be reachable
 *     through a blank string or a wrong type.
 */

import { describe, expect, test } from "bun:test";
import type { Context } from "hono";

import {
  DEFAULT_WEB_AUTHOR,
  resolveCallerIdentity,
  WEB_UI_IDENTITY,
} from "../src/web/identity.ts";

/**
 * The resolver touches exactly one thing on the context: `c.req.header(name)`.
 * A stub keeps these tests at the unit level; the HTTP boundary is covered by
 * `web-integration/attribution.test.ts`.
 */
function ctxWith(headers: Record<string, string> = {}): Context {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    req: { header: (name: string) => lower[name.toLowerCase()] },
  } as unknown as Context;
}

function unwrap(result: ReturnType<typeof resolveCallerIdentity>) {
  if (!result.ok) throw new Error(`expected ok, got: ${result.detail}`);
  return result.identity;
}

describe("resolveCallerIdentity — the unchanged default", () => {
  test("no identity at all resolves to the pre-#226 behaviour", () => {
    const id = unwrap(resolveCallerIdentity(ctxWith()));
    expect(id).toEqual(WEB_UI_IDENTITY);
    // Spelled out, because "equals the constant" would still pass if someone
    // changed the constant. These four values are the compatibility promise.
    expect(id.author).toBe("web-ui");
    expect(id.authorType).toBe("user");
    expect(id.requestor).toBe("web-ui");
    expect(id.accessPath).toBe("webapp");
    expect(id.named).toBe(false);
  });

  test("an empty body is still the default, not an identity", () => {
    const id = unwrap(resolveCallerIdentity(ctxWith(), {}));
    expect(id.accessPath).toBe("webapp");
    expect(id.named).toBe(false);
  });

  test("a body with unrelated fields is still the default", () => {
    // The web app posts title/content/metadata and nothing else. It must keep
    // landing in `webapp`.
    const id = unwrap(
      resolveCallerIdentity(ctxWith(), {
        title: "x",
        content: "y",
        metadata: { type: "note" },
      }),
    );
    expect(id).toEqual(WEB_UI_IDENTITY);
  });

  test("an explicit null identity field reads as not supplied", () => {
    const id = unwrap(resolveCallerIdentity(ctxWith(), { author: null }));
    expect(id).toEqual(WEB_UI_IDENTITY);
  });
});

describe("resolveCallerIdentity — a caller that names itself", () => {
  test("a header author is recorded and flips the access path", () => {
    const id = unwrap(resolveCallerIdentity(ctxWith({ "X-Cerefox-Author": "example-bot" })));
    expect(id.author).toBe("example-bot");
    expect(id.accessPath).toBe("api");
    expect(id.named).toBe(true);
  });

  test("a body author works too", () => {
    const id = unwrap(resolveCallerIdentity(ctxWith(), { author: "example-bot" }));
    expect(id.author).toBe("example-bot");
    expect(id.accessPath).toBe("api");
  });

  test("author and requestor stand in for each other", () => {
    // They name one actor. MCP splits them only because reads and writes log
    // to different tables, so a caller giving one has identified itself for
    // both — otherwise a bot's reads would log as `web-ui` while its writes
    // were attributed correctly, which is the split this feature removes.
    const fromAuthor = unwrap(resolveCallerIdentity(ctxWith({ "x-cerefox-author": "bot" })));
    expect(fromAuthor.requestor).toBe("bot");

    const fromRequestor = unwrap(
      resolveCallerIdentity(ctxWith({ "x-cerefox-requestor": "bot" })),
    );
    expect(fromRequestor.author).toBe("bot");
  });

  test("both supplied are kept distinct", () => {
    const id = unwrap(
      resolveCallerIdentity(
        ctxWith({ "x-cerefox-author": "writer", "x-cerefox-requestor": "reader" }),
      ),
    );
    expect(id.author).toBe("writer");
    expect(id.requestor).toBe("reader");
  });

  test("a header wins over a body field", () => {
    const id = unwrap(
      resolveCallerIdentity(ctxWith({ "x-cerefox-author": "from-header" }), {
        author: "from-body",
      }),
    );
    expect(id.author).toBe("from-header");
  });

  test("surrounding whitespace is trimmed", () => {
    const id = unwrap(resolveCallerIdentity(ctxWith({ "x-cerefox-author": "  bot  " })));
    expect(id.author).toBe("bot");
  });

  test("author_type agent is honoured", () => {
    const id = unwrap(
      resolveCallerIdentity(ctxWith({
        "x-cerefox-author": "bot",
        "x-cerefox-author-type": "agent",
      })),
    );
    expect(id.authorType).toBe("agent");
  });

  test("author_type defaults to user when only a name is given", () => {
    const id = unwrap(resolveCallerIdentity(ctxWith({ "x-cerefox-author": "bot" })));
    expect(id.authorType).toBe("user");
  });

  test("author_type alone counts as naming yourself", () => {
    // It does not identify anyone, but it is still a caller customising its
    // own attribution, which the bundled web app never does. Treating it as
    // `webapp` would file an agent-authored ingest under the web UI.
    const id = unwrap(resolveCallerIdentity(ctxWith({ "x-cerefox-author-type": "agent" })));
    expect(id.accessPath).toBe("api");
    expect(id.author).toBe(DEFAULT_WEB_AUTHOR);
    expect(id.authorType).toBe("agent");
  });
});

describe("resolveCallerIdentity — supplied but unusable is an error", () => {
  test("an unknown author_type is refused, not coerced", () => {
    // cerefox_audit_log CHECKs author_type IN ('user','agent'), so without
    // this the caller gets a raw Postgres constraint error instead of a
    // sentence naming the two valid values.
    const result = resolveCallerIdentity(ctxWith({ "x-cerefox-author-type": "robot" }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.detail).toContain("user");
    expect(result.detail).toContain("agent");
  });

  test("a blank header is refused rather than falling back to web-ui", () => {
    const result = resolveCallerIdentity(ctxWith({ "x-cerefox-author": "   " }));
    expect(result.ok).toBe(false);
  });

  test("a blank body field is refused", () => {
    const result = resolveCallerIdentity(ctxWith(), { requestor: "" });
    expect(result.ok).toBe(false);
  });

  test("a non-string body field is refused", () => {
    const result = resolveCallerIdentity(ctxWith(), { author: 42 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.detail).toContain("author");
  });
});

describe("resolveCallerIdentity — access_path cannot be asked for", () => {
  test("an access_path body field is ignored entirely", () => {
    // Not honoured, and not an error either: it is simply not part of the
    // contract. The value must follow from identity, so that a client cannot
    // claim to be a different transport than it is.
    const id = unwrap(
      resolveCallerIdentity(ctxWith(), { access_path: "local-mcp" }),
    );
    expect(id.accessPath).toBe("webapp");
    expect(id.named).toBe(false);
  });

  test("an access_path header is ignored too", () => {
    const id = unwrap(
      resolveCallerIdentity(ctxWith({ "x-cerefox-access-path": "cli" })),
    );
    expect(id.accessPath).toBe("webapp");
  });

  test("naming yourself is the ONLY way to reach the api path", () => {
    const named = unwrap(resolveCallerIdentity(ctxWith({ "x-cerefox-requestor": "bot" })));
    expect(named.accessPath).toBe("api");
    const anonymous = unwrap(resolveCallerIdentity(ctxWith(), { access_path: "api" }));
    expect(anonymous.accessPath).toBe("webapp");
  });
});
