// ─────────────────────────────────────────────────────────────────────────────
// VOLTICK PATH — THE BEADS. The Path's painter, on its own so it can be used
// without Vela.
//
// Moved out of vtPathLayer.ts (2026-10-07) unchanged: the Vela renderer layer
// there and the home board's GEX Candles card (board/gexCandles/pathBubbles.ts,
// Brandon: "i want the same bubbles and logic as the vela bubbles") both paint
// with THIS class, so the two charts draw the same beads by construction — one
// radius from the bar pitch, growth inside it, the lit gold Volt, the Coil's
// diamond, the every-Nth-bar grid zoomed out. Read vtPathLayer.ts's header for
// why each of those rules is what it is.
//
// The painter is handed a `Geo` — a canvas context already clipped to the plot
// and two coordinate functions — so it does not care whose chart it is on:
// Vela's coords on /vela, lightweight-charts' scales on the board.
//
// Nothing in this file may import '@luxalgo/vela' at runtime (the home board
// must never load the Vela chunk). Type imports only.
// ─────────────────────────────────────────────────────────────────────────────

import { tokenRgb, type RGB } from '@/design/theme'
import { pathSizes, PATH_SIZE, type FillPt, type PathPt, type PathRole } from './trailruns'
import type { PathRow } from './vtPathData'

/** What the indicator pushes to its layer (and what the board card hands its painter). */
export interface PathPayload {
  rows: PathRow[]
  /** Voltick's Node levels slider, 0..1 (default 0.15). */
  ci: number
  /** Voltick's Calm chart. */
  quiet: boolean
  /** CB Edge: bubble size / band thickness multiplier (1 = default). */
  size: number
  /**
   * The PAINT, and only the paint — which beads exist, where, and how big is the
   * same either way. 'voltick' (absent: /vela always) is Voltick's level
   * colours: the lit gold Volt, pink Reversal, blue Coil and Surge, a dark rim.
   * 'cbedge' is the GEX Candles card on the CB Edge theme (2026-10-07, Brandon:
   * "it should be in cbedge style on the cbedge filter — main thing is the logic
   * and the path/bubbles shaping and sizing"): the card's own classic bubbles —
   * see paintCbEdge.
   */
  skin?: 'voltick' | 'cbedge'
  /**
   * 'cbedge' only: the underlying's price at a candle (its close; seconds in),
   * which says which side of spot a bead is on. null / absent = call side.
   */
  spotAt?: (tSec: number) => number | null
}

export const ROLE_TOKEN: Record<PathRole, string> = {
  volt: '--color-vt-volt',
  surge: '--color-vt-surge',
  reversal: '--color-vt-reversal',
  coil: '--color-vt-coil',
}

export const FLAT_SPAN = 0.03
export const REF_MOVE = 1.6


/** CB Edge Path bead geometry (see the header, ZOOM-PROOF BUBBLES). */
const BEAD = {
  /** a Volt bead's width as a share of one bar's pitch, zoomed OUT (beads all but touch) */
  pitchTight: 0.94,
  /** …and zoomed IN (a little air between them) — the "give or take" */
  pitchLoose: 0.9,
  /** bar spacing, px, at or below which the tight pitch holds */
  bsTight: 5,
  /** bar spacing, px, at or above which the loose pitch holds */
  bsLoose: 30,
  /** the Volt's largest radius, px — a sanity cap only: zoomed in, the beads keep
   *  following the bar so their borders stay almost touching (2026-10-06: "the actual
   *  bubbles' borders to almost connect … remove the line") */
  voltMax: 30,
  /** GROWTH: the bead at its level's LOWEST reading that session, as a share of the
   *  full (highest-reading) bead — the bead grows ~1.6× as GEX goes from the day's low to its high */
  growMin: 0.62,
  /** growth curve (<1 shows early growth sooner) */
  growCurve: 0.75,
  /** readings averaged per bead, so growth reads as a swell and not as jitter */
  growSmooth: 5,
  /** the smallest any bead is drawn, px */
  beadMinPx: 3,
  /** peer radius as a share of the Volt's (a peer row stays near-connected too) */
  peer: 0.9,
  /** never smaller than this, px — zoomed out, a narrower bar spaces beads out instead */
  minPx: 4.5,
  /** share of the pixel gap between neighbouring strikes two beads may fill */
  strikeFill: 0.9,
  /** how wide a bead may grow past its bar (1 = touching) before columns are skipped */
  overlap: 1.1,
}

const hb = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
/** A token's channels at an alpha, as `#rrggbbaa` (what every canvas accepts). */
export const hexA = (c: RGB, a: number) => `#${hb(c[0])}${hb(c[1])}${hb(c[2])}${hb(Math.max(0, Math.min(1, a)) * 255)}`

const NY_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
const GROW_SIZE = { ...PATH_SIZE, smooth: BEAD.growSmooth }

/**
 * GROWTH (2026-10-06, Brandon: "if GEX is increasing on the Volt I want it to be
 * noticeable in the bubbles increasing"). Each reading's place, 0..1, between its
 * level's lowest and highest GEX on its OWN session (0DTE GEX grows ~40× through a
 * day, so one range across several sessions would pin every morning at the
 * bottom), smoothed over BEAD.growSmooth readings — Voltick's pathSizes, run per
 * session. `fill` is time-ordered, so each day's slice comes back in place.
 */
function growthBySession(fill: readonly FillPt[], pts: readonly PathPt[]): number[] {
  const byHour = new Map<number, string>()
  const dayOf = (t: number) => {
    const h = Math.floor(t / 3600)
    let d = byHour.get(h)
    if (d == null) byHour.set(h, (d = NY_DAY.format(h * 3_600_000)))
    return d
  }
  const ptsByDay = new Map<string, PathPt[]>()
  for (const p of pts) {
    const k = dayOf(p.t)
    const list = ptsByDay.get(k)
    if (list) list.push(p)
    else ptsByDay.set(k, [p])
  }
  const out: number[] = []
  for (let i = 0; i < fill.length; ) {
    const k = dayOf(fill[i]!.t)
    let j = i + 1
    while (j < fill.length && dayOf(fill[j]!.t) === k) j++
    for (const v of pathSizes(fill.slice(i, j), ptsByDay.get(k) ?? [], FLAT_SPAN, GROW_SIZE)) out.push(v)
    i = j
  }
  return out
}

/** A 0..1 growth reading → the bead's share of the full bead. */
const growFactor = (k: number | undefined) => {
  const kk = Number.isFinite(k) ? Math.min(1, Math.max(0, k as number)) : 0.5
  return BEAD.growMin + (1 - BEAD.growMin) * Math.pow(kk, BEAD.growCurve)
}

/** Voltick's boldness curve, pinned at 15% (the shipped default). */
export function boldOf(ci: number): { bold: (lo: number, mid: number, hi: number) => number; up: number } {
  const up = Math.max(0, (ci - 0.15) / 0.85)
  const dn = Math.min(1, ci / 0.15)
  return { bold: (lo, mid, hi) => (ci >= 0.15 ? mid + (hi - mid) * up : lo + (mid - lo) * dn), up }
}

export interface Geo {
  ctx: CanvasRenderingContext2D
  X: (tSec: number) => number
  Y: (p: number) => number
  width: number
  height: number
  bs: number
  /** One bar, in seconds — the column grid the Path's bubbles sit on. */
  barSec: number
}

// ── PATH (bubbles) ───────────────────────────────────────────────────────────

export class PathDraw {
  /** each row's growth readings, once per data change */
  private growMemo = new WeakMap<FillPt[], number[]>()

  /** Paints the beads; true when at least one landed in view (the board card's "nothing in view" note). */
  draw(g: Geo, d: PathPayload): boolean {
    const { ctx, X, Y, width } = g
    const rows = d.rows
    const quiet = d.quiet
    const { bold } = boldOf(d.ci)
    const VOLT_GOLD = tokenRgb('--color-vt-path-gold')
    const SHINE = tokenRgb('--color-vt-path-shine')
    const RIM = hexA(tokenRgb('--color-vt-path-rim'), 0.9)
    const bs = g.bs > 0 ? g.bs : 6
    const barSec = g.barSec > 0 ? g.barSec : 60
    const size = Number.isFinite(d.size) && d.size > 0 ? d.size : 1
    const alpha = quiet ? bold(0.3, 0.7, 0.9) : bold(0.4, 0.92, 1)
    // lowest priority first, so the Volt's bead and halo sit on top
    const DRAW_ORDER: Record<PathRole, number> = { surge: 0, coil: 1, reversal: 2, volt: 3 }
    const list = rows
      .filter((r) => Array.isArray(r.fill) && r.fill.length)
      .slice()
      .sort((x, y) => (DRAW_ORDER[x.role] ?? 0) - (DRAW_ORDER[y.role] ?? 0))
    if (!list.length) return false
    // ONE RADIUS FOR THE WHOLE CHART, FROM THE BAR PITCH (see the header): a bead
    // is 94% of a bar wide zoomed out easing to 90% zoomed in, so neighbours stay
    // almost connected at every zoom and never overlap.
    const ease = Math.min(1, Math.max(0, (bs - BEAD.bsTight) / (BEAD.bsLoose - BEAD.bsTight)))
    const pitch = BEAD.pitchTight + (BEAD.pitchLoose - BEAD.pitchTight) * ease * ease * (3 - 2 * ease)
    // strike crowding: a Volt and a peer on neighbouring strikes still clear each other
    const usedP = [...new Set(list.flatMap((r) => r.fill.map((q) => q.p)))].sort((a, b) => a - b)
    let stepP = Infinity
    for (let i = 1; i < usedP.length; i++) {
      const dd = usedP[i]! - usedP[i - 1]!
      if (dd > 0 && dd < stepP) stepP = dd
    }
    const midP = usedP.length ? usedP[usedP.length >> 1]! : null
    let rCrowd = Infinity
    if (midP != null && Number.isFinite(stepP)) {
      const gap = Math.abs(Y(midP + stepP) - Y(midP))
      if (Number.isFinite(gap) && gap > 0) rCrowd = (gap * BEAD.strikeFill) / (1 + BEAD.peer)
    }
    // the Size setting and Calm chart
    const k = size * (quiet ? 0.8 : 1)
    // ZOOMED OUT (2026-10-06: "zoomed out the bubbles get super small"): once a bar
    // is too narrow for a BEAD.minPx bead, the beads sit on every Nth bar (one fixed
    // grid by the clock, the same for every level, so the spacing is even and a pan
    // never reshuffles it) and grow to fill that wider pitch — a row still reads as
    // a chain of near-touching beads instead of a line of dots.
    let N = 1
    let rBase = Math.min(BEAD.voltMax, (bs * pitch) / 2, rCrowd)
    if (((bs * pitch) / 2) * k < BEAD.minPx) {
      N = Math.max(1, Math.ceil((2 * BEAD.minPx) / (bs * pitch * k) - 1e-6))
      rBase = Math.min(BEAD.voltMax, (N * bs * pitch) / 2, Math.max(rCrowd, BEAD.minPx / k))
    }
    const rV = Math.max(BEAD.minPx, rBase * k)
    // a Size setting over 100% can make a bead wider than its bar: then the same grid
    if (N === 1) N = Math.max(1, Math.ceil((2 * rV) / (bs * BEAD.overlap) - 1e-6))
    const rP = Math.max(BEAD.minPx * BEAD.peer, rV * BEAD.peer)
    const lw = Math.min(1.1, rV * 0.3)
    // THE GRID ENDS ON THE NEWEST CANDLE (2026-10-08, Brandon: "the last one isn't
    // in line with the rest. some overlap"). Zoomed out, the every-Nth-bar grid
    // used to be fixed to the clock, and the newest reading was drawn wherever it
    // fell — one or two bars after the last grid bead, so the final two beads
    // overlapped (or, the bar after, the newest landed close behind the next grid
    // slot and the overlap moved into the middle of the last three). The grid's
    // phase is now taken from the newest candle on the Path: every slot is N bars
    // from it, so the newest bead is ON the grid and the spacing is even to the
    // very end. One phase for every level, still from the data and never from the
    // view, so a pan never reshuffles it; each new candle steps the grid along by
    // one bar, which zoomed out (a bead every N bars) is a sub-bead shift.
    let gLive = -Infinity
    for (const r of list) {
      const q = r.fill[r.fill.length - 1]
      if (q) gLive = Math.max(gLive, Math.round(q.t / barSec))
    }
    const phase = Number.isFinite(gLive) ? ((gLive % N) + N) % N : 0
    const onGrid = (g: number) => N <= 1 || ((((g - phase) % N) + N) % N) === 0
    /** the first grid slot after bar `g` */
    const nextSlot = (g: number) => g + 1 + ((((phase - (g + 1)) % N) + N) % N)
    let drew = false
    for (const r of list) {
      const lead = r.role === 'volt'
      const rad = lead ? rV : rP
      let grow = this.growMemo.get(r.fill)
      if (!grow) {
        grow = growthBySession(r.fill, r.pts)
        this.growMemo.set(r.fill, grow)
      }
      // `rad` is the FULL bead (the level's highest reading that session); a bead is
      // drawn at its growth share of it, so the bar pitch is never overrun
      const marks: Array<{ x: number; y: number; t: number; p: number; r: number }> = []
      const put = (t: number, p: number, gi: number | undefined) => {
        const x = X(t)
        if (!Number.isFinite(x) || x < -20 || x > width + 20) return
        const y = Y(p)
        if (!Number.isFinite(y)) return
        marks.push({ x, y, t, p, r: Math.max(BEAD.beadMinPx, rad * growFactor(gi)) })
      }
      // the previous reading of this row: its bar on the clock grid, price, growth
      let prev: { g: number; p: number; gi: number | undefined } | null = null
      for (let i = 0; i < r.fill.length; i++) {
        const q = r.fill[i]!
        const g = Math.round(q.t / barSec)
        // NO BLANK BEADS (2026-10-07, Brandon: "if a bubble is missed, fill in with
        // the previous one … a filled in bubble on path would be way better than a
        // blank"). A grid slot the row skipped — no reading on exactly that bar (a
        // Coil / Reversal that flipped sides for a candle, a strike another level
        // took for a minute, the zoomed-out grid landing between two readings) —
        // gets the row's previous bead. Only inside a run: a gap longer than two
        // grid steps is a real break (the level moved, a session ended) and stays.
        if (prev && g - prev.g > 1 && g - prev.g <= 2 * N) {
          for (let S = nextSlot(prev.g); S < g; S += N) put(S * barSec, prev.p, prev.gi)
        }
        // THE LIVE EDGE ALWAYS DRAWS (2026-10-07, Brandon: "path isn't going for
        // spx"): the newest candle used to fall between two clock-grid bars and show
        // no bead. The grid now ends on that candle (see gLive above), so the newest
        // reading is on it — drawn, and in line with the beads before it.
        if (onGrid(g)) put(q.t, q.p, grow[i])
        prev = { g, p: q.p, gi: grow[i] }
      }
      if (!marks.length) continue
      drew = true
      if (d.skin === 'cbedge') {
        paintCbEdge(ctx, marks, r.role, lead, quiet, alpha, d.spotAt)
        continue
      }
      if (lead && !quiet) {
        ctx.globalAlpha = 1
        for (const m of marks) {
          const glow = m.r * 1.6
          const gr = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, glow)
          gr.addColorStop(0, hexA(VOLT_GOLD, 0.22))
          gr.addColorStop(1, hexA(VOLT_GOLD, 0))
          ctx.fillStyle = gr
          ctx.beginPath()
          ctx.arc(m.x, m.y, glow, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.globalAlpha = alpha
      ctx.fillStyle = lead ? hexA(VOLT_GOLD, 1) : hexA(tokenRgb(ROLE_TOKEN[r.role]), 1)
      ctx.strokeStyle = RIM
      ctx.lineWidth = lw
      // ONE PATH PER ROW; moveTo before each shape keeps the subpaths apart
      ctx.beginPath()
      for (const m of marks) {
        if (r.role === 'coil') {
          // the diamond's points reach the same outer radius as a bubble
          const dd = Math.max(0.5, m.r - lw * 0.7)
          ctx.moveTo(m.x, m.y - dd)
          ctx.lineTo(m.x + dd, m.y)
          ctx.lineTo(m.x, m.y + dd)
          ctx.lineTo(m.x - dd, m.y)
          ctx.closePath()
        } else {
          const rIn = Math.max(0.5, m.r - lw / 2)
          ctx.moveTo(m.x + rIn, m.y)
          ctx.arc(m.x, m.y, rIn, 0, Math.PI * 2)
        }
      }
      ctx.fill()
      if (lw >= 0.4) ctx.stroke()
      if (lead && !quiet) {
        // a small highlight, so the gold reads as a lit bead rather than a flat dot
        ctx.fillStyle = hexA(SHINE, 0.85)
        ctx.beginPath()
        for (const m of marks) {
          const rIn = m.r - lw / 2
          if (rIn < 2) continue
          const hr = rIn * 0.34
          ctx.moveTo(m.x - rIn * 0.3 + hr, m.y - rIn * 0.3)
          ctx.arc(m.x - rIn * 0.3, m.y - rIn * 0.3, hr, 0, Math.PI * 2)
        }
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
    return drew
  }
}

// ── CB EDGE SKIN ─────────────────────────────────────────────────────────────
// The GEX Candles card's classic bubbles (board/gexCandles/bubbles.ts), worn by
// the Path's beads. Same beads, same places, same radii, the Coil still a
// diamond — only the colour words change to CB Edge's:
//
//   ★ Volt = CORE  the ONE GOLD MARK: a lit radial gradient (--color-fg
//                  highlight → --color-gex-lead-hi → --color-gex-lead), a soft
//                  halo, and a ring INSIDE its edge in its side's colour — the
//                  classic leader exactly
//   the others     flat, in the side of spot they sit on: --color-gex-pos above
//                  (the call side — where CB Edge's call wall lives, and the
//                  same blue as the CW tag) and --color-gex-neg below (the put
//                  side, PW's red). A wall that crosses spot changes colour at
//                  that candle, as on CB Walls' CB Edge view. No rim: at bead
//                  size a fill plus an outline is a smudge (the classic peers'
//                  rule)
//
// The ring width is the classic law: 13% of the radius, at least 0.45px, at
// most 1.4px (bubbles.ts ringOfRadius / ringMinPx, the 1m rung's ringPx).

type Mark = { x: number; y: number; t: number; p: number; r: number }

const CB_RING_OF_RADIUS = 0.13
const CB_RING_MIN = 0.45
const CB_RING_MAX = 1.4

function beadPath(ctx: CanvasRenderingContext2D, m: Mark, r: number, diamond: boolean): void {
  if (diamond) {
    ctx.moveTo(m.x, m.y - r)
    ctx.lineTo(m.x + r, m.y)
    ctx.lineTo(m.x, m.y + r)
    ctx.lineTo(m.x - r, m.y)
    ctx.closePath()
  } else {
    ctx.moveTo(m.x + r, m.y)
    ctx.arc(m.x, m.y, r, 0, Math.PI * 2)
  }
}

function paintCbEdge(
  ctx: CanvasRenderingContext2D,
  marks: readonly Mark[],
  role: PathRole,
  lead: boolean,
  quiet: boolean,
  alpha: number,
  spotAt: PathPayload['spotAt'],
): void {
  const pos = tokenRgb('--color-gex-pos')
  const neg = tokenRgb('--color-gex-neg')
  const callSide = (m: Mark) => {
    const s = spotAt?.(m.t)
    return s == null || !Number.isFinite(s) || m.p >= s
  }
  const diamond = role === 'coil'
  if (!lead) {
    // two paths, one per side, so a row is two fills however long it is
    ctx.globalAlpha = alpha
    for (const [side, rgb] of [[true, pos], [false, neg]] as const) {
      ctx.beginPath()
      let any = false
      for (const m of marks) {
        if (callSide(m) !== side) continue
        beadPath(ctx, m, m.r, diamond)
        any = true
      }
      if (!any) continue
      ctx.fillStyle = hexA(rgb, 1)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    return
  }
  const gold = tokenRgb('--color-gex-lead')
  const goldHi = tokenRgb('--color-gex-lead-hi')
  const highlight = tokenRgb('--color-fg')
  for (const m of marks) {
    const sign = callSide(m) ? pos : neg
    if (!quiet) {
      // the classic leader's glow is its SIGN colour, a halo around the mark
      ctx.globalAlpha = 1
      const glow = m.r * 1.6
      const gr = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, glow)
      gr.addColorStop(0, hexA(sign, 0.22))
      gr.addColorStop(1, hexA(sign, 0))
      ctx.fillStyle = gr
      ctx.beginPath()
      ctx.arc(m.x, m.y, glow, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = alpha
    const grad = ctx.createRadialGradient(m.x - m.r * 0.24, m.y - m.r * 0.3, m.r * 0.05, m.x, m.y, m.r)
    grad.addColorStop(0, hexA(highlight, 1))
    grad.addColorStop(0.5, hexA(goldHi, 1))
    grad.addColorStop(1, hexA(gold, 1))
    ctx.fillStyle = grad
    ctx.beginPath()
    beadPath(ctx, m, m.r, diamond)
    ctx.fill()
    // the ring is the sign, drawn inside the edge so the bead keeps its radius
    const ring = Math.max(CB_RING_MIN, Math.min(CB_RING_MAX, m.r * CB_RING_OF_RADIUS))
    ctx.beginPath()
    beadPath(ctx, m, Math.max(0.3, m.r - ring / 2), diamond)
    ctx.lineWidth = ring
    ctx.strokeStyle = hexA(sign, 0.95)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}
