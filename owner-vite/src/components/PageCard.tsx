/**
 * Shared page chrome — PageShell + Card. Port of components/shared/PageCard.tsx.
 * Single source of truth for "what a page looks like".
 */
import type { CSSProperties, ReactNode } from "react";
import {
  HOME_THEME,
  homeShellStyle,
  homeContentStyle,
  classicCardStyle,
  classicCardAccentStyle,
  dissolveCardStyle,
} from "../lib/theme";

export type AccentName = "cyan" | "purple" | "orange" | "green" | "red";

export function PageShell({
  children,
  align = "stretch",
  maxWidth,
  style,
  className,
}: {
  children: ReactNode;
  align?: "stretch" | "center";
  maxWidth?: number;
  style?: CSSProperties;
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

export function Card({
  children,
  accent: _accent,
  variant = "gloss",
  title,
  subtitle,
  padding = 24,
  style,
  className,
}: {
  children?: ReactNode;
  accent?: AccentName | string;
  variant?: "gloss" | "classic" | "budget" | "dissolve";
  title?: ReactNode;
  subtitle?: ReactNode;
  padding?: number | string;
  style?: CSSProperties;
  className?: string;
}) {
  void _accent;
  const base =
    variant === "dissolve" ? dissolveCardStyle :
    variant === "classic"  ? classicCardStyle  :
    classicCardAccentStyle;
  const hoverClass = variant === "dissolve" ? "" : "card-hover";
  return (
    <div
      className={`${hoverClass}${className ? ` ${className}` : ""}`.trim()}
      style={{ ...base, padding, ...style }}
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
