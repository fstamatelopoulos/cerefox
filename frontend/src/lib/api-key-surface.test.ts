/**
 * Every /api/v1 call goes through `api/client.ts`, and the page has no HTML
 * injection sink (#346).
 *
 * On a gated server the browser holds the API key (`lib/apiKey.ts`), and only
 * the client attaches it. A bare `fetch(` elsewhere, or a link or helper that
 * builds an `/api/v1` URL for the browser to navigate to, sends no key: it works
 * on every loopback install and fails only on a gated server, which is exactly
 * how it would ship unnoticed. And because the page now holds a secret, an
 * injection sink stops being a rendering bug and becomes a way to read the key,
 * so adding one has to be a deliberate change to this file.
 *
 * Scope: a text scan over `.ts`/`.tsx` under `src/` (tests excluded), comments
 * stripped first. Each rule has a fixture that must trip it, so the scan cannot
 * pass by matching nothing. Design: `docs/specs/lan-web-access.md`.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = join("api", "client.ts");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Block comments (JSX ones included) and line comments, not `://` in a URL. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const RULES: Array<{ name: string; pattern: RegExp; clientExempt: boolean; trips: string }> = [
  {
    name: "a bare fetch( outside api/client.ts",
    pattern: /(?<![\w.])fetch\(/,
    clientExempt: true,
    trips: 'const r = await fetch("/x");',
  },
  {
    name: "an /api/v1 URL literal outside api/client.ts",
    pattern: /["'`]\/api\/v1\b/,
    clientExempt: true,
    trips: "const url = `/api/v1/documents/${id}/download`;",
  },
  {
    name: "an HTML injection sink",
    pattern: /dangerouslySetInnerHTML|\binnerHTML\b|\bouterHTML\b|rehype-raw|\burlTransform\b/,
    clientExempt: false,
    trips: "<div dangerouslySetInnerHTML={{ __html: html }} />",
  },
];

describe("the API key surface", () => {
  for (const rule of RULES) {
    test(`fixture trips: ${rule.name}`, () => {
      expect(rule.pattern.test(stripComments(rule.trips))).toBe(true);
    });

    test(`no ${rule.name}`, () => {
      const offenders: string[] = [];
      for (const file of sourceFiles(SRC)) {
        const rel = relative(SRC, file);
        if (rule.clientExempt && rel === CLIENT) continue;
        const lines = stripComments(readFileSync(file, "utf8")).split("\n");
        lines.forEach((line, i) => {
          if (rule.pattern.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
      }
      expect(offenders).toEqual([]);
    });
  }

  test("comments are not offenders, URLs in strings survive stripping", () => {
    expect(stripComments("// fetch( in a comment")).not.toMatch(/fetch\(/);
    expect(stripComments("/* `/api/v1/x` */ ok")).toBe(" ok");
    expect(stripComments('const u = "https://example.com/a";')).toContain("https://example.com/a");
    // `refetch(` and `queryClient.fetchQuery(` are not bare fetches.
    expect(RULES[0].pattern.test("void query.refetch();")).toBe(false);
    expect(RULES[0].pattern.test("x.fetch(1)")).toBe(false);
  });
});
