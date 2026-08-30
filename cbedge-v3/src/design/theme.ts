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

/**
 * THE MOVE PAIR — the directional colour a % change, a wheel wedge or a
 * dashboard stat is painted with. Separate tokens from T.green / T.red on
 * purpose; see the note beside --color-move-up in tokens.css.
 */
export const MOVE_UP = 'var(--color-move-up)'
export const MOVE_DOWN = 'var(--color-move-down)'

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

// ─────────────────────────────────────────────────────────────────────────────
// COLOURS FOR A CANVAS.
//
// Everything above hands out `var(--color-…)` or `color-mix(…)`, which is
// exactly right for a class name, an inline `background` or a `<style>` block —
// and useless to a canvas. `ctx.fillStyle = 'var(--color-up)'` does not throw;
// it silently leaves the previous fill in place. `color-mix()` is not a canvas
// colour either. Chart libraries (lightweight-charts included) take plain
// colour STRINGS and hand them straight to a 2D context, so they need a
// RESOLVED value.
//
// These two resolve one out of tokens.css at call time, which keeps the single
// source of truth intact: the token is still the only place the value is
// written, and moving it still moves the chart. This is the sanctioned way to
// colour a canvas. A hex fallback typed into a chart file is not — that is what
// put src/board/chart-render.ts, gexCandles/bubbles.ts, gexCandles/chart.ts and
// gexChart/gexChartRender.ts into theme-baseline.json between them.
//
// Call them at MOUNT, not per frame. Each is a getComputedStyle read behind a
// cache, and a chart resolving its palette inside its draw loop is doing layout
// work sixty times a second for a value that never changes.
// ─────────────────────────────────────────────────────────────────────────────

type Rgb = readonly [number, number, number]

const rgbCache = new Map<string, Rgb | null>()

function parseTokenColor(raw: string): Rgb | null {
  const s = raw.trim()
  if (!s) return null
  if (s.startsWith('#')) {
    const h = s.slice(1)
    if (h.length === 3 || h.length === 4) {
      const r = h[0], g = h[1], b = h[2]
      if (!r || !g || !b) return null
      return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)]
    }
    if (h.length === 6 || h.length === 8) {
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
    }
    return null
  }
  // Defensive: a browser that normalised the custom property to a functional
  // notation. The first three numbers are pulled out WITHOUT naming the
  // function, which check-theme.mjs bans from src/ on sight.
  const m = s.match(/(\d+(?:\.\d+)?)[,\s/]+(\d+(?:\.\d+)?)[,\s/]+(\d+(?:\.\d+)?)/)
  if (!m || !m[1] || !m[2] || !m[3]) return null
  return [Math.round(Number(m[1])), Math.round(Number(m[2])), Math.round(Number(m[3]))]
}

function readToken(name: string): Rgb | null {
  const hit = rgbCache.get(name)
  if (hit !== undefined) return hit
  let out: Rgb | null = null
  if (typeof window !== 'undefined' && typeof getComputedStyle === 'function') {
    out = parseTokenColor(getComputedStyle(document.documentElement).getPropertyValue(name))
  }
  rgbCache.set(name, out)
  return out
}

const hexByte = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')

/**
 * A token's resolved value, as the hex string a canvas wants. Pass the custom
 * property NAME (`'--color-up'`), not a `var()` string.
 *
 * `transparent` before the stylesheet is live (a test renderer, jsdom, the
 * first tick before styles apply): a chart that paints nothing for one frame is
 * recoverable, one that paints an invented colour is not.
 */
export function tokenHex(name: string): string {
  const c = readToken(name)
  return c ? `#${hexByte(c[0])}${hexByte(c[1])}${hexByte(c[2])}` : 'transparent'
}

/**
 * The same, at an alpha — as `#rrggbbaa`, which every canvas and every chart
 * library accepts. Written this way rather than as a functional notation on
 * purpose: that notation is banned from src/ by check-theme.mjs, and rightly so.
 */
export function tokenHexAlpha(name: string, a: number): string {
  const c = readToken(name)
  if (!c) return 'transparent'
  return `#${hexByte(c[0])}${hexByte(c[1])}${hexByte(c[2])}${hexByte(Math.max(0, Math.min(1, a)) * 255)}`
}

/**
 * ── THE RGB FAMILY ───────────────────────────────────────────────────────────
 * tokenHex()/tokenHexAlpha() above hand back a STRING, which is all a canvas
 * fill needs. Anything that has to do arithmetic on a colour — the sector
 * wheel blends a wedge from the panel toward the move colour, then picks black
 * or white ink by luminance — needs the channels, not a string. These expose
 * the same cached token read as a triple, so the blend still tracks the token
 * and no component re-parses a hex by hand.
 */
export type RGB = Rgb

/**
 * A token's resolved channels. Pass the custom property NAME, not a var()
 * string. Falls back to black before the stylesheet is live (jsdom, a test
 * renderer, the first tick) for the same reason tokenHex() returns
 * `transparent`: a wrong-but-quiet value beats a thrown render.
 */
export function tokenRgb(name: string): RGB {
  return readToken(name) ?? [0, 0, 0]
}

/** `#rrggbb` for a triple. */
export function rgbHex(c: RGB): string {
  return `#${hexByte(c[0])}${hexByte(c[1])}${hexByte(c[2])}`
}

/** Linear blend: `t` of 0 is all `a`, 1 is all `b`. */
export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  const k = Math.max(0, Math.min(1, t))
  return [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ]
}

/**
 * Is this colour light enough that dark ink reads better on it? Rec. 709
 * luma, which tracks perceived brightness far better than a channel average —
 * a saturated green and a saturated blue of the same average are nowhere near
 * equally bright.
 */
export function isLightRgb(c: RGB): boolean {
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 > 0.6
}


/**
 * ── THE OPTIONS-CHAIN INK ─────────────────────────────────────────────────────
 * The chain matrix is thousands of cells, and every one of them is text on a
 * heat fill. Its greys are therefore not "muted" in the page sense — they are
 * a ladder of white opacities tuned so a value stays legible on a saturated
 * cell and a zero recedes without disappearing. Named here rather than typed
 * per component so the matrix, the hover card and the heat skins agree.
 */
export const CHAIN = {
  /** Strike column, non-ATM. ATM takes T.cyan at the call site. */
  strike: alpha(T.text, 0.92),
  /** Hover-card label. */
  key: T.muted,
  /** Hover-card value, un-emphasised. */
  val: alpha(T.text, 0.88),
  /** Default cell text, and the heat skins' ink. */
  ink: T.text,
  /** Empty-state copy — "no chain for this expiry". */
  empty: T.muted,
  /** A cell with no data, and the `·` placeholder. Recedes, stays visible. */
  none: T.flat,
  /** The MVC outline. A third hue on purpose — neither a wall nor a sign. */
  mvc: T.purple,
  /** The +/- sign glyph. */
  signUp: T.green,
  signDown: T.red,
  /** Delta change. Same pair; named apart so one can move without the other. */
  deltaUp: T.green,
  deltaDown: T.red,
} as const

/**
 * GEX sign colours, for a cell fill rather than a chart. These are the bubble
 * hues the ES chart already uses, so a positive strike is the same blue in the
 * chain as it is on the candles.
 */
export const GEX_POS = 'var(--color-gex-pos)'
export const GEX_NEG = 'var(--color-gex-neg)'

/**
 * Ink for a SOLID level tag (CB gold, CW blue, PW red). Those fills are bright
 * and the label sits directly on them, so it takes the darkest ground in the
 * palette rather than a white at an opacity — a translucent label lets the tag
 * read through it and stops being legible. Same reasoning as V2W's note about
 * the ladder tags.
 */
export const LEVEL_ON_SOLID = 'var(--color-app)'

/** Drop every cached token read. Only needed if the palette is swapped live. */
export function clearTokenCache(): void {
  rgbCache.clear()
}

/**
 * v2's HOME_THEME, under its old name, so a ported page's
 * `import { HOME_THEME as HT }` keeps working unchanged. New code should use
 * `T`.
 */
export const HOME_THEME = T
