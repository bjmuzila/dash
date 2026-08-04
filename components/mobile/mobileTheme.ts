/**
 * mobileTheme — the phone-only design tokens.
 *
 * SINGLE SOURCE OF TRUTH for the mobile shell's spacing, type scale, radii and
 * tap targets. Colors are NOT redeclared here: everything re-exports or derives
 * from components/shared/homeTheme so the phone UI can never drift off-brand
 * (see AGENTS.md — "Never hardcode hex").
 *
 * Sizing rules baked in below, all tuned for a 390x844 iPhone (14/15/16 base):
 *   - TAP.min = 44px, Apple's HIG minimum. Nothing interactive goes under it.
 *   - Type floor is 11px. The desktop pages routinely use 10px, which is not
 *     legible at arm's length on a phone.
 *   - Numbers are always tabular so columns of prices don't jitter as digits
 *     change on a live feed.
 *   - Safe areas are read through env() so the bottom tab bar clears the home
 *     indicator and the toolbar clears the Dynamic Island in landscape.
 */

import type { CSSProperties } from "react";
import { HOME_THEME, LIGHT_BLUE, REFRESH_GREEN, SOFT_RED } from "@/components/shared/homeTheme";

export { HOME_THEME, LIGHT_BLUE, REFRESH_GREEN, SOFT_RED };

/** rgba() from any of the theme's hex tokens. */
export function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/** Semantic roles. Up/down is the one pair the desktop theme leaves implicit. */
export const M_COLOR = {
  bg: HOME_THEME.bg,
  text: HOME_THEME.text,
  /** Body copy that isn't a headline — HOME_THEME.muted is pure white. */
  dim: "rgba(255,255,255,0.62)",
  faint: "rgba(255,255,255,0.38)",
  border: HOME_THEME.border,
  borderStrong: "rgba(255,255,255,0.16)",
  cyan: HOME_THEME.cyan,
  blue: LIGHT_BLUE,
  orange: HOME_THEME.orange,
  up: REFRESH_GREEN,
  down: SOFT_RED,
  /** Chart/heat poles. Blue = positive/call, red = negative/put — matches the
   *  desktop chain's metricBg ramp so the same strike reads the same color. */
  pos: "#29b6f6",
  neg: "#ff4757",
  /**
   * Core Bullseye gold. Same literal Multi Greek uses for its CB marker
   * (MultGreekClient renders "#ffd600" inline in three places). Tokenised here
   * so the phone build has one name for it; CW and PW already map onto
   * pos/neg above, which are the same values Multi Greek uses for those two.
   */
  cb: "#ffd600",
} as const;

/** Tap-target geometry. */
export const TAP = {
  min: 44,
  /** Bottom tab bar height, EXCLUDING the home-indicator inset. */
  tabBar: 56,
  /** Chip/pill height in a horizontally scrolling filter row. */
  chip: 34,
} as const;

export const RADIUS = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 22 } as const;

/** Type scale. Floor is 11 — see the header note. */
export const TYPE = {
  micro: 11,
  label: 12,
  body: 13,
  value: 15,
  lead: 19,
  hero: 26,
} as const;

/** Every number on a phone is tabular; a live feed must not shuffle columns. */
export const MONO: CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  fontFeatureSettings: '"tnum" 1',
  letterSpacing: "-0.01em",
};

/**
 * gridCols() — set a grid's columns WITHOUT tripping the app-wide mobile collapse.
 *
 * app/globals.css has a "GLOBAL GRID COLLAPSE" block inside
 * `@media (max-width: 899px)` that matches inline styles by substring —
 *
 *     main [style*="grid-template-columns: repeat(2"],
 *     main [style*="grid-template-columns: 1fr 1fr"], …
 *     { grid-template-columns: 1fr !important; }
 *
 * — and flattens them to one (or for 4+, two) columns. That rule exists to
 * rescue the DESKTOP pages, which lay out wide multi-column card grids that
 * would otherwise run off a phone. It is the right rule for them.
 *
 * It is exactly wrong for these components, which are already designed for
 * 390px: a 4-up levels bar collapsing to 2-up, or a two-option segmented
 * control stacking into two rows, is a regression, not a rescue. And because
 * the rule is `!important` it beats the inline style it is reading.
 *
 * So the value is passed through a custom property. The serialized attribute
 * reads `--cbm-cols: repeat(2, …); grid-template-columns: var(--cbm-cols)`,
 * which contains none of the substrings those selectors look for, and the
 * collapse leaves it alone. No change to globals.css, so the desktop rescue
 * keeps working untouched.
 *
 * Use this for EVERY grid in the mobile build, even ones whose track string
 * happens not to match today — the selector list grows over time.
 */
export function gridCols(template: string): CSSProperties {
  return {
    ["--cbm-cols" as keyof CSSProperties]: template,
    gridTemplateColumns: "var(--cbm-cols)",
  } as CSSProperties;
}

/** Bottom padding that clears the iPhone home indicator. */
export const SAFE_BOTTOM = "env(safe-area-inset-bottom, 0px)";
export const SAFE_TOP = "env(safe-area-inset-top, 0px)";

/**
 * The scroll body of a mobile page. `overscrollBehaviorY: contain` stops a
 * rubber-band at the end of a list from scrolling the document behind it, which
 * on iOS Safari otherwise dismisses/collapses the URL bar mid-gesture.
 */
export const scrollBody: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overflowX: "hidden",
  WebkitOverflowScrolling: "touch",
  overscrollBehaviorY: "contain",
};

/** Frosted card surface — the phone version of classicCardStyle. */
export const mCard: CSSProperties = {
  background: HOME_THEME.panelBg,
  backdropFilter: "blur(18px)",
  WebkitBackdropFilter: "blur(18px)",
  border: `1px solid ${HOME_THEME.border}`,
  borderRadius: RADIUS.lg,
  boxShadow: "0 10px 26px -14px rgba(0,0,0,0.8)",
  overflow: "hidden",
};

/** A tile inside a card grid — flatter, no border, so grids don't look boxy. */
export const mTile: CSSProperties = {
  background: "rgba(255,255,255,0.035)",
  borderRadius: RADIUS.md,
  padding: "9px 10px",
  minWidth: 0,
};

/** Section heading above a card. */
export const mSectionLabel: CSSProperties = {
  fontSize: TYPE.micro,
  fontWeight: 800,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: M_COLOR.faint,
  padding: "0 2px",
};

/**
 * Kill the iOS tap flash + text selection on controls. Applied to every
 * pressable in the mobile shell; the grey highlight rectangle Safari draws is
 * the single biggest "this is a website, not an app" tell.
 */
export const noTapHighlight: CSSProperties = {
  WebkitTapHighlightColor: "transparent",
  WebkitUserSelect: "none",
  userSelect: "none",
  touchAction: "manipulation",
};

/** Compact money: +$1.2M / -$840K / +$120. Always signed. */
export function fmtMoney(v: number, digits = 1): string {
  const sign = v >= 0 ? "+" : "−";
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(digits)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/** Compact money with no sign — for magnitudes in a labelled column. */
export function fmtMoneyAbs(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(abs / 1_000).toFixed(0)}K`;
  return `$${abs.toFixed(0)}`;
}

/** Compact counts: 12.4K / 1.2M. Unsigned. */
export function fmtCount(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(abs));
}

/** Price with thousands separators and 2dp, or an em dash when absent. */
export function fmtPrice(v: number | null | undefined, dp = 2): string {
  if (v == null || !Number.isFinite(v) || v === 0) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Strike labels drop the ".00" that every SPX strike would otherwise carry. */
export function fmtStrike(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(v % 1 === 0.5 ? 1 : 2);
}
