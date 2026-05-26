#!/usr/bin/env bun
/**
 * check_help_bundle.ts — CI check that
 * `_shared/mcp-tools/get-help-content.ts` is in sync with
 * `AGENT_QUICK_REFERENCE.md`.
 *
 * Imports the on-disk module, then independently re-runs the bundler's
 * read-source logic and asserts the exports match what would be emitted.
 * Fails non-zero if they diverge — usually triggered when someone edited
 * `AGENT_QUICK_REFERENCE.md` but forgot to rerun `bun scripts/bundle_help.ts`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HELP_FULL,
  HELP_SECTION_HEADINGS,
  HELP_SECTIONS,
} from "../_shared/mcp-tools/get-help-content.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(REPO_ROOT, "AGENT_QUICK_REFERENCE.md");

interface Section {
  heading: string;
  body: string;
}

function parseSections(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  function flush() {
    if (currentHeading !== null) {
      sections.push({ heading: currentHeading, body: currentLines.join("\n").trim() });
    }
  }

  for (const line of lines) {
    const m = line.match(/^## (.+)/);
    if (m) {
      flush();
      currentHeading = m[1].trim();
      currentLines = [line];
    } else if (currentHeading !== null) {
      currentLines.push(line);
    }
  }
  flush();
  return sections;
}

const source = readFileSync(SOURCE, "utf8");
const expectedSections = parseSections(source);

let ok = true;

if (HELP_FULL !== source) {
  console.error("❌  HELP_FULL diverges from AGENT_QUICK_REFERENCE.md.");
  console.error(`   bundled: ${HELP_FULL.length} chars`);
  console.error(`   source:  ${source.length} chars`);
  ok = false;
}

const expectedHeadings = expectedSections.map((s) => s.heading);
if (JSON.stringify(HELP_SECTION_HEADINGS) !== JSON.stringify(expectedHeadings)) {
  console.error("❌  HELP_SECTION_HEADINGS diverges:");
  console.error(`   bundled: ${JSON.stringify(HELP_SECTION_HEADINGS)}`);
  console.error(`   source:  ${JSON.stringify(expectedHeadings)}`);
  ok = false;
}

for (const section of expectedSections) {
  const bundled = HELP_SECTIONS[section.heading];
  if (bundled !== section.body) {
    console.error(`❌  Section "${section.heading}" diverges.`);
    ok = false;
  }
}

if (!ok) {
  console.error("");
  console.error("   Rerun: bun scripts/bundle_help.ts");
  process.exit(1);
}

console.log("✓  cerefox_get_help bundle is in sync with AGENT_QUICK_REFERENCE.md");
