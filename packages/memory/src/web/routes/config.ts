/**
 * Config endpoints (Part 24F — 2 endpoints):
 *
 *   GET /api/v1/config/{key}     — read a value from cerefox_config
 *   PUT /api/v1/config/{key}     — write a value (allowlist-validated by RPC)
 *
 * Python source: `src/cerefox/api/routes_api.py` lines 1435-1457. Both
 * endpoints delegate to the `cerefox_get_config` / `cerefox_set_config`
 * RPCs — allowlist validation lives in the RPC, not here.
 */

import { homedir } from "node:os";
import { sep } from "node:path";

import { Hono } from "hono";

import {
  CONFIG_CATALOG,
  validateConfigValue,
} from "../../../../../_shared/config-catalog/index.ts";
import { resolveEnvFile } from "../../../../../_shared/config/index.ts";
import type { WebContext } from "../context.ts";
import { resolveCallerIdentity } from "../identity.ts";
import { storeWriteRemediation } from "../../../../../_shared/mcp-tools/_utils.ts";
import { resetFeatureFlagCache } from "../../../../../_shared/mcp-tools/feature-flags.ts";

function unwrapScalarRpc(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    return typeof first === "string" ? first : null;
  }
  return null;
}

/**
 * Environment variables that override a DB config key on whatever machine
 * reads them. `cerefox_config` is the cross-cutting default; a `CEREFOX_*` var
 * is passed as an explicit RPC argument, and the RPC COALESCEs the argument
 * first — so the env var wins locally.
 *
 * The settings UI has to say this out loud. Otherwise it shows `0.5`, reports
 * success on save, and the server keeps searching at `0.7` — a page that lies
 * about the system it configures is worse than no page.
 */
/**
 * Variables that used to override these keys per machine and are no longer
 * read (v1.1.0). Reported so the UI can warn that a stale `.env` line is inert
 * — the same job `cerefox doctor` does, at the moment someone is looking at the
 * setting it refers to.
 */
const RETIRED_ENV_VARS: Record<string, string> = {
  min_search_score: "CEREFOX_MIN_SEARCH_SCORE",
  min_term_coverage: "CEREFOX_MIN_TERM_COVERAGE",
  search_alpha: "CEREFOX_SEARCH_ALPHA",
  version_retention_hours: "CEREFOX_VERSION_RETENTION_HOURS",
  version_cleanup_enabled: "CEREFOX_VERSION_CLEANUP_ENABLED",
};

export function registerConfigRoutes(app: Hono, ctx: WebContext): void {
  // List every catalog key with its stored value. The per-key GET below stays
  // for direct/API consumers; the UI needs one round trip, not seven.
  app.get("/api/v1/config", async (c) => {
    const entries = await Promise.all(
      CONFIG_CATALOG.map(async (spec) => {
        const { data, error } = await ctx.supabase.rpc("cerefox_get_config", {
          p_key: spec.key,
        });
        const stored = error ? null : unwrapScalarRpc(data);
        const envVar = RETIRED_ENV_VARS[spec.key];
        // Report the override only when it is actually set *on this server*.
        // Another machine running its own MCP server may differ, which the UI
        // says rather than pretending this is the whole picture.
        const envValue = envVar ? (process.env[envVar] ?? "").trim() : "";
        return {
          key: spec.key,
          value: stored,
          effective: stored ?? spec.defaultValue,
          description: spec.description,
          kind: spec.kind,
          default: spec.defaultValue,
          min: spec.min ?? null,
          max: spec.max ?? null,
          group: spec.group,
          high_impact: spec.highImpact ?? false,
          impact_note: spec.impactNote ?? null,
          // Two distinct facts, deliberately separate:
          //   env_var        — the retired variable that used to control this
          //                    key, if any (informational only).
          //   retired_env_set — that variable is STILL present in this server's
          //                    environment and is now inert. Worth saying out
          //                    loud: a stale line that looks applied but does
          //                    nothing is the failure mode this release fixes.
          env_var: envVar ?? null,
          retired_env_set: envValue ? { name: envVar, value: envValue } : null,
        };
      }),
    );
    // Where the operator would go to change an override. Shown so the page can
    // point at the file instead of pretending overrides are unchangeable — the
    // UI will not edit it (it holds the service-role key, the OpenAI key and
    // the database password), but the human owns that file.
    let configFile: string | null = null;
    try {
      const abs = resolveEnvFile();
      // Contract the home prefix: `~/.cerefox/.env` is still valid in a shell,
      // is shorter to read, and keeps the operator's username out of any
      // screenshot of this page. Paths outside home are shown in full.
      const home = homedir();
      configFile =
        abs === home || abs.startsWith(home + sep) ? `~${abs.slice(home.length)}` : abs;
    } catch {
      // Unresolvable config dir — the page just omits the path.
    }
    return c.json({ keys: entries, config_file: configFile });
  });

  app.get("/api/v1/config/:key", async (c) => {
    const key = c.req.param("key");
    const { data, error } = await ctx.supabase.rpc("cerefox_get_config", {
      p_key: key,
    });
    if (error) return c.json({ detail: error.message }, 500);
    return c.json({ key, value: unwrapScalarRpc(data) });
  });

  app.put("/api/v1/config/:key", async (c) => {
    const key = c.req.param("key");
    let body: { value?: unknown };
    try {
      body = (await c.req.json()) as { value?: unknown };
    } catch {
      return c.json({ detail: "Invalid JSON body" }, 400);
    }
    const value = typeof body.value === "string" ? body.value : String(body.value ?? "");
    // The RPC allow-lists the *key* but stores the value as opaque text, so
    // `min_search_score = 5` would be accepted and then silently suppress every
    // search result. Reject bad values at the boundary with a 400.
    const invalid = validateConfigValue(key, value);
    if (invalid) return c.json({ detail: invalid }, 400);

    // "web-ui" / "user" remains the default when the caller supplies no
    // identity: the same convention every other web audit site uses, so an
    // author='web-ui' filter still catches dashboard config changes. A caller
    // that names itself is recorded as itself (#226). The RPC records the
    // entry in-transaction (0.14.0).
    const who = resolveCallerIdentity(c, body as Record<string, unknown>);
    if (!who.ok) return c.json({ detail: who.detail }, 400);
    const { error } = await ctx.supabase.rpc("cerefox_set_config", {
      p_key: key,
      p_value: value,
      p_author: who.identity.author,
      p_author_type: who.identity.authorType,
    });
    if (error) {
      // One classifier shared with the CLI (round 4): deployment-state
      // failures return the guided remediation as a 503.
      const remediation = storeWriteRemediation(error.message ?? "", "cerefox_set_config");
      if (remediation) return c.json({ detail: remediation }, 503);
      return c.json({ detail: error.message }, 500);
    }
    // A feature flag flipped from the Settings page takes effect on the next
    // request of this server, not after the reader's TTL (#241).
    resetFeatureFlagCache();
    return c.json({ key, value });
  });
}
