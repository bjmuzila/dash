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
 * ── THE v2 PARITY PALETTE ────────────────────────────────────────────────────
 *
 * For the Analysis page (/v3/analytics) ONLY, which is a 1:1 port of v2's
 * /app/analytics and is required to render v2's colours rather than v3's.
 *
 * READ THIS BEFORE USING `T` ON THAT PAGE. `T` deliberately maps v2's names
 * onto v3's values, so on a page that must match v2 these four are traps:
 *
 *   T.cyan   → #5b8cff  where v2 is #219EBC (a teal)
 *   T.orange → #e0a44a  where v2 is #FB8501
 *   T.red    → #e0645f  where v2 is #EF4444
 *   T.green  → #35c28e  where v2 is #8ECAE6 — a LIGHT BLUE, not a green
 *
 * …and `T.border` / `T.panelBg` are opaque slate where v2 is a white wash and a
 * 45%-translucent plate. Use `V2.*` and the `alpha()` recipes below instead.
 *
 * `text` / `muted` need no override: v3's are already #ffffff, which is what
 * v2's are. v2 has no grey secondary — "muted" there is white at an opacity,
 * which is why the port carries v2's opacities rather than inventing a grey.
 */
export const V2 = {
  cyan: 'var(--color-v2-cyan)',
  orange: 'var(--color-v2-orange)',
  red: 'var(--color-v2-red)',
  /** v2's HOME_THEME.green — a light blue. Not a positive/up colour. */
  green: 'var(--color-v2-green)',
  /** v2's page-local POS_GREEN. THIS is the page's up/positive colour. */
  pos: 'var(--color-v2-pos)',
  purple: 'var(--color-v2-purple)',
  bg: 'var(--color-v2-bg)',
  panel: 'var(--color-v2-panel)',
  /** Ink on a solid fill — a level tag, an active transport button. */
  ink: 'var(--color-v2-ink)',
  refresh: 'var(--color-v2-refresh)',
  /** The refresh button's "refreshing" grey — v2's inline #888. */
  dim: 'var(--color-v2-dim)',
  badgeInk: 'var(--color-v2-badge-ink)',
  lightBlue: 'var(--color-v2-lightblue)',
  /** Already identical in both palettes. Aliased so a ported file reads V2.* throughout. */
  text: T.text,
  muted: T.muted,
} as const

/**
 * The v2 washes, by name, so no component re-derives one.
 *
 * v2 builds these with a local `themeRgba()` helper or a typed rgba(); here
 * they are `alpha()` over a token, which is color-mix() underneath and keeps
 * tracking the token if it ever moves.
 *
 * NOT here on purpose: anything that sits ON TOP of a coloured bar. The ladder's
 * CB/CW/PW tags and the spot-price chip take a SOLID fill — a translucent plate
 * lets the bar read through it and the label stops being legible. v2 does not
 * make those translucent and neither may v3.
 */
export const V2W = {
  /** v2's T.border — a white hairline, not a slate line. */
  border: alpha(T.text, 0.1),
  /** v2's T.panelBg — THE CARD FILL. The frosted look is the translucency. */
  panelBg: alpha(V2.panel, 0.45),
  /** v2's T.panelBgStrong — the econ header bar, the replay date select. */
  panelBgStrong: alpha(V2.panel, 0.72),
  /** The portal'd ticker-picker panel. */
  panelSolid: alpha(V2.panel, 0.97),
  /** Faint white washes: input/button fills, row hovers, the read block. */
  wash04: alpha(T.text, 0.04),
  wash05: alpha(T.text, 0.05),
  wash03: alpha(T.text, 0.03),
  /** The picker's unfavourited star. */
  star: alpha(T.text, 0.28),
  /** The premarket bullet list's scrollbar thumb. */
  scrollThumb: alpha(T.text, 0.12),
  /** The ladder's spot row. */
  spotRow: alpha(V2.cyan, 0.08),
  /** Picker active row, and its hover. */
  pickRow: alpha(V2.cyan, 0.1),
  pickRowHover: alpha(V2.cyan, 0.15),
  /** The econ calendar's TODAY day-separator plate. */
  todayRow: alpha(V2.cyan, 0.06),
  /** The replay bar's plate and its border. `${T.orange}55` is 0x55/255. */
  replayBg: alpha(V2.orange, 0.07),
  replayEdge: alpha(V2.orange, 0.333),
  /** The two page-background radials in v2's homeShellStyle. */
  glowA: alpha(V2.cyan, 0.04),
  glowB: alpha(V2.purple, 0.05),
  /** The embed-mode card radial. */
  embedGlow: alpha(V2.lightBlue, 0.1),
} as const

/**
 * v2's HOME_THEME, under its old name, so a ported page's
 * `import { HOME_THEME as HT }` keeps working unchanged. New code should use
 * `T`.
 */
export const HOME_THEME = T
