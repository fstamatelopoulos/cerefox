import { IconCopy, IconTerminal2 } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";

import ui from "../styles/redesign.module.css";

/**
 * Compact CLI-parity hint: shows the equivalent `cerefox` command for the
 * current page/query, copies it on click, and links to the CLI docs. Lighter
 * than the full CLI-mirror card — meant for page headers (top-right).
 */
export function CliHint({ command, docPath = "guides/cli.md" }: { command: string; docPath?: string }) {
  const navigate = useNavigate();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
      <button
        type="button"
        className={`${ui.btn} ${ui.btnSubtle}`}
        style={{ fontSize: 12 }}
        title="Copy command to clipboard"
        onClick={() => navigator.clipboard?.writeText(command)}
      >
        <IconTerminal2 size={14} />
        <span
          className={ui.mono}
          style={{ fontSize: 12, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {command}
        </span>
        <IconCopy size={13} />
      </button>
      <button type="button" className={ui.whatis} onClick={() => navigate(`/help/${docPath}`)}>
        cli docs
      </button>
    </span>
  );
}
