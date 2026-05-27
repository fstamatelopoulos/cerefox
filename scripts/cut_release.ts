#!/usr/bin/env bun
/**
 * cut_release.ts — Cerefox release-cutting script.
 *
 * The single command that takes Cerefox from "ready to release" to "released
 * and announced on GitHub". First TypeScript artifact in this repo outside
 * Edge Functions and the frontend (per the script-language policy, §12f of
 * docs/specs/polish-and-distribution-design.md).
 *
 * Usage:
 *   bun scripts/cut_release.ts 0.3.0              cut release 0.3.0
 *   bun scripts/cut_release.ts 0.3.0 --dry-run    print intended actions only
 *   bun scripts/cut_release.ts --check            report current + next bump
 *
 * Steps performed for a real run:
 *   1. Verify clean working tree, on `main`, up to date with origin.
 *   2. Verify CHANGELOG [Unreleased] section has content.
 *   3. Update VERSION to the new version.
 *   4. Sync pyproject.toml's [project] table (build-time dynamic version
 *      already reads VERSION; we update only if there is an explicit pin,
 *      which there should NOT be from v0.2.0 onward).
 *   5. Promote [Unreleased] to [vX.Y.Z] -- <today> in CHANGELOG.md and add
 *      a fresh empty [Unreleased] heading.
 *   6. Commit: "chore: cut vX.Y.Z".
 *   7. Annotated tag vX.Y.Z whose message is the extracted CHANGELOG section.
 *   8. Push commit + tag to origin (asks for confirmation unless --yes).
 *   9. Create GitHub Release via `gh release create` using the extracted
 *      CHANGELOG section as the notes file.
 *
 * Per the "force-move tags only on objective failure" rule (Cerefox Decision
 * Log, 2026-05-25), if anything needs fixing after the tag is pushed the
 * remediation is a new patch release, NOT a tag move. The only reason this
 * script ever retries is when an objective failure occurred BEFORE the GitHub
 * Release was created (e.g. push failed).
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exit } from "node:process";

// ── paths ────────────────────────────────────────────────────────────────

const REPO_ROOT = join(import.meta.dir, "..");
const VERSION_FILE = join(REPO_ROOT, "VERSION");
const CHANGELOG_FILE = join(REPO_ROOT, "CHANGELOG.md");
const PYPROJECT_FILE = join(REPO_ROOT, "pyproject.toml");

const SEMVER_RE = /^\d+\.\d+\.\d+(?:[.-][A-Za-z0-9.-]+)?$/;

// ── tiny shell helper ────────────────────────────────────────────────────

interface RunResult {
  stdout: string;
  stderr: string;
  status: number;
}

function run(cmd: string, args: string[], opts: { cwd?: string } = {}): RunResult {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? REPO_ROOT,
    encoding: "utf8",
  });
  return {
    stdout: (result.stdout ?? "").toString(),
    stderr: (result.stderr ?? "").toString(),
    status: result.status ?? -1,
  };
}

function runOrDie(cmd: string, args: string[], opts: { cwd?: string } = {}): string {
  const r = run(cmd, args, opts);
  if (r.status !== 0) {
    console.error(`✗ ${cmd} ${args.join(" ")} failed (exit ${r.status})`);
    if (r.stderr.trim()) console.error(r.stderr.trim());
    if (r.stdout.trim()) console.error(r.stdout.trim());
    exit(1);
  }
  return r.stdout.trim();
}

// ── colored output ───────────────────────────────────────────────────────

const ansi = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

function info(msg: string): void {
  console.log(`${ansi.bold("•")} ${msg}`);
}
function ok(msg: string): void {
  console.log(`${ansi.green("✓")} ${msg}`);
}
function warn(msg: string): void {
  console.warn(`${ansi.yellow("!")} ${msg}`);
}
function die(msg: string): never {
  console.error(`${ansi.red("✗")} ${msg}`);
  exit(1);
}

// ── preflight checks ─────────────────────────────────────────────────────

function readVersion(): string {
  if (!existsSync(VERSION_FILE)) die(`VERSION file not found at ${VERSION_FILE}`);
  return readFileSync(VERSION_FILE, "utf8").trim();
}

function checkCleanTree(): void {
  const status = runOrDie("git", ["status", "--porcelain"]);
  if (status) {
    die(
      "Working tree is not clean. Commit, stash, or discard changes first:\n" +
        status,
    );
  }
}

function checkBranch(): void {
  const branch = runOrDie("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== "main") {
    die(`Must be on 'main' branch, currently on '${branch}'.`);
  }
}

function checkUpToDateWithOrigin(): void {
  runOrDie("git", ["fetch", "origin", "main", "--quiet"]);
  const local = runOrDie("git", ["rev-parse", "HEAD"]);
  const remote = runOrDie("git", ["rev-parse", "origin/main"]);
  if (local !== remote) {
    die(
      `Local main is not in sync with origin/main.\n` +
        `  local : ${local}\n` +
        `  origin: ${remote}\n` +
        `Run 'git pull --ff-only' (or push your local commits) and retry.`,
    );
  }
}

function checkTagDoesNotExist(version: string): void {
  const tag = `v${version}`;
  const localTag = run("git", ["rev-parse", "--verify", `refs/tags/${tag}`]);
  if (localTag.status === 0) {
    die(`Tag ${tag} already exists locally. Per the "force-move tags only on objective failure" rule, ship a new patch version instead.`);
  }
  const remoteTag = runOrDie("git", ["ls-remote", "--tags", "origin", tag]);
  if (remoteTag) {
    die(`Tag ${tag} already exists on origin. Cut a new patch version instead.`);
  }
}

// ── CHANGELOG manipulation ───────────────────────────────────────────────

interface ChangelogParts {
  preamble: string;        // everything before [Unreleased] (incl. headers)
  unreleasedHeading: string;
  unreleasedBody: string;  // body of [Unreleased] (no heading)
  rest: string;            // everything after [Unreleased] (subsequent versions)
}

function parseChangelog(text: string): ChangelogParts {
  const unreleasedRe = /^## \[Unreleased\][^\n]*\n/m;
  const unreleasedMatch = text.match(unreleasedRe);
  if (!unreleasedMatch || unreleasedMatch.index === undefined) {
    die("CHANGELOG.md is missing a `## [Unreleased]` section.");
  }
  const unreleasedStart = unreleasedMatch.index;
  const unreleasedHeading = unreleasedMatch[0];
  const afterHeading = unreleasedStart + unreleasedHeading.length;

  const nextSectionRe = /^## \[/gm;
  nextSectionRe.lastIndex = afterHeading;
  const nextSectionMatch = nextSectionRe.exec(text);
  if (!nextSectionMatch) {
    die("CHANGELOG.md has no released sections after [Unreleased].");
  }
  const nextSectionStart = nextSectionMatch.index;

  return {
    preamble: text.slice(0, unreleasedStart),
    unreleasedHeading,
    unreleasedBody: text.slice(afterHeading, nextSectionStart),
    rest: text.slice(nextSectionStart),
  };
}

function unreleasedHasContent(body: string): boolean {
  const stripped = body
    .replace(/^---\s*$/gm, "")  // section dividers
    .trim();
  return stripped.length > 0;
}

function today(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildNewChangelog(parts: ChangelogParts, version: string): {
  newText: string;
  releaseNotes: string;
} {
  const date = today();
  const newUnreleasedSection = `## [Unreleased]\n\nOpen roadmap.\n\n---\n\n`;
  const promoted = `## [v${version}] -- ${date}\n${parts.unreleasedBody}`;
  const newText = parts.preamble + newUnreleasedSection + promoted + parts.rest;

  // Release notes shown on GitHub Release: skip the heading line, trim
  // surrounding blank lines and the trailing horizontal rule (`---`).
  const releaseNotes = parts.unreleasedBody
    .replace(/\n---\s*\n?$/, "\n")
    .trim();

  return { newText, releaseNotes };
}

// ── pyproject.toml sync ──────────────────────────────────────────────────

function checkPyprojectVersionStanza(): void {
  const text = readFileSync(PYPROJECT_FILE, "utf8");
  // From v0.2.0 onward pyproject.toml uses `dynamic = ["version"]`; if a
  // contributor pinned `version = "..."` directly the dynamic source breaks
  // silently. Refuse to proceed.
  const pinnedVersion = /^\s*version\s*=\s*"[^"]+"/m;
  if (pinnedVersion.test(text)) {
    die(
      "pyproject.toml has a static `version = \"...\"` pin. " +
        "Expected `dynamic = [\"version\"]` so the VERSION file drives all surfaces.",
    );
  }
}

// ── main ─────────────────────────────────────────────────────────────────

interface Args {
  version: string | null;
  dryRun: boolean;
  check: boolean;
  yes: boolean;
  npmPublish: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    version: null,
    dryRun: false,
    check: false,
    yes: false,
    npmPublish: false,
  };
  for (const a of argv) {
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--check") out.check = true;
    else if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--npm-publish") out.npmPublish = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage:",
          "  bun scripts/cut_release.ts <version>                       cut tag + GitHub Release",
          "  bun scripts/cut_release.ts <version> --npm-publish         + trigger npm publish workflow",
          "  bun scripts/cut_release.ts <version> --dry-run             show actions only",
          "  bun scripts/cut_release.ts --check                         report current version",
          "",
          "Flags:",
          "  --dry-run        Print every action; touch nothing.",
          "  --yes, -y        Skip the confirmation prompt before push + GitHub Release.",
          "  --npm-publish    After the tag + GitHub Release, trigger the release.yml",
          "                   workflow with publish_to_npm=true so it ships to npm.",
          "                   Default off — cut a tag without immediately publishing",
          "                   (lets you spot a problem in the staging window).",
          "  --check          Report the current VERSION; suggest the next obvious bump.",
        ].join("\n"),
      );
      exit(0);
    } else if (a.startsWith("--")) {
      die(`Unknown flag: ${a}`);
    } else {
      if (out.version) die(`Multiple version arguments: ${out.version}, ${a}`);
      out.version = a;
    }
  }
  return out;
}

function suggestNextVersion(current: string): string {
  const m = current.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return current;
  const [, major, minor, patch] = m;
  return `${major}.${minor}.${Number(patch) + 1}`;
}

async function confirm(question: string): Promise<boolean> {
  process.stdout.write(`${question} [y/N] `);
  for await (const line of console as unknown as AsyncIterable<string>) {
    return /^y(es)?$/i.test(line.trim());
  }
  return false;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // --check mode: read-only
  if (args.check) {
    const current = readVersion();
    const next = suggestNextVersion(current);
    console.log(`current : ${current}`);
    console.log(`suggested next patch: ${next}`);
    return;
  }

  if (!args.version) {
    die(
      "Missing version argument. Usage: bun scripts/cut_release.ts <version>\n" +
        "Run with --check to see the current version.",
    );
  }
  if (!SEMVER_RE.test(args.version)) {
    die(`Version '${args.version}' is not a valid semver (expected X.Y.Z or X.Y.Z-rc.N).`);
  }

  const newVersion = args.version;
  const currentVersion = readVersion();

  if (currentVersion === newVersion) {
    // First seen during the v0.2.0 dogfood cut where VERSION had been
    // pre-bumped on the feature branch (since VERSION-as-truth was itself
    // the v0.2.0 deliverable). Outside that one-off, this almost always
    // means "I forgot to bump VERSION on the release-cutting PR" — the
    // normal workflow is to leave VERSION at the LAST released value and
    // let this script bump it. Print a clarifying note rather than the
    // confusing "X.Y.Z → X.Y.Z" message.
    info(
      `Cutting release ${newVersion} — VERSION already at this value (pre-bumped). ` +
        `Normal workflow leaves VERSION at the prior release and lets this script bump it.`,
    );
  } else {
    info(`Cutting release: ${currentVersion} → ${newVersion}`);
  }
  if (args.dryRun) warn("--dry-run: no file or git changes will be made.");

  // 1. Preflight: working tree, branch, sync, tag
  info("Preflight checks…");
  if (!args.dryRun) {
    checkCleanTree();
    checkBranch();
    checkUpToDateWithOrigin();
    checkTagDoesNotExist(newVersion);
    checkPyprojectVersionStanza();
  } else {
    info("  (dry-run: skipping git state checks)");
  }
  ok("Preflight passed.");

  // 2. Parse CHANGELOG
  info("Parsing CHANGELOG.md…");
  const changelogText = readFileSync(CHANGELOG_FILE, "utf8");
  const parts = parseChangelog(changelogText);
  if (!unreleasedHasContent(parts.unreleasedBody)) {
    die(
      "[Unreleased] section in CHANGELOG.md is empty. " +
        "Add release notes before cutting.",
    );
  }
  const { newText: newChangelog, releaseNotes } = buildNewChangelog(
    parts,
    newVersion,
  );
  ok("CHANGELOG sections parsed; [Unreleased] has content.");

  // 3. Mutate files
  if (args.dryRun) {
    info("DRY-RUN: would write VERSION:");
    console.log(ansi.dim(`  ${newVersion}`));
    info("DRY-RUN: would rewrite CHANGELOG.md (preview of release notes):");
    console.log(
      ansi.dim(releaseNotes.split("\n").map((l) => "  " + l).join("\n")),
    );
  } else {
    writeFileSync(VERSION_FILE, `${newVersion}\n`, "utf8");
    ok(`Wrote VERSION = ${newVersion}`);
    writeFileSync(CHANGELOG_FILE, newChangelog, "utf8");
    ok("Updated CHANGELOG.md.");
  }

  // 4. Git commit + tag
  const tag = `v${newVersion}`;
  const commitMessage = `chore: cut ${tag}`;

  if (args.dryRun) {
    info(`DRY-RUN: would 'git add VERSION CHANGELOG.md'`);
    info(`DRY-RUN: would commit: ${commitMessage}`);
    info(`DRY-RUN: would create annotated tag ${tag} with CHANGELOG section as body`);
  } else {
    runOrDie("git", ["add", "VERSION", "CHANGELOG.md"]);
    runOrDie("git", ["commit", "-m", commitMessage]);
    ok(`Committed: ${commitMessage}`);

    // Write tag message to a temp file so we don't need to escape it.
    const tmpTagFile = join(REPO_ROOT, `.tag-message-${tag}.tmp`);
    writeFileSync(tmpTagFile, `${tag}\n\n${releaseNotes}\n`, "utf8");
    try {
      runOrDie("git", ["tag", "-a", tag, "-F", tmpTagFile]);
      ok(`Created annotated tag ${tag}.`);
    } finally {
      run("rm", ["-f", tmpTagFile]);
    }
  }

  // 5. Push + GitHub Release
  if (!args.dryRun && !args.yes) {
    console.log("");
    info(`About to push commit and tag ${tag} to origin and create a GitHub Release.`);
    info(
      `Per the "force-move tags only on objective failure" rule, fixes after this point ship as a NEW patch version.`,
    );
    const yes = await confirm("Proceed?");
    if (!yes) {
      warn("Aborted. The commit and tag remain LOCAL; nothing pushed yet.");
      warn(`To finish manually:  git push origin main && git push origin ${tag} && gh release create ${tag} --notes-file <FILE>`);
      warn(`To abandon entirely: git reset --hard HEAD~1 && git tag -d ${tag}`);
      return;
    }
  }

  if (args.dryRun) {
    info(`DRY-RUN: would 'git push origin main'`);
    info(`DRY-RUN: would 'git push origin ${tag}'`);
    info(`DRY-RUN: would 'gh release create ${tag} --title ${tag} --notes-file <release-notes>'`);
    if (args.npmPublish) {
      info(`DRY-RUN: would 'gh workflow run release.yml -f tag=${tag} -f publish_to_npm=true'`);
    } else {
      info("DRY-RUN: --npm-publish not set; tag-only cut. npm publish is a separate manual step.");
    }
    ok("DRY-RUN complete.");
    return;
  }

  info("Pushing main and tag to origin…");
  runOrDie("git", ["push", "origin", "main"]);
  runOrDie("git", ["push", "origin", tag]);
  ok(`Pushed ${tag} to origin.`);

  info("Creating GitHub Release…");
  const tmpNotesFile = join(REPO_ROOT, `.release-notes-${tag}.tmp`);
  writeFileSync(tmpNotesFile, releaseNotes + "\n", "utf8");
  try {
    runOrDie("gh", [
      "release",
      "create",
      tag,
      "--title",
      tag,
      "--notes-file",
      tmpNotesFile,
    ]);
  } finally {
    run("rm", ["-f", tmpNotesFile]);
  }
  ok(`GitHub Release ${tag} created.`);

  if (args.npmPublish) {
    info("Triggering release.yml workflow with publish_to_npm=true…");
    // `gh workflow run` queues the workflow; we don't block on its completion
    // here (the workflow has its own build + test pipeline; the user follows
    // it on GitHub). Per iter-22 refinement #8, this is the second
    // confirmation layer — the workflow's `workflow_dispatch` input gates
    // the actual npm publish job.
    runOrDie("gh", [
      "workflow",
      "run",
      "release.yml",
      "-f",
      `tag=${tag}`,
      "-f",
      "publish_to_npm=true",
    ]);
    ok(`Workflow triggered. Watch at: gh run list --workflow=release.yml`);
  } else {
    info(
      "--npm-publish not set; tag + GitHub Release done, no npm publish triggered.\n" +
        "  When ready: gh workflow run release.yml -f tag=" +
        tag +
        " -f publish_to_npm=true",
    );
  }

  console.log("");
  ok(ansi.bold(`🎉 Released ${tag}.`));
  console.log(
    ansi.dim(
      `  Anything that needs fixing now ships as v${suggestNextVersion(newVersion)} — do NOT force-move ${tag}.`,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
