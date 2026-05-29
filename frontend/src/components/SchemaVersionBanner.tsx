import { Alert, Code, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";

import { fetchSchemaVersion } from "../api/docs";

/**
 * Catches the "I pulled new code but forgot to run db_deploy.py" footgun
 * (closes the v0.1.19 redeploy footgun documented in the CHANGELOG).
 *
 * Hidden by default. Renders only when the backend reports
 * `mismatch: true` — i.e. the schema version bundled with the running
 * Cerefox install differs from what is deployed to the database.
 */
export function SchemaVersionBanner() {
  const { data } = useQuery({
    queryKey: ["schema-version"],
    queryFn: fetchSchemaVersion,
    // Refresh every 60s so a successful redeploy clears the banner without
    // requiring a full reload.
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });

  if (!data || !data.mismatch) return null;

  return (
    <Alert
      icon={<IconAlertTriangle size={18} />}
      color="yellow"
      title="Database schema out of date"
      withCloseButton={false}
      mb="md"
    >
      <Text size="sm">
        Cerefox v{data.bundled} ships a newer schema than what is currently
        deployed to your Supabase (v{data.deployed ?? "unknown"}). Some
        features may behave incorrectly until you redeploy.
      </Text>
      <Text size="sm" mt="xs">
        Run from the repo root:
      </Text>
      <Code block mt="xs">
        bun scripts/db_deploy.ts
      </Code>
    </Alert>
  );
}
