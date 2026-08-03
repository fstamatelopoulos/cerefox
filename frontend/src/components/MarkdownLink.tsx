import { Anchor, Button, List, Loader, Popover, Stack, Text } from "@mantine/core";
import { useState, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";

import { resolveLink } from "../api/links";
import type { LinkResolveResponse } from "../api/types";

/**
 * A markdown link renderer that intercepts *relative* paths and resolves them
 * to Cerefox documents at click time. External links, in-page anchors, and
 * absolute SPA paths pass through unchanged.
 *
 * Used as the `a` override on the react-markdown `components` prop in
 * MarkdownViewer. Optional `fromDocId` lets the resolver exclude self-links.
 *
 * Resolution outcomes:
 * - **single match** → navigate immediately
 * - **multiple matches** → show a popover with a chooser
 * - **no match** → show a popover with "Search instead" + the path
 *
 * Errors during resolution surface as the unresolved UX (don't break the
 * page). All popover state lives in this component — no global state needed.
 */

interface MarkdownLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  /** UUID of the document containing this link; passed to the resolver to suppress self-links. */
  fromDocId?: string;
}

/** Classify an href so we know whether to intercept. */
function classifyHref(href: string | undefined): "external" | "anchor" | "absolute" | "relative" | "empty" {
  if (!href || href.trim() === "") return "empty";
  const trimmed = href.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return "external"; // http:, https:, mailto:, tel:, etc.
  if (trimmed.startsWith("#")) return "anchor";
  if (trimmed.startsWith("/")) return "absolute";
  return "relative";
}

export function MarkdownLink({ href, children, fromDocId, ...rest }: MarkdownLinkProps) {
  const navigate = useNavigate();
  const kind = classifyHref(href);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LinkResolveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Pass-through paths: render as a plain anchor ────────────────────────
  if (kind === "external") {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  }
  if (kind === "anchor" || kind === "absolute" || kind === "empty") {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  }

  // ── Relative path: intercept ────────────────────────────────────────────

  const handleClick = async (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (loading) return;

    // If we already have a single-match result cached, navigate directly.
    if (result && result.matches.length === 1) {
      const m = result.matches[0];
      const target = `/document/${m.document_id}${result.anchor ?? ""}`;
      navigate(target);
      setOpen(false);
      return;
    }

    // URL-decode the href before sending to the resolver.
    //
    // react-markdown / remark-gfm normalises `<Title With Spaces>` markdown
    // syntax to a URL-encoded href like `Title%20With%20Spaces`. Without
    // decoding here, the encoded form gets re-encoded by URLSearchParams
    // and the server eventually sees the literal "%20" string as the
    // lookup path — which never matches any title. Decoding once here
    // restores the original.
    //
    // decodeURIComponent throws on malformed sequences (e.g. `%FF` without
    // a valid UTF-8 continuation); fall back to the raw href in that case
    // so a weirdly-encoded link still produces a best-effort lookup
    // instead of a runtime error.
    let lookupHref = href!;
    try {
      lookupHref = decodeURIComponent(href!);
    } catch {
      // Malformed URI sequence — keep raw href; server will attempt
      // best-effort matching on the literal characters.
    }

    setLoading(true);
    setError(null);
    try {
      const resolved = await resolveLink(lookupHref, fromDocId);
      setResult(resolved);
      if (resolved.matches.length === 1) {
        const m = resolved.matches[0];
        navigate(`/document/${m.document_id}${resolved.anchor ?? ""}`);
        return;
      }
      // 0 or 2+ matches → show popover
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOpen(true);
    } finally {
      setLoading(false);
    }
  };

  const linkAnchor = (
    <Anchor
      href={href}
      onClick={handleClick}
      style={{ cursor: loading ? "wait" : "pointer" }}
      {...rest}
    >
      {children}
      {loading && <Loader size="xs" style={{ marginLeft: 4, verticalAlign: "middle" }} />}
    </Anchor>
  );

  // No popover content unless we've attempted a resolution and got 0 or 2+ matches
  if (!open || !result || (result.matches.length === 1 && !error)) {
    return linkAnchor;
  }

  return (
    <Popover opened={open} onChange={setOpen} position="bottom-start" withArrow shadow="md" width={360}>
      <Popover.Target>{linkAnchor}</Popover.Target>
      <Popover.Dropdown>
        {error ? (
          <Stack gap="xs">
            <Text size="sm" c="red">Couldn't resolve link</Text>
            <Text size="xs" c="dimmed">{error}</Text>
            <Button size="xs" variant="subtle" onClick={() => setOpen(false)}>Dismiss</Button>
          </Stack>
        ) : result.matches.length === 0 ? (
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              No document found for <Text component="span" ff="monospace">{result.tried_path}</Text>
            </Text>
            <Text size="xs" c="dimmed">
              The path didn't match a source file or document title in the knowledge base.
            </Text>
            <Text size="xs" c="dimmed">
              For reliable cross-references, link by ID: <Text component="span" ff="monospace">[Text](document-uuid)</Text>.
              Search results show the UUID after each title.
            </Text>
            <Button
              size="xs"
              variant="light"
              onClick={() => {
                const q = result.tried_path.split("/").pop() ?? result.tried_path;
                navigate(`/search?q=${encodeURIComponent(q)}`);
                setOpen(false);
              }}
            >
              Search for "{result.tried_path.split("/").pop()}" instead
            </Button>
          </Stack>
        ) : (
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              {result.matches.length} possible matches for <Text component="span" ff="monospace">{result.tried_path}</Text>
            </Text>
            <List size="sm" spacing="xs">
              {result.matches.map((m) => (
                <List.Item key={m.document_id}>
                  <Anchor
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/document/${m.document_id}${result.anchor ?? ""}`);
                      setOpen(false);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    {m.title}
                  </Anchor>
                  {m.source_path && (
                    <Text size="xs" c="dimmed" ff="monospace">
                      {m.source_path}
                    </Text>
                  )}
                  <Text size="xs" c="dimmed">
                    matched by: {m.match_method.replace("_", " ")}
                  </Text>
                </List.Item>
              ))}
            </List>
          </Stack>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
