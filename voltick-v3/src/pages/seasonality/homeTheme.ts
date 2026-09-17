// ─────────────────────────────────────────────────────────────────────────────
// The seasonality pages' view of v2's HOME_THEME.
//
// These two pages are a 1:1 port of v2's seasonality route and carry the usual
// port requirement: they must render V2's colours, not v3's dark-slate ones.
// This file used to satisfy that by carrying v2's hexes verbatim — a second
// copy of a palette v3 already holds, which is exactly the drift check-theme
// exists to stop (53 literals, non-negotiable #1).
//
// So it is now a NAME BRIDGE and nothing else: every value is a token from
// design/tokens.css, reached through design/theme.ts, under the v2 name the
// ported components already spell. `V2.*` is v2's palette value-for-value,
// `V2W.*` v2's washes, so what renders is unchanged — it just tracks the one
// palette now.
//
// TRIMMED, deliberately. v2's homeTheme carried the whole app's card system,
// dock theme, level colours and refresh button. Nothing in this folder imported
// any of it, and a dead copy of a palette is the thing that drifts first. What
// is left is what src/pages/seasonality actually uses; anything else belongs in
// design/theme.ts, which is where every other v3 page reads it from.
//
// EVERY value is a CSS string (`var(…)` / `color-mix(…)`). These pages draw
// hand-rolled SVG and no canvas, so that is safe — but SVG PRESENTATION
// ATTRIBUTES do not resolve var(), so the charts pass these through `style`,
// never through `fill=` / `stroke=`. Keep it that way.
// ─────────────────────────────────────────────────────────────────────────────

import type { CSSProperties } from "react";
import { T, V2, V2W, SHADOW, alpha } from "@/design/theme";

export const HOME_THEME = {
  bg: V2.bg,
  panel: V2.panel,
  cyan: V2.cyan,
  purple: V2.purple,
  orange: V2.orange,
  /** v2's `green` is a LIGHT BLUE (#8ECAE6), not a positive/up colour. */
  green: V2.green,
  red: V2.red,
  muted: T.muted,
  text: T.text,
  border: V2W.border,
  panelBg: V2W.panelBg,
  panelBgStrong: V2W.panelBgStrong,
} as const;

/**
 * CANDLE COLOURS — the up/down pair every OHLC surface in the app draws with,
 * and what the almanac's bars and heat cells encode direction with.
 *
 * Deliberately NOT HOME_THEME.green / .red: those are the UI's status palette
 * (a light blue and a flat alert red). Bars want the saturated trading pair.
 */
export { ES_CANDLE_UP, ES_CANDLE_DOWN } from "@/design/theme";

/** Classic card: frosted dark surface with a contained hairline edge (tables). */
export const classicCardStyle: CSSProperties = {
  background: HOME_THEME.panelBg,
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  borderRadius: 18,
  border: `1px solid ${HOME_THEME.border}`,
  boxShadow: `0 18px 40px ${alpha(SHADOW, 0.22)}`,
};

/** Card body — solid frosted panel, no radial highlight. What SeaCard wraps. */
export const classicCardAccentStyle: CSSProperties = {
  ...classicCardStyle,
  background: HOME_THEME.panelBg,
};
