import { Anchor, Group, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { fetchVersion } from "../api/version";

const REPO_RELEASES_URL =
  "https://github.com/fstamatelopoulos/cerefox/releases";

export function VersionFooter() {
  const { data } = useQuery({
    queryKey: ["version"],
    queryFn: fetchVersion,
    staleTime: Infinity,
    retry: false,
  });

  if (!data) return null;

  const releaseUrl = `${REPO_RELEASES_URL}/tag/v${data.version}`;
  const commitSuffix = data.git_commit_short
    ? ` (${data.git_commit_short})`
    : "";

  return (
    <Group justify="center" py="sm" gap="xs">
      <Text size="xs" c="dimmed">
        Cerefox{" "}
        <Anchor
          href={releaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          size="xs"
          c="dimmed"
          underline="hover"
        >
          v{data.version}
        </Anchor>
        {commitSuffix}
      </Text>
    </Group>
  );
}
