/**
 * The browser's API key and the client that sends it (#346), with `fetch` and
 * Web Storage stubbed: no browser, no network.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  apiFetch,
  apiRequest,
  AuthRequiredError,
  apiPathOf,
  checkApiKey,
  filenameFrom,
} from "../api/client";
import {
  forgetApiKey,
  getApiKey,
  getAuthPrompt,
  getKeyGeneration,
  isCerefoxChallenge,
  noteChallenge,
  resetApiKeyStateForTests,
  setApiKey,
} from "./apiKey";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

const CHALLENGE = 'Bearer realm="cerefox"';
type Call = { url: string; headers: Record<string, string> };

let session: MemoryStorage;
let local: MemoryStorage;
let calls: Call[];
let respond: (call: Call) => Response;
const realFetch = globalThis.fetch;

function install(name: "sessionStorage" | "localStorage", value: unknown) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

beforeEach(() => {
  resetApiKeyStateForTests();
  session = new MemoryStorage();
  local = new MemoryStorage();
  install("sessionStorage", session);
  install("localStorage", local);
  calls = [];
  respond = () => Response.json({ ok: true });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), headers: { ...(init?.headers as Record<string, string>) } };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  resetApiKeyStateForTests();
});

const refused = () =>
  new Response(JSON.stringify({ detail: "needs key" }), {
    status: 401,
    headers: { "WWW-Authenticate": CHALLENGE },
  });

describe("the key store", () => {
  test("session storage by default, local storage when remembered", () => {
    setApiKey("cfx_lak_a", false);
    expect(session.getItem("cerefox.apiKey")).toBe("cfx_lak_a");
    expect(local.getItem("cerefox.apiKey")).toBeNull();
    setApiKey("cfx_lak_b", true);
    expect(local.getItem("cerefox.apiKey")).toBe("cfx_lak_b");
    expect(session.getItem("cerefox.apiKey")).toBeNull();
  });

  test("a remembered key is found after a reload", () => {
    local.setItem("cerefox.apiKey", "cfx_lak_saved");
    expect(getApiKey()).toBe("cfx_lak_saved");
  });

  test("forget clears both storages and memory", () => {
    setApiKey("cfx_lak_a", true);
    session.setItem("cerefox.apiKey", "stray");
    forgetApiKey();
    expect(getApiKey()).toBeNull();
    expect(local.data.size + session.data.size).toBe(0);
  });

  test("blocked storage: the key lives in memory", () => {
    const throwing = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
    };
    install("sessionStorage", throwing);
    install("localStorage", throwing);
    setApiKey("cfx_lak_mem", true);
    expect(getApiKey()).toBe("cfx_lak_mem");
    forgetApiKey();
    expect(getApiKey()).toBeNull();
  });

  test("a storage accessor that throws is survived", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    setApiKey("cfx_lak_s", true);
    expect(getApiKey()).toBe("cfx_lak_s");
  });
});

describe("challenge detection", () => {
  test("only a 401 with the Cerefox realm", () => {
    expect(isCerefoxChallenge(401, CHALLENGE)).toBe(true);
    expect(isCerefoxChallenge(401, null)).toBe(false);
    expect(isCerefoxChallenge(401, 'Bearer realm="other"')).toBe(false);
    expect(isCerefoxChallenge(403, CHALLENGE)).toBe(false);
    expect(isCerefoxChallenge(200, CHALLENGE)).toBe(false);
  });

  test("a refusal with no key asks for one; with a key, says it was rejected", () => {
    noteChallenge(null);
    expect(getAuthPrompt()).toBe("missing");
    setApiKey("cfx_lak_old", true);
    expect(getAuthPrompt()).toBeNull();
    noteChallenge("cfx_lak_old");
    expect(getAuthPrompt()).toBe("rejected");
    expect(getApiKey()).toBeNull();
    expect(local.data.size).toBe(0);
    // A second refusal (a concurrent call) keeps the "rejected" notice.
    noteChallenge("cfx_lak_old");
    expect(getAuthPrompt()).toBe("rejected");
  });

  test("a late refusal of a keyless call does not drop a key entered since", () => {
    noteChallenge(null);
    setApiKey("cfx_lak_new", false);
    noteChallenge(null);
    expect(getApiKey()).toBe("cfx_lak_new");
    expect(getAuthPrompt()).toBeNull();
    // Nor does a late refusal of an older key.
    noteChallenge("cfx_lak_older");
    expect(getApiKey()).toBe("cfx_lak_new");
  });

  test("a late refusal does not drop the same key typed again", () => {
    setApiKey("cfx_lak_k", false);
    const sentUnder = getKeyGeneration();
    noteChallenge("cfx_lak_k", sentUnder); // the first refusal drops it
    expect(getApiKey()).toBeNull();
    setApiKey("cfx_lak_k", false); // re-entered, and accepted by the check
    noteChallenge("cfx_lak_k", sentUnder); // a second call from before, late
    expect(getApiKey()).toBe("cfx_lak_k");
    expect(getAuthPrompt()).toBeNull();
  });

  test("through the client: a slow refused call cannot clear a re-entered key", async () => {
    setApiKey("cfx_lak_k", false);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const stub = globalThis.fetch;
    globalThis.fetch = (async (i: RequestInfo | URL, init?: RequestInit) => {
      if (String(i).endsWith("/projects")) await gate;
      return stub(i, init);
    }) as typeof fetch;
    respond = refused;
    const slow = apiFetch("/projects").catch((e) => e); // sent with K
    await apiFetch("/dashboard").catch(() => {}); // refused now: K dropped
    expect(getApiKey()).toBeNull();
    setApiKey("cfx_lak_k", false); // the user types K again
    release();
    expect(await slow).toBeInstanceOf(AuthRequiredError);
    expect(getApiKey()).toBe("cfx_lak_k");
  });
});

describe("the client", () => {
  test("no key: no Authorization header; JSON content type", async () => {
    await apiFetch("/projects");
    expect(calls[0].url).toBe("/api/v1/projects");
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
  });

  test("with a key: Bearer header on every call", async () => {
    setApiKey("cfx_lak_k", false);
    await apiFetch("/projects");
    await apiRequest("/docs");
    expect(calls.map((c) => c.headers.Authorization)).toEqual([
      "Bearer cfx_lak_k",
      "Bearer cfx_lak_k",
    ]);
  });

  test("a FormData body gets no content type, so the browser sets the boundary", async () => {
    setApiKey("cfx_lak_k", false);
    const form = new FormData();
    form.append("file", new Blob(["# x"]), "x.md");
    await apiRequest("/ingest/file", { method: "POST", body: form });
    expect(calls[0].headers["Content-Type"]).toBeUndefined();
    expect(calls[0].headers.Authorization).toBe("Bearer cfx_lak_k");
  });

  test("a challenge throws AuthRequiredError (an ApiError 401) and opens the prompt", async () => {
    respond = refused;
    const err = await apiFetch("/projects").catch((e) => e);
    expect(err).toBeInstanceOf(AuthRequiredError);
    expect(err.status).toBe(401);
    expect(getAuthPrompt()).toBe("missing");
  });

  test("an ordinary 401 without the realm is a plain ApiError, no prompt", async () => {
    respond = () => new Response("{}", { status: 401 });
    const err = await apiFetch("/projects").catch((e) => e);
    expect(err).not.toBeInstanceOf(AuthRequiredError);
    expect(getAuthPrompt()).toBeNull();
  });

  test("while the prompt is open no request reaches the network", async () => {
    respond = refused;
    await Promise.all(
      Array.from({ length: 5 }, () => apiFetch("/dashboard").catch((e) => e)),
    );
    const afterBurst = calls.length;
    expect(afterBurst).toBeLessThanOrEqual(5);
    // Polling and retries from here on are answered locally.
    for (let i = 0; i < 20; i++) {
      const err = await apiFetch("/schema-version").catch((e) => e);
      expect(err).toBeInstanceOf(AuthRequiredError);
    }
    expect(calls.length).toBe(afterBurst);
  });

  test("a stored key that is refused is dropped, then recovery with a new one", async () => {
    setApiKey("cfx_lak_rotated", true);
    respond = refused;
    await apiFetch("/projects").catch(() => {});
    expect(getApiKey()).toBeNull();
    expect(getAuthPrompt()).toBe("rejected");
    expect(local.data.size).toBe(0);

    respond = () => Response.json([]);
    setApiKey("cfx_lak_new", false);
    await apiFetch("/projects");
    expect(calls.at(-1)!.headers.Authorization).toBe("Bearer cfx_lak_new");
    expect(getAuthPrompt()).toBeNull();
  });

  test("checkApiKey: 200 ok, 401 rejected, other or network error unreachable; stores nothing", async () => {
    respond = () => Response.json({});
    expect(await checkApiKey("cfx_lak_good")).toBe("ok");
    expect(calls[0].headers.Authorization).toBe("Bearer cfx_lak_good");
    respond = refused;
    expect(await checkApiKey("cfx_lak_bad")).toBe("rejected");
    respond = () => new Response("", { status: 502 });
    expect(await checkApiKey("x")).toBe("unreachable");
    respond = () => {
      throw new TypeError("network");
    };
    expect(await checkApiKey("x")).toBe("unreachable");
    expect(getApiKey()).toBeNull();
    expect(getAuthPrompt()).toBeNull();
  });
});

describe("helpers", () => {
  test("apiPathOf: only the same-origin path form", () => {
    expect(apiPathOf("/api/v1/documents/x/download")).toBe("/documents/x/download");
    expect(apiPathOf(" /api/v1/docs ")).toBe("/docs");
    expect(apiPathOf("/api/v10/x")).toBeNull();
    expect(apiPathOf("/app/search")).toBeNull();
    expect(apiPathOf("https://evil.example/api/v1/x")).toBeNull();
    expect(apiPathOf("//evil.example/api/v1/x")).toBeNull();
  });

  test("filenameFrom: plain and RFC 5987 forms", () => {
    expect(filenameFrom('attachment; filename="notes.md"')).toBe("notes.md");
    expect(filenameFrom("attachment; filename=notes.md")).toBe("notes.md");
    expect(filenameFrom("attachment; filename*=UTF-8''caf%C3%A9.md")).toBe("café.md");
    expect(filenameFrom("attachment")).toBeNull();
    expect(filenameFrom(null)).toBeNull();
  });
});
