/**
 * The `/api/v1` + `/rest/v1` auth gate (#229).
 *
 * `decideAuth` is a pure function precisely so the decision table can be
 * enumerated here without a socket, a port, or a running server. The
 * middleware around it is a thin wrapper; the decisions are the security
 * boundary, so they are what gets exhausted.
 *
 * Design: `docs/specs/api-auth-design.md`.
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import {
  API_KEY_PREFIX,
  apiAuth,
  browserGuard,
  containerGateWarning,
  decideAuth,
  hostnameOf,
  isContainerised,
  isLoopbackAddress,
  restGatewayKeys,
} from "../src/web/auth.ts";

const KEY = `${API_KEY_PREFIX}testkeytestkeytestkeytestkey`;
const OTHER = `${API_KEY_PREFIX}differentdifferentdifferent`;

/** A request from somewhere else on the network. */
const REMOTE = "192.168.1.50";

function decide(over: Partial<Parameters<typeof decideAuth>[0]> = {}) {
  return decideAuth({
    remoteAddress: REMOTE,
    authorization: null,
    configuredKeys: KEY,
    requireKeyEverywhere: false,
    ...over,
  });
}

describe("isLoopbackAddress", () => {
  test("accepts every form Node actually reports for localhost", () => {
    // ::ffff:127.0.0.1 is the IPv4-mapped IPv6 form a dual-stack listener sees
    // for an IPv4 localhost connection. Omitting it would reject the browser
    // on a default install — the most expensive possible bug in this file.
    for (const a of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "::FFFF:127.0.0.1"]) {
      expect(isLoopbackAddress(a)).toBe(true);
    }
  });

  test("rejects LAN, public and Docker-bridge addresses", () => {
    for (const a of ["192.168.1.50", "10.0.0.7", "172.17.0.2", "8.8.8.8", "::ffff:10.0.0.7"]) {
      expect(isLoopbackAddress(a)).toBe(false);
    }
  });

  test("rejects addresses that merely LOOK like loopback", () => {
    // Exact-match set, not a prefix test: a substring/prefix check would let
    // these through, and each is a plausible attacker-chosen hostname.
    for (const a of ["127.0.0.1.evil.com", "127.0.0.10", "0127.0.0.1", "1127.0.0.1"]) {
      expect(isLoopbackAddress(a)).toBe(false);
    }
  });

  test("an unknown address fails closed", () => {
    // getConnInfo can fail on an adapter that does not expose the socket.
    // Unknown must mean "remote", never "local".
    expect(isLoopbackAddress(undefined)).toBe(false);
    expect(isLoopbackAddress("")).toBe(false);
  });
});

describe("decideAuth — the decision table", () => {
  test("no key configured: every caller is allowed (upgrades never break)", () => {
    // The compatibility promise. An install that has not minted a key behaves
    // exactly as it did before #229, which is what makes this safe to ship.
    expect(decide({ configuredKeys: "" }).allow).toBe(true);
    expect(decide({ configuredKeys: "   " }).allow).toBe(true);
    expect(decide({ configuredKeys: "", remoteAddress: REMOTE }).reason).toBe("disabled");
  });

  test("loopback is allowed with no credential", () => {
    const d = decide({ remoteAddress: "127.0.0.1" });
    expect(d.allow).toBe(true);
    if (d.allow) expect(d.reason).toBe("loopback");
  });

  test("remote without a key is refused, and the message says where to get one", () => {
    const d = decide();
    expect(d.allow).toBe(false);
    if (!d.allow) {
      expect(d.reason).toBe("no_key");
      expect(d.message).toContain("api-key");
    }
  });

  test("remote with the right key is allowed", () => {
    const d = decide({ authorization: `Bearer ${KEY}` });
    expect(d.allow).toBe(true);
    if (d.allow) expect(d.reason).toBe("valid_key");
  });

  test("remote with a wrong key is refused", () => {
    const d = decide({ authorization: `Bearer ${OTHER}` });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toBe("bad_key");
  });

  test("a key in the wrong scheme is not a key", () => {
    for (const header of [KEY, `Basic ${KEY}`, `bearer${KEY}`, "Bearer "]) {
      expect(decide({ authorization: header }).allow).toBe(false);
    }
  });

  test("several accepted keys work, so rotation can overlap", () => {
    const d = decide({
      configuredKeys: `${OTHER}, ${KEY}`,
      authorization: `Bearer ${KEY}`,
    });
    expect(d.allow).toBe(true);
  });

  test("a blank credential cannot match a trailing comma in the key list", () => {
    // parseAccessTokens drops empties for exactly this reason; pinned here
    // because the consequence is an auth bypass rather than a parsing quirk.
    expect(decide({ configuredKeys: `${KEY},`, authorization: "Bearer " }).allow).toBe(false);
  });
});

describe("CEREFOX_API_REQUIRE_KEY", () => {
  test("makes loopback present the key too", () => {
    const d = decide({ remoteAddress: "127.0.0.1", requireKeyEverywhere: true });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.message).toContain("CEREFOX_API_REQUIRE_KEY");
  });

  test("loopback with the key still works when it is set", () => {
    expect(
      decide({
        remoteAddress: "127.0.0.1",
        requireKeyEverywhere: true,
        authorization: `Bearer ${KEY}`,
      }).allow,
    ).toBe(true);
  });

  test("does not resurrect the gate when no key is configured", () => {
    // Demanding a key that does not exist would lock the owner out of their
    // own server with no way back in.
    expect(
      decide({ configuredKeys: "", requireKeyEverywhere: true, remoteAddress: "127.0.0.1" }).allow,
    ).toBe(true);
  });
});

describe("forwarding headers are never trusted", () => {
  /**
   * THIS TEST EXISTS TO FAIL A PLAUSIBLE FUTURE CHANGE. Do not delete it as
   * redundant.
   *
   * Someone adding reverse-proxy support will reach for `X-Forwarded-For`,
   * because that is what it is for. But the header is supplied by the CALLER:
   * honouring it would let any remote client claim `127.0.0.1` and walk
   * straight through the gate — strictly worse than having no gate at all.
   *
   * `decideAuth` takes the address as an explicit argument, sourced only from
   * `getConnInfo` (which reads `socket.remoteAddress`), so a header cannot
   * reach this decision by construction. These cases assert the property that
   * construction is meant to guarantee.
   *
   * The legitimate proxy topology is served by CEREFOX_API_REQUIRE_KEY=1.
   */
  test("a remote request claiming loopback via X-Forwarded-For is still refused", () => {
    // The header cannot even be passed in — that IS the guarantee. The remote
    // address is what decides, and it is 192.168.1.50.
    const d = decideAuth({
      remoteAddress: REMOTE,
      authorization: null,
      configuredKeys: KEY,
      requireKeyEverywhere: false,
    });
    expect(d.allow).toBe(false);
  });

  test("the signature offers no way to supply an address from a header", () => {
    // A future change that adds one has to edit this test, which is the
    // moment to reconsider. Named explicitly so the tripwire is legible.
    const accepted = ["remoteAddress", "authorization", "configuredKeys", "requireKeyEverywhere"];
    for (const forbidden of ["forwardedFor", "xForwardedFor", "trustProxy", "clientIp"]) {
      expect(accepted).not.toContain(forbidden);
    }
  });
});

describe("containerGateWarning — the v1.12.0 container bug", () => {
  /**
   * v1.12.0 injected an API key into Cerefox Local unconditionally. Docker's
   * port publishing NATs the source address, so every request from the host
   * arrived looking like it came from the bridge gateway, the loopback
   * exemption never matched, and EVERY caller got a 401 — the web UI included.
   *
   * The deeper lesson, and why the fix is "all-or-nothing in a container"
   * rather than a tweak: inside a bridge-networked container the server cannot
   * distinguish a host-loopback caller from a LAN one, because Docker NAT's
   * both to the same address. The exemption is not implementable there.
   *
   * These tests pin the boot-time detection of that configuration. They pass
   * `isContainerised` implicitly through the real filesystem, so the container
   * branch only asserts the non-container cases here; the real container
   * behavior is verified by `docker/local/smoke-auth.sh` against a built
   * image, which is the check that was missing.
   */
  test("says nothing when no key is configured", () => {
    expect(containerGateWarning({} as NodeJS.ProcessEnv)).toBeNull();
  });

  test("says nothing when require-mode is on (the sound container config)", () => {
    expect(
      containerGateWarning({
        CEREFOX_API_KEY: KEY,
        CEREFOX_API_REQUIRE_KEY: "1",
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  test("says nothing outside a container, where the exemption works fine", () => {
    // A key without require-mode is the NORMAL, correct config for a native
    // `cerefox web`; warning about it there would be noise.
    if (isContainerised()) return; // not applicable when the suite runs in one
    expect(
      containerGateWarning({ CEREFOX_API_KEY: KEY } as NodeJS.ProcessEnv),
    ).toBeNull();
  });
});

describe("restGatewayKeys — the container's own data calls (v1.19.6)", () => {
  /**
   * In a gated container the server's data client reaches PostgREST through
   * its own /rest/v1 proxy, signing with the service-role JWT. Before v1.19.6
   * the gate accepted only the API key there, so every data route of a gated
   * Cerefox Local failed while /api/v1/version stayed green.
   */
  const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig";
  const LOCAL = {
    CEREFOX_API_KEY: KEY,
    CEREFOX_POSTGREST_UPSTREAM: "http://127.0.0.1:3000",
    CEREFOX_SUPABASE_KEY: JWT,
  } as NodeJS.ProcessEnv;

  const gate = (env: NodeJS.ProcessEnv, authorization: string | null) =>
    decide({ configuredKeys: restGatewayKeys(env), requireKeyEverywhere: true, authorization });

  test("a gated container accepts its own service JWT on /rest/v1", () => {
    expect(gate(LOCAL, `Bearer ${JWT}`)).toMatchObject({ allow: true, reason: "valid_key" });
  });

  test("the API key is still accepted, and anything else is still refused", () => {
    expect(gate(LOCAL, `Bearer ${KEY}`).allow).toBe(true);
    expect(gate(LOCAL, `Bearer ${OTHER}`)).toMatchObject({ allow: false, reason: "bad_key" });
    expect(gate(LOCAL, null)).toMatchObject({ allow: false, reason: "no_key" });
  });

  test("a gate that is off stays off: no key configured adds nothing", () => {
    const env = { ...LOCAL, CEREFOX_API_KEY: "" } as NodeJS.ProcessEnv;
    expect(restGatewayKeys(env)).toBe("");
    expect(decide({ configuredKeys: restGatewayKeys(env) })).toMatchObject({ allow: true, reason: "disabled" });
  });

  test("outside Cerefox Local (no proxy upstream) the JWT is not a credential", () => {
    const env = { ...LOCAL, CEREFOX_POSTGREST_UPSTREAM: "" } as NodeJS.ProcessEnv;
    expect(restGatewayKeys(env)).toBe(KEY);
    expect(gate(env, `Bearer ${JWT}`).allow).toBe(false);
  });
});

describe("browserGuard — a web page driving a keyless server (v1.20.0)", () => {
  const guard = (over: Partial<Parameters<typeof browserGuard>[0]> = {}) =>
    browserGuard({ host: "localhost:8000", origin: null, secFetchSite: null, allowedHosts: "", ...over });

  test("hostnameOf strips the port, keeps IPv6 brackets", () => {
    expect(hostnameOf("LocalHost:8000")).toBe("localhost");
    expect(hostnameOf("[::1]:8000")).toBe("[::1]");
    expect(hostnameOf("example.com")).toBe("example.com");
  });

  test("agents and curl (no Origin, no Sec-Fetch-Site) on a local name pass", () => {
    for (const host of ["localhost:8000", "127.0.0.1:8000", "[::1]:8000", "192.168.1.20:8000", "localhost"]) {
      expect(guard({ host }).allow).toBe(true);
    }
  });

  test("the SPA's own requests pass: same origin, or a dev server on this machine", () => {
    expect(guard({ origin: "http://localhost:8000", secFetchSite: "same-origin" }).allow).toBe(true);
    expect(guard({ host: "192.168.1.20:8000", origin: "http://192.168.1.20:8000" }).allow).toBe(true);
    // Vite on :5173 proxies /api/v1 with changeOrigin, so Host is the server's.
    expect(guard({ origin: "http://localhost:5173", secFetchSite: "same-site" }).allow).toBe(true);
    // A typed URL or a bookmark.
    expect(guard({ secFetchSite: "none" }).allow).toBe(true);
  });

  test("a cross-site request is refused, with or without an Origin", () => {
    expect(guard({ secFetchSite: "cross-site" }).allow).toBe(false);
    expect(guard({ origin: "https://evil.example", secFetchSite: "cross-site" }).allow).toBe(false);
    // An older browser that sends Origin but no fetch metadata.
    expect(guard({ origin: "https://evil.example" }).allow).toBe(false);
    // A sandboxed frame or a file:// page.
    expect(guard({ origin: "null" }).allow).toBe(false);
  });

  test("another site on the same LAN host is refused", () => {
    expect(guard({ host: "192.168.1.20:8000", origin: "http://192.168.1.20:5000" }).allow).toBe(false);
  });

  /**
   * DNS rebinding: the page re-points its own name at 127.0.0.1 and calls the
   * server same-origin, so Origin and Sec-Fetch-Site both look clean. Only the
   * Host header gives it away, which is why that rule must not be relaxed to
   * "any name that resolves here".
   */
  test("DNS rebinding: a same-origin request under a foreign name is refused", () => {
    const d = guard({ host: "rebind.evil.example:8000", origin: "http://rebind.evil.example:8000", secFetchSite: "same-origin" });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.message).toContain("CEREFOX_ALLOWED_HOSTS");
    // Names that merely contain a local one are foreign too.
    for (const host of ["localhost.evil.example", "127.0.0.1.nip.io:8000", "evil.localhost:8000"]) {
      expect(guard({ host }).allow).toBe(false);
    }
  });

  test("CEREFOX_ALLOWED_HOSTS admits a name on purpose; * admits any", () => {
    expect(guard({ host: "nas.local:8000", allowedHosts: "cerefox, NAS.local" }).allow).toBe(true);
    expect(guard({ host: "other.local:8000", allowedHosts: "nas.local" }).allow).toBe(false);
    expect(guard({ host: "anything.example", allowedHosts: "*" }).allow).toBe(true);
    // It does not relax the Origin rule.
    expect(guard({ host: "nas.local:8000", allowedHosts: "*", origin: "https://evil.example" }).allow).toBe(false);
  });
});

describe("apiAuth applies browserGuard only to requests admitted without a key", () => {
  function app(keys: string) {
    const a = new Hono();
    a.use("/api/v1/*", apiAuth(() => keys));
    a.get("/api/v1/projects", (c) => c.json([]));
    return a;
  }

  test("gate off: a cross-site request gets a 403 with no key challenge", async () => {
    const res = await app("").request("http://localhost:8000/api/v1/projects", {
      headers: { Host: "localhost:8000", "Sec-Fetch-Site": "cross-site" },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("WWW-Authenticate")).toBeNull();
    expect((await res.json()).detail).toContain("cross-site");
  });

  test("gate off: a rebinding Host gets a 403; an IP or localhost does not", async () => {
    const call = (host: string) => app("").request(`http://${host}/api/v1/projects`, { headers: { Host: host } });
    expect((await call("rebind.evil.example:8000")).status).toBe(403);
    expect((await call("127.0.0.1:8000")).status).toBe(200);
    expect((await call("localhost:8000")).status).toBe(200);
  });

  test("gate on: a request with the key is not subject to the browser rules", async () => {
    const res = await app(KEY).request("http://nas.local:8000/api/v1/projects", {
      headers: { Host: "nas.local:8000", Authorization: `Bearer ${KEY}`, Origin: "http://nas.local:8000" },
    });
    expect(res.status).toBe(200);
  });

  test("gate on, no key: still a 401 challenge, so the SPA asks for the key", async () => {
    const res = await app(KEY).request("http://nas.local:8000/api/v1/projects", {
      headers: { Host: "nas.local:8000" },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain('realm="cerefox"');
  });
});

describe("browserGuard can only refuse, never admit", () => {
  /**
   * The browser checks run AFTER decideAuth has admitted a request and can
   * only turn that into a 403. Whatever headers a caller sends, a request the
   * gate refuses stays refused with the 401 challenge: no header combination
   * (a friendly Origin, Sec-Fetch-Site, an allowlisted Host) opens anything.
   */
  test("a gated server refuses a keyless or wrong-key caller under every header combination", async () => {
    const a = new Hono();
    a.use("/api/v1/*", apiAuth(() => KEY));
    a.get("/api/v1/projects", (c) => c.json([]));
    const prev = process.env.CEREFOX_ALLOWED_HOSTS;
    process.env.CEREFOX_ALLOWED_HOSTS = "*";
    try {
      for (const host of ["localhost:8000", "127.0.0.1:8000", "nas.local:8000"]) {
        for (const origin of [null, `http://${host}`, "http://localhost:5173"]) {
          for (const site of [null, "same-origin", "none"]) {
            for (const auth of [null, `Bearer ${OTHER}`, "Basic abc"]) {
              const headers: Record<string, string> = { Host: host };
              if (origin) headers.Origin = origin;
              if (site) headers["Sec-Fetch-Site"] = site;
              if (auth) headers.Authorization = auth;
              const res = await a.request(`http://${host}/api/v1/projects`, { headers });
              expect(res.status).toBe(401);
            }
          }
        }
      }
    } finally {
      if (prev === undefined) delete process.env.CEREFOX_ALLOWED_HOSTS;
      else process.env.CEREFOX_ALLOWED_HOSTS = prev;
    }
  });
});
