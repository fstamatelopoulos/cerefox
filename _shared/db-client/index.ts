/**
 * Thin Supabase client wrapper covering the read/RPC surface that v0.3.0
 * TS scripts and the upcoming v0.5 `cerefox doctor` need.
 *
 * Intentionally minimal — grows with v0.4 (MCP server) and v0.5 (CLI) when
 * the same client gets shared across more callers. For v0.3.0 the surface
 * is just:
 *
 *   - createClient(): factory bound to the loaded settings
 *   - listProjects(): used by sync_docs.ts to resolve project names
 *   - rpc<T>(name, params): typed RPC invocation, used by db_status.ts to
 *     read cerefox_schema_version
 *   - tableExists / functionExists: schema introspection via information_schema
 *
 * Direct PostgREST table/RPC calls only — no business logic.
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Settings } from "../config/index.js";

const ProjectRow = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
});
export type Project = z.infer<typeof ProjectRow>;

export interface CerefoxDbClient {
  raw: SupabaseClient;
  listProjects: () => Promise<Project[]>;
  rpc: <T = unknown>(fn: string, params?: Record<string, unknown>) => Promise<T | null>;
  tableExists: (name: string) => Promise<boolean>;
  functionExists: (name: string) => Promise<boolean>;
  rowCount: (table: string) => Promise<number | null>;
}

export function createClient(settings: Settings): CerefoxDbClient {
  if (!settings.supabaseUrl || !settings.supabaseKey) {
    throw new Error(
      "CEREFOX_SUPABASE_URL and CEREFOX_SUPABASE_KEY must be set in your .env file. " +
        "See docs/guides/setup-supabase.md.",
    );
  }

  const raw = createSupabaseClient(settings.supabaseUrl, settings.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const listProjects = async (): Promise<Project[]> => {
    const { data, error } = await raw
      .from("cerefox_projects")
      .select("id, name, description")
      .order("name");
    if (error) throw new Error(`listProjects failed: ${error.message}`);
    return z.array(ProjectRow).parse(data ?? []);
  };

  const rpc = async <T = unknown>(
    fn: string,
    params: Record<string, unknown> = {},
  ): Promise<T | null> => {
    const { data, error } = await raw.rpc(fn, params);
    if (error) {
      // 42883 = function does not exist; let the caller decide what to do.
      const code = (error as { code?: string }).code;
      if (code === "42883" || /does not exist/.test(error.message)) {
        return null;
      }
      throw new Error(`RPC ${fn} failed: ${error.message}`);
    }
    return data as T;
  };

  // Schema introspection via PostgREST is limited; we route through a custom
  // RPC when present, falling back to a HEAD count for `tableExists`.
  const tableExists = async (name: string): Promise<boolean> => {
    const { error } = await raw.from(name).select("*", { count: "exact", head: true });
    if (!error) return true;
    // 42P01 = relation does not exist
    const code = (error as { code?: string }).code;
    if (code === "42P01" || /does not exist/.test(error.message)) return false;
    throw new Error(`tableExists(${name}) failed: ${error.message}`);
  };

  const functionExists = async (name: string): Promise<boolean> => {
    // Routes through cerefox_pg_function_exists() — a SECURITY DEFINER helper
    // that queries pg_proc directly. We can't just call the target function
    // with empty params because PostgREST returns 42883 ("function not found
    // with this signature") even for functions that exist with required args.
    //
    // Legacy deployments may not have cerefox_pg_function_exists yet (it ships
    // in v0.3.0). In that case the helper itself returns null, and we fall
    // back to the naive empty-call probe so v0.3.0 db_status can still
    // distinguish "missing" from "exists with required args".
    const result = await rpc<boolean>("cerefox_pg_function_exists", { p_name: name });
    if (result !== null) return result;

    // Legacy fallback — best-effort.
    const naive = await rpc(name, {});
    return naive !== null;
  };

  const rowCount = async (table: string): Promise<number | null> => {
    const { count, error } = await raw
      .from(table)
      .select("*", { count: "exact", head: true });
    if (error) {
      if (/does not exist/.test(error.message)) return null;
      throw new Error(`rowCount(${table}) failed: ${error.message}`);
    }
    return count ?? 0;
  };

  return { raw, listProjects, rpc, tableExists, functionExists, rowCount };
}
