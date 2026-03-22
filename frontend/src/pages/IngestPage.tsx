import {
  Alert,
  Button,
  Container,
  FileInput,
  Group,
  MultiSelect,
  Stack,
  Tabs,
  TextInput,
  Textarea,
  Title,
  Text,
  ActionIcon,
  Select,
  SegmentedControl,
} from "@mantine/core";
import { IconCheck, IconFileUpload, IconPlus, IconTextSize, IconX } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { MarkdownViewer } from "../components/MarkdownViewer";

import { ingestPaste, checkFilename } from "../api/documents";
import { useMetadataKeys, useProjects } from "../hooks/useProjects";
import type { FilenameCheckResponse, IngestResponse } from "../api/types";

export function IngestPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: projects } = useProjects();
  const { data: metadataKeys } = useMetadataKeys();

  // Paste mode state
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [metaPairs, setMetaPairs] = useState<{ key: string; value: string }[]>([]);
  const [contentView, setContentView] = useState<string>("edit");

  // File mode state
  const [file, setFile] = useState<File | null>(null);
  const [fileTitle, setFileTitle] = useState("");
  const [fileProjectIds, setFileProjectIds] = useState<string[]>([]);
  const [fileUpdateExisting, setFileUpdateExisting] = useState(false);
  const [fileMetaPairs, setFileMetaPairs] = useState<{ key: string; value: string }[]>([]);
  const [filenameCheck, setFilenameCheck] = useState<FilenameCheckResponse | null>(null);

  // Shared result
  const [result, setResult] = useState<IngestResponse | null>(null);

  const pasteMutation = useMutation({
    mutationFn: () => {
      const metadata: Record<string, string> = {};
      for (const pair of metaPairs) {
        if (pair.key.trim() && pair.value.trim()) {
          metadata[pair.key.trim()] = pair.value.trim();
        }
      }
      return ingestPaste({
        title,
        content,
        update_existing: updateExisting,
        project_ids: projectIds,
        metadata,
      });
    },
    onSuccess: (res) => {
      setResult(res);
      if (res.success) {
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      }
    },
  });

  const fileMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file selected");
      const formData = new FormData();
      formData.append("file", file);
      if (fileTitle.trim()) formData.append("title", fileTitle.trim());
      formData.append("update_existing", String(fileUpdateExisting));
      if (fileProjectIds.length > 0) {
        formData.append("project_ids", fileProjectIds.join(","));
      }
      const fileMeta: Record<string, string> = {};
      for (const pair of fileMetaPairs) {
        if (pair.key.trim() && pair.value.trim()) {
          fileMeta[pair.key.trim()] = pair.value.trim();
        }
      }
      if (Object.keys(fileMeta).length > 0) {
        formData.append("metadata", JSON.stringify(fileMeta));
      }

      const resp = await fetch("/api/v1/ingest/file", {
        method: "POST",
        body: formData,
      });
      if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
      return resp.json() as Promise<IngestResponse>;
    },
    onSuccess: (res) => {
      setResult(res);
      if (res.success) {
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      }
    },
  });

  const handleFileChange = async (f: File | null) => {
    setFile(f);
    setFilenameCheck(null);
    if (f?.name) {
      try {
        const check = await checkFilename(f.name);
        setFilenameCheck(check);
        if (check.exists) setFileUpdateExisting(true);
      } catch {
        // ignore check errors
      }
    }
  };

  const projectOptions =
    projects?.map((p) => ({ value: p.id, label: p.name })) || [];

  const keyOptions =
    metadataKeys?.map((mk) => ({
      value: mk.key,
      label: `${mk.key} (${mk.doc_count})`,
    })) || [];

  const renderMetaFields = (
    pairs: { key: string; value: string }[],
    setPairs: (p: { key: string; value: string }[]) => void,
  ) => (
    <div>
      <Text size="sm" fw={500} mb="xs">
        Metadata (optional)
      </Text>
      <Stack gap="xs">
        {pairs.map((pair, idx) => (
          <Group key={idx} gap="xs">
            <Select
              placeholder="Key"
              data={keyOptions}
              value={pair.key}
              onChange={(v) => {
                const updated = [...pairs];
                updated[idx] = { ...pair, key: v || "" };
                setPairs(updated);
              }}
              searchable
              w={200}
              size="sm"
            />
            <TextInput
              placeholder="Value"
              value={pair.value}
              onChange={(e) => {
                const updated = [...pairs];
                updated[idx] = { ...pair, value: e.currentTarget.value };
                setPairs(updated);
              }}
              w={250}
              size="sm"
            />
            <ActionIcon
              variant="subtle"
              color="red"
              onClick={() => setPairs(pairs.filter((_, i) => i !== idx))}
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
          onClick={() => setPairs([...pairs, { key: "", value: "" }])}
        >
          Add field
        </Button>
      </Stack>
    </div>
  );

  return (
    <Container size="md">
      <Title order={2} mb="md">
        Ingest Content
      </Title>

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
            : `"${result.title}" ingested successfully.`}
          {result.document_id && (
            <>
              {" "}
              <Text
                component="span"
                size="sm"
                c="blue"
                style={{ cursor: "pointer", textDecoration: "underline" }}
                onClick={() => navigate(`/document/${result.document_id}`)}
              >
                View document
              </Text>
            </>
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

      <Tabs defaultValue="paste">
        <Tabs.List mb="md">
          <Tabs.Tab value="paste" leftSection={<IconTextSize size={16} />}>
            Paste Content
          </Tabs.Tab>
          <Tabs.Tab value="file" leftSection={<IconFileUpload size={16} />}>
            Upload File
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="paste">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              pasteMutation.mutate();
            }}
          >
            <Stack gap="md">
              <TextInput
                label="Title"
                value={title}
                onChange={(e) => setTitle(e.currentTarget.value)}
                required
                placeholder="Document title"
              />

              {projectOptions.length > 0 && (
                <MultiSelect
                  label="Projects"
                  data={projectOptions}
                  value={projectIds}
                  onChange={setProjectIds}
                  clearable
                  searchable
                  placeholder="Assign to projects (optional)"
                />
              )}

              {renderMetaFields(metaPairs, setMetaPairs)}

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
                    minRows={10}
                    autosize
                    required
                    placeholder="Paste your Markdown content here..."
                    styles={{ input: { fontFamily: "monospace", fontSize: 13 } }}
                  />
                ) : (
                  <div
                    style={{
                      border: "1px solid var(--mantine-color-gray-3)",
                      borderRadius: 8,
                      padding: 12,
                      minHeight: 200,
                    }}
                  >
                    <MarkdownViewer
                      content={content}
                      defaultView="rendered"
                      maxHeight={400}
                      showToggle={false}
                    />
                  </div>
                )}
              </div>

              <Group>
                <Button type="submit" loading={pasteMutation.isPending}>
                  Ingest
                </Button>
                <Button
                  variant={updateExisting ? "filled" : "light"}
                  color={updateExisting ? "yellow" : "gray"}
                  size="sm"
                  onClick={() => setUpdateExisting(!updateExisting)}
                >
                  {updateExisting ? "Update existing: ON" : "Update existing: OFF"}
                </Button>
              </Group>
            </Stack>
          </form>
        </Tabs.Panel>

        <Tabs.Panel value="file">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              fileMutation.mutate();
            }}
          >
            <Stack gap="md">
              <FileInput
                label="File"
                placeholder="Select a .md, .txt, .pdf, or .docx file"
                accept=".md,.txt,.pdf,.docx"
                value={file}
                onChange={handleFileChange}
                required
              />

              {filenameCheck?.exists && (
                <Alert color="blue" variant="light">
                  <Text size="sm">
                    A document with filename "{filenameCheck.title}" already
                    exists (last updated{" "}
                    {filenameCheck.updated_at
                      ? new Date(filenameCheck.updated_at).toLocaleDateString()
                      : "unknown"}
                    ).
                  </Text>
                </Alert>
              )}

              <TextInput
                label="Title (optional)"
                value={fileTitle}
                onChange={(e) => setFileTitle(e.currentTarget.value)}
                placeholder="Defaults to filename if empty"
              />

              {projectOptions.length > 0 && (
                <MultiSelect
                  label="Projects"
                  data={projectOptions}
                  value={fileProjectIds}
                  onChange={setFileProjectIds}
                  clearable
                  searchable
                  placeholder="Assign to projects (optional)"
                />
              )}

              {renderMetaFields(fileMetaPairs, setFileMetaPairs)}

              <Group>
                <Button type="submit" loading={fileMutation.isPending}>
                  Upload &amp; Ingest
                </Button>
                <Button
                  variant={fileUpdateExisting ? "filled" : "light"}
                  color={fileUpdateExisting ? "yellow" : "gray"}
                  size="sm"
                  onClick={() => setFileUpdateExisting(!fileUpdateExisting)}
                >
                  {fileUpdateExisting
                    ? "Update existing: ON"
                    : "Update existing: OFF"}
                </Button>
              </Group>
            </Stack>
          </form>
        </Tabs.Panel>
      </Tabs>
    </Container>
  );
}
