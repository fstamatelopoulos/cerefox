/**
 * `_shared/schemas/` — zod source-of-truth for `/api/v1/*` response shapes.
 *
 * Imported by:
 *   - `packages/memory/src/web/routes/*.ts` for request/response validation
 *     (zod-parse in dev; the locked decision R7 says runtime parse on
 *     responses in `NODE_ENV !== 'production'`, skip in prod).
 *   - `frontend/src/api/*.ts` for compile-time response types
 *     (`z.infer<typeof Schema>`). Vite resolves the imports via the
 *     `@cerefox/schemas` alias in `vite.config.ts` (R3 default plan).
 *
 * The schemas mirror the Pydantic models in `src/cerefox/api/routes_api.py`
 * 1:1. When the Python models change, update here and re-run the parity
 * snapshot tests in Part 24I.
 */

export * from "./meta.js";
export * from "./discovery.js";
export * from "./projects.js";
