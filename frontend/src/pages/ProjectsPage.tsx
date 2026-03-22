import {
  ActionIcon,
  Button,
  Card,
  Container,
  Grid,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconEdit, IconTrash } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  createProject,
  deleteProject,
  updateProject,
} from "../api/projects";
import { useProjects } from "../hooks/useProjects";

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const { data: projects, isLoading } = useProjects();

  // Create form
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  // Edit modal
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  // Delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => createProject(newName.trim(), newDesc.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setNewName("");
      setNewDesc("");
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      updateProject(editId!, editName.trim(), editDesc.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setEditId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteProject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setConfirmDeleteId(null);
    },
  });

  const openEdit = (project: { id: string; name: string; description: string | null }) => {
    setEditId(project.id);
    setEditName(project.name);
    setEditDesc(project.description || "");
  };

  return (
    <Container size="lg">
      <Title order={2} mb="md">
        Projects
      </Title>

      <Grid>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Title order={4} mb="sm">
            All Projects
          </Title>
          {isLoading ? (
            <Loader />
          ) : !projects || projects.length === 0 ? (
            <Text c="dimmed">No projects yet. Create one to get started.</Text>
          ) : (
            <Stack gap="sm">
              {projects.map((p) => (
                <Card key={p.id} shadow="xs" padding="sm" radius="md" withBorder>
                  <Group justify="space-between">
                    <div>
                      <Text fw={600} size="sm">
                        {p.name}
                      </Text>
                      {p.description && (
                        <Text size="xs" c="dimmed">
                          {p.description}
                        </Text>
                      )}
                    </div>
                    <Group gap={4}>
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        onClick={() => openEdit(p)}
                      >
                        <IconEdit size={14} />
                      </ActionIcon>
                      {confirmDeleteId === p.id ? (
                        <Group gap={4}>
                          <Button
                            color="red"
                            size="compact-xs"
                            onClick={() => deleteMutation.mutate(p.id)}
                            loading={deleteMutation.isPending}
                          >
                            Yes
                          </Button>
                          <Button
                            variant="subtle"
                            size="compact-xs"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            No
                          </Button>
                        </Group>
                      ) : (
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          size="sm"
                          onClick={() => setConfirmDeleteId(p.id)}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      )}
                    </Group>
                  </Group>
                </Card>
              ))}
            </Stack>
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card shadow="xs" padding="md" radius="md" withBorder>
            <Title order={5} mb="sm">
              Create Project
            </Title>
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
                />
                <TextInput
                  label="Description"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.currentTarget.value)}
                  placeholder="Optional description"
                />
                <Button
                  type="submit"
                  size="sm"
                  loading={createMutation.isPending}
                >
                  Create
                </Button>
              </Stack>
            </form>
          </Card>
        </Grid.Col>
      </Grid>

      <Modal
        opened={editId !== null}
        onClose={() => setEditId(null)}
        title="Edit Project"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateMutation.mutate();
          }}
        >
          <Stack gap="sm">
            <TextInput
              label="Name"
              value={editName}
              onChange={(e) => setEditName(e.currentTarget.value)}
              required
            />
            <TextInput
              label="Description"
              value={editDesc}
              onChange={(e) => setEditDesc(e.currentTarget.value)}
            />
            <Group>
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
    </Container>
  );
}
