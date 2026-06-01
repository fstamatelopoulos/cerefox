import { Loader, Menu, Modal, Popover, Text } from "@mantine/core";
import {
  IconArrowLeft,
  IconArrowsDiff,
  IconDots,
  IconDownload,
  IconEdit,
  IconFileText,
  IconLock,
  IconMapPin,
  IconSparkles,
  IconStack2,
  IconTerminal2,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useNavigate, useParams } from "react-router-dom";
import remarkGfm from "remark-gfm";

import { fetchAuditLog, setReviewStatus, setVersionArchived } from "../api/audit";
import {
  deleteDocument,
  fetchChunks,
  fetchDocument,
  fetchDocumentVersion,
  getDownloadUrl,
} from "../api/documents";
import { purgeDocument, restoreDocument } from "../api/trash";
import { DiffViewer } from "../components/DiffViewer";
import { MarkdownLink } from "../components/MarkdownLink";
import { useProjects } from "../hooks/useProjects";
import { formatDateTime } from "../utils/dates";
import { showError, showSuccess } from "../utils/notifications";
import md from "../components/MarkdownViewer.module.css";
import ui from "../styles/redesign.module.css";
import styles from "./DocumentPage.module.css";

type View = "rendered" | "source" | "chunks";

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function textOf(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: React.ReactNode } }).props.children);
  }
  return "";
}

interface TocEntry {
  level: number;
  text: string;
  id: string;
}
function extractToc(markdown: string): TocEntry[] {
  const out: TocEntry[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^(#{1,3})\s+(.+?)\s*#*$/);
    if (m) out.push({ level: m[1].length, text: m[2], id: slug(m[2]) });
  }
  return out;
}

function opColor(op: string): string {
  switch (op) {
    case "create":
      return "var(--green)";
    case "update-content":
      return "var(--blue)";
    case "update-metadata":
      return "var(--blue)";
    case "delete":
      return "var(--red)";
    case "status-change":
      return "var(--yellow)";
    case "archive":
      return "var(--violet)";
    case "unarchive":
      return "var(--primary)";
    default:
      return "var(--text-faint)";
  }
}

function originChip(source: string | null): { icon: typeof IconMapPin; label: string; agent: boolean } {
  const s = (source ?? "manual").toLowerCase();
  if (s === "agent") return { icon: IconSparkles, label: "agent", agent: true };
  if (s === "cli") return { icon: IconTerminal2, label: "cli", agent: false };
  if (s === "url") return { icon: IconFileText, label: "url", agent: false };
  return { icon: IconMapPin, label: s, agent: false };
}

export function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [view, setView] = useState<View>("rendered");

  const { data: doc, isLoading, error } = useQuery({
    queryKey: ["document", id],
    queryFn: () => fetchDocument(id!),
    enabled: !!id,
  });
  const { data: chunks, isLoading: chunksLoading } = useQuery({
    queryKey: ["document-chunks", id],
    queryFn: () => fetchChunks(id!),
    enabled: !!id,
  });
  const { data: auditEntries } = useQuery({
    queryKey: ["document-audit", id],
    queryFn: () => fetchAuditLog({ document_id: id!, limit: 50 }),
    enabled: !!id,
  });
  const { data: projects } = useProjects();
  const projectMap = new Map(projects?.map((p) => [p.id, p.name]) ?? []);

  const invalidateDoc = () => {
    queryClient.invalidateQueries({ queryKey: ["document", id] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["search"] });
    queryClient.invalidateQueries({ queryKey: ["trash"] });
  };

  const deleteMutation = useMutation({
    mutationFn: () => deleteDocument(id!),
    onSuccess: () => {
      invalidateDoc();
      showSuccess("Document moved to trash");
      navigate("/");
    },
    onError: (err) => showError("Delete failed", String(err)),
  });
  const restoreMutation = useMutation({
    mutationFn: () => restoreDocument(id!),
    onSuccess: () => {
      invalidateDoc();
      showSuccess("Document restored");
    },
    onError: (err) => showError("Restore failed", String(err)),
  });
  const purgeMutation = useMutation({
    mutationFn: () => purgeDocument(id!),
    onSuccess: () => {
      invalidateDoc();
      showSuccess("Document permanently deleted");
      navigate("/trash");
    },
    onError: (err) => showError("Purge failed", String(err)),
  });
  const reviewMutation = useMutation({
    mutationFn: (status: string) => setReviewStatus(id!, status),
    onSuccess: (_, status) => {
      queryClient.invalidateQueries({ queryKey: ["document", id] });
      showSuccess("Review status updated", status === "approved" ? "Approved" : "Pending review");
    },
    onError: (err) => showError("Status update failed", String(err)),
  });
  const archiveMutation = useMutation({
    mutationFn: ({ versionId, archived }: { versionId: string; archived: boolean }) =>
      setVersionArchived(id!, versionId, archived),
    onSuccess: (_, { archived }) => {
      queryClient.invalidateQueries({ queryKey: ["document", id] });
      showSuccess(archived ? "Version archived" : "Protection removed");
    },
    onError: (err) => showError("Archive update failed", String(err)),
  });

  const [diffVersionId, setDiffVersionId] = useState<string | null>(null);
  const [diffVersionContent, setDiffVersionContent] = useState<string | null>(null);
  const [diffVersionLabel, setDiffVersionLabel] = useState("");

  const openDiff = async (versionId: string, versionNumber: number) => {
    setDiffVersionId(versionId);
    setDiffVersionLabel(`v${versionNumber}`);
    try {
      const versionDoc = await fetchDocumentVersion(id!, versionId);
      setDiffVersionContent(versionDoc.full_content);
    } catch {
      showError("Failed to load version content");
      setDiffVersionId(null);
    }
  };

  const toc = useMemo(() => (doc ? extractToc(doc.full_content) : []), [doc]);

  const mdComponents = useMemo(
    () => ({
      a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
        <MarkdownLink {...props} fromDocId={doc?.document_id} />
      ),
      h1: ({ children }: { children?: React.ReactNode }) => (
        <h1 id={slug(textOf(children))}>{children}</h1>
      ),
      h2: ({ children }: { children?: React.ReactNode }) => (
        <h2 id={slug(textOf(children))}>{children}</h2>
      ),
      h3: ({ children }: { children?: React.ReactNode }) => (
        <h3 id={slug(textOf(children))}>{children}</h3>
      ),
    }),
    [doc?.document_id],
  );

  const goToHeading = (headingId: string) => {
    setView("rendered");
    setTimeout(() => {
      document.getElementById(headingId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  if (isLoading) {
    return (
      <div className={styles.wrap}>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 60 }}>
          <Loader />
        </div>
      </div>
    );
  }
  if (error || !doc) {
    return (
      <div className={styles.wrap}>
        <p style={{ color: "var(--red)", marginTop: 40 }}>
          {error ? String(error) : "Document not found."}
        </p>
      </div>
    );
  }

  const metaEntries = Object.entries(doc.doc_metadata || {});
  const approved = doc.review_status === "approved";
  const chip = originChip(doc.doc_source);
  const ChipIcon = chip.icon;

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={`${ui.btn} ${ui.btnSubtle} ${styles.backBtn}`}
        onClick={() => navigate(-1)}
      >
        <IconArrowLeft size={15} />
        Back
      </button>

      {/* header */}
      <div className={`${styles.docHeader} ${ui.rise}`}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p className={ui.eyebrow}>Document</p>
          <div className={ui.row} style={{ gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            {doc.project_ids
              .filter((pid) => projectMap.has(pid))
              .map((pid) => (
                <button
                  key={pid}
                  type="button"
                  className={`${ui.badge} ${ui.bNeutral}`}
                  style={{ cursor: "pointer", border: "1px solid transparent" }}
                  title={`View documents in ${projectMap.get(pid)}`}
                  onClick={() => navigate(`/projects/${pid}/documents`)}
                >
                  {projectMap.get(pid)}
                </button>
              ))}
          </div>
          <h1 className={styles.docTitle}>{doc.doc_title || "Untitled"}</h1>
          <div className={styles.docMeta}>
            <span className={`${ui.srcChip} ${chip.agent ? ui.srcChipAgent : ""}`}>
              <ChipIcon size={12} />
              {chip.label}
            </span>
            <span className={`${ui.mono} ${ui.faint}`}>{doc.chunk_count} chunks</span>
            <span className={`${ui.mono} ${ui.faint}`}>{doc.total_chars.toLocaleString()} chars</span>
            {doc.updated_at && (
              <span className={`${ui.mono} ${ui.faint}`}>updated {formatDateTime(doc.updated_at)}</span>
            )}
            <button
              type="button"
              className={styles.reviewPill}
              title="Click to toggle review status"
              onClick={() => reviewMutation.mutate(approved ? "pending_review" : "approved")}
              disabled={reviewMutation.isPending}
            >
              <span
                className="dot"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: approved ? "var(--green)" : "var(--yellow)",
                }}
              />
              {approved ? "Approved" : "Pending"}
            </button>
          </div>
        </div>
        <div className={ui.row} style={{ gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            className={`${ui.btn} ${ui.btnGhost}`}
            onClick={() => navigate(`/document/${id}/edit`)}
          >
            <IconEdit size={14} />
            Edit
          </button>
          <a className={`${ui.btn} ${ui.btnGhost}`} href={getDownloadUrl(id!)}>
            <IconDownload size={14} />
            Download
          </a>
          {!confirmDelete ? (
            <button
              type="button"
              className={`${ui.btn} ${ui.btnGhost} ${ui.btnDanger}`}
              title="Delete document"
              onClick={() => setConfirmDelete(true)}
            >
              <IconTrash size={14} />
              Delete
            </button>
          ) : (
            <div className={ui.row} style={{ gap: 6 }}>
              <button
                type="button"
                className={ui.btn}
                style={{ background: "var(--red)", color: "#fff" }}
                onClick={() => deleteMutation.mutate()}
              >
                Confirm
              </button>
              <button
                type="button"
                className={`${ui.btn} ${ui.btnSubtle}`}
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {doc.deleted_at && (
        <div className={styles.trashBanner}>
          <div className={ui.row} style={{ gap: 8 }}>
            <span className={`${ui.badge} ${ui.bNeutral}`} style={{ background: "var(--red)", color: "#fff" }}>
              Deleted
            </span>
            <span style={{ fontSize: 13 }}>
              In trash (deleted {doc.deleted_at.slice(0, 10)}) — excluded from search.
            </span>
          </div>
          <div className={ui.row} style={{ gap: 8 }}>
            <button type="button" className={`${ui.btn} ${ui.btnGhost}`} onClick={() => restoreMutation.mutate()}>
              Restore
            </button>
            <button
              type="button"
              className={ui.btn}
              style={{ background: "var(--red)", color: "#fff" }}
              onClick={() => purgeMutation.mutate()}
            >
              Delete permanently
            </button>
          </div>
        </div>
      )}

      <div className={styles.docSplit}>
        {/* content */}
        <div className={ui.rise} style={{ minWidth: 0 }}>
          <div className={ui.card}>
            <div className={styles.contentHead}>
              <div className={ui.seg}>
                <button
                  type="button"
                  className={`${ui.segBtn} ${view === "rendered" ? ui.segBtnOn : ""}`}
                  onClick={() => setView("rendered")}
                >
                  <IconFileText size={14} />
                  Rendered
                </button>
                <button
                  type="button"
                  className={`${ui.segBtn} ${view === "source" ? ui.segBtnOn : ""}`}
                  onClick={() => setView("source")}
                >
                  <IconTerminal2 size={14} />
                  Source
                </button>
                <button
                  type="button"
                  className={`${ui.segBtn} ${view === "chunks" ? ui.segBtnOn : ""}`}
                  onClick={() => setView("chunks")}
                >
                  <IconStack2 size={14} />
                  Chunks
                </button>
              </div>
              <span className={`${ui.mono} ${ui.faint}`} style={{ fontSize: 12 }}>
                {doc.total_chars.toLocaleString()} chars
              </span>
            </div>
            <div className={ui.divider} />

            <div className={styles.contentScroll}>
            {view === "rendered" && (
              <div className={styles.mdBody}>
                <div className={md.markdown}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                    {doc.full_content || "*(empty)*"}
                  </ReactMarkdown>
                </div>
              </div>
            )}
            {view === "source" && <pre className={styles.docSource}>{doc.full_content}</pre>}
            {view === "chunks" && (
              <div className={styles.chunkList}>
                {chunksLoading ? (
                  <div style={{ padding: 18 }}>
                    <Loader size="sm" />
                  </div>
                ) : (
                  chunks?.map((c, i) => (
                    <div key={c.chunk_id} className={styles.chunkItem}>
                      <div className={`${styles.chunkHead} ${ui.mono}`}>
                        <span className={`${ui.badge} ${ui.bNeutral}`}>chunk {i + 1}</span>
                        <span className={ui.faint}>
                          {c.heading_path.length > 0 ? c.heading_path.join(" › ") : "(preamble)"}
                        </span>
                      </div>
                      <p className={styles.chunkBody}>{c.content}</p>
                    </div>
                  ))
                )}
              </div>
            )}
            </div>
          </div>
        </div>

        {/* rail */}
        <aside className={styles.docRail}>
          {toc.length > 0 && (
            <div className={`${ui.card} ${ui.cardPad} ${ui.rise}`}>
              <div className={styles.railTitle}>Contents</div>
              <div className={styles.toc}>
                {toc.map((t, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={`${styles.tocLink} ${t.level === 2 ? styles.tocLvl2 : ""} ${t.level === 3 ? styles.tocLvl3 : ""}`}
                    onClick={() => goToHeading(t.id)}
                  >
                    {t.text}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={`${ui.card} ${ui.cardPad} ${ui.rise}`}>
            <div className={styles.railTitle}>Details</div>
            <dl className={styles.metaDl}>
              {doc.created_at && (
                <>
                  <dt>Created</dt>
                  <dd>{new Date(doc.created_at).toLocaleDateString()}</dd>
                </>
              )}
              {doc.updated_at && (
                <>
                  <dt>Updated</dt>
                  <dd>{new Date(doc.updated_at).toLocaleDateString()}</dd>
                </>
              )}
              <dt>Origin</dt>
              <dd className={ui.mono}>{doc.doc_source ?? "manual"}</dd>
            </dl>
            {metaEntries.length > 0 && (
              <>
                <div className={ui.divider} style={{ margin: "12px 0" }} />
                <div className={styles.railTitle} style={{ marginBottom: 8 }}>
                  Metadata
                </div>
                <div className={styles.metaTags}>
                  {metaEntries.map(([k, v]) => (
                    <span key={k} className={styles.metaTag}>
                      <b>{k}:</b>
                      {String(v)}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          {doc.versions.length > 0 && (
            <div className={`${ui.card} ${ui.cardPad} ${ui.rise}`}>
              <div className={styles.railTitle}>
                Versions <span className={ui.countPill}>{doc.versions.length}</span>
                <Popover width={240} position="bottom-end" withArrow shadow="md">
                  <Popover.Target>
                    <button type="button" className={ui.whatis} style={{ marginLeft: "auto" }}>
                      what's protection?
                    </button>
                  </Popover.Target>
                  <Popover.Dropdown>
                    <Text size="xs" c="dimmed">
                      Archived (protected) versions are kept indefinitely and excluded from
                      automatic cleanup. Unprotected older versions may be pruned by retention.
                      Toggle protection from a version's ⋯ menu.
                    </Text>
                  </Popover.Dropdown>
                </Popover>
              </div>
              <div className={styles.verList}>
                {doc.versions.map((v) => (
                  <div key={v.version_id} className={styles.verRow}>
                    <span className={`${ui.badge} ${ui.bNeutral} ${ui.mono}`}>v{v.version_number}</span>
                    <span className={`${ui.faint} ${ui.mono}`} style={{ fontSize: 11 }}>
                      {new Date(v.created_at).toLocaleDateString()}
                    </span>
                    {v.archived && (
                      <span className={styles.verLock} title="Archived — protected from cleanup">
                        <IconLock size={12} />
                      </span>
                    )}
                    <Menu position="bottom-end" withinPortal shadow="md" width={180}>
                      <Menu.Target>
                        <button
                          type="button"
                          className={ui.iconBtn}
                          style={{ width: 26, height: 26, marginLeft: "auto" }}
                          aria-label="Version actions"
                        >
                          <IconDots size={14} />
                        </button>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item
                          leftSection={<IconArrowsDiff size={14} />}
                          onClick={() => openDiff(v.version_id, v.version_number)}
                        >
                          Diff vs current
                        </Menu.Item>
                        <Menu.Item
                          leftSection={<IconDownload size={14} />}
                          component="a"
                          href={getDownloadUrl(id!, v.version_id)}
                        >
                          Download
                        </Menu.Item>
                        <Menu.Item
                          leftSection={<IconLock size={14} />}
                          color={v.archived ? "yellow" : undefined}
                          onClick={() =>
                            archiveMutation.mutate({ versionId: v.version_id, archived: !v.archived })
                          }
                        >
                          {v.archived ? "Remove protection" : "Archive (protect)"}
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={`${ui.card} ${ui.cardPad} ${ui.rise}`}>
            <div className={styles.railTitle}>Activity</div>
            {!auditEntries?.length ? (
              <span className={ui.faint} style={{ fontSize: 12 }}>
                No recorded activity.
              </span>
            ) : (
              <div className={styles.actList}>
                {auditEntries.map((e) => {
                  const delta =
                    e.size_before != null && e.size_after != null ? e.size_after - e.size_before : 0;
                  return (
                    <div key={e.id} className={styles.actRow}>
                      <span className={styles.actDot} style={{ background: opColor(e.operation) }} />
                      <div className={ui.col} style={{ gap: 2, minWidth: 0 }}>
                        <span style={{ fontSize: 12.5 }}>{e.description || e.operation}</span>
                        <span className={ui.faint} style={{ fontSize: 11 }}>
                          <span className={e.author_type === "agent" ? styles.actAgent : ""}>
                            {e.author}
                          </span>{" "}
                          · {new Date(e.created_at).toLocaleDateString()}
                          {delta > 0 && (
                            <span className={ui.mono} style={{ color: "var(--green)" }}>
                              {" "}
                              +{delta.toLocaleString()}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </div>

      <Modal
        opened={diffVersionId !== null && diffVersionContent !== null}
        onClose={() => {
          setDiffVersionId(null);
          setDiffVersionContent(null);
        }}
        title={`Diff: ${diffVersionLabel} vs current`}
        size="xl"
      >
        {diffVersionContent !== null && (
          <DiffViewer
            oldContent={diffVersionContent}
            newContent={doc.full_content}
            oldLabel={diffVersionLabel}
            newLabel="Current"
          />
        )}
      </Modal>
    </div>
  );
}
