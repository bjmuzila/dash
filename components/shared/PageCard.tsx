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
import { HOME_THEME, homeShellStyle, homeContentStyle, classicCardStyle, classicCardAccentStyle, dissolveCardStyle } from "./homeTheme";

/**
 * Card accents are DEAD.
 *
 * Cards used to carry a 2px colored strip across the top, recolored per call
 * site — which is how the GEX chart page ended up with gold bars on some panels
 * and cyan on others. There is now ONE card surface (the dashboard/budget look:
 * frosted fill, hairline edge, faint light-blue radial glow, no top bar).
 *
 * The `accent` prop is retained only so the existing call sites still typecheck;
 * it is ignored. Do not reintroduce a per-card accent color.
 */
export type AccentName = "cyan" | "purple" | "orange" | "green" | "red";

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
 * Themed panel/card — the dashboard surface: frosted fill, hairline edge, faint
 * light-blue radial glow, hover lift. NO top accent strip. Optional `title`
 * renders a standard uppercase header row.
 */
export function Card({
  children,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  accent: _accent,
  variant = "gloss",
  title,
  subtitle,
  padding = 24,
  style,
  className,
}: {
  children?: ReactNode;
  /** Ignored — kept so existing call sites typecheck. See note above. */
  accent?: AccentName | string;
  /**
   * Surface treatment (see BUDGET_UI_STYLE.md):
   *   "gloss"    — alias of "budget" (the old top-accent panel; strip removed).
   *   "budget"   — the dashboard card: frosted + faint light-blue glow, no top bar.
   *   "classic"  — frosted dark card with a contained hairline edge (dense tables).
   *   "dissolve" — borderless, edge-feathered glass (chart/overview panels).
   */
  variant?: "gloss" | "classic" | "budget" | "dissolve";
  title?: ReactNode;
  subtitle?: ReactNode;
  padding?: number | string;
  style?: CSSProperties;
  className?: string;
}) {
  // NO top accent strip, anywhere. "gloss" used to render a 2px colored bar
  // across the top of every card (cyan here, gold there); the dashboard/budget
  // card look — frosted surface, hairline edge, faint light-blue radial glow —
  // is now the single card treatment. "gloss" is kept as an alias so the ~100
  // existing call sites don't all need touching; it resolves to the same
  // surface as "budget".
  const base =
    variant === "dissolve" ? dissolveCardStyle :
    variant === "classic"  ? classicCardStyle  :
    classicCardAccentStyle;
  // The hover lift only reads right on the contained (gloss/classic) cards; the
  // dissolve card has no edge so it opts out.
  const hoverClass = variant === "dissolve" ? "" : "card-hover";
  return (
    <div
      className={`${hoverClass}${className ? ` ${className}` : ""}`.trim()}
      style={{ ...base, padding, ...style }}
    >
      {(title != null || subtitle != null) && (
        <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 2 }}>
          {title != null && (
            <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: HOME_THEME.text }}>
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
