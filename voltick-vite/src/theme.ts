/**
 * Voltick tokens — the source of truth for this app.
 *
 * Lifted from VOLTICK-DESIGN-SYSTEM.md, which is itself lifted from Voltick's
 * own `web/src/theme.jsx`. If the Voltick repo and this file ever disagree, the
 * Voltick repo wins and this file gets updated; nothing here is invented.
 *
 * The five non-negotiables, restated because they are defects when broken:
 *   1. A reserved colour means exactly one thing. Import the token, never
 *      hand-mint a hex. A near-miss is worse than a reuse.
 *   2. No grey text. Secondary information is size, weight, spacing, position.
 *   3. No em-dashes in anything a user reads. Middle dot, comma, colon, parens.
 *   4. Never buy, sell, signal, entry, target, stop or prediction. Mechanics and
 *      locations only.
 *   5. Dark only. There is no light theme.
 */
import type { CSSProperties } from "react";

/* ── Surfaces ─────────────────────────────────────────────────────────────── */
export const INK = "#0a0d10";   // page background
export const PANEL = "#0e1216"; // bars, panels, chrome
export const ELEV = "#141a21";  // a raised card, one step above panel
export const LINE = "#1e2630";  // hairline borders, never heavier than 1px

export const POPOVER_BG = "rgba(15,19,24,0.98)";
export const NAV_BG = "rgba(10,13,16,0.8)";

/* ── Text ─────────────────────────────────────────────────────────────────── */
// One colour, optically corrected for three contexts. NOT a light/medium/dark
// ramp, and there is no grey below them.
export const PAPER = "#e7ece9";         // all body text, labels, values
export const PAPER_DISPLAY = "#d6ddd8"; // 16px+ BOLD headlines only
export const PAPER_QUIET = "#c0c5c3";   // units, the caption under a number

/* ── Brand ────────────────────────────────────────────────────────────────── */
export const ACCENT = "#2f6bff";      // Volt Blue. Fills, borders, rings, glows. NOT words.
export const ACCENT_TEXT = "#6aa0ff"; // when the accent has to BE text
export const SKY = "#7fb0ff";         // Bolt Sky. Gradients, highlights, fine lines
export const ACCENT_SOFT = "rgba(47,107,255,0.12)";
export const SELECTION = "rgba(47,107,255,0.40)";

/* ── Reserved data colours ────────────────────────────────────────────────── */
// Vocabulary, not decoration. Each means one thing. Using one for anything else
// does not look slightly wrong, it says something false.
export const VOLT = "#ffd166";     // ★ the strongest level on a board
export const FLIP = "#b48cff";     // ⚡︎ the gamma flip
export const REVERSAL = "#ff5fa2"; // ↘ a reversal
export const SURGE = "#4d8cff";    // ↯ ‖ surges and walls
export const COIL = ACCENT;        // ◆ the coil (same hex as ACCENT)
export const PREMARKET = "#8adb57";

// Inks for text sitting ON a filled row of the above.
export const INK_ON_REVERSAL = "#36081d";
export const INK_ON_SURGE = "#071026";
export const INK_ON_VOLT = "#1a1404";

export const VOLT_MARK = "★";       // ★
export const FLIP_MARK = "⚡︎"; // ⚡ + VS15. A bare bolt renders as an
                                         // emoji, the system font paints it
                                         // Apple-orange and discards your
                                         // colour, which draws the flip in the
                                         // Volt's reserved colour. Always this.
export const REVERSAL_MARK = "↘";   // ↘
export const WALL_MARK = "‖";       // ‖
export const SURGE_MARK = "↯";      // ↯
export const COIL_MARK = "◆";       // ◆

/* ── Semantic ─────────────────────────────────────────────────────────────── */
// Data only. Green and red carry P&L meaning on a trading screen, so they never
// appear as UI chrome, a success toast, or a hover state.
export const GOOD = "#3ddc8e";
export const BAD = "#ff6b7a";

/* ── Typography ───────────────────────────────────────────────────────────── */
export const SANS =
  "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif";
export const MONO =
  "'JetBrains Mono', ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace";

export const W_REG = 400;  // Inter body, quiet labels
export const W_MED = 600;  // Inter buttons, sub-emphasis
export const W_BOLD = 700; // Inter headings. The ceiling for prose.
export const W_DATA = 800; // JetBrains Mono hero numbers ONLY

/* ── Shape and elevation ──────────────────────────────────────────────────── */
export const R_SM = 6;    // chips, badges, small tags
export const R_MD = 10;   // buttons, inputs, stat tiles
export const R_LG = 12;   // cards, panels, modals
export const R_PILL = 99; // fully-round pills

// The inset top highlight is load-bearing: on surfaces this close in value, a
// 1px light line along the top edge is what separates a raised card from the
// panel behind it. Drop it and cards go flat.
export const CARD_SHADOW =
  "0 8px 26px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.045)";

/* ── Layout ───────────────────────────────────────────────────────────────── */
export const BP_MOBILE = 760;  // one number. Above it desktop, at or below mobile.
export const BP_WIDE = 1100;   // whether the board can carry the inline watchlist
export const RAIL_W = 180;     // left rail expanded
export const RAIL_W_COLLAPSED = 48;
export const CONTENT_MAX = 1240;

/* ── Helpers ──────────────────────────────────────────────────────────────── */
export function rgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export const cardStyle: CSSProperties = {
  background: ELEV,
  border: `1px solid ${LINE}`,
  borderRadius: R_LG,
  boxShadow: CARD_SHADOW,
};

/** Uppercase mono label. ~9.5-11px, weight 600, wide tracking. */
export const labelStyle: CSSProperties = {
  fontFamily: MONO,
  fontSize: 10,
  fontWeight: W_MED,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: PAPER_QUIET,
};

/** Anywhere digits stack. */
export const numStyle: CSSProperties = {
  fontFamily: MONO,
  fontVariantNumeric: "tabular-nums",
};
