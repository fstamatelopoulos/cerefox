import { Button, Group, Modal, Stack, TextInput } from "@mantine/core";
import { IconEdit, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchDashboard } from "../api/dashboard";
import { createProject, deleteProject, updateProject } from "../api/projects";
import type { Project } from "../api/types";
import { CliCard } from "../components/CliCard";
import { ListPage, type ListColumn } from "../components/ListPage";
import { useProjects } from "../hooks/useProjects";
import { showError, showSuccess } from "../utils/notifications";
import ui from "../styles/redesign.module.css";

const PROJECT_COLORS = ["--primary", "--violet", "--blue", "--green", "--yellow", "--red"];

export function ProjectsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: projects, isLoading } = useProjects();
  const { data: dash } = useQuery({ queryKey: ["dashboard"], queryFn: () => fetchDashboard() });

  const docCounts = dash?.project_doc_counts ?? {};
  const trashCounts = dash?.project_deleted_doc_counts ?? {};
  const maxDocs = Math.max(1, ...Object.values(docCounts));
  const colorMap = new Map((projects ?? []).map((p, i) => [p.id, PROJECT_COLORS[i % PROJECT_COLORS.length]]));

  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => createProject(newName.trim(), newDesc.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      showSuccess("Project created");
      setNewName("");
      setNewDesc("");
      setCreateOpen(false);
    },
    onError: (err) => showError("Create failed", String(err)),
  });
  const updateMutation = useMutation({
    mutationFn: () => updateProject(editId!, editName.trim(), editDesc.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      showSuccess("Project updated");
      setEditId(null);
    },
    onError: (err) => showError("Update failed", String(err)),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteProject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      showSuccess("Project deleted");
      setConfirmDeleteId(null);
    },
    onError: (err) => showError("Delete failed", String(err)),
  });

  const columns: ListColumn<Project>[] = [
    {
      key: "name",
      label: "Project",
      render: (p) => (
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              flexShrink: 0,
              background: `var(${colorMap.get(p.id) ?? "--border"})`,
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span className={ui.mono} style={{ fontWeight: 600, fontSize: 13 }}>
              {p.name}
            </span>
            {p.description && (
              <span className={ui.faint} style={{ fontSize: 12 }}>
                {p.description}
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "docs",
      label: "Documents",
      width: 180,
      render: (p) => {
        const n = docCounts[p.id] ?? 0;
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className={ui.mono} style={{ fontSize: 13 }}>
              {n}
            </span>
            <span
              style={{
                flex: 1,
                maxWidth: 90,
                height: 5,
                borderRadius: 3,
                background: "var(--surface-2)",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  display: "block",
                  height: "100%",
                  width: `${(n / maxDocs) * 100}%`,
                  background: `var(${colorMap.get(p.id) ?? "--border"})`,
                }}
              />
            </span>
          </div>
        );
      },
    },
    {
      key: "trash",
      label: "In trash",
      width: 90,
      align: "right",
      render: (p) => {
        const t = trashCounts[p.id] ?? 0;
        return t > 0 ? (
          <span className={`${ui.mono} ${ui.faint}`} style={{ fontSize: 12 }}>
            {t}
          </span>
        ) : (
          <span className={`${ui.mono} ${ui.faint}`} style={{ fontSize: 12 }}>
            —
          </span>
        );
      },
    },
  ];

  return (
    <>
      <ListPage<Project>
        eyebrow="Memory spaces"
        title="Projects"
        subtitle="Scoped collections your agents read from and write to."
        headerRight={
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, width: 400, maxWidth: "100%" }}>
            <button
              type="button"
              className={`${ui.btn} ${ui.btnPrimary}`}
              style={{ alignSelf: "flex-end" }}
              onClick={() => setCreateOpen(true)}
            >
              <IconPlus size={16} />
              New project
            </button>
            <CliCard
              title="CLI equivalent"
              commands={[
                { cmd: "cerefox project list" },
                { cmd: "cerefox project create", args: "<name>" },
              ]}
            />
          </div>
        }
        searchValue={query}
        onSearchChange={setQuery}
        searchPlaceholder="Filter projects…"
        searchText={(p) => `${p.name} ${p.description ?? ""}`}
        columns={columns}
        rows={projects ?? []}
        rowKey={(p) => p.id}
        rowClick={(p) => navigate(`/projects/${p.id}/documents`)}
        loading={isLoading}
        emptyText="No projects yet. Create one to get started."
        actions={(p) =>
          confirmDeleteId === p.id ? (
            <>
              <button
                type="button"
                className={`${ui.btn} ${ui.btnSubtle}`}
                style={{ color: "var(--red)" }}
                onClick={() => deleteMutation.mutate(p.id)}
              >
                Delete
              </button>
              <button type="button" className={`${ui.btn} ${ui.btnSubtle}`} onClick={() => setConfirmDeleteId(null)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={ui.iconBtnSm}
                title="Edit"
                onClick={() => {
                  setEditId(p.id);
                  setEditName(p.name);
                  setEditDesc(p.description || "");
                }}
              >
                <IconEdit size={14} />
              </button>
              <button
                type="button"
                className={`${ui.iconBtnSm} ${ui.iconBtnDanger}`}
                title="Delete"
                onClick={() => setConfirmDeleteId(p.id)}
              >
                <IconTrash size={14} />
              </button>
            </>
          )
        }
      />

      <Modal opened={createOpen} onClose={() => setCreateOpen(false)} title="New project">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) createMutation.mutate();
          }}
        >
          <Stack gap="sm">
            <TextInput
              label="Name"
              value={newName}
              onChange={(e) => setNewName(e.currentTarget.value)}
              required
              placeholder="Project name"
              data-autofocus
            />
            <TextInput
              label="Description"
              value={newDesc}
              onChange={(e) => setNewDesc(e.currentTarget.value)}
              placeholder="Optional description"
            />
            <Button type="submit" loading={createMutation.isPending}>
              Create
            </Button>
          </Stack>
        </form>
      </Modal>

      <Modal opened={editId !== null} onClose={() => setEditId(null)} title="Edit project">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateMutation.mutate();
          }}
        >
          <Stack gap="sm">
            <TextInput label="Name" value={editName} onChange={(e) => setEditName(e.currentTarget.value)} required />
            <TextInput label="Description" value={editDesc} onChange={(e) => setEditDesc(e.currentTarget.value)} />
            <Group gap="sm">
              <Button type="submit" loading={updateMutation.isPending}>
                Save
              </Button>
              <Button variant="subtle" onClick={() => setEditId(null)}>
                Cancel
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}
