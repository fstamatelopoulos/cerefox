import { Alert, Text } from "@mantine/core";
import { IconFlask } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";

import { fetchVersion } from "../api/version";

/**
 * Names the environment when `CEREFOX_ENV_LABEL` is set.
 *
 * Running a staging server alongside production means two browser tabs that
 * look identical while pointing at different databases — and the destructive
 * actions in this UI (delete, restore, ingest over an existing document) are
 * not ones you want to take against the wrong one. The label is the cheapest
 * possible guard: visible on every page, impossible to miss, zero behaviour
 * change.
 *
 * Renders nothing when the variable is unset, which is every normal install.
 * See docs/guides/staging-env.md.
 */
export function EnvironmentBanner() {
  const { data } = useQuery({
    queryKey: ["version"],
    queryFn: fetchVersion,
    staleTime: Infinity,
    retry: false,
  });

  const label = data?.env_label?.trim();
  if (!label) return null;

  return (
    <Alert
      icon={<IconFlask size={18} />}
      color="grape"
      withCloseButton={false}
      mb="md"
      data-testid="environment-banner"
    >
      <Text size="sm" fw={600}>
        {label.toUpperCase()} environment — not production.
      </Text>
      <Text size="xs" c="dimmed">
        This server is running against the <Text span fw={600}>{label}</Text>{" "}
        database. Changes made here do not affect production.
      </Text>
    </Alert>
  );
}
