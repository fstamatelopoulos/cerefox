# `docs/specs/` — design-of-record snapshots (historical)

These are **point-in-time design documents** — the detailed design as it stood
when a piece of work was planned. They are intentionally kept verbatim as the
architectural record and are **not updated** as the design evolves during
execution. Each file carries its own status banner.

**For the current, executed design, read [`docs/plan.md`](../plan.md)** (the
per-iteration record) and [`docs/solution-design.md`](../solution-design.md)
(the current architecture). Where a spec here conflicts with those, those win.

Current contents:

- `polish-and-distribution-design.md` — the v0.2→v1.0 "Polish & Distribution"
  arc design-of-record (aspirational snapshot, 2026-05-24). The arc has since
  shipped; plan.md is the live source of truth.
- `ui-redesign-spa-python-api.md` — the Iteration 14 web-app SPA refactor design
  (shipped). Superseded in one respect: the API backend it targeted is now Hono
  on Bun/Node, not the FastAPI named in the doc.
- `concurrency-control-design.md` — Iteration 32 design: optimistic concurrency on
  content updates (`expected_content_hash` / `last_write_wins`). Shipped in v0.11.0.
- `chunk-reconstruction-design.md` — Iteration 28D design (2026-07-09): fix the
  document-reconstruction data-corruption bug via an exact-partition chunker +
  versioned blind-stitch reconstruction (backward-compatible, lazy migration).
- `security-model.md` — **living doc** (not a point-in-time snapshot): Cerefox's access
  layers, credential scopes, the schema-0.7.0 RPC lockdown, and the OAuth surface
  invariants. Iteration 28B deliverable.
- `oauth-mcp-server-design.md` — Iteration 28A design (2026-07-08): OAuth 2.1 on
  `cerefox-mcp` via Supabase's native OAuth 2.1 Server, so claude.ai / Claude
  mobile / other cloud agents get the full MCP tool surface. Supersedes the
  2026-03 deferral in `docs/research/oauth-mcp-auth.md`.
