import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * cerefox-get-audit-log -- Supabase Edge Function
 *
 * Returns audit log entries with optional filters. Calls the
 * cerefox_list_audit_entries() RPC which joins cerefox_documents
 * to include doc_title.
 *
 * Called by the cerefox-mcp Edge Function (MCP tool), GPT Actions
 * (direct HTTP POST), or any HTTP client.
 *
 * Request body (JSON):
 *   document_id?  : string  -- filter by document UUID
 *   author?       : string  -- filter by author name
 *   operation?    : string  -- filter by operation type
 *   since?        : string  -- ISO timestamp lower bound
 *   until?        : string  -- ISO timestamp upper bound
 *   limit?        : number  -- max entries (default 50, max 200)
 *
 * Response: Array of audit log entries with doc_title
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));

    // Configurable requestor enforcement
    const identityField = "requestor";
    const identityValue = body[identityField];
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

    const params: Record<string, unknown> = {};
    if (body.document_id) params.p_document_id = body.document_id;
    if (body.author) params.p_author = body.author;
    if (body.operation) params.p_operation = body.operation;
    if (body.since) params.p_since = body.since;
    if (body.until) params.p_until = body.until;
    if (body.limit) params.p_limit = Math.min(Number(body.limit) || 50, 200);

    const { data, error } = await supabase.rpc(
      "cerefox_list_audit_entries",
      params,
    );

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Fire-and-forget usage logging
    Promise.resolve(supabase.rpc("cerefox_log_usage", {
      p_operation: "get_audit_log",
      p_access_path: "edge-function",
      p_requestor: body.requestor ?? null,
      p_result_count: (data ?? []).length,
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
