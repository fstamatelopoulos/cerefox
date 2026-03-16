# Design: OAuth 2.1 for MCP Authentication

> **Status**: Research complete (2026-03-15). Recommendation: defer Supabase-native OAuth;
> document `mcp-remote --header` workaround now; consider Cloudflare Workers proxy if
> OAuth-only clients become important.
>
> **Context**: Task 11.17 — Investigate Supabase OAuth 2.1 for MCP authentication.

---

## 1. The Problem

Some MCP clients perform OAuth discovery before connecting to an MCP server. When they
connect to `cerefox-mcp` on `*.supabase.co`, they discover Supabase's built-in GoTrue
OAuth server at `/.well-known/oauth-authorization-server`. GoTrue is configured for
Supabase's own user management, not for our Edge Function. The client attempts dynamic
client registration against GoTrue, which fails — crashing the connection.

**Affected clients:**
- `mcp-remote` (stdio-to-HTTP bridge) — crashes at DCR
- Perplexity web connector — same GoTrue discovery conflict (confirmed by testing)
- Any future MCP client that does spec-compliant OAuth discovery

**Unaffected clients (current workarounds):**
- Claude Code — native HTTP transport, static Bearer token
- Cursor — native HTTP transport, static Bearer token
- Claude Desktop — via `supergateway` (no OAuth discovery)
- ChatGPT — via Custom GPT + GPT Actions (not MCP)

---

## 2. How MCP Authentication Works (Spec 2025-03-26+)

The MCP auth spec defines a two-layer OAuth 2.1 discovery mechanism:

```
1. Client sends unauthenticated request to MCP server
2. Server returns HTTP 401 with WWW-Authenticate header
   → contains `resource_metadata` URL
3. Client fetches Protected Resource Metadata (RFC 9728)
   → fallback: /.well-known/oauth-protected-resource/<path>
   → fallback: /.well-known/oauth-protected-resource
4. Resource metadata contains `authorization_servers` field
   → points to the OAuth Authorization Server
5. Client discovers AS metadata via /.well-known/oauth-authorization-server (RFC 8414)
6. Client registers via CIMD (preferred) or DCR (RFC 7591, optional)
7. Standard OAuth 2.1 Authorization Code + PKCE flow
```

**Key insight**: Clients are supposed to discover the AS through the *resource metadata*
first, not by probing `/.well-known/oauth-authorization-server` directly on the MCP
server's domain. However, `mcp-remote` and other clients fall back to direct probing when
resource metadata is absent — which is where GoTrue intercepts.

**MCP server requirements:**
- MUST: Implement OAuth 2.0 Protected Resource Metadata (RFC 9728)
- SHOULD: Support CIMD (Client ID Metadata Documents) — new default since Nov 2025
- MAY: Support DCR (Dynamic Client Registration) — downgraded from SHOULD to MAY

---

## 3. Supabase OAuth 2.1 Capabilities

Supabase GoTrue supports OAuth 2.1 (public beta):

| Capability | Status |
|-----------|--------|
| Authorization Code + PKCE | Supported (only grant type) |
| Dynamic Client Registration | Supported, disabled by default |
| Discovery endpoint | `/.well-known/oauth-authorization-server/auth/v1` |
| OIDC discovery | `/auth/v1/.well-known/openid-configuration` |
| Token endpoint | `/auth/v1/oauth/token` |
| Custom URI schemes (cursor://) | Fixed in auth#2298 |

**The fundamental conflict**: GoTrue owns the `/.well-known` namespace on `*.supabase.co`
domains. Custom Edge Functions cannot override or intercept these endpoints. Even if we
configure GoTrue as our OAuth provider, it's designed for Supabase user management — not
for authorizing MCP tool access.

**Supabase's own guidance**: Their "BYO MCP" documentation explicitly states: *"This guide
covers MCP servers that do not require authentication. Auth support for MCP on Edge
Functions is coming soon."* — confirming that authenticated custom MCP on Edge Functions
is not yet fully supported.

---

## 4. `mcp-remote` Behavior (Detail)

`mcp-remote` implements the full MCP OAuth discovery flow:

1. Sends unauthenticated request to the remote MCP URL
2. On 401, extracts `resource_metadata` from `WWW-Authenticate` header
3. Falls back to probing `/.well-known/oauth-protected-resource`
4. Discovers the authorization server from resource metadata
5. Attempts client registration (CIMD or DCR)
6. Runs OAuth Authorization Code + PKCE flow

**Why it fails with Supabase**: When `cerefox-mcp` returns 401 (JWT validation failure),
`mcp-remote` probes `/.well-known` on `<project>.supabase.co`. GoTrue responds, but its
OAuth server isn't configured for our Edge Function. DCR either fails (disabled) or
produces credentials that can't authorize cerefox-mcp access.

**Available workaround flags** (already in `mcp-remote`):
- `--header "Authorization: Bearer <token>"` — bypass OAuth entirely with static token
- `--static-oauth-client-metadata` — provide custom OAuth metadata
- `--static-oauth-client-info` — supply pre-registered OAuth credentials

The `--header` flag is the simplest fix — it's essentially what `supergateway` does.

---

## 5. Perplexity Status

Perplexity supports three auth methods for custom MCP connectors:
- None
- API Key (static)
- OAuth 2.0

When OAuth is selected, it performs discovery via `/.well-known/oauth-authorization-server`,
hitting the same GoTrue conflict. The API Key method should work if Perplexity sends it as
a Bearer token.

**Important update (March 2026)**: Perplexity CTO Denis Yarats announced at Ask 2026 that
Perplexity is **moving away from MCP** in favor of traditional APIs and CLIs, citing "high
context window consumption and clunky authentication." This significantly reduces the
urgency of Perplexity MCP compatibility.

---

## 6. Options Evaluated

### Option A: Configure Supabase GoTrue as MCP OAuth Provider

**What**: Enable OAuth 2.1 server in Supabase, enable DCR, build a consent UI, configure
GoTrue to authorize cerefox-mcp access.

**Pros**: Native Supabase solution, no extra infrastructure.

**Cons**:
- Beta feature with limited documentation for custom Edge Functions
- Significant complexity: consent UI, authorization flow, token scoping
- GoTrue is designed for user management, not tool authorization
- Single-user system doesn't need OAuth — we're authenticating ourselves
- Supabase's own docs say "auth for BYO MCP coming soon" — we'd be ahead of their support

**Effort**: 2–4 days. **Risk**: Medium — beta feature, complex for our use case.

**Verdict**: ❌ Disproportionate complexity for a single-user knowledge base.

### Option B: Deploy MCP Proxy on Cloudflare Workers

**What**: Deploy a thin MCP endpoint on Cloudflare Workers at a custom domain (e.g.,
`mcp.cerefox.dev`). This domain has no GoTrue. The Worker handles OAuth discovery/DCR/PKCE
using Cloudflare's OAuth Provider Library, then proxies to Supabase Edge Functions.

**Pros**:
- Purpose-built — Cloudflare has an explicit OAuth Provider Library for MCP
- Clean domain separation — no GoTrue conflict
- Works with all OAuth-discovering clients
- Can still use Supabase as the backend (the Worker calls cerefox-search/cerefox-ingest)

**Cons**:
- New infrastructure (Cloudflare account, Worker deployment)
- Another moving part to maintain
- Custom domain needed (or use `*.workers.dev`)

**Effort**: 1–2 days. **Risk**: Low — well-documented, purpose-built.

**Verdict**: ✅ Best option if OAuth-only clients become important. Not needed today.

### Option C: Document `mcp-remote --header` as Alternative to `supergateway`

**What**: Add `mcp-remote` with `--header` flag to `connect-agents.md` as an alternative
stdio-to-HTTP bridge for Claude Desktop. Both bridges bypass OAuth by passing a static
Bearer token.

**Pros**:
- Zero effort — works today with existing infrastructure
- Gives users a choice between `supergateway` and `mcp-remote`
- No new infrastructure, no OAuth complexity

**Cons**:
- Doesn't solve the OAuth discovery problem (bypasses it)
- Doesn't help OAuth-only clients (Perplexity web — if they even continue MCP support)

**Effort**: 30 minutes (documentation only). **Risk**: None.

**Verdict**: ✅ Do this now.

### Option D: Wait for Supabase "Auth for BYO MCP"

**What**: Wait for Supabase to ship authenticated custom MCP on Edge Functions.

**Pros**: Zero effort, native solution.

**Cons**: No timeline, no guarantee it solves the GoTrue conflict for custom Edge Functions.

**Effort**: None. **Risk**: High — unknown timeline.

**Verdict**: ⏳ Monitor but don't depend on it.

### Option E: Deploy cerefox-mcp on a Different Domain

**What**: Move `cerefox-mcp` off `*.supabase.co` to any domain without GoTrue. Could be
Cloudflare Workers, Vercel, Fly.io, or even a simple VPS. The endpoint calls Supabase
internally for data.

**Pros**: Eliminates GoTrue conflict entirely. Full control over `.well-known` endpoints.

**Cons**: New infrastructure. If we're going to add infra, Option B (Cloudflare with OAuth
Library) is strictly better.

**Effort**: 1–2 days. **Risk**: Low.

**Verdict**: ✅ Subsumed by Option B — if we add infra, use Cloudflare's OAuth library.

---

## 7. Recommendation

### Immediate (this session): Option C

Document `mcp-remote --header` as an alternative to `supergateway` in `connect-agents.md`.
This gives Claude Desktop users two bridge options, both bypassing OAuth. Zero effort,
immediate value.

### Near-term: Monitor

- Watch Supabase's "auth for BYO MCP" feature
- Watch Perplexity's direction (they're moving away from MCP)
- Watch `mcp-remote` evolution — newer versions may handle the GoTrue conflict differently

### Future (if needed): Option B — Cloudflare Workers

If an OAuth-only client becomes important (e.g., a major AI platform requires OAuth for
MCP), deploy a Cloudflare Worker at `mcp.cerefox.dev` using their OAuth Provider Library.
This is a 1–2 day task that cleanly separates the OAuth plane from GoTrue.

**Trigger for Option B**: A client we want to support *requires* OAuth 2.1 and cannot use
static Bearer tokens. As of 2026-03-15, no such client exists in our target set.

### Not recommended: Option A

Don't configure Supabase GoTrue as an MCP OAuth provider. It's beta, complex, designed for
user management not tool auth, and disproportionate for a single-user system.

---

## 8. Perplexity Integration Research

### Tested: Web Custom Connector — FAILED (2026-03-15)

Perplexity Pro web UI → Settings → Custom connector → Remote:
- Name: Cerefox
- URL: `https://ljdznqldchupuohjcbti.supabase.co/functions/v1/cerefox-mcp`
- Auth: API Key (anon key)
- Transport: Streamable HTTP

**Result**: Connection failed. The request never reached the `cerefox-mcp` Edge Function.
Perplexity's connector performs OAuth discovery on the Supabase domain, hits GoTrue, and
fails — same root cause as `mcp-remote`. Confirmed by checking Edge Function logs (no
invocation recorded).

### Untested: Desktop App + Helper App + Local MCP

Perplexity Desktop supports local MCP servers via the Perplexity Helper App (macOS).
This would bypass the GoTrue conflict entirely because:
- Local `cerefox mcp` runs as a stdio subprocess — no HTTP, no Supabase domain
- Helper App manages the subprocess lifecycle
- Requires: Perplexity Pro/Max subscription + Helper App installed

**Status**: Untested. This is the most promising native Perplexity integration path.

### Alternative: Sonar API with Context Injection

Query Cerefox first, inject results into Sonar's system message (128K context window).
A Python script that combines Cerefox knowledge + Perplexity web search. No native UI
integration — programmatic only.

- Sonar pricing: ~$5/1K requests + token costs
- Works today with zero Perplexity-side configuration
- Best for automated workflows, not interactive use

### Alternative: Agent API with Custom Tools

Perplexity's Agent API (GA Feb 2026) supports custom function tools alongside `web_search`.
Define `cerefox_search` as a tool → model decides when to use Cerefox vs web → you execute
the tool call against the Edge Function → send results back → model synthesizes.

- Richer than context injection (model decides when to use which source)
- Requires orchestration loop (Python script or service)
- Programmatic only, no Perplexity UI integration

### Not Viable for Cerefox

- **Spaces file uploads**: Manual, stale data, no live API connection
- **Personal Computer** ($200/mo): Way outside "cheap/free to operate" goal
- **Enterprise IKS**: Wrong tier for personal use

---

## 9. Impact on Iteration 11 Tasks

| Task | Status | Action |
|------|--------|--------|
| 11.17 — Investigate Supabase OAuth 2.1 | Researched — Deferred | This document; conclusion: defer |
| 11.18 — Perplexity integration | In Progress | Web connector tested (failed); Desktop + Helper App untested; API paths documented |
| New — Document `mcp-remote --header` | TODO | Add to connect-agents.md as alternative bridge |

---

## 10. Key Takeaways for Decision Log

1. **GoTrue owns `/.well-known` on `*.supabase.co`** — custom Edge Functions cannot override
   it. This is the root cause of all OAuth-discovering client failures.
2. **The MCP auth spec evolved** — Nov 2025 changes downgraded DCR from SHOULD to MAY, and
   introduced CIMD as the preferred registration method. The spec is still in flux.
3. **Supabase OAuth 2.1 for BYO MCP is not yet supported** — their own docs say "coming soon."
4. **Perplexity web custom connector confirmed broken** — tested with API Key auth +
   Streamable HTTP; fails at GoTrue OAuth discovery before reaching the Edge Function.
5. **Perplexity Desktop + local MCP is untested** — most promising native integration path;
   bypasses GoTrue entirely via local stdio.
6. **Perplexity is strategically moving away from MCP** (CTO, March 2026) — Sonar API and
   Agent API are the long-term programmatic alternatives.
7. **Static Bearer token auth works for all current target clients** — the OAuth problem only
   affects clients we don't currently need.
8. **Cloudflare Workers is the escape hatch** — if we ever need real OAuth, deploy there with
   their MCP OAuth Provider Library. 1–2 day task, clean separation.
9. **Claude.ai web capability is an untested assumption** — whether it can use Cerefox via
   Supabase MCP (`mcp.supabase.com`) needs verification before drawing conclusions.
