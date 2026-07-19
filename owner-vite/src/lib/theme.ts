import type { CSSProperties } from "react";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER THEME — self-contained port of components/shared/ownerTheme.ts +
 * the card language from components/shared/homeTheme.ts.
 * No "@/..." aliases so it stands alone inside the Vite app.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const OWNER_LIGHT_BLUE = "#7dd3fc";
export const OWNER_SOFT_RED = "#EF4444";

/**
 * TYPE — the site type scale (px). One source of truth so new code stays uniform.
 *   title 17 · subhead 15 · body 14 · label 12 · micro 10 · display for heroes.
 * The normalize-typography codemod snaps existing inline sizes to these tiers.
 */
export const TYPE = {
  display: 30,
  title: 17,
  subhead: 15,
  body: 14,
  label: 12,
  micro: 10,
} as const;
/** Softer red for amounts/deficits (matches Budget). */
export const SOFT_RED = "#f4948e";
/** The one card accent — light blue. */
export const LIGHT_BLUE = "#7dd3fc";

const SHELL_GLOW =
  "radial-gradient(circle at 15% 50%, rgba(33,158,188,0.04) 0%, transparent 50%), radial-gradient(circle at 85% 30%, rgba(18,103,131,0.05) 0%, transparent 50%)";

export const OWNER_THEME = {
  bg: "#05060A",
  panel: "#0D1119",
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
  gold: "#FFB703",
  red: OWNER_SOFT_RED,
  lightBlue: OWNER_LIGHT_BLUE,
  muted: "#FFFFFF",
  panelBg: "rgba(13,17,25,0.45)",
  panelBgStrong: "#0D1119",
  shellGlow: SHELL_GLOW,
} as const;

// HOME_THEME kept as an alias so ported sidebar/group accents resolve unchanged.
export const HOME_THEME = OWNER_THEME;

export function ownerRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
export const rgba = ownerRgba;

// ── Shell ────────────────────────────────────────────────────────────────────
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

// ── Content area ─────────────────────────────────────────────────────────────
export const homeContentStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  overflow: "hidden",
  padding: "clamp(14px, 2vw, 24px)",
  gap: "clamp(16px, 2vw, 32px)",
};

// ── Header bar ───────────────────────────────────────────────────────────────
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

// ── Panel (frosted card + light-blue highlight) ──────────────────────────────
export const homePanelStyle: CSSProperties = {
  background: `radial-gradient(circle at 50% 0%, ${rgba(OWNER_LIGHT_BLUE, 0.1)} 0%, transparent 60%), ${OWNER_THEME.panelBg}`,
  backdropFilter: "blur(16px)",
  borderRadius: 18,
  border: `1px solid ${OWNER_THEME.border}`,
  boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
};

export function homeGlossPanelStyle(_accent: string = OWNER_THEME.cyan): CSSProperties {
  void _accent;
  return { ...homePanelStyle };
}

/** Classic card: frosted dark surface with a contained hairline edge (tables). */
export const classicCardStyle: CSSProperties = {
  background: OWNER_THEME.panelBg,
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  borderRadius: 18,
  border: `1px solid ${OWNER_THEME.border}`,
  boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
};

/** Classic card + faint light-blue radial highlight on the body (no top bar). */
export const classicCardAccentStyle: CSSProperties = {
  ...classicCardStyle,
  background: `radial-gradient(circle at 50% 0%, rgba(126,211,252,0.10) 0%, transparent 60%), ${OWNER_THEME.panelBg}`,
};

/** Stat/metric tile: no border, faint highlight. */
export const statTileStyle: CSSProperties = {
  background:
    "radial-gradient(circle at 50% 0%, rgba(126,211,252,0.10) 0%, transparent 60%), rgba(13,17,25,0.20)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  border: "none",
  borderRadius: 16,
};

// ── Inputs / buttons ─────────────────────────────────────────────────────────
export const homeInputStyle: CSSProperties = {
  fontSize: 14,
  padding: "10px 12px",
  border: `1px solid ${OWNER_THEME.border}`,
  borderRadius: 10,
  background: OWNER_THEME.panelInset,
  color: OWNER_THEME.text,
  outline: "none",
};

export const homeButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid rgba(33,158,188,0.25)",
  background: "linear-gradient(180deg, rgba(33,158,188,0.16), rgba(33,158,188,0.05))",
  color: OWNER_THEME.cyan,
  fontSize: 14,
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
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: "0.02em",
  cursor: "pointer",
};

// ── Text helpers ─────────────────────────────────────────────────────────────
export const ownerBodyText: CSSProperties = { fontSize: 14, fontWeight: 400, color: OWNER_THEME.text, letterSpacing: "0.01em" };
export const ownerTitleText: CSSProperties = { fontSize: 17, fontWeight: 700, color: OWNER_THEME.text, letterSpacing: "0.01em" };
export const ownerHeaderText: CSSProperties = { fontSize: 17, fontWeight: 700, color: OWNER_THEME.text, letterSpacing: "0.01em" };
export const ownerLabelText: CSSProperties = { fontSize: 14, fontWeight: 400, color: OWNER_THEME.text, letterSpacing: "0.01em" };

/** Dissolve card: borderless, edge-feathered glass (chart/overview panels). */
export const dissolveCardStyle: CSSProperties = {
  background:
    "radial-gradient(120% 130% at 50% 0%, rgba(13,17,25,0.34) 0%, rgba(13,17,25,0.22) 45%, rgba(13,17,25,0.06) 80%, transparent 100%)",
  backdropFilter: "blur(44px) saturate(1.15)",
  WebkitBackdropFilter: "blur(44px) saturate(1.15)",
  borderRadius: 28,
  border: "none",
  boxShadow: "0 40px 100px -40px rgba(0,0,0,0.45)",
  maskImage: "radial-gradient(130% 140% at 50% 40%, #000 60%, transparent 100%)",
  WebkitMaskImage: "radial-gradient(130% 140% at 50% 40%, #000 60%, transparent 100%)",
};

// ── DOCK theme — frosted dropdown/menu language (ThemedSelect, dock menus) ────
export const DOCK_THEME = {
  cyanTop: rgba(OWNER_THEME.cyan, 0.5),
  bg: `radial-gradient(circle at 50% 0%, ${rgba(OWNER_THEME.cyan, 0.07)} 0%, transparent 55%), rgba(10,13,20,0.98)`,
  shadow: "0 1px 0 rgba(255,255,255,0.06) inset, 0 20px 44px -14px rgba(0,0,0,0.75), 0 6px 16px rgba(0,0,0,0.45)",
  activeTile: `linear-gradient(180deg, ${rgba(OWNER_THEME.cyan, 0.16)}, ${rgba(OWNER_THEME.cyan, 0.04)})`,
  activeBorder: rgba(OWNER_THEME.cyan, 0.3),
  activeGlow: `0 0 14px ${rgba(OWNER_THEME.cyan, 0.22)}`,
  hoverTile: rgba(OWNER_THEME.cyan, 0.1),
} as const;

// ── Refresh button — themed style keyed on state (useRefreshButton) ───────────
export type RefreshState = "idle" | "refreshing" | "success" | "error";
const REFRESH_GREEN = "#1FD98A";
export function homeRefreshButtonStyle(state: RefreshState): CSSProperties {
  return {
    fontSize: 10,
    padding: "2px 10px",
    border: `1px solid ${
      state === "success" ? REFRESH_GREEN : state === "error" ? OWNER_THEME.red : rgba(OWNER_THEME.cyan, 0.4)
    }`,
    borderRadius: 2,
    background:
      state === "success" ? rgba(REFRESH_GREEN, 0.1) :
      state === "error"   ? rgba(OWNER_THEME.red, 0.1) : rgba(OWNER_THEME.cyan, 0.08),
    color:
      state === "success" ? REFRESH_GREEN :
      state === "error"   ? OWNER_THEME.red :
      state === "refreshing" ? "#888" : OWNER_THEME.cyan,
    textShadow:
      state === "success" ? `0 0 12px ${rgba(REFRESH_GREEN, 0.5)}` :
      state === "error"   ? `0 0 12px ${rgba(OWNER_THEME.red, 0.5)}` : "none",
    cursor: state === "refreshing" ? "not-allowed" : "pointer",
    opacity: state === "refreshing" ? 0.6 : 1,
    fontWeight: 700,
    flexShrink: 0,
    transition: "all 0.15s",
  };
}

// Toolbar top accent bar — bright cyan center fading to transparent edges.
export const homeToolbarAccentBar: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  height: 2,
  pointerEvents: "none",
  background: `linear-gradient(90deg, transparent 0%, ${rgba(OWNER_THEME.cyan, 0.12)} 15%, ${rgba(OWNER_THEME.cyan, 0.9)} 50%, ${rgba(OWNER_THEME.cyan, 0.12)} 85%, transparent 100%)`,
  boxShadow: `0 0 8px ${rgba(OWNER_THEME.cyan, 0.35)}`,
};

export function ownerStatusPill(ok: boolean): CSSProperties {
  const c = ok ? OWNER_THEME.green : OWNER_THEME.red;
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "3px 9px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    background: ownerRgba(c, 0.12),
    border: `1px solid ${ownerRgba(c, 0.28)}`,
    color: c,
  };
}
