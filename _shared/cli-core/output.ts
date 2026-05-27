/**
 * Output formatters for CLI commands.
 *
 * Two modes:
 *   - Human (default): plain text, optionally colored if stdout is a TTY.
 *   - JSON (`--json` flag): machine-readable, never colored.
 *
 * The Python CLI emits text identically to humans when `--json` is absent,
 * and a single JSON value (object or array) when `--json` is present. The
 * TS CLI matches that contract — `printJson(...)` writes exactly one JSON
 * value followed by a newline; `printTable(...)` and friends write
 * indented, multi-line text suited for terminals.
 *
 * Runtime-neutral: uses only `process.stdout`/`process.stderr`. Works
 * unchanged on Bun and Node.
 */

import pc from "picocolors";

// ── colour-on-TTY-only helpers ──────────────────────────────────────────────

const STDOUT_TTY = process.stdout.isTTY === true;
const STDERR_TTY = process.stderr.isTTY === true;

/** Coloured text on stdout only when stdout is a TTY. Plain otherwise. */
export const c = {
  dim: (s: string): string => (STDOUT_TTY ? pc.dim(s) : s),
  bold: (s: string): string => (STDOUT_TTY ? pc.bold(s) : s),
  green: (s: string): string => (STDOUT_TTY ? pc.green(s) : s),
  yellow: (s: string): string => (STDOUT_TTY ? pc.yellow(s) : s),
  red: (s: string): string => (STDOUT_TTY ? pc.red(s) : s),
  cyan: (s: string): string => (STDOUT_TTY ? pc.cyan(s) : s),
};

/** Same set, but gated on stderr's TTY status (used by error printer). */
export const cErr = {
  dim: (s: string): string => (STDERR_TTY ? pc.dim(s) : s),
  bold: (s: string): string => (STDERR_TTY ? pc.bold(s) : s),
  green: (s: string): string => (STDERR_TTY ? pc.green(s) : s),
  yellow: (s: string): string => (STDERR_TTY ? pc.yellow(s) : s),
  red: (s: string): string => (STDERR_TTY ? pc.red(s) : s),
  cyan: (s: string): string => (STDERR_TTY ? pc.cyan(s) : s),
};

// ── stdout writers ──────────────────────────────────────────────────────────

/** Write a single JSON value followed by a newline. */
export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

/** Write a single line of text + newline to stdout. */
export function println(line: string = ""): void {
  process.stdout.write(line + "\n");
}

/**
 * Print a list of records as an aligned table. Headers come from the first
 * row's keys; values are coerced with `String(...)`. If `rows` is empty,
 * prints `emptyMessage` (which can be a plain string like "No results.").
 *
 * Not a heavyweight `tablefmt`-style implementation — just enough for the
 * shapes we render (project listings, audit-log entries, doctor checks).
 * For richer rendering, a per-command formatter is fine.
 */
export function printTable(
  rows: Array<Record<string, unknown>>,
  emptyMessage: string = "(no rows)",
): void {
  if (rows.length === 0) {
    println(c.dim(emptyMessage));
    return;
  }
  const headers = Object.keys(rows[0]);
  const widths = headers.map((h) =>
    Math.max(
      h.length,
      ...rows.map((r) => String(r[h] ?? "").length),
    ),
  );
  const line = (cells: string[]): string =>
    cells.map((cell, i) => cell.padEnd(widths[i])).join("  ");
  println(c.bold(line(headers)));
  println(c.dim(line(widths.map((w) => "-".repeat(w)))));
  for (const row of rows) {
    println(line(headers.map((h) => String(row[h] ?? ""))));
  }
}

// ── stderr writers ──────────────────────────────────────────────────────────

/** Write a single line of text + newline to stderr. */
export function eprintln(line: string = ""): void {
  process.stderr.write(line + "\n");
}

/** Cyan "ℹ" prefix; for informational messages on stderr. */
export function info(message: string): void {
  eprintln(`${cErr.cyan("ℹ")} ${message}`);
}

/** Yellow "⚠" prefix. */
export function warn(message: string): void {
  eprintln(`${cErr.yellow("⚠")} ${message}`);
}

/** Red "✗" prefix. Used by the top-level error handler. */
export function errorln(message: string): void {
  eprintln(`${cErr.red("✗")} ${message}`);
}

/** Green "✓" prefix. */
export function ok(message: string): void {
  eprintln(`${cErr.green("✓")} ${message}`);
}
