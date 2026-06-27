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
    "radial-gradient(circle at 15% 50%, rgba(0,240,255,0.02) 0%, transparent 50%), radial-gradient(circle at 85% 30%, rgba(139,92,246,0.03) 0%, transparent 50%)",
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
  border: "1px solid rgba(0,229,255,.25)",
  background: "linear-gradient(180deg,rgba(0,229,255,.12),rgba(0,229,255,.04))",
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
