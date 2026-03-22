import {
  Button,
  Container,
  Group,
  MultiSelect,
  SegmentedControl,
  Stack,
  TextInput,
  Textarea,
  Title,
  Text,
  ActionIcon,
  Select,
} from "@mantine/core";
import { IconPlus, IconX } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { editDocument, fetchDocument } from "../api/documents";
import { MarkdownViewer } from "../components/MarkdownViewer";
import { useMetadataKeys, useProjects } from "../hooks/useProjects";

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
      });
    },
    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ["document", id] });
        navigate(`/document/${id}`);
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
                  <Select
                    placeholder="Key"
                    data={keyOptions}
                    value={pair.key}
                    onChange={(v) => {
                      const updated = [...metaPairs];
                      updated[idx] = { ...pair, key: v || "" };
                      setMetaPairs(updated);
                    }}
                    searchable
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

          <Group>
            <Button type="submit" loading={mutation.isPending}>
              Save
            </Button>
            <Button
              variant="subtle"
              onClick={() => navigate(`/document/${id}`)}
            >
              Cancel
            </Button>
            {mutation.data && !mutation.data.success && (
              <Text c="red" size="sm">
                {mutation.data.error}
              </Text>
            )}
          </Group>
        </Stack>
      </form>
    </Container>
  );
}
