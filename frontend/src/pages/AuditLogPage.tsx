import { Select, TextInput } from "@mantine/core";
import { IconMapPin, IconSparkles } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import type { AuditEntry } from "../api/types";
import { fetchAuditLog } from "../api/audit";
import { CliHint } from "../components/CliHint";
import { ListPage, type ListColumn } from "../components/ListPage";
import { formatDateTime } from "../utils/dates";
import { STORE_LEVEL_AUDIT_OPS } from "@cerefox/audit-ops";
import ui from "../styles/redesign.module.css";

// Membership is the SHARED definition (via the @cerefox/audit-ops alias, the
// @cerefox/schemas pattern): a fifth store-level operation renders "(store)"
// here without a frontend edit. Labels/tones are presentation and stay local.
const STORE_LEVEL_OP_DEFS = [
  { value: "config-change", label: "Config change", tone: "yellow" },
  { value: "project-create", label: "Project create", tone: "green" },
  { value: "project-edit", label: "Project edit", tone: "violet" },
  { value: "project-delete", label: "Project delete", tone: "red" },
] as const;
const STORE_LEVEL_OPS = new Set<string>(STORE_LEVEL_AUDIT_OPS);

const OPERATIONS = [
  { value: "", label: "All operations" },
  { value: "create", label: "Create" },
  { value: "update-content", label: "Update content" },
  { value: "update-metadata", label: "Update metadata" },
  { value: "insert", label: "Insert (partial edit)" },
  { value: "replace-section", label: "Replace section" },
  { value: "delete-section", label: "Delete section" },
  { value: "rename-section", label: "Rename section" },
  { value: "delete", label: "Delete" },
  { value: "restore", label: "Restore" },
  { value: "status-change", label: "Status change" },
  { value: "archive", label: "Archive" },
  { value: "unarchive", label: "Unarchive" },
  ...STORE_LEVEL_OP_DEFS.map((d) => ({ value: d.value, label: d.label })),
];


const OP_TONE: Record<string, string> = {
  create: ui.bGreen,
  "update-content": ui.bBlue,
  "update-metadata": ui.bViolet,
  insert: ui.bBlue,
  "replace-section": ui.bBlue,
  "delete-section": ui.bRed,
  "rename-section": ui.bViolet,
  "status-change": ui.bYellow,
  archive: ui.bPrimary,
  unarchive: ui.bPrimary,
  restore: ui.bGreen,
  delete: ui.bRed,
  ...Object.fromEntries(
    STORE_LEVEL_OP_DEFS.map((d) => [
      d.value,
      { yellow: ui.bYellow, green: ui.bGreen, violet: ui.bViolet, red: ui.bRed }[d.tone],
    ]),
  ),
};

export function AuditLogPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [operation, setOperation] = useState(searchParams.get("operation") || "");
  const [documentId] = useState(searchParams.get("document_id") || "");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [limit, setLimit] = useState("100");
  const [query, setQuery] = useState("");

  const { data: entries, isLoading } = useQuery({
    queryKey: ["audit-log", operation, documentId, fromDate, toDate, limit],
    queryFn: () =>
      fetchAuditLog({
        operation: operation || undefined,
        document_id: documentId || undefined,
        since: fromDate ? `${fromDate}T00:00:00` : undefined,
        until: toDate ? `${toDate}T23:59:59` : undefined,
        limit: Number(limit),
      }),
  });

  const columns: ListColumn<AuditEntry>[] = [
    {
      key: "time",
      label: "Time",
      width: 150,
      render: (e) => (
        <span className={`${ui.faint} ${ui.mono}`} style={{ fontSize: 12, whiteSpace: "nowrap" }}>
          {formatDateTime(e.created_at)}
        </span>
      ),
    },
    {
      key: "op",
      label: "Operation",
      width: 150,
      render: (e) => (
        <span className={`${ui.badge} ${OP_TONE[e.operation] ?? ui.bNeutral}`}>{e.operation}</span>
      ),
    },
    {
      key: "author",
      label: "Author",
      width: 170,
      render: (e) => (
        <span className={`${ui.srcChip} ${e.author_type === "agent" ? ui.srcChipAgent : ""}`}>
          {e.author_type === "agent" ? <IconSparkles size={12} /> : <IconMapPin size={12} />}
          {e.author}
        </span>
      ),
    },
    {
      key: "doc",
      label: "Document",
      render: (e) =>
        e.document_id ? (
          <span className={`${ui.link}`} style={{ fontSize: 13 }}>
            {e.doc_title || `${e.document_id.slice(0, 8)}…`}
          </span>
        ) : (
          <span className={ui.faint} style={{ fontSize: 12 }}>
            {STORE_LEVEL_OPS.has(e.operation) ? "(store)" : "(deleted)"}
          </span>
        ),
    },
    {
      key: "delta",
      label: "Change",
      width: 110,
      align: "right",
      render: (e) => {
        if (e.size_before == null && e.size_after == null) {
          return <span className={`${ui.faint} ${ui.mono}`} style={{ fontSize: 12 }}>—</span>;
        }
        const d = (e.size_after ?? 0) - (e.size_before ?? 0);
        const color = d > 0 ? "var(--green)" : d < 0 ? "var(--red)" : "var(--text-faint)";
        return (
          <span className={ui.mono} style={{ fontSize: 12, color }}>
            {d > 0 ? "+" : ""}
            {d.toLocaleString()}
          </span>
        );
      },
    },
  ];

  return (
    <ListPage<AuditEntry>
      eyebrow="Every read & write"
      title="Audit Log"
      subtitle="A complete trail of changes — by human and agent alike."
      headerRight={<CliHint cmd="cerefox audit list" />}
      searchValue={query}
      onSearchChange={setQuery}
      searchPlaceholder="Filter by document or description…"
      searchText={(e) => `${e.doc_title ?? ""} ${e.description ?? ""} ${e.author ?? ""}`}
      toolbarExtra={
        <>
          <Select
            data={OPERATIONS}
            value={operation}
            onChange={(v) => setOperation(v || "")}
            placeholder="All operations"
            size="sm"
            w={170}
            clearable
          />
          <TextInput
            type="date"
            aria-label="From"
            value={fromDate}
            onChange={(e) => setFromDate(e.currentTarget.value)}
            size="sm"
            w={150}
          />
          <TextInput
            type="date"
            aria-label="To"
            value={toDate}
            onChange={(e) => setToDate(e.currentTarget.value)}
            size="sm"
            w={150}
          />
          <Select
            data={["100", "250", "500", "1000"]}
            value={limit}
            onChange={(v) => setLimit(v || "100")}
            size="sm"
            w={100}
          />
        </>
      }
      columns={columns}
      rows={entries ?? []}
      rowKey={(e) => e.id}
      rowClick={(e) => e.document_id && navigate(`/document/${e.document_id}`)}
      loading={isLoading}
      emptyText="No audit log entries found."
    />
  );
}
