/**
 * `cerefox completion <shell>` — emit a tab-completion script.
 *
 * Generates a shell-specific script that completes the full resource-verb
 * command tree — top-level commands (`document`, `search`, …), nested verbs
 * (`document get`, `document version`, …) at any depth, and the long-form
 * flag names of whichever command the cursor is in. Hidden husks (the old
 * flat verbs) are excluded so completion only ever suggests current names.
 * Doesn't complete flag *values* (file paths, UUIDs, etc.) — those vary per
 * flag and aren't worth maintaining.
 *
 * The scripts resolve the typed subcommand path at completion time: they walk
 * the words after `cerefox`, consuming each one that's a known subcommand
 * (stopping at the first flag or non-command), then offer that command node's
 * children + flags. A generated lookup (`_cerefox_candidates` / `_is_path`)
 * encodes the tree, so a `cerefox completion install` after an upgrade picks
 * up new commands automatically.
 *
 * Usage:
 *   cerefox completion bash  > ~/.cerefox-completion.bash
 *   echo 'source ~/.cerefox-completion.bash' >> ~/.bashrc
 *
 *   cerefox completion zsh   > ~/.cerefox-completion.zsh
 *   echo 'source ~/.cerefox-completion.zsh'  >> ~/.zshrc
 *
 *   cerefox completion fish  > ~/.config/fish/completions/cerefox.fish
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Command } from "commander";

import { c, confirm, eprintln, println, userError } from "../../../../../_shared/cli-core/index.ts";
import { buildProgram } from "../program.ts";

/**
 * One node of the command tree: `path` is the space-joined subcommand path
 * from the root (e.g. "" for the bin itself, "document", "document version"),
 * and `candidates` is what to offer when the cursor sits at that path — child
 * subcommand names followed by the node's own long flags.
 */
interface CompletionNode {
  path: string;
  candidates: string[];
}

function isHidden(cmd: Command): boolean {
  return Boolean((cmd as unknown as { _hidden?: boolean })._hidden);
}

/** Visible child subcommands (skips the implicit `help` and hidden husks). */
function visibleSubs(cmd: Command): Command[] {
  return cmd.commands.filter((c) => c.name() !== "help" && !isHidden(c));
}

function longFlags(cmd: Command): string[] {
  const flags: string[] = [];
  for (const opt of cmd.options) {
    if (opt.long) flags.push(opt.long);
  }
  return flags;
}

/**
 * Recursively walk the commander tree into a flat list of nodes — one per
 * command (including the root and every leaf), keyed by its subcommand path.
 */
function collectNodes(): CompletionNode[] {
  const program = buildProgram();
  const nodes: CompletionNode[] = [];
  const walk = (cmd: Command, path: string): void => {
    const subs = visibleSubs(cmd);
    const candidates = [...subs.map((s) => s.name()), ...longFlags(cmd), "--help"];
    nodes.push({ path, candidates });
    for (const s of subs) {
      walk(s, path === "" ? s.name() : `${path} ${s.name()}`);
    }
  };
  walk(program, "");
  nodes.sort((a, b) => a.path.localeCompare(b.path));
  return nodes;
}

function bashScript(nodes: CompletionNode[]): string {
  const candCases = nodes
    .map((n) => `        "${n.path}") echo "${n.candidates.join(" ")}" ;;`)
    .join("\n");
  const pathPatterns = nodes
    .filter((n) => n.path !== "")
    .map((n) => `"${n.path}"`)
    .join("|");
  return `# Cerefox bash completion. Source from ~/.bashrc:
#   source <(cerefox completion bash)
#
_cerefox_candidates() {
    case "$1" in
${candCases}
        *) echo "--help" ;;
    esac
}
_cerefox_is_path() {
    case "$1" in
        ${pathPatterns}) return 0 ;;
        *) return 1 ;;
    esac
}
_cerefox_completion() {
    local cur path trial w i
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    path=""
    i=1
    while [ "$i" -lt "\${COMP_CWORD}" ]; do
        w="\${COMP_WORDS[$i]}"
        case "$w" in -*) break ;; esac
        if [ -z "$path" ]; then trial="$w"; else trial="$path $w"; fi
        if _cerefox_is_path "$trial"; then
            path="$trial"; i=$((i + 1))
        else
            break
        fi
    done
    COMPREPLY=( $(compgen -W "$(_cerefox_candidates "$path")" -- "$cur") )
    return 0
}
complete -F _cerefox_completion cerefox
`;
}

function zshScript(nodes: CompletionNode[]): string {
  const candCases = nodes
    .map((n) => `        "${n.path}") REPLY="${n.candidates.join(" ")}" ;;`)
    .join("\n");
  const pathPatterns = nodes
    .filter((n) => n.path !== "")
    .map((n) => `"${n.path}"`)
    .join("|");
  return `#compdef cerefox
# Cerefox zsh completion. Save and source from ~/.zshrc:
#   source <(cerefox completion zsh)
#
_cerefox_candidates() {
    case "$1" in
${candCases}
        *) REPLY="--help" ;;
    esac
}
_cerefox_is_path() {
    case "$1" in
        ${pathPatterns}) return 0 ;;
        *) return 1 ;;
    esac
}
_cerefox() {
    local path trial w i REPLY
    path=""
    i=2
    while (( i < CURRENT )); do
        w="\${words[i]}"
        case "$w" in -*) break ;; esac
        if [[ -z "$path" ]]; then trial="$w"; else trial="$path $w"; fi
        if _cerefox_is_path "$trial"; then
            path="$trial"; (( i++ ))
        else
            break
        fi
    done
    _cerefox_candidates "$path"
    compadd -- \${=REPLY}
}
# Self-bootstrap the completion system if no \`compinit\` has run yet (e.g. this
# file is sourced from an rc that never initialized completions). No-op when
# \`compdef\` already exists, so it never re-runs compinit unnecessarily.
if ! whence compdef >/dev/null 2>&1; then
    autoload -Uz compinit && compinit
fi
compdef _cerefox cerefox
`;
}

function fishScript(nodes: CompletionNode[]): string {
  const candCases = nodes
    .map((n) => `        case "${n.path}"\n            echo "${n.candidates.join(" ")}"`)
    .join("\n");
  const pathList = nodes
    .filter((n) => n.path !== "")
    .map((n) => `"${n.path}"`)
    .join(" ");
  return `# Cerefox fish completion. Save to ~/.config/fish/completions/cerefox.fish
function __cerefox_candidates
    switch "$argv[1]"
${candCases}
        case '*'
            echo "--help"
    end
end
function __cerefox_is_path
    for p in ${pathList}
        if test "$argv[1]" = "$p"
            return 0
        end
    end
    return 1
end
function __cerefox_complete
    set -l tokens (commandline -opc)
    set -l path ""
    set -l i 2
    while test $i -le (count $tokens)
        set -l w $tokens[$i]
        if string match -q -- '-*' $w
            break
        end
        set -l trial
        if test -z "$path"
            set trial $w
        else
            set trial "$path $w"
        end
        if __cerefox_is_path "$trial"
            set path "$trial"
            set i (math $i + 1)
        else
            break
        end
    end
    string split ' ' -- (__cerefox_candidates "$path")
end
complete -c cerefox -f -a '(__cerefox_complete)'
`;
}

type Shell = "bash" | "zsh" | "fish";

function scriptFor(shell: Shell): string {
  const nodes = collectNodes();
  switch (shell) {
    case "bash":
      return bashScript(nodes);
    case "zsh":
      return zshScript(nodes);
    case "fish":
      return fishScript(nodes);
  }
}

/** Detect the user's shell from $SHELL (basename). */
function detectShell(): Shell | null {
  const sh = (process.env.SHELL ?? "").split("/").pop() ?? "";
  if (sh === "bash" || sh === "zsh" || sh === "fish") return sh;
  return null;
}

const RC_BEGIN = "# >>> cerefox shell completion (managed by `cerefox completion install`) >>>";
const RC_END = "# <<< cerefox shell completion <<<";

/**
 * `cerefox completion install [--shell <s>] [--yes]` — write the completion
 * script to `~/.cerefox-completion.<shell>` and source it from the shell rc
 * via an idempotent sentinel block. Re-running regenerates the script (so new
 * commands appear); the rc block is added once. Mirrors cfcf's pattern;
 * `install.sh` runs this on install/upgrade so completion stays current.
 */
async function installMode(options: { shell?: string; yes?: boolean }): Promise<void> {
  const shell = (options.shell as Shell | undefined) ?? detectShell();
  if (!shell) {
    throw userError(
      "Could not detect your shell from $SHELL. Pass --shell bash|zsh|fish.",
    );
  }
  if (shell !== "bash" && shell !== "zsh" && shell !== "fish") {
    throw userError(`Unsupported --shell "${shell}". Use bash, zsh, or fish.`);
  }

  const home = homedir();
  const scriptPath = join(home, `.cerefox-completion.${shell}`);
  // Always (re)write the script so upgrades pick up new commands/flags.
  writeFileSync(scriptPath, scriptFor(shell), "utf8");
  println(c.green(`✓ Wrote completion script: ${scriptPath}`));

  // fish: drop-in dir, no rc edit needed.
  if (shell === "fish") {
    println(c.dim("  For fish, also copy it into ~/.config/fish/completions/cerefox.fish (or `source` it)."));
    return;
  }

  const rcPath = join(home, shell === "zsh" ? ".zshrc" : ".bashrc");
  const sourceLine = `[ -s "${scriptPath}" ] && source "${scriptPath}"`;
  const block = `${RC_BEGIN}\n${sourceLine}\n${RC_END}\n`;
  const existing = existsSync(rcPath) ? readFileSync(rcPath, "utf8") : "";

  if (existing.includes(RC_BEGIN)) {
    println(c.dim(`  ${rcPath} already sources the completion (left as-is).`));
  } else {
    // Editing the user's rc — confirm unless --yes or non-interactive.
    const interactive = process.stdout.isTTY && !options.yes;
    if (interactive) {
      const ok = await confirm(`Add a completion source line to ${rcPath}?`, false);
      if (!ok) {
        println(c.dim(`Skipped the rc edit. Add this line to ${rcPath} yourself:`));
        println(`  ${sourceLine}`);
        return;
      }
    }
    writeFileSync(rcPath, (existing.endsWith("\n") || existing === "" ? existing : existing + "\n") + "\n" + block, "utf8");
    println(c.green(`✓ Added completion to ${rcPath}.`));
  }
  println(c.dim(`  Activate now: exec ${shell}   (or open a new terminal).`));
}

async function action(target: string, options: { shell?: string; yes?: boolean }): Promise<void> {
  if (target === "install") {
    await installMode(options);
    return;
  }
  if (target !== "bash" && target !== "zsh" && target !== "fish") {
    throw userError(`Unknown shell "${target}". Supported: bash, zsh, fish (or 'install').`);
  }
  // Raw emit: print the script to stdout (pipe/redirect it yourself).
  println(scriptFor(target));
  if (process.stdout.isTTY) {
    eprintln(c.dim(`\n# Tip: \`cerefox completion install\` writes this + wires your shell rc automatically.`));
  }
}

export function registerCompletion(program: Command): void {
  program
    .command("completion")
    .description("Shell tab-completion. `install` to auto-wire your shell, or a shell name to print the script.")
    .argument("<shell>", "bash | zsh | fish (print the script), or 'install' (auto-wire).")
    .option("--shell <shell>", "For 'install': override the auto-detected shell.")
    .option("--yes", "For 'install': skip the rc-edit confirmation (used by install.sh).")
    .action(action);
}
