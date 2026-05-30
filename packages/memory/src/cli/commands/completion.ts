/**
 * `cerefox completion <shell>` — emit a tab-completion script.
 *
 * Generates a shell-specific script that completes subcommand names
 * (the first arg after `cerefox`) and the long-form flag names of each
 * subcommand. Doesn't try to complete flag *values* (file paths, UUIDs,
 * etc.) — those vary per command and would need per-flag completers
 * that aren't worth maintaining at v0.5.
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

interface CompletionInfo {
  subcommands: Array<{ name: string; flags: string[] }>;
}

/**
 * Walk the commander tree and extract the completion-relevant info.
 * Skips the bin's built-in commands like `help`.
 */
function collectCompletionInfo(): CompletionInfo {
  const program = buildProgram();
  const subcommands: Array<{ name: string; flags: string[] }> = [];
  for (const cmd of program.commands) {
    if (cmd.name() === "help") continue;
    const flags: string[] = [];
    for (const opt of cmd.options) {
      // commander exposes flags like "-c, --match-count <n>" or "--json"
      // Extract the long form.
      const long = opt.long;
      if (long) flags.push(long);
    }
    flags.push("--help");
    subcommands.push({ name: cmd.name(), flags });
  }
  subcommands.sort((a, b) => a.name.localeCompare(b.name));
  return { subcommands };
}

function bashScript(info: CompletionInfo): string {
  const cmdNames = info.subcommands.map((s) => s.name).join(" ");
  const cases = info.subcommands
    .map((s) => `        ${s.name})\n            opts="${s.flags.join(" ")}"\n            ;;`)
    .join("\n");
  return `# Cerefox bash completion. Source from ~/.bashrc:
#   source <(cerefox completion bash)
#
_cerefox_completion() {
    local cur prev cmd opts
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    cmd="\${COMP_WORDS[1]}"
    if [ "\${COMP_CWORD}" -eq 1 ]; then
        opts="${cmdNames}"
        COMPREPLY=( $(compgen -W "\${opts}" -- "\${cur}") )
        return 0
    fi
    case "\${cmd}" in
${cases}
        *)
            opts="--help"
            ;;
    esac
    COMPREPLY=( $(compgen -W "\${opts}" -- "\${cur}") )
    return 0
}
complete -F _cerefox_completion cerefox
`;
}

function zshScript(info: CompletionInfo): string {
  // zsh: use the simpler compdef syntax that just lists commands + flags.
  const cmdNames = info.subcommands.map((s) => `'${s.name}'`).join(" ");
  const cases = info.subcommands
    .map((s) => {
      const flagList = s.flags.map((f) => `'${f}'`).join(" ");
      return `        ${s.name}) flags=(${flagList}) ;;`;
    })
    .join("\n");
  return `#compdef cerefox
# Cerefox zsh completion. Save and source from ~/.zshrc:
#   source <(cerefox completion zsh)
#
_cerefox() {
    local -a cmds flags
    cmds=(${cmdNames})
    if (( CURRENT == 2 )); then
        _values 'cerefox subcommand' $cmds
        return
    fi
    case "$words[2]" in
${cases}
        *) flags=() ;;
    esac
    _values 'flag' $flags
}
compdef _cerefox cerefox
`;
}

function fishScript(info: CompletionInfo): string {
  const lines: string[] = [
    "# Cerefox fish completion. Save to ~/.config/fish/completions/cerefox.fish",
    "",
  ];
  for (const sub of info.subcommands) {
    lines.push(`complete -c cerefox -n '__fish_use_subcommand' -a '${sub.name}'`);
    for (const flag of sub.flags) {
      lines.push(`complete -c cerefox -n '__fish_seen_subcommand_from ${sub.name}' -l '${flag.replace(/^--/, "")}'`);
    }
  }
  return lines.join("\n") + "\n";
}

type Shell = "bash" | "zsh" | "fish";

function scriptFor(shell: Shell): string {
  const info = collectCompletionInfo();
  switch (shell) {
    case "bash":
      return bashScript(info);
    case "zsh":
      return zshScript(info);
    case "fish":
      return fishScript(info);
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
