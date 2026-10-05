// ─────────────────────────────────────────────────────────────────────────────
// VOLTICK PATH — THE PIXELS. Path (bubbles) and Path Ribbon on a Vela chart.
//
// Both draws are Voltick's NodeTrails._draw, the "path" and "pathband"
// branches of web/src/HeatChart.jsx at 2026.10.02.5, transcribed. The only
// changes are the seams:
//
//   lightweight-charts                       Vela renderer layer
//   tsc.timeToCoordinate(tSec)          →    coords.timeToX(tSec * 1000)
//   series.priceToCoordinate(p)         →    coords.priceToY(p, scale, bounds)
//   tsc.options().barSpacing            →    coords.pxPerBar()
//   mediaSize.width                     →    coords.width (the plot, not the axis)
//   hex / rgba literals                 →    tokens.css (--color-vt-*), with the
//                                            alpha applied here
//
// DELIBERATE DIFFERENCES, CB Edge only — Voltick keeps its own; do not carry
// these back:
//   · NO RIBBON TEXT (2026-10-03, Brandon: "for path ribbons, remove the text on
//     the ribbons — for cbedge only"): the Ribbon draws no ▲/▼ "… since 10:45 am"
//     chips. Bands, growth glow and the live dot are Voltick's, unchanged.
//   · THICKER ZOOMED OUT (2026-10-03: "path ribbon and bubbles need more
//     thickness when zoomed out"). Voltick shrinks both as the chart zooms out:
//     a Path bubble follows the bar spacing down below the default bar and then
//     shrinks again when neighbouring strikes crowd (pathGapFit, to 1.8px); a
//     band is capped at 0.42 of the pixel gap between strikes, which on a wide
//     view is a hairline. Here a bubble keeps its default-bar radius at any zoom
//     and crowding takes it down to PATH_FIT_FLOOR at most; a band at its
//     fullest never draws thinner than RIBBON_FULL_FLOOR half-height, and its
//     thinnest never under RIBBON_MIN_FLOOR.
//   · A SIZE SETTING: `size` (the studies' Bubble size % / Ribbon thickness %)
//     multiplies every radius / band height after all of the above.
//   · THE COIL ON THE RIBBON TOO (2026-10-03, "why do ribbons not have any blue
//     or surge/coil"): Voltick's Path Ribbon draws Volt / Surge / Reversal only;
//     here the Coil row is not `pathOnly` (vtPathData.ts), so it bands as well.
//     Like every peer it is cut where it runs onto the Volt's strike — the gold
//     owns that stretch — which is also why a Surge sitting on the Volt's strike
//     shows no blue.
//   · THE LEVELS ARE THE WALLS MIGRATION RENAMED (vtPathData.ts), not Voltick's
//     own recorder — the drawing does not care, the rows have the same shape.
//   · PATH SIZES PER SESSION (2026-10-05): Voltick's pathSizes runs on each
//     session's slice of a row (pathSizesBySession), so a bubble is sized
//     against its level's range on its OWN day. The walls read spans 10 sessions
//     by default, and 0DTE GEX grows ~40× from the open to the close, so one
//     range across all of them drew every morning — today's live candles above
//     all — at the 2px floor: the path looked dead. Voltick's board reads one
//     session, so this is its behaviour; the Ribbon was already per session
//     (ribbonSizeScale).
//
// Each shape is a Vela RENDERER LAYER (registerRendererLayer) owned by the
// native indicator of the same type id (vtPathIndicator.ts), which pushes the
// resolved rows through `ctx.pushData`. The layer repaints on every pan / zoom /
// autoscale frame from those rows; the expensive per-row work (sizes, the
// ribbon's size law and growth facts, which candles a zoomed-out Path keeps) is
// memoised on the rows, exactly as Voltick memoises it, so a pan is a redraw and
// nothing more.
//
// Colours are the level vocabulary — a colour is a word, one owner each:
//   Volt ★ --color-vt-volt (Path: the hotter --color-vt-path-gold bead)
//   Surge ↯ --color-vt-surge · Reversal ↘ --color-vt-reversal · Coil ◆ --color-vt-coil
// ─────────────────────────────────────────────────────────────────────────────

import { registerRendererLayer, type RendererLayerArgs, type RendererLayerInstance } from '@luxalgo/vela/plugin'
import { tokenRgb, type RGB } from '@/design/theme'
import {
  absorbRuns,
  cutAtGold,
  fadeBand,
  goldSpans,
  growthHeat,
  pathGapFit,
  pathGrowthMax,
  pathRadius,
  pathSizes,
  pathZoomRadius,
  PATH_ZOOM,
  ribbonHops,
  ribbonInk,
  ribbonRowFacts,
  ribbonSizeScale,
  RIBBON_GLOW,
  smoothSeries,
  stretchEnd,
  strikeRuns,
  thinPathLanes,
  type BandQ,
  type FillPt,
  type GoldSpan,
  type PathPt,
  type PathRole,
  type RowFacts,
  type ThinRow,
} from './trailruns'
import type { PathRow } from './vtPathData'

export const PATH_TYPE = 'cbedge-vt-path'
export const RIBBON_TYPE = 'cbedge-vt-ribbon'

/** What the indicator pushes to its layer. */
export interface PathPayload {
  rows: PathRow[]
  /** Voltick's Node levels slider, 0..1 (default 0.15). */
  ci: number
  /** Voltick's Calm chart. */
  quiet: boolean
  /** CB Edge: bubble size / band thickness multiplier (1 = default). */
  size: number
}

const ROLE_TOKEN: Record<PathRole, string> = {
  volt: '--color-vt-volt',
  surge: '--color-vt-surge',
  reversal: '--color-vt-reversal',
  coil: '--color-vt-coil',
}

const FLAT_SPAN = 0.03
const REF_MOVE = 1.6

/** CB Edge zoomed-out floors (see the header). */
const PATH_FIT_FLOOR = 0.8
const RIBBON_FULL_FLOOR = 3
const RIBBON_MIN_FLOOR = 1.3

const hb = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
/** A token's channels at an alpha, as `#rrggbbaa` (what every canvas accepts). */
const hexA = (c: RGB, a: number) => `#${hb(c[0])}${hb(c[1])}${hb(c[2])}${hb(Math.max(0, Math.min(1, a)) * 255)}`

// ── New York clock (Voltick nyParts — the ribbon's per-session size law) ────

const NY_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})
function nyParts(ms: number): { day: string; mins: number } {
  const p: Record<string, string> = {}
  for (const x of NY_PARTS.formatToParts(ms)) p[x.type] = x.value
  const h = Number(p.hour) % 24
  return { day: `${p.year}-${p.month}-${p.day}`, mins: h * 60 + Number(p.minute) }
}

/**
 * Voltick's pathSizes, run once PER SESSION (CB Edge; see the header): each
 * bubble is sized against its level's range on its own day, never against the
 * other sessions on the chart. `fill` is time-ordered, so each day's slice comes
 * back in place.
 */
function pathSizesBySession(fill: readonly FillPt[], pts: readonly PathPt[]): number[] {
  // ET midnight always falls on the hour, so one clock read per hour is enough
  const byHour = new Map<number, string>()
  const dayOf = (t: number) => {
    const h = Math.floor(t / 3600)
    let d = byHour.get(h)
    if (d == null) byHour.set(h, (d = nyParts(h * 3_600_000).day))
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
    for (const v of pathSizes(fill.slice(i, j), ptsByDay.get(k) ?? [], FLAT_SPAN)) out.push(v)
    i = j
  }
  return out
}

/** Voltick's boldness curve, pinned at 15% (the shipped default). */
function boldOf(ci: number): { bold: (lo: number, mid: number, hi: number) => number; up: number } {
  const up = Math.max(0, (ci - 0.15) / 0.85)
  const dn = Math.min(1, ci / 0.15)
  return { bold: (lo, mid, hi) => (ci >= 0.15 ? mid + (hi - mid) * up : lo + (mid - lo) * dn), up }
}

interface Geo {
  ctx: CanvasRenderingContext2D
  X: (tSec: number) => number
  Y: (p: number) => number
  width: number
  height: number
  bs: number
}

// ── PATH (bubbles) ───────────────────────────────────────────────────────────

class PathDraw {
  private sizeMemo = new WeakMap<FillPt[], number[]>()
  private thinMemo: { rows: PathRow[]; key: string; kept: Set<string> } | null = null

  draw(g: Geo, d: PathPayload): void {
    const { ctx, X, Y, width } = g
    const rows = d.rows
    const quiet = d.quiet
    const { bold } = boldOf(d.ci)
    const VOLT_GOLD = tokenRgb('--color-vt-path-gold')
    const SHINE = tokenRgb('--color-vt-path-shine')
    const RIM = hexA(tokenRgb('--color-vt-path-rim'), 0.9)
    const bsNow = g.bs || 6
    const size = Number.isFinite(d.size) && d.size > 0 ? d.size : 1
    // CB Edge: below the default bar the radius holds at the default bar's (Voltick follows the zoom down)
    const bsRad = Math.max(bsNow, PATH_ZOOM.refBar)
    const rPeer0 = pathZoomRadius(bsRad, false) * (quiet ? 0.8 : 1)
    const rVolt0 = pathZoomRadius(bsRad, true) * (quiet ? 0.8 : 1)
    const alpha = quiet ? bold(0.3, 0.7, 0.9) : bold(0.4, 0.92, 1)
    // lowest priority first, so the Volt's bead and halo sit on top
    const DRAW_ORDER: Record<PathRole, number> = { surge: 0, coil: 1, reversal: 2, volt: 3 }
    const list = rows
      .filter((r) => Array.isArray(r.fill) && r.fill.length)
      .slice()
      .sort((x, y) => (DRAW_ORDER[x.role] ?? 0) - (DRAW_ORDER[y.role] ?? 0))
    // the pixel gap between the two closest strikes the Path draws on, near the middle of them
    const usedP = [...new Set(list.flatMap((r) => r.fill.map((q) => q.p)))].sort((a, b) => a - b)
    let stepP = Infinity
    for (let i = 1; i < usedP.length; i++) {
      const dd = usedP[i]! - usedP[i - 1]!
      if (dd > 0 && dd < stepP) stepP = dd
    }
    const midP = usedP.length ? usedP[usedP.length >> 1]! : null
    const yA = midP == null ? null : Y(midP)
    const yB = midP == null || !Number.isFinite(stepP) ? null : Y(midP + stepP)
    const fit = pathGapFit(
      yA != null && yB != null && Number.isFinite(yA) && Number.isFinite(yB) ? Math.abs(yB - yA) : Infinity,
      Math.max(rPeer0, rVolt0) * pathGrowthMax(),
      Math.min(rPeer0, rVolt0),
    )
    // CB Edge: crowding shrinks at most to PATH_FIT_FLOOR; then the Size setting
    const rPeer = rPeer0 * Math.max(fit, PATH_FIT_FLOOR) * size
    const rVolt = rVolt0 * Math.max(fit, PATH_FIT_FLOOR) * size
    // the size of every bubble (once per data change), then which candles draw (once per zoom)
    const thin: Array<ThinRow & { ks: number[] }> = []
    for (const r of list) {
      let ks = this.sizeMemo.get(r.fill)
      if (!ks) {
        ks = pathSizesBySession(r.fill, r.pts)
        this.sizeMemo.set(r.fill, ks)
      }
      const rr = r.role === 'volt' ? rVolt : rPeer
      thin.push({ role: r.role, fill: r.fill, rad: rr, ks, r: ks.map((k) => pathRadius(k, rr)) })
    }
    const thinKey = `${bsNow.toFixed(2)}|${rPeer.toFixed(2)}|${rVolt.toFixed(2)}`
    const tm = this.thinMemo
    const kept = tm && tm.rows === rows && tm.key === thinKey ? tm.kept : thinPathLanes(thin, bsNow)
    this.thinMemo = { rows, key: thinKey, kept }
    for (const [ti, r] of list.entries()) {
      const lead = r.role === 'volt'
      const rad = lead ? rVolt : rPeer
      const ks = thin[ti]!.ks
      const marks: Array<{ x: number; y: number; r: number }> = []
      let j = 0
      for (const q of r.fill) {
        const k = ks[j++]
        if (!kept.has(r.role + '|' + q.t)) continue
        const x = X(q.t)
        if (!Number.isFinite(x) || x < -20 || x > width + 20) continue
        const y = Y(q.p)
        if (!Number.isFinite(y)) continue
        marks.push({ x, y, r: pathRadius(k, rad) })
      }
      if (!marks.length) continue
      if (lead && !quiet) {
        ctx.globalAlpha = 1
        for (const m of marks) {
          // capped at the tuned size, so a big reading grows its bead and not the glow around it
          const glow = Math.min(m.r, rad) * 1.9
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
      ctx.lineWidth = 1.1
      // ONE PATH PER ROW; moveTo before each shape keeps the subpaths apart
      ctx.beginPath()
      for (const m of marks) {
        if (r.role === 'coil') {
          const dd = m.r * 1.25
          ctx.moveTo(m.x, m.y - dd)
          ctx.lineTo(m.x + dd, m.y)
          ctx.lineTo(m.x, m.y + dd)
          ctx.lineTo(m.x - dd, m.y)
          ctx.closePath()
        } else {
          ctx.moveTo(m.x + m.r, m.y)
          ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2)
        }
      }
      ctx.fill()
      ctx.stroke()
      if (lead && !quiet) {
        // a small highlight, so the gold reads as a lit bead rather than a flat dot
        ctx.fillStyle = hexA(SHINE, 0.85)
        ctx.beginPath()
        for (const m of marks) {
          const hr = m.r * 0.34
          ctx.moveTo(m.x - m.r * 0.3 + hr, m.y - m.r * 0.3)
          ctx.arc(m.x - m.r * 0.3, m.y - m.r * 0.3, hr, 0, Math.PI * 2)
        }
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
  }
}

// ── PATH RIBBON ──────────────────────────────────────────────────────────────

interface Band {
  r: PathRow
  runs: BandQ[][]
  amp: number
  holeSec: number
  F: RowFacts | undefined
}

class RibbonDraw {
  private scales = new WeakMap<PathRow[], ReturnType<typeof ribbonSizeScale>>()
  private factsOf = new WeakMap<PathRow[], Map<PathRow, RowFacts>>()

  draw(g: Geo, d: PathPayload): void {
    const { ctx, X, Y, width } = g
    const rows = d.rows
    const quiet = d.quiet
    const { bold, up } = boldOf(d.ci)
    const bs = Math.max(2, g.bs || 6)
    const rxConst = Math.max(1.4, bs * 0.51)
    const ryConst = Math.min(12, Math.max(1.9, rxConst * 1.15))
    const DWELL = 3
    const SMOOTH = 3
    const TAPER_BARS = 4
    const WEIGHT = 0.8
    const FILL = 0.72
    const EDGE = 1.15
    const B2_OV = 1.2
    const B2_BANK_LEAD = 0.6
    const hMin = (quiet ? 0.5 : 0.6) * WEIGHT
    const hMax =
      (quiet ? Math.min(7, Math.max(3.5, ryConst * 0.6)) : Math.min(15, Math.max(6, ryConst * 1.15))) * WEIGHT
    const half = Math.max(0.5, bs / 2)
    let ribbonScale = this.scales.get(rows)
    if (!ribbonScale) {
      ribbonScale = ribbonSizeScale(rows, (tSec) => nyParts(tSec * 1000), undefined, RIBBON_GLOW)
      this.scales.set(rows, ribbonScale)
    }
    const { sizeK } = ribbonScale
    let facts = this.factsOf.get(rows)
    if (!facts) {
      facts = new Map(
        rows.filter((r) => !r.pathOnly).map((r) => [r, ribbonRowFacts(r.pts, sizeK, { dwell: DWELL, smooth: SMOOTH })]),
      )
      this.factsOf.set(rows, facts)
    }
    let nowT = -Infinity
    for (const r of rows) if (!r.pathOnly && r.pts.length) nowT = Math.max(nowT, r.pts[r.pts.length - 1]!.t)
    let pxPerStrike = Infinity
    {
      const ks = [...new Set(rows.filter((r) => !r.pathOnly).flatMap((r) => r.pts.map((p) => p.p)))].sort((a, b) => a - b)
      for (let j = 1; j < ks.length; j++) {
        const ya = Y(ks[j]!)
        const yb = Y(ks[j - 1]!)
        const dd = Number.isFinite(ya) && Number.isFinite(yb) ? Math.abs(ya - yb) : NaN
        if (dd > 0 && dd < pxPerStrike) pxPerStrike = dd
      }
    }
    // CB Edge: the strike-gap cap never takes a full band under RIBBON_FULL_FLOOR,
    // the thinnest band never under RIBBON_MIN_FLOOR, then the Thickness setting.
    const size = Number.isFinite(d.size) && d.size > 0 ? d.size : 1
    const hMaxB2 =
      (Number.isFinite(pxPerStrike) ? Math.max(hMin, Math.min(hMax, Math.max(RIBBON_FULL_FLOOR, 0.42 * pxPerStrike))) : hMax) *
      size
    const hMinS = Math.max(hMin, RIBBON_MIN_FLOOR) * size
    const hOf = (k: number) => hMinS + (hMaxB2 - hMinS) * k
    const bands: Band[] = []
    let voltSpans: GoldSpan[] | null = null
    for (const r of rows.slice().sort((a, b) => (a.lead ? 1 : 0) - (b.lead ? 1 : 0))) {
      if (r.pathOnly) continue
      let plo = Infinity
      let phi = 0
      for (const p of r.pts) {
        const v = p.v
        if (v != null && Number.isFinite(v) && v > 0) {
          if (v < plo) plo = v
          if (v > phi) phi = v
        }
      }
      const sized = phi > 0 && plo < Infinity
      const pMoved = sized && (phi - plo) / phi >= FLAT_SPAN
      const amp = pMoved ? Math.min(1, Math.max(0, Math.log(phi / Math.max(plo, phi * 0.02)) / Math.log(REF_MOVE))) : 0
      const heat = growthHeat(r.pts.map((p) => p.v))
      const keep: BandQ[] = []
      for (let pi = 0; pi < r.pts.length; pi++) {
        const p = r.pts[pi]!
        const x = X(p.t)
        if (!Number.isFinite(x) || x < -20 || x > width + 20) continue
        const y = Y(p.p)
        if (!Number.isFinite(y)) continue
        const kB2 = sizeK(p)
        keep.push({
          x,
          y,
          p: p.p,
          t: p.t,
          i: keep.length,
          lit: heat[pi] || 0,
          v: p.v,
          k: Number.isFinite(kB2) ? Math.min(1, Math.max(0, kB2)) : 0.5,
          h: 0,
          g: 1,
        })
      }
      if (!keep.length) continue
      const gaps: number[] = []
      for (let j = 1; j < keep.length; j++) gaps.push(keep[j]!.t - keep[j - 1]!.t)
      gaps.sort((a, b) => a - b)
      const holeSec = Math.max(20 * 60, 4 * (gaps.length ? gaps[gaps.length >> 1]! : 0))
      const runs: BandQ[][] = []
      let chunk: BandQ[] = []
      for (const q of keep) {
        if (chunk.length && q.t - chunk[chunk.length - 1]!.t > holeSec) {
          runs.push(...absorbRuns(strikeRuns(chunk), DWELL))
          chunk = []
        }
        chunk.push(q)
      }
      if (chunk.length) runs.push(...absorbRuns(strikeRuns(chunk), DWELL))
      const F = facts.get(r)
      for (const run of runs) {
        const ks = smoothSeries(
          run.map((q) => q.k),
          SMOOTH,
        )
        run.forEach((q, j) => {
          q.h = hOf(ks[j]!)
          q.g = F?.g.get(q.t) ?? 1
        })
      }
      bands.push({ r, runs, amp, holeSec, F })
      if (r.lead) voltSpans = goldSpans(runs, holeSec, half)
    }
    const OV = B2_OV * bs
    const edgeOf = (S: Array<{ x: number; top: number; bot: number }>, key: 'top' | 'bot') => {
      ctx.beginPath()
      S.forEach((q, j) => (j ? ctx.lineTo(q.x, q[key]) : ctx.moveTo(q.x, q[key])))
      ctx.stroke()
    }
    const dots: Array<{ x: number; y: number; rgb: RGB }> = []
    for (const { r, runs: whole, amp, holeSec } of bands) {
      const cut = r.lead
        ? { runs: whole, toGold: null as Map<BandQ[], number> | null, fromGold: null as Map<BandQ, number> | null }
        : cutAtGold(whole, voltSpans, holeSec)
      const { runs, toGold, fromGold } = cut
      const fillA = Math.min(0.55, bold(0.05, 0.213, 0.5) + 0.12 * amp) * FILL * (quiet ? 0.6 : 1)
      const rgb = tokenRgb(ROLE_TOKEN[r.role])
      const tail = runs[runs.length - 1]
      const lastQ = tail?.[tail.length - 1]
      const rowLast = r.pts[r.pts.length - 1]
      const dotQ = lastQ && rowLast && lastQ.t === rowLast.t && nowT - lastQ.t <= RIBBON_GLOW.dotWithinSec ? lastQ : null
      if (dotQ) dots.push({ x: dotQ.x, y: dotQ.y, rgb })
      for (let ri = 0; ri < runs.length; ri++) {
        const run = runs[ri]!
        const { hopIn, hopOut } = ribbonHops(runs, ri, holeSec)
        const goldIn = !hopIn && !!fromGold?.has(run[0]!)
        const goldOut = !hopOut && !!toGold?.has(run)
        const band = fadeBand(run, {
          half,
          ov: OV,
          hopIn: hopIn || goldIn,
          hopOut: hopOut || goldOut,
          xStart: goldIn ? undefined : fromGold?.get(run[0]!),
          xEnd: hopOut || goldOut ? undefined : stretchEnd(runs, ri, holeSec, half, toGold, r.lead ? null : voltSpans),
          taperPx: TAPER_BARS * bs,
        })
        if (!band) continue
        const { S, x0, x1, last } = band
        const L = Math.max(1e-6, x1 - x0)
        ctx.beginPath()
        S.forEach((q, j) => (j ? ctx.lineTo(q.x, q.top) : ctx.moveTo(q.x, q.top)))
        for (let j = S.length - 1; j >= 0; j--) ctx.lineTo(S[j]!.x, S[j]!.bot)
        ctx.closePath()
        const bankA = quiet
          ? Math.min(0.9, bold(0.1, 0.33, 0.7) + 0.2 * last.lit)
          : Math.min(1, (bold(0.12, 0.4575, 0.95) + 0.3 * last.lit) * EDGE)
        const gF = ctx.createLinearGradient(x0, 0, x1, 0)
        const gB = ctx.createLinearGradient(x0, 0, x1, 0)
        for (const q of S) {
          const u = Math.min(1, Math.max(0, (q.x - x0) / L))
          const ink = ribbonInk(nowT - q.q.t)
          const gg = Number.isFinite(q.q.g) ? q.q.g : 1
          gF.addColorStop(u, hexA(rgb, Math.min(RIBBON_GLOW.ceiling, fillA * q.w * ink.fill * gg)))
          gB.addColorStop(u, hexA(rgb, Math.min(1, bankA * Math.pow(q.w, 1 + 3 * B2_BANK_LEAD) * ink.bank * Math.sqrt(gg))))
        }
        // (Voltick places a ▲/▼ "since" chip here — left out on CB Edge, see the header.)
        ctx.globalAlpha = 1
        ctx.fillStyle = gF
        ctx.fill()
        ctx.strokeStyle = gB
        ctx.lineWidth = 1 + up
        edgeOf(S, 'top')
        edgeOf(S, 'bot')
      }
    }
    const rim = hexA(tokenRgb('--color-vt-path-rim'), 0.9)
    ctx.globalAlpha = 1
    for (const dt of dots) {
      ctx.beginPath()
      ctx.arc(dt.x, dt.y, 5.5, 0, Math.PI * 2)
      ctx.fillStyle = hexA(dt.rgb, 0.25)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(dt.x, dt.y, 3, 0, Math.PI * 2)
      ctx.fillStyle = hexA(dt.rgb, 1)
      ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = rim
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }
}

// ── The layer ────────────────────────────────────────────────────────────────

function isPayload(v: unknown): v is PathPayload {
  return !!v && typeof v === 'object' && Array.isArray((v as PathPayload).rows)
}

class VtPathLayer implements RendererLayerInstance {
  private canvas: HTMLCanvasElement | null = null
  private readonly painter: PathDraw | RibbonDraw

  constructor(shape: 'path' | 'ribbon') {
    this.painter = shape === 'path' ? new PathDraw() : new RibbonDraw()
  }

  mount(canvas: HTMLCanvasElement): void {
    this.canvas = canvas
  }

  render(args: RendererLayerArgs): void {
    const canvas = this.canvas
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const d = args.data
    if (!isPayload(d) || !d.rows.length) return
    const ci = Math.min(1, Math.max(0, d.ci))
    if (ci <= 0.01) return // the slider at 0 hides the shape, as in Voltick
    // NOTHING TO PLACE AGAINST, NOTHING DRAWN (2026-10-05). While the chart loads
    // — first paint, a symbol or timeframe switch — Vela has no bars yet but the
    // layer still holds the last rows, and with no bars every time maps to logical
    // 0: the whole Path drew as one tall column of bubbles at a single x over the
    // loading dots. So: no bars, no Path; and only points inside the bars' span
    // (a bar either side) are placed, so rows left over from the previous view
    // never land on a pile at the edge.
    const bars = args.bars
    if (!bars.length) return
    const { coords, scale, bounds } = args
    const iv = coords.barInterval > 0 ? coords.barInterval : bars.length > 1 ? bars[1]!.time - bars[0]!.time : 60_000
    const tLo = (bars[0]!.time - iv) / 1000
    const tHi = (bars[bars.length - 1]!.time + iv) / 1000
    const dpr = coords.dpr || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.save()
    // the plot only — never over the price axis or a neighbouring pane
    ctx.beginPath()
    ctx.rect(0, bounds.top, coords.width, bounds.height)
    ctx.clip()
    this.painter.draw(
      {
        ctx,
        X: (tSec) => (tSec >= tLo && tSec <= tHi ? coords.timeToX(tSec * 1000) : Number.NaN),
        Y: (p) => coords.priceToY(p, scale, bounds),
        width: coords.width,
        height: bounds.top + bounds.height,
        bs: coords.pxPerBar(),
      },
      { ...d, ci },
    )
    ctx.restore()
  }

  destroy(): void {
    this.canvas = null
  }
}

let registered = false

/** Both layers. Before any workspace is built — a renderer picks layers up at mount. */
export function registerVtPathLayers(): void {
  if (registered) return
  registered = true
  registerRendererLayer({ id: PATH_TYPE, placement: 'above-data', create: () => new VtPathLayer('path') })
  registerRendererLayer({ id: RIBBON_TYPE, placement: 'above-data', create: () => new VtPathLayer('ribbon') })
}
