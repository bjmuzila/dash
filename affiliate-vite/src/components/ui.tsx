import type { CSSProperties, ReactNode } from "react";
import { THEME, TYPE, rgba, cardStyle, tileStyle } from "../lib/theme";

/**
 * The whole component vocabulary for affiliate.cbedge.net. Small on purpose —
 * this app is six screens, and every one of them is a card, a stat tile, a
 * table or a form field.
 *
 * NOTE Card takes no `accent` prop and never will. See the rule at the top of
 * lib/theme.ts: colour on this surface means state.
 */

export function Card({
  children, title, right, padding = 20, style, className,
}: {
  children?: ReactNode; title?: ReactNode; right?: ReactNode;
  padding?: number | string; style?: CSSProperties; className?: string;
}) {
  return (
    <div className={`card-hover${className ? ` ${className}` : ""}`} style={{ ...cardStyle, ...style }}>
      {(title != null || right != null) && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "13px 18px", borderBottom: `1px solid ${THEME.border}`,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.12em",
            textTransform: "uppercase", color: THEME.dim,
          }}>{title}</div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>{right}</div>
        </div>
      )}
      <div style={{ padding }}>{children}</div>
    </div>
  );
}

/** A card whose body is a table — the padding has to be zero or the table's own
 *  cell padding double-inset every row. */
export function TableCard({ children, title, right }: { children: ReactNode; title?: ReactNode; right?: ReactNode }) {
  return (
    <Card title={title} right={right} padding={0}>
      <div style={{ overflowX: "auto" }}>{children}</div>
    </Card>
  );
}

export function Stat({ label, value, sub, tone }: {
  label: string; value: ReactNode; sub?: ReactNode;
  tone?: "cyan" | "green" | "orange" | "blue" | "plain";
}) {
  const color =
    tone === "green" ? THEME.green :
    tone === "orange" ? THEME.orange :
    tone === "blue" ? THEME.lightBlue :
    tone === "cyan" ? THEME.cyan : THEME.text;
  return (
    <div style={{ ...tileStyle, padding: "15px 16px" }}>
      <div style={{ fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: THEME.dim2, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 7, lineHeight: 1, color }}>{value}</div>
      {sub != null && <div style={{ fontSize: 11, color: THEME.dim2, marginTop: 7 }}>{sub}</div>}
    </div>
  );
}

export type PillTone = "cyan" | "green" | "orange" | "red" | "blue" | "grey";
export function Pill({ tone = "grey", children }: { tone?: PillTone; children: ReactNode }) {
  const c =
    tone === "cyan" ? THEME.cyan :
    tone === "green" ? THEME.green :
    tone === "orange" ? THEME.orange :
    tone === "blue" ? THEME.lightBlue :
    tone === "red" ? THEME.softRed : null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 999,
      fontSize: TYPE.micro, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase",
      whiteSpace: "nowrap",
      color: c || THEME.dim2,
      border: `1px solid ${c ? rgba(c, 0.35) : THEME.border}`,
      background: c ? rgba(c, 0.10) : "transparent",
    }}>{children}</span>
  );
}

export function CodePill({ code, size = 12 }: { code: string | null | undefined; size?: number }) {
  if (!code) return <span style={{ color: THEME.dim2 }}>—</span>;
  return (
    <span style={{
      display: "inline-block", padding: size > 14 ? "8px 16px" : "3px 9px", borderRadius: 6,
      border: `1px dashed ${rgba(THEME.cyan, 0.4)}`, background: rgba(THEME.cyan, 0.08),
      color: THEME.cyan, fontWeight: 700, letterSpacing: "0.1em", fontSize: size,
      fontFamily: "var(--font-mono)",
    }}>{code}</span>
  );
}

export function Banner({ tone = "cyan", children }: { tone?: "cyan" | "orange" | "green" | "red"; children: ReactNode }) {
  const c =
    tone === "orange" ? THEME.orange :
    tone === "green" ? THEME.green :
    tone === "red" ? THEME.softRed : THEME.cyan;
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 16px", borderRadius: 12,
      border: `1px solid ${rgba(c, 0.28)}`, background: rgba(c, 0.07),
      fontSize: 12.5, color: "rgba(255,255,255,0.85)", lineHeight: 1.55,
    }}>{children}</div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase",
        color: THEME.dim2, fontWeight: 700, marginBottom: 7,
      }}>{label}</div>
      {children}
      {hint != null && <div style={{ fontSize: 11, color: THEME.dim2, marginTop: 6, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}

/** Multi-select chips. Used once (the channels question) but pulled out because
 *  the styling is fiddly and inlining it made the form unreadable. */
export function ChipToggle({ options, value, onChange }: {
  options: readonly string[]; value: string[]; onChange: (next: string[]) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
            style={{
              padding: "8px 12px", borderRadius: 8, cursor: "pointer",
              border: `1px solid ${on ? rgba(THEME.cyan, 0.35) : THEME.border}`,
              background: on ? rgba(THEME.cyan, 0.10) : "rgba(255,255,255,0.03)",
              color: on ? THEME.cyan : THEME.dim,
              fontSize: TYPE.label, fontWeight: 600,
            }}
          >{o}</button>
        );
      })}
    </div>
  );
}

export const th: CSSProperties = {
  textAlign: "left", fontSize: 9.5, letterSpacing: "0.13em", textTransform: "uppercase",
  color: THEME.dim2, fontWeight: 700, padding: "10px 14px",
  borderBottom: `1px solid ${THEME.border}`, whiteSpace: "nowrap",
};
export const td: CSSProperties = {
  padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.05)",
  fontSize: TYPE.body, verticalAlign: "middle",
};
export const numCell: CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums" };

export function Empty({ children }: { children: ReactNode }) {
  return <div style={{ padding: "28px 18px", fontSize: TYPE.body, color: THEME.dim2, lineHeight: 1.6 }}>{children}</div>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div style={{
      padding: "10px 14px", borderRadius: 10, fontSize: TYPE.label,
      border: `1px solid ${rgba(THEME.softRed, 0.3)}`, background: rgba(THEME.softRed, 0.08),
      color: THEME.softRed,
    }}>{children}</div>
  );
}

/**
 * A bar sparkline. Deliberately not a charting library: this is one series of
 * at most 30 values on one screen, and a dependency for that is a dependency
 * that has to be upgraded forever.
 */
export function Spark({ values, height = 110 }: { values: number[]; height?: number }) {
  const max = Math.max(1, ...values);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height }}>
      {values.map((v, i) => (
        <div
          key={i}
          title={String(v)}
          style={{
            flex: 1,
            height: `${Math.max(2, (v / max) * 100)}%`,
            borderRadius: "3px 3px 0 0",
            background: `linear-gradient(180deg, ${rgba(THEME.cyan, 0.85)}, ${rgba(THEME.cyan, 0.14)})`,
          }}
        />
      ))}
      {values.length === 0 && (
        <div style={{ alignSelf: "center", width: "100%", textAlign: "center", color: THEME.dim2, fontSize: TYPE.label }}>
          No earnings yet
        </div>
      )}
    </div>
  );
}
