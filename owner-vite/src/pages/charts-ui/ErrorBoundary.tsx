import { Component, type ReactNode } from "react";
import { OWNER_THEME, TYPE, ownerRgba } from "../../lib/theme";

type Props = {
  children: ReactNode;
  /** shadcn registry items this route needs, e.g. ["@bklit/line-chart"] */
  items?: string[];
  resetKey?: string;
};

type State = { error: Error | null };

/**
 * Keeps one un-installed (or broken) chart from taking down the whole page —
 * the demo is lazy-loaded, so the failure is contained to its own chunk.
 */
export class ChartErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const missing = /Failed to (fetch|resolve|load)|Cannot find module|does not provide an export/i.test(
      error.message,
    );
    const items = this.props.items ?? [];

    return (
      <div
        style={{
          border: `1px solid ${ownerRgba(OWNER_THEME.red, 0.35)}`,
          background: ownerRgba(OWNER_THEME.red, 0.06),
          borderRadius: 14,
          padding: 20,
        }}
      >
        <div style={{ fontSize: TYPE.subhead, fontWeight: 800, color: OWNER_THEME.red }}>
          {missing ? "Component not installed yet" : "This demo threw an error"}
        </div>

        {missing && items.length > 0 && (
          <>
            <div style={{ marginTop: 8, fontSize: TYPE.label, opacity: 0.75 }}>
              Pull it from the Bklit registry, then reload:
            </div>
            <pre
              style={{
                marginTop: 10,
                padding: 12,
                borderRadius: 10,
                background: "rgba(0,0,0,0.35)",
                fontSize: TYPE.label,
                fontFamily: "var(--font-mono)",
                overflowX: "auto",
              }}
            >
              {items.map((i) => `npx shadcn@latest add ${i}`).join("\n")}
            </pre>
          </>
        )}

        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: "pointer", fontSize: TYPE.micro, opacity: 0.6 }}>Error detail</summary>
          <pre
            style={{
              marginTop: 8,
              fontSize: TYPE.micro,
              whiteSpace: "pre-wrap",
              opacity: 0.6,
              fontFamily: "var(--font-mono)",
            }}
          >
            {error.message}
            {"\n"}
            {error.stack?.split("\n").slice(0, 6).join("\n")}
          </pre>
        </details>
      </div>
    );
  }
}
