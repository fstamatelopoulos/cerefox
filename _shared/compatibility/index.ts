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
  /** Minimum deployed Postgres schema version this client requires. */
  minSchema: "0.3.1",
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
  const norm = (v: string) =>
    v
      .split(/[.-]/)
      .slice(0, 3)
      .map((p) => Number.parseInt(p, 10))
      .map((n) => (Number.isFinite(n) ? n : 0));
  const pa = norm(a);
  const pb = norm(b);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
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
  /** True if EF probing couldn't run (no anon key / aggregator unreachable). */
  efProbeSkipped: boolean;
  /** Human note when the EF probe was skipped. */
  efSkipReason?: string;
}

export interface CheckOptions {
  /** Full aggregator URL: `<supabaseUrl>/functions/v1/cerefox-mcp/version?peers=true`. */
  aggregatorUrl: string;
  /** Gateway-valid bearer (legacy anon JWT `eyJ…`). EFs reject the new sb_* keys. */
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
 * v0.8 EFs not yet deployed → aggregator 404, or no anon key configured).
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
      "No anon JWT (CEREFOX_SUPABASE_ANON_KEY) configured; Edge Function version check skipped.";
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
            ? "Edge Functions predate v0.8 (no /version route). Redeploy with `cerefox deploy-server --functions-only` to enable version checks."
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
