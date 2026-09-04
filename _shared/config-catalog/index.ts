/**
 * The `cerefox_config` key catalog — one description of the runtime settings,
 * shared by every surface that presents them.
 *
 * These keys are DB-backed, not environment variables: setting one governs
 * EVERY access path (CLI, local + remote MCP, Edge Functions, web) because all
 * of them resolve through the same RPCs. That is the point of the table, and
 * it is also why the catalog lives here rather than being restated per client
 * — `cerefox config list` and the web settings page must not be able to
 * disagree about what a key means or what it defaults to.
 *
 * The authoritative allow-list is `v_allowed` in `cerefox_set_config`
 * (`src/cerefox/db/rpcs.sql`). This catalog must stay in step with it; a key
 * here that the RPC rejects surfaces as a write error, and a key there but not
 * here is simply invisible to the UI.
 */

export type ConfigValueKind = "boolean" | "number" | "string";

export interface ConfigKeySpec {
  key: string;
  /** One line, plain enough for a settings screen. */
  description: string;
  kind: ConfigValueKind;
  /** Value used when the row is absent, as stored (always a string). */
  defaultValue: string;
  /** Numeric bounds, for input validation. */
  min?: number;
  max?: number;
  /** Grouping for display. */
  group: "Governance" | "Retrieval" | "Retention" | "Features";
  /**
   * True when flipping this key changes what other software sees — not just
   * how this install behaves. Surfaces get an explicit confirmation step
   * rather than a bare toggle.
   */
  highImpact?: boolean;
  /** Shown alongside a high-impact key to explain the consequence. */
  impactNote?: string;
}

export const CONFIG_CATALOG: ReadonlyArray<ConfigKeySpec> = [
  {
    key: "usage_tracking_enabled",
    description: "Log reads and writes to cerefox_usage_log.",
    kind: "boolean",
    defaultValue: "false",
    group: "Governance",
  },
  {
    key: "require_requestor_identity",
    description:
      "Require a requestor/author. Enforced on the Edge Functions (incl. remote MCP) ONLY — not local MCP, /api/v1 or the CLI.",
    kind: "boolean",
    defaultValue: "false",
    group: "Governance",
    highImpact: true,
    impactNote:
      "Agents that do not send a requestor will start getting errors. Confirm your MCP clients identify themselves before enabling.",
  },
  {
    key: "requestor_identity_format",
    description:
      "Regex the requestor/author must match. Only enforced while “require requestor identity” is on.",
    kind: "string",
    defaultValue: "",
    group: "Governance",
  },
  {
    key: "min_search_score",
    description:
      "Minimum cosine similarity for vector-side results. Use 0.6 with the local embedder.",
    kind: "number",
    defaultValue: "0.5",
    min: 0,
    max: 1,
    group: "Retrieval",
  },
  {
    key: "min_term_coverage",
    description:
      "Fraction of a query's meaningful terms a keyword OR-fallback match must cover to count as confident.",
    kind: "number",
    defaultValue: "0.5",
    min: 0,
    max: 1,
    group: "Retrieval",
  },
  {
    key: "search_alpha",
    description: "Hybrid fusion weight: 1 = pure semantic, 0 = pure keyword.",
    kind: "number",
    defaultValue: "0.7",
    min: 0,
    max: 1,
    group: "Retrieval",
  },
  {
    key: "version_retention_hours",
    description:
      "How long to keep archived versions of a document (hours). The most recent version and any explicitly archived one are always kept, whatever this says.",
    kind: "number",
    defaultValue: "120",
    min: 0,
    group: "Retention",
  },
  {
    key: "version_cleanup_enabled",
    description:
      "Prune versions past the retention window. Turn off to keep every version forever (immutable history).",
    kind: "boolean",
    defaultValue: "true",
    group: "Retention",
    highImpact: true,
    impactNote:
      "Turning this OFF keeps every version of every document forever. Versions carry embeddings, so storage grows without bound — on a busy store that is the largest table. Turning it back ON prunes on the next save, which permanently deletes versions outside the window (the newest and any archived ones survive).",
  },
  {
    key: "document_size_warning_chars",
    description:
      "Flag writes that push a document past this many characters (0 = off). Partial edits make writes cheap, so an agent that only ever inserts never assembles the document and never sees it grow; this puts the fact in the write's response. A signal only — writes are never blocked.",
    kind: "number",
    defaultValue: "0",
    min: 0,
    group: "Retention",
  },
  {
    key: "relations_enabled",
    description:
      "Expose the four document-relation tools to agents. The feature is dormant until enabled.",
    kind: "boolean",
    defaultValue: "false",
    group: "Features",
    highImpact: true,
    impactNote:
      "This adds four tools (set/delete/get relations, get neighbours) to every connected agent's tool list — local MCP, remote MCP, and Edge Functions alike. Relations data and schema are always present; this switch only controls whether agents can see and use the tools. Turning it back off hides them again without deleting anything.",
  },
  {
    key: "review_workflow_enabled",
    description:
      "Show and enforce the review status of documents: agent-authored writes are marked 'pending review' for a person to approve. Off: no surface shows a review status and nothing enforces it; the status is still recorded and reappears unchanged when turned back on. Off on a fresh install; on for stores that predate the flag.",
    kind: "boolean",
    defaultValue: "false",
    group: "Governance",
    highImpact: true,
    impactNote:
      "Turning this OFF hides the review badges, the approve control and the search filter everywhere (web, API, MCP, CLI). It changes nothing stored and nothing about how writes are recorded: agent writes are still marked pending behind the scenes, so turning it back ON shows exactly the statuses the store would have had all along.",
  },
];

export function configKeySpec(key: string): ConfigKeySpec | undefined {
  return CONFIG_CATALOG.find((k) => k.key === key);
}

/** The catalog's keys, in display order. */
export const CONFIG_KEYS: ReadonlyArray<string> = CONFIG_CATALOG.map((k) => k.key);

/**
 * Validate a value for a key before it reaches the RPC. Returns null when the
 * value is acceptable, or a human-readable reason when it is not.
 *
 * The RPC is the authority on *which keys* exist; this is about the *value*,
 * which the RPC stores as opaque text. Without it a typo like `min_search_score
 * = 5` is accepted silently and quietly suppresses every search result.
 */
export function validateConfigValue(key: string, value: string): string | null {
  const spec = configKeySpec(key);
  if (!spec) return `Unknown config key: ${key}`;

  if (spec.kind === "boolean") {
    return value === "true" || value === "false"
      ? null
      : `${key} must be "true" or "false" (got ${JSON.stringify(value)}).`;
  }

  if (spec.kind === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return `${key} must be a number (got ${JSON.stringify(value)}).`;
    }
    if (spec.min !== undefined && n < spec.min) {
      return `${key} must be ≥ ${spec.min} (got ${n}).`;
    }
    if (spec.max !== undefined && n > spec.max) {
      return `${key} must be ≤ ${spec.max} (got ${n}).`;
    }
    return null;
  }

  // Free-text keys that are regexes must actually compile, or the enforcement
  // path they feed throws on every call instead of rejecting one request.
  if (key === "requestor_identity_format" && value.length > 0) {
    try {
      new RegExp(value);
    } catch (err) {
      return `${key} must be a valid regular expression: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  }
  return null;
}
