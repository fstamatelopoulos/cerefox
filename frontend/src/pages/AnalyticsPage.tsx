import {
  Button,
  Card,
  Container,
  Grid,
  Group,
  Loader,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { BarChart, DonutChart } from "@mantine/charts";
import { IconDownload, IconPlayerPlay } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import {
  fetchUsageSummary,
  fetchUsageLog,
  getConfig,
  getUsageExportUrl,
  setConfig,
  type UsageFilters,
  type UsageSummary,
} from "../api/analytics";
import { fetchProjects } from "../api/projects";
import { WordCloudChart } from "../components/WordCloudChart";
import { HEBChart } from "../components/HEBChart";

const DATE_PRESETS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

const ACCESS_PATH_OPTIONS = [
  { value: "", label: "All paths" },
  { value: "remote-mcp", label: "Remote MCP" },
  { value: "local-mcp", label: "Local MCP" },
  { value: "edge-function", label: "Edge Function" },
  { value: "webapp", label: "Web App" },
  { value: "cli", label: "CLI" },
];

const CHART_COLORS = [
  "blue", "teal", "orange", "grape", "cyan", "pink", "lime", "indigo",
];

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function buildFilters(
  datePreset: string,
  customStart: string,
  customEnd: string,
  projectId: string,
  accessPath: string,
): UsageFilters {
  const filters: UsageFilters = {};
  if (datePreset !== "all") {
    filters.start = daysAgo(Number(datePreset));
  }
  if (customStart) filters.start = customStart;
  if (customEnd) filters.end = customEnd;
  if (projectId) filters.project_id = projectId;
  if (accessPath) filters.access_path = accessPath;
  return filters;
}

export function AnalyticsPage() {
  const queryClient = useQueryClient();

  // ── Filter state ─────────────────────────────────────────────────────────
  const [datePreset, setDatePreset] = useState("30");
  const [projectId, setProjectId] = useState("");
  const [accessPath, setAccessPath] = useState("");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  // ── On-demand analysis state ─────────────────────────────────────────────
  const [analysisFilters, setAnalysisFilters] = useState<UsageFilters | null>(null);

  // Only fetch projects and config on page load (lightweight)
  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
    staleTime: 60_000,
    retry: 1,
  });

  const { data: trackingEnabled } = useQuery({
    queryKey: ["config", "usage_tracking_enabled"],
    queryFn: () => getConfig("usage_tracking_enabled"),
    staleTime: 10_000,
    retry: 1,
  });

  // Summary and usage log only fetched on demand (after Run Analysis click)
  const { data: summary, isLoading: summaryLoading, error: summaryError } = useQuery({
    queryKey: ["usageSummary", analysisFilters],
    queryFn: () => fetchUsageSummary(analysisFilters!),
    enabled: analysisFilters !== null,
    staleTime: 60_000,
    retry: 0,
  });

  const { data: usageLog, isLoading: logLoading } = useQuery({
    queryKey: ["usageLog", analysisFilters],
    queryFn: () => fetchUsageLog({ ...analysisFilters!, limit: 200 }),
    enabled: analysisFilters !== null && summary !== undefined,  // wait for summary first
    staleTime: 60_000,
    retry: 0,
  });

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      setConfig("usage_tracking_enabled", enabled ? "true" : "false"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config"] });
    },
  });

  const projectOptions = [
    { value: "", label: "All projects" },
    ...(projects ?? []).map((p) => ({ value: p.id, label: p.name })),
  ];

  const isEnabled = trackingEnabled === "true";
  const isLoading = summaryLoading || logLoading;
  const error = summaryError;

  const handleRunAnalysis = useCallback(() => {
    const filters = buildFilters(datePreset, customStart, customEnd, projectId, accessPath);
    setAnalysisFilters(filters);
  }, [datePreset, customStart, customEnd, projectId, accessPath]);

  const exportFilters = analysisFilters ?? buildFilters(datePreset, customStart, customEnd, projectId, accessPath);

  return (
    <Container size="xl">
      <Group justify="space-between" mb="md">
        <Title order={2}>Analytics</Title>
        <Group gap="xs">
          <Button
            variant="subtle"
            leftSection={<IconDownload size={16} />}
            component="a"
            href={getUsageExportUrl(exportFilters)}
            download
            size="sm"
          >
            Export CSV
          </Button>
        </Group>
      </Group>

      {/* ── Filters + Toggle ──────────────────────────────────────────── */}
      <Card withBorder mb="md" p="sm">
        <Group gap="sm" wrap="wrap">
          <Select
            label="Period"
            data={DATE_PRESETS}
            value={datePreset}
            onChange={(v) => { setDatePreset(v ?? "30"); setCustomStart(""); setCustomEnd(""); }}
            size="xs"
            w={140}
          />
          <TextInput
            label="Custom start"
            placeholder="YYYY-MM-DD"
            value={customStart}
            onChange={(e) => { setCustomStart(e.currentTarget.value); setDatePreset("all"); }}
            size="xs"
            w={130}
          />
          <TextInput
            label="Custom end"
            placeholder="YYYY-MM-DD"
            value={customEnd}
            onChange={(e) => { setCustomEnd(e.currentTarget.value); setDatePreset("all"); }}
            size="xs"
            w={130}
          />
          <Select
            label="Project"
            data={projectOptions}
            value={projectId}
            onChange={(v) => setProjectId(v ?? "")}
            size="xs"
            w={160}
            clearable
          />
          <Select
            label="Access path"
            data={ACCESS_PATH_OPTIONS}
            value={accessPath}
            onChange={(v) => setAccessPath(v ?? "")}
            size="xs"
            w={150}
            clearable
          />
          <Stack gap={2} justify="flex-end" style={{ paddingTop: 20 }}>
            <Switch
              label="Tracking"
              checked={isEnabled}
              onChange={(e) => toggleMutation.mutate(e.currentTarget.checked)}
              size="sm"
              color={isEnabled ? "green" : "gray"}
            />
          </Stack>
          <Stack gap={2} justify="flex-end" style={{ paddingTop: 20 }}>
            <Button
              leftSection={<IconPlayerPlay size={16} />}
              onClick={handleRunAnalysis}
              loading={isLoading}
              size="sm"
            >
              Run Analysis
            </Button>
          </Stack>
        </Group>
      </Card>

      {/* ── Loading / Error ───────────────────────────────────────────── */}
      {isLoading && (
        <Group justify="center" mt="xl"><Loader /></Group>
      )}
      {error && (
        <Text c="red" mt="md">Error loading analytics: {(error as Error).message}</Text>
      )}

      {!analysisFilters && !isLoading && (
        <Card withBorder p="xl" mt="md">
          <Text ta="center" c="dimmed" size="lg">
            Select filters and click "Run Analysis" to load usage data.
          </Text>
        </Card>
      )}

      {summary && <AnalyticsDashboard summary={summary} usageLog={usageLog ?? []} />}
    </Container>
  );
}

// ── Dashboard content ──────────────────────────────────────────────────────

function AnalyticsDashboard({
  summary,
  usageLog,
}: {
  summary: UsageSummary;
  usageLog: Array<{ requestor: string | null; doc_title: string | null; document_id: string | null }>;
}) {
  const topOp = summary.ops_by_operation[0];

  return (
    <Stack gap="md">
      {/* ── Stat cards ────────────────────────────────────────────────── */}
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <StatCard label="Total Calls" value={summary.total_count.toLocaleString()} />
        <StatCard
          label="Unique Requestors"
          value={String(summary.top_requestors.length)}
        />
        <StatCard
          label="Docs Accessed"
          value={String(summary.top_documents.length)}
        />
        <StatCard
          label="Top Operation"
          value={topOp ? topOp.operation : "--"}
          sub={topOp ? `${topOp.count} calls` : ""}
        />
      </SimpleGrid>

      {summary.total_count === 0 ? (
        <Card withBorder p="xl">
          <Text ta="center" c="dimmed" size="lg">
            No usage data for the selected period. Enable tracking and use the
            knowledge base to start collecting analytics.
          </Text>
        </Card>
      ) : (
        <>
          {/* ── V1: Calls per day ──────────────────────────────────────── */}
          <Card withBorder p="md">
            <Text fw={500} mb="sm">Calls per Day</Text>
            <BarChart
              h={250}
              data={summary.ops_by_day.map((d) => ({
                day: d.day.slice(5),  // MM-DD
                calls: d.count,
              }))}
              dataKey="day"
              series={[{ name: "calls", color: "blue.6" }]}
              tickLine="y"
            />
          </Card>

          <Grid>
            {/* ── V2: Access paths ──────────────────────────────────────── */}
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Card withBorder p="md" h="100%">
                <Text fw={500} mb="sm">By Access Path</Text>
                <BarChart
                  h={200}
                  data={summary.ops_by_access_path.map((d) => ({
                    path: d.access_path,
                    calls: d.count,
                  }))}
                  dataKey="path"
                  series={[{ name: "calls", color: "teal.6" }]}
                  tickLine="y"
                />
              </Card>
            </Grid.Col>

            {/* ── V5: Operations donut ──────────────────────────────────── */}
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Card withBorder p="md" h="100%">
                <Text fw={500} mb="sm">Operations Breakdown</Text>
                <DonutChart
                  h={200}
                  data={summary.ops_by_operation.map((d, i) => ({
                    name: d.operation,
                    value: d.count,
                    color: `${CHART_COLORS[i % CHART_COLORS.length]}.6`,
                  }))}
                  withLabelsLine
                  labelsType="percent"
                />
              </Card>
            </Grid.Col>
          </Grid>

          <Grid>
            {/* ── V3: Top documents ─────────────────────────────────────── */}
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Card withBorder p="md" h="100%">
                <Text fw={500} mb="sm">Most Accessed Documents</Text>
                {summary.top_documents.length === 0 ? (
                  <Text c="dimmed" size="sm">No document-specific access recorded.</Text>
                ) : (
                  <BarChart
                    h={Math.max(150, summary.top_documents.length * 30)}
                    data={summary.top_documents.map((d) => ({
                      doc: d.doc_title.length > 30
                        ? d.doc_title.slice(0, 28) + "..."
                        : d.doc_title,
                      calls: d.count,
                    }))}
                    dataKey="doc"
                    series={[{ name: "calls", color: "orange.6" }]}
                    orientation="vertical"
                    tickLine="x"
                  />
                )}
              </Card>
            </Grid.Col>

            {/* ── V4: Top readers ──────────────────────────────────────── */}
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Card withBorder p="md" h="100%">
                <Text fw={500} mb="sm">Most Active Requestors</Text>
                {summary.top_requestors.length === 0 ? (
                  <Text c="dimmed" size="sm">No requestor attribution recorded.</Text>
                ) : (
                  <BarChart
                    h={Math.max(150, summary.top_requestors.length * 30)}
                    data={summary.top_requestors.map((d) => ({
                      reader: d.requestor,
                      calls: d.count,
                    }))}
                    dataKey="reader"
                    series={[{ name: "calls", color: "grape.6" }]}
                    orientation="vertical"
                    tickLine="x"
                  />
                )}
              </Card>
            </Grid.Col>
          </Grid>

          <Grid>
            {/* ── V6: Reader/author word cloud ──────────────────────────── */}
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Card withBorder p="md" h="100%">
                <Text fw={500} mb="sm">Requestor Activity (Word Cloud)</Text>
                {summary.top_requestors.length === 0 ? (
                  <Text c="dimmed" size="sm">No requestor data available.</Text>
                ) : (
                  <WordCloudChart
                    data={summary.top_requestors.map((r) => ({
                      text: r.requestor,
                      value: r.count,
                    }))}
                  />
                )}
              </Card>
            </Grid.Col>

            {/* ── V7: HEB readers → documents ──────────────────────────── */}
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Card withBorder p="md" h="100%">
                <Text fw={500} mb="sm">Requestor → Document Access Patterns</Text>
                <HEBChart usageLog={usageLog} />
              </Card>
            </Grid.Col>
          </Grid>
        </>
      )}
    </Stack>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card withBorder p="sm">
      <Text size="xs" c="dimmed" tt="uppercase" fw={500}>{label}</Text>
      <Text size="xl" fw={700} mt={4}>{value}</Text>
      {sub && <Text size="xs" c="dimmed">{sub}</Text>}
    </Card>
  );
}
