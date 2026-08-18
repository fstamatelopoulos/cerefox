/**
 * `cerefox self-update` (alias `cerefox upgrade`) — upgrade in place.
 *
 * Detects which package manager actually installed `@cerefox/memory`
 * (looks at the resolved bin path; npm/bun/yarn/pnpm each install to a
 * different prefix), wraps the corresponding `<rt> install -g
 * @cerefox/memory@<version>` invocation.
 *
 * After a successful upgrade, calls `sync-self-docs` to refresh the
 * bundled-docs ingest (so the project's self-docs reflect the new
 * version). The sync step is gated until Part 23F lands.
 *
 * v0.5 stays simple: shells out to the detected runtime's `install -g`
 * command. Doesn't try to be clever about pre-release pins (the
 * `--version` flag passes through verbatim).
 */

import type { Command } from "commander";
import { spawnSync } from "node:child_process";

import {
  c,
  cErr,
  confirm,
  println,
  systemError,
  userError,
} from "../../../../../_shared/cli-core/index.ts";
import { PKG_VERSION } from "../../meta.ts";

interface SelfUpdateOptions {
  check?: boolean;
  yes?: boolean;
  version?: string;
}

interface ResolvedRuntime {
  command: string;
  args: (version: string) => string[];
  description: string;
}

function detectRuntime(): ResolvedRuntime {
  // Look at process.argv[1] — the path to the running bin. Different
  // installers put it under different prefixes:
  //   Bun:    ~/.bun/bin/cerefox or /opt/homebrew/.bun/...
  //   npm:    /usr/local/lib/node_modules/@cerefox/memory/dist/bin/cerefox.js
  //   yarn:   ~/.yarn/bin/cerefox or .config/yarn/global/...
  //   pnpm:   ~/Library/pnpm/cerefox (macOS) or ~/.local/share/pnpm/cerefox
  //
  // First-match wins; in ambiguous cases we default to npm (universal
  // availability).
  const bin = (process.argv[1] ?? "").toLowerCase();

  // `--no-cache` (bun) / `--prefer-online` (npm) force a fresh registry
  // manifest fetch. We already resolved the real target version from the
  // registry above, but bun/npm may hold a stale cached manifest that doesn't
  // list it yet — without these flags `bun install …@<new>` can fail with
  // "No version matching" until the cache expires. (pnpm/yarn left as-is.)
  if (bin.includes(".bun") || bin.includes("/bun/")) {
    return {
      command: "bun",
      args: (v) => ["install", "-g", "--no-cache", `@cerefox/memory@${v}`],
      description: "Bun",
    };
  }
  if (bin.includes(".pnpm") || bin.includes("/pnpm/")) {
    return {
      command: "pnpm",
      args: (v) => ["add", "-g", `@cerefox/memory@${v}`],
      description: "pnpm",
    };
  }
  if (bin.includes(".yarn") || bin.includes("/yarn/")) {
    return {
      command: "yarn",
      args: (v) => ["global", "add", `@cerefox/memory@${v}`],
      description: "Yarn",
    };
  }
  return {
    command: "npm",
    args: (v) => ["install", "-g", "--prefer-online", `@cerefox/memory@${v}`],
    description: "npm",
  };
}

async function fetchLatestVersion(): Promise<string> {
  const resp = await fetch("https://registry.npmjs.org/@cerefox%2Fmemory/latest");
  if (!resp.ok) {
    throw systemError(
      `Could not query npm registry: ${resp.status} ${resp.statusText}`,
    );
  }
  const body = (await resp.json()) as { version?: string };
  if (!body.version) {
    throw systemError("npm registry response missing version field.");
  }
  return body.version;
}

async function action(options: SelfUpdateOptions): Promise<void> {
  let target: string;
  try {
    target = options.version ?? (await fetchLatestVersion());
  } catch (err) {
    if (err instanceof Error) throw err;
    throw systemError(String(err));
  }

  println(c.dim(`Installed: ${PKG_VERSION}`));
  println(c.dim(`Target:    ${target}`));

  if (target === PKG_VERSION && !options.version) {
    println(c.green("✓ Already up to date."));
    return;
  }

  if (options.check) {
    if (target !== PKG_VERSION) {
      println(c.yellow(`Update available: ${PKG_VERSION} → ${target}`));
      println(c.dim("Run `cerefox self-update` to upgrade."));
    }
    return;
  }

  const runtime = detectRuntime();
  println(c.dim(`Using ${runtime.description}: ${runtime.command} ${runtime.args(target).join(" ")}`));
  println("");

  if (!options.yes) {
    const ok = await confirm(`Upgrade @cerefox/memory to ${target}?`);
    if (!ok) {
      println(c.dim("Aborted."));
      return;
    }
  }

  const result = spawnSync(runtime.command, runtime.args(target), {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    // spawnSync sets `error` (and leaves status null) when the binary could
    // not be launched at all — reporting `status` then printed the nonsense
    // "exit undefined" (#153). Say which case it is.
    const notFound =
      (result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
    throw systemError(
      notFound
        ? `${runtime.description} was not found on PATH (tried \`${runtime.command}\`).`
        : `${runtime.description} install failed (exit ${result.status}).`,
      notFound
        ? `Install ${runtime.description}, or upgrade manually: \`${runtime.command} ${runtime.args(target).join(" ")}\``
        : `Try the manual command: \`${runtime.command} ${runtime.args(target).join(" ")}\``,
    );
  }

  println("");
  println(c.green(`✓ Upgraded to ${target}.`));

  // Deliberately NO automatic guides ingest here (changed after v1.9.1).
  //
  // The upgrade ordering is necessarily client-first: self-update, THEN
  // `cerefox server deploy`. An ingest fired from this command therefore runs
  // at the exact moment the client is newest and the server is oldest — and a
  // release that requires its new schema (v1.9.x: minSchema 0.14.0) fails
  // right here, observed live: 6 of 17 bundled docs errored against the
  // not-yet-deployed server mid-upgrade. It only ever "worked" because
  // earlier releases did not hard-require their schema at ingest time.
  // The sync belongs AFTER the server update; `cerefox server deploy` prints
  // the pointer, and `cerefox guides ingest` remains the standalone command.
  println("");
  println("Next steps:");
  println("  1. " + c.bold("cerefox server deploy") + "   apply this release's schema/RPC/EF updates");
  println("  2. " + c.bold("cerefox guides ingest") + "   re-sync the bundled guides into your KB");
  println(c.dim("  (order matters: the new client may require the new schema — run the deploy first)"));
}

export function registerSelfUpdate(program: Command): void {
  const desc = "Upgrade Cerefox in place. Alias: `cerefox upgrade`.";
  const declaration = (cmd: Command): Command =>
    cmd
      .description(desc)
      .option("--check", "Print current vs latest; do nothing.")
      .option("--yes", "Non-interactive (skip confirmation).")
      .option(
        "--version <version>",
        "Pin a specific version (e.g. 0.5.1 or 0.6.0-rc.1).",
      )
      .action(action);

  declaration(program.command("self-update"));
  declaration(program.command("upgrade"));
}
