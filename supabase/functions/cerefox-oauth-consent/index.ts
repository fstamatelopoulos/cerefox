import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { renderConsentPage } from "../../../_shared/consent-page/index.ts";

/**
 * cerefox-oauth-consent — Supabase Edge Function (OAuth consent page).
 *
 * ⚠️ On the default `*.supabase.co` domain Supabase rewrites `text/html` →
 * `text/plain`, so this EF only RENDERS correctly behind a paid Supabase custom
 * domain. For free setups the canonical host is the Cloudflare Worker in
 * `cloudflare/cerefox-consent/`, which serves the SAME markup via the shared
 * `renderConsentPage()`. This EF is retained for custom-domain deployments.
 * See docs/specs/oauth-mcp-server-design.md §4.2-B.
 *
 * Markup + client-side logic live in `_shared/consent-page/`; this file is just
 * the Deno HTTP wrapper. Deployed with --no-verify-jwt (loads in a browser).
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

Deno.serve((req: Request): Response => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  return new Response(renderConsentPage(supabaseUrl, anonKey), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
});
