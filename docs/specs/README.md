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
