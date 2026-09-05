import { Select } from "@mantine/core";
import { IconArrowBackUp, IconTrash, IconTrashX } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchTrash, purgeDocument, restoreDocument, type DeletedDocument } from "../api/trash";
import { CliCard } from "../components/CliCard";
import { EmptyTrashModal } from "../components/EmptyTrashModal";
import { ListPage, type ListColumn } from "../components/ListPage";
import { useProjects } from "../hooks/useProjects";
import { invalidateDocumentViews } from "../lib/invalidate";
import { showError, showSuccess } from "../utils/notifications";
import ui from "../styles/redesign.module.css";

const PROJECT_COLORS = ["--primary", "--violet", "--blue", "--green", "--yellow", "--red"];
function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `var(${PROJECT_COLORS[h % PROJECT_COLORS.length]})`;
}

export function TrashPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: projects } = useProjects();
  const projectMap = new Map(projects?.map((p) => [p.id, p.name]) ?? []);

  const [limit, setLimit] = useState("50");
  const [query, setQuery] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [emptyOpen, setEmptyOpen] = useState(false);

  const { data: docs, isLoading } = useQuery({
    queryKey: ["trash", limit],
    queryFn: () => fetchTrash(Number(limit)),
    staleTime: 10_000,
  });

  const invalidate = () => invalidateDocumentViews(queryClient);
  const restoreMut = useMutation({
    mutationFn: restoreDocument,
    onSuccess: () => {
      invalidate();
      showSuccess("Document restored");
    },
    onError: (e) => showError("Restore failed", String(e)),
  });
  const purgeMut = useMutation({
    mutationFn: purgeDocument,
    onSuccess: () => {
      invalidate();
      showSuccess("Permanently deleted");
    },
    onError: (e) => showError("Purge failed", String(e)),
  });

  const columns: ListColumn<DeletedDocument>[] = [
    {
      key: "title",
      label: "Document",
      render: (d) => {
        const firstProj = d.project_ids.find((pid) => projectMap.has(pid));
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                flexShrink: 0,
                background: firstProj ? colorFor(projectMap.get(firstProj)!) : "var(--text-faint)",
              }}
            />
            <span className={ui.link} style={{ fontSize: 13.5 }}>
              {d.title}
            </span>
          </div>
        );
      },
    },
    {
      key: "project",
      label: "Project",
      width: 160,
      render: (d) => {
        const names = d.project_ids.filter((pid) => projectMap.has(pid)).map((pid) => projectMap.get(pid)!);
        return names.length ? (
          <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
            {names.map((n) => (
              <span key={n} className={`${ui.badge} ${ui.bNeutral}`}>
                {n}
              </span>
            ))}
          </span>
        ) : (
          <span className={ui.faint} style={{ fontSize: 12 }}>
            —
          </span>
        );
      },
    },
    {
      key: "size",
      label: "Size",
      width: 110,
      align: "right",
      render: (d) => (
        <span className={`${ui.mono} ${ui.dim}`} style={{ fontSize: 12 }}>
          {d.total_chars.toLocaleString()}
        </span>
      ),
    },
    {
      key: "deleted",
      label: "Deleted",
      width: 120,
      align: "right",
      render: (d) => (
        <span className={`${ui.faint} ${ui.mono}`} style={{ fontSize: 12 }}>
          {d.deleted_at?.slice(0, 10) ?? "?"}
        </span>
      ),
    },
  ];

  return (
    <ListPage<DeletedDocument>
      eyebrow="Recoverable"
      title="Trash"
      subtitle="Soft-deleted documents — excluded from search until restored or purged."
      headerRight={
        <div style={{ width: 400, maxWidth: "100%" }}>
          <CliCard
            title="CLI equivalent"
            commands={[
              { cmd: "cerefox document list", args: "--deleted" },
              { cmd: "cerefox document restore", args: "<id>" },
            ]}
          />
        </div>
      }
      searchValue={query}
      onSearchChange={setQuery}
      searchPlaceholder="Filter trashed documents…"
      searchText={(d) => d.title}
      toolbarExtra={
        <>
          <Select
            data={["50", "100", "200", "500"]}
            value={limit}
            onChange={(v) => setLimit(v || "50")}
            size="sm"
            w={110}
            aria-label="Max rows"
          />
          <button
            type="button"
            className={`${ui.btn} ${ui.btnGhost} ${ui.btnDanger}`}
            title="Permanently delete every document in the trash (asks first)"
            data-testid="empty-trash-button"
            disabled={isLoading || !docs || docs.length === 0}
            onClick={() => setEmptyOpen(true)}
          >
            <IconTrashX size={14} />
            Empty trash
          </button>
          <EmptyTrashModal
            opened={emptyOpen}
            onClose={() => setEmptyOpen(false)}
            onFinished={(result) => {
              invalidate();
              if (result.failures.length === 0 && !result.stopped) {
                showSuccess("Trash emptied", `${result.purged} permanently deleted`);
              } else {
                showError(
                  result.stopped ? "Stopped emptying the trash" : "Trash not fully emptied",
                  `${result.purged} purged, ${result.failures.length} failed`,
                );
              }
            }}
          />
        </>
      }
      columns={columns}
      rows={docs ?? []}
      rowKey={(d) => d.id}
      rowClick={(d) => navigate(`/document/${d.id}`)}
      loading={isLoading}
      emptyText="Trash is empty."
      actions={(d) =>
        confirmId === d.id ? (
          <>
            <button
              type="button"
              className={`${ui.btn} ${ui.btnSubtle}`}
              style={{ color: "var(--red)" }}
              onClick={() => {
                purgeMut.mutate(d.id);
                setConfirmId(null);
              }}
            >
              Confirm purge
            </button>
            <button type="button" className={`${ui.btn} ${ui.btnSubtle}`} onClick={() => setConfirmId(null)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={`${ui.btn} ${ui.btnGhost} ${ui.btnWarn}`}
              title="Restore from trash"
              onClick={() => restoreMut.mutate(d.id)}
            >
              <IconArrowBackUp size={14} />
              Restore
            </button>
            <button
              type="button"
              className={`${ui.btn} ${ui.btnGhost} ${ui.btnDanger}`}
              title="Permanently delete (cannot be undone)"
              onClick={() => setConfirmId(d.id)}
            >
              <IconTrash size={14} />
              Purge
            </button>
          </>
        )
      }
    />
  );
}
