/**
 * Unit tests for the local ONNX embedder (iter-31) — the parts that must hold
 * WITHOUT the model/runtime installed:
 *   - nomic role prefixes (the asymmetric-model crux)
 *   - embedder selection via CEREFOX_EMBEDDER
 *   - Edge-Function safety: no top-level import of the ONNX module or its
 *     Node-only deps from _shared/embeddings/index.ts, and node-builtins-only
 *     at the top level of onnx-embedder.ts.
 *
 * Real inference (download + embed + dim check) is validated in the World-B
 * image dogfood, not here — CI must not pull a 130 MB model.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { resolveEmbedderKind } from "../embeddings/index.ts";
import {
  ONNX_MODEL_DIM,
  ONNX_MODEL_ID,
  buildPrefixedInputs,
  isModelCached,
  nomicPrefix,
} from "../embeddings/onnx-embedder.ts";

const EMBEDDINGS_DIR = join(import.meta.dir, "..", "embeddings");

describe("nomic role prefixes", () => {
  test("query role prepends search_query:", () => {
    expect(nomicPrefix("query")).toBe("search_query: ");
    expect(buildPrefixedInputs(["what did I write?"], "query")).toEqual([
      "search_query: what did I write?",
    ]);
  });

  test("document role prepends search_document:", () => {
    expect(nomicPrefix("document")).toBe("search_document: ");
    expect(buildPrefixedInputs(["# Title\nBody", "chunk 2"], "document")).toEqual([
      "search_document: # Title\nBody",
      "search_document: chunk 2",
    ]);
  });

  test("model constants match the schema contract", () => {
    expect(ONNX_MODEL_DIM).toBe(768); // vector(768) — no schema change
    expect(ONNX_MODEL_ID).toBe("nomic-ai/nomic-embed-text-v1.5");
  });
});

describe("embedder selection (CEREFOX_EMBEDDER)", () => {
  test("defaults to openai; 'local' selects the ONNX path; junk falls back", () => {
    const prev = process.env.CEREFOX_EMBEDDER;
    try {
      delete process.env.CEREFOX_EMBEDDER;
      expect(resolveEmbedderKind()).toBe("openai");
      process.env.CEREFOX_EMBEDDER = "local";
      expect(resolveEmbedderKind()).toBe("local");
      process.env.CEREFOX_EMBEDDER = "openai";
      expect(resolveEmbedderKind()).toBe("openai");
      process.env.CEREFOX_EMBEDDER = "bogus";
      expect(resolveEmbedderKind()).toBe("openai");
    } finally {
      if (prev === undefined) delete process.env.CEREFOX_EMBEDDER;
      else process.env.CEREFOX_EMBEDDER = prev;
    }
  });
});

describe("Edge Function safety (loading rules)", () => {
  test("index.ts has NO top-level import of the ONNX module or its deps", () => {
    const src = readFileSync(join(EMBEDDINGS_DIR, "index.ts"), "utf8");
    // Top-level static import lines only — dynamic `await import(...)` is the
    // sanctioned mechanism.
    const staticImports = src
      .split("\n")
      .filter((l) => /^\s*import\s/.test(l))
      .join("\n");
    expect(staticImports).not.toMatch(/onnx/i);
    expect(staticImports).not.toMatch(/@huggingface/);
    expect(staticImports).not.toMatch(/onnxruntime/);
  });

  test("onnx-embedder.ts top level imports only node builtins", () => {
    const src = readFileSync(join(EMBEDDINGS_DIR, "onnx-embedder.ts"), "utf8");
    const staticImportSpecs = [...src.matchAll(/^\s*import\s+[^"']*["']([^"']+)["']/gm)].map(
      (m) => m[1],
    );
    for (const spec of staticImportSpecs) {
      expect(spec.startsWith("node:")).toBe(true);
    }
    // The heavy dep must be loaded via a variable specifier (not a literal),
    // so no bundler statically resolves it.
    expect(src).not.toMatch(/import\(\s*["']@huggingface\/transformers["']\s*\)/);
  });
});

describe("isModelCached (#301)", () => {
  // The loading banner and per-file lines are for the run that downloads. They
  // printed on every process start, i.e. on every CLI command inside Local.
  const FILES = ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"];
  const withFiles = (files: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), "cfx-models-"));
    for (const f of files) {
      const p = join(dir, "nomic-ai", "nomic-embed-text-v1.5", f);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, "x");
    }
    return dir;
  };

  test("false for an empty cache", () => {
    const dir = withFiles([]);
    expect(isModelCached(dir)).toBe(false);
    rmSync(dir, { recursive: true });
  });

  test("false when any one file is missing (a half-finished download)", () => {
    for (const missing of FILES) {
      const dir = withFiles(FILES.filter((f) => f !== missing));
      expect({ missing, cached: isModelCached(dir) }).toEqual({ missing, cached: false });
      rmSync(dir, { recursive: true });
    }
  });

  test("true when every file the q8 pipeline reads is present", () => {
    const dir = withFiles(FILES);
    expect(isModelCached(dir)).toBe(true);
    rmSync(dir, { recursive: true });
  });
});

describe("onnxruntime telemetry opt-out", () => {
  // onnxruntime >= 1.29 posts usage telemetry. The embedder sets the opt-out
  // in-process, which reaches the native library under Node but NOT under Bun,
  // so the Bun-run Local image must set it in its environment.
  test("the embedder sets it before loading transformers", () => {
    const src = readFileSync(join(EMBEDDINGS_DIR, "onnx-embedder.ts"), "utf8");
    const set = src.indexOf('process.env.ORT_DISABLE_TELEMETRY ??= "1"');
    const load = src.indexOf("await import(spec)");
    expect(set).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(set);
  });

  test("the Local image sets it at process level", () => {
    const dockerfile = readFileSync(join(EMBEDDINGS_DIR, "..", "..", "docker", "local", "Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/^\s*ORT_DISABLE_TELEMETRY=1\b/m);
  });
});
