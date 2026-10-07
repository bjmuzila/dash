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
      const last = r.fill.length - 1
      for (let i = 0; i < r.fill.length; i++) {
        const q = r.fill[i]!
        // THE LIVE EDGE ALWAYS DRAWS (2026-10-07, Brandon: "path isn't going for
        // spx"). Zoomed out, beads sit on every Nth bar of a fixed clock grid, so
        // the first minutes of a session — or the newest candle between two grid
        // bars — showed no bead at all, and the Path looked stalled. The row's
        // newest reading is drawn whatever the grid says; the grid bead just
        // before it gives way if the two would overlap.
        const edge = i === last
        if (!edge && N > 1 && Math.round(q.t / barSec) % N !== 0) continue
        const x = X(q.t)
        if (!Number.isFinite(x) || x < -20 || x > width + 20) continue
        const y = Y(q.p)
        if (!Number.isFinite(y)) continue
        const m = { x, y, t: q.t, p: q.p, r: Math.max(BEAD.beadMinPx, rad * growFactor(grow[i])) }
        if (edge && N > 1) {
          const prev = marks[marks.length - 1]
          if (prev && prev.p === m.p && Math.abs(prev.x - m.x) < prev.r + m.r) marks.pop()
        }
        marks.push(m)
      }
      if (!marks.length) continue
      drew = true
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
