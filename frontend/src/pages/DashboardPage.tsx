import { Popover, Text } from "@mantine/core";
import {
  IconArrowRight,
  IconChevronDown,
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
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { fetchUsageSummary } from "../api/analytics";
import { deriveAccessPathStats } from "../lib/access-path-stats";
import { CliCard } from "../components/CliCard";
import { fetchDashboard, fetchDashboardRecent } from "../api/dashboard";
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

// Agent activity window: last 30 days, anchored at app load (avoids impure
// Date.now() during render, per react-hooks purity rules).
const SINCE_30D = new Date(Date.now() - 30 * 864e5).toISOString();

export function DashboardPage() {
  const navigate = useNavigate();
  const [quick, setQuick] = useState("");
  // The aggregate dashboard keeps its plain (shared) cache key — SearchPage
  // and ProjectsPage read the same entry. The recently-changed tile has its
  // own scoped query against the light /dashboard/recent-docs route, so
  // flipping the selector refetches 10 rows, not seven aggregate query
  // groups. keepPreviousData stops the tile flashing during the swap.
  const [recentProject, setRecentProject] = useState("");
  const { data } = useQuery({ queryKey: ["dashboard"], queryFn: fetchDashboard });
  const { data: recent } = useQuery({
    queryKey: ["dashboard-recent", recentProject],
    queryFn: () => fetchDashboardRecent(recentProject || undefined),
    placeholderData: keepPreviousData,
  });

  const since = SINCE_30D;
  const { data: usage } = useQuery({
    queryKey: ["usage-summary-30d", since],
    queryFn: () => fetchUsageSummary({ start: since }),
    staleTime: 60_000,
  });
  const {
    localMcpOps,
    remoteMcpOps,
    efOps,
    apiOps,
    agentOps,
    cliOps,
    webOps,
  } = deriveAccessPathStats(usage?.ops_by_access_path);

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
          <h1 className={ui.pageTitle} data-testid="page-title">{greeting()}, operator.</h1>
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
              <span
                className={`${ui.badge} ${ui.bGreen}`}
                title="MCP transports, last 30 days. Other paths are listed below the count."
              >
                {localMcpOps.toLocaleString()} local · {remoteMcpOps.toLocaleString()} remote
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
                    No agent activity on the MCP or Edge Function paths in the last 30 days.
                    That is not the same as "no agents" — CLI and web operations are counted
                    separately below, and the Edge Function path is only used by ChatGPT
                    Actions, so a zero there is normal unless you run a Custom GPT. Agent ops
                    are recorded in the usage log, which is <b>opt-in</b> — enable it with{" "}
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
          {/* #195: the tile counted transports, not actors, and said nothing
              about the two busiest paths. CLI is shown separately because the
              summary cannot tell an agent's CLI use from a human's. */}
          {/* #205: the pill holds the two MCP transports — the agent paths that
              make up the headline count — and everything else lives here. The
              earlier split put three paths above and two below with no visible
              logic, and the pill outgrew the header row the other tiles share.
              `edge` moves down because it is an agent path that is normally
              zero (ChatGPT Actions only), so it reads as noise in the badge and
              as information here. */}
          {(efOps > 0 || apiOps > 0 || cliOps > 0 || webOps > 0) && (
            <div
              className={styles.statSub}
              title="edge = ChatGPT Actions and api = an /api/v1 client that identified itself (both counted in the total above). cli and web are NOT counted as agent operations: the usage summary cannot separate an agent's CLI use from a person's, and web is the bundled UI."
            >
              {efOps.toLocaleString()} edge · {apiOps.toLocaleString()} api ·{" "}
              {cliOps.toLocaleString()} cli · {webOps.toLocaleString()} web
            </div>
          )}
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
            {/* Same control as the search page's project scope. Filters this
                tile only — the point is "what did agents change in X lately". */}
            <span className={ui.selectWrap} title="Scope recent documents to a project">
              <IconFolder size={14} />
              <select
                className={ui.selectEl}
                value={recentProject}
                data-testid="recent-project-select"
                onChange={(e) => setRecentProject(e.currentTarget.value)}
              >
                <option value="">All projects</option>
                {(data?.projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <IconChevronDown size={14} />
            </span>
          </div>
          <div className={ui.card} style={{ overflow: "hidden" }}>
            <table className={styles.tbl}>
              <thead>
                <tr>
                  <th className={styles.colDoc}>Document</th>
                  <th className={`${styles.colAuthor} ${styles.authorCell}`}>Author</th>
                  <th className={`${styles.colChunks} ${styles.alignRight}`}>Chunks</th>
                  <th className={`${styles.colSize} ${styles.alignRight}`}>Size</th>
                  <th className={`${styles.colUpdated} ${styles.alignRight}`}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {/* Scoped view NEVER falls back to the unscoped aggregate:
                    if the scoped fetch fails, showing all-project rows under
                    a project label misattributes documents. Unscoped may use
                    the aggregate as a warm-start. */}
                {(recentProject ? recent?.recent_docs ?? [] : recent?.recent_docs ?? data?.recent_docs ?? []).map((doc) => {
                  const chip = doc.author
                    ? {
                        icon: doc.author_type === "agent" ? IconSparkles : IconMapPin,
                        label: doc.author,
                        agent: doc.author_type === "agent",
                      }
                    : sourceChip(doc.source);
                  const ChipIcon = chip.icon;
                  const pending = doc.review_status !== "approved";
                  return (
                    <tr key={doc.id} data-testid="recent-doc-row" onClick={() => navigate(`/document/${doc.id}`)}>
                      <td>
                        <div className={styles.docCell}>
                          <span className={styles.docDot} style={{ background: projColor(doc) }} />
                          <div className={ui.col} style={{ gap: 3, minWidth: 0 }}>
                            {/* A real link, not just a row click (#165): keyboard
                                users can reach it, and cmd/middle-click, "copy
                                link", and hover preview all work again. The row
                                click below stays as a convenience. */}
                            <Link
                              to={`/document/${doc.id}`}
                              className={`${ui.link} ${styles.docTitle}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {doc.title || "Untitled"}
                            </Link>
                            <div className={styles.docBadges}>
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
                      {/* #206: the full identity stays in the title, so capping the
                          column costs nothing. */}
                      <td className={styles.authorCell} title={chip.label}>
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
                          {/* Real link for the same reasons as the document rows (#165). */}
                          <Link
                            to={`/projects/${p.id}/documents`}
                            className={styles.projName}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {p.name}
                          </Link>
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

          <CliCard
            title="Same memory, your terminal"
            commands={[
              { cmd: "cerefox search", args: '"retry backoff" --mode hybrid' },
              { cmd: "cerefox document ingest", args: "./rfc-018.md --project-name infra" },
            ]}
          />
        </aside>
      </div>
    </div>
  );
}
