#!/usr/bin/env bun
/**
 * check_ef_parity.ts — invoke the deployed `cerefox-mcp` Edge Function
 * and assert the tools/list response is structurally identical to
 * `_shared/mcp-tools/ALL_TOOLS`.
 *
 * Companion to the iter-22 refactor (22D.4). Run after deploying the
 * refactored EF to confirm no drift in tool count, names, schemas. Doesn't
 * call individual tools — for response-content parity, the e2e gauntlet
 * (`uv run pytest -m e2e`) is the empirical check.
 *
 * Usage:
 *   bun scripts/check_ef_parity.ts
 *
 * Requires CEREFOX_SUPABASE_URL and CEREFOX_SUPABASE_ANON_KEY in the
 * resolved .env.
 */

import { loadSettings } from "../_shared/config/index.ts";
import { ALL_TOOLS } from "../_shared/mcp-tools/index.ts";

const settings = loadSettings();
if (!settings.supabaseUrl) {
  console.error("❌  CEREFOX_SUPABASE_URL not set");
  process.exit(2);
}
const anonKey = process.env.CEREFOX_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
if (!anonKey) {
  console.error("❌  CEREFOX_SUPABASE_ANON_KEY not set");
  process.exit(2);
}

const url = `${settings.supabaseUrl.replace(/\/$/, "")}/functions/v1/cerefox-mcp`;

async function callMcp(method: string, params: unknown, id: number): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return await res.json();
}

console.log(`Probing ${url} …`);
await callMcp(
  "initialize",
  {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "ef-parity-check", version: "0" },
  },
  1,
);
const toolsListResponse = (await callMcp("tools/list", {}, 2)) as {
  result?: { tools?: Array<{ name: string; inputSchema?: unknown }> };
};
const remoteTools = toolsListResponse.result?.tools ?? [];

const localNames = ALL_TOOLS.map((t) => t.name).sort();
const remoteNames = remoteTools.map((t) => t.name).sort();

let ok = true;

if (JSON.stringify(localNames) !== JSON.stringify(remoteNames)) {
  console.error("❌  Tool-name set differs:");
  console.error(`   local : ${localNames.join(", ")}`);
  console.error(`   remote: ${remoteNames.join(", ")}`);
  ok = false;
}

for (const local of ALL_TOOLS) {
  const remote = remoteTools.find((t) => t.name === local.name);
  if (!remote) continue;
  if (JSON.stringify(remote.inputSchema) !== JSON.stringify(local.inputSchema)) {
    console.error(`❌  ${local.name}: inputSchema differs.`);
    ok = false;
  }
}

if (!ok) {
  console.error("");
  console.error("EF likely needs a redeploy: `npx supabase functions deploy cerefox-mcp`");
  process.exit(1);
}

console.log(`✓  EF parity OK (${localNames.length} tools, all input schemas match).`);
