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

/**
 * MOVE COLOURS — the directional pair the Traders Dashboard and its S&P Sector
 * Wheel paint with. Blue up, red down, carried across from v2 verbatim; see the
 * note beside --color-move-up in tokens.css for why this is not T.green/T.red.
 */
export const MOVE_UP = 'var(--color-move-up)'
export const MOVE_DOWN = 'var(--color-move-down)'

// ─────────────────────────────────────────────────────────────────────────────
// NUMERIC COLOUR.
//
// Everything above hands out a CSS string, which is all a class name or an
// inline `background` ever needs. Two jobs need the value as NUMBERS instead:
//
//   • a diverging ramp that mixes toward a hue by MAGNITUDE and has to stay
//     opaque, because it is painted under text;
//   • the luminance test that decides whether the label printed on that mix
//     should be dark or light.
//
// color-mix() can do the first and cannot do the second — CSS has no way to
// ask "is this light?". So these read the token's actual value off :root
// rather than duplicating it. tokens.css is still the only place the value is
// written, and moving a token still moves everything derived from it.
//
// Cached per token name: the read is a getComputedStyle call, and the wheel
// asks for the same four tokens on every repaint.
// ─────────────────────────────────────────────────────────────────────────────

export type RGB = readonly [number, number, number]

const rgbCache = new Map<string, RGB | null>()

function parseColor(raw: string): RGB | null {
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
  // notation. Pull the first three numbers out of it rather than naming the
  // function, which check-theme.mjs bans from source on sight.
  const m = s.match(/(\d+(?:\.\d+)?)[,\s/]+(\d+(?:\.\d+)?)[,\s/]+(\d+(?:\.\d+)?)/)
  if (!m || !m[1] || !m[2] || !m[3]) return null
  return [Math.round(Number(m[1])), Math.round(Number(m[2])), Math.round(Number(m[3]))]
}

/**
 * A token's literal value, as r/g/b. Pass the custom-property NAME
 * (`'--color-move-up'`), not a `var()` string.
 *
 * Returns null before the stylesheet is live (a test renderer, a first tick in
 * a jsdom): callers fall back to the plain `var()` string, which still paints
 * the right colour — they just lose the ramp for that frame.
 */
export function tokenRgb(name: string): RGB | null {
  const hit = rgbCache.get(name)
  if (hit !== undefined) return hit
  let out: RGB | null = null
  if (typeof window !== 'undefined' && typeof getComputedStyle === 'function') {
    out = parseColor(getComputedStyle(document.documentElement).getPropertyValue(name))
  }
  rgbCache.set(name, out)
  return out
}

/** Drop every cached token read. Only needed if the palette is swapped live. */
export function clearTokenCache(): void {
  rgbCache.clear()
}

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

/** Linear blend, `t` of the way from `a` to `b`. */
export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  const k = clamp01(t)
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ]
}

/** `[142,202,230]` → the hex string a `fill=` attribute wants. */
export function rgbHex(c: RGB): string {
  const two = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${two(c[0])}${two(c[1])}${two(c[2])}`
}

/**
 * Is this colour light enough that dark ink reads better on it?
 *
 * Relative luminance (sRGB → linear, Rec.709 weights) against v2's 0.32
 * threshold, transcribed from SectorSunburst.tsx's `inkOn`. The threshold is
 * deliberately above 0.5's "mathematically neutral" point: the wheel's plates
 * are washes over a near-black panel, and white ink holds on a lot more of
 * them than a midpoint test would allow.
 */
export function isLightRgb(c: RGB): boolean {
  const lin = (v: number) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]) > 0.32
}

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
