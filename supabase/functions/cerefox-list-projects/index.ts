import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * cerefox-list-projects -- Supabase Edge Function
 *
 * Lists all projects with names, IDs, and descriptions.
 * Calls the cerefox_list_projects() RPC via the service-role key.
 *
 * Called by:
 *   - GPT Custom Actions (direct HTTP POST via OpenAPI schema)
 *   - Any authenticated HTTP client
 *
 * Note: cerefox-mcp calls the RPC directly (not this Edge Function).
 *
 * Request body (JSON): {} or { requestor?: string }
 * Response (200): Array of { id, name, description }
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
    const body = await req.json().catch(() => ({}));
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

    const { data, error } = await supabase.rpc("cerefox_list_projects");

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Fire-and-forget usage logging
    Promise.resolve(supabase.rpc("cerefox_log_usage", {
      p_operation: "list_projects",
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
