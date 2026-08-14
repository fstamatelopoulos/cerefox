import type { QueryClient } from "@tanstack/react-query";

/**
 * The ONE list of views that show a document's title, status, or presence.
 *
 * Every lifecycle mutation (save, review toggle, delete, restore, purge) must
 * invalidate the same set, or the surface the caller happens to be on gets
 * fresh data while the others serve the 30s-stale cache on back-navigation.
 * That drift happened three separate ways before this helper existed: the
 * review toggle invalidated only its own document, the Trash page omitted
 * project lists, and the edit page omitted search — each hand-rolled list
 * missing different keys.
 */
export function invalidateDocumentViews(queryClient: QueryClient, id?: string): void {
  queryClient.invalidateQueries({ queryKey: id ? ["document", id] : ["document"] });
  queryClient.invalidateQueries({ queryKey: id ? ["document-audit", id] : ["document-audit"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard-recent"] });
  queryClient.invalidateQueries({ queryKey: ["search"] });
  queryClient.invalidateQueries({ queryKey: ["trash"] });
  queryClient.invalidateQueries({ queryKey: ["project-documents"] });
}
