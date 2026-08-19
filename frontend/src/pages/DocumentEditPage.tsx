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
import { invalidateDocumentViews } from "../lib/invalidate";
import { useMetadataKeys, useProjects } from "../hooks/useProjects";
import { showSuccess, showError, showV07DeferredToast } from "../utils/notifications";

/** Inverse of the parse-on-save: strings that JSON.parse would reinterpret
 * (numbers, booleans, quoted strings, JSON structures) render JSON-encoded
 * so the round-trip is faithful; plain strings render bare. */
function displayMetaValue(value: unknown): string {
  if (typeof value !== "string") return JSON.stringify(value);
  try {
    JSON.parse(value);
    return JSON.stringify(value); // parseable → quote it to survive the trip
  } catch {
    return value; // plain string, renders and saves as-is
  }
}

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
        // Display must be the exact INVERSE of the parse-on-save below, or
        // an untouched save retypes values (review round 3: a stored STRING
        // "8" shown bare re-parsed to the number 8 — breaking, among other
        // things, the Decision Log's latest:"true" string convention).
        // Rule: a string renders bare only when JSON.parse would NOT
        // reinterpret it; anything else renders JSON-encoded.
        value: displayMetaValue(value),
      })),
    );
    setInitialized(true);
  }

  const mutation = useMutation({
    mutationFn: () => {
      const metadata: Record<string, unknown> = {};
      for (const pair of metaPairs) {
        if (pair.key.trim() && pair.value.trim()) {
          const raw = pair.value.trim();
          // Mirror the CLI's --set-meta: JSON-parse when it parses (so
          // `2024` stays a number and `["a","b"]` stays an array — including
          // the JSON we rendered above), otherwise a plain string.
          let parsed: unknown = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {
            // plain string
          }
          metadata[pair.key.trim()] = parsed;
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
        invalidateDocumentViews(queryClient, id);
        showSuccess("Document saved", result.reindexed ? "Content re-indexed" : "Metadata updated");
        navigate(`/document/${id}`);
      } else if (result.error) {
        showError("Save failed", result.error);
      }
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        // The server's body carries the specific remedy — 409 is no longer
        // only the concurrency conflict (a trashed document is also 409, with
        // a different fix), and 422 (unresolved links) names the broken ids.
        // Showing a generic message for those sent users down the wrong path.
        let body: { error?: string; message?: string } = {};
        try {
          body = JSON.parse(err.body) as { error?: string; message?: string };
        } catch {
          // non-JSON body; fall through to the generic branches below
        }
        if (err.status === 409 && body.error === "document is in the trash") {
          showError("Document is in the trash", body.message ?? "Restore it from the Trash page first, then save again.");
          return;
        }
        if (err.status === 422) {
          showError("Broken document links", body.message ?? "The content links document id(s) that don't exist — fix or remove them.");
          return;
        }
        if (err.status === 409) {
          showError(
            "Edit conflict",
            "This document changed while you were editing it (another writer saved a newer version). Open the document in a new tab, merge your changes, then save again.",
          );
          return;
        }
      }
      if (!showV07DeferredToast(err)) {
        showError("Save failed", err instanceof Error ? err.message : String(err));
      }
    },
  });

  const projectOptions =
    projects?.map((p) => ({ value: p.id, label: p.name })) || [];

  // Mantine Autocomplete inserts the option LABEL into the input on select,
  // so the label must be exactly the key — embedding the doc count in it
  // (`status (108)`) used to leak the count into the saved metadata key,
  // polluting the KB taxonomy. The count is shown via renderOption instead
  // (dropdown-only; never enters the field).
  const keyCounts = new Map((metadataKeys ?? []).map((mk) => [mk.key, mk.doc_count]));
  const keyOptions = metadataKeys?.map((mk) => mk.key) || [];

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
                    renderOption={({ option }) => (
                      <Group justify="space-between" w="100%" wrap="nowrap">
                        <span>{option.value}</span>
                        <Text size="xs" c="dimmed">
                          {keyCounts.get(option.value)} docs
                        </Text>
                      </Group>
                    )}
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
