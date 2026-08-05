import { Alert } from "@mantine/core";
import { IconCheck, IconFileText, IconPlus, IconSearch, IconUpload, IconX } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { detectV07FromResponse } from "../api/client";
import { checkFilename, ingestPaste } from "../api/documents";
import type { FilenameCheckResponse, IngestResponse } from "../api/types";
import { CliCard } from "../components/CliCard";
import { MarkdownViewer } from "../components/MarkdownViewer";
import { useMetadataKeys, useProjects } from "../hooks/useProjects";
import { showError, showV07DeferredToast } from "../utils/notifications";
import ui from "../styles/redesign.module.css";
import styles from "./IngestPage.module.css";

const PROJECT_COLORS = ["--primary", "--violet", "--blue", "--green", "--yellow", "--red"];

type Tab = "paste" | "file";

export function IngestPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: projects } = useProjects();
  const { data: metadataKeys } = useMetadataKeys();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<Tab>("paste");
  const [title, setTitle] = useState("");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [projFilter, setProjFilter] = useState("");
  const [metaPairs, setMetaPairs] = useState<{ key: string; value: string }[]>([]);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [content, setContent] = useState("");
  const [contentView, setContentView] = useState<"edit" | "preview">("edit");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [filenameCheck, setFilenameCheck] = useState<FilenameCheckResponse | null>(null);
  const [result, setResult] = useState<IngestResponse | null>(null);

  const collectMeta = () => {
    const metadata: Record<string, string> = {};
    for (const p of metaPairs) {
      if (p.key.trim() && p.value.trim()) metadata[p.key.trim()] = p.value.trim();
    }
    return metadata;
  };

  const onIngestSuccess = (res: IngestResponse) => {
    setResult(res);
    if (res.success) queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const onIngestError = (err: unknown) => {
    if (!showV07DeferredToast(err)) {
      showError("Ingest failed", err instanceof Error ? err.message : String(err));
    }
  };

  const pasteMutation = useMutation({
    mutationFn: () =>
      ingestPaste({
        title,
        content,
        update_existing: updateExisting,
        project_ids: projectIds,
        metadata: collectMeta(),
      }),
    onSuccess: onIngestSuccess,
    onError: onIngestError,
  });

  const fileMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file selected");
      const formData = new FormData();
      formData.append("file", file);
      if (title.trim()) formData.append("title", title.trim());
      formData.append("update_existing", String(updateExisting));
      if (projectIds.length > 0) formData.append("project_ids", projectIds.join(","));
      const meta = collectMeta();
      if (Object.keys(meta).length > 0) formData.append("metadata", JSON.stringify(meta));
      const resp = await fetch("/api/v1/ingest/file", { method: "POST", body: formData });
      if (!resp.ok) {
        const v07 = await detectV07FromResponse(resp);
        if (v07) throw v07;
        throw new Error(`Upload failed: ${resp.status}`);
      }
      return resp.json() as Promise<IngestResponse>;
    },
    onSuccess: onIngestSuccess,
    onError: onIngestError,
  });

  const handleFile = async (f: File | null) => {
    setFile(f);
    setFilenameCheck(null);
    if (f?.name) {
      try {
        const check = await checkFilename(f.name);
        setFilenameCheck(check);
        if (check.exists) setUpdateExisting(true);
      } catch {
        /* ignore check errors */
      }
    }
  };

  const toggleProject = (id: string) =>
    setProjectIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = () => (tab === "file" ? fileMutation.mutate() : pasteMutation.mutate());
  const pending = pasteMutation.isPending || fileMutation.isPending;
  const canSubmit =
    tab === "file" ? !!file : title.trim().length > 0 && content.trim().length > 0;

  const chunkEstimate =
    tab === "paste"
      ? Math.round(content.length / 700)
      : file
        ? Math.round(file.size / 700)
        : 0;

  const firstProjectName =
    projects?.find((p) => p.id === projectIds[0])?.name ?? "core-platform";

  const allProjects = projects ?? [];
  const visibleProjects = projFilter
    ? allProjects.filter((p) => p.name.toLowerCase().includes(projFilter.toLowerCase()))
    : allProjects;

  return (
    <div className={styles.wrap}>
      <div className={ui.pageHead}>
        <div>
          <p className={ui.eyebrow}>Add to memory</p>
          <h1 className={ui.pageTitle} data-testid="page-title">Ingest content</h1>
        </div>
      </div>

      {result?.success && (
        <Alert
          icon={<IconCheck size={16} />}
          title={result.updated ? "Updated" : "Ingested"}
          color="green"
          mb="md"
          withCloseButton
          onClose={() => setResult(null)}
        >
          {result.updated
            ? `"${result.title}" updated and re-indexed.`
            : `"${result.title}" ingested successfully.`}{" "}
          {result.document_id && (
            <span
              style={{ cursor: "pointer", textDecoration: "underline", color: "var(--primary)" }}
              onClick={() => navigate(`/document/${result.document_id}`)}
            >
              View document
            </span>
          )}
        </Alert>
      )}
      {result && !result.success && result.error && (
        <Alert
          icon={<IconX size={16} />}
          title="Error"
          color="red"
          mb="md"
          withCloseButton
          onClose={() => setResult(null)}
        >
          {result.error}
        </Alert>
      )}

      <div className={ui.seg} style={{ marginBottom: 20 }}>
        <button
          type="button"
          className={`${ui.segBtn} ${tab === "paste" ? ui.segBtnOn : ""}`}
          onClick={() => setTab("paste")}
        >
          <IconFileText size={14} />
          Paste content
        </button>
        <button
          type="button"
          className={`${ui.segBtn} ${tab === "file" ? ui.segBtnOn : ""}`}
          onClick={() => setTab("file")}
        >
          <IconUpload size={14} />
          Upload file
        </button>
      </div>

      <form
        className={styles.split}
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) submit();
        }}
      >
        <div className={styles.col}>
          {/* common fields stay put across tabs */}
          <div className={styles.field}>
            <label>
              Title
              {tab === "file" && <span className={ui.faint}> (optional — defaults to filename)</span>}
            </label>
            <input
              className={styles.input}
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value)}
              placeholder="Document title"
            />
          </div>

          {allProjects.length > 0 && (
            <div className={styles.field}>
              <label>Projects</label>
              {allProjects.length > 8 && (
                <div className={ui.selectWrap} style={{ width: "100%", marginBottom: 8, height: 34 }}>
                  <IconSearch size={14} />
                  <input
                    className={ui.selectEl}
                    style={{ maxWidth: "none", flex: 1 }}
                    placeholder={`Filter ${allProjects.length} projects…`}
                    value={projFilter}
                    onChange={(e) => setProjFilter(e.currentTarget.value)}
                  />
                </div>
              )}
              <div className={ui.row} style={{ gap: 7, flexWrap: "wrap" }}>
                {visibleProjects.map((p) => {
                  const idx = allProjects.indexOf(p);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`${ui.chip} ${projectIds.includes(p.id) ? ui.chipOn : ""}`}
                      onClick={() => toggleProject(p.id)}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: `var(${PROJECT_COLORS[idx % PROJECT_COLORS.length]})`,
                        }}
                      />
                      {p.name}
                    </button>
                  );
                })}
                {visibleProjects.length === 0 && (
                  <span className={ui.faint} style={{ fontSize: 12.5 }}>
                    No projects match "{projFilter}".
                  </span>
                )}
              </div>
            </div>
          )}

          <div className={styles.field}>
            <label>
              Metadata <span className={ui.faint}>(optional)</span>
            </label>
            <datalist id="cerefox-meta-keys">
              {metadataKeys?.map((mk) => (
                <option key={mk.key} value={mk.key} />
              ))}
            </datalist>
            <div className={ui.col} style={{ gap: 8 }}>
              {metaPairs.map((p, i) => (
                <div key={i} className={ui.row} style={{ gap: 8 }}>
                  <input
                    className={styles.input}
                    style={{ flex: 1 }}
                    list="cerefox-meta-keys"
                    placeholder="key"
                    value={p.key}
                    onChange={(e) =>
                      setMetaPairs((m) =>
                        m.map((x, idx) => (idx === i ? { ...x, key: e.currentTarget.value } : x)),
                      )
                    }
                  />
                  <input
                    className={styles.input}
                    style={{ flex: 1 }}
                    placeholder="value"
                    value={p.value}
                    onChange={(e) =>
                      setMetaPairs((m) =>
                        m.map((x, idx) => (idx === i ? { ...x, value: e.currentTarget.value } : x)),
                      )
                    }
                  />
                  <button
                    type="button"
                    className={ui.iconBtn}
                    aria-label="Remove"
                    onClick={() => setMetaPairs((m) => m.filter((_, idx) => idx !== i))}
                  >
                    <IconX size={15} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={`${ui.btn} ${ui.btnSubtle}`}
                style={{ alignSelf: "flex-start" }}
                onClick={() => setMetaPairs((m) => [...m, { key: "", value: "" }])}
              >
                <IconPlus size={14} />
                Add field
              </button>
            </div>
          </div>

          {/* tab-specific primary input (same slot for both tabs) */}
          {tab === "file" ? (
            <div className={styles.field}>
              <label>File</label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.txt,.docx"
                style={{ display: "none" }}
                onChange={(e) => handleFile(e.currentTarget.files?.[0] ?? null)}
              />
              <div
                className={`${styles.dropZone} ${dragOver ? styles.dropZoneOver : ""} ${file ? styles.dropZoneHas : ""}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) handleFile(f);
                }}
              >
                <span className={styles.dropIco}>
                  <IconUpload size={20} />
                </span>
                {file ? (
                  <>
                    <div className={ui.mono} style={{ fontWeight: 600, fontSize: 14, marginTop: 10 }}>
                      {file.name}
                    </div>
                    <span className={ui.faint} style={{ fontSize: 12.5 }}>
                      Ready to ingest · click to replace
                    </span>
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight: 600, fontSize: 14, marginTop: 10 }}>
                      Drop a file or click to browse
                    </div>
                    <span className={ui.faint} style={{ fontSize: 12.5 }}>
                      .md · .txt · .docx
                    </span>
                  </>
                )}
              </div>
              {filenameCheck?.exists && (
                <Alert color="blue" variant="light" mt="sm">
                  A document named "{filenameCheck.title}" already exists (updated{" "}
                  {filenameCheck.updated_at
                    ? new Date(filenameCheck.updated_at).toLocaleDateString()
                    : "unknown"}
                  ). Enable "Update existing" to overwrite it.
                </Alert>
              )}
            </div>
          ) : (
            <div className={styles.field}>
              <div className={ui.row} style={{ justifyContent: "space-between", marginBottom: 8 }}>
                <label style={{ margin: 0 }}>Content</label>
                <div className={ui.seg} style={{ padding: 2 }}>
                  <button
                    type="button"
                    className={`${ui.segBtn} ${contentView === "edit" ? ui.segBtnOn : ""}`}
                    style={{ padding: "4px 10px" }}
                    onClick={() => setContentView("edit")}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={`${ui.segBtn} ${contentView === "preview" ? ui.segBtnOn : ""}`}
                    style={{ padding: "4px 10px" }}
                    onClick={() => setContentView("preview")}
                  >
                    Preview
                  </button>
                </div>
              </div>
              {contentView === "edit" ? (
                <textarea
                  className={`${styles.input} ${styles.textarea}`}
                  value={content}
                  onChange={(e) => setContent(e.currentTarget.value)}
                  placeholder="# Paste your Markdown here…"
                />
              ) : (
                <div className={`${ui.card} ${ui.cardPad} ${styles.preview}`}>
                  {content.trim() ? (
                    <MarkdownViewer content={content} defaultView="rendered" maxHeight={400} showToggle={false} />
                  ) : (
                    <span className={ui.faint}>Nothing to preview yet.</span>
                  )}
                </div>
              )}
            </div>
          )}

          <div className={styles.actions}>
            <button type="submit" className={`${ui.btn} ${ui.btnPrimary}`} disabled={!canSubmit || pending}>
              <IconCheck size={16} />
              {tab === "file" ? "Upload & ingest" : "Ingest"}
            </button>
            <label className={styles.toggleRow}>
              <button
                type="button"
                className={`${styles.toggle} ${updateExisting ? styles.toggleOn : ""}`}
                role="switch"
                aria-checked={updateExisting}
                onClick={() => setUpdateExisting((v) => !v)}
              >
                <span />
              </button>
              <span style={{ fontSize: 13 }}>Update existing if title matches</span>
            </label>
          </div>
        </div>

        {/* rail */}
        <aside className={styles.col}>
          <div className={`${ui.card} ${ui.cardPad} ${ui.rise}`}>
            <div className={ui.mono} style={{ fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 12 }}>
              Pipeline
            </div>
            <ol className={styles.steps}>
              <li>
                <span className={styles.stepN}>1</span>
                <div>
                  <b>Chunked</b>
                  <span className="faint">
                    Split on headings into ~{chunkEstimate || "—"} semantic chunks.
                  </span>
                </div>
              </li>
              <li>
                <span className={styles.stepN}>2</span>
                <div>
                  <b>Embedded</b>
                  <span className="faint">Each chunk vectorized for semantic search.</span>
                </div>
              </li>
              <li>
                <span className={styles.stepN}>3</span>
                <div>
                  <b>Staged</b>
                  <span className="faint">Indexed and discoverable by your agents.</span>
                </div>
              </li>
            </ol>
          </div>

          <CliCard
            title="CLI equivalent"
            commands={[
              {
                cmd: "cerefox document ingest",
                args: `./${file?.name ?? "doc.md"} --project-name ${firstProjectName}`,
              },
            ]}
          />
        </aside>
      </form>
    </div>
  );
}
