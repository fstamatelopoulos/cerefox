# Iteration 54: the Local image's embedder runtime moves to transformers 4.x (#300)

> Status: implemented (2026-11-14) on `feat/local-transformers-4`. Target:
> v1.23.3 (no schema change).

## Why

The Cerefox Local image ran its embedder on `@huggingface/transformers` 3.8.1
and `onnxruntime-node` 1.21.0, pinned there since the first half of #300. Two
problems followed from staying on 3.x:

- **Security.** transformers 3.8.1 requires `sharp ^0.34`, so the image shipped
  `sharp` 0.34.5 and its three HIGH advisories (GHSA-f88m-g3jw-g9cj libvips,
  GHSA-rgj7-g3m4-5g8c libheif, GHSA-wq5f-xc86-pv6w librsvg, fixed in 0.35.5),
  plus `sprintf-js` GHSA-hp3w-g68c-fv3c via onnxruntime's install script. They
  were accepted for the image in CI. `sharp` was never reachable from the
  embedder: transformers imports it at load time, so the native library was in
  the process, but only its image pipelines decode with it, and Cerefox runs
  only `feature-extraction` on text.
- **Two runtimes.** The repo's lockfile, and an npm install of
  `@cerefox/memory` today, resolve transformers 4.3.2 and onnxruntime 1.30.0, so
  the image and an npm install embedded differently. (The package declares
  `^4.3.2`, so a later npm install can resolve a newer 4.x; the test below pins
  the image to the repo's lockfile, and Dependabot no longer bumps transformers
  in a grouped PR.)

The second half of #300 was to move the image to 4.x once the effect on
existing stores was measured. This iteration does the measurement and the move.

## Changes

- `docker/local/runtime/`: transformers 4.3.2 and onnxruntime-node 1.30.0, the
  versions the main lockfile resolves; the lockfile is regenerated. `sharp`
  resolves 0.35.5 and the runtime's `bun audit` is clean.
- CI: the runtime audit step runs with no accepted advisories (four retired).
  `docs/specs/security-audit-1.0.md` has the 2026-11-14 addendum.
- `_shared/__tests__/local-runtime-pin.test.ts` (new): the runtime pins are
  exact, the lockfile resolves them, onnxruntime-node is the copy transformers
  pins, and the image's transformers and onnxruntime match the main lockfile.
  The last check fails if a dependency bump moves the main lockfile, so the
  image cannot drift from npm installs, nor move, without a deliberate edit.
  Verified to fail on a mismatched pin.
- Search floors for `nomic-embed-text-v1.5`: paraphrase 0.29 → 0.23, confident
  false positives 3 → 4, with the reason recorded in the vocabulary README. The
  entry's `schema` stamp moves from 0.18.2 to 0.22.0, where all its floors were
  measured to hold (`--check-floors` on the reindexed and upgraded stores).
- `.github/dependabot.yml` ignores `@huggingface/transformers` (as it already
  did `onnxruntime-node`), so a transformers release cannot turn a grouped
  update PR red through the pin test. `packages/memory/package.json` declares
  `onnxruntime-node ^1.30.0` (was `^1.21.0`), the version that runs.
- The Dockerfile skips onnxruntime-node's postinstall (`ONNXRUNTIME_NODE_INSTALL=skip`),
  which would fetch the CUDA provider on linux/x64; Bun already blocked it.
- Docs: CHANGELOG, `docs/guides/setup-local.md` (upgrading note), this plan,
  `docs/plan.md`.

## Measurements

All on throwaway Cerefox Local containers (the v1.23.2 image against the branch
image), with the synthetic calibration vocabulary (158 documents, 147 queries).
arm64 on a Mac; x64 on a GitHub-hosted runner (Bun does not run under qemu, so
x64 could not be emulated locally), through a temporary workflow on a throwaway
branch, deleted afterwards.

### Embedding drift (cosine between old and new vectors of the same text)

| | arm64 min | arm64 median | x64 min | x64 median |
|---|---|---|---|---|
| documents | 0.9888 | 0.9927 | 0.9872 | 0.9928 |
| queries | 0.9791 | 0.9905 | 0.9781 | 0.9913 |

Smaller than #300 measured for the earlier 4.x line (min 0.963). Vector-only
MRR@10: arm64 0.773 old, 0.782 new, 0.771 new queries over old documents; x64
0.791, 0.774, 0.789.

### Hybrid search benchmark (live formula, `search_benchmark.ts`)

Three states: **old** (the 1.23.2 image), **upgraded** (an old store moved onto
the new image in place: old document vectors, new query vectors, which is
exactly what `cerefox-local upgrade` produces), **reindexed** (a store embedded
fresh by the new runtime).

| | old | upgraded | reindexed |
|---|---|---|---|
| overall MRR, arm64 | 0.890 | 0.899 | 0.877 |
| overall MRR, x64 | 0.889 | 0.901 | 0.881 |
| hit@1, arm64 | 0.836 | 0.851 | 0.813 |
| hit@1, x64 | 0.836 | 0.851 | 0.821 |
| paraphrase, arm64 / x64 | 0.357 / 0.340 | 0.355 / 0.419 | 0.281 / 0.285 |
| confident false positives, arm64 / x64 | 3 / 3 | 3 / 4 | 3 / 4 |

Every query's ranking was reproduced exactly against the live RPC before any
number was counted (147/147 in every run). On arm64, 5 of 147 queries change
rank between old and reindexed: 2 better, 3 worse. Two of the three are
near-ties that swap (0.456 vs 0.455, 0.491 vs 0.484). The third is the
paraphrase query "pushbike protection": its answer scored 0.6013 before and
0.5986 after, so it fell under the 0.6 `min_search_score` cutoff. That one
query is the whole paraphrase drop and the floor breach.

Also checked on a copy of a real Local store, restored with its exact vectors
into a throwaway container, with known-item queries built from its documents
(a title query and a body passage per document). The upgraded state matched or
slightly beat the old runtime; a full reindex came out slightly below it and
reordered more results, the same pattern as the benchmark. (No numbers here:
the store is private.)

### Decision: no reindex needed

An upgraded store keeps its vectors and searches them with the new query
embedder. That state measured above the old runtime on overall MRR and hit@1 on
both architectures, and within noise elsewhere (arm64 paraphrase 0.357 → 0.355,
x64 confident false positives 3 → 4). New
and edited documents are embedded by the new runtime, so a store becomes a mix
over time; the mixed state is the one measured as best. A full re-embed is not
recommended: it costs a long, CPU-heavy run on a large store and measured no
better. `cerefox server reindex` without `--all` skips these chunks (the
embedder name is unchanged), which is the right default here.

### Other checks

- **Upgrade in place**: an old data volume boots on the new image (doctor all
  green), and the cached model is reused, not downloaded again (same files under
  both transformers versions).
- **Memory (#335)**: five 20,000-character ingests, web process RSS idle after:
  443 MB old, 322 MB new; ingest time the same (about 9.8 s per document,
  arm64).
- **Telemetry**: onnxruntime 1.30 ships usage telemetry. With the image's
  `ORT_DISABLE_TELEMETRY=1`, no telemetry queue
  (`~/.cache/Microsoft/DeveloperTools/.onnxruntime`) is written by the server
  process; a control run without the variable writes one, so the check can see
  it.
- **Reproducible build**: a second build of the branch image (after the
  Dockerfile change) embeds the benchmark corpus and queries bit-identically to
  the first.
- **Runtime load under Bun**: transformers 4.3.2 imports `sharp` 0.35.5 at load
  time; the embedder loads and runs under the image's Bun on arm64 and x64.

## Verification still to do

- [ ] typecheck, `_shared` and package suites, CI on the PR
- [ ] Opus review (read-only)
- [ ] after the cut: the published image's runtime versions, Mac Local upgrade,
      `doctor` in the container
