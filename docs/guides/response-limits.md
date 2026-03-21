# Cerefox Response Size Limits

Cerefox returns content from your knowledge base — documents can be large, and returning
too much in a single search response can overwhelm an AI agent's context window. This guide
explains how response size limits work and how to tune them.

---

## The key principle: opt-in limits, never truncate the web UI

The web UI and CLI never truncate results. They have no size limit — the browser or terminal
can handle arbitrarily large responses and there is no LLM context window to worry about.

Limits are **opt-in per call**, used only on the MCP and Edge Function paths where an AI
agent's context window matters. Callers always choose whether to apply a limit.

---

## How each access path handles response size

| Path | Limit behaviour |
|------|----------------|
| Web UI (`/search`) | **No limit** — all results returned |
| CLI (`cerefox search`) | **No limit** — all results returned |
| Local MCP server (`cerefox mcp`) | Defaults to `CEREFOX_MAX_RESPONSE_BYTES` (200 000); agent can request less |
| Edge Function (`cerefox-search`) | Defaults to 200 000 bytes; agent can request less via `max_bytes` body param |
| Remote MCP (`cerefox-mcp` Edge Function) | Defaults to 200 000 bytes; agent can request less via `max_bytes` tool param |

---

## How limits are applied

Truncation is always **whole-document**: results are dropped in full once adding the next
document would exceed the budget. Cerefox never cuts a document mid-content.

When truncation occurs:
- The local MCP server appends `[Results truncated at N bytes — ...]` to the response text.
- The Edge Function includes `"truncated": true` and `"response_bytes": N` in the JSON response.

---

## The server ceiling — agents can request less, never more

For both the local MCP server and the `cerefox-search` Edge Function, the server-side
maximum acts as a hard ceiling. An agent can pass a smaller `max_bytes` value; a larger
value is silently capped.

```
effective_max = min(agent_requested_max, SERVER_MAX)
```

The Edge Function's `SERVER_MAX` is `200 000` bytes (hardcoded TypeScript constant).
The local MCP server's ceiling is `CEREFOX_MAX_RESPONSE_BYTES` from `.env`.

---

## Configuring the local MCP server limit

Set `CEREFOX_MAX_RESPONSE_BYTES` in `.env`:

```env
CEREFOX_MAX_RESPONSE_BYTES=200000
```

This value is used as both the **default** and the **ceiling** for the local MCP server.
Agents can pass a smaller `max_bytes` in the tool call, but never larger.

When should you lower this?
- Your MCP client (Claude Desktop, Cursor) has a small context window
- You want tighter, more focused responses at the cost of potentially seeing fewer results

When should you raise it?
- You use high `match_count` values (e.g. 20) and want all results returned
- Your documents are large and you want full content even for large-document results

---

## Passing `max_bytes` as an agent

The `cerefox_search` MCP tool accepts an optional `max_bytes` parameter in both the local
and remote MCP paths. Pass it when you want the response to fit within a specific budget:

```json
{
  "query": "knowledge management",
  "max_bytes": 50000
}
```

Values above the server ceiling are silently capped. Omitting `max_bytes` uses the server
default (200 000).

The `cerefox-search` Edge Function (Path B / GPT Actions) also accepts `max_bytes` as a
JSON body field:

```http
POST https://<project>.supabase.co/functions/v1/cerefox-search
Authorization: Bearer <anon-key>
Content-Type: application/json

{
  "query": "knowledge management",
  "max_bytes": 50000
}
```

---

## Why 200 000 bytes?

200 KB is a safe ceiling that prevents pathologically large responses (e.g. very high
`match_count` combined with many large documents) while never cutting legitimate results
at the default `match_count=5`.

**Worst-case budget at default settings:**
5 documents × 20 000 chars each (the small-to-big threshold) ≈ 100 KB — comfortably under
200 KB. In practice, most documents are shorter and the limit is rarely reached.

The original 65 KB default was driven by the Supabase MCP protocol limit, which no longer
applies (Cerefox now uses its own `cerefox-mcp` Edge Function for remote MCP access).

---

## How small-to-big retrieval complements the limit

For large documents (over 20 000 chars by default), `cerefox_search_docs` returns only the
matched chunks plus their immediate neighbours, not the full document text. This means a
single large document contributes only a few kilobytes to the response rather than tens of
kilobytes.

This **small-to-big threshold** acts as a complementary guard that keeps individual document
contributions compact. The response size limit then governs the total across all returned
documents.

See `docs/guides/configuration.md` → "RPC-level retrieval parameters" to change the
threshold (it is a SQL DEFAULT in `rpcs.sql`, changed via `db_deploy.py`).

---

## Summary

| Question | Answer |
|----------|--------|
| Does the web UI truncate results? | No — unlimited |
| Does the CLI truncate results? | No — unlimited |
| What is the default MCP response limit? | 200 000 bytes |
| Can an agent request a smaller limit? | Yes — `max_bytes` tool parameter |
| Can an agent exceed the server ceiling? | No — always capped |
| Where is the ceiling configured? | `.env` for local MCP; TypeScript constant in Edge Functions |
| How are limits applied? | Whole-document drop; never mid-content truncation |
| Is truncation signalled? | Yes — `truncated: true` in responses |
