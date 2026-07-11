# Local embedder (fully-offline World B) — design of record

**Status: FINALIZED (2026-07-11) — implementing.** Target **v1.0.0-beta.4** (was
v0.11.0; retargeted when the release line moved to 1.0.0), branch
`feat/local-embedder-beta4` (supersedes the design-only `feat/local-embedder`).
All open decisions are frozen: single model (nomic q8 768-dim), prefixes per role
(confirmed), download-on-select, World-B only. Summary + earlier decision history
live in `docs/plan.md` Iteration 31; this is the detailed design.

**P0 implementation note (2026-07-11):** to keep every bundler honest, the
transformers import inside `onnx-embedder.ts` uses a **variable specifier**
(`const spec = "@huggingface/transformers"; await import(spec)`) so neither
`bun build` (the CLI bundle) nor supabase's eszip (the EF deploy) statically
resolves the Node-only dependency; the ONNX module itself is imported with a
normal literal dynamic import so the CLI bundle carries it. The deps are
`optionalDependencies` + `--external` in the build. Unit tests enforce both
loading rules (`_shared/__tests__/onnx-embedder.test.ts`).

## Goal & scope

Make the **local / self-hosted (World B)** deployment *truly* local: run embeddings on an
ONNX model **inside the container**, so a local install needs **no OpenAI API key and no
network** for ingest/search. **Cloud (Supabase) is unaffected** — it keeps using OpenAI
(client-side + in the Edge Functions). The local embedder is **World-B only**: cloud
embedding runs inside the `cerefox-ingest`/`cerefox-search` Edge Functions, which a
host/container-local model can't serve.

**Model (the only one we ship):** `nomic-ai/nomic-embed-text-v1.5`, dtype `q8`, **768-dim**,
~130 MB, ~8k-token context. 768 dims == Cerefox's `vector(768)` schema → **no schema
change**. (cfcf's other catalogue models are 384-dim → would need a schema change → out of
scope. Single model, no multi-model catalogue.)

We port cfcf's proven ONNX embedder (`../cfcf/packages/core/src/clio/embedders/`):
`@huggingface/transformers` (transformers.js) + `onnxruntime-node`,
`pipeline("feature-extraction", id, { dtype, pooling: "mean", normalize: true })`.

## The crux: conditional nomic prefixes in shared code

`nomic-embed-text-v1.5` is trained with **asymmetric task prefixes**: a search query is
embedded as `search_query: <text>`, a stored passage as `search_document: <text>`. OpenAI
`text-embedding-3-small` is symmetric (no prefixes). The embedding code is **shared between
cloud and local**, so prefixes must apply **only when the ONNX (nomic) embedder is active**
(which only happens in local deployments) and **never** for OpenAI.

### Role is reliably implicit in the public function (verified)

`_shared/embeddings` exposes two entry points, and an audit of **every** call site confirms
a clean invariant:

| Function | Role | Call sites (all verified) |
|---|---|---|
| `getEmbedding(text, key)` | **query** | `_shared/mcp-tools/search.ts`, `cli/util/embed.ts`, `web/routes/discovery.ts`, `cerefox-search` EF (own inline copy) |
| `embedBatch(texts, key)` | **document** | `_shared/mcp-tools/ingest.ts`, `ingestion/pipeline.ts`, `cerefox-ingest` EF (own inline copy) |

So the query/document role is **already known at the call site** — no interface change
needed. The two public functions pass the role to the embedder; the ONNX embedder prepends
the matching prefix; OpenAI ignores it.

> **Invariant to protect:** `getEmbedding` is query-only, `embedBatch` is document-only.
> The design documents this loudly and a unit test asserts the prefixes per role. If a
> future caller needs to embed a document via a single-text call (or vice versa), add an
> explicit `role` argument rather than misusing a function.

### Mechanism

```
getEmbedding(text, key)  ─┐                       ┌─ OpenAIEmbedder.embed(texts)        → no prefix (unchanged)
                          ├─ resolveEmbedder() ───┤
embedBatch(texts, key)   ─┘  (CEREFOX_EMBEDDER)    └─ OnnxEmbedder.embed(texts, role)    → prepend search_query:/search_document:
```

- `resolveEmbedder()` reads `CEREFOX_EMBEDDER` (default `openai`). For `openai` it returns
  the current OpenAI path (HTTP; `key`); for `local` it **lazily dynamic-imports** the ONNX
  module and returns the nomic embedder.
- `getEmbedding`/`embedBatch` keep their **signatures unchanged** (`key` is ignored by the
  ONNX path), so the `cerefox-mcp` EF and all other callers are untouched. They pass
  `role: "query"` / `role: "document"` internally.
- The `search_document:` prefix wraps the **already-assembled** `# {title}\n{content}`
  ingest text (the pipeline is unchanged — the prefix is added inside the embedder).

### Deno Edge Function safety (must-not-break)

`cerefox-mcp` (Deno) imports `_shared/mcp-tools` → `search.ts` → `_shared/embeddings`. So
`_shared/embeddings` **is loaded in the EF**. Therefore:

- The ONNX embedder lives in its **own module** (`_shared/embeddings/onnx-embedder.ts`) and
  is reached **only** via `await import(...)` inside `resolveEmbedder()` when
  `CEREFOX_EMBEDDER === "local"`. The cloud `cerefox-mcp` EF never sets that → never imports
  `onnxruntime-node`/transformers (Node-only). A **static** import would break the EF.
- The cloud `cerefox-search`/`cerefox-ingest` EFs have **their own inline** embedding
  functions — unaffected regardless.
- Add a test/lint check that `_shared/embeddings/index.ts` has **no top-level import** of the
  ONNX module or its deps.

## Dependencies, build, image

- `@huggingface/transformers` + `onnxruntime-node` are **`optionalDependencies`** of
  `@cerefox/memory` (cloud npm users don't install/load them).
- They are **`--external`** in the `bun build` (native `.node` binary can't be bundled);
  resolved at runtime from `node_modules`. The build script gains
  `--external onnxruntime-node --external @huggingface/transformers`.
- The **World-B image installs them** (Dockerfile `bun install` of the package incl.
  optionals, or an explicit add) so the in-container runtime can dynamic-import them. The
  cloud install path never does.
- Model weights are **downloaded on first use**, not baked into the image (keeps the image
  small; the user opted in).

## Model lifecycle

- Cache dir `CEREFOX_MODELS_DIR`, default **inside the data volume** (e.g.
  `/var/lib/postgresql/data/.cerefox-models`) so it survives `recreate`/`upgrade` (no
  re-download). transformers.js `env.cacheDir = CEREFOX_MODELS_DIR`,
  `allowLocalModels = allowRemoteModels = true`.
- **`warmup()`** (force download + materialise the pipeline) is called at install time when
  local is selected, with progress to stderr — so the first search isn't slow. Pin the HF
  revision for reproducibility/integrity.

## Selection & install UX (see plan.md Iteration 31)

The embedder choice is a **World-B-only** concern, so it surfaces **only in the local
paths** — never in the cloud `cerefox init`.

- **`cerefox init` (cloud, the npm bin) is UNCHANGED** — it sets up Supabase + the OpenAI
  key and **must not** offer or mention a local embedder (cloud embeds in the Edge
  Functions; a local model can't serve it). No `CEREFOX_EMBEDDER` prompt there.
- **`cerefox-local init` (the host shell script — a *different program* from the bin's
  `cerefox init`, handled host-side, not proxied) is where the interactive choice lives**,
  alongside the OpenAI-key prompt it already has:
  ```
  Embedder:
    [1] OpenAI  — cloud API, needs OPENAI_API_KEY (default)
    [2] Local   — fully offline, downloads ~130 MB (nomic-embed-text-v1.5), no key
  ```
  It persists `CEREFOX_EMBEDDER` into `~/.cerefox/local/.env`, forwards it into the
  container (existing passthrough), and triggers `warmup()` when local is chosen.
- **Installer** (`install-local.sh`, non-interactive `curl|sh`): opt in with
  `--local-embedder` (`… | sh -s -- --local-embedder`) or `CEREFOX_EMBEDDER=local`; it
  persists the selector + warms up. (No prompt — stdin is the piped script.)
- **Fresh-install only.** Switching embedders on existing data is breaking (different vector
  spaces). `cerefox-local init --embedder local --force` switches with loud warnings + a
  mandatory `cerefox server reindex`.

## Reindex + the mismatch guard

- `cerefox server reindex` re-embeds all chunks (the switch mechanism).
- `cerefox_chunks.embedder_primary` already records the embedder (set from the pipeline's
  `embedderModel`). The ONNX path records `nomic-embed-text-v1.5`. **Guard:** on
  boot/ingest/search, if the configured embedder ≠ the embedder recorded on existing chunks,
  **refuse/warn** ("data was embedded with X; you configured Y — run `reindex`") rather than
  silently degrading relevance. (Consider recording the model name, not just `local`.)

## Port plan (from cfcf)

| cfcf file | → Cerefox | Adaptation |
|---|---|---|
| `embedders/onnx-embedder.ts` | `_shared/embeddings/onnx-embedder.ts` | return `number[]` (not `Float32Array`); add `role` → prefix; keep lazy load + warmup + progress |
| `embedders/catalogue.ts` | inline single nomic entry (or a tiny const) | only nomic-embed-text-v1.5 (q8, 768) |
| `embedders/types.ts` (`l2Normalise`, `Embedder`) | fold into the embedder module | — |

## Phases

- **P0 — embedder abstraction + ONNX port (no UX yet).** `resolveEmbedder()` +
  `OnnxEmbedder` (lazy, prefixes per role); `getEmbedding`/`embedBatch` route through it;
  OpenAI path unchanged; EF-safety test. Unit tests: prefix-per-role, OpenAI no-prefix,
  dim=768 check. Build externals + optional deps.
- **P1 — World-B wiring.** Dockerfile installs the ONNX deps; `CEREFOX_MODELS_DIR` in the
  volume; `install-local.sh --local-embedder` persists `CEREFOX_EMBEDDER=local` + warms up;
  `cerefox-local init` interactive choice + `--force`; forward the selector on recreate.
- **P2 — safety + docs.** `embedder_primary` mismatch guard; reindex flow; setup-local +
  configuration + operational-cost (Scenario C is now *zero* cloud cost) docs; CHANGELOG.
- **P3 (roadmap).** Optional: additional 768-dim models; bake-into-image variant for
  air-gapped installs; HF revision pinning hardening.

## Risks / open
- Vector-space incompatibility across embedders → fresh-only + `--force`+reindex + the
  `embedder_primary` guard.
- Image size / CPU inference latency (acceptable at personal scale; measure on ingest).
- Build must externalize the native module correctly; verify `bun build --external` works +
  the deps resolve at runtime in the image.
- HF model availability/revision pin (the official `nomic-ai` repo, q8 variant).
