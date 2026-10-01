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
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { downloadModelFiles, EmbedderDownloadError, isModelCached, ONNX_MODEL_ID } from "../embeddings/onnx-embedder.ts";

const MODEL = new Uint8Array(200_000).map((_, i) => (i * 31) % 251);
const SMALL = new TextEncoder().encode('{"ok":true}');
const SEGMENT = 50_000;
const FAST = { attempts: 4, backoffMs: () => 1, segmentBytes: SEGMENT };

let server: Server;
let port = 0;
let dir: string;
let mode: "drop-once" | "no-range" | "down" | "stall-once" = "drop-once";
let dropped = false;
let modelRequests = 0;

function send(res: import("node:http").ServerResponse, body: Uint8Array, status: number, headers: Record<string, string | number>): void {
  res.writeHead(status, { "content-length": body.length, ...headers });
  res.end(body);
}

beforeAll(async () => {
  server = createServer((req, res) => {
    if (mode === "down") return void res.writeHead(503).end("unavailable");
    const path = req.url ?? "";
    if (!path.startsWith(`/${ONNX_MODEL_ID}/resolve/main/`)) return void res.writeHead(404).end();
    const file = path.endsWith(".onnx") ? MODEL : SMALL;
    if (file === MODEL) modelRequests++;
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
    send(res, body, 206, headers);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as AddressInfo).port;
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cfx-model-"));
  process.env.CEREFOX_MODELS_DIR = dir;
  mode = "drop-once";
  dropped = false;
  modelRequests = 0;
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
