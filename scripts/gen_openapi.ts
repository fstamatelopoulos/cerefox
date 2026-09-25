#!/usr/bin/env bun
/**
 * gen_openapi.ts — CLI over `_shared/openapi/buildSpec()`.
 *
 * The builder lives in `_shared/openapi/` (it imports zod, which resolves
 * there, and the `_shared` test suite imports it). This file only does argv and
 * file IO.
 *
 * Usage:
 *   bun scripts/gen_openapi.ts            # write docs/api/openapi.json
 *   bun scripts/gen_openapi.ts --check    # exit 1 if the file is out of date
 *   bun scripts/gen_openapi.ts --stdout   # print, write nothing
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { OUT_FILE, buildSpec, specJson } from "../_shared/openapi/index.ts";

const args = process.argv.slice(2);
const spec = buildSpec();
const json = specJson(spec);

if (args.includes("--stdout")) {
  process.stdout.write(json);
} else if (args.includes("--check")) {
  if (!existsSync(OUT_FILE)) {
    console.error(`\u2717 ${OUT_FILE} does not exist. Run: bun scripts/gen_openapi.ts`);
    process.exit(1);
  }
  if (readFileSync(OUT_FILE, "utf8") !== json) {
    console.error(
      "\u2717 docs/api/openapi.json is out of date.\n" +
        "  A route, a summary in docs/guides/api.md, or a zod schema changed.\n" +
        "  Regenerate: bun scripts/gen_openapi.ts",
    );
    process.exit(1);
  }
  console.log("\u2713 docs/api/openapi.json is up to date.");
} else {
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, json);
  const cov = spec["x-cerefox-coverage"] as { routes: number; withResponseSchema: number };
  console.log(
    `\u2713 wrote docs/api/openapi.json \u2014 ${cov.routes} routes, ${cov.withResponseSchema} with a response schema.`,
  );
}
