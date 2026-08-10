/**
 * Shared Edge Function metadata (iter-26 Part 26B).
 *
 * Every Cerefox Edge Function answers `GET <ef>/version` with
 * `{ name, version }` so clients can detect server↔client drift
 * (see `_shared/compatibility/`). `cerefox-mcp` additionally exposes an
 * aggregator at `GET cerefox-mcp/version?peers=true` that probes every
 * peer EF + the Postgres schema version, so `cerefox doctor` learns the
 * whole server-side version picture in one round-trip.
 *
 * This module is Deno-runtime safe (no `node:` imports) so it can be
 * imported by the EFs as well as the Node/Bun local client. It is one of
 * the `_shared` subtrees bundled into the npm package's
 * `dist/server-assets/_shared/` (Part 26A) so EFs deploy with it intact.
 *
 * `EF_VERSION` is bumped by `scripts/cut_release.ts` when EF source
 * actually changed since the previous tag (guarded — a release that
 * doesn't touch `supabase/functions/` leaves it alone).
 */

export const EF_VERSION = "1.3.0-beta.3";

/**
 * The most recent version whose EF-side SOURCE actually changed (#127).
 * `EF_VERSION` bumps unconditionally at stable cuts (so stable deployments
 * never display a pre-release label), which means a version delta no longer
 * implies the deployed behaviour differs. This constant is bumped by
 * `cut_release.ts` ONLY when EF source changed since the last tag; doctor
 * uses it to stay silent on label-only drift.
 */
export const EF_LAST_CHANGED = "1.3.0-beta.3";

/**
 * The 8 peer EFs the cerefox-mcp aggregator probes (excludes cerefox-mcp
 * itself). Order is the probe order.
 */
export const PEER_EF_NAMES = [
  "cerefox-search",
  "cerefox-ingest",
  "cerefox-metadata",
  "cerefox-get-document",
  "cerefox-list-versions",
  "cerefox-get-audit-log",
  "cerefox-metadata-search",
  "cerefox-list-projects",
] as const;

export interface EfVersionPayload {
  name: string;
  version: string;
}

/** A peer probe result for the aggregator response. */
export interface PeerVersion {
  name: string;
  version: string;
}

export interface PeerError {
  name: string;
  error: string;
}

export interface AggregatedVersions {
  /** This EF (cerefox-mcp). */
  name: string;
  version: string;
  /** Deployed Postgres schema version, or null if the probe failed. */
  schema: string | null;
  /** Successfully-probed peer EFs. */
  efs: PeerVersion[];
  /** Peers that failed to respond (timeout, 404, network). */
  errors: PeerError[];
}

/** True when a request targets an EF's `/version` path via GET. */
export function isVersionRequest(req: Request): boolean {
  if (req.method !== "GET") return false;
  const { pathname } = new URL(req.url);
  return pathname.endsWith("/version");
}

/** True when the aggregator was requested (`?peers=true`). */
export function wantsPeers(req: Request): boolean {
  return new URL(req.url).searchParams.get("peers") === "true";
}

/** Single-EF version response. */
export function versionResponse(
  name: string,
  headers: Record<string, string>,
): Response {
  const payload: EfVersionPayload = { name, version: EF_VERSION };
  return new Response(JSON.stringify(payload), { status: 200, headers });
}

/**
 * Derive a peer EF's `/version` URL from the incoming cerefox-mcp request.
 * Replaces the trailing `/cerefox-mcp[/...]` path segment with
 * `/<peerName>/version`, preserving origin + the functions base path.
 */
export function peerVersionUrl(reqUrl: string, peerName: string): string {
  const url = new URL(reqUrl);
  // Strip everything from `/cerefox-mcp` onward, then append the peer path.
  const base = url.pathname.replace(/\/cerefox-mcp(\/.*)?$/, "");
  return `${url.origin}${base}/${peerName}/version`;
}
