# Cerefox Response Size Limits

Cerefox returns content from your knowledge base — documents can be large, and returning
too much in a single search response can overwhelm an AI agent's context window. This guide
explains how response size limits work and how to tune them.

---

## The key principle: opt-in limits, never truncate the web UI

The web UI never truncates results. It has no size limit — the browser can handle
arbitrarily large responses and there is no LLM context window to worry about.

Limits apply on the MCP, Edge Function **and CLI** paths. On MCP and the Edge Functions
they exist because an AI agent's context window matters; the CLI applies the same default
so that one setting (`CEREFOX_MAX_RESPONSE_BYTES`) governs every non-browser path, and
raises or lowers it per call with `--max-bytes`.

> **Changed in v0.10.2.** The CLI originally returned everything, like the web UI. It now
> honours `CEREFOX_MAX_RESPONSE_BYTES` (200 000 default) and prints
> `(results truncated at N bytes; use --max-bytes to raise)` when results are dropped.
> This guide described the pre-v0.10.2 behaviour until v1.14.4.

---

## How each access path handles response size

| Path | Limit behaviour |
|------|----------------|
| Web UI (`/search`) | **No limit** — all results returned |
| CLI (`cerefox search`) | Defaults to `CEREFOX_MAX_RESPONSE_BYTES` (200 000); raise or lower per call with `--max-bytes`. Announces truncation. |
| Local MCP server (`cerefox mcp`) | Defaults to `CEREFOX_MAX_RESPONSE_BYTES` (200 000); agent can request less |
| Edge Function (`cerefox-search`) | Defaults to 200 000 bytes; agent can request less via `max_bytes` body param |
| Remote MCP (`cerefox-mcp` Edge Function) | Defaults to 200 000 bytes; agent can request less via `max_bytes` tool param |

---

## How limits are applied

Truncation is always **whole-document**: a result is returned in full or not at all.
Cerefox never cuts a document mid-content.

A result that does not fit is **skipped**, not treated as the end of the list, so the
returned set is not necessarily the top N by rank: one oversized document ranked first
does not hide the smaller results behind it (v1.14.3 on the MCP tool; v1.14.4 on the
`cerefox-search` Edge Function and the CLI, which both still stopped at the first
oversized row). Anything skipped is named in the footer, so what is missing is always
visible.

When truncation occurs:
- The MCP tool appends a footer naming what was held back:
  `[3 of 12 result(s) shown; 9 did not fit max_bytes=8000: Plan › Rollout (chunk 4) [id: …] and 8 more. Raise max_bytes, narrow the query, or lower match_count.]`
- The Edge Function includes `"truncated": true` and `"response_bytes": N` in the JSON response.

**The reply as a whole stays inside the budget**, footer and warnings included:
they are measured in the same rendered bytes the caller receives (v1.14.3).
When the budget is tight the framing gives way before the results do.

**When nothing fits at all** — the smallest matching document is larger than
the whole budget — the reply is NOT "no results found", which an agent acts on
as "this knowledge does not exist". It is a header list naming what matched,
its size and its id, prefixed with a warning and the remedy. The same case on
the Edge Function sets `"degraded": true`, returns items with no content, and
reports `"matched"`: read that, not `results.length`, to know what the query
found. A reply may exceed `max_bytes` only by the framing that cannot be dropped
without misleading you: the notice that results were held back, or the
below-confidence advisory. Both are a few dozen bytes, and neither is ever
traded for content. Returning 1 of 5 results without saying so, or presenting
weak candidates as confident ones, would be worse than a small overrun.

### Metadata search follows the same rules (v1.14.4)

`cerefox_metadata_search` and the `cerefox-metadata-search` Edge Function apply
`max_bytes` only when `include_content: true`, and the budget is applied by the
database, which stops at the first document whose content does not fit. That
made two silent failures possible until v1.14.4, and both are now closed:

- **The reply is never empty when documents matched.** If the first document is
  the oversized one, the budget used to empty the result set — the MCP tool
  returned "No documents match", the Edge Function returned `[]`. Both now say
  what matched: the tool with a warning and a header list, the Edge Function by
  listing every matching document with content omitted.
- **Documents are never held back silently.** The MCP tool appends
  `[2 of 7 document(s) shown; 5 did not fit max_bytes=20000. …]`. The Edge
  Function keeps its array shape and lists **every** matching document, marking
  the ones whose content did not fit with `"content_omitted": true` — so
  `results.length` is always the true match count and only content is dropped.

`max_bytes` is resolved the same way on every path: `null`, absent, empty or
non-numeric all mean **unset** and fall back to the server ceiling, and none of
them disables the limit. A real number of zero or less means "almost no
budget" and is honoured as such — a caller whose allowance has run out is not
handed the largest possible reply.

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
Authorization: Bearer <legacy-anon-jwt>   # see docs/guides/setup-supabase.md#supabase-api-keys-2026
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
threshold (it is a SQL DEFAULT in `rpcs.sql`, changed via `cerefox server deploy`).

---

## Summary

| Question | Answer |
|----------|--------|
| Does the web UI truncate results? | No — unlimited |
| Does the CLI truncate results? | Yes — at `CEREFOX_MAX_RESPONSE_BYTES`, or `--max-bytes`. It says so when it does. |
| What is the default MCP response limit? | 200 000 bytes |
| Can an agent request a smaller limit? | Yes — `max_bytes` tool parameter |
| Can an agent exceed the server ceiling? | No — always capped |
| Where is the ceiling configured? | `.env` for local MCP; TypeScript constant in Edge Functions |
| How are limits applied? | Whole-document drop; never mid-content truncation |
| Is truncation signalled? | Yes — `truncated: true` in responses |
