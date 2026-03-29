import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * cerefox-get-document — Supabase Edge Function
 *
 * Retrieves the full reconstructed content of a document (current or an archived version).
 * Calls the cerefox_get_document RPC via the service-role key (never exposed to callers).
 *
 * Called by:
 *   - cerefox-mcp Edge Function (MCP tools/call for cerefox_get_document)
 *   - GPT Custom Actions (direct HTTP POST via OpenAPI schema)
 *   - Any authenticated HTTP client
 *
 * Request body (JSON):
 *   { document_id: string, version_id?: string | null }
 *
 * Response (200):
 *   { document_id, doc_title, full_content, chunk_count, total_chars, is_archived, version_id }
 * Response (404):
 *   { error: "Document not found" }
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
    const version_id = (body.version_id ?? null) as string | null;

    if (!document_id) {
      return new Response(JSON.stringify({ error: "document_id is required" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase.rpc("cerefox_get_document", {
      p_document_id: document_id,
      p_version_id: version_id,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const row = data?.[0] as {
      doc_title?: string;
      full_content?: string;
      chunk_count?: number;
      total_chars?: number;
    } | undefined;

    if (!row) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Fire-and-forget usage logging
    Promise.resolve(supabase.rpc("cerefox_log_usage", {
      p_operation: "get_document",
      p_access_path: "edge-function",
      p_requestor: body.requestor ?? null,
      p_document_id: document_id,
      p_result_count: 1,
    })).catch(() => {});

    return new Response(
      JSON.stringify({
        document_id,
        doc_title: row.doc_title ?? "Untitled",
        full_content: row.full_content ?? "",
        chunk_count: row.chunk_count ?? 0,
        total_chars: row.total_chars ?? 0,
        is_archived: version_id !== null,
        version_id,
      }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
