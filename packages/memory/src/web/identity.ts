/**
 * Caller identity for `/api/v1` (iter-40, #226).
 *
 * `/api/v1` was built as the web app's private backend and hardcoded its own
 * identity: `author: "web-ui"` at every write, `access_path: "webapp"` at
 * every usage-log entry. Any other client of the API was therefore
 * unattributable, which pushed agent harnesses onto the MCP surface purely to
 * obtain an identity, even where the HTTP API served them better.
 *
 * This module is the single place that answers "who is calling, and over
 * what". Every route asks it; no route invents its own default.
 *
 * ## The contract
 *
 * - **Omitted, nothing changes.** No identity supplied means `web-ui` / `user`
 *   / `webapp`, byte-identical to the pre-#226 behaviour. The bundled web app
 *   sends nothing and is not modified.
 * - **Headers, then body.** Headers work uniformly on every method (a GET
 *   read cannot carry a body, and reads are half the point), so they are the
 *   primary mechanism. JSON bodies are also honoured, because a client that
 *   puts `author` in the body it is already sending has made an obvious and
 *   reasonable guess, and silently ignoring it would be the worst outcome.
 *   A header wins over a body field when both appear; that conflict is
 *   pathological, but a stated rule beats an emergent one.
 * - **`access_path` is derived, never accepted.** See below.
 *
 * ## Why `access_path` is not a parameter
 *
 * It is the one field in `cerefox_usage_log` still worth trusting, because
 * the server sets it per transport rather than taking the caller's word.
 * Accepting it would let a client lie about *where* as well as *who*, and
 * *where* is what the analytics dashboard attributes load with.
 *
 * So it is derived: **if the caller named itself at all, the path is `"api"`;
 * otherwise `"webapp"`.** That is an approximation, deliberately. It reads
 * "supplied an identity" as "is not the bundled web app", which holds today
 * because the web app supplies none.
 *
 * **The known edge**: if the web app ever passes a real `requestor`
 * (multi-user, SSO, anything), it will start labelling itself `"api"`. That
 * is a coupling, not a bug, and this comment is where a future reader finds
 * out about it before being surprised by a dashboard.
 *
 * ## `author_type` has consequences
 *
 * `author_type: "agent"` makes an ingest land in `pending_review` rather than
 * `approved` (`ingestion/pipeline.ts`), exactly as it does on the MCP path.
 * That equivalence is the feature: the same actor is recorded, and treated,
 * identically whichever transport it used. It is not a side effect to be
 * engineered away, and it is documented in the API guide so nobody discovers
 * it by finding their documents queued for review.
 */

import type { Context } from "hono";

/** Access paths this server can record. A subset of `AccessPath`. */
export type WebAccessPath = "webapp" | "api";

export const DEFAULT_WEB_AUTHOR = "web-ui";
export const DEFAULT_WEB_AUTHOR_TYPE = "user" as const;

export interface CallerIdentity {
  /** Recorded as `cerefox_audit_log.author` on writes. */
  author: string;
  /** Recorded as `cerefox_audit_log.author_type`. Drives ingest review status. */
  authorType: "user" | "agent";
  /** Recorded as `cerefox_usage_log.requestor` on reads and writes. */
  requestor: string;
  /** Derived, never accepted. See the module comment. */
  accessPath: WebAccessPath;
  /** True when the caller supplied any identity field at all. */
  named: boolean;
}

/** The identity the API has always recorded when the caller supplies none. */
export const WEB_UI_IDENTITY: CallerIdentity = {
  author: DEFAULT_WEB_AUTHOR,
  authorType: DEFAULT_WEB_AUTHOR_TYPE,
  requestor: DEFAULT_WEB_AUTHOR,
  accessPath: "webapp",
  named: false,
};

export type IdentityResult =
  | { ok: true; identity: CallerIdentity }
  | { ok: false; detail: string };

const HEADER = {
  author: "x-cerefox-author",
  authorType: "x-cerefox-author-type",
  requestor: "x-cerefox-requestor",
} as const;

/**
 * A supplied field must be a non-blank string. `undefined` means "not
 * supplied"; anything else supplied but unusable is an error rather than a
 * silent fallback, because silently recording `web-ui` for a caller that
 * tried to identify itself is precisely the failure this feature exists to
 * remove.
 */
function readField(
  c: Context,
  headerName: string,
  body: Record<string, unknown> | null | undefined,
  bodyKey: string,
): { ok: true; value: string | undefined } | { ok: false; detail: string } {
  const header = c.req.header(headerName);
  if (header !== undefined) {
    if (header.trim() === "") {
      return { ok: false, detail: `${headerName} must not be blank.` };
    }
    return { ok: true, value: header.trim() };
  }
  if (body && bodyKey in body) {
    const raw = body[bodyKey];
    if (raw === null || raw === undefined) return { ok: true, value: undefined };
    if (typeof raw !== "string") {
      return { ok: false, detail: `${bodyKey} must be a string.` };
    }
    if (raw.trim() === "") {
      return { ok: false, detail: `${bodyKey} must not be blank.` };
    }
    return { ok: true, value: raw.trim() };
  }
  return { ok: true, value: undefined };
}

/**
 * Resolve who is calling. Pass the parsed JSON body when the route has one;
 * omit it for GET/DELETE routes, which are header-only.
 *
 * Returns `ok: false` with a message suitable for a 400 when a supplied value
 * is unusable. `author_type` is validated here rather than at the database,
 * where the `cerefox_audit_log` CHECK would surface as a raw Postgres error.
 */
export function resolveCallerIdentity(
  c: Context,
  body?: Record<string, unknown> | null,
): IdentityResult {
  const author = readField(c, HEADER.author, body, "author");
  if (!author.ok) return author;
  const requestor = readField(c, HEADER.requestor, body, "requestor");
  if (!requestor.ok) return requestor;
  const authorType = readField(c, HEADER.authorType, body, "author_type");
  if (!authorType.ok) return authorType;

  if (
    authorType.value !== undefined &&
    authorType.value !== "user" &&
    authorType.value !== "agent"
  ) {
    return {
      ok: false,
      detail: `author_type must be "user" or "agent" (got ${JSON.stringify(authorType.value)}).`,
    };
  }

  const named =
    author.value !== undefined ||
    requestor.value !== undefined ||
    authorType.value !== undefined;

  if (!named) return { ok: true, identity: WEB_UI_IDENTITY };

  // author and requestor stand in for each other: they name the same actor,
  // and MCP splits them only because reads and writes log to different
  // tables. A caller that gives one has identified itself for both.
  const resolvedAuthor = author.value ?? requestor.value ?? DEFAULT_WEB_AUTHOR;
  const resolvedRequestor = requestor.value ?? author.value ?? DEFAULT_WEB_AUTHOR;

  return {
    ok: true,
    identity: {
      author: resolvedAuthor,
      authorType: (authorType.value as "user" | "agent") ?? DEFAULT_WEB_AUTHOR_TYPE,
      requestor: resolvedRequestor,
      accessPath: "api",
      named: true,
    },
  };
}
