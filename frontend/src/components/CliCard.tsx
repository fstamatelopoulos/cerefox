import { IconCheck, IconCopy, IconTerminal2 } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import ui from "../styles/redesign.module.css";

interface Cmd {
  cmd: string;
  args?: string;
}

/**
 * CLI-parity card: a titled terminal block listing the `cerefox …` commands
 * equivalent to the current page, each independently copyable (with a brief ✓
 * confirmation), plus a "cli docs" link. Used in page rails (Dashboard,
 * Ingest) and list-page headers (Trash, Projects). No fake output lines.
 */
export function CliCard({
  title,
  commands,
  docPath = "guides/cli.md",
}: {
  title: string;
  commands: Cmd[];
  docPath?: string;
}) {
  const navigate = useNavigate();
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = (idx: number, c: Cmd) => {
    navigator.clipboard?.writeText(c.args ? `${c.cmd} ${c.args}` : c.cmd);
    setCopiedIdx(idx);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopiedIdx(null), 1200);
  };

  return (
    <div className={`${ui.card} ${ui.cliCard} ${ui.rise}`}>
      <div className={ui.row} style={{ gap: 8, marginBottom: 10 }}>
        <IconTerminal2 size={15} />
        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{title}</span>
        <button
          type="button"
          className={ui.whatis}
          style={{ marginLeft: "auto" }}
          onClick={() => navigate(`/help/${docPath}`)}
        >
          cli docs
        </button>
      </div>
      <div className={ui.cliBlock}>
        {commands.map((c, i) => (
          <div className={ui.cliLine} key={i}>
            <span className={ui.cliLineCmd}>
              <span className={ui.cliP}>$</span>
              {c.cmd}
              {c.args && (
                <>
                  {" "}
                  <span className={ui.cliS}>{c.args}</span>
                </>
              )}
            </span>
            <button
              type="button"
              className={ui.cliCopyBtn}
              title={copiedIdx === i ? "Copied!" : "Copy command to clipboard"}
              onClick={() => copy(i, c)}
            >
              {copiedIdx === i ? (
                <IconCheck size={13} style={{ color: "var(--green)" }} />
              ) : (
                <IconCopy size={13} />
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
