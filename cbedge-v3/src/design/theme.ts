// ─────────────────────────────────────────────────────────────────────────────
// THE TOKEN BRIDGE.
//
// v3's rule is that no colour literal may appear outside `design/tokens.css`.
// That rule is easy to keep in a Tailwind class name (`bg-surface`) and awkward
// in the one place a page genuinely needs a colour as a JS STRING: a
// template-literal stylesheet, an inline `background`, a canvas fill.
//
// This file is that bridge, and it is the ONLY sanctioned way to get one. Every
// value below is a `var(--color-…)` reference into tokens.css — so a page can
// interpolate `T.panel` into a `<style>` block and still be reading the one
// palette, and re-theming still means editing one file.
//
// ── alpha() ──────────────────────────────────────────────────────────────────
// The washes, edges, rings and glows a dense trading page is made of are all
// "this token at 8%". A hand-typed `rgba(48,209,88,.08)` would be a literal AND
// would stop tracking the token the moment the token moved. `color-mix()` gives
// the same result from the variable itself, and every current browser this app
// targets supports it.
//
// The names on the left are the ones v2's components/shared/homeTheme.ts used,
// deliberately, so a page ported from v2 reads the same — only its palette
// changes, and it changes to v3's.
// ─────────────────────────────────────────────────────────────────────────────

/** A token at an alpha. `alpha(T.cyan, 0.45)` → a 45% cyan. */
export function alpha(color: string, a: number): string {
  const pct = Math.max(0, Math.min(100, Math.round(a * 1000) / 10))
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`
}

/**
 * Mix two tokens. Used where a wash sits on an opaque plate and must stay
 * opaque — a translucent tag over a coloured bar lets the bar read through it.
 */
export function mix(a: string, b: string, aPct: number): string {
  return `color-mix(in srgb, ${a} ${Math.round(aPct * 100)}%, ${b})`
}

export const T = {
  /** Page canvas. */
  bg: 'var(--color-bg)',
  /** The opaque panel plate — safe to put text on top of a coloured bar with. */
  panel: 'var(--color-surface)',
  /** Nested rows, table headers, sunken tracks. */
  panelBg: 'var(--color-surface2)',
  /** Hover / elevated. */
  raised: 'var(--color-raised)',
  /** Hairline borders and dividers. */
  border: 'var(--color-line)',
  /** Primary text. */
  text: 'var(--color-fg)',
  /** Labels, axis ticks, secondary text. */
  muted: 'var(--color-muted)',
  faint: 'var(--color-faint)',
  /** The UI accent. v2 called this `cyan`. */
  cyan: 'var(--color-accent)',
  /** The deeper companion to the accent — v2's `purple`, the DEX line's hue. */
  purple: 'var(--color-dex)',
  /** Warning / amber. v2's `orange`. */
  orange: 'var(--color-warn)',
  /** Alert red. */
  red: 'var(--color-down)',
  /** Positive / up. */
  green: 'var(--color-up)',
  flat: 'var(--color-flat)',
} as const

/** The one card accent — v2's LIGHT_BLUE. */
export const LIGHT_BLUE = 'var(--color-series-5)'

/**
 * CANDLE COLOURS — the up/down pair every OHLC surface draws with, and the
 * +/− gamma pair the premarket ladder uses. These are the values v2 used,
 * carried into tokens.css verbatim, so a bar here is the same green as an
 * up-candle two tabs over.
 */
export const ES_CANDLE_UP = 'var(--color-candle-up)'
export const ES_CANDLE_DOWN = 'var(--color-candle-down)'

/** CB / CW / PW wall colours. cb = Core Bullseye, cw = call wall, pw = put wall. */
export const LEVEL_COLORS = {
  cb: 'var(--color-level-cb)',
  cw: 'var(--color-level-cw)',
  pw: 'var(--color-level-pw)',
} as const

/**
 * The violet the premarket page marks the FLIP with. A third hue on purpose:
 * the flip is neither a wall nor a sign, and borrowing either would read as
 * "same series, different shape".
 */
export const VIOLET = 'var(--color-violet)'

/**
 * Pure black, for drop shadows. A shadow is not a palette colour — it is the
 * absence of light under a raised surface — but it still may not be typed as a
 * literal in a component, so it lives in tokens.css like everything else.
 */
export const SHADOW = 'var(--color-shadow)'

/** Impact ramp + actual/forecast/previous, for the economic calendar. */
export const CAL = {
  high: 'var(--color-impact-high)',
  medium: 'var(--color-impact-medium)',
  low: 'var(--color-impact-low)',
  holiday: 'var(--color-impact-holiday)',
  president: 'var(--color-impact-president)',
  faded: 'var(--color-impact-faded)',
  accent: 'var(--color-cal-accent)',
  actual: 'var(--color-cal-actual)',
  forecast: 'var(--color-cal-forecast)',
  previous: 'var(--color-cal-previous)',
} as const

/**
 * v2's HOME_THEME, under its old name, so a ported page's
 * `import { HOME_THEME as HT }` keeps working unchanged. New code should use
 * `T`.
 */
export const HOME_THEME = T
