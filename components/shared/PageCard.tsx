"use client";

/**
 * Shared page chrome — use these on EVERY new page so the theme is automatic.
 *
 *   <PageShell>
 *     <Card accent="cyan" title="My Section">…</Card>
 *   </PageShell>
 *
 * PageShell  → the dark shell + glow background + scrollable, centered content
 *              area (homeShellStyle + homeContentStyle). One per page.
 * Card       → a panel with the top accent strip, top-down radial glow, and the
 *              dashboard-wide hover lift (.card-hover). Matches the confidence /
 *              home cards. Pass an `accent` to recolor the strip + glow.
 *
 * This is the single source of truth for "what a page looks like". If the look
 * needs to change, change it here and every page that uses these follows.
 */

import type { CSSProperties, ReactNode } from "react";
import { HOME_THEME, homeShellStyle, homeContentStyle, homeGlossPanelStyle } from "./homeTheme";

// Named theme accents so call sites read nicely (accent="orange") instead of
// passing raw hex. Any hex string is also accepted.
const ACCENTS = {
  cyan: HOME_THEME.cyan,
  purple: HOME_THEME.purple,
  orange: HOME_THEME.orange,
  green: HOME_THEME.green,
  red: HOME_THEME.red,
} as const;

export type AccentName = keyof typeof ACCENTS;

function resolveAccent(accent?: AccentName | string): string {
  if (!accent) return HOME_THEME.cyan;
  return (ACCENTS as Record<string, string>)[accent] ?? accent;
}

/**
 * Full-page shell: dark themed background + glow, with a scrollable content
 * column. `align` controls horizontal alignment of cards inside (default
 * "stretch" so cards fill the column; use "center" for a narrow centered card).
 */
export function PageShell({
  children,
  align = "stretch",
  maxWidth,
  style,
  className,
}: {
  children: ReactNode;
  align?: "stretch" | "center";
  /** Optional cap on the content column width (e.g. 620 for a form page). */
  maxWidth?: number;
  style?: CSSProperties;
  /** Extra class on the <main> (e.g. "no-card-lift" to disable hover lift). */
  className?: string;
}) {
  return (
    <div style={homeShellStyle}>
      <main
        className={className}
        style={{
          ...homeContentStyle,
          overflow: "auto",
          alignItems: align === "center" ? "center" : "stretch",
          ...style,
        }}
      >
        {maxWidth != null ? (
          <div style={{ width: "100%", maxWidth, marginInline: "auto", display: "flex", flexDirection: "column", gap: "inherit" }}>
            {children}
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}

/**
 * Themed panel/card. Top accent strip + radial glow + hover lift, identical to
 * the cards used across the dashboard. Optional `title` renders a standard
 * uppercase header row.
 */
export function Card({
  children,
  accent = "cyan",
  title,
  subtitle,
  padding = 24,
  style,
  className,
}: {
  children?: ReactNode;
  accent?: AccentName | string;
  title?: ReactNode;
  subtitle?: ReactNode;
  padding?: number | string;
  style?: CSSProperties;
  className?: string;
}) {
  const accentColor = resolveAccent(accent);
  return (
    <div
      className={`card-hover${className ? ` ${className}` : ""}`}
      style={{ ...homeGlossPanelStyle(accentColor), padding, ...style }}
    >
      {(title != null || subtitle != null) && (
        <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 2 }}>
          {title != null && (
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: HOME_THEME.text }}>
              {title}
            </div>
          )}
          {subtitle != null && (
            <div style={{ fontSize: 12, color: HOME_THEME.green }}>{subtitle}</div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
