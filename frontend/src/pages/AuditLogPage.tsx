import {
  Anchor,
  Badge,
  Container,
  Group,
  Loader,
  Select,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { fetchAuditLog } from "../api/audit";
import { formatDateTime } from "../utils/dates";

const OPERATIONS = [
  { value: "", label: "All operations" },
  { value: "create", label: "Create" },
  { value: "update-content", label: "Update content" },
  { value: "update-metadata", label: "Update metadata" },
  { value: "delete", label: "Delete" },
  { value: "status-change", label: "Status change" },
  { value: "archive", label: "Archive" },
  { value: "unarchive", label: "Unarchive" },
];

export function AuditLogPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [operation, setOperation] = useState(searchParams.get("operation") || "");
  const [author, setAuthor] = useState(searchParams.get("author") || "");
  const [documentId] = useState(searchParams.get("document_id") || "");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [limit, setLimit] = useState("100");

  const { data: entries, isLoading } = useQuery({
    queryKey: ["audit-log", operation, author, documentId, fromDate, toDate, limit],
    queryFn: () =>
      fetchAuditLog({
        operation: operation || undefined,
        author: author || undefined,
        document_id: documentId || undefined,
        since: fromDate ? `${fromDate}T00:00:00` : undefined,
        until: toDate ? `${toDate}T23:59:59` : undefined,
        limit: Number(limit),
      }),
  });

  const operationColor = (op: string) => {
    switch (op) {
      case "create": return "green";
      case "update-content": return "blue";
      case "update-metadata": return "cyan";
      case "delete": return "red";
      case "status-change": return "yellow";
      case "archive": return "violet";
      case "unarchive": return "orange";
      default: return "gray";
    }
  };

  return (
    <Container size="lg">
      <Title order={2} mb="md">
        Audit Log
      </Title>

      <Group mb="md" gap="sm" align="flex-end">
        <Select
          label="Operation"
          placeholder="All operations"
          data={OPERATIONS}
          value={operation}
          onChange={(v) => setOperation(v || "")}
          clearable
          w={180}
          size="sm"
        />
        <TextInput
          label="Author"
          placeholder="Filter by author"
          value={author}
          onChange={(e) => setAuthor(e.currentTarget.value)}
          leftSection={<IconSearch size={14} />}
          w={180}
          size="sm"
        />
        <TextInput
          label="From"
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.currentTarget.value)}
          w={150}
          size="sm"
        />
        <TextInput
          label="To"
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.currentTarget.value)}
          w={150}
          size="sm"
        />
        <Select
          label="Max entries"
          data={["100", "250", "500", "1000"]}
          value={limit}
          onChange={(v) => setLimit(v || "100")}
          w={120}
          size="sm"
        />
        <Text size="sm" c="dimmed" pb={6}>
          {entries?.length ?? 0} shown
        </Text>
      </Group>

      {isLoading ? (
        <Group justify="center" mt="xl">
          <Loader />
        </Group>
      ) : !entries || entries.length === 0 ? (
        <Text c="dimmed">No audit log entries found.</Text>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Time</Table.Th>
              <Table.Th>Operation</Table.Th>
              <Table.Th>Author</Table.Th>
              <Table.Th>Document</Table.Th>
              <Table.Th>Description</Table.Th>
              <Table.Th>Size</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {entries.map((e) => (
              <Table.Tr key={e.id}>
                <Table.Td>
                  <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                    {formatDateTime(e.created_at)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge
                    variant="light"
                    size="sm"
                    color={operationColor(e.operation)}
                  >
                    {e.operation}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    <Text size="sm">{e.author}</Text>
                    <Badge
                      variant="dot"
                      size="xs"
                      color={e.author_type === "agent" ? "violet" : "green"}
                    >
                      {e.author_type}
                    </Badge>
                  </Group>
                </Table.Td>
                <Table.Td>
                  {e.document_id ? (
                    <Anchor
                      size="xs"
                      onClick={(ev) => {
                        ev.preventDefault();
                        navigate(`/document/${e.document_id}`);
                      }}
                      href={`/app/document/${e.document_id}`}
                    >
                      {e.doc_title || e.document_id.slice(0, 8) + "..."}
                    </Anchor>
                  ) : (
                    <Text size="xs" c="dimmed">
                      (deleted)
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Text size="xs" lineClamp={2}>
                    {e.description}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {e.size_before != null && e.size_after != null ? (
                    <Text size="xs" c="dimmed">
                      {e.size_before.toLocaleString()} {"->"} {e.size_after.toLocaleString()}
                    </Text>
                  ) : e.size_after != null ? (
                    <Text size="xs" c="dimmed">
                      {e.size_after.toLocaleString()}
                    </Text>
                  ) : null}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Container>
  );
}
