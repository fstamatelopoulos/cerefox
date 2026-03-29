import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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
 *   metadata_filter  object       required  Key-value pairs (AND semantics)
 *   project_id       string       optional  Project UUID filter
 *   updated_since    string       optional  ISO-8601 lower bound for updated_at
 *   created_since    string       optional  ISO-8601 lower bound for created_at
 *   limit            number       optional  Max results (default: 10)
 *   include_content  boolean      optional  Include full text (default: false)
 *   max_bytes        number       optional  Byte budget when include_content=true
 *
 * Response (200): Array of matching documents
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

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const metadata_filter = body.metadata_filter;

    if (
      !metadata_filter ||
      typeof metadata_filter !== "object" ||
      Array.isArray(metadata_filter) ||
      Object.keys(metadata_filter).length === 0
    ) {
      return new Response(
        JSON.stringify({ error: "metadata_filter is required and must be a non-empty JSON object" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    const project_id = body.project_id ?? null;
    const updated_since = body.updated_since ?? null;
    const created_since = body.created_since ?? null;
    const limit = body.limit ?? 10;
    const include_content = body.include_content ?? false;
    const requested_max_bytes = body.max_bytes;

    const max_bytes = include_content
      ? Math.min(requested_max_bytes ?? MAX_BYTES, MAX_BYTES)
      : null;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const params: Record<string, unknown> = {
      p_metadata_filter: metadata_filter,
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

    // Fire-and-forget usage logging
    Promise.resolve(supabase.rpc("cerefox_log_usage", {
      p_operation: "metadata_search",
      p_access_path: "edge-function",
      p_requestor: body.requestor ?? null,
      p_query_text: JSON.stringify(metadata_filter),
      p_result_count: (data ?? []).length,
      p_project_id: project_id,
    })).catch(() => {});

    return new Response(JSON.stringify(data ?? []), {
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
