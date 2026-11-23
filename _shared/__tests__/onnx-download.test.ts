/**
 * The local model's download resumes, retries, and never keeps a corrupt file
 * (#314).
 *
 * A node:http server stands in for the model host: it can announce a length and
 * then really drop the socket mid-body, which is what a slow link to a CDN did
 * in practice (the connection dropped minutes in and the next attempt refetched
 * 131 MB from zero). Under Bun, a dropped connection can also make fetch
 * re-issue the request and splice the second body onto the first; the
 * exact-length segments are what make that harmless.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  downloadModelFiles,
  EmbedderDownloadError,
  isModelCached,
  ONNX_MODEL_ID,
  verifyCachedModel,
} from "../embeddings/onnx-embedder.ts";

const MODEL = new Uint8Array(200_000).map((_, i) => (i * 31) % 251);
const SMALL = new TextEncoder().encode('{"ok":true}');
const SEGMENT = 50_000;
const FAST = { attempts: 4, backoffMs: () => 1, segmentBytes: SEGMENT };

let server: Server;
let port = 0;
let dir: string;
let mode: "drop-once" | "no-range" | "down" | "stall-once" | "ok" = "drop-once";
/** What a HEAD on the resolve URL says (#367): nothing, the true hashes, or a wrong one. */
let ident: "none" | "good" | "bad" = "none";
/** Delay per segment, so two concurrent downloads really overlap. */
let segmentDelayMs = 0;
let dropped = false;
let modelRequests = 0;
/** The revision in each model GET's path (`main`, or the pinned commit). */
let revisions: string[] = [];
const COMMIT = "e9b6763023c676ca8431644204f50c2b100d9aab";
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const gitSha1 = (b: Uint8Array) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");

function send(res: import("node:http").ServerResponse, body: Uint8Array, status: number, headers: Record<string, string | number>): void {
  res.writeHead(status, { "content-length": body.length, ...headers });
  res.end(body);
}

beforeAll(async () => {
  server = createServer((req, res) => {
    if (mode === "down") return void res.writeHead(503).end("unavailable");
    const path = req.url ?? "";
    const route = new RegExp(`^/${ONNX_MODEL_ID}/resolve/([^/]+)/`).exec(path);
    if (!route) return void res.writeHead(404).end();
    const file = path.endsWith(".onnx") ? MODEL : SMALL;
    if (req.method === "HEAD") {
      // Hugging Face answers the resolve URL with a redirect that carries the
      // revision and the published hash: SHA-256 for LFS files, the git blob
      // SHA-1 for small ones.
      const headers: Record<string, string> = { location: `/cdn${path}` };
      if (ident !== "none") {
        headers["x-repo-commit"] = COMMIT;
        const good = file === MODEL ? sha256(file) : gitSha1(file);
        headers["x-linked-etag"] = `"${ident === "bad" && file === MODEL ? "0".repeat(64) : good}"`;
      }
      return void res.writeHead(302, headers).end();
    }
    if (file === MODEL) {
      modelRequests++;
      revisions.push(route[1]);
    }
    const m = /bytes=(\d+)-(\d+)?/.exec(req.headers.range ?? "");
    if (!m || mode === "no-range") return void send(res, file, 200, {});
    const start = Number(m[1]);
    const end = Math.min(m[2] ? Number(m[2]) : file.length - 1, file.length - 1);
    if (start >= file.length) return void res.writeHead(416, { "content-range": `bytes */${file.length}` }).end();
    const body = file.slice(start, end + 1);
    const headers = { "content-range": `bytes ${start}-${end}/${file.length}` };
    if (file === MODEL && start === SEGMENT && !dropped && mode === "stall-once") {
      // A network that disappears: half a segment, then silence, no reset.
      dropped = true;
      res.writeHead(206, { "content-length": body.length, ...headers });
      res.write(body.slice(0, body.length / 2));
      return;
    }
    if (file === MODEL && start === SEGMENT && !dropped) {
      // The second segment's first attempt: announce it, send half, drop.
      dropped = true;
      res.writeHead(206, { "content-length": body.length, ...headers });
      res.write(body.slice(0, body.length / 2), () => setTimeout(() => res.destroy(), 20));
      return;
    }
    if (segmentDelayMs > 0) return void setTimeout(() => send(res, body, 206, headers), segmentDelayMs);
    send(res, body, 206, headers);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as AddressInfo).port;
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cfx-model-"));
  process.env.CEREFOX_MODELS_DIR = dir;
  mode = "drop-once";
  ident = "none";
  segmentDelayMs = 0;
  dropped = false;
  modelRequests = 0;
  revisions = [];
});

afterAll(() => {
  server.close();
  delete process.env.CEREFOX_MODELS_DIR;
});

const host = () => `http://127.0.0.1:${port}/`;
const onnxPath = () => join(dir, ONNX_MODEL_ID, "onnx/model_quantized.onnx");

describe("model download (#314)", () => {
  test("a dropped connection costs one segment, and the file is byte-exact", async () => {
    const done: string[] = [];
    await downloadModelFiles(host(), () => {}, (f) => done.push(f), FAST);
    expect(new Uint8Array(readFileSync(onnxPath()))).toEqual(MODEL);
    expect(dropped).toBe(true);
    // 4 segments + the retried one (+ at most one silent re-issue by fetch) + the 416 that ends it.
    expect(modelRequests).toBeLessThanOrEqual(7);
    expect(existsSync(`${onnxPath()}.part`)).toBe(false);
    expect(done).toContain("onnx/model_quantized.onnx");
    expect(isModelCached(dir)).toBe(true);
  });

  test("files already on disk are not fetched again", async () => {
    await downloadModelFiles(host(), () => {}, () => {}, FAST);
    const before = modelRequests;
    await downloadModelFiles(host(), () => {}, () => {}, FAST);
    expect(modelRequests).toBe(before);
  });

  test("a connection that goes silent times out and is retried, instead of hanging", async () => {
    mode = "stall-once";
    const t0 = Date.now();
    await downloadModelFiles(host(), () => {}, () => {}, { ...FAST, timeoutMs: 300 });
    expect(dropped).toBe(true);
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(new Uint8Array(readFileSync(onnxPath()))).toEqual(MODEL);
  });

  test("a host that ignores Range still yields an exact file", async () => {
    mode = "no-range";
    await downloadModelFiles(host(), () => {}, () => {}, FAST);
    expect(new Uint8Array(readFileSync(onnxPath()))).toEqual(MODEL);
  });

  test("giving up says what failed, as a retryable error, and leaves no model behind", async () => {
    mode = "down";
    const err = await downloadModelFiles(host(), () => {}, () => {}, FAST).catch((e) => e);
    expect(err).toBeInstanceOf(EmbedderDownloadError);
    expect(err.status).toBe(503);
    expect(err.message).toContain("could not be downloaded");
    expect(err.message).toContain("HTTP 503");
    expect(isModelCached(dir)).toBe(false);
  });
});

describe("one downloader at a time, and only the published content is kept (#367)", () => {
  const LOCKING = { ...FAST, lockPollMs: 5 };

  test("two concurrent downloads produce one byte-identical file", async () => {
    // Before #367 both appended to the same .part: a file of the right size
    // and the wrong content, trusted forever after.
    mode = "ok";
    segmentDelayMs = 15;
    await Promise.all([
      downloadModelFiles(host(), () => {}, () => {}, LOCKING),
      downloadModelFiles(host(), () => {}, () => {}, LOCKING),
    ]);
    expect(new Uint8Array(readFileSync(onnxPath()))).toEqual(MODEL);
    expect(existsSync(`${onnxPath()}.lock`)).toBe(false);
    expect(existsSync(`${onnxPath()}.part`)).toBe(false);
    // One download's worth of segments, not two.
    expect(modelRequests).toBeLessThanOrEqual(Math.ceil(MODEL.length / SEGMENT) + 1);
  });

  test("a file matching its published hash is kept, and every segment comes from one revision", async () => {
    mode = "ok";
    ident = "good";
    await downloadModelFiles(host(), () => {}, () => {}, LOCKING);
    expect(new Uint8Array(readFileSync(onnxPath()))).toEqual(MODEL);
    expect(new Uint8Array(readFileSync(join(dir, ONNX_MODEL_ID, "config.json")))).toEqual(SMALL);
    expect(revisions.length).toBeGreaterThan(0);
    expect(revisions.every((r) => r === COMMIT)).toBe(true);
  });

  test("a file that does not match its published hash is discarded, never renamed into place", async () => {
    mode = "ok";
    ident = "bad";
    const err = await downloadModelFiles(host(), () => {}, () => {}, LOCKING).catch((e) => e);
    expect(err).toBeInstanceOf(EmbedderDownloadError);
    expect(err.message).toContain("does not match the published checksum");
    expect(existsSync(onnxPath())).toBe(false);
    expect(existsSync(`${onnxPath()}.part`)).toBe(false);
    expect(existsSync(`${onnxPath()}.lock`)).toBe(false);
  });

  test("a host that publishes no hash still downloads, unchecked, from main", async () => {
    mode = "ok";
    await downloadModelFiles(host(), () => {}, () => {}, LOCKING);
    expect(new Uint8Array(readFileSync(onnxPath()))).toEqual(MODEL);
    expect(revisions.every((r) => r === "main")).toBe(true);
  });

  test("a lock left by a dead process is taken over", async () => {
    mode = "ok";
    mkdirSync(dirname(onnxPath()), { recursive: true });
    writeFileSync(`${onnxPath()}.lock`, "99999\n");
    const old = new Date(Date.now() - 60_000);
    utimesSync(`${onnxPath()}.lock`, old, old);
    await downloadModelFiles(host(), () => {}, () => {}, { ...LOCKING, lockStaleMs: 1_000 });
    expect(new Uint8Array(readFileSync(onnxPath()))).toEqual(MODEL);
  });

  test("a live lock is waited on, and the file the other process finished is used", async () => {
    mode = "ok";
    // Every file but the model is already there; another process holds the
    // model's lock and finishes it shortly.
    for (const f of ["config.json", "tokenizer.json", "tokenizer_config.json"]) {
      mkdirSync(dirname(join(dir, ONNX_MODEL_ID, f)), { recursive: true });
      writeFileSync(join(dir, ONNX_MODEL_ID, f), SMALL);
    }
    mkdirSync(dirname(onnxPath()), { recursive: true });
    writeFileSync(`${onnxPath()}.lock`, "12345\n");
    setTimeout(() => {
      writeFileSync(onnxPath(), MODEL);
      rmSync(`${onnxPath()}.lock`, { force: true });
    }, 60);
    await downloadModelFiles(host(), () => {}, () => {}, LOCKING);
    expect(modelRequests).toBe(0);
    expect(new Uint8Array(readFileSync(onnxPath()))).toEqual(MODEL);
  });
});

describe("a cached model is checked once against the shipped revision (#367)", () => {
  const cfg = () => join(dir, ONNX_MODEL_ID, "tokenizer_config.json");

  test("a file of the right size and the wrong content fails the check", async () => {
    // The shape #367 left behind: exactly the expected size, other bytes.
    mkdirSync(dirname(cfg()), { recursive: true });
    writeFileSync(cfg(), "x".repeat(1191));
    expect(await verifyCachedModel(dir)).toBe(false);
  });

  test("a file checked before is trusted by its marker, not hashed again", async () => {
    mkdirSync(dirname(cfg()), { recursive: true });
    writeFileSync(cfg(), "x".repeat(1191));
    const { statSync } = await import("node:fs");
    const st = statSync(cfg());
    writeFileSync(`${cfg()}.verified`, `${st.size} ${Math.floor(st.mtimeMs)}\n`);
    expect(await verifyCachedModel(dir)).toBe(true);
  });

  test("a file of another size is left alone (another revision is not ours to judge)", async () => {
    mkdirSync(dirname(cfg()), { recursive: true });
    writeFileSync(cfg(), "{}");
    expect(await verifyCachedModel(dir)).toBe(true);
  });

  test("a verified download leaves a marker", async () => {
    mode = "ok";
    ident = "good";
    await downloadModelFiles(host(), () => {}, () => {}, { ...FAST, lockPollMs: 5 });
    expect(existsSync(`${onnxPath()}.verified`)).toBe(true);
  });
});
