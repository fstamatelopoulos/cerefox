/**
 * Web-server context: the dependencies every route handler needs.
 *
 * Built once at `cerefox web` boot in `server.ts` and threaded through
 * the per-group `register<X>Routes(app, ctx)` registration functions.
 * Mirrors the FastAPI `Depends(get_client)` / `Depends(get_settings)`
 * pattern in `src/cerefox/api/deps.py`, without the dep-injection
 * framework — Hono routes are plain closures.
 *
 * `supabase` is the raw `@supabase/supabase-js` client (service-role or
 * legacy service_role JWT — same credential the Python web uses).
 * `openAiApiKey` is null when `CEREFOX_EMBEDDER` is unset; endpoints
 * that need embeddings return 503 in that case, matching the Python
 * "Embedder not available" branch.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadSettings, type Settings } from "../../../../_shared/config/index.js";

export interface WebContext {
  supabase: SupabaseClient;
  settings: Settings;
  openAiApiKey: string | null;
}

/**
 * Tolerant variant: returns null when Supabase credentials are absent so
 * the server can still boot and answer /api/v1/version (smoke tests in
 * CI don't have `.env`). DB-touching routes degrade to 503 when ctx is
 * null — matches the FastAPI "Embedder not available" UX shape.
 */
export function buildWebContext(): WebContext | null {
  const settings = loadSettings();
  if (!settings.supabaseUrl || !settings.supabaseKey) return null;
  const supabase = createClient(settings.supabaseUrl, settings.supabaseKey, {
    auth: { persistSession: false },
  });
  const openAiApiKey = process.env.OPENAI_API_KEY ?? null;
  return { supabase, settings, openAiApiKey };
}
