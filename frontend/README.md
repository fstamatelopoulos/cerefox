# Cerefox Web UI (frontend)

The Cerefox web UI — a React + TypeScript single-page app (Mantine UI, TanStack
Query, Vite), served at `/app/` by the TypeScript web server (`cerefox web`).

## Develop

```bash
bun install
bun run dev        # Vite dev server with HMR (point it at a running `cerefox web` backend)
```

Use the Vite dev server for iterative UI work — a from-source `cerefox web` reads
`index.html` into memory at startup, so it serves stale hashed assets until
restarted after a rebuild.

## Build

```bash
bun run build      # tsc -b && vite build → production SPA bundle (base: /app/)
```

Installed users never build this: the bundle ships inside the `@cerefox/memory`
npm package and is served by `cerefox web`. Rebuild only when changing the
frontend from source.

## Lint & test

```bash
bun run lint       # eslint
bunx playwright install chromium
bun run test:unit  # bun test: browser-free logic (tests/unit)
bun run test:e2e   # Playwright browser tests against a local `cerefox web`
```

## Layout

- `src/pages/` — route pages (Search, Document, Ingest, Projects, Metadata
  Search, Audit Log, Analytics, Dashboard, Help, Trash).
- `src/components/` — shared UI (charts, banners, layout).
- `src/api/` — typed client for the `cerefox web` JSON API.
- `vite.config.ts` — build config (`base: /app/`).

Design history: [`docs/specs/ui-redesign-spa-python-api.md`](../docs/specs/ui-redesign-spa-python-api.md).
The serving command is documented in [`docs/guides/cli.md`](../docs/guides/cli.md) (`cerefox web`).
