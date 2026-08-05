import {
  ActionIcon,
  Button,
  Card,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconPlus, IconSearch, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchMetadataSearch, type MetadataSearchParams } from "../api/metadataSearch";
import { fetchMetadataKeys, fetchProjects } from "../api/projects";
import type { MetadataSearchResult } from "../api/types";
import { CliHint } from "../components/CliHint";
import ui from "../styles/redesign.module.css";
import lp from "../components/ListPage.module.css";

export function MetadataSearchPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Array<{ key: string; value: string }>>([{ key: "", value: "" }]);
  const [projectId, setProjectId] = useState<string>("");
  const [updatedSince, setUpdatedSince] = useState("");
  const [createdSince, setCreatedSince] = useState("");
  const [limit, setLimit] = useState<number>(25);

  const { data: metadataKeys } = useQuery({ queryKey: ["metadataKeys"], queryFn: fetchMetadataKeys, staleTime: 60_000 });
  const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: fetchProjects, staleTime: 60_000 });

  const keySuggestions = (metadataKeys ?? []).map((k) => ({ value: k.key, label: `${k.key} (${k.doc_count} docs)` }));
  const projectOptions = [{ value: "", label: "All projects" }, ...(projects ?? []).map((p) => ({ value: p.id, label: p.name }))];

  const addFilter = () => setFilters((f) => [...f, { key: "", value: "" }]);
  const removeFilter = (idx: number) => setFilters((f) => f.filter((_, i) => i !== idx));
  const updateFilter = (idx: number, field: "key" | "value", val: string) =>
    setFilters((f) => f.map((row, i) => (i === idx ? { ...row, [field]: val } : row)));

  const { mutate: doSearch, data: results, isPending, error, reset } = useMutation({
    mutationFn: (params: MetadataSearchParams) => fetchMetadataSearch(params),
  });

  const buildFilter = useCallback(() => {
    const mf: Record<string, string> = {};
    for (const f of filters) if (f.key.trim() && f.value.trim()) mf[f.key.trim()] = f.value.trim();
    return mf;
  }, [filters]);

  const handleSearch = useCallback(() => {
    const mf = buildFilter();
    if (Object.keys(mf).length === 0) return;
    const params: MetadataSearchParams = { metadata_filter: mf, limit };
    if (projectId) params.project_id = projectId;
    if (updatedSince) params.updated_since = updatedSince;
    if (createdSince) params.created_since = createdSince;
    reset();
    doSearch(params);
  }, [buildFilter, projectId, updatedSince, createdSince, limit, doSearch, reset]);

  const validFilterCount = filters.filter((f) => f.key.trim() && f.value.trim()).length;
  const mf = buildFilter();
  const cliArgs = `-f '${JSON.stringify(Object.keys(mf).length ? mf : { key: "value" })}'`;

  return (
    <div className={lp.wrap}>
      <div className={ui.pageHead}>
        <div>
          <p className={ui.eyebrow}>Knowledge base</p>
          <h1 className={ui.pageTitle} data-testid="page-title">Metadata Search</h1>
          <p className={ui.pageSub}>Find documents by their metadata keys and values.</p>
        </div>
        <CliHint cmd="cerefox metadata search" args={cliArgs} />
      </div>

      {/* filter builder */}
      <Card withBorder mb="md" p="md" radius="lg">
        <Stack gap="sm">
          <Text fw={600} size="sm">
            Metadata filters <span className={ui.faint}>(all must match)</span>
          </Text>
          {filters.map((f, idx) => (
            <Group key={idx} gap="xs" align="flex-end">
              <Select
                placeholder="Key"
                data={keySuggestions}
                value={f.key || null}
                onChange={(v) => updateFilter(idx, "key", v ?? "")}
                searchable
                allowDeselect
                style={{ flex: 1 }}
                size="sm"
              />
              <TextInput
                placeholder="Value"
                value={f.value}
                onChange={(e) => updateFilter(idx, "value", e.currentTarget.value)}
                style={{ flex: 1 }}
                size="sm"
              />
              {filters.length > 1 && (
                <ActionIcon variant="subtle" color="red" onClick={() => removeFilter(idx)} size="md">
                  <IconTrash size={16} />
                </ActionIcon>
              )}
            </Group>
          ))}
          <Button variant="subtle" size="xs" leftSection={<IconPlus size={14} />} onClick={addFilter} style={{ alignSelf: "flex-start" }}>
            Add filter
          </Button>

          <Group gap="sm" grow>
            <Select label="Project" data={projectOptions} value={projectId} onChange={(v) => setProjectId(v ?? "")} size="sm" clearable />
            <NumberInput label="Limit" value={limit} onChange={(v) => setLimit(Number(v) || 25)} min={1} max={100} size="sm" />
          </Group>
          <Group gap="sm" grow>
            <TextInput label="Updated since" type="date" value={updatedSince} onChange={(e) => setUpdatedSince(e.currentTarget.value)} size="sm" />
            <TextInput label="Created since" type="date" value={createdSince} onChange={(e) => setCreatedSince(e.currentTarget.value)} size="sm" />
          </Group>

          <Button data-testid="metadata-search-submit" leftSection={<IconSearch size={16} />} onClick={handleSearch} disabled={validFilterCount === 0} loading={isPending} style={{ alignSelf: "flex-start" }}>
            Search
          </Button>
        </Stack>
      </Card>

      {/* results */}
      {error && (
        <Text c="red" mt="md">
          Error: {(error as Error).message}
        </Text>
      )}
      {results && (
        <div className={`${ui.card} ${ui.rise}`} style={{ overflow: "hidden" }}>
          <table className={lp.tbl}>
            <thead>
              <tr>
                <th>Document</th>
                <th>Metadata</th>
                <th style={{ width: 160 }}>Project</th>
                <th style={{ width: 110, textAlign: "right" }}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {results.length === 0 ? (
                <tr>
                  <td colSpan={4} className={lp.emptyRow}>
                    No documents match the metadata filter.
                  </td>
                </tr>
              ) : (
                results.map((doc: MetadataSearchResult) => {
                  const entries = Object.entries(doc.doc_metadata ?? {});
                  return (
                    <tr
                      key={doc.document_id}
                      style={{ cursor: "pointer" }}
                      onClick={() => navigate(`/document/${doc.document_id}`)}
                    >
                      <td>
                        <span className={ui.link} style={{ fontSize: 13.5 }}>
                          {doc.title}
                        </span>
                      </td>
                      <td>
                        <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                          {entries.slice(0, 3).map(([k, v]) => (
                            <span key={k} className={`${ui.badge} ${ui.bNeutral}`}>
                              {k}={String(v).length > 24 ? `${String(v).slice(0, 22)}…` : String(v)}
                            </span>
                          ))}
                          {entries.length > 3 && (
                            <span className={`${ui.badge} ${ui.bNeutral}`}>+{entries.length - 3}</span>
                          )}
                        </span>
                      </td>
                      <td>
                        <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                          {doc.project_names.map((n) => (
                            <span key={n} className={`${ui.badge} ${ui.bNeutral}`}>
                              {n}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <span className={`${ui.faint} ${ui.mono}`} style={{ fontSize: 12 }}>
                          {doc.updated_at?.slice(0, 10) ?? "?"}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          <div className={lp.foot}>
            <span className={lp.faint}>
              {results.length} document{results.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
