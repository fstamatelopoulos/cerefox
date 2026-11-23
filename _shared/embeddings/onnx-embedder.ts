/**
 * Local ONNX embedder (iter-31, World B / Cerefox Local only).
 *
 * Ported from cfcf's proven `OnnxEmbedder` (packages/core/src/clio/embedders/),
 * adapted per docs/research/local-embedder-design.md:
 *   - single model, no catalog: `nomic-ai/nomic-embed-text-v1.5` q8 — 768-dim
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

import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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

/** What the q8 pipeline reads, relative to the model dir. The same files
 *  under transformers.js 3.x and 4.x, so a model cached by an older Local image
 *  is reused after the move to 4.x (#300), not downloaded again. */
const MODEL_REPO_FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  `onnx/model_quantized.onnx`,
];
const MODEL_FILES = MODEL_REPO_FILES.map((f) => join(ONNX_MODEL_ID, f));

/**
 * The content of the model revision Cerefox ships with (#367), as Hugging Face
 * publishes it for revision e9b6763 (`x-linked-etag`): the git blob SHA-1 for
 * the small files, SHA-256 for the LFS model. A cached file is checked against
 * this once, offline, then trusted through a `.verified` marker. Before 1.25.0
 * a download was never checked, and a corrupt model does not always fail to
 * load: zeroed weights load fine and quietly produce wrong vectors.
 */
const KNOWN_FILE_DIGESTS: Record<string, { algo: "sha256" | "git-sha1"; hex: string; size: number }> = {
  "config.json": { algo: "git-sha1", hex: "785a8d58b3e2c47f9709d7ac87759a6ac96a106f", size: 2538 },
  "tokenizer.json": { algo: "git-sha1", hex: "688882a79f44442ddc1f60d70334a7ff5df0fb47", size: 711396 },
  "tokenizer_config.json": { algo: "git-sha1", hex: "99ada2882080d1e1f5333a2584c433ded174795c", size: 1191 },
  "onnx/model_quantized.onnx": {
    algo: "sha256",
    hex: "b4342336debaea79de872370664b0aaeb67dea4605513d00ee236ea871a81f27",
    size: 137296292,
  },
};

/**
 * The model could not be fetched (#314). Carries a status so HTTP surfaces
 * answer 503 (try again) rather than 500, and a message that says what was
 * happening instead of the transport error underneath.
 */
export class EmbedderDownloadError extends Error {
  readonly status = 503;
  constructor(detail: string) {
    super(
      `The local embedding model (${ONNX_MODEL_NAME}, ~${ONNX_MODEL_APPROX_MB} MB) could not be downloaded: ${detail}. ` +
        "What was downloaded is kept, and the next request resumes it. Check the network and try again.",
    );
    this.name = "EmbedderDownloadError";
  }
}

/** Consecutive failed requests per file before giving up. */
const DOWNLOAD_ATTEMPTS = 6;
/** Bytes per Range request. Small enough that a failure loses little. */
const SEGMENT_BYTES = 4 * 1024 * 1024;
/**
 * Per-request limit. A connection that dies without a reset (a network that
 * disappears rather than refuses) otherwise leaves fetch waiting forever. 4 MB
 * in 2 minutes is ~35 KB/s, far below any link that could finish the model.
 */
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * One exact byte range, or an error. The length check is the point: when a
 * connection drops, Bun's fetch can silently re-issue the request and splice
 * the new response onto the old stream (observed: one fetch, two server
 * requests, the bytes of both). Trusting the stream would write a corrupt model;
 * a segment of the wrong length is retried instead.
 */
async function fetchRange(
  url: string,
  start: number,
  end: number,
  timeoutMs: number,
): Promise<{ bytes: Uint8Array; total: number } | "no-range"> {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 200) {
    await res.body?.cancel();
    return "no-range";
  }
  const total = Number(/\/(\d+)\s*$/.exec(res.headers.get("content-range") ?? "")?.[1] ?? 0);
  if (res.status === 416 && total > 0) {
    // Nothing at or past `start`: the part file already holds the whole file.
    await res.body?.cancel();
    return { bytes: new Uint8Array(0), total };
  }
  if (res.status !== 206) throw new Error(`HTTP ${res.status}`);
  if (total === 0) throw new Error("partial response without a total size (Content-Range)");
  const bytes = new Uint8Array(await res.arrayBuffer());
  const want = Math.min(end, total > 0 ? total - 1 : end) - start + 1;
  if (bytes.byteLength !== want) throw new Error(`segment ${start}-${end}: got ${bytes.byteLength} bytes, expected ${want}`);
  return { bytes, total };
}

/**
 * A download lock older than this is abandoned (its process died). The holder
 * refreshes it after every segment, and a segment is bounded by
 * REQUEST_TIMEOUT_MS plus the longest backoff, so a live holder never looks
 * this old.
 */
const LOCK_STALE_MS = 5 * 60_000;
const LOCK_POLL_MS = 1_000;

/**
 * What the host says the file is (#367): the model revision, to pin every
 * request of one download to it, and the published hash of its content.
 * Hugging Face's resolve URL answers with `x-repo-commit` and `x-linked-etag`
 * before redirecting: a SHA-256 for LFS files (the model), the git blob SHA-1
 * for small ones (the JSON). A mirror that sends neither gets no check, and
 * the download works as before.
 */
async function publishedIdentity(
  url: string,
  timeoutMs: number,
): Promise<{ commit?: string; digest?: { algo: "sha256" | "git-sha1"; hex: string } }> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    await res.body?.cancel();
    const commit = /^[0-9a-f]{40}$/.exec(res.headers.get("x-repo-commit") ?? "")?.[0];
    const tag = (res.headers.get("x-linked-etag") ?? "").replace(/^W\//, "").replace(/"/g, "").trim().toLowerCase();
    const digest = /^[0-9a-f]{64}$/.test(tag)
      ? { algo: "sha256" as const, hex: tag }
      : /^[0-9a-f]{40}$/.test(tag)
        ? { algo: "git-sha1" as const, hex: tag }
        : undefined;
    return { ...(commit ? { commit } : {}), ...(digest ? { digest } : {}) };
  } catch {
    return {};
  }
}

/** The file's hash in the form the host publishes it. */
async function fileDigest(path: string, algo: "sha256" | "git-sha1"): Promise<string> {
  const h = createHash(algo === "sha256" ? "sha256" : "sha1");
  if (algo === "git-sha1") h.update(`blob ${statSync(path).size}\0`);
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest("hex");
}

/**
 * One downloader per file at a time (#367). Two processes appending to the
 * same `.part` (an agent's MCP server and a CLI command, both first to need
 * the model) spliced their segments into a file of the right size and the
 * wrong content, which was then kept forever. `O_EXCL` makes taking the lock
 * atomic. Returns false when, while waiting, another process finished the
 * file. A lock left by a dead process goes stale and is taken over.
 */
async function acquireDownloadLock(lock: string, dest: string, staleMs: number, pollMs: number, rel: string): Promise<boolean> {
  let announced = false;
  for (;;) {
    if (existsSync(dest)) return false;
    try {
      const fd = openSync(lock, "wx");
      writeSync(fd, `${process.pid}\n`);
      closeSync(fd);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    let age: number;
    try {
      age = Date.now() - statSync(lock).mtimeMs;
    } catch {
      continue; // released between the two calls: try again
    }
    if (age > staleMs) {
      rmSync(lock, { force: true });
      continue;
    }
    if (!announced) {
      process.stderr.write(`[cerefox-embed] another process is downloading ${rel}; waiting for it…\n`);
      announced = true;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/**
 * Fetch any missing model file into the cache path transformers.js reads,
 * resumably and with retries (#314). Before this the download was one stream
 * inside transformers.js: on a slow link the connection dropped minutes in, the
 * request that triggered it failed with a raw socket error, and the next attempt
 * refetched the 131 MB from zero.
 *
 * Works in verified Range segments appended to `<file>.part`, renamed into
 * place only when the declared size is reached, so neither a partial nor a
 * spliced file is ever mistaken for the model. A host that ignores Range gets
 * one whole-file request, checked against Content-Length.
 */
export async function downloadModelFiles(
  remoteHost: string,
  onProgress: (file: string, loaded: number, total: number) => void,
  onDone: (file: string, size: number) => void,
  opts: {
    attempts?: number;
    backoffMs?: (attempt: number) => number;
    segmentBytes?: number;
    timeoutMs?: number;
    lockStaleMs?: number;
    lockPollMs?: number;
  } = {},
): Promise<void> {
  const attempts = opts.attempts ?? DOWNLOAD_ATTEMPTS;
  const backoffMs = opts.backoffMs ?? ((attempt: number) => Math.min(30, 2 ** attempt) * 1000);
  const segment = opts.segmentBytes ?? SEGMENT_BYTES;
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const lockStaleMs = opts.lockStaleMs ?? LOCK_STALE_MS;
  const lockPollMs = opts.lockPollMs ?? LOCK_POLL_MS;
  const dir = getCacheDir();
  const base = remoteHost.endsWith("/") ? remoteHost : `${remoteHost}/`;
  for (const rel of MODEL_REPO_FILES) {
    const dest = join(dir, ONNX_MODEL_ID, rel);
    if (existsSync(dest)) continue;
    mkdirSync(dirname(dest), { recursive: true });
    const part = `${dest}.part`;
    const lock = `${dest}.lock`;
    if (!(await acquireDownloadLock(lock, dest, lockStaleMs, lockPollMs, rel))) continue;
    try {
      await downloadOneFile(base, rel, dest, part, lock, { attempts, backoffMs, segment, timeoutMs }, onProgress);
    } finally {
      rmSync(lock, { force: true });
    }
    onDone(rel, statSync(dest).size);
  }
}

/** One file, under the caller's lock: resumable segments, then the checksum, then the rename. */
async function downloadOneFile(
  base: string,
  rel: string,
  dest: string,
  part: string,
  lock: string,
  o: { attempts: number; backoffMs: (attempt: number) => number; segment: number; timeoutMs: number },
  onProgress: (file: string, loaded: number, total: number) => void,
): Promise<void> {
  const { attempts, backoffMs, segment, timeoutMs } = o;
  {
    const published = await publishedIdentity(`${base}${ONNX_MODEL_ID}/resolve/main/${rel}`, timeoutMs);
    // Every segment from the same revision, so a model updated upstream
    // mid-download cannot be spliced onto the old one.
    const url = `${base}${ONNX_MODEL_ID}/resolve/${published.commit ?? "main"}/${rel}`;
    let failures = 0;
    let lastError = "";
    let total = 0;
    for (;;) {
      const have = existsSync(part) ? statSync(part).size : 0;
      if (total > 0 && have >= total) break;
      try {
        const got = await fetchRange(url, have, have + segment - 1, timeoutMs);
        if (got === "no-range") {
          // Whole file in one request; only a length-checked body is kept.
          // No segment to bound it, so a generous whole-file limit (10 KB/s).
          const res = await fetch(url, { signal: AbortSignal.timeout(Math.max(timeoutMs, ONNX_MODEL_APPROX_MB * 100_000)) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const declared = Number(res.headers.get("content-length") ?? 0);
          const bytes = new Uint8Array(await res.arrayBuffer());
          if (declared > 0 && bytes.byteLength !== declared) {
            throw new Error(`got ${bytes.byteLength} bytes, expected ${declared}`);
          }
          writeFileSync(part, bytes);
          total = bytes.byteLength;
        } else {
          total = got.total;
          if (have > total) {
            // A part file longer than the file itself is not ours to trust.
            writeFileSync(part, new Uint8Array(0));
            continue;
          }
          appendFileSync(part, got.bytes);
        }
        failures = 0;
        // The lock's heartbeat: a waiting process takes it over only once it
        // stops moving.
        const now = new Date();
        utimesSync(lock, now, now);
        onProgress(rel, statSync(part).size, total);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        failures++;
        if (failures >= attempts) throw new EmbedderDownloadError(`${rel}: ${lastError}`);
        const wait = backoffMs(failures);
        process.stderr.write(`[cerefox-embed] ${rel}: ${lastError}; retrying in ${Math.round(wait / 1000)}s (${failures}/${attempts - 1})\n`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    if (published.digest) {
      const got = await fileDigest(part, published.digest.algo);
      if (got !== published.digest.hex) {
        // Never rename a file whose content is wrong: it would be trusted
        // forever (#367). Discarded, so the next attempt starts clean.
        rmSync(part, { force: true });
        throw new EmbedderDownloadError(
          `${rel}: the downloaded content does not match the published checksum ` +
            `(${published.digest.algo} ${got.slice(0, 12)}…, expected ${published.digest.hex.slice(0, 12)}…); it was discarded`,
        );
      }
    }
    renameSync(part, dest);
    if (published.digest) markVerified(dest);
  }
}

/** `<file>.verified` records the size and mtime of a file whose content was checked. */
function markVerified(dest: string): void {
  const st = statSync(dest);
  writeFileSync(`${dest}.verified`, `${st.size} ${Math.floor(st.mtimeMs)}\n`);
}

function isMarkedVerified(dest: string): boolean {
  try {
    const st = statSync(dest);
    return readFileSync(`${dest}.verified`, "utf8").trim() === `${st.size} ${Math.floor(st.mtimeMs)}`;
  } catch {
    return false;
  }
}

/**
 * Check the cached files against the shipped revision's hashes, once (#367).
 * Returns false when one does not match, so the caller discards the cache and
 * downloads again. A file checked before (its marker still matches its size
 * and mtime) is not hashed again, so this costs one pass over the model per
 * install. A file of another size is not ours to judge (a newer revision a
 * mirror served): it is left alone.
 */
export async function verifyCachedModel(dir: string = getCacheDir()): Promise<boolean> {
  for (const rel of MODEL_REPO_FILES) {
    const dest = join(dir, ONNX_MODEL_ID, rel);
    if (!existsSync(dest) || isMarkedVerified(dest)) continue;
    const known = KNOWN_FILE_DIGESTS[rel];
    if (!known || statSync(dest).size !== known.size) continue;
    if ((await fileDigest(dest, known.algo)) !== known.hex) return false;
    markVerified(dest);
  }
  return true;
}

/**
 * Is every file the pipeline needs already on disk? Decides whether loading is
 * a download worth narrating or a local read that should stay silent: the
 * "loading from HuggingFace… first-run only" banner used to print on EVERY
 * process start, which on the CLI is every command (#301).
 */
export function isModelCached(dir: string = getCacheDir()): boolean {
  return MODEL_FILES.every((f) => existsSync(join(dir, f)));
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
  // onnxruntime 1.29+ ships Microsoft usage telemetry (a device id plus usage
  // events, queued on disk and posted to mobile.events.data.microsoft.com).
  // This is the embedder that exists so nothing leaves the machine, so opt out
  // before the native library loads. `??=`: an operator who sets it explicitly
  // (to anything) keeps their choice.
  //
  // This works under NODE, which is what an npm install runs (the bin's
  // shebang). Under BUN a process.env assignment does not reach the native
  // library: measured, a Bun process queued events despite this line, while
  // the same variable set before launch queued none. Anything that runs the
  // embedder under Bun must set it in the launching environment; the Local
  // image does so in its Dockerfile.
  process.env.ORT_DISABLE_TELEMETRY ??= "1";
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
 * ONNX Runtime's CPU memory arena is OFF (#335). The arena keeps its
 * high-water mark for the life of the process and grew with every long
 * document, so the web process never came back down: measured on synthetic
 * 20,000-character, token-dense documents, idle memory after five ingests was
 * 1.8 GB with the arena and 0.36 GB without, and peak fell from 2.05 GB to
 * 1.39 GB, at the same speed. In a container sharing a small Docker VM, that
 * retained memory is what the kernel's out-of-memory killer finds.
 */
const PIPELINE_OPTIONS = {
  dtype: ONNX_MODEL_DTYPE,
  session_options: { enableCpuMemArena: false },
};

/**
 * Download (first use) + materialise the inference pipeline, with progress to
 * stderr. Ported from cfcf including its hard-won progress-rendering fixes
 * (indeterminate totals under Bun, in-place TTY line finalisation).
 */
async function ensurePipeline(): Promise<FeaturePipeline> {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    const transformers = await loadTransformers();
    // A cached model is a local read: no banner, no per-file lines, no
    // "ready" line. The narration is for the one run that downloads.
    if (isModelCached() && !(await verifyCachedModel())) {
      discardCachedModel();
      process.stderr.write(
        "[cerefox-embed] the cached model does not match the published files (a damaged download); it was removed and will be downloaded again.\n",
      );
    }
    if (isModelCached()) {
      try {
        const pipe = await transformers.pipeline("feature-extraction", ONNX_MODEL_ID, PIPELINE_OPTIONS);
        return pipe as unknown as FeaturePipeline;
      } catch (err) {
        // A model on disk that will not load (#367: a spliced download kept
        // before 1.25.0 checked content) used to fail every search and write
        // until someone deleted it by hand, since a file that exists is never
        // fetched again. Discard it and fall through to download it once more.
        if (!isUnreadableModel(err)) throw err;
        discardCachedModel();
        process.stderr.write(
          `[cerefox-embed] the cached model could not be loaded (${errorText(err)}); it was removed and will be downloaded again.\n`,
        );
      }
    }
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
            : "size not reported";
        process.stderr.write(`[cerefox-embed] ✓ ${file}  (${finalSize})\n`);
        if (prior) progressState.set(file, { ...prior, done: true });
      }
    };

    // Our own resumable, retried fetch first (#314); transformers.js then
    // finds every file in its cache and loads locally.
    await downloadModelFiles(
      String(transformers.env.remoteHost ?? "https://huggingface.co/"),
      (file, loaded, total) => progressCallback({ status: "progress", file, loaded, total }),
      (file, size) => progressCallback({ status: "done", file, total: size }),
    );
    // Every file is on disk now, so this is a local load: no progress callback,
    // which would only report each file "done" a second time.
    let pipe: unknown;
    try {
      pipe = await transformers.pipeline("feature-extraction", ONNX_MODEL_ID, PIPELINE_OPTIONS);
    } catch (err) {
      if (!isUnreadableModel(err)) throw err;
      // Fresh files that still do not load: drop them so the next attempt
      // starts clean rather than trusting them, and say how to retry.
      discardCachedModel();
      throw new Error(
        `The local embedding model was downloaded but could not be loaded (${errorText(err)}). ` +
          "It was removed; the next request downloads it again, or run `embedder-warmup` " +
          "(Cerefox Local: `cerefox-local embedder-warmup`) with nothing else using the store.",
      );
    }
    process.stderr.write(`[cerefox-embed] embedder ready.\n`);
    return pipe as unknown as FeaturePipeline;
  })();
  // On failure, clear the memo so a later call can retry (e.g. transient network).
  pipelinePromise.catch(() => { pipelinePromise = null; });
  return pipelinePromise;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A load failure that means the files on disk are bad, not that the runtime is missing. */
function isUnreadableModel(err: unknown): boolean {
  return /protobuf|load model .*failed|failed to load model|unexpected (token|end)|json/i.test(errorText(err));
}

/** Remove every cached model file (and any half-finished part), so the next load downloads them. */
function discardCachedModel(dir: string = getCacheDir()): void {
  for (const f of MODEL_FILES) {
    rmSync(join(dir, f), { force: true });
    rmSync(join(dir, `${f}.part`), { force: true });
    rmSync(join(dir, `${f}.verified`), { force: true });
  }
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
 * Mean pooling + L2 normalization (sentence-transformers convention; nomic
 * expects both). Returns plain `number[][]` to match the OpenAI path.
 */
/**
 * Per-inference sub-batch. Peak tensor memory scales with the batch, and the
 * container shares a (often small) Docker VM with Postgres + PostgREST + the
 * web server — a 12-text single call was OOM-killed on Colima's default 2 GB
 * VM (rc.2 dogfood, exit 137).
 *
 * 1 since #335 (was 4). A batch is padded to its longest chunk and attention
 * memory grows with the square of that length, so four full-size, token-dense
 * chunks (tables, ids, code) needed more than 2.5 GB and got the web process
 * OOM-killed, while one at a time peaked at 1.4 GB. It is not slower on CPU:
 * without the padding, batch 1 ingested prose slightly FASTER (about 1.7 s vs
 * 1.9 s per 20,000-character document). Override with CEREFOX_ONNX_BATCH.
 */
const DEFAULT_ONNX_BATCH = 1;

function onnxBatchSize(): number {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env ?? {};
  const n = Number.parseInt(env.CEREFOX_ONNX_BATCH ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ONNX_BATCH;
}

export async function onnxEmbed(texts: string[], role: EmbedRole): Promise<number[][]> {
  if (texts.length === 0) return [];
  const batch = onnxBatchSize();
  if (texts.length > batch) {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += batch) {
      out.push(...(await onnxEmbed(texts.slice(i, i + batch), role)));
    }
    return out;
  }
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
