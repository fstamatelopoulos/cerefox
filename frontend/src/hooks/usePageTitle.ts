import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { fetchVersion } from "../api/version";
import { pageTitle } from "../lib/pageTitle";

/**
 * Sets the browser tab title for the page that calls it (#253).
 *
 * Every page calls this once. Pages whose title depends on loaded data pass
 * `null` (or nothing) while it loads, which shows the app name rather than a
 * flash of "undefined". The environment label is read from the same
 * `["version"]` query the environment banner uses, so it costs no extra
 * request.
 *
 * There is no cleanup on unmount: the next page sets its own title, and
 * restoring a previous one in between would only make the tab flicker.
 */
export function usePageTitle(page?: string | null, opts: { dirty?: boolean } = {}): void {
  const { data } = useQuery({
    queryKey: ["version"],
    queryFn: fetchVersion,
    staleTime: Infinity,
    retry: false,
  });
  const envLabel = data?.env_label ?? null;
  const dirty = opts.dirty ?? false;

  useEffect(() => {
    document.title = pageTitle({ page, envLabel, dirty });
  }, [page, envLabel, dirty]);
}
