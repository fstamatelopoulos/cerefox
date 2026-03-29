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
import { ResponsiveBar } from "@nivo/bar";
import { ResponsivePie } from "@nivo/pie";
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
import { HEBOperationChart } from "../components/HEBOperationChart";

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

const PIE_COLORS = [
  "#228be6", "#12b886", "#e8590c", "#9c36b5", "#15aabf", "#e03131", "#74b816", "#4263eb",
];

// Nivo theme that respects the current color scheme via CSS variables
const nivoTheme = {
  text: { fill: "var(--mantine-color-text)" },
  axis: {
    ticks: { text: { fill: "var(--mantine-color-dimmed)", fontSize: 11 } },
    legend: { text: { fill: "var(--mantine-color-text)", fontSize: 12 } },
  },
  grid: { line: { stroke: "var(--mantine-color-default-border)", strokeWidth: 1 } },
  tooltip: {
    container: {
      background: "var(--mantine-color-body)",
      color: "var(--mantine-color-text)",
      border: "1px solid var(--mantine-color-default-border)",
      borderRadius: 4,
      fontSize: 12,
    },
  },
};

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
  usageLog: Array<{ requestor: string | null; doc_title: string | null; document_id: string | null; operation: string }>;
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
            <div style={{ height: 250 }}>
              <ResponsiveBar
                data={summary.ops_by_day.map((d) => ({
                  day: d.day.slice(5),
                  calls: d.count,
                }))}
                keys={["calls"]}
                indexBy="day"
                margin={{ top: 10, right: 20, bottom: 40, left: 50 }}
                padding={0.3}
                colors={["#228be6"]}
                axisBottom={{ tickRotation: summary.ops_by_day.length > 15 ? -45 : 0 }}
                axisLeft={{ legend: "Calls", legendPosition: "middle", legendOffset: -40 }}
                enableLabel={false}
                theme={nivoTheme}
              />
            </div>
          </Card>

          <Grid>
            {/* ── V2: Access paths ──────────────────────────────────────── */}
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Card withBorder p="md" h="100%">
                <Text fw={500} mb="sm">By Access Path</Text>
                <div style={{ height: 200 }}>
                  <ResponsiveBar
                    data={summary.ops_by_access_path.map((d) => ({
                      path: d.access_path,
                      calls: d.count,
                    }))}
                    keys={["calls"]}
                    indexBy="path"
                    margin={{ top: 10, right: 20, bottom: 40, left: 50 }}
                    padding={0.4}
                    colors={["#12b886"]}
                    enableLabel={false}
                    theme={nivoTheme}
                  />
                </div>
              </Card>
            </Grid.Col>

            {/* ── V5: Operations donut ──────────────────────────────────── */}
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Card withBorder p="md" h="100%">
                <Text fw={500} mb="sm">Operations Breakdown</Text>
                <div style={{ height: 200 }}>
                  <ResponsivePie
                    data={summary.ops_by_operation.map((d, i) => ({
                      id: d.operation,
                      label: d.operation,
                      value: d.count,
                      color: PIE_COLORS[i % PIE_COLORS.length],
                    }))}
                    margin={{ top: 20, right: 80, bottom: 20, left: 80 }}
                    innerRadius={0.5}
                    padAngle={1}
                    cornerRadius={3}
                    colors={{ datum: "data.color" }}
                    arcLinkLabelsTextColor="var(--mantine-color-text)"
                    arcLinkLabelsColor={{ from: "color" }}
                    arcLabelsTextColor="#fff"
                    enableArcLabels={false}
                    theme={nivoTheme}
                  />
                </div>
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
                  <div style={{ height: Math.max(150, summary.top_documents.length * 32) }}>
                    <ResponsiveBar
                      data={summary.top_documents.map((d) => ({
                        doc: d.doc_title.length > 25 ? d.doc_title.slice(0, 23) + "..." : d.doc_title,
                        calls: d.count,
                      }))}
                      keys={["calls"]}
                      indexBy="doc"
                      layout="horizontal"
                      margin={{ top: 5, right: 30, bottom: 30, left: 160 }}
                      padding={0.3}
                      colors={["#e8590c"]}
                      enableLabel
                      labelTextColor="#fff"
                      theme={nivoTheme}
                    />
                  </div>
                )}
              </Card>
            </Grid.Col>

            {/* ── V4: Top requestors ──────────────────────────────────────── */}
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Card withBorder p="md" h="100%">
                <Text fw={500} mb="sm">Most Active Requestors</Text>
                {summary.top_requestors.length === 0 ? (
                  <Text c="dimmed" size="sm">No requestor attribution recorded.</Text>
                ) : (
                  <div style={{ height: Math.max(150, summary.top_requestors.length * 32) }}>
                    <ResponsiveBar
                      data={summary.top_requestors.map((d) => ({
                        requestor: d.requestor,
                        calls: d.count,
                      }))}
                      keys={["calls"]}
                      indexBy="requestor"
                      layout="horizontal"
                      margin={{ top: 5, right: 30, bottom: 30, left: 120 }}
                      padding={0.3}
                      colors={["#9c36b5"]}
                      enableLabel
                      labelTextColor="#fff"
                      theme={nivoTheme}
                    />
                  </div>
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

            {/* ── V7: HEB requestors → documents ─────────────────────────── */}
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Card withBorder p="md" h="100%">
                <Text fw={500} mb="sm">Requestor → Document Access Patterns</Text>
                <HEBChart usageLog={usageLog} />
              </Card>
            </Grid.Col>
          </Grid>

          {/* ── V8: HEB requestors → operations ────────────────────────── */}
          <Card withBorder p="md">
            <Text fw={500} mb="sm">Requestor → Operation Patterns</Text>
            <HEBOperationChart usageLog={usageLog} />
          </Card>
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
