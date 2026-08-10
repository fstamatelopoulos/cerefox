/**
 * Client ↔ server version compatibility matrix (iter-26 Part 26C).
 *
 * The client (CLI / web / MCP local) ships with a hand-maintained
 * minimum-required-server matrix. `checkServerCompatibility()` probes the
 * deployed Postgres schema version + the Edge Function versions (via the
 * cerefox-mcp `/version?peers=true` aggregator) and classifies each against
 * the matrix so `cerefox doctor`, `cerefox web` boot, and the web
 * `SchemaVersionBanner` can surface drift consistently.
 *
 * **Bump policy** (see CONTRIBUTING.md "Compatibility matrix"): raise
 * `minSchema` / `minEdgeFunctions` ONLY when a client release genuinely
 * requires the newer server surface. Client patch releases never raise a
 * minimum. Each bump is intentional and reviewed at PR time.
 *
 * Runtime-agnostic (no `node:` imports) so it can be imported by the
 * Node/Bun client and, if ever needed, a Deno surface.
 */

export const COMPATIBILITY = {
  /**
   * Minimum deployed Postgres schema version this client requires.
   *
   * Raised to 0.10.3 for v1.1.0, then to **0.10.5 for v1.2.0** (#183).
   *
   * From v1.1.0 the client STOPS sending retention and retrieval parameters and
   * delegates their resolution to `cerefox_config` in the RPCs. Against an older
   * server those keys are not read, so the RPC falls back to its own built-in
   * defaults — and an operator who had configured "keep every version" silently
   * gets pruning at 48 hours on the next save. That is not graceful degradation,
   * it is quiet data loss, so it warrants an error rather than the usual
   * "a newer server is available" nudge.
   *
   * 0.10.3 was chosen as the floor that guaranteed exactly that. It did not.
   * `cerefox_ingest_document` kept concrete defaults (48 / TRUE) and passed them
   * to `cerefox_snapshot_version`, so the config was never consulted on the one
   * path that writes: the "keep every version" operator got pruning at 48 hours
   * anyway, on 0.10.3 and 0.10.4 alike. The guarantee this minimum exists to
   * make only becomes true at **0.10.5**.
   *
   * So this bump is not "the schema moved" — it is the same criterion applied to
   * a floor that provably did not deliver it. The fix is entirely server-side
   * (`rpcs.sql`), and nothing in the client can compensate: a 1.2.0 client
   * against a 0.10.4 store still silently discards version history. Blocking is
   * the only thing that reliably converts "npm upgraded" into "redeployed".
   *
   * **This is NOT bumped with every schema change.** A schema bump alone makes
   * the deployed version merely *older than bundled* — a warning, and everything
   * keeps running. Raising the MINIMUM says something stronger: "this client
   * misbehaves against anything older", which makes `doctor` error and makes
   * `cerefox web` refuse to start. Reserve it for exactly that.
   *
   * Worked example of the distinction, still worth keeping: schema went
   * 0.10.2 -> 0.10.3 -> 0.10.4, and the v1.1.0 minimum was 0.10.3, not 0.10.4.
   * 0.10.4 only changed a fallback VALUE (48h -> 120h) — a client against a
   * 0.10.3 server behaves correctly, just with the older default when no config
   * row exists. That degrades gracefully, so it did not justify blocking anyone.
   * 0.10.5 is different in kind: below it, a configured policy is ignored.
   *
   * v1.4.0 reviewed and deliberately did NOT raise this to 0.11.1. That
   * migration only widens an audit CHECK so `rename-section` can be recorded.
   * Against a 0.11.0 server every other operation is correct, and a rename
   * fails loudly at the constraint rather than doing something wrong — which
   * is the distinction that matters here. Blocking `cerefox web` from starting
   * over one operation a user may never call would be the more harmful
   * failure. The schema-version bump already drives the "redeploy required"
   * banner in `doctor`, which is the right-sized signal.
   */
  minSchema: "0.10.5",
  /** Minimum deployed Edge Function version this client requires. */
  minEdgeFunctions: "0.6.0",
} as const;

export type CompatLevel =
  /** deployed >= bundled (or >= min when bundled unknown): all good. */
  | "ok"
  /** deployed >= min but < bundled: works, but a newer server is available. */
  | "above-min-but-old"
  /** deployed < min: client needs a newer server — blocking. */
  | "below-min"
  /** couldn't determine the deployed version. */
  | "unknown";

/**
 * Compare two dotted versions numerically (major.minor.patch). Prerelease
 * suffixes are ignored for the comparison (`0.8.0-rc.1` compares as
 * `0.8.0`). Returns -1 if a<b, 0 if equal, 1 if a>b.
 */
export function compareSemver(a: string, b: string): number {
  // Core X.Y.Z compare, then SemVer §11 pre-release precedence. The previous
  // implementation truncated to the numeric triple, so EVERY 1.0.0-* pre-release
  // (and 1.0.0 itself) compared equal — which silenced doctor's "EF older than
  // bundled" warning across the 1.0.0-beta line (found in the beta.4 dogfood).
  const split = (v: string): { core: number[]; pre: string[] } => {
    const [core, ...preParts] = v.split("-");
    return {
      core: core.split(".").slice(0, 3).map((p) => {
        const n = Number.parseInt(p, 10);
        return Number.isFinite(n) ? n : 0;
      }),
      pre: preParts.length ? preParts.join("-").split(".") : [],
    };
  };
  const pa = split(a);
  const pb = split(b);
  for (let i = 0; i < 3; i++) {
    const x = pa.core[i] ?? 0;
    const y = pb.core[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  // Equal cores: no pre-release outranks any pre-release (1.0.0 > 1.0.0-rc.1).
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1;
  if (pb.pre.length === 0) return -1;
  // Identifier-by-identifier: numeric < alphanumeric; numerics numerically,
  // alphanumerics lexically; a shorter prefix sorts lower (beta < beta.1).
  const len = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < len; i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x) ? Number.parseInt(x, 10) : null;
    const yn = /^\d+$/.test(y) ? Number.parseInt(y, 10) : null;
    if (xn !== null && yn !== null) {
      if (xn !== yn) return xn < yn ? -1 : 1;
    } else if (xn !== null) {
      return -1; // numeric identifiers sort below alphanumeric
    } else if (yn !== null) {
      return 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Classify a deployed version against the minimum (and optionally the
 * bundled/client version, to distinguish "old but ok" from "current").
 */
export function classifyCompat(
  deployed: string | null,
  min: string,
  bundled?: string | null,
): CompatLevel {
  if (!deployed) return "unknown";
  if (compareSemver(deployed, min) < 0) return "below-min";
  if (bundled && compareSemver(deployed, bundled) < 0) return "above-min-but-old";
  return "ok";
}

interface AggregatorResponse {
  name?: string;
  version?: string;
  schema?: string | null;
  efs?: Array<{ name: string; version: string }>;
  errors?: Array<{ name: string; error: string }>;
}

export interface ServerCompat {
  schema: { deployed: string | null; min: string; level: CompatLevel };
  edgeFunctions: {
    /** Weakest (lowest) EF version across all probed EFs, or null if none. */
    deployed: string | null;
    min: string;
    level: CompatLevel;
    /** Peers that failed to report a version (e.g. 404 = pre-0.8 EFs). */
    errors: Array<{ name: string; error: string }>;
  };
  /** True if any surface is below-min — callers that must block should refuse. */
  blocking: boolean;
  /** True if EF probing couldn't run (no access token / aggregator unreachable). */
  efProbeSkipped: boolean;
  /** Human note when the EF probe was skipped. */
  efSkipReason?: string;
}

export interface CheckOptions {
  /** Full aggregator URL: `<supabaseUrl>/functions/v1/cerefox-mcp/version?peers=true`. */
  aggregatorUrl: string;
  /** The Cerefox access token (`cfx_pat_…`), validated in-function by the EFs (iter-28E). */
  bearer?: string;
  /** Client's bundled schema version (from db-status), for the old-but-ok tier. */
  bundledSchema?: string | null;
  /** Client's bundled EF expectation (usually PKG_VERSION / EF_VERSION). */
  bundledEf?: string | null;
  /** Injectable fetch (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Overall timeout for the aggregator call. */
  timeoutMs?: number;
}

/**
 * Build the cerefox-mcp aggregator URL from a Supabase project URL.
 */
export function aggregatorUrlFor(supabaseUrl: string): string {
  const base = supabaseUrl.replace(/\/$/, "");
  return `${base}/functions/v1/cerefox-mcp/version?peers=true`;
}

/**
 * Probe the server and classify schema + EF versions against the matrix.
 *
 * EF probing is skipped (not failed) when no bearer is available or the
 * aggregator is unreachable — those are common transitional states (e.g.
 * EFs not yet deployed → aggregator 404, or no access token configured).
 * Skipped EF checks never set `blocking`.
 */
export async function checkServerCompatibility(
  opts: CheckOptions,
): Promise<ServerCompat> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const result: ServerCompat = {
    schema: { deployed: null, min: COMPATIBILITY.minSchema, level: "unknown" },
    edgeFunctions: {
      deployed: null,
      min: COMPATIBILITY.minEdgeFunctions,
      level: "unknown",
      errors: [],
    },
    blocking: false,
    efProbeSkipped: false,
  };

  if (!opts.bearer) {
    result.efProbeSkipped = true;
    result.efSkipReason =
      "No CEREFOX_ACCESS_TOKEN configured; Edge Function version check skipped.";
    return result;
  }

  let agg: AggregatorResponse | null = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 6_000);
    try {
      const resp = await fetchImpl(opts.aggregatorUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${opts.bearer}`, apikey: opts.bearer },
        signal: ctrl.signal,
      });
      if (resp.ok) {
        agg = (await resp.json()) as AggregatorResponse;
      } else {
        result.efProbeSkipped = true;
        // 404/405 = the deployed cerefox-mcp predates v0.8 (no /version route;
        // pre-0.8 it returns 405 on every GET). Other statuses are unexpected.
        result.efSkipReason =
          resp.status === 404 || resp.status === 405
            ? "Edge Functions predate v0.8 (no /version route). Redeploy with `cerefox server deploy --functions-only` to enable version checks."
            : `Aggregator returned HTTP ${resp.status}; Edge Function version check skipped.`;
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    result.efProbeSkipped = true;
    result.efSkipReason = `Could not reach the version aggregator: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }

  if (!agg) return result;

  // Schema version comes back in the aggregator payload.
  result.schema.deployed = agg.schema ?? null;
  result.schema.level = classifyCompat(
    result.schema.deployed,
    COMPATIBILITY.minSchema,
    opts.bundledSchema,
  );

  // EF "deployed" = the weakest (lowest) version across mcp + all peers.
  const versions: string[] = [];
  if (agg.version) versions.push(agg.version);
  for (const ef of agg.efs ?? []) versions.push(ef.version);
  result.edgeFunctions.errors = agg.errors ?? [];

  if (versions.length > 0) {
    const weakest = versions.reduce((lo, v) => (compareSemver(v, lo) < 0 ? v : lo));
    result.edgeFunctions.deployed = weakest;
    result.edgeFunctions.level = classifyCompat(
      weakest,
      COMPATIBILITY.minEdgeFunctions,
      opts.bundledEf,
    );
  } else {
    result.edgeFunctions.level = "unknown";
    result.efProbeSkipped = true;
    result.efSkipReason =
      "Aggregator reported no Edge Function versions; check skipped.";
  }

  result.blocking =
    result.schema.level === "below-min" || result.edgeFunctions.level === "below-min";

  return result;
}
