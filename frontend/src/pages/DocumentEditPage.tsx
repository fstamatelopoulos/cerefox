import {
  ActionIcon,
  Autocomplete,
  Button,
  Container,
  Group,
  MultiSelect,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { IconPlus, IconX } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ApiError } from "../api/client";
import { editDocument, fetchDocument } from "../api/documents";
import { MarkdownViewer } from "../components/MarkdownViewer";
import { useMetadataKeys, useProjects } from "../hooks/useProjects";
import { showSuccess, showError, showV07DeferredToast } from "../utils/notifications";

export function DocumentEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: doc, isLoading } = useQuery({
    queryKey: ["document", id],
    queryFn: () => fetchDocument(id!),
    enabled: !!id,
  });

  const { data: projects } = useProjects();
  const { data: metadataKeys } = useMetadataKeys();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [metaPairs, setMetaPairs] = useState<{ key: string; value: string }[]>(
    [],
  );
  const [initialized, setInitialized] = useState(false);
  const [contentView, setContentView] = useState<string>("edit");

  // Initialize form state from loaded document (once)
  if (doc && !initialized) {
    setTitle(doc.doc_title || "");
    setContent(doc.full_content || "");
    setProjectIds(doc.project_ids || []);
    setMetaPairs(
      Object.entries(doc.doc_metadata || {}).map(([key, value]) => ({
        key,
        value: String(value),
      })),
    );
    setInitialized(true);
  }

  const mutation = useMutation({
    mutationFn: () => {
      const metadata: Record<string, string> = {};
      for (const pair of metaPairs) {
        if (pair.key.trim() && pair.value.trim()) {
          metadata[pair.key.trim()] = pair.value.trim();
        }
      }
      return editDocument(id!, {
        title,
        content,
        project_ids: projectIds,
        metadata,
        // The hash the document was loaded with — lets the server detect a
        // concurrent change (another writer saved while we were editing).
        expected_content_hash: doc?.content_hash ?? null,
      });
    },
    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ["document", id] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        showSuccess("Document saved", result.reindexed ? "Content re-indexed" : "Metadata updated");
        navigate(`/document/${id}`);
      } else if (result.error) {
        showError("Save failed", result.error);
      }
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        showError(
          "Edit conflict",
          "This document changed while you were editing it (another writer saved a newer version). Open the document in a new tab, merge your changes, then save again.",
        );
        return;
      }
      if (!showV07DeferredToast(err)) {
        showError("Save failed", err instanceof Error ? err.message : String(err));
      }
    },
  });

  const projectOptions =
    projects?.map((p) => ({ value: p.id, label: p.name })) || [];

  const keyOptions =
    metadataKeys?.map((mk) => ({
      value: mk.key,
      label: `${mk.key} (${mk.doc_count})`,
    })) || [];

  if (isLoading || !initialized) {
    return (
      <Container size="lg">
        <Text c="dimmed" mt="xl">
          Loading...
        </Text>
      </Container>
    );
  }

  // Shared Save/Cancel actions — rendered both between the metadata fields and
  // the Content editor (so metadata-only edits don't require scrolling past the
  // content) and at the bottom of the form.
  const saveCancelButtons = (
    <Group>
      <Button type="submit" loading={mutation.isPending}>
        Save
      </Button>
      <Button
        type="button"
        variant="subtle"
        onClick={() => navigate(`/document/${id}`)}
      >
        Cancel
      </Button>
    </Group>
  );

  return (
    <Container size="lg">
      <Title order={2} mb="md">
        Edit Document
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        If content changes, the document will be re-chunked and re-embedded.
      </Text>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <Stack gap="md">
          <TextInput
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            required
          />

          {projectOptions.length > 0 && (
            <MultiSelect
              label="Projects"
              data={projectOptions}
              value={projectIds}
              onChange={setProjectIds}
              clearable
              searchable
            />
          )}

          <div>
            <Text size="sm" fw={500} mb="xs">
              Metadata
            </Text>
            <Stack gap="xs">
              {metaPairs.map((pair, idx) => (
                <Group key={idx} gap="xs">
                  <Autocomplete
                    placeholder="Key"
                    data={keyOptions}
                    value={pair.key}
                    onChange={(v) => {
                      const updated = [...metaPairs];
                      updated[idx] = { ...pair, key: v };
                      setMetaPairs(updated);
                    }}
                    w={200}
                    size="sm"
                  />
                  <TextInput
                    placeholder="Value"
                    value={pair.value}
                    onChange={(e) => {
                      const updated = [...metaPairs];
                      updated[idx] = {
                        ...pair,
                        value: e.currentTarget.value,
                      };
                      setMetaPairs(updated);
                    }}
                    w={250}
                    size="sm"
                  />
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={() =>
                      setMetaPairs(metaPairs.filter((_, i) => i !== idx))
                    }
                  >
                    <IconX size={14} />
                  </ActionIcon>
                </Group>
              ))}
              <Button
                variant="light"
                size="xs"
                w={140}
                leftSection={<IconPlus size={14} />}
                onClick={() =>
                  setMetaPairs([...metaPairs, { key: "", value: "" }])
                }
              >
                Add field
              </Button>
            </Stack>
          </div>

          {saveCancelButtons}

          <div>
            <Group justify="space-between" mb="xs">
              <Text size="sm" fw={500}>
                Content
              </Text>
              <SegmentedControl
                size="xs"
                value={contentView}
                onChange={setContentView}
                data={[
                  { label: "Edit", value: "edit" },
                  { label: "Preview", value: "preview" },
                ]}
                w={160}
              />
            </Group>
            {contentView === "edit" ? (
              <Textarea
                value={content}
                onChange={(e) => setContent(e.currentTarget.value)}
                minRows={15}
                autosize
                required
                styles={{ input: { fontFamily: "monospace", fontSize: 13 } }}
              />
            ) : (
              <div
                style={{
                  border: "1px solid var(--mantine-color-gray-3)",
                  borderRadius: 8,
                  padding: 12,
                  minHeight: 300,
                }}
              >
                <MarkdownViewer
                  content={content}
                  defaultView="rendered"
                  maxHeight={500}
                  showToggle={false}
                />
              </div>
            )}
          </div>

          <Stack gap="xs">
            {saveCancelButtons}
            {mutation.data && !mutation.data.success && (
              <Text c="red" size="sm">
                {mutation.data.error}
              </Text>
            )}
          </Stack>
        </Stack>
      </form>
    </Container>
  );
}
