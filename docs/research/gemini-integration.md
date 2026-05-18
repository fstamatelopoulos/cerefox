# Design: Gemini Integration for Cerefox

> **Status**: Research complete (2026-03-16). Gemini CLI is very likely compatible today.
> Testing needed.
>
> **Context**: Task 11.19 — Investigate Gemini MCP support and integration paths.

---

## Summary

Gemini is the most straightforward integration target we've evaluated. Gemini CLI supports
Streamable HTTP with static Bearer token headers — no `supergateway` bridge, no OAuth
discovery conflict. Configuration is a simple JSON file.

---

## 1. Gemini Surfaces and MCP Support

| Surface | MCP Support | Custom Servers | Bearer Token Headers |
|---------|------------|----------------|---------------------|
| Gemini CLI | Yes (stdio, SSE, HTTP) | Yes | Yes |
| Code Assist / VS Code | Yes (Preview) | Yes | Yes |
| Code Assist / JetBrains | No (agent mode not supported) | No | N/A |
| Gemini API / Gen AI SDK | Yes (built-in) | Yes (via SDK) | Yes |
| Google AI Studio (web) | Indirect (via SDK code) | Not via UI | N/A |
| Gemini web app (consumer) | No | No | N/A |
| Gemini Enterprise | Yes (Preview) | Yes | Yes |

---

## 2. Gemini CLI — Primary Integration Path

Gemini CLI is an open-source (Apache 2.0) terminal-based AI agent, similar to Claude Code.
Install: `npm install -g @google/gemini-cli` (Node.js 18+). Uses Gemini 2.5 Pro, free with
a personal Google account.

**Three MCP transport protocols:**

| Transport | Config key | Example |
|-----------|-----------|---------|
| stdio | `command` + `args` | Local servers |
| SSE | `url` | `"url": "https://example.com/sse/"` |
| Streamable HTTP | `httpUrl` | `"httpUrl": "https://example.com/mcp/"` |

**Cerefox config** (`~/.gemini/settings.json`):
```json
{
  "mcpServers": {
    "cerefox": {
      "httpUrl": "https://<project>.supabase.co/functions/v1/cerefox-mcp",
      "headers": {
        "Authorization": "Bearer <legacy-anon-jwt>"
      }
    }
  }
}
```

Supports environment variable interpolation (e.g., `Bearer $CEREFOX_ANON_KEY`).

Additional config options: `env`, `cwd`, `timeout`, `trust` (bypass confirmations),
`description`, `excludeTools`/`includeTools` for tool filtering.

Config locations: `~/.gemini/settings.json` (global) or `.gemini/settings.json` (project).

Can also add via CLI: `gemini mcp add --transport http --header "Authorization: Bearer <key>" cerefox https://<project>.supabase.co/functions/v1/cerefox-mcp`

---

## 3. Why Gemini Avoids the GoTrue Problem

The Supabase GoTrue OAuth discovery conflict that breaks `mcp-remote` and Perplexity's web
connector does NOT affect Gemini CLI because:

1. Static `headers` config bypasses OAuth discovery entirely
2. Gemini CLI sends the Bearer token directly — no `.well-known` probing
3. Same approach as Claude Code and Cursor (which already work)

**Known OAuth caveat**: If no auth config is specified, Gemini CLI does attempt automatic
OAuth discovery (similar to `mcp-remote`). There's also a documented bug (#5588) where it
sends `access_token` instead of `id_token` in the OIDC flow. But with static headers
configured, none of this applies.

---

## 4. Gemini Code Assist (VS Code)

MCP support is in **Preview** for VS Code agent mode. Uses the same `~/.gemini/settings.json`
config format as Gemini CLI. VS Code also supports `.vscode/mcp.json` with a `"servers"` key.
Both stdio and HTTP transports work with Bearer tokens.

JetBrains/IntelliJ: agent mode not supported, so no MCP.

---

## 5. Gemini API / Gen AI SDK

The Google Gen AI SDK (Python and JavaScript) has built-in MCP support. You can pass an MCP
`ClientSession` directly into the `tools` parameter and the SDK handles automatic tool
calling. Google's Agent Development Kit (ADK) also supports MCP natively.

This is a programmatic path — useful for building custom agents that use Cerefox, but not
an interactive chat experience like Gemini CLI.

---

## 6. Comparison with Other Clients

| Client | Transport | Auth | Bridge needed? | Status |
|--------|-----------|------|---------------|--------|
| Claude Code | Native HTTP | Static Bearer | No | Working |
| Cursor | Native HTTP | Static Bearer | No | Working |
| Claude Desktop | stdio only | Bearer via bridge | Yes (supergateway) | Working |
| ChatGPT | REST (GPT Actions) | Bearer in action config | No (not MCP) | Working |
| **Gemini CLI** | Native HTTP | Static Bearer headers | **No** | **To test** |
| **Gemini Code Assist** | HTTP via settings | Static Bearer headers | **No** | **To test** |
| Perplexity web | HTTP | OAuth discovery | N/A (broken) | Failed |
| Perplexity Desktop | stdio | Local MCP | Helper App needed | Untested |

**Key insight**: Gemini CLI is architecturally identical to Claude Code and Cursor in how it
connects to MCP servers. If those work (they do), Gemini CLI should work.

---

## 7. Testing Plan

### Test 1: Gemini CLI + Remote cerefox-mcp

1. Install Gemini CLI: `npm install -g @google/gemini-cli`
2. Add config to `~/.gemini/settings.json` (see Section 2)
3. Launch: `gemini`
4. Test search: ask Gemini to search Cerefox for something
5. Test ingest: ask Gemini to save a note to Cerefox
6. Verify: check Supabase Edge Function logs for invocations

### Test 2: Gemini CLI + Local cerefox mcp (stdio)

Config:
```json
{
  "mcpServers": {
    "cerefox-local": {
      "command": "uv",
      "args": ["run", "--directory", "/path/to/cerefox", "cerefox", "mcp"],
      "cwd": "/path/to/cerefox"
    }
  }
}
```

### Test 3: Gemini Code Assist in VS Code (if user has it)

Same config as Gemini CLI. Test in agent mode.

---

## 8. Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| OAuth discovery fires despite headers | Low | Config explicitly sets headers; should bypass |
| Streamable HTTP version mismatch | Low | Both use MCP spec 2025-03-26+ |
| Edge Function timeout on slow responses | Low | Already handled (cerefox-mcp is stateless) |
| Gemini CLI not widely adopted yet | Medium | It's free and open-source; low barrier |

---

## 9. Conclusion

Gemini is the **easiest untested integration**. No new infrastructure, no bridges, no OAuth
workarounds. The config is 7 lines of JSON. Priority: test before investing in more complex
Perplexity paths.
