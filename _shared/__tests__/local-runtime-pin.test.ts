/**
 * The Cerefox Local image's embedder runtime (docker/local/runtime, #300).
 *
 * The runtime decides the vectors a Local store holds, so it changes only by a
 * deliberate, measured edit, never as a side effect of a rebuild or of a
 * dependency bump elsewhere. These checks hold that line without installing
 * anything: they read the committed manifests and lockfiles.
 *
 * Moving the runtime: measure first (docs/plans/iteration-54-local-transformers-4.md
 * is the worked example: embedding drift, the search benchmark on old, upgraded
 * and reindexed stores, on arm64 and x64), then edit docker/local/runtime and
 * the main package together.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..", "..");
const RUNTIME = join(REPO, "docker", "local", "runtime");

/** The version a bun.lock resolves for a top-level package entry. */
function locked(lockText: string, name: string): string | null {
  const escaped = name.replace(/[/@.]/g, (c) => `\\${c}`);
  const m = new RegExp(`^\\s*"${escaped}": \\["${escaped}@([^"]+)"`, "m").exec(lockText);
  return m ? m[1] : null;
}

const runtimePkg = JSON.parse(readFileSync(join(RUNTIME, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};
const runtimeLock = readFileSync(join(RUNTIME, "bun.lock"), "utf8");
const mainLock = readFileSync(join(REPO, "bun.lock"), "utf8");

describe("Local image embedder runtime pin (#300)", () => {
  test("every runtime dependency is an exact version", () => {
    for (const [name, range] of Object.entries(runtimePkg.dependencies)) {
      expect({ name, range }).toEqual({ name, range: expect.stringMatching(/^\d+\.\d+\.\d+$/) });
    }
  });

  test("the lockfile resolves exactly the pinned versions", () => {
    for (const [name, version] of Object.entries(runtimePkg.dependencies)) {
      expect({ name, locked: locked(runtimeLock, name) }).toEqual({ name, locked: version });
    }
  });

  test("onnxruntime-node is the copy transformers pins, so there is one copy", () => {
    const entry = new RegExp(`"@huggingface/transformers": \\["@huggingface/transformers@[^"]+", "", \\{ "dependencies": \\{[^}]*"onnxruntime-node": "([^"]+)"`).exec(runtimeLock);
    expect(entry).not.toBeNull();
    expect(runtimePkg.dependencies["onnxruntime-node"]).toBe(entry![1]);
  });

  test("the image embeds with the same runtime the main lockfile resolves", () => {
    // If this fails after a dependency bump in the main lockfile, the Local
    // image would embed differently from an npm install. Do not just copy the
    // new versions across: measure the move first (see the header).
    for (const name of ["@huggingface/transformers", "onnxruntime-node"]) {
      expect({ name, main: locked(mainLock, name) }).toEqual({ name, main: runtimePkg.dependencies[name] });
    }
  });
});
