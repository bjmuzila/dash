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
//     view is a hairline. (Path: superseded by ZOOM-PROOF BUBBLES below.) A
//     band at its fullest never draws thinner than RIBBON_FULL_FLOOR half-height, and its
//     thinnest never under RIBBON_MIN_FLOOR.
//   · A SIZE SETTING: `size` (the studies' Bubble size % / Ribbon thickness %)
//     multiplies every radius / band height after all of the above.
//   · AN OPACITY SETTING (2026-10-09, Brandon: "the voltick path needs a
//     transparency filter in the settings"): `opacity` (the studies' Opacity %)
//     fades everything the layer drew in one step once the frame is painted —
//     every pixel's alpha times the setting (destination-in), so overlaps fade
//     evenly and no colour or size rule above changes. The canvas is this
//     layer's own, so nothing else on the chart is touched, and the faded pixels
//     are what a chart screenshot copies.
//   · THE COIL ON THE RIBBON TOO (2026-10-03, "why do ribbons not have any blue
//     or surge/coil"): Voltick's Path Ribbon draws Volt / Surge / Reversal only;
//     here the Coil row is not `pathOnly` (vtPathData.ts), so it bands as well.
//     Like every peer it is cut where it runs onto the Volt's strike — the gold
//     owns that stretch — which is also why a Surge sitting on the Volt's strike
//     shows no blue.
//   · THE LEVELS ARE THE WALLS MIGRATION RENAMED (vtPathData.ts), not Voltick's
//     own recorder — the drawing does not care, the rows have the same shape.
//   · ZOOM-PROOF BUBBLES (2026-10-06, Brandon: "zoom proof with minimal overlap
//     … all bubbles change size and no random gaps"). This REPLACES, for the
//     Path only, the THICKER ZOOMED OUT rule above and the 2026-10-05 per-session
//     sizing: Voltick sizes each bubble by its reading and then thins crowded
//     candles (thinPathLanes, which keeps run starts/ends and drops others), which
//     drew overlapping coins and uneven holes. Here there is ONE radius for the
//     whole chart, taken from the bar pitch, shrunk to fit neighbouring strikes,
//     floored at BEAD.minPx (4.5px; zoomed out, beads move to every Nth bar and
//     grow to fill that pitch rather than shrink to dots); zoomed in they keep
//     following the bar (BEAD.voltMax is only a 30px sanity cap — the 7px cap and
//     its joining line were dropped 2026-10-06: "the actual bubbles' borders to
//     almost connect … remove the line"), so every bubble grows and shrinks together and
//     neighbours never overlap. ALMOST CONNECTED AT ANY ZOOM (2026-10-06: "zoomed
//     way in there's a lot of space in between … should stay almost connected no
//     matter the zoom … a little give or take"): a bead is 94% of a bar wide
//     zoomed out, easing to 90% zoomed in (BEAD.pitchTight → pitchLoose), and
//     only an extreme zoom meets the BEAD.voltMax sanity cap; peers are 90% of
//     the Volt so their rows read joined as well.
//     GROWTH INSIDE THOSE BOUNDS (2026-10-06, "if GEX is increasing on the Volt I
//     want it noticeable in the bubbles increasing"): the radius above is the FULL
//     bead, a level's highest reading that session; each bead is drawn at 62–100%
//     of it by where its (smoothed) reading sits between that day's low and high,
//     so growing GEX swells the row visibly while no bead ever outgrows its bar
//     or the zoom bounds (growthBySession, BEAD.grow*).
//     Only when the floor or the Size setting makes a bead wider than its bar are
//     candles skipped, and then on one fixed every-Nth-bar grid shared by every
//     level, so the spacing stays even. The Volt stays a size up (BEAD.peer).
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
  ribbonHops,
  ribbonInk,
  ribbonRowFacts,
  ribbonSizeScale,
  RIBBON_GLOW,
  smoothSeries,
  stretchEnd,
  strikeRuns,
  type BandQ,
  type GoldSpan,
  type RowFacts,
} from './trailruns'
import type { PathRow } from './vtPathData'
// The Path's beads and the helpers the Ribbon shares with them (pathDraw.ts —
// Vela-free, so the home board's GEX Candles card paints the same beads).
import { FLAT_SPAN, PathDraw, REF_MOVE, ROLE_TOKEN, boldOf, hexA, type Geo, type PathPayload } from './pathDraw'

export type { PathPayload }

/** What the studies push: the Path's payload, plus CB Edge's Opacity % (0.1..1; absent = 1). */
export interface VtPathPayload extends PathPayload {
  opacity?: number
}

export const PATH_TYPE = 'cbedge-vt-path'
export const RIBBON_TYPE = 'cbedge-vt-ribbon'

/** CB Edge zoomed-out floors (see the header). */
const RIBBON_FULL_FLOOR = 3
const RIBBON_MIN_FLOOR = 1.3
/** A bar this long or longer is a D / W / M bar: nothing is drawn on it. */
const DAILY_MS = 86_400_000

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

function isPayload(v: unknown): v is VtPathPayload {
  return !!v && typeof v === 'object' && Array.isArray((v as VtPathPayload).rows)
}

/** The bars' open times in seconds, once per bars array (a pan repaints with the same one). */
const barTimesMemo = new WeakMap<readonly { time: number }[], number[]>()
function barTimesOf(bars: readonly { time: number }[]): number[] {
  let t = barTimesMemo.get(bars)
  if (!t) barTimesMemo.set(bars, (t = bars.map((b) => b.time / 1000)))
  return t
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
    // NOT ON D / W / M (2026-10-07, Brandon: "path, ribbons … shouldn't be seen at
    // 1d or above"). The study pushes nothing there (vtPathIndicator.ts); this
    // catches the frames between a timeframe switch and that push.
    if (coords.barInterval >= DAILY_MS) return
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
        barSec: iv / 1000,
        // beads sit on these candles, one per level per candle (pathDraw.ts, ON THE CANDLES)
        barTimes: barTimesOf(bars),
      },
      { ...d, ci },
    )
    ctx.restore()
    // Opacity %: every pixel just drawn keeps (its alpha × opacity). Only alpha
    // counts under destination-in, so the fill's colour is any opaque token.
    const opacity = typeof d.opacity === 'number' && Number.isFinite(d.opacity) ? Math.min(1, Math.max(0.1, d.opacity)) : 1
    if (opacity < 0.999) {
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalCompositeOperation = 'destination-in'
      ctx.globalAlpha = opacity
      ctx.fillStyle = hexA(tokenRgb('--color-fg'), 1)
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.restore()
    }
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
