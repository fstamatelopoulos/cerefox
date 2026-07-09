/**
 * cerefox-consent — Cloudflare Worker
 *
 * Serves the Cerefox OAuth consent page as real `text/html` (which a Supabase
 * Edge Function on the default domain cannot — it rewrites html→plain). The
 * markup + client-side logic are the SAME as the EF version: both render the
 * shared `renderConsentPage()`. Free on the Workers plan (a `*.workers.dev`
 * subdomain, no custom domain needed).
 *
 * Config (Wrangler [vars], both public):
 *   SUPABASE_URL              e.g. https://<project-ref>.supabase.co
 *   SUPABASE_PUBLISHABLE_KEY  the sb_publishable_… key — NOT the legacy anon JWT.
 *                             The page only talks to Supabase Auth; a world-readable
 *                             publishable key grants no KB access (the EF gateway and
 *                             the schema-0.7.0 RPC lockdown reject it).
 *
 * Point your Supabase Site URL at this Worker's origin and set Authorization
 * Path to `/consent` (design §4.2-B).
 */

import { renderConsentPage } from "../../../_shared/consent-page/index.ts";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
}

export default {
  fetch(request: Request, env: Env): Response {
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    return new Response(renderConsentPage(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
};
