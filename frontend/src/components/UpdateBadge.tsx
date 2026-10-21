import { Badge, Code, Tooltip } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { fetchVersion } from "../api/version";

const REPO_RELEASES_URL =
  "https://github.com/fstamatelopoulos/cerefox/releases";

/**
 * "vX.Y.Z available", next to the logo.
 *
 * A badge, not a banner (#323): banners here mean something is wrong, and a
 * newer release is not. It sat in the footer until 1.19.2, where most pages
 * needed a scroll to reach it. The server decides "newer" (by semver) and which
 * command applies, so the UI only renders.
 */
export function UpdateBadge() {
  const { data } = useQuery({
    queryKey: ["version"],
    queryFn: fetchVersion,
    staleTime: Infinity,
    // A tab can stay open for days; pick up a release the server learned of
    // after the page loaded (it re-checks npm daily).
    refetchInterval: 6 * 60 * 60 * 1000,
    retry: false,
  });

  if (!data?.latest || !data.update_command) return null;

  return (
    <Tooltip
      label={
        <>
          Run{" "}
          {/* Code takes the tooltip's text color but paints its own
              background, the same shade as that text in either theme: the
              command rendered as a blank pill. Tint from the text color. */}
          <Code bg="color-mix(in srgb, currentColor 18%, transparent)">
            {data.update_command}
          </Code>{" "}
          to upgrade
        </>
      }
      withArrow
    >
      <Badge
        component="a"
        href={`${REPO_RELEASES_URL}/tag/v${data.latest}`}
        target="_blank"
        rel="noopener noreferrer"
        color="orange"
        variant="light"
        size="sm"
        style={{ cursor: "pointer", textTransform: "none" }}
        data-testid="update-badge"
      >
        v{data.latest} available
      </Badge>
    </Tooltip>
  );
}
