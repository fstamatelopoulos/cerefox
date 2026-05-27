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

import type { Command } from "commander";

import { println, userError } from "../../../../../_shared/cli-core/index.ts";
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

function action(shell: string): void {
  const info = collectCompletionInfo();
  let script: string;
  switch (shell) {
    case "bash":
      script = bashScript(info);
      break;
    case "zsh":
      script = zshScript(info);
      break;
    case "fish":
      script = fishScript(info);
      break;
    default:
      throw userError(
        `Unknown shell "${shell}". Supported: bash, zsh, fish.`,
      );
  }
  println(script);
}

export function registerCompletion(program: Command): void {
  program
    .command("completion")
    .description("Emit a tab-completion script for your shell.")
    .argument("<shell>", "Target shell: bash, zsh, or fish.")
    .action(action);
}
