import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Modal,
  NumberInput,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { fetchConfig, setConfigValue, type ConfigEntry } from "../api/config";
import { CliCard } from "../components/CliCard";
import { showError, showSuccess } from "../utils/notifications";

/**
 * Runtime settings — the web face of `cerefox config get/set`.
 *
 * These live in the `cerefox_config` table, not in `.env`, which is what makes
 * them worth a UI: one write governs every access path (CLI, local and remote
 * MCP, Edge Functions, this app) because they all resolve through the same
 * RPCs.
 *
 * Deliberately NOT an `.env` editor. That file holds the service-role key, the
 * OpenAI key and the database password; a web endpoint that writes it would be
 * a credential-exposure surface, and the server only reads it at boot anyway.
 * Local overrides are shown read-only, because a `CEREFOX_*` variable beats the
 * stored value on the machine that has it — a settings page that hid that would
 * report success while the server kept using a different number.
 */

const GROUP_ORDER = ["Retrieval", "Retention", "Governance", "Features"] as const;

const GROUP_BLURB: Record<string, string> = {
  Retrieval: "How search ranks and filters results.",
  Governance: "Attribution and audit requirements for agent calls.",
  Retention: "How long document version history is kept.",
  Features: "Optional capabilities, off until you turn them on.",
};

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["config"], queryFn: fetchConfig });

  // Pending high-impact change awaiting explicit confirmation.
  const [confirming, setConfirming] = useState<{ entry: ConfigEntry; value: string } | null>(
    null,
  );
  // Local edit buffer for text/number fields, so typing doesn't fire a write
  // per keystroke.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => setConfigValue(key, value),
    onSuccess: (_res, vars) => {
      showSuccess(`Saved ${vars.key}`);
      void queryClient.invalidateQueries({ queryKey: ["config"] });
      // AnalyticsPage caches this key separately (["config", <key>]); without
      // this it keeps showing the pre-toggle value.
      void queryClient.invalidateQueries({ queryKey: ["config", vars.key] });
      setDrafts((d) => {
        const next = { ...d };
        delete next[vars.key];
        return next;
      });
    },
    onError: (err: unknown) => {
      showError(err instanceof Error ? err.message : String(err));
    },
  });

  function save(entry: ConfigEntry, value: string) {
    // High-impact keys change what *other* software sees — agents gaining or
    // losing tools, calls starting to fail. Those get a confirmation naming the
    // consequence, never a bare toggle.
    if (entry.high_impact) {
      setConfirming({ entry, value });
      return;
    }
    mutation.mutate({ key: entry.key, value });
  }

  if (isLoading) return <Text>Loading settings…</Text>;

  const entries = data?.keys ?? [];

  return (
    <Stack gap="lg">
      <div>
        <Title order={2} data-testid="page-title">
          Settings
        </Title>
        <Text c="dimmed" size="sm">
          Runtime configuration stored in the database. A change here applies to every
          access path — this app, the CLI, and every connected agent.
        </Text>
      </div>

      {GROUP_ORDER.map((group) => {
        const inGroup = entries.filter((e) => e.group === group);
        if (inGroup.length === 0) return null;
        return (
          <Card key={group} withBorder padding="md" data-testid={`config-group-${group}`}>
            <Stack gap="xs">
              <div>
                <Title order={4}>{group}</Title>
                <Text size="xs" c="dimmed">
                  {GROUP_BLURB[group]}
                </Text>
              </div>
              {inGroup.map((entry) => (
                <ConfigRow
                  key={entry.key}
                  entry={entry}
                  draft={drafts[entry.key]}
                  onDraft={(v) => setDrafts((d) => ({ ...d, [entry.key]: v }))}
                  onSave={(v) => save(entry, v)}
                  saving={mutation.isPending}
                />
              ))}
            </Stack>
          </Card>
        );
      })}

      <CliCard
        title="CLI equivalent"
        commands={[
          { cmd: "cerefox config list" },
          { cmd: "cerefox config get", args: "min_search_score" },
          // Deliberately a neutral key. `relations_enabled true` would be a
          // copy-pasteable command that switches on the one feature shipped
          // dormant on purpose — an example should show the syntax, not nudge.
          { cmd: "cerefox config set", args: "min_search_score 0.6" },
        ]}
      />

      <Modal
        opened={confirming !== null}
        onClose={() => setConfirming(null)}
        title="Confirm this change"
        data-testid="config-confirm-modal"
      >
        {confirming && (
          <Stack gap="sm" data-testid="config-confirm-body">
            <Text size="sm">
              Set <Code>{confirming.entry.key}</Code> to <Code>{confirming.value}</Code>?
            </Text>
            {confirming.entry.impact_note && (
              <Alert icon={<IconAlertTriangle size={16} />} color="yellow">
                <Text size="sm">{confirming.entry.impact_note}</Text>
              </Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button
                data-testid="config-confirm-apply"
                loading={mutation.isPending}
                onClick={() => {
                  mutation.mutate({
                    key: confirming.entry.key,
                    value: confirming.value,
                  });
                  setConfirming(null);
                }}
              >
                Apply
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

function ConfigRow({
  entry,
  draft,
  onDraft,
  onSave,
  saving,
}: {
  entry: ConfigEntry;
  draft: string | undefined;
  onDraft: (v: string) => void;
  onSave: (v: string) => void;
  saving: boolean;
}) {
  const current = draft ?? entry.effective;
  // Mirrors `doctor`'s logic (v1.1.0): a leftover .env line whose value is
  // already in the store is inert trivia; one that DIFFERS means the operator's
  // tuning is silently not in effect, which is the case worth shouting about.
  // Numeric compare so 0.7 and 0.70 are the same value, not a false alarm.
  const retiredMatchesStored = (() => {
    const envValue = entry.retired_env_set?.value;
    if (envValue === undefined) return false;
    const a = Number(envValue);
    const b = Number(entry.effective);
    return Number.isFinite(a) && Number.isFinite(b)
      ? a === b
      : envValue.trim() === entry.effective.trim();
  })();
  const dirty = draft !== undefined && draft !== entry.effective;

  return (
    <Card withBorder padding="sm" radius="sm" data-testid={`config-row-${entry.key}`}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" wrap="nowrap" align="baseline">
            <Text size="sm" fw={500}>
              {entry.description}
            </Text>
            {entry.value === null && (
              <Badge size="xs" variant="light" color="gray">
                using default
              </Badge>
            )}
            {entry.high_impact && (
              <Badge size="xs" variant="light" color="yellow">
                affects agents
              </Badge>
            )}
          </Group>
          {/* The key is the identifier used by `cerefox config set` and the
              docs — needed, but secondary to what the setting actually does. */}
          <Code style={{ fontSize: "0.72rem" }}>{entry.key}</Code>

          {entry.retired_env_set && (
            <Alert
              icon={<IconAlertTriangle size={14} />}
              color={retiredMatchesStored ? "gray" : "yellow"}
              mt="xs"
              p="xs"
              data-testid={`config-retired-env-${entry.key}`}
            >
              <Text size="xs">
                <Code>{entry.retired_env_set.name}</Code> is still set in this server's
                environment (to <Code>{entry.retired_env_set.value}</Code>) but is{" "}
                <Text span fw={600}>
                  no longer read
                </Text>
                . This setting moved into the database in v1.1.0 so one value governs
                every client.{" "}
                {retiredMatchesStored ? (
                  <>
                    The stored value already matches, so nothing changes: delete that line
                    from your <Code>.env</Code>.
                  </>
                ) : (
                  <Text span fw={600}>
                    Your .env asked for {entry.retired_env_set.value}, but{" "}
                    {entry.effective} is what actually runs. Set it here if you want the
                    old value back, then delete the line from your .env.
                  </Text>
                )}
              </Text>
            </Alert>
          )}
        </div>

        <div style={{ minWidth: 190 }}>
          {entry.kind === "boolean" ? (
            <Switch
              checked={current === "true"}
              disabled={saving}
              onChange={(e) => onSave(e.currentTarget.checked ? "true" : "false")}
              label={current === "true" ? "true" : "false"}
            />
          ) : entry.kind === "number" ? (
            <Group gap="xs" wrap="nowrap">
              <NumberInput
                value={current === "" ? "" : Number(current)}
                min={entry.min ?? undefined}
                max={entry.max ?? undefined}
                step={0.05}
                decimalScale={3}
                size="xs"
                style={{ width: 100 }}
                onChange={(v) => onDraft(String(v))}
              />
              <Button size="xs" disabled={!dirty || saving} onClick={() => onSave(current)}>
                Save
              </Button>
            </Group>
          ) : (
            <Group gap="xs" wrap="nowrap">
              <TextInput
                value={current}
                size="xs"
                style={{ width: 120 }}
                placeholder={entry.default || "(unset)"}
                onChange={(e) => onDraft(e.currentTarget.value)}
              />
              <Button size="xs" disabled={!dirty || saving} onClick={() => onSave(current)}>
                Save
              </Button>
            </Group>
          )}
          <Text size="xs" c="dimmed" ta="right" mt={4}>
            default if unset: {entry.default || "(empty)"}
          </Text>
        </div>
      </Group>
    </Card>
  );
}
