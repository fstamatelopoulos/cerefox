/**
 * Where `cerefox guides` looks for the bundled docs, in each install layout.
 * The Cerefox Local image has no `@cerefox/memory` package.json (its
 * /opt/cerefox/package.json is the embedder runtime's), and `guides list`
 * there found nothing.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findPackageRoot } from "../src/cli/util/bundled-docs.ts";

const root = mkdtempSync(join(tmpdir(), "cfx-docs-root-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function layout(name: string, pkgName: string): string {
  const dir = join(root, name);
  mkdirSync(join(dir, "dist", "bin"), { recursive: true });
  mkdirSync(join(dir, "docs", "guides"), { recursive: true });
  writeFileSync(join(dir, "dist", "bin", "cerefox.js"), "");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: pkgName }));
  return dir;
}

describe("findPackageRoot", () => {
  test("an npm install: the @cerefox/memory package directory", () => {
    const dir = layout("npm", "@cerefox/memory");
    expect(findPackageRoot(join(dir, "dist", "bin"))).toBe(dir);
  });

  test("the Cerefox Local image: the install directory, though its package.json is not ours", () => {
    const dir = layout("local", "cerefox-local-runtime");
    expect(findPackageRoot(join(dir, "dist", "bin"))).toBe(dir);
  });
});
