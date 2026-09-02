/**
 * Authentication for the local HTTP surface (#229).
 *
 * Design: `docs/specs/api-auth-design.md`. The short version, because the
 * shape of this file only makes sense with it in mind:
 *
 * **Requests arriving on the loopback interface are allowed without a
 * credential; every other interface must present the key.**
 *
 * That matches the threat model rather than gesturing at it. The attacker this
 * defends against can reach the port but has no read access to the host
 * filesystem: another machine on the LAN after someone widened the bind, a
 * container on a shared Docker network, a malicious page in the browser. An
 * attacker who *does* have filesystem access can read the key file, the `.env`
 * and the Postgres credentials, so demanding a key from them buys nothing.
 * Loopback access and key-file access are the same trust boundary on a
 * single-user machine, which is what Cerefox is.
 *
 * The practical consequence, and the reason this design was chosen over
 * "key on every request": the browser never holds a credential. The SPA is
 * served as a static file (`server.ts`), so any key embedded in it could be
 * read by anything that can `GET /app/` — precisely the attacker above. A key
 * in an unauthenticated page is not a secret. Here the browser works because
 * it is on loopback, and there is nothing to leak.
 *
 * ## `X-Forwarded-For` is never consulted
 *
 * The address comes from the transport (`getConnInfo` reads
 * `socket.remoteAddress`), never from a header. `X-Forwarded-For` and friends
 * are supplied by the caller, so honouring them would let any client claim any
 * origin — strictly worse than having no gate at all. `auth.test.ts` asserts a
 * non-loopback request carrying `X-Forwarded-For: 127.0.0.1` is still refused,
 * and says in its own comment that it exists to fail a future "add proxy
 * support" change that misses this.
 *
 * The topology that legitimately needs proxying is served by
 * `CEREFOX_API_REQUIRE_KEY=1`, which demands the key from *every* caller
 * including loopback. A same-host reverse proxy makes every request look local,
 * so anyone fronting Cerefox that way must set it.
 */

import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";

import { checkAccessToken, parseAccessTokens } from "../../../../_shared/ef-auth/index.ts";

/** Prefix for a locally minted API key. Distinct from `cfx_pat_` (the Cerefox
 *  access token the Edge Functions take) so the two are never confused in a
 *  log line or a paste. */
export const API_KEY_PREFIX = "cfx_lak_";

/**
 * Loopback addresses, as Node reports them on `socket.remoteAddress`.
 *
 * `::ffff:127.0.0.1` is the IPv4-mapped IPv6 form and is what a dual-stack
 * listener actually sees for an IPv4 localhost connection — omitting it would
 * make the gate reject the browser on a default install, which is the most
 * expensive possible bug here. `::1` is IPv6 localhost.
 *
 * Deliberately an exact-match set, not a prefix or regex test: `127.0.0.1` as
 * a *prefix* would also match `127.0.0.1.evil.com` in some string checks, and
 * the whole 127/8 range is loopback but only ever presents as these forms in
 * practice. An unrecognised address fails closed, which is the right default
 * for an address we do not understand.
 */
const LOOPBACK_ADDRESSES = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
]);

/** Is this the address of a connection that originated on this machine? */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false; // unknown transport → treat as remote (fail closed)
  return LOOPBACK_ADDRESSES.has(address.trim().toLowerCase());
}

export type AuthDecision =
  | { allow: true; reason: "loopback" | "valid_key" | "disabled" }
  | { allow: false; reason: "no_key" | "bad_key" | "not_configured"; message: string };

export interface AuthInputs {
  /** Transport-level remote address. NEVER a header value. */
  remoteAddress: string | undefined;
  /** The request's `Authorization` header, if any. */
  authorization: string | null;
  /** The configured key(s). Empty/absent means the gate is not configured. */
  configuredKeys: string;
  /** `CEREFOX_API_REQUIRE_KEY=1` — demand the key even on loopback. */
  requireKeyEverywhere: boolean;
}

/**
 * The whole decision, as a pure function so it can be tested exhaustively
 * without a server, a socket, or a port.
 *
 * Order matters and is deliberate:
 *
 * 1. **Not configured → allow.** A server with no key minted behaves exactly
 *    as it did before this feature. This is what makes the change safe to ship
 *    to existing installs: nobody's setup breaks on upgrade. It is *not* a
 *    silent downgrade, because `cerefox web` warns at boot when it binds a
 *    non-loopback host with no key configured (see `server.ts`).
 * 2. **Loopback → allow**, unless the operator asked for the key everywhere.
 * 3. **Otherwise → require a valid key.**
 */
export function decideAuth(input: AuthInputs): AuthDecision {
  const keys = input.configuredKeys.trim();
  if (!keys) return { allow: true, reason: "disabled" };

  const local = isLoopbackAddress(input.remoteAddress);
  if (local && !input.requireKeyEverywhere) {
    return { allow: true, reason: "loopback" };
  }

  // Reuse the Edge Functions' checker rather than writing a second one: it
  // compares against every accepted token WITHOUT short-circuiting, so timing
  // does not leak which or how many matched, and it fails closed on an empty
  // set. One audited comparison beats two plausible ones.
  const result = checkAccessToken(input.authorization, {
    tokens: parseAccessTokens(keys),
  });
  if (result.ok) return { allow: true, reason: "valid_key" };

  if (result.reason === "no_token") {
    return {
      allow: false,
      reason: "no_key",
      message: local
        ? "This server requires an API key on every request (CEREFOX_API_REQUIRE_KEY is set). " +
          "Send it as `Authorization: Bearer <key>`."
        : "This request did not come from the local machine, so it needs the server's API key " +
          "as `Authorization: Bearer <key>`. Print it with `cerefox api-key show` " +
          "(or `cerefox-local api-key` for a container install).",
    };
  }
  return {
    allow: false,
    reason: "bad_key",
    message: "The API key presented is not valid for this server.",
  };
}

/**
 * Hono middleware enforcing {@link decideAuth}.
 *
 * Mounted on `/api/v1/*` AND `/rest/v1/*`. The second one is not optional:
 * `registerPostgrestProxy` puts a PostgREST passthrough on the same port and
 * forwards caller headers verbatim, and it is live on Cerefox Local
 * specifically — the deployment most likely to run unattended. Gating only
 * `/api/v1` would move the hole rather than close it.
 */
export function apiAuth(): MiddlewareHandler {
  return async (c, next) => {
    const decision = decideAuth({
      remoteAddress: remoteAddressOf(c),
      authorization: c.req.header("Authorization") ?? null,
      configuredKeys: process.env.CEREFOX_API_KEY ?? "",
      requireKeyEverywhere: (process.env.CEREFOX_API_REQUIRE_KEY ?? "") === "1",
    });

    if (decision.allow) return next();

    // 401 with a challenge, matching the Edge Functions' surface. The body
    // uses `detail` because that is the field every other /api/v1 error uses
    // and the one the frontend's ApiError reads.
    return c.json({ detail: decision.message }, 401, {
      "WWW-Authenticate": 'Bearer realm="cerefox"',
    });
  };
}

/**
 * Transport-level remote address, or undefined when it cannot be determined.
 *
 * Wrapped in a try/catch because `getConnInfo` reaches into runtime-specific
 * internals (`c.env.incoming.socket`), which are absent under a bare
 * `app.request()` in tests and could change shape across adapters. Undefined
 * is treated as *remote* by `isLoopbackAddress`, so a failure here fails
 * closed rather than opening the gate.
 */
function remoteAddressOf(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}
