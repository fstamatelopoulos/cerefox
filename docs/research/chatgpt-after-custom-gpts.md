# ChatGPT after Custom GPTs: moving Cerefox to an MCP connector

> **Status**: research and plan, 2026-10-08. Nothing here is implemented or
> validated yet. Tracking issue: [#326](https://github.com/fstamatelopoulos/cerefox/issues/326).
>
> **Deadline**: OpenAI retires Custom GPTs on **December 11, 2026**. The documented
> ChatGPT path stops working on that date.

---

## 1. What changed

On September 11, 2026 OpenAI announced that Custom GPTs are being retired in favor
of **plugins** (bundles of reusable instructions, "skills", and connected apps).

| Date | Event |
|---|---|
| 2026-09-11 | Retirement announced |
| 2026-09-22 | Migration workflow starts rolling out |
| 2026-09-25 | Creation of new Custom GPTs planned to end (timing varies by account) |
| 2026-10-26 | Enterprise workspaces stop creating new Custom GPTs |
| **2026-12-11** | **Custom GPTs retire** |
| 2027-02-11 | End of the deferral for approved Enterprise workspaces |

What OpenAI's migration carries over, and what it does not:

| Custom GPT part | After migration to a plugin |
|---|---|
| Instructions | Become a **skill** in the plugin |
| Connected apps | Added to the plugin as apps |
| **Custom actions (OpenAPI)** | **Not transferred.** Must be rebuilt "using a supported connector or custom MCP server", and OpenAI warns a rebuild "should not be assumed to provide every capability of the original action" |
| Selected model | Not transferred |
| Conversations, sharing settings, conversation starters | Not transferred |

## 2. Impact on Cerefox

Cerefox's ChatGPT integration today
([`connect-agents.md` → ChatGPT Custom GPT](../guides/connect-agents.md)) is a Custom GPT
whose **8 GPT Actions** call the primitive Edge Functions (`cerefox-search`,
`cerefox-ingest`, `cerefox-get-document`, …) with the Cerefox access token as a bearer
key. That is precisely the part that does not survive: after December 11 there is no
documented way to use Cerefox from ChatGPT.

Not affected:

- The **primitive Edge Functions** themselves. curl, scripts and any HTTP client keep using
  them; only the ChatGPT-specific OpenAPI block loses its consumer.
- **Codex**, including Codex threads inside the ChatGPT desktop app. Codex runs local stdio
  MCP servers, and `cerefox configure-agent --tool codex` writes the entry into
  `~/.codex/config.toml`. This already works.
- Every other client (Claude Code, Claude Desktop, Cursor, Gemini, claude.ai over OAuth).

## 3. Options

| Option | Verdict |
|---|---|
| **A. Custom MCP connector to `cerefox-mcp`, over OAuth** (ChatGPT Developer Mode) | **Recommended.** It reuses the OAuth 2.1 path built for claude.ai (iteration 28A), so there is no new server code expected, and ChatGPT gets the full 15-tool surface instead of 8 actions, including partial edits and delete/restore. |
| B. Same connector, no auth | Rejected. It would expose a personal knowledge base to anyone with the URL. |
| C. Static bearer token (`cfx_pat_…`) | Not possible. ChatGPT connectors support OAuth, no auth, or a mix per tool, and cannot be configured to send an API key. |
| D. Let the migration convert the GPT | Not sufficient on its own. It keeps the instructions, but the actions are dropped, so the result has no Cerefox access. |
| E. A packaged plugin around option A | Possible later. A plugin can bundle the connector with instructions (a skill). For a single user the connector alone may be enough; decide after A works. |

### Why option A should mostly just work

`cerefox-mcp` is already an OAuth 2.1 protected resource
([`docs/specs/oauth-mcp-server-design.md`](../specs/oauth-mcp-server-design.md)):

- RFC 9728 protected-resource metadata and the 401 challenge, unauthenticated, for discovery;
- the Supabase OAuth 2.1 server as the authorization server;
- a consent page (Cloudflare Worker), and the token's `sub` pinned to one owner user;
- a **pre-registered** OAuth client per client application, with
  **`client_secret_post`** as the token-endpoint auth method.

### The known risk: client registration

Cerefox **deliberately keeps Dynamic Client Registration (DCR) off** on the Supabase OAuth
server (decision of 2026-07-08 in the design doc: open DCR lets anyone register clients, and
claude.ai's DCR against Supabase was unreliable). claude.ai therefore connects with a client
registered by hand.

ChatGPT's connector flow was built around DCR (it registers a fresh client per connection),
but its form now also has an **OAuth Client ID** field (with secret), which suggests a
pre-registered client is supported. This is the first thing to confirm. If ChatGPT insists
on DCR, the choices are enabling DCR (and revisiting the reasons it was turned off) or
waiting for client ID metadata documents (CIMD), which Supabase does not yet support.

## 4. Plan

### Phase 1: docs now (no testing needed)

1. Add a **retirement notice** at the top of the Custom GPT section in `connect-agents.md`:
   working until December 11, 2026, then gone; link this document.
2. Fix the **"ChatGPT Desktop"** section, which says ChatGPT Desktop cannot run local MCP
   servers. The desktop app now hosts Codex, whose threads do run them via
   `cerefox configure-agent --tool codex`; plain ChatGPT chats do not get them.
3. Small fixes found while reviewing the current guide:
   - the token step says `cerefox token generate`, which **replaces** an existing token and
     breaks the clients using it; say "reuse your existing token (`cerefox token list`), or
     `cerefox token rotate` for a new one alongside it";
   - the Path B system prompt should tell the model to pass `author` on every call, or its
     writes are unattributed in the audit log.

### Phase 2: validate option A, on staging first

A staging environment ([`staging-env.md`](../guides/staging-env.md)) has its own Supabase
project, so the OAuth experiment cannot disturb a production claude.ai connector.

| # | Check | How |
|---|---|---|
| 1 | Developer Mode is available on the plan in use, with **write** tools | chatgpt.com → Settings; sources disagree on whether Plus gets write tools or only Pro and up |
| 2 | ChatGPT accepts a **pre-registered** client | Connector form: OAuth Client ID and secret fields |
| 3 | ChatGPT's **redirect URI** | Read it from the connector form or the failed authorize request; register it exactly (Supabase redirect URIs are exact-match) |
| 4 | ChatGPT's **token-endpoint auth method** | If it is not `client_secret_post`, the OAuth app must match it (the claude.ai failure mode was exactly this) |
| 5 | Discovery and consent | Connector reaches the Cerefox consent page; sign in as the owner; Allow; returns connected |
| 6 | **Tool surface** | 15 tools listed (19 with relations on); `cerefox_get_help` reports the server version |
| 7 | Reads | search, get document (full, outline, section), metadata search, list projects, audit log |
| 8 | Writes | ingest, insert, edit, set metadata, delete and restore, each through ChatGPT's per-call confirmation; `expected_content_hash` round trip; a deliberate stale-hash conflict |
| 9 | Attribution | Audit entries carry `author` (instruct the model to pass it) and `access_path` `remote-mcp` |
| 10 | Surfaces | Does a connector created on the web work in the desktop app and on mobile? |
| 11 | Memory | Does Developer Mode still disable ChatGPT Memory (noted in the 28A design doc)? |
| 12 | Cost | One Edge Function invocation per tool call; note it next to the claude.ai cost note |

Then repeat 2-8 on production once staging passes, registering a production ChatGPT client.

### Phase 3: docs from what actually worked

1. `connect-agents.md`: a new **"ChatGPT (web, desktop, mobile): MCP connector over OAuth"**
   section, modeled on the claude.ai one, with the exact menu path, fields and the
   registration of the ChatGPT client.
2. `setup-supabase.md` Step 7: register a **second OAuth client** for ChatGPT next to the
   Claude one (redirect URI, auth method).
3. `access-paths.md`, the client table in `CLAUDE.md`, and README mentions of ChatGPT.
4. Optionally, a short plugin recipe (option E) if Phase 2 shows it adds something for a
   single user.

### Phase 4: after December 11, 2026

1. Remove the Custom GPT section and its OpenAPI block from `connect-agents.md`.
2. Remove the `CLAUDE.md` rule "keep the GPT Actions OpenAPI block in sync with the EFs" and
   the matching `RELEASING.md` step. Edge Function request/response changes are then
   covered by the curl and API documentation only.
3. Keep the primitive Edge Functions: they remain the HTTP interface for scripts and other
   clients.

## 5. Open questions

- If ChatGPT requires DCR, is enabling it acceptable given the owner pin (only the owner can
  complete consent), or is that the wrong trade?
- Does a Developer Mode connector keep working in ordinary chats long term, or will OpenAI
  route personal integrations through plugins only?
- Is a plugin worth publishing for other Cerefox users, or does every deployment need its
  own (each points at a different `cerefox-mcp` URL, so a shared plugin cannot hardcode one)?

## 6. Sources (retrieved 2026-10-08)

- [OpenAI Help: Custom GPT retirement and migration FAQ](https://help.openai.com/articles/20001519)
- [Virtualization Review: OpenAI to retire Custom GPTs, replace them with plugins](https://virtualizationreview.com/articles/2026/09/28/openai-to-retire-custom-gpts-replace-them-with-plugins.aspx)
- [Visual Studio Magazine: the Custom GPT to plugin migration](https://visualstudiomagazine.com/articles/2026/09/28/openai-replacing-custom-gpts-with-plugins-including-for-codex-in-vs-code.aspx)
- [SiteSpeakAI: Custom GPTs retire December 11, how to migrate](https://sitespeak.ai/blog/custom-gpt-retirement-plugin-migration)
- [Mixed: what carries over to plugins](https://mixed-news.com/en/openai-retiring-custom-gpts-what-carries-over-to-plugins/)
- [Carly: ChatGPT Developer Mode, where it is and how to turn it on](https://www.usecarly.com/blog/chatgpt-developer-mode/)
- [Auth0: integrate an OAuth-secured MCP server in ChatGPT](https://auth0.com/blog/add-remote-mcp-server-chatgpt/)
- [OpenAI Community: "OAuth Client ID is no longer optional"](https://community.openai.com/t/oauth-client-id-is-no-longer-optional/1367103)
- [OpenAI Community: DCR should be optional for custom connectors](https://community.openai.com/t/dynamic-client-registration-should-be-optional-for-custom-connectors/1356365)

Third-party summaries disagree on details (plan availability of write tools, where the
Developer Mode toggle lives). Treat them as leads for Phase 2, not facts.
