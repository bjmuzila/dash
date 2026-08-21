import type { CSSProperties } from "react";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AFFILIATE THEME — self-contained copy of the card + colour language from
 * components/shared/homeTheme.ts. No "@/..." aliases: this app builds without
 * the Next tree (see vite.config.js).
 *
 * ONE RULE THAT DIFFERS FROM THE DASHBOARD: cards carry NO colour accent. No
 * tinted top border, no radial gloss. Colour on this surface means exactly one
 * thing — state (pending / active / owed / paid) — and a card that is tinted
 * merely because it is a card spends that signal for decoration.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const THEME = {
  bg: "#05060A",
  panel: "#0D1119",
  cyan: "#219EBC",
  purple: "#126783",
  orange: "#FB8501",
  lightBlue: "#7dd3fc",
  green: "#1FD98A",
  softRed: "#f4948e",
  // Content hues — used to give a feature or a data mark its own identity.
  // NEVER for card chrome; see the rule at the top of this file.
  gold: "#FFB703",
  call: "#29b6f6",
  put: "#ff4757",
  up: "#30d158",
  down: "#ff5b5b",
  text: "#FFFFFF",
  dim: "rgba(255,255,255,0.55)",
  dim2: "rgba(255,255,255,0.38)",
  border: "rgba(255,255,255,0.10)",
  panelBg: "rgba(13,17,25,0.45)",
  panelBgStrong: "rgba(13,17,25,0.72)",
  shellGlow:
    "radial-gradient(circle at 15% 50%, rgba(33,158,188,0.04) 0%, transparent 50%), radial-gradient(circle at 85% 30%, rgba(18,103,131,0.05) 0%, transparent 50%)",
} as const;

/** Site type scale (px): display / title 17 / subhead 15 / body 14 / label 12 / micro 10. */
export const TYPE = { display: 30, title: 17, subhead: 15, body: 14, label: 12, micro: 10 } as const;

export function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export const shellStyle: CSSProperties = {
  minHeight: "100vh",
  width: "100%",
  background: THEME.bg,
  backgroundImage: THEME.shellGlow,
  color: THEME.text,
  display: "flex",
  flexDirection: "column",
};

export const contentStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  padding: "clamp(14px, 2vw, 24px)",
  gap: "clamp(16px, 2vw, 28px)",
  width: "100%",
  maxWidth: 1360,
  marginInline: "auto",
};

/** THE card. Frosted panel, hairline edge, no accent. */
export const cardStyle: CSSProperties = {
  background: THEME.panelBg,
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  borderRadius: 18,
  border: `1px solid ${THEME.border}`,
  boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
};

export const tileStyle: CSSProperties = {
  ...cardStyle,
  borderRadius: 16,
  boxShadow: "none",
};

export const inputStyle: CSSProperties = {
  width: "100%",
  fontSize: TYPE.body,
  padding: "10px 12px",
  border: `1px solid ${THEME.border}`,
  borderRadius: 8,
  background: "rgba(0,0,0,0.40)",
  color: THEME.text,
  outline: "none",
};

export const buttonStyle: CSSProperties = {
  padding: "7px 13px",
  borderRadius: 6,
  border: `1px solid ${rgba(THEME.cyan, 0.25)}`,
  background: `linear-gradient(180deg,${rgba(THEME.cyan, 0.12)},${rgba(THEME.cyan, 0.04)})`,
  color: THEME.cyan,
  fontSize: TYPE.micro,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  cursor: "pointer",
};

export const secondaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  border: `1px solid ${THEME.border}`,
  background: "rgba(255,255,255,0.04)",
  color: THEME.text,
};

export const orangeButtonStyle: CSSProperties = {
  ...buttonStyle,
  border: `1px solid ${rgba(THEME.orange, 0.35)}`,
  background: `linear-gradient(180deg,${rgba(THEME.orange, 0.16)},${rgba(THEME.orange, 0.04)})`,
  color: THEME.orange,
};

/** The toolbar's bright-centre accent bar — the one place a gradient is chrome,
 *  not decoration, and the only visual carried over verbatim from the app. */
export const toolbarAccentBar: CSSProperties = {
  position: "absolute",
  top: 0, left: 0, right: 0, height: 2,
  pointerEvents: "none",
  background: `linear-gradient(90deg, transparent 0%, ${rgba(THEME.cyan, 0.12)} 15%, ${rgba(THEME.cyan, 0.9)} 50%, ${rgba(THEME.cyan, 0.12)} 85%, transparent 100%)`,
  boxShadow: `0 0 8px ${rgba(THEME.cyan, 0.35)}`,
};

/**
 * THE rate, mirrored from server-v2/_lib-affiliate.cjs so the PUBLIC landing
 * page can state it without a session or an API call — that page has to render
 * for a cold visitor even if the backend is down. The server stays
 * authoritative for anything that actually pays money; this constant is copy.
 *
 * There are no tiers. If this ever stops being one number, it belongs on an
 * endpoint, not here.
 */
export const RATE_PCT = 20;
