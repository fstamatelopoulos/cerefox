import { Popover, Text } from "@mantine/core";
import {
  IconArrowRight,
  IconChevronRight,
  IconClock,
  IconDatabase,
  IconFileText,
  IconFolder,
  IconLink,
  IconMapPin,
  IconPlus,
  IconSearch,
  IconSparkles,
  IconStack2,
  IconTerminal2,
  IconTrash,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchUsageSummary } from "../api/analytics";
import { fetchDashboard } from "../api/dashboard";
import type { DashboardDoc } from "../api/types";
import ui from "../styles/redesign.module.css";
import { formatDateTime } from "../utils/dates";
import styles from "./DashboardPage.module.css";

const PROJECT_COLORS = ["--primary", "--violet", "--blue", "--green", "--yellow", "--red"];

function fmtChars(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function sourceChip(source: string | null): { icon: typeof IconMapPin; label: string; agent: boolean } {
  const s = (source ?? "manual").toLowerCase();
  switch (s) {
    case "agent":
      return { icon: IconSparkles, label: "agent", agent: true };
    case "cli":
      return { icon: IconTerminal2, label: "cli", agent: false };
    case "file":
      return { icon: IconFileText, label: "file", agent: false };
    case "paste":
      return { icon: IconFileText, label: "paste", agent: false };
    case "url":
      return { icon: IconLink, label: "url", agent: false };
    default:
      return { icon: IconMapPin, label: s, agent: false };
  }
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [quick, setQuick] = useState("");
  const { data } = useQuery({ queryKey: ["dashboard"], queryFn: fetchDashboard });

  // Agent activity over the last 30 days (from the usage log, if tracking is on).
  const since = useMemo(() => new Date(Date.now() - 30 * 864e5).toISOString(), []);
  const { data: usage } = useQuery({
    queryKey: ["usage-summary-30d", since],
    queryFn: () => fetchUsageSummary({ start: since }),
    staleTime: 60_000,
  });
  const pathOps = (p: string) =>
    usage?.ops_by_access_path.find((x) => x.access_path === p)?.count ?? 0;
  const mcpOps = pathOps("remote-mcp") + pathOps("local-mcp");
  const efOps = pathOps("edge-function");
  const agentOps = mcpOps + efOps;

  const projectMap = new Map((data?.projects ?? []).map((p) => [p.id, p.name]));
  const colorMap = new Map(
    (data?.projects ?? []).map((p, i) => [p.id, PROJECT_COLORS[i % PROJECT_COLORS.length]]),
  );
  const docCounts = data?.project_doc_counts ?? {};
  const trashCounts = data?.project_deleted_doc_counts ?? {};
  const trashTotal = Object.values(trashCounts).reduce((a, b) => a + b, 0);
  const maxDocs = Math.max(1, ...Object.values(docCounts));

  const goSearch = () => {
    const q = quick.trim();
    navigate(q ? `/search?q=${encodeURIComponent(q)}&mode=docs` : "/search");
  };

  const projColor = (doc: DashboardDoc) =>
    `var(${colorMap.get(doc.project_ids[0]) ?? "--border"})`;

  return (
    <div className={styles.wrap}>
      {/* hero */}
      <div className={`${styles.dashHero} ${ui.rise}`}>
        <div style={{ minWidth: 0 }}>
          <p className={ui.eyebrow}>Memory layer · online</p>
          <h1 className={ui.pageTitle}>{greeting()}, operator.</h1>
        </div>
        <div className={styles.dashHeroActions}>
          <form
            className={styles.quickSearch}
            onSubmit={(e) => {
              e.preventDefault();
              goSearch();
            }}
          >
            <IconSearch size={16} />
            <input
              value={quick}
              onChange={(e) => setQuick(e.currentTarget.value)}
              placeholder="Quick search…"
            />
            <button type="submit" className={styles.qsGo} aria-label="Search">
              <IconArrowRight size={15} />
            </button>
          </form>
          <button
            type="button"
            className={`${ui.btn} ${ui.btnPrimary}`}
            onClick={() => navigate("/ingest")}
          >
            <IconPlus size={16} />
            Ingest content
          </button>
        </div>
      </div>

      {/* stat strip */}
      <div className={styles.statGrid}>
        <div className={`${ui.card} ${styles.statTile} ${ui.rise}`}>
          <div className={styles.statTop}>
            <span className={`${styles.statIco} ${ui.bPrimary}`}>
              <IconDatabase size={18} />
            </span>
            {trashTotal > 0 && (
              <span className={`${ui.badge} ${ui.bNeutral}`}>{trashTotal} docs in trash</span>
            )}
          </div>
          <div className={styles.statValue}>{(data?.doc_count ?? 0).toLocaleString()}</div>
          <div className={styles.statLabel}>Documents</div>
        </div>

        <div className={`${ui.card} ${styles.statTile} ${ui.rise}`}>
          <div className={styles.statTop}>
            <span className={`${styles.statIco} ${ui.bViolet}`}>
              <IconStack2 size={18} />
            </span>
            <span className={`${ui.badge} ${ui.bViolet}`}>
              {fmtChars(data?.total_chars ?? 0)} chars
            </span>
          </div>
          <div className={styles.statValue}>{(data?.total_chunks ?? 0).toLocaleString()}</div>
          <div className={styles.statLabel}>Indexed chunks</div>
        </div>

        <div className={`${ui.card} ${styles.statTile} ${ui.rise}`}>
          <div className={styles.statTop}>
            <span className={`${styles.statIco} ${ui.bBlue}`}>
              <IconFolder size={18} />
            </span>
          </div>
          <div className={styles.statValue}>{data?.project_count ?? 0}</div>
          <div className={styles.statLabel}>Projects</div>
        </div>

        {/* Agent activity — ops via MCP/edge-function paths over the last 30 days */}
        <div className={`${ui.card} ${styles.statTile} ${ui.rise}`}>
          <div className={styles.statTop}>
            <span className={`${styles.statIco} ${ui.bGreen}`}>
              <IconSparkles size={18} />
            </span>
            {agentOps > 0 ? (
              <span className={`${ui.badge} ${ui.bGreen}`}>
                {mcpOps.toLocaleString()} mcp · {efOps.toLocaleString()} edge
              </span>
            ) : (
              <Popover width={260} position="bottom-end" withArrow shadow="md">
                <Popover.Target>
                  <button type="button" className={ui.whatis}>
                    Why no data?
                  </button>
                </Popover.Target>
                <Popover.Dropdown>
                  <Text size="xs" c="dimmed">
                    No agent activity (MCP or Edge Function) in the last 30 days. Agent ops are
                    recorded in the usage log, which is <b>opt-in</b> — enable it with{" "}
                    <code>cerefox config set usage_tracking_enabled true</code> if it's off.
                  </Text>
                </Popover.Dropdown>
              </Popover>
            )}
          </div>
          <div className={agentOps > 0 ? styles.statValue : styles.emptyVal}>
            {agentOps > 0 ? agentOps.toLocaleString() : "—"}
          </div>
          <div className={styles.statLabel}>Agent operations · 30d</div>
        </div>
      </div>

      {/* main split */}
      <div className={styles.dashSplit}>
        <section className={ui.rise}>
          <div className={ui.secHead}>
            <h2 className={ui.secTitle}>
              <IconClock size={16} />
              Recently changed documents
            </h2>
            <button
              type="button"
              className={`${ui.btn} ${ui.btnSubtle}`}
              onClick={() => navigate("/search")}
            >
              View all
              <IconArrowRight size={14} />
            </button>
          </div>
          <div className={ui.card} style={{ overflow: "hidden" }}>
            <table className={styles.tbl}>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Origin</th>
                  <th className={styles.alignRight}>Chunks</th>
                  <th className={styles.alignRight}>Size</th>
                  <th className={styles.alignRight}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {(data?.recent_docs ?? []).map((doc) => {
                  const chip = sourceChip(doc.source);
                  const ChipIcon = chip.icon;
                  const pending = doc.review_status !== "approved";
                  return (
                    <tr key={doc.id} onClick={() => navigate(`/document/${doc.id}`)}>
                      <td>
                        <div className={styles.docCell}>
                          <span className={styles.docDot} style={{ background: projColor(doc) }} />
                          <div className={ui.col} style={{ gap: 3, minWidth: 0 }}>
                            <span className={`${ui.link} ${styles.docTitle}`}>
                              {doc.title || "Untitled"}
                            </span>
                            <div className={ui.row} style={{ gap: 6 }}>
                              {doc.project_ids
                                .filter((pid) => projectMap.has(pid))
                                .slice(0, 1)
                                .map((pid) => (
                                  <span key={pid} className={`${ui.badge} ${ui.bNeutral}`}>
                                    {projectMap.get(pid)}
                                  </span>
                                ))}
                              {pending && (
                                <span className={`${ui.badge} ${ui.bYellow}`}>
                                  <span
                                    style={{
                                      width: 6,
                                      height: 6,
                                      borderRadius: "50%",
                                      background: "currentColor",
                                    }}
                                  />
                                  pending review
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`${ui.srcChip} ${chip.agent ? ui.srcChipAgent : ""}`}>
                          <ChipIcon size={12} />
                          {chip.label}
                        </span>
                      </td>
                      <td className={`${styles.alignRight} ${ui.mono} ${ui.dim}`}>
                        {doc.chunk_count}
                      </td>
                      <td className={`${styles.alignRight} ${ui.mono} ${ui.dim}`}>
                        {doc.total_chars.toLocaleString()}
                      </td>
                      <td className={`${styles.alignRight} ${ui.faint}`}>
                        {formatDateTime(doc.updated_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <aside className={styles.dashRail}>
          <section className={ui.rise} style={{ minHeight: 0 }}>
            <div className={ui.secHead}>
              <h2 className={ui.secTitle}>
                <IconStack2 size={16} />
                Projects <span className={ui.countPill}>{data?.project_count ?? 0}</span>
              </h2>
              <button
                type="button"
                className={`${ui.btn} ${ui.btnSubtle}`}
                onClick={() => navigate("/projects")}
              >
                Manage
              </button>
            </div>
            <div className={`${ui.card} ${styles.projList}`}>
              <div className={styles.projScroll}>
                {(data?.projects ?? []).map((p) => {
                  const docs = docCounts[p.id] ?? 0;
                  const trash = trashCounts[p.id] ?? 0;
                  const color = `var(${colorMap.get(p.id) ?? "--border"})`;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={styles.projRow}
                      onClick={() => navigate(`/projects/${p.id}/documents`)}
                    >
                      <span className={styles.projDot} style={{ background: color }} />
                      <div className={ui.col} style={{ gap: 5, minWidth: 0, flex: 1 }}>
                        <div className={ui.row} style={{ justifyContent: "space-between", gap: 8 }}>
                          <span className={styles.projName}>{p.name}</span>
                          <span className={styles.projCounts}>
                            <span>{docs}</span>
                            {trash > 0 && (
                              <span className={styles.trashCount} title={`${trash} in trash`}>
                                <IconTrash size={11} />
                                {trash}
                              </span>
                            )}
                          </span>
                        </div>
                        <div className={styles.projBar}>
                          <span style={{ width: `${(docs / maxDocs) * 100}%`, background: color }} />
                        </div>
                      </div>
                      <span className={styles.projChev}>
                        <IconChevronRight size={15} />
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className={styles.projFoot}>
                <span>{data?.project_count ?? 0} projects</span>
                <span className={ui.faint}>{trashTotal} docs in trash</span>
              </div>
            </div>
          </section>

          <section className={`${ui.card} ${ui.cliCard} ${ui.rise}`}>
            <div className={ui.row} style={{ gap: 8, marginBottom: 10 }}>
              <IconTerminal2 size={15} />
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>Same memory, your terminal</span>
              <button
                type="button"
                className={ui.whatis}
                style={{ marginLeft: "auto" }}
                onClick={() => navigate("/help/guides/cli.md")}
              >
                cli docs
              </button>
            </div>
            <div className={ui.cliBlock}>
              <div>
                <span className={ui.cliP}>$</span> cerefox search{" "}
                <span className={ui.cliS}>"retry backoff"</span>
              </div>
              <div className={ui.cliOut}>→ 5 results · top 92% match</div>
              <div style={{ marginTop: 6 }}>
                <span className={ui.cliP}>$</span> cerefox document ingest ./rfc-018.md
              </div>
              <div className={ui.cliOut}>→ staged in research-notes</div>
            </div>
            <p className={ui.faint} style={{ fontSize: 12, margin: "10px 0 0", lineHeight: 1.5 }}>
              The same memory from your terminal or any MCP agent — most actions
              have CLI, MCP, and web parity.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
