import { IconCopy } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";

import ui from "../styles/redesign.module.css";

/**
 * Compact CLI-parity hint for page headers: a mini terminal snippet styled
 * like the dashboard's CLI-mirror card ($ prompt in primary, args in green),
 * that copies the command on click, plus a "cli docs" link. Lighter than the
 * full CLI card.
 */
export function CliHint({
  cmd,
  args,
  docPath = "guides/cli.md",
}: {
  cmd: string;
  args?: string;
  docPath?: string;
}) {
  const navigate = useNavigate();
  const full = args ? `${cmd} ${args}` : cmd;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
      <button
        type="button"
        className={ui.cliHintBlock}
        title="Copy command to clipboard"
        onClick={() => navigator.clipboard?.writeText(full)}
      >
        <span style={{ color: "var(--primary)" }}>$</span>
        <span>{cmd}</span>
        {args && <span className={ui.cliHintArgs}>{args}</span>}
        <IconCopy size={12} style={{ color: "var(--text-faint)", flexShrink: 0 }} />
      </button>
      <button type="button" className={ui.whatis} onClick={() => navigate(`/help/${docPath}`)}>
        cli docs
      </button>
    </span>
  );
}
