import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { isVersionRequest, versionResponse } from "../../../_shared/ef-meta/index.ts";
import { efAuthGate } from "../../../_shared/ef-auth/index.ts";
import { callerIdentity } from "../../../_shared/mcp-tools/identity.ts";
import { reviewWorkflowEnabled } from "../../../_shared/mcp-tools/feature-flags.ts";
import { resolveByteBudget } from "../../../_shared/mcp-tools/_utils.ts";

/**
 * cerefox-metadata-search -- Supabase Edge Function
 *
 * Query documents by metadata key-value criteria without a text search term.
 * Calls the cerefox_metadata_search() RPC via the service-role key.
 *
 * Called by:
 *   - GPT Custom Actions (direct HTTP POST via OpenAPI schema)
 *   - Any authenticated HTTP client
 *
 * Note: cerefox-mcp calls the RPC directly (not this Edge Function).
 *
 * Request body (JSON):
 *   metadata_filter  object       optional  Key-value pairs (AND semantics)
 *   project_id       string       optional  Project UUID filter
 *
 * At least one of metadata_filter / project_id / updated_since / created_since
 * must be supplied (an empty filter + project_id lists that project's docs).
 *   updated_since    string       optional  ISO-8601 lower bound for updated_at
 *   created_since    string       optional  ISO-8601 lower bound for created_at
 *   limit            number       optional  Max results (default: 10)
 *   include_content  boolean      optional  Include full text (default: false)
 *   max_bytes        number       optional  Byte budget when include_content=true
 *
 * Response (200): Array of matching documents. `review_status` is present
 *                 only while the review workflow is on (#241); with the flag
 *                 off the key is absent, as on every other surface.
 * Response (400): { error: "..." }
 */

const MAX_BYTES = 200_000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  const authFail = efAuthGate(
    req.headers.get("Authorization"),
    Deno.env.get("CEREFOX_ACCESS_TOKENS"),
    { ...CORS_HEADERS, "Content-Type": "application/json" },
  );
  if (authFail) return authFail;

  if (isVersionRequest(req)) {
    return versionResponse("cerefox-metadata-search", { ...CORS_HEADERS, "Content-Type": "application/json" });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const metadata_filter = body.metadata_filter;

    if (
      metadata_filter !== undefined &&
      metadata_filter !== null &&
      (typeof metadata_filter !== "object" || Array.isArray(metadata_filter))
    ) {
      return new Response(
        JSON.stringify({ error: "metadata_filter must be a JSON object when provided" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    const project_id = body.project_id ?? null;
    const updated_since = body.updated_since ?? null;
    const created_since = body.created_since ?? null;

    // metadata_filter is optional, but at least one narrowing criterion is
    // required so this never becomes an unbounded whole-KB dump. An empty
    // filter + project_id lists a project's documents (the RPC's
    // `metadata @> '{}'` matches every row; the project predicate narrows it).
    const has_metadata =
      metadata_filter && typeof metadata_filter === "object" &&
      Object.keys(metadata_filter).length > 0;
    if (!has_metadata && !project_id && !updated_since && !created_since) {
      return new Response(
        JSON.stringify({
          error: "Provide at least one of: metadata_filter, project_id, updated_since, or created_since.",
        }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    // Clamp limit to [1, 500]: response is byte-capped, but bound the row work too
    // so an authenticated caller can't request an unbounded scan. Defensive review, pre-1.0.
    const limit = Math.min(Math.max(1, Math.floor(Number(body.limit)) || 10), 500);
    const include_content = body.include_content ?? false;
    const requested_max_bytes = body.max_bytes;

    // One implementation of this arithmetic, shared with every other surface
    // that takes a budget (#268): non-numeric and null both mean "unset" and
    // fall back to the ceiling, while a real number of zero or less is
    // honoured as "almost no budget".
    const max_bytes = include_content
      ? resolveByteBudget(requested_max_bytes, MAX_BYTES)
      : null;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Configurable caller-identity enforcement: `author`, or `requestor` as the pre-1.13.2 alias (#244)
    const identityField = "author";
    const identityValue = callerIdentity(body as Record<string, unknown>);
    const { data: reqConfig } = await supabase.rpc("cerefox_get_config", { p_key: "require_requestor_identity" });
    if (reqConfig === "true") {
      if (!identityValue || (typeof identityValue === "string" && identityValue.trim() === "")) {
        return new Response(
          JSON.stringify({ error: `Missing required parameter "${identityField}". Server requires caller identity.` }),
          { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
        );
      }
      const { data: fmtConfig } = await supabase.rpc("cerefox_get_config", { p_key: "requestor_identity_format" });
      if (fmtConfig && typeof fmtConfig === "string" && fmtConfig.trim() !== "") {
        if (!new RegExp(fmtConfig).test(identityValue)) {
          return new Response(
            JSON.stringify({ error: `Invalid "${identityField}" format. Does not match pattern: ${fmtConfig}` }),
            { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
          );
        }
      }
    }

    const params: Record<string, unknown> = {
      p_metadata_filter: has_metadata ? metadata_filter : {},
      p_project_id: project_id,
      p_updated_since: updated_since,
      p_created_since: created_since,
      p_limit: limit,
      p_include_content: include_content,
    };
    if (max_bytes !== null) {
      params.p_max_bytes = max_bytes;
    }

    const { data, error } = await supabase.rpc("cerefox_metadata_search", params);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    let rows = (data ?? []) as Array<Record<string, unknown>>;

    // Never answer with a shorter list than what matched (#268).
    //
    // The RPC applies `p_max_bytes` server-side by stopping at the first row
    // whose content does not fit, so this list has two indistinguishable
    // causes: fewer documents matched, or the budget cut it short. When the
    // first row is the oversized one the array comes back EMPTY, and a caller
    // reads `[]` as "this knowledge does not exist" and stops looking — the
    // false negative #254 exists to prevent, reached here through a sibling
    // that never got the guard.
    //
    // The response shape stays a bare array, because Custom GPTs are
    // configured against it: every matching document is listed, and only
    // CONTENT is negotiable. Rows the budget could not afford come back
    // content-free and marked, so `results.length` is always the true count
    // and nothing is held back silently.
    //
    // Cost: a second RPC round-trip whenever a content-bearing search returns
    // less than a full page, which is the common case rather than a rare one.
    // The RPC signals no total, so the only alternative to asking is guessing
    // whether a short list was cut — and guessing wrong is the bug.
    if (include_content && max_bytes !== null && rows.length < limit) {
      const { data: headerData, error: probeError } = await supabase.rpc(
        "cerefox_metadata_search",
        { ...params, p_include_content: false, p_max_bytes: null },
      );
      // supabase-js RESOLVES with `{ data: null, error }` for PostgREST and
      // network failures rather than throwing, so a probe failure must be read
      // from the error, not inferred from an empty list — reading it as "no
      // documents" is the very false empty this branch prevents (#261).
      if (probeError && rows.length === 0) {
        // Falling through here would ship exactly the false empty this block
        // exists to prevent — `200 []`, which a caller reads as "no such
        // knowledge". An error is the honest answer: it says the question was
        // not resolved, rather than answering it wrongly.
        return new Response(
          JSON.stringify({
            error:
              `Nothing fit max_bytes=${max_bytes} with include_content, and the follow-up ` +
              `query that lists what matched failed: ${probeError.message}. This is NOT a ` +
              `confirmed empty result — retry with a larger max_bytes, or include_content: false.`,
          }),
          { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
        );
      }
      if (!probeError) {
        const headers = (headerData ?? []) as Array<Record<string, unknown>>;
        if (headers.length > rows.length) {
          const withContent = new Map(rows.map((r) => [r.document_id as string, r]));
          // The probe carries the full, correctly ordered match set; the
          // content-bearing rows are folded into it by id so ordering is the
          // RPC's, not an artefact of which rows happened to fit.
          const merged = headers.map(
            (h) => withContent.get(h.document_id as string) ?? { ...h, content_omitted: true },
          );
          // Two queries, two chances to disagree: the RPC orders by
          // `updated_at DESC` with no tiebreaker under a LIMIT, and a
          // concurrent write between the calls shifts the window. Anything the
          // content query returned that the probe did not is APPENDED rather
          // than dropped — losing a document we already hold, while fixing a
          // bug about losing documents, would be its own joke.
          const seen = new Set(merged.map((r) => r.document_id as string));
          for (const r of rows) {
            if (!seen.has(r.document_id as string)) merged.push(r);
          }
          rows = merged;
        }
      }
    }

    // Fire-and-forget usage logging. Counts what MATCHED, not what the budget
    // allowed through: a budget-wiped search logging `0` misreports the store
    // as empty in analytics (#259).
    Promise.resolve(supabase.rpc("cerefox_log_usage", {
      p_operation: "metadata_search",
      p_access_path: "edge-function",
      p_requestor: identityValue ?? null,
      p_query_text: JSON.stringify(metadata_filter),
      p_result_count: rows.length,
      p_project_id: project_id,
    })).catch(() => {});

    // Presentation only: the same shared reader every other surface uses.
    const showReview = await reviewWorkflowEnabled(supabase);
    const out = showReview
      ? rows
      : rows.map(({ review_status: _hidden, ...rest }) => rest);

    return new Response(JSON.stringify(out), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
