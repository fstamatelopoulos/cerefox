/**
 * `cerefox embedder-warmup` — hidden utility (iter-31, Cerefox Local only).
 *
 * Forces the local ONNX embedding model (nomic-embed-text-v1.5, ~130 MB) to
 * download + materialise the inference pipeline NOW, with progress to stderr.
 * Called by `install-local.sh --local-embedder` and `cerefox-local init` when
 * the local embedder is selected, so the first search doesn't pay the
 * multi-minute download mid-query. Idempotent: a cached model loads in seconds.
 *
 * Hidden: meaningless outside the World-B container (requires the ONNX deps
 * installed and CEREFOX_EMBEDDER=local).
 */

import type { Command } from "commander";

export function registerEmbedderWarmup(program: Command): void {
  program
    .command("embedder-warmup", { hidden: true })
    .description("Download + warm the local ONNX embedding model (Cerefox Local).")
    .action(async () => {
      if (process.env.CEREFOX_EMBEDDER !== "local") {
        process.stderr.write(
          "embedder-warmup: CEREFOX_EMBEDDER is not 'local' — nothing to warm (the OpenAI embedder has no local model).\n",
        );
        process.exitCode = 1;
        return;
      }
      const onnx = await import("../../../../../_shared/embeddings/onnx-embedder.ts");
      await onnx.warmup();
      // Prove the pipeline end-to-end with one tiny inference (also surfaces a
      // broken runtime immediately rather than at first user search).
      const [vec] = await onnx.onnxEmbed(["warmup"], "query");
      process.stderr.write(`[cerefox-embed] warm — ${vec.length}-dim vectors ready.\n`);
    });
}
