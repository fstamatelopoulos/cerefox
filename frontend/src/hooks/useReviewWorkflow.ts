import { useQuery } from "@tanstack/react-query";

import { getConfig } from "../api/analytics";

/**
 * Whether the review workflow is on for this store (#241). While it is off,
 * the API omits `review_status` from every read and refuses the review
 * endpoints, so the UI hides the badges, the pending-review search chip and
 * the approve toggle. Shares the `["config", <key>]` cache key the Settings
 * page invalidates on save, so flipping the flag there takes effect at once.
 *
 * Resolves to `false` until the value arrives: a badge that appears a beat
 * later is better than one that flashes and vanishes.
 */
export function useReviewWorkflow(): boolean {
  const { data } = useQuery({
    queryKey: ["config", "review_workflow_enabled"],
    queryFn: () => getConfig("review_workflow_enabled"),
    staleTime: 60_000,
    retry: 1,
  });
  return (data ?? "").trim().toLowerCase() === "true";
}
