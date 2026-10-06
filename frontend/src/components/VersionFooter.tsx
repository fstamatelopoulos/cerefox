import { Anchor, Code, Group, Text, Tooltip } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { fetchVersion } from "../api/version";

const REPO_RELEASES_URL =
  "https://github.com/fstamatelopoulos/cerefox/releases";

export function VersionFooter() {
  const { data } = useQuery({
    queryKey: ["version"],
    queryFn: fetchVersion,
    staleTime: Infinity,
    // A tab can stay open for days; pick up a release the server learned of
    // after the page loaded (it re-checks npm daily).
    refetchInterval: 6 * 60 * 60 * 1000,
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
      {data.latest && data.update_command && (
        // Footer, not a banner (#323): banners here mean something is wrong,
        // and a newer release is not. The server decides "newer" (by semver)
        // and which command applies, so the UI only renders.
        <Tooltip label={<>Run <Code>{data.update_command}</Code> to upgrade</>} withArrow>
          <Anchor
            href={`${REPO_RELEASES_URL}/tag/v${data.latest}`}
            target="_blank"
            rel="noopener noreferrer"
            size="xs"
            c="orange"
            underline="hover"
          >
            · v{data.latest} available
          </Anchor>
        </Tooltip>
      )}
    </Group>
  );
}
