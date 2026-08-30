// ─────────────────────────────────────────────────────────────────────────────
// S&P SECTOR WHEEL — the maths.
//
// NAMED wheelMath.ts, and that is not cosmetic. A `sectorWheel.ts` beside a
// `SectorWheel.tsx` differs only in casing, so on Windows the resolver turns
// `import('./SectorWheel')` into `SectorWheel.ts`, the filesystem hands back
// THIS file, and tsc fails with TS1149 plus "Property 'default' is missing" on
// the lazy() import. It builds clean on a case-sensitive filesystem, which is
// precisely how it got committed once already. Keep the two basenames distinct.
//
// Everything in this file is transcribed 1:1 from v2's
// components/dashboard/SectorSunburst.tsx: the ring radii, the weighting, the
// two colour ramps, the bar-length clamp, the label fit tests, the greedy
// callout placer. The numbers are not re-derived and must not be "tidied" —
// they are the spec (docs/parity/traders-dashboard.md, Part F).
//
// What did NOT come across is v2's colour handling. v2 typed its own hex
// helpers over HOME_THEME; v3 forbids a literal outside tokens.css, so the
// palette below reads the token values numerically through
// design/theme.ts's tokenRgb() and does the same arithmetic on those.
//
// Geometry note carried from v2: every bar grows OUTWARD from the zero ring.
// Nothing grows inward, which is what keeps the hub free for the index number
// and the click-to-zoom-out target.
// ─────────────────────────────────────────────────────────────────────────────

import { MOVE_DOWN, MOVE_UP, T, isLightRgb, mixRgb, rgbHex, tokenRgb, type RGB } from '@/design/theme'

// ── Wire shape (server: app/api/spx-sunburst/route.ts) ───────────────────────

export interface WheelRow {
  /** Ticker. */
  t: string
  /** GICS sector. */
  s: string
  /** Industry. */
  i: string
  /** Approximate market cap in $B — arc width only. */
  w: number
  /** Percent change vs the prior regular close. */
  c: number
}

export interface WheelPayload {
  rows: WheelRow[]
  updatedAt: number
  /** How many of the universe returned a usable quote. */
  covered: number
  universe: number
  /** True when the upstream sweep failed and this is a previously cached body. */
  stale?: boolean
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Server caches for 15 min; this just keeps the tab fresh. */
export const POLL_MS = 5 * 60_000

/** viewBox edge — the SVG scales to its column via width:100%. */
export const VB = 440
export const R = 208

/**
 * Zoomed in there is only one sector and the hub already names it, so the
 * sector ring collapses to a thin accent band and the industry ring takes the
 * space — which is also what makes industry labels fit at this size.
 */
export const RING_ALL = { holeOut: 0.3, secOut: 0.44, indOut: 0.52 } as const
export const RING_FOCUS = { holeOut: 0.3, secOut: 0.325, indOut: 0.52 } as const

/** Zero ring — every bar's foot. */
export const R0 = R * 0.54
/** Bar length at the full-scale move. */
export const AMP = R * 0.33
export const CLAMP = 1.06
export const CAPS = [2, 3, 5] as const
/**
 * The bars stop short of the edge on purpose: the band outside them is where
 * the biggest winners and losers get named. Callout labels sit on this radius
 * and follow the circle, so they cost one line of radial room rather than the
 * horizontal run a straight leader-line callout would need.
 */
export const R_CALL = R * 0.955
const TAU = Math.PI * 2

/** Progressively shorter forms, tried in order until one fits the sector arc. */
export const SECTOR_SHORT: Record<string, string[]> = {
  'Information Technology': ['Technology', 'Tech'],
  'Communication Services': ['Communications', 'Comms'],
  'Consumer Discretionary': ['Cons. Disc.', 'Disc.'],
  'Consumer Staples': ['Staples'],
  'Health Care': ['Health'],
  Financials: ['Fins'],
  Industrials: ['Indus.'],
  'Real Estate': ['REITs'],
  Materials: ['Matls'],
  Utilities: ['Utils'],
  Energy: ['Enrgy'],
}

export const nameForms = (n: string): string[] => [n, ...(SECTOR_SHORT[n] ?? [])]

/** The shortest form we have — what fits in a ~100-unit hub. */
export function shortestForm(n: string): string {
  const forms = nameForms(n)
  return forms[forms.length - 1] ?? n
}

// ── Geometry ─────────────────────────────────────────────────────────────────

export const pt = (r: number, a: number): string =>
  `${(r * Math.sin(a)).toFixed(2)},${(-r * Math.cos(a)).toFixed(2)}`
export const px = (r: number, a: number): number => r * Math.sin(a)
export const py = (r: number, a: number): number => -r * Math.cos(a)

/** Do two angular spans overlap? Checked at ±2π so the seam at 12 o'clock counts. */
export function angOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  for (const s of [-TAU, 0, TAU]) if (a0 < b1 + s && b0 + s < a1) return true
  return false
}

export function arcPath(a0: number, a1: number, r0: number, r1: number): string {
  if (r1 <= r0 || a1 <= a0) return ''
  // A single sector zoomed in spans the whole circle; one arc command cannot
  // close a 360° sweep, so draw it as two half-circles.
  if (a1 - a0 >= TAU - 1e-6) {
    return (
      `M ${pt(r1, 0)} A${r1},${r1} 0 1 1 ${pt(r1, Math.PI)} A${r1},${r1} 0 1 1 ${pt(r1, 0)} Z ` +
      `M ${pt(r0, 0)} A${r0},${r0} 0 1 0 ${pt(r0, Math.PI)} A${r0},${r0} 0 1 0 ${pt(r0, 0)} Z`
    )
  }
  const large = a1 - a0 > Math.PI ? 1 : 0
  return (
    `M ${pt(r1, a0)} A${r1},${r1} 0 ${large} 1 ${pt(r1, a1)} ` +
    `L ${pt(r0, a1)} A${r0},${r0} 0 ${large} 0 ${pt(r0, a0)} Z`
  )
}

/** Rough text width — good enough to decide whether a label fits at this size. */
export const textW = (s: string, fs: number): number => s.length * fs * 0.6

// ── Hierarchy ────────────────────────────────────────────────────────────────

export interface WheelNode {
  name: string
  a0: number
  a1: number
  rows: WheelRow[]
  chg: number
}
export interface WheelLeaf extends WheelNode {
  row: WheelRow
}

export interface Hierarchy {
  sectors: WheelNode[]
  industries: WheelNode[]
  leaves: WheelLeaf[]
  net: number
  up: number
  down: number
}

/** Cap-weighted average change over a group. */
function wavg(rs: WheelRow[]): number {
  const tw = rs.reduce((a, r) => a + r.w, 0)
  return tw ? rs.reduce((a, r) => a + r.c * r.w, 0) / tw : 0
}

/**
 * Angle is market cap. Sectors by weight, industries by weight, tickers by
 * weight — biggest first, so the wheel's shape stays stable between refreshes.
 *
 * `focus` filters to one sector, and the total is re-taken over what is left —
 * so a zoomed sector spans the full 360°.
 */
export function buildHierarchy(all: WheelRow[], focus: string | null): Hierarchy {
  const rows = focus ? all.filter((r) => r.s === focus) : all
  const total = rows.reduce((a, r) => a + r.w, 0)

  const sectors: WheelNode[] = []
  const industries: WheelNode[] = []
  const leaves: WheelLeaf[] = []
  if (!total) return { sectors, industries, leaves, net: 0, up: 0, down: 0 }

  const bySector = new Map<string, WheelRow[]>()
  for (const r of rows) {
    const l = bySector.get(r.s) ?? []
    l.push(r)
    bySector.set(r.s, l)
  }
  const secList = [...bySector.entries()].sort(
    (a, b) => b[1].reduce((x, r) => x + r.w, 0) - a[1].reduce((x, r) => x + r.w, 0),
  )

  let a = 0
  for (const [name, secRows] of secList) {
    const span = (secRows.reduce((x, r) => x + r.w, 0) / total) * TAU
    sectors.push({ name, a0: a, a1: a + span, rows: secRows, chg: wavg(secRows) })

    const byInd = new Map<string, WheelRow[]>()
    for (const r of secRows) {
      const l = byInd.get(r.i) ?? []
      l.push(r)
      byInd.set(r.i, l)
    }
    const indList = [...byInd.entries()].sort(
      (x, y) => y[1].reduce((v, r) => v + r.w, 0) - x[1].reduce((v, r) => v + r.w, 0),
    )

    let ai = a
    for (const [iName, indRows] of indList) {
      const iSpan = (indRows.reduce((x, r) => x + r.w, 0) / total) * TAU
      industries.push({ name: iName, a0: ai, a1: ai + iSpan, rows: indRows, chg: wavg(indRows) })
      let al = ai
      for (const row of [...indRows].sort((x, y) => y.w - x.w)) {
        const lSpan = (row.w / total) * TAU
        leaves.push({ name: row.t, a0: al, a1: al + lSpan, rows: [row], chg: row.c, row })
        al += lSpan
      }
      ai += iSpan
    }
    a += span
  }

  return {
    sectors,
    industries,
    leaves,
    net: wavg(rows),
    up: rows.filter((r) => r.c > 0).length,
    down: rows.filter((r) => r.c < 0).length,
  }
}

// ── Palette ──────────────────────────────────────────────────────────────────
//
// v2's two ramps, on v3 tokens read numerically. Colour by DIRECTION, length by
// MAGNITUDE — a bar's hue only ever says up or down, its length says how much.

export interface WheelPalette {
  /** Ticker bar fill. */
  fillFor: (v: number) => string
  /** Sector / industry ring wash. `strength` 0.62 sector, 0.90 industry. */
  ringFill: (v: number, strength: number) => string
  /** Bar length from the zero ring, in viewBox units. */
  barLen: (v: number) => number
  /** Black or white ink for whatever was just painted. */
  inkOn: (paintedHex: string) => string
  /** Directional colour for text and strokes. */
  dir: (v: number) => string
}

/** Neutral midpoint of the diverging scale — the panel, lifted toward the ink. */
function midpoint(panel: RGB, text: RGB): RGB {
  return mixRgb(panel, text, 0.16)
}

/**
 * Build the ramps for one `cap` setting.
 *
 * Falls back to the flat token strings when the stylesheet is not readable
 * (a test renderer, a first tick before tokens.css is live): the wheel then
 * paints the right hues with no magnitude ramp for that frame, which is a far
 * better failure than an SVG full of `undefined` fills.
 */
export function wheelPalette(cap: number): WheelPalette {
  const panel = tokenRgb('--color-surface')
  const text = tokenRgb('--color-fg')
  const bg = tokenRgb('--color-bg')
  const up = tokenRgb('--color-move-up')
  const down = tokenRgb('--color-move-down')

  const barLen = (v: number) => Math.max(Math.min(Math.abs(v) / cap, CLAMP) * AMP, 1.5)
  const dir = (v: number) => (v >= 0 ? MOVE_UP : MOVE_DOWN)

  if (!panel || !text || !bg || !up || !down) {
    return {
      fillFor: dir,
      ringFill: dir,
      barLen,
      inkOn: () => T.text,
      dir,
    }
  }

  const mid = midpoint(panel, text)

  return {
    fillFor: (v) => {
      const k = Math.max(0.24, Math.min(1, Math.abs(v) / cap))
      return rgbHex(mixRgb(mid, v >= 0 ? up : down, k))
    },
    // Sector and industry averages are small by construction — they wash out —
    // so the ring ramp starts well above zero. Without the 0.34 floor every
    // inner arc comes out panel-coloured.
    ringFill: (v, strength) => {
      const k = 0.34 + 0.66 * Math.min(1, Math.abs(v) / cap)
      return rgbHex(mixRgb(panel, v >= 0 ? up : down, k * strength))
    },
    barLen,
    inkOn: (paintedHex) => {
      const c = paintedHex.startsWith('#') ? parseHex(paintedHex) : null
      if (!c) return T.text
      return isLightRgb(c) ? rgbHex(bg) : rgbHex(text)
    },
    dir: (v) => rgbHex(v >= 0 ? up : down),
  }
}

function parseHex(s: string): RGB | null {
  const h = s.slice(1)
  if (h.length !== 6) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

// ── Callouts ─────────────────────────────────────────────────────────────────

export interface Callout {
  /** Index into `leaves`, so the bar it belongs to can skip its inner label. */
  k: number
  mid: number
  /** Radius of the bar's tip — where the tick line starts. */
  tip: number
  text: string
  chg: number
  fs: number
}

/**
 * Name the extremes right on the wheel.
 *
 * Biggest winners and losers of whatever is currently on screen, so zooming a
 * sector re-picks them. Placed greedily, biggest move first — if a label would
 * collide with one already down, the smaller mover simply goes unnamed rather
 * than the two overprinting. The Top/Bottom list under the wheel still has
 * every name.
 */
export function buildCallouts(
  leaves: WheelLeaf[],
  count: number,
  fs: number,
  barLen: (v: number) => number,
): Callout[] {
  const idx = leaves.map((l, k) => ({ l, k }))
  const winners = [...idx].sort((a, b) => b.l.chg - a.l.chg).slice(0, count).filter((x) => x.l.chg > 0)
  const losers = [...idx].sort((a, b) => a.l.chg - b.l.chg).slice(0, count).filter((x) => x.l.chg < 0)

  const placed: { a0: number; a1: number }[] = []
  const out: Callout[] = []
  for (const { l, k } of [...winners, ...losers].sort((a, b) => Math.abs(b.l.chg) - Math.abs(a.l.chg))) {
    const text = `${l.name} ${l.chg >= 0 ? '+' : '−'}${Math.abs(l.chg).toFixed(1)}%`
    const mid = (l.a0 + l.a1) / 2
    const half = (textW(text, fs) / 2 + 5) / R_CALL // angular half-width + gap
    const a0 = mid - half
    const a1 = mid + half
    if (placed.some((p) => angOverlap(p.a0, p.a1, a0, a1))) continue
    placed.push({ a0, a1 })
    out.push({ k, mid, tip: R0 + barLen(l.chg), text, chg: l.chg, fs })
  }
  return out
}

// ── Sector leaderboard ───────────────────────────────────────────────────────

export interface SectorRank {
  name: string
  n: number
  chg: number
}

/**
 * Always the FULL universe, never the zoomed view — otherwise the pop-out's
 * rail collapses to one row the moment the wheel is zoomed into a sector.
 */
export function sectorRank(rows: WheelRow[]): SectorRank[] {
  const by = new Map<string, WheelRow[]>()
  for (const r of rows) {
    const l = by.get(r.s) ?? []
    l.push(r)
    by.set(r.s, l)
  }
  return [...by.entries()]
    .map(([name, rs]) => ({ name, n: rs.length, chg: wavg(rs) }))
    .sort((a, b) => b.chg - a.chg)
}

// ── Formatting ───────────────────────────────────────────────────────────────

/**
 * `"+1.23%"` / `"−1.23%"`. The negative sign is U+2212 MINUS SIGN, not a
 * hyphen — v2's choice, and it is what makes the callouts line up.
 */
export const fmtWheelPct = (v: number): string => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`
