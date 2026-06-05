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
import { join, relative } from "node:path";
import { exit } from "node:process";

// ── paths ────────────────────────────────────────────────────────────────

const REPO_ROOT = join(import.meta.dir, "..");
const VERSION_FILE = join(REPO_ROOT, "VERSION");
const CHANGELOG_FILE = join(REPO_ROOT, "CHANGELOG.md");
const PYPROJECT_FILE = join(REPO_ROOT, "pyproject.toml");

// Npm packages whose `package.json` version field must stay in lockstep
// with the repo-root VERSION file. Each is bumped + git-added on cut.
// Adding a new published package? Append its package.json path here.
const NPM_PACKAGE_FILES = [
  join(REPO_ROOT, "packages", "memory", "package.json"),
];

/**
 * Hardcoded version-string literals in TypeScript source that must also
 * stay in lockstep with VERSION. Surfaced as a v0.4.2 bug:
 * `cerefox-mcp --version` printed `0.4.0` because the binary's TS source
 * embedded a literal that the per-package package.json bump didn't touch.
 *
 * Each entry locates the literal by an exact `prefix` (the text up to and
 * including the opening quote) + `suffix` (closing quote + semicolon).
 * Both must be unique within the file. Adding a new file with a version
 * constant? Append an entry here.
 */
interface VersionLiteralFile {
  /** Absolute path to the TS file. */
  path: string;
  /** Exact text immediately before the version literal (e.g. `const VERSION = "`). */
  prefix: string;
  /** Exact text immediately after (e.g. `";`). */
  suffix: string;
}
const VERSION_LITERAL_FILES: VersionLiteralFile[] = [
  // packages/memory/src/meta.ts exports PKG_VERSION; both bins
  // (`cerefox` and `cerefox-mcp`) and `server.ts` import from there.
  // Single source of truth inside the bundle.
  {
    path: join(REPO_ROOT, "packages", "memory", "src", "meta.ts"),
    prefix: 'const PKG_VERSION = "',
    suffix: '";',
  },
];

/**
 * The Edge Function version literal (iter-26 Part 26B). Unlike PKG_VERSION
 * (which bumps every release), EF_VERSION bumps ONLY when Edge Function
 * code changed since the previous tag — a client-only release (CLI / web
 * fixes, docs) leaves the deployed EF version untouched so the compat
 * matrix stays meaningful. See `efsChangedSinceLastTag()`.
 */
const EF_VERSION_LITERAL: VersionLiteralFile = {
  path: join(REPO_ROOT, "_shared", "ef-meta", "index.ts"),
  prefix: 'export const EF_VERSION = "',
  suffix: '";',
};

/**
 * Paths whose changes since the last tag mean the deployed EF behaviour
 * changed: the EFs themselves + the `_shared` subtrees bundled with them.
 */
const EF_SOURCE_PATHS = [
  "supabase/functions",
  "_shared/ef-meta",
  "_shared/mcp-tools",
  "_shared/embeddings",
];

/** True when EF-relevant source changed since the most recent git tag. */
function efsChangedSinceLastTag(): boolean {
  const lastTag = run("git", ["describe", "--tags", "--abbrev=0"]).stdout.trim();
  if (!lastTag) return true; // no prior tag — bump to be safe
  const diff = run("git", [
    "diff",
    "--name-only",
    `${lastTag}..HEAD`,
    "--",
    ...EF_SOURCE_PATHS,
  ]);
  return diff.stdout.trim().length > 0;
}

/**
 * Schema/RPC version guard (the symmetric counterpart to the EF_VERSION
 * mechanism). Schema and RPCs deploy together via `cerefox server deploy`, so
 * `schema_version` is the single "redeploy required" signal for both. Unlike
 * EF_VERSION (auto-bumped to the release version), the schema version is an
 * independent semver chosen by hand — so this GATES the cut rather than
 * auto-bumping: if anything under `src/cerefox/db/` changed since the last
 * tag, the version must have been bumped, and the two literals must agree.
 */
const SCHEMA_SOURCE_PATHS = [
  "src/cerefox/db/schema.sql",
  "src/cerefox/db/rpcs.sql",
  "src/cerefox/db/migrations",
];
const SCHEMA_SQL_PATH = join(REPO_ROOT, "src", "cerefox", "db", "schema.sql");
const RPCS_SQL_PATH = join(REPO_ROOT, "src", "cerefox", "db", "rpcs.sql");

/** Parse the `-- @version: X.Y.Z` marker from schema.sql text. */
function parseSchemaMarker(text: string): string | null {
  const m = text.match(/^--\s*@version:\s*([0-9][^\s]*)/m);
  return m ? m[1] : null;
}
/** Parse the version literal from the `cerefox_schema_version()` body. */
function parseRpcsSchemaVersion(text: string): string | null {
  const m = text.match(/cerefox_schema_version[\s\S]*?SELECT\s*'([0-9][^']*)'/);
  return m ? m[1] : null;
}

function assertSchemaVersionGuard(): void {
  const marker = parseSchemaMarker(readFileSync(SCHEMA_SQL_PATH, "utf8"));
  const deployedLit = parseRpcsSchemaVersion(readFileSync(RPCS_SQL_PATH, "utf8"));
  if (!marker || !deployedLit) {
    die(
      "Could not read schema_version — expected a `-- @version:` marker in " +
        "schema.sql and a literal in cerefox_schema_version() in rpcs.sql.",
    );
  }
  if (marker !== deployedLit) {
    die(
      `schema_version mismatch: schema.sql @version=${marker} but ` +
        `cerefox_schema_version()=${deployedLit}. Bump both in lockstep ` +
        "(RELEASING.md step 4) — doctor compares bundled (schema.sql) vs " +
        "deployed (the RPC), so they must agree.",
    );
  }
  const lastTag = run("git", ["describe", "--tags", "--abbrev=0"]).stdout.trim();
  if (!lastTag) return;
  const dbChanged =
    run("git", ["diff", "--name-only", `${lastTag}..HEAD`, "--", ...SCHEMA_SOURCE_PATHS])
      .stdout.trim().length > 0;
  if (!dbChanged) return;
  const prevMarker = parseSchemaMarker(
    run("git", ["show", `${lastTag}:src/cerefox/db/schema.sql`]).stdout,
  );
  if (prevMarker && prevMarker === marker) {
    die(
      `src/cerefox/db/ changed since ${lastTag} but schema_version is still ` +
        `${marker}. Schema + RPCs deploy together — bump the @version marker in ` +
        "schema.sql AND cerefox_schema_version() in rpcs.sql (RELEASING.md step 4) " +
        "so doctor / the banner tells users to run `cerefox server deploy`.",
    );
  }
}

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

// ── npm package.json version sync ────────────────────────────────────────

/** Read a package.json's current `version` field (or die with context). */
function readPackageJsonVersion(path: string): string {
  if (!existsSync(path)) die(`package.json not found at ${path}`);
  const text = readFileSync(path, "utf8");
  const m = text.match(/^\s*"version":\s*"([^"]+)"\s*,?\s*$/m);
  if (!m) die(`Could not find "version" field in ${path}`);
  return m[1];
}

/**
 * Rewrite a package.json's `version` field to `newVersion`. Preserves all
 * other content / formatting (we touch a single line by regex rather than
 * round-tripping through JSON.stringify, which would re-format the file).
 */
function writePackageJsonVersion(path: string, newVersion: string): void {
  const text = readFileSync(path, "utf8");
  const updated = text.replace(
    /^(\s*"version":\s*")[^"]+("\s*,?\s*)$/m,
    `$1${newVersion}$2`,
  );
  if (updated === text) {
    die(`Failed to rewrite "version" in ${path} — line not found`);
  }
  writeFileSync(path, updated, "utf8");
}

// ── TS source version-literal sync ───────────────────────────────────────

/** Read the current version literal from a TS source file (or die). */
function readVersionLiteral(lit: VersionLiteralFile): string {
  if (!existsSync(lit.path)) die(`Version-literal file not found: ${lit.path}`);
  const text = readFileSync(lit.path, "utf8");
  const start = text.indexOf(lit.prefix);
  if (start < 0) {
    die(`Prefix not found in ${lit.path}:\n  ${lit.prefix}`);
  }
  // Guard against ambiguous prefixes.
  const secondStart = text.indexOf(lit.prefix, start + lit.prefix.length);
  if (secondStart >= 0) {
    die(`Prefix appears more than once in ${lit.path}; tighten the marker.`);
  }
  const versionStart = start + lit.prefix.length;
  const end = text.indexOf(lit.suffix, versionStart);
  if (end < 0) {
    die(`Suffix not found after prefix in ${lit.path}:\n  ${lit.suffix}`);
  }
  return text.slice(versionStart, end);
}

/** Rewrite the version literal in `lit.path` to `newVersion`. */
function writeVersionLiteral(lit: VersionLiteralFile, newVersion: string): void {
  // Validates prefix/suffix and uniqueness as a side effect.
  readVersionLiteral(lit);
  const text = readFileSync(lit.path, "utf8");
  const start = text.indexOf(lit.prefix);
  const versionStart = start + lit.prefix.length;
  const end = text.indexOf(lit.suffix, versionStart);
  const updated = text.slice(0, versionStart) + newVersion + text.slice(end);
  writeFileSync(lit.path, updated, "utf8");
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
  dockerPublish: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    version: null,
    dryRun: false,
    check: false,
    yes: false,
    npmPublish: false,
    dockerPublish: false,
  };
  for (const a of argv) {
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--check") out.check = true;
    else if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--npm-publish") out.npmPublish = true;
    else if (a === "--docker-publish") out.dockerPublish = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage:",
          "  bun scripts/cut_release.ts <version>                       cut tag + GitHub Release",
          "  bun scripts/cut_release.ts <version> --npm-publish         + trigger npm publish workflow",
          "  bun scripts/cut_release.ts <version> --docker-publish      + trigger ghcr image publish workflow",
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
          "  --docker-publish After the tag + GitHub Release, trigger local-image.yml to",
          "                   build + push the all-in-one image to ghcr.io (+ :latest for a",
          "                   stable, non-prerelease version). Default off — same policy as",
          "                   --npm-publish: a Release is a milestone, shipping is opt-in.",
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

  // Schema/RPC version guard: any src/cerefox/db/ change since the last tag
  // requires a schema_version bump (and the two literals must agree).
  assertSchemaVersionGuard();
  ok("schema_version guard passed.");

  // EF_VERSION bumps only when EF code changed since the last tag.
  const bumpEf = efsChangedSinceLastTag();
  const literalsToBump: VersionLiteralFile[] = bumpEf
    ? [...VERSION_LITERAL_FILES, EF_VERSION_LITERAL]
    : VERSION_LITERAL_FILES;
  if (bumpEf) {
    info("Edge Function source changed since last tag — EF_VERSION will bump.");
  } else {
    info("No Edge Function changes since last tag — leaving EF_VERSION as-is.");
  }

  const tag = `v${newVersion}`;

  // Confirm BEFORE any mutation. Declining here leaves the working tree
  // pristine — nothing written, committed, tagged, or pushed — so the cut is
  // immediately re-runnable. (Through v0.9.0 the script mutated + committed +
  // tagged FIRST and prompted last; a declined prompt left a local commit +
  // tag that tripped the `checkTagDoesNotExist` preflight on the next run.)
  if (!args.dryRun && !args.yes) {
    console.log("");
    {
      const extras = [
        args.npmPublish ? "the npm-publish workflow" : null,
        args.dockerPublish ? "the ghcr image-publish workflow" : null,
      ].filter(Boolean);
      info(
        `About to cut ${tag}: bump VERSION/CHANGELOG/package.json + version literals, ` +
          `commit, create an annotated tag, push to origin, and create a GitHub Release` +
          (extras.length ? `, then trigger ${extras.join(" + ")}.` : "."),
      );
    }
    info(
      `Note: release tags are immutable here. Once this tag is pushed it never ` +
        `moves — any later fix ships as a NEW patch version, not a re-tag. ` +
        `(The "force-move tags only on objective failure" rule; see CONTRIBUTING.md.)`,
    );
    const yes = await confirm("Proceed?");
    if (!yes) {
      warn("Aborted before any changes — working tree untouched, nothing committed/tagged/pushed. Re-run when ready.");
      return;
    }
  }

  // 3. Mutate files
  if (args.dryRun) {
    info("DRY-RUN: would write VERSION:");
    console.log(ansi.dim(`  ${newVersion}`));
    info("DRY-RUN: would rewrite CHANGELOG.md (preview of release notes):");
    console.log(
      ansi.dim(releaseNotes.split("\n").map((l) => "  " + l).join("\n")),
    );
    for (const pkgPath of NPM_PACKAGE_FILES) {
      const current = readPackageJsonVersion(pkgPath);
      info(
        `DRY-RUN: would bump ${relative(REPO_ROOT, pkgPath)} version: ${current} → ${newVersion}`,
      );
    }
    for (const lit of literalsToBump) {
      const current = readVersionLiteral(lit);
      info(
        `DRY-RUN: would bump ${relative(REPO_ROOT, lit.path)} \`${lit.prefix}…\`: ${current} → ${newVersion}`,
      );
    }
  } else {
    writeFileSync(VERSION_FILE, `${newVersion}\n`, "utf8");
    ok(`Wrote VERSION = ${newVersion}`);
    writeFileSync(CHANGELOG_FILE, newChangelog, "utf8");
    ok("Updated CHANGELOG.md.");
    // Keep every published npm package's package.json version in lockstep
    // with VERSION. Forgetting this caused v0.4.1's publish to attempt
    // re-publishing 0.4.0 from a stale @cerefox/memory/package.json.
    for (const pkgPath of NPM_PACKAGE_FILES) {
      const before = readPackageJsonVersion(pkgPath);
      writePackageJsonVersion(pkgPath, newVersion);
      ok(`Bumped ${relative(REPO_ROOT, pkgPath)}: ${before} → ${newVersion}`);
    }
    // Keep hardcoded version-string literals in TS source in lockstep with
    // VERSION too. Forgetting this caused v0.4.2's bin to print "0.4.0"
    // when run as v0.4.2 (server.ts PKG_VERSION + cerefox-mcp.ts VERSION
    // were both still hardcoded to the bootstrap version).
    for (const lit of literalsToBump) {
      const before = readVersionLiteral(lit);
      writeVersionLiteral(lit, newVersion);
      ok(`Bumped ${relative(REPO_ROOT, lit.path)}: ${before} → ${newVersion}`);
    }
  }

  // 4. Git commit + tag (`tag` declared + confirmed above)
  const commitMessage = `chore: cut ${tag}`;
  const stagedFiles = [
    "VERSION",
    "CHANGELOG.md",
    ...NPM_PACKAGE_FILES.map((p) => relative(REPO_ROOT, p)),
    ...literalsToBump.map((l) => relative(REPO_ROOT, l.path)),
  ];

  if (args.dryRun) {
    info(`DRY-RUN: would 'git add ${stagedFiles.join(" ")}'`);
    info(`DRY-RUN: would commit: ${commitMessage}`);
    info(`DRY-RUN: would create annotated tag ${tag} with CHANGELOG section as body`);
  } else {
    runOrDie("git", ["add", ...stagedFiles]);
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

  // 5. Push + GitHub Release (already confirmed before any mutation, above)

  if (args.dryRun) {
    info(`DRY-RUN: would 'git push origin main'`);
    info(`DRY-RUN: would 'git push origin ${tag}'`);
    info(`DRY-RUN: would 'gh release create ${tag} --title ${tag} --notes-file <release-notes>'`);
    info(`DRY-RUN: would upload install.sh + docker/local/install-local.sh as Release assets`);
    if (args.dockerPublish) {
      const publishLatest = !newVersion.includes("-");
      info(`DRY-RUN: would 'gh workflow run local-image.yml -f tag=${tag} -f publish_latest=${publishLatest}'`);
    } else {
      info("DRY-RUN: --docker-publish not set; no ghcr image would be published.");
    }
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

  // Attach install.sh as a release asset so the `latest/download/install.sh`
  // URL always serves the most recent one. Stable URL:
  //   https://github.com/fstamatelopoulos/cerefox/releases/latest/download/install.sh
  // Best-effort: skip if install.sh doesn't exist (very early v0.x cuts).
  const installSh = join(REPO_ROOT, "install.sh");
  if (existsSync(installSh)) {
    info("Attaching install.sh to the GitHub Release…");
    const upload = run("gh", ["release", "upload", tag, installSh, "--clobber"]);
    if (upload.status === 0) {
      ok("install.sh uploaded to the release.");
    } else {
      warn(`Could not upload install.sh: ${upload.stderr.trim() || "unknown error"}. Upload manually with: gh release upload ${tag} install.sh`);
    }
  }

  // Attach install-local.sh too (the LOCAL/self-hosted world's one-liner), so its
  // `latest/download/install-local.sh` URL stays current. The Docker image itself is
  // published separately + opt-in via `--docker-publish` (handled below) — NOT on the
  // Release event.
  const installLocalSh = join(REPO_ROOT, "docker", "local", "install-local.sh");
  if (existsSync(installLocalSh)) {
    info("Attaching install-local.sh to the GitHub Release…");
    const upLocal = run("gh", ["release", "upload", tag, installLocalSh, "--clobber"]);
    if (upLocal.status === 0) {
      ok("install-local.sh uploaded to the release.");
    } else {
      warn(`Could not upload install-local.sh: ${upLocal.stderr.trim() || "unknown error"}. Upload manually with: gh release upload ${tag} docker/local/install-local.sh`);
    }
  }

  // Docker (ghcr) publish — opt-in via --docker-publish, mirroring --npm-publish. The
  // local-image.yml workflow no longer fires on `release: published`. Tag :latest only
  // for a stable (non-prerelease) version.
  if (args.dockerPublish) {
    const publishLatest = !newVersion.includes("-");
    info(`Triggering local-image.yml to publish the ghcr image (publish_latest=${publishLatest})…`);
    runOrDie("gh", [
      "workflow",
      "run",
      "local-image.yml",
      "-f",
      `tag=${tag}`,
      "-f",
      `publish_latest=${publishLatest}`,
    ]);
    ok(`Workflow triggered. Watch at: gh run list --workflow=local-image.yml`);
  } else {
    info(
      "--docker-publish not set; no ghcr image published.\n" +
        "  When ready: gh workflow run local-image.yml -f tag=" +
        tag +
        " -f publish_latest=true",
    );
  }

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
