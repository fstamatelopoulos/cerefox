/**
 * Local ONNX embedder (iter-31, World B / Cerefox Local only).
 *
 * Ported from cfcf's proven `OnnxEmbedder` (packages/core/src/clio/embedders/),
 * adapted per docs/research/local-embedder-design.md:
 *   - single model, no catalogue: `nomic-ai/nomic-embed-text-v1.5` q8 — 768-dim
 *     (matches Cerefox's `vector(768)` schema; no schema change), ~130 MB.
 *   - nomic task prefixes per role: a query embeds as `search_query: <text>`,
 *     a stored chunk as `search_document: <text>` (asymmetric model).
 *   - returns `number[][]` (matches the OpenAI path's shape).
 *
 * LOADING RULES (must hold — the cerefox-mcp Edge Function imports
 * `_shared/embeddings`):
 *   - This module's top level imports ONLY node builtins — cheap + Deno-safe.
 *   - `@huggingface/transformers` (and its `onnxruntime-node` backend) load via a
 *     VARIABLE-SPECIFIER dynamic import so no bundler (bun build, supabase eszip)
 *     tries to resolve/bundle them. At runtime (Node/Bun in the World-B image)
 *     they resolve from node_modules; the cloud EF never reaches this path.
 *
 * Model cache: `CEREFOX_MODELS_DIR` (the World-B image points it inside the data
 * volume so models survive container recreate/upgrade); default `~/.cerefox/models`.
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const ONNX_MODEL_ID = "nomic-ai/nomic-embed-text-v1.5";
export const ONNX_MODEL_NAME = "nomic-embed-text-v1.5";
export const ONNX_MODEL_DTYPE = "q8";
export const ONNX_MODEL_DIM = 768;
export const ONNX_MODEL_APPROX_MB = 130;

export type EmbedRole = "query" | "document";

/**
 * Nomic's asymmetric task prefixes. Applied ONLY by this embedder — OpenAI
 * `text-embedding-3-small` is symmetric and must never see them.
 */
export function nomicPrefix(role: EmbedRole): string {
  return role === "query" ? "search_query: " : "search_document: ";
}

export function buildPrefixedInputs(texts: string[], role: EmbedRole): string[] {
  const p = nomicPrefix(role);
  return texts.map((t) => p + t);
}

function getCacheDir(): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env ?? {};
  if (env.CEREFOX_MODELS_DIR) return env.CEREFOX_MODELS_DIR;
  return join(homedir(), ".cerefox", "models");
}

// transformers.js module handle — loaded lazily, cached for the process.
// Deliberately untyped (`any`): typing it would need the package's types at
// typecheck time, but it's an optionalDependency that cloud installs may skip.
// deno-lint-ignore no-explicit-any
let transformersModule: any = null;

async function loadTransformers(): Promise<typeof transformersModule> {
  if (transformersModule) return transformersModule;
  // Variable specifier: keeps every bundler (bun build for the CLI, supabase
  // eszip for the EF) from statically resolving the ~30 MB package + native
  // onnxruntime binary. Resolved at runtime from node_modules.
  const spec = "@huggingface/transformers";
  transformersModule = await import(spec);
  const dir = getCacheDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  transformersModule.env.cacheDir = dir;
  transformersModule.env.allowLocalModels = true;
  transformersModule.env.allowRemoteModels = true;
  return transformersModule;
}

function makeBar(pct: number, width = 20): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

function l2Normalise(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum);
  if (norm === 0) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

// transformers.js `pipeline()` returns a callable; typed loosely (see above).
// deno-lint-ignore no-explicit-any
type FeaturePipeline = (texts: string[], opts?: unknown) => Promise<any>;

let pipelinePromise: Promise<FeaturePipeline> | null = null;

/**
 * Download (first use) + materialise the inference pipeline, with progress to
 * stderr. Ported from cfcf including its hard-won progress-rendering fixes
 * (indeterminate totals under Bun, in-place TTY line finalisation).
 */
async function ensurePipeline(): Promise<FeaturePipeline> {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    const transformers = await loadTransformers();
    const mb = ONNX_MODEL_APPROX_MB;
    const fmt = (s: number) => (s < 60 ? `${s}s` : `${Math.round(s / 60)}m`);
    process.stderr.write(
      `[cerefox-embed] loading "${ONNX_MODEL_NAME}" from HuggingFace (~${mb} MB; ` +
        `est. ${fmt(Math.round((mb * 8) / 50))}-${fmt(Math.round((mb * 8) / 10))} at 50-10 Mbps; first-run only)…\n`,
    );

    type FileState = {
      loaded: number; total: number; done: boolean;
      indeterminate: boolean; lastRenderAt: number; lastRenderedPct: number;
    };
    const progressState = new Map<string, FileState>();
    let activeFile: string | null = null;
    const isTty = !!process.stderr.isTTY;
    const RENDER_INTERVAL_MS = 250;
    const fmtMb = (n: number) => (n / 1024 / 1024).toFixed(1);
    const renderInPlace = (line: string): void => {
      if (isTty) process.stderr.write(`\r\x1b[K${line}`);
      else process.stderr.write(`${line}\n`);
    };
    const finalizeLine = (): void => {
      if (isTty && activeFile !== null) process.stderr.write("\n");
      activeFile = null;
    };

    const progressCallback = (info: {
      status?: string; file?: string; name?: string;
      loaded?: number; total?: number;
    }) => {
      const file = info.file ?? info.name ?? "(unknown)";
      const now = Date.now();
      if (info.status === "progress") {
        const total = info.total ?? 0;
        const loaded = info.loaded ?? 0;
        if (total === 0 && loaded === 0) return;
        const prior = progressState.get(file) ?? {
          loaded: 0, total: 0, done: false,
          indeterminate: false, lastRenderAt: 0, lastRenderedPct: -1,
        };
        // Indeterminate: total grew across events (streaming, unknown size).
        const indeterminate = prior.indeterminate || (prior.total > 0 && total > prior.total);
        const next: FileState = {
          loaded, total, done: false,
          indeterminate, lastRenderAt: prior.lastRenderAt, lastRenderedPct: prior.lastRenderedPct,
        };
        if (activeFile !== file) { finalizeLine(); activeFile = file; }
        if (indeterminate) {
          if (now - prior.lastRenderAt >= RENDER_INTERVAL_MS) {
            renderInPlace(`[cerefox-embed] [streaming...]  ${fmtMb(loaded)} MB  ${file}`);
            next.lastRenderAt = now;
          }
        } else if (total > 0) {
          const pct = Math.floor((loaded / total) * 100);
          const stepBumped = pct >= prior.lastRenderedPct + 5;
          const timeBumped = isTty && now - prior.lastRenderAt >= RENDER_INTERVAL_MS
            && pct !== prior.lastRenderedPct;
          if (stepBumped || timeBumped) {
            renderInPlace(
              `[cerefox-embed] ${makeBar(pct)} ${pct.toString().padStart(3)}%  ${fmtMb(loaded)}/${fmtMb(total)} MB  ${file}`,
            );
            next.lastRenderedPct = pct;
            next.lastRenderAt = now;
          }
        }
        progressState.set(file, next);
      } else if (info.status === "done") {
        const prior = progressState.get(file);
        finalizeLine(); // land the ✓ on its own row regardless of who owns the bar
        const finalSize = prior && prior.loaded > 0
          ? `${fmtMb(prior.loaded)} MB`
          : info.total && info.total > 0
            ? `${fmtMb(info.total)} MB`
            : "cached";
        process.stderr.write(`[cerefox-embed] ✓ ${file}  (${finalSize})\n`);
        if (prior) progressState.set(file, { ...prior, done: true });
      }
    };

    const pipe = await transformers.pipeline("feature-extraction", ONNX_MODEL_ID, {
      dtype: ONNX_MODEL_DTYPE,
      progress_callback: progressCallback,
    });
    process.stderr.write(`[cerefox-embed] embedder ready.\n`);
    return pipe as unknown as FeaturePipeline;
  })();
  // On failure, clear the memo so a later call can retry (e.g. transient network).
  pipelinePromise.catch(() => { pipelinePromise = null; });
  return pipelinePromise;
}

/**
 * Force the model download + pipeline materialisation now. Called at install
 * time when the local embedder is selected so the first search isn't slow.
 */
export async function warmup(): Promise<void> {
  await ensurePipeline();
}

/**
 * Embed texts with the local nomic model, applying the role prefix.
 * Mean pooling + L2 normalisation (sentence-transformers convention; nomic
 * expects both). Returns plain `number[][]` to match the OpenAI path.
 */
export async function onnxEmbed(texts: string[], role: EmbedRole): Promise<number[][]> {
  if (texts.length === 0) return [];
  const pipeline = await ensurePipeline();
  const inputs = buildPrefixedInputs(texts, role);
  const out = await pipeline(inputs, { pooling: "mean", normalize: true });
  // out.data: flat Float32Array (batch * dim); out.dims: [batch, dim].
  const dim: number = out.dims[out.dims.length - 1];
  if (dim !== ONNX_MODEL_DIM) {
    throw new Error(
      `OnnxEmbedder: expected dim=${ONNX_MODEL_DIM} (schema vector(768)), got ${dim} from model`,
    );
  }
  const vectors: number[][] = [];
  for (let i = 0; i < inputs.length; i++) {
    const slice: Float32Array = out.data.slice(i * dim, (i + 1) * dim);
    vectors.push(Array.from(l2Normalise(slice)));
  }
  return vectors;
}
