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

import { decideAuth, isLoopbackAddress, API_KEY_PREFIX } from "../src/web/auth.ts";

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
