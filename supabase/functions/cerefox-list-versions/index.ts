import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * cerefox-list-versions — Supabase Edge Function
 *
 * Lists all archived versions of a document, newest first.
 * Calls the cerefox_list_document_versions RPC via the service-role key.
 *
 * Called by:
 *   - cerefox-mcp Edge Function (MCP tools/call for cerefox_list_versions)
 *   - GPT Custom Actions (direct HTTP POST via OpenAPI schema)
 *   - Any authenticated HTTP client
 *
 * Request body (JSON):
 *   { document_id: string }
 *
 * Response (200):
 *   Array of { version_id, version_number, source, chunk_count, total_chars, created_at }
 *   Empty array [] when no versions exist.
 * Response (400):
 *   { error: "document_id is required" }
 */

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
    const document_id = body.document_id as string | undefined;

    if (!document_id) {
      return new Response(JSON.stringify({ error: "document_id is required" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

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

    const { data, error } = await supabase.rpc("cerefox_list_document_versions", {
      p_document_id: document_id,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Fire-and-forget usage logging
    Promise.resolve(supabase.rpc("cerefox_log_usage", {
      p_operation: "list_versions",
      p_access_path: "edge-function",
      p_requestor: body.requestor ?? null,
      p_document_id: document_id,
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
