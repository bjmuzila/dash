import type { ReactNode } from "react";
import { OWNER_THEME, TYPE } from "../../lib/theme";

/**
 * Section chrome for a single chart variant. Inline-styled off OWNER_THEME so it
 * matches the rest of owner-vite and doesn't depend on Tailwind being present.
 */
export function Frame({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        marginBottom: 20,
        border: `1px solid ${OWNER_THEME.border}`,
        borderRadius: 14,
        background: "rgba(0,0,0,0.22)",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          padding: "10px 14px",
          borderBottom: `1px solid ${OWNER_THEME.border}`,
        }}
      >
        <span style={{ fontSize: TYPE.label, fontWeight: 800, letterSpacing: "0.10em", textTransform: "uppercase" }}>
          {title}
        </span>
        {hint != null && (
          <span style={{ fontSize: TYPE.micro, color: OWNER_THEME.lightBlue, fontFamily: "var(--font-mono)" }}>
            {hint}
          </span>
        )}
      </header>
      <div style={{ padding: 16 }}>{children}</div>
    </section>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gap: 16,
        gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
      }}
    >
      {children}
    </div>
  );
}

/** Small inline button used for the loading/pause toggles in the demos. */
export function ToggleButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${OWNER_THEME.border}`,
        borderRadius: 8,
        background: "transparent",
        color: OWNER_THEME.lightBlue,
        padding: "2px 8px",
        fontSize: TYPE.micro,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}
