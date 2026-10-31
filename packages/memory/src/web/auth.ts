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

import { existsSync } from "node:fs";

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

/**
 * Are we running inside a container? (`/.dockerenv` is Docker's own marker.)
 *
 * This matters because of the v1.12.0 bug: Docker's port publishing NATs the
 * source address, so a request from the host to a published port arrives here
 * appearing to come from the bridge gateway rather than 127.0.0.1. The
 * loopback exemption therefore never matches, and — worse — a bridge-networked
 * container CANNOT distinguish a host-loopback caller from a LAN one, because
 * both are NAT'd to the same address. The exemption is not implementable here,
 * so a key without require-mode is a misconfiguration rather than a
 * preference. `warnIfLoopbackExemptionIsUseless()` says so at boot.
 */
export function isContainerised(): boolean {
  try {
    return existsSync("/.dockerenv");
  } catch {
    return false;
  }
}

/**
 * Boot-time check for the one configuration that cannot work.
 *
 * Returns the warning text, or null when the configuration is sound — a string
 * rather than a `console.warn` so it can be asserted in a test. The v1.12.0
 * incident is the reason this is a function with a test and not a comment.
 */
export function containerGateWarning(env: NodeJS.ProcessEnv = process.env): string | null {
  const hasKey = (env.CEREFOX_API_KEY ?? "").trim() !== "";
  const requireAll = (env.CEREFOX_API_REQUIRE_KEY ?? "") === "1";
  if (!hasKey || requireAll || !isContainerised()) return null;
  return (
    "\n⚠  CEREFOX_API_KEY is set inside a container without CEREFOX_API_REQUIRE_KEY=1.\n" +
    "   Docker rewrites the source address of every published-port request, so the\n" +
    "   loopback exemption cannot match and EVERY caller will get a 401 — including\n" +
    "   the web UI. In a container the gate must be all-or-nothing:\n" +
    "     • publishing on 127.0.0.1 → leave CEREFOX_API_KEY unset (the bind is the boundary)\n" +
    "     • publishing wider        → also set CEREFOX_API_REQUIRE_KEY=1\n"
  );
}

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
 * 2. **A valid key → allow**, from anywhere (reason `valid_key`).
 * 3. **Loopback → allow**, unless the operator asked for the key everywhere.
 *    A wrong key from loopback is admitted here, as it always was.
 * 4. **Otherwise → refuse.**
 */
export function decideAuth(input: AuthInputs): AuthDecision {
  const keys = input.configuredKeys.trim();
  if (!keys) return { allow: true, reason: "disabled" };

  // Reuse the Edge Functions' checker rather than writing a second one: it
  // compares against every accepted token WITHOUT short-circuiting, so timing
  // does not leak which or how many matched, and it fails closed on an empty
  // set. One audited comparison beats two plausible ones.
  //
  // The key is checked before the loopback exemption so that a caller who
  // presents it is admitted as `valid_key` from anywhere: `apiAuth` skips the
  // browser checks for that reason only, as the docs promise.
  const result = checkAccessToken(input.authorization, {
    tokens: parseAccessTokens(keys),
  });
  if (result.ok) return { allow: true, reason: "valid_key" };

  const local = isLoopbackAddress(input.remoteAddress);
  if (local && !input.requireKeyEverywhere) {
    return { allow: true, reason: "loopback" };
  }

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

export interface BrowserGuardInputs {
  /** The request's `Host` header. */
  host: string | null;
  /** The request's `Origin` header. */
  origin: string | null;
  /** The request's `Sec-Fetch-Site` header. */
  secFetchSite: string | null;
  /** `CEREFOX_ALLOWED_HOSTS`: extra host names, comma-separated; `*` for any. */
  allowedHosts: string;
}

/** Origins served from this machine. */
const LOCAL_HOST_NAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Host names a page cannot point at this server through its own DNS: the
 * local ones, plus `host.docker.internal`, the name Docker gives the host
 * inside a container (`.internal` is reserved for private use, so no public
 * DNS answers for it), which the container recipes in the guide use.
 */
const SAFE_HOST_NAMES = new Set([...LOCAL_HOST_NAMES, "host.docker.internal"]);

/** `example.com:8000` → `example.com`; `[::1]:8000` → `[::1]`. Lowercased. */
export function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end === -1 ? h : h.slice(0, end + 1);
  }
  const colon = h.lastIndexOf(":");
  return colon === -1 ? h : h.slice(0, colon);
}

function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || /^\[[0-9a-f:.]+\]$/.test(hostname);
}

/**
 * The browser-facing half of the gate, for requests admitted WITHOUT a key
 * (`api-auth-design.md`, "ride-along hardening"; built in v1.20.0).
 *
 * The loopback exemption trusts the machine, and a browser on the machine runs
 * pages from anywhere. Two ways such a page can use a keyless server:
 *
 * - **Cross-site requests.** The server sends no CORS headers, so a foreign
 *   page cannot read an answer, but a form post or a `no-cors` fetch still
 *   reaches the server and can change or delete data. Refused when the
 *   browser says so: `Sec-Fetch-Site: cross-site`, or an `Origin` that is
 *   neither this server nor a page served from this machine (the Vite dev
 *   server on another localhost port is one).
 * - **DNS rebinding.** A page on `evil.example` re-points its own name at
 *   127.0.0.1 and then calls the server *same-origin*, reading the whole
 *   store. Its requests carry the attacker's name in `Host`, so a keyless
 *   request must name the server by an IP address or `localhost`, which no
 *   outside DNS can claim. A name reached on purpose (a `.local` name, a
 *   Compose service name) goes in `CEREFOX_ALLOWED_HOSTS`.
 *
 * Requests that present the key skip all of this: a foreign page cannot send
 * an `Authorization` header cross-origin without a CORS preflight this server
 * never answers, and a rebinding page runs on another origin, so it cannot
 * read the key the SPA keeps in its own origin's storage.
 *
 * Clients that are not browsers (agents, curl, the CLI) send neither `Origin`
 * nor `Sec-Fetch-Site`, so only the `Host` rule can touch them.
 */
export function browserGuard(input: BrowserGuardInputs): { allow: true } | { allow: false; message: string } {
  if ((input.secFetchSite ?? "").trim().toLowerCase() === "cross-site") {
    return { allow: false, message: "Refused a cross-site request: a page from another site cannot use this server." };
  }

  const host = (input.host ?? "").trim().toLowerCase();
  if (host) {
    const name = hostnameOf(host);
    const extra = input.allowedHosts
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    if (!SAFE_HOST_NAMES.has(name) && !isIpLiteral(name) && !extra.includes("*") && !extra.includes(name)) {
      return {
        allow: false,
        message:
          `Refused: this server was reached as "${name}". Without an API key it answers only to ` +
          "an IP address or localhost, so a web page cannot re-point its own name at it. If you " +
          "use this name on purpose, add it to CEREFOX_ALLOWED_HOSTS, or turn the API key on.",
      };
    }
  }

  const origin = input.origin?.trim();
  if (origin) {
    let originHost: string | null = null;
    try {
      // `Origin: null` (a sandboxed frame, a file:// page) fails to parse.
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      originHost = null;
    }
    const sameAsHost = originHost !== null && originHost === host;
    const fromThisMachine = originHost !== null && LOCAL_HOST_NAMES.has(hostnameOf(originHost));
    if (!sameAsHost && !fromThisMachine) {
      return { allow: false, message: `Refused a request from the page at ${origin}: a page from another site cannot use this server.` };
    }
  }

  return { allow: true };
}

/**
 * The credentials `/rest/v1/*` accepts: the API key(s), plus, on Cerefox Local,
 * the container's own service-role JWT.
 *
 * The server's data client (and the CLI run inside the container) reaches
 * PostgREST through this same port, signing with `CEREFOX_SUPABASE_KEY`. In a
 * gated container every caller counts as remote, so before v1.19.6 the gate
 * refused the server's own calls and every data route failed with a 500
 * while `/api/v1/version` stayed green. This does add a second credential to
 * the gate, on `/rest/v1` only. It is contained like the API key: minted inside
 * the container, kept in its runtime env, never published or written to the
 * host, and its holder gets no more than the API key's holder already reaches.
 * It is accepted only where the proxy exists (`CEREFOX_POSTGREST_UPSTREAM`) and
 * only when a key is configured, so a gate that is off stays off.
 */
export function restGatewayKeys(env: NodeJS.ProcessEnv = process.env): string {
  const keys = env.CEREFOX_API_KEY ?? "";
  if (!keys.trim() || !(env.CEREFOX_POSTGREST_UPSTREAM ?? "").trim()) return keys;
  const internal = (env.CEREFOX_SUPABASE_KEY ?? "").trim();
  return internal ? `${keys},${internal}` : keys;
}

/**
 * Hono middleware enforcing {@link decideAuth}.
 *
 * Mounted on `/api/v1/*` AND `/rest/v1/*`. The second one is not optional:
 * `registerPostgrestProxy` puts a PostgREST passthrough on the same port and
 * forwards caller headers verbatim, and it is live on Cerefox Local
 * specifically — the deployment most likely to run unattended. Gating only
 * `/api/v1` would move the hole rather than close it. The `/rest/v1` mount
 * passes {@link restGatewayKeys}.
 */
export function apiAuth(keys: () => string = () => process.env.CEREFOX_API_KEY ?? ""): MiddlewareHandler {
  return async (c, next) => {
    const decision = decideAuth({
      remoteAddress: remoteAddressOf(c),
      authorization: c.req.header("Authorization") ?? null,
      configuredKeys: keys(),
      requireKeyEverywhere: (process.env.CEREFOX_API_REQUIRE_KEY ?? "") === "1",
    });

    if (decision.allow) {
      // A request let in without a key (loopback, or a gate that is off) is
      // trusted for where it came from, and a browser on this machine is also
      // "from here" when a web page drives it. See `browserGuard`.
      if (decision.reason !== "valid_key") {
        const guard = browserGuard({
          host: c.req.header("Host") ?? null,
          origin: c.req.header("Origin") ?? null,
          secFetchSite: c.req.header("Sec-Fetch-Site") ?? null,
          allowedHosts: process.env.CEREFOX_ALLOWED_HOSTS ?? "",
        });
        // 403, not 401: no key would change the answer for a page that is
        // not ours, and a 401 challenge would make our own SPA ask for one.
        if (!guard.allow) return c.json({ detail: guard.message }, 403);
      }
      return next();
    }

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
