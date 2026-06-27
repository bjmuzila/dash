import type { CSSProperties } from "react";

export const HOME_THEME = {
  bg: "#05060A",
  panel: "#0D1119",
  cyan: "#219EBC",
  purple: "#126783",
  orange: "#FB8501",
  green: "#8ECAE6",
  red: "#EF4444",
  muted: "#FFFFFF",
  text: "#FFFFFF",
  border: "rgba(255,255,255,0.10)",
  panelBg: "rgba(13,17,25,0.45)",
  panelBgStrong: "rgba(13,17,25,0.72)",
  shellGlow:
    "radial-gradient(circle at 15% 50%, rgba(33,158,188,0.04) 0%, transparent 50%), radial-gradient(circle at 85% 30%, rgba(18,103,131,0.05) 0%, transparent 50%)",
} as const;

export const homeShellStyle: CSSProperties = {
  height: "100%",
  width: "100%",
  overflow: "hidden",
  background: HOME_THEME.bg,
  backgroundImage: HOME_THEME.shellGlow,
  fontFamily: "var(--font-inter), 'Inter', 'Helvetica Neue', Arial, sans-serif",
  color: HOME_THEME.text,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
};

export const homeContentStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  overflow: "hidden",
  padding: "clamp(14px, 2vw, 24px)",
  gap: "clamp(16px, 2vw, 32px)",
};

export const homeHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: 16,
  background: HOME_THEME.panelBg,
  backdropFilter: "blur(16px)",
  borderBottom: `1px solid ${HOME_THEME.border}`,
  flexShrink: 0,
};

export const homePanelStyle: CSSProperties = {
  background: `radial-gradient(circle at 50% 0%, rgba(33,158,188,0.07) 0%, transparent 55%), ${HOME_THEME.panelBg}`,
  backdropFilter: "blur(16px)",
  borderRadius: 16,
  border: `1px solid ${HOME_THEME.border}`,
};

// rgba helper for accent tints
function themeRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// Glossy top-glow panel — pass an accent to tint the radial gradient.
export function homeGlossPanelStyle(accent: string = HOME_THEME.cyan): CSSProperties {
  return {
    ...homePanelStyle,
    borderTop: `2px solid ${themeRgba(accent, 0.5)}`,
    background: `radial-gradient(circle at 50% 0%, ${themeRgba(accent, 0.08)} 0%, transparent 60%), ${HOME_THEME.panelBg}`,
  };
}

export const homeInputStyle: CSSProperties = {
  fontSize: 13,
  padding: "8px 12px",
  border: `1px solid ${HOME_THEME.border}`,
  borderRadius: 6,
  background: "rgba(0,0,0,0.4)",
  color: HOME_THEME.text,
  outline: "none",
};

export const homeButtonStyle: CSSProperties = {
  padding: "5px 10px",
  borderRadius: 6,
  border: "1px solid rgba(33,158,188,.25)",
  background: "linear-gradient(180deg,rgba(33,158,188,.12),rgba(33,158,188,.04))",
  color: HOME_THEME.cyan,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  cursor: "pointer",
};

export const homeSecondaryButtonStyle: CSSProperties = {
  padding: "5px 10px",
  borderRadius: 6,
  border: `1px solid ${HOME_THEME.border}`,
  background: "rgba(255,255,255,0.04)",
  color: HOME_THEME.text,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  cursor: "pointer",
};

// ─────────────────────────────────────────────────────────────────────────────
// DOCK theme — the frosted "dock" visual language shared by every dropdown/menu
// (GlobalToolbar LogoMenu, NavMenu, quote pills). SINGLE SOURCE OF TRUTH — do
// not re-declare these strings locally. cyan = HOME_THEME.cyan (#219EBC).
// ─────────────────────────────────────────────────────────────────────────────
export const DOCK_THEME = {
  // 2px top accent strip on menu panels
  cyanTop: themeRgba(HOME_THEME.cyan, 0.5),
  // panel background: top-down cyan glow over near-opaque dark
  bg: `radial-gradient(circle at 50% 0%, ${themeRgba(HOME_THEME.cyan, 0.07)} 0%, transparent 55%), rgba(10,13,20,0.98)`,
  // deep layered floating shadow
  shadow: "0 1px 0 rgba(255,255,255,0.06) inset, 0 20px 44px -14px rgba(0,0,0,0.75), 0 6px 16px rgba(0,0,0,0.45)",
  // active/selected tile gradient + its border + glow
  activeTile: `linear-gradient(180deg, ${themeRgba(HOME_THEME.cyan, 0.16)}, ${themeRgba(HOME_THEME.cyan, 0.04)})`,
  activeBorder: themeRgba(HOME_THEME.cyan, 0.3),
  activeGlow: `0 0 14px ${themeRgba(HOME_THEME.cyan, 0.22)}`,
  // hover tint for non-active rows
  hoverTile: themeRgba(HOME_THEME.cyan, 0.1),
} as const;

// Toolbar top accent bar — bright cyan center fading to transparent edges.
export const homeToolbarAccentBar: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  height: 2,
  pointerEvents: "none",
  background: `linear-gradient(90deg, transparent 0%, ${themeRgba(HOME_THEME.cyan, 0.12)} 15%, ${themeRgba(HOME_THEME.cyan, 0.9)} 50%, ${themeRgba(HOME_THEME.cyan, 0.12)} 85%, transparent 100%)`,
  boxShadow: `0 0 8px ${themeRgba(HOME_THEME.cyan, 0.35)}`,
};

// Refresh button — themed style keyed on state. Replaces the inline style that
// hardcoded old-cyan (#00e5ff). Uses HOME_THEME.cyan + green/red roles.
export type RefreshState = "idle" | "refreshing" | "success" | "error";
const REFRESH_GREEN = "#1FD98A";
export function homeRefreshButtonStyle(state: RefreshState): CSSProperties {
  return {
    fontSize: 9,
    padding: "2px 10px",
    border: `1px solid ${
      state === "success" ? REFRESH_GREEN : state === "error" ? HOME_THEME.red : themeRgba(HOME_THEME.cyan, 0.4)
    }`,
    borderRadius: 2,
    background:
      state === "success" ? themeRgba(REFRESH_GREEN, 0.1) :
      state === "error"   ? themeRgba(HOME_THEME.red, 0.1) : themeRgba(HOME_THEME.cyan, 0.08),
    color:
      state === "success" ? REFRESH_GREEN :
      state === "error"   ? HOME_THEME.red :
      state === "refreshing" ? "#888" : HOME_THEME.cyan,
    textShadow:
      state === "success" ? `0 0 12px ${themeRgba(REFRESH_GREEN, 0.5)}` :
      state === "error"   ? `0 0 12px ${themeRgba(HOME_THEME.red, 0.5)}` : "none",
    cursor: state === "refreshing" ? "not-allowed" : "pointer",
    opacity: state === "refreshing" ? 0.6 : 1,
    fontWeight: 700,
    flexShrink: 0,
    transition: "all 0.15s",
  };
}
