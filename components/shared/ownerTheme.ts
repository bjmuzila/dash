import type { CSSProperties } from "react";
import { HOME_THEME } from "./homeTheme";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER "CALM DARK" THEME
 * ─────────────────────────────────────────────────────────────────────────────
 * A quieter dark visual language for the owner / dev pages (/dev, /dev/owner,
 * /dev/admin). Same export NAMES and SIGNATURES as the glow-y helpers in
 * homeTheme.ts, so an owner page can switch its whole look by changing the import
 * path from "@/components/shared/homeTheme" to "@/components/shared/ownerTheme".
 *
 * Design rules (vs. the old look):
 *   • No radial-gradient glow inside panels — flat slate surfaces.
 *   • No textShadow glow on values.
 *   • One subtle 1px hairline border; NO 2px colored top-accent strips.
 *   • Accent color is reserved for live VALUES, not borders/glow.
 *   • Headers are quiet: 13px, weight 500, normal case (not 800 ALL-CAPS).
 *   • Borderless rounded cards, generous but calm.
 *
 * Keep `HOME_THEME` colors so accents (cyan/green/red/etc.) stay consistent with
 * the rest of the app — we only change the chrome, not the brand hues.
 */

// Muted slate surface ramp — the calm replacement for the glow panels.
export const OWNER_THEME = {
  bg: "#0B0D11",              // page background, near-black slate
  panel: "#14171D",          // resting card surface
  panelHover: "#181C23",     // card hover surface
  panelInset: "#10131A",     // inset rows / sub-surfaces
  border: "rgba(255,255,255,0.07)",       // default hairline
  borderStrong: "rgba(255,255,255,0.12)", // hover / emphasis hairline
  text: "#E7E9ED",           // primary text
  textSecondary: "#9AA1AC",  // supporting text
  textMuted: "#6B7280",      // hints / labels / mono stamps
  // ── Metabase-style multi-color palette ──
  // Tokens map to the same categorical hues the command center uses, so the whole
  // owner dashboard (Overview command center + FE/BE StatCards + section cards)
  // shares one color language. green = ok/healthy, red = error/down; the rest are
  // categorical accents.
  cyan: "#5B9BD5",      // blue — category / informational values
  purple: "#3FB8A0",    // teal — category (no purple)
  orange: "#E8A23D",    // amber — category / counts
  green: "#5DBB8E",     // green — ok / healthy / positive
  red: "#E06C5E",       // coral-red — error / down / fail
  // ── Drop-in aliases so OWNER_THEME can stand in for HOME_THEME ──
  muted: "#9AA1AC",                  // alias of textSecondary (was bright #FFF)
  panelBg: "#14171D",                // flat slate (no rgba translucency)
  panelBgStrong: "#181C23",
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
  fontFamily: "var(--font-inter), 'Inter', 'Helvetica Neue', Arial, sans-serif",
  color: OWNER_THEME.text,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
};

// ── Header bar (drop-in for homeHeaderStyle) — flat, no blur/glow ────────────
export const homeHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: 16,
  background: OWNER_THEME.panel,
  borderBottom: `1px solid ${OWNER_THEME.border}`,
  flexShrink: 0,
};

// ── Panel (drop-in for homePanelStyle) — transparent card, hairline border ────
export const homePanelStyle: CSSProperties = {
  background: "transparent",
  borderRadius: 12,
  border: `1px solid ${OWNER_THEME.border}`,
};

// ── Gloss panel (drop-in for homeGlossPanelStyle) — same calm card; the accent
//    is intentionally IGNORED for the surface (no glow). It returns the flat
//    panel so call sites that pass an accent still get the calm look. ──────────
export function homeGlossPanelStyle(_accent: string = OWNER_THEME.cyan): CSSProperties {
  void _accent;
  return { ...homePanelStyle };
}

// ── Inputs (drop-in for homeInputStyle) ──────────────────────────────────────
export const homeInputStyle: CSSProperties = {
  fontSize: 13,
  padding: "8px 12px",
  border: `1px solid ${OWNER_THEME.border}`,
  borderRadius: 8,
  background: OWNER_THEME.panelInset,
  color: OWNER_THEME.text,
  outline: "none",
};

// ── Buttons — calm: no uppercase, no gradient, normal weight ─────────────────
export const homeButtonStyle: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: `1px solid ${ownerRgba(OWNER_THEME.cyan, 0.4)}`,
  background: ownerRgba(OWNER_THEME.cyan, 0.1),
  color: OWNER_THEME.cyan,
  fontSize: 12,
  fontWeight: 500,
  letterSpacing: "0.01em",
  cursor: "pointer",
};

export const homeSecondaryButtonStyle: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: `1px solid ${OWNER_THEME.border}`,
  background: OWNER_THEME.panelInset,
  color: OWNER_THEME.textSecondary,
  fontSize: 12,
  fontWeight: 500,
  letterSpacing: "0.01em",
  cursor: "pointer",
};

// ── Calm helpers used by owner-page local components ──────────────────────────

/** Flat panel that takes an accent only for a faint LEFT hairline (optional). */
export function ownerPanel(): CSSProperties {
  return { ...homePanelStyle };
}

/** Quiet section/card header text: 13px, weight 500, normal case. */
export const ownerHeaderText: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: OWNER_THEME.text,
  letterSpacing: "0.01em",
};

/** Small muted label (replaces the 9px ALL-CAPS 800 labels). */
export const ownerLabelText: CSSProperties = {
  fontSize: 12,
  fontWeight: 400,
  color: OWNER_THEME.textMuted,
  letterSpacing: "0.01em",
};

/** Calm status pill background/border/text for a boolean ok state. */
export function ownerStatusPill(ok: boolean): CSSProperties {
  const c = ok ? OWNER_THEME.green : OWNER_THEME.red;
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "3px 9px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 500,
    background: ownerRgba(c, 0.12),
    border: `1px solid ${ownerRgba(c, 0.28)}`,
    color: c,
  };
}
