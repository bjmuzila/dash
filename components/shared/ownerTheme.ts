import type { CSSProperties } from "react";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER THEME — "budget" card language, shared by every /owner page
 * ─────────────────────────────────────────────────────────────────────────────
 * Same export NAMES and SIGNATURES as the helpers in homeTheme.ts, so an owner
 * page switches its whole look by importing from here instead of homeTheme.
 *
 * The look (matching /owner/budget):
 *   • Frosted translucent cards (blur) with ONE faint light-blue interior
 *     highlight — no rotating accents, no colored top-accent strips.
 *   • Standard theme red (#EF4444) for spend / negative / error values.
 *   • Opaque surfaces for sticky headers (panelBgStrong) so rows never bleed.
 *   • Brand hues (cyan/green/orange) kept consistent with the rest of the app.
 */

export const OWNER_LIGHT_BLUE = "#7dd3fc";
export const OWNER_SOFT_RED = "#EF4444";

const SHELL_GLOW =
  "radial-gradient(circle at 15% 50%, rgba(33,158,188,0.04) 0%, transparent 50%), radial-gradient(circle at 85% 30%, rgba(18,103,131,0.05) 0%, transparent 50%)";

// Owner palette. Mirrors HOME_THEME hues but with a translucent frosted panel
// and a softened red, so OWNER_THEME can stand in anywhere HOME_THEME is used.
export const OWNER_THEME = {
  bg: "#05060A",
  panel: "#0D1119",             // opaque surface (sticky headers)
  panelHover: "#16181f",
  panelInset: "rgba(0,0,0,0.30)",
  border: "rgba(255,255,255,0.10)",
  borderStrong: "rgba(255,255,255,0.18)",
  text: "#FFFFFF",
  textSecondary: "#FFFFFF",
  textMuted: "#FFFFFF",
  cyan: "#219EBC",
  purple: "#126783",
  orange: "#FB8501",
  green: "#8ECAE6",
  red: OWNER_SOFT_RED,          // standardized to #EF4444
  lightBlue: OWNER_LIGHT_BLUE,
  // Drop-in aliases so OWNER_THEME can stand in for HOME_THEME.
  muted: "#FFFFFF",
  panelBg: "rgba(13,17,25,0.45)",     // frosted card base (with blur)
  panelBgStrong: "#0D1119",           // opaque — sticky headers
  shellGlow: SHELL_GLOW,
} as const;

function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
export const ownerRgba = rgba;

// ── Shell (drop-in for homeShellStyle) ───────────────────────────────────────
export const homeShellStyle: CSSProperties = {
  height: "100%",
  width: "100%",
  overflow: "hidden",
  background: OWNER_THEME.bg,
  backgroundImage: SHELL_GLOW,
  fontFamily: "var(--font-inter), 'Inter', 'Helvetica Neue', Arial, sans-serif",
  color: OWNER_THEME.text,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
};

// ── Content area (drop-in for homeContentStyle) ──────────────────────────────
export const homeContentStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  overflow: "hidden",
  padding: "clamp(14px, 2vw, 24px)",
  gap: "clamp(16px, 2vw, 32px)",
};

// ── Header bar (drop-in for homeHeaderStyle) — frosted, hairline bottom ───────
export const homeHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: 16,
  background: OWNER_THEME.panelBg,
  backdropFilter: "blur(16px)",
  borderBottom: `1px solid ${OWNER_THEME.border}`,
  flexShrink: 0,
};

// ── Panel (drop-in for homePanelStyle) — frosted card + light-blue highlight ──
export const homePanelStyle: CSSProperties = {
  background: `radial-gradient(circle at 50% 0%, ${rgba(OWNER_LIGHT_BLUE, 0.1)} 0%, transparent 60%), ${OWNER_THEME.panelBg}`,
  backdropFilter: "blur(16px)",
  borderRadius: 18,
  border: `1px solid ${OWNER_THEME.border}`,
  boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
};

// ── Gloss panel (drop-in for homeGlossPanelStyle) — one accent, so the accent
//    argument is accepted but ignored; returns the highlighted card. ──────────
export function homeGlossPanelStyle(_accent: string = OWNER_THEME.cyan): CSSProperties {
  void _accent;
  return { ...homePanelStyle };
}

// ── Inputs (drop-in for homeInputStyle) ──────────────────────────────────────
export const homeInputStyle: CSSProperties = {
  fontSize: 13,
  padding: "10px 12px",
  border: `1px solid ${OWNER_THEME.border}`,
  borderRadius: 10,
  background: OWNER_THEME.panelInset,
  color: OWNER_THEME.text,
  outline: "none",
};

// ── Buttons — cyan gradient primary + hairline secondary ─────────────────────
export const homeButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid rgba(33,158,188,0.25)",
  background: "linear-gradient(180deg, rgba(33,158,188,0.16), rgba(33,158,188,0.05))",
  color: OWNER_THEME.cyan,
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: "0.02em",
  cursor: "pointer",
};

export const homeSecondaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: `1px solid ${OWNER_THEME.border}`,
  background: "rgba(255,255,255,0.04)",
  color: OWNER_THEME.text,
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: "0.02em",
  cursor: "pointer",
};

// ── Helpers used by owner-page local components ───────────────────────────────

/** The standard owner card. */
export function ownerPanel(): CSSProperties {
  return { ...homePanelStyle };
}

/** Body text — 15px default. */
export const ownerBodyText: CSSProperties = {
  fontSize: 15,
  fontWeight: 400,
  color: OWNER_THEME.text,
  letterSpacing: "0.01em",
};

/** Title text — 16px for all headings. */
export const ownerTitleText: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: OWNER_THEME.text,
  letterSpacing: "0.01em",
};

/** Quiet section/card header text. */
export const ownerHeaderText: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: OWNER_THEME.text,
  letterSpacing: "0.01em",
};

/** Small label. */
export const ownerLabelText: CSSProperties = {
  fontSize: 13,
  fontWeight: 400,
  color: OWNER_THEME.text,
  letterSpacing: "0.01em",
};

/** Status pill for a boolean ok state. */
export function ownerStatusPill(ok: boolean): CSSProperties {
  const c = ok ? OWNER_THEME.green : OWNER_THEME.red;
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "3px 9px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    background: ownerRgba(c, 0.12),
    border: `1px solid ${ownerRgba(c, 0.28)}`,
    color: c,
  };
}
