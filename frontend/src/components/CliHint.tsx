import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import ui from "../styles/redesign.module.css";

/**
 * Compact CLI-parity hint for page headers: a mini terminal snippet styled
 * like the dashboard's CLI-mirror card ($ prompt in primary, args in green),
 * that copies the command on click (with a brief checkmark confirmation),
 * plus a "cli docs" link.
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
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const full = args ? `${cmd} ${args}` : cmd;

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = () => {
    navigator.clipboard?.writeText(full);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1200);
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
      <button
        type="button"
        className={ui.cliHintBlock}
        title={copied ? "Copied!" : "Copy command to clipboard"}
        onClick={copy}
      >
        <span style={{ color: "var(--primary)" }}>$</span>
        <span>{cmd}</span>
        {args && <span className={ui.cliHintArgs}>{args}</span>}
        {copied ? (
          <IconCheck size={12} style={{ color: "var(--green)", flexShrink: 0 }} />
        ) : (
          <IconCopy size={12} style={{ color: "var(--text-faint)", flexShrink: 0 }} />
        )}
      </button>
      <button type="button" className={ui.whatis} onClick={() => navigate(`/help/${docPath}`)}>
        cli docs
      </button>
    </span>
  );
}
