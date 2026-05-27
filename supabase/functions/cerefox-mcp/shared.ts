import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ── CORS ─────────────────────────────────────────────────────────────────────

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
};

// ── Supabase client (service-role key, bypasses RLS) ─────────────────────────

export function makeSupabaseClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

// ── JSON-RPC response helpers ─────────────────────────────────────────────────

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export function errorResponse(id: unknown, code: number, message: string): Response {
  return jsonResponse(
    {
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code, message },
    },
    200, // MCP errors are still HTTP 200 per spec; the error is in the payload
  );
}

export function notificationResponse(): Response {
  return new Response(null, { status: 202, headers: CORS_HEADERS });
}
