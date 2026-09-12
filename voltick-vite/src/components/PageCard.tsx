/**
 * Shared page chrome: PageShell + Card + Chip.
 *
 * Not everything is a card. Border, fill, radius and shadow each say "separate
 * object", so they get spent by role. One radius and one shadow stamped on
 * every block flattens the hierarchy it was meant to create.
 */
import type { CSSProperties, ReactNode } from "react";
import {
  CONTENT_MAX,
  LINE,
  MONO,
  PAPER,
  PAPER_DISPLAY,
  PAPER_QUIET,
  R_LG,
  R_PILL,
  W_BOLD,
  W_MED,
  cardStyle,
  rgba,
} from "../theme";

export function PageShell({
  title,
  lede,
  children,
  maxWidth = CONTENT_MAX,
}: {
  title: string;
  lede?: ReactNode;
  children: ReactNode;
  maxWidth?: number;
}) {
  return (
    <div style={{ width: "100%", maxWidth, marginInline: "auto", padding: "28px 20px 72px" }}>
      <header style={{ marginBottom: 26 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 28,
            lineHeight: 1.2,
            fontWeight: W_BOLD,
            letterSpacing: "-0.01em",
            // 16px+ bold headlines take PAPER_DISPLAY: large bold glyphs render
            // visually hotter than body text at the same hex, so a headline at
            // PAPER reads as pure white. One step deeper makes it MATCH body
            // text optically. Do not equalise them back.
            color: PAPER_DISPLAY,
          }}
        >
          {title}
        </h1>
        {lede != null && (
          <p style={{ margin: "10px 0 0", maxWidth: 720, fontSize: 15, color: PAPER_QUIET }}>{lede}</p>
        )}
      </header>
      {children}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  children,
  padding = 20,
  style,
  className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  padding?: number | string;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <section className={className} style={{ ...cardStyle, padding, ...style }}>
      {(title != null || subtitle != null) && (
        <div style={{ marginBottom: 14 }}>
          {title != null && (
            <div
              style={{
                fontFamily: MONO,
                fontSize: 11,
                fontWeight: W_MED,
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                color: PAPER,
              }}
            >
              {title}
            </div>
          )}
          {subtitle != null && (
            <div style={{ marginTop: 4, fontSize: 13, color: PAPER_QUIET }}>{subtitle}</div>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * A small pill carrying a mark plus a value, as in `★ VOLT 772`. Mark and value
 * both take the level's reserved colour.
 */
export function Chip({
  mark,
  label,
  value,
  colour,
}: {
  mark?: string;
  label: string;
  value?: ReactNode;
  colour: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "5px 11px",
        borderRadius: R_PILL,
        border: `1px solid ${rgba(colour, 0.45)}`,
        background: rgba(colour, 0.1),
        fontFamily: MONO,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.06em",
        color: colour,
        whiteSpace: "nowrap",
      }}
    >
      {mark && <span aria-hidden>{mark}</span>}
      <span style={{ textTransform: "uppercase" }}>{label}</span>
      {value != null && <span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>}
    </span>
  );
}

export function Hairline({ style }: { style?: CSSProperties }) {
  return <div style={{ height: 1, background: LINE, borderRadius: R_LG, ...style }} />;
}
