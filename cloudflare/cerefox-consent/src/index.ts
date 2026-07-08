/**
 * cerefox-consent — Cloudflare Worker
 *
 * Serves the Cerefox OAuth consent page as real `text/html` (which a Supabase
 * Edge Function on the default domain cannot — it rewrites html→plain). The
 * markup + client-side logic are the SAME as the EF version: both render the
 * shared `renderConsentPage()`. Free on the Workers plan (a `*.workers.dev`
 * subdomain, no custom domain needed).
 *
 * Config (Wrangler [vars], both public — the project URL and the anon key):
 *   SUPABASE_URL       e.g. https://<project-ref>.supabase.co
 *   SUPABASE_ANON_KEY  the legacy anon JWT (public by design)
 *
 * Point your Supabase Site URL at this Worker's origin and set Authorization
 * Path to `/consent` (design §4.2-B).
 */

import { renderConsentPage } from "../../../_shared/consent-page/index.ts";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

export default {
  fetch(request: Request, env: Env): Response {
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    return new Response(renderConsentPage(env.SUPABASE_URL, env.SUPABASE_ANON_KEY), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
};
