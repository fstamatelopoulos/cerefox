/**
 * The one thing between a render-time throw and a blank white page.
 *
 * Without a boundary, React unmounts the ENTIRE tree when any component throws
 * during render: `#root` ends up with zero children, and the user sees a white
 * page with no message, no error and nothing to click. That is exactly what
 * #289 looked like from the outside — a one-line bug in a metadata input read as
 * "the web app is broken", and the only way to find out otherwise was the
 * browser console.
 *
 * So the blast radius is worth capping on its own, separately from the bug that
 * exposed it. The boundary is deliberately dumb: it shows what happened, keeps
 * the navigation shell reachable, and offers the two things that actually help —
 * reload, or go back to the dashboard.
 *
 * It does NOT try to recover state. A component that threw mid-render has no
 * trustworthy state left, and pretending otherwise produces a second, stranger
 * failure.
 */

import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  /** The React component stack, which names the component that threw. */
  stack: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ stack: info.componentStack ?? null });
    // Keep the console record: the boundary swallows the default overlay, and
    // this is the only trace left for anyone debugging from a user's report.
    console.error("Unhandled render error", error, info.componentStack);
  }

  render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{ maxWidth: 760, margin: "12vh auto", padding: "0 20px", lineHeight: 1.55 }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Something broke on this page</h1>
        <p style={{ color: "var(--text-faint, #888)", marginTop: 0 }}>
          This is a bug in Cerefox, not something you did. The rest of the app still
          works — nothing was lost on the server.
        </p>
        <pre
          style={{
            background: "var(--surface-2, #f5f5f5)",
            border: "1px solid var(--border, #ddd)",
            borderRadius: 8,
            padding: 12,
            overflow: "auto",
            maxHeight: 220,
            fontSize: 12.5,
            whiteSpace: "pre-wrap",
          }}
        >
          {error.message}
          {stack ? `\n${stack.trim()}` : ""}
        </pre>
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
          {/* A full navigation, not a router push: the router lives inside the
              tree that just threw. */}
          <button type="button" onClick={() => (window.location.href = "/app/")}>
            Back to dashboard
          </button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-faint, #888)", marginTop: 16 }}>
          Please report it at{" "}
          <a href="https://github.com/fstamatelopoulos/cerefox/issues" target="_blank" rel="noreferrer">
            github.com/fstamatelopoulos/cerefox/issues
          </a>{" "}
          with the text above.
        </p>
      </div>
    );
  }
}
