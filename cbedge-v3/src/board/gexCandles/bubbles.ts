// ─────────────────────────────────────────────────────────────────────────────
// The GEX bubble layer.
//
// Split in two on purpose:
//
//   buildBubbleModel()  selection and magnitude. Pure, no pixels, no notion of
//                       bars or timeframe at all.
//   drawBubbles()       pixels. Runs inside the chart's rAF, because the axes
//                       move on every pan, zoom and autoscale.
//
// ── EVERYTHING IS CALIBRATED IN PIXELS, NEVER IN BARS ────────────────────────
//
// This layer used to place one bubble per BAR (or per fixed clock bucket). That
// is a trap: 1m has five times the bars of 5m over the same session, so the
// same settings drew a dotted line on 5m and a solid neon slab on 1m, and the
// only fix available was a per-timeframe fudge factor.
//
// So: a strike's row is stamped every STEP_PX CSS pixels, from the pixel where
// its history starts to the pixel where it ends. Switching timeframe changes
// `timeToX` and nothing else — the same 6px cadence produces the same band at
// 1m, 5m, 15m and 1h, and zooming just fills the wider gap with more stamps at
// the same thickness. No timeframe is passed in, because nothing here needs to
// know one.
//
// The GEX behind each stamp is looked up by TIME, so the band still carries the
// session's history — a wall that built through the afternoon still visibly
// grows. A single radius smeared across the whole row would be a picture of
// right now wearing the shape of a picture of the day.
//
// ── WHAT A BUBBLE MEANS ──────────────────────────────────────────────────────
//
// Per snapshot:
//
//   SELECTION   the strongest `perSide` strikes ABOVE spot and the strongest
//               `perSide` BELOW it. Splitting on spot is the point: the top
//               strikes overall are frequently all on one side, and a picture
//               of only the resistance above you is not a picture of the gamma
//               you are trading inside of.
//
//   THE CORE    the strongest of them. Always draws at the largest radius the
//               spacing allows, so it is findable at a glance whether the whole
//               session is quiet or busy. Takes the hot colour and the glow.
//
//   EVERYTHING  radius = core radius × (its |GEX| ÷ the core's |GEX|). Linear,
//   ELSE        so size reads directly as "how much of this snapshot's gamma is
//               here". Anything under DUST of the core is dropped rather than
//               drawn as a speck.
// ─────────────────────────────────────────────────────────────────────────────

import { BUBBLE_STYLE, type GexMetric } from './settings'
import { valueOf, type GexColumn } from './gexHistory'

/** One stamp every this many CSS pixels along x. The whole TF-invariance. */
const STEP_PX = 6

/** Below this share of the core, a strike is dust and is not drawn. */
const DUST = 0.04

export interface BubbleMark {
  strike: number
  value: number
  /** |value| ÷ the snapshot's core, 0..1. This is what sets the radius. */
  ratio: number
  /** True for the snapshot's single strongest strike. */
  isCore: boolean
}

export interface BubbleSnapshot {
  /** Epoch ms of the snapshot. */
  ts: number
  /** Biggest |value| first, so smaller marks land on top of bigger ones. */
  marks: BubbleMark[]
}

export interface BuildOpts {
  metric: GexMetric
  /** How many strikes to keep on EACH side of spot. */
  perSide: number
}

/**
 * Note what is NOT in BuildOpts: no bar times, no interval, no bucket. The
 * model is a function of the GEX history alone, so it survives a candle refresh
 * and a timeframe change without being rebuilt.
 */
export function buildBubbleModel(columns: GexColumn[], opts: BuildOpts): BubbleSnapshot[] {
  const { metric, perSide } = opts
  if (!columns.length || perSide <= 0) return []

  const out: BubbleSnapshot[] = []

  for (const col of columns) {
    // Spot decides which side a strike is on. The history route sends it per
    // snapshot; legacy rows carry 0, and the midpoint of the ladder is the
    // honest fallback — the recorder centres the ladder on spot, so the middle
    // of it is where spot was.
    let spot = col.spot
    if (!(spot > 0)) {
      let lo = Infinity
      let hi = -Infinity
      for (const c of col.cells) {
        if (c.strike < lo) lo = c.strike
        if (c.strike > hi) hi = c.strike
      }
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue
      spot = (lo + hi) / 2
    }

    const above: Array<{ strike: number; value: number }> = []
    const below: Array<{ strike: number; value: number }> = []
    for (const cell of col.cells) {
      const value = valueOf(cell, metric)
      if (value === 0) continue
      ;(cell.strike >= spot ? above : below).push({ strike: cell.strike, value })
    }

    const strongest = (list: Array<{ strike: number; value: number }>) =>
      list.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, perSide)

    const picked = [...strongest(above), ...strongest(below)]
    if (!picked.length) continue

    let core = 0
    for (const p of picked) core = Math.max(core, Math.abs(p.value))
    if (core <= 0) continue

    const marks: BubbleMark[] = picked
      .map((p) => ({
        strike: p.strike,
        value: p.value,
        ratio: Math.min(1, Math.abs(p.value) / core),
        isCore: Math.abs(p.value) === core,
      }))
      // The relative cutoff replaces every per-timeframe "minimum GEX" input
      // there has ever been: it is a share of the core, so it means the same
      // thing on a quiet morning and a busy afternoon.
      .filter((m) => m.ratio >= DUST)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))

    if (!marks.length) continue

    // A tie on |value| would mark two cores. Keep the first — the sort above
    // already put it in front — so exactly one mark per snapshot glows.
    let seenCore = false
    for (const m of marks) {
      if (m.isCore && seenCore) m.isCore = false
      else if (m.isCore) seenCore = true
    }

    out.push({ ts: col.slotTs, marks })
  }

  out.sort((a, b) => a.ts - b.ts)
  return out
}

// ── Drawing ──────────────────────────────────────────────────────────────────

export interface BubblePalette {
  /** [r,g,b] for a positive-gamma mark, and its hot variant for the core. */
  pos: [number, number, number]
  posHot: [number, number, number]
  neg: [number, number, number]
  negHot: [number, number, number]
}

export interface BubbleGeometry {
  /** Pixel x of an instant, or null when it is off the scale. */
  xOfTime: (ms: number) => number | null
  /** The instant at a pixel x — the inverse of xOfTime. null off the scale. */
  timeAtX: (x: number) => number | null
  /** Pixel y of a price, or null. */
  yOfPrice: (price: number) => number | null
  /** CSS pixels. The context is already scaled by devicePixelRatio. */
  width: number
  height: number
}

export interface DrawOpts {
  size: number
  curve: number
  intensity: number
}

function rgba(c: [number, number, number], a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`
}

/** Index of the snapshot nearest `ts`. Binary search — this runs per x step. */
function nearestIndex(snaps: BubbleSnapshot[], ts: number): number {
  let lo = 0
  let hi = snaps.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const at = snaps[mid]
    if (!at) break
    if (at.ts < ts) lo = mid + 1
    else hi = mid
  }
  const cur = snaps[lo]
  const prev = snaps[lo - 1]
  if (cur && prev && Math.abs(prev.ts - ts) <= Math.abs(cur.ts - ts)) return lo - 1
  return lo
}

/**
 * The radius the snapshot's CORE gets.
 *
 * VERTICAL SPACING IS THE BOUND, and it is measured from the marks actually
 * being drawn, at the current zoom — not from the ladder's strike step, which
 * with three marks a side is tens of strikes away from the real gap.
 *
 * There is deliberately NO horizontal bound. A mark's left and right
 * neighbours are the same strike a few pixels earlier and later; those merging
 * is not a collision, it is the band. That is the whole reason the layer can
 * step in pixels.
 *
 * The chart's height is the second term. Spacing alone would let six marks on a
 * tall, sparse pane grow until the ladder was mostly circle; a fraction of the
 * pane height keeps the band proportionate to the chart it is drawn on, at
 * every window size, without anyone tuning a pixel number per layout.
 */
function capFor(ys: number[], height: number): number {
  let minGap = Infinity
  for (let i = 1; i < ys.length; i++) {
    const hi = ys[i]
    const lo = ys[i - 1]
    if (hi === undefined || lo === undefined) continue
    const gap = hi - lo
    if (gap > 0 && gap < minGap) minGap = gap
  }
  const spacing = Number.isFinite(minGap) ? minGap / 2 - BUBBLE_STYLE.gapPx : Infinity
  return Math.max(BUBBLE_STYLE.minPx, Math.min(spacing, height * BUBBLE_STYLE.heightFrac))
}

export function drawBubbles(
  ctx: CanvasRenderingContext2D,
  snaps: BubbleSnapshot[],
  geo: BubbleGeometry,
  opts: DrawOpts,
  palette: BubblePalette,
): void {
  const { width: w, height: h } = geo
  if (!snaps.length || w <= 0 || h <= 0) return

  const first = snaps[0]
  const last = snaps[snaps.length - 1]
  if (!first || !last) return

  // Extent comes from the DATA's own time range, clamped to the pane — not from
  // a lookback in bars. This is why the band starts where the session's gamma
  // history starts on every timeframe, with nothing to configure.
  const xFirst = geo.xOfTime(first.ts)
  const xLast = geo.xOfTime(last.ts)
  if (xFirst == null || xLast == null) return
  const x0 = Math.max(0, Math.min(xFirst, xLast))
  const x1 = Math.min(w, Math.max(xFirst, xLast))
  if (x1 < x0) return

  const layerAlpha = Math.max(0.05, Math.min(1, opts.intensity))
  const minOpacity = Math.max(0.1, 1 - Math.max(0, Math.min(1, BUBBLE_STYLE.fade)))

  // One cap per snapshot, not per stamp: the same snapshot is hit by many x
  // steps and its geometry does not change between them.
  const capBySnap = new Map<number, number>()

  for (let x = x0; x <= x1; x += STEP_PX) {
    const t = geo.timeAtX(x)
    if (t == null) continue
    const idx = nearestIndex(snaps, t)
    const snap = snaps[idx]
    if (!snap) continue

    let placed = capBySnap.get(idx)
    if (placed === undefined) {
      const ys: number[] = []
      for (const m of snap.marks) {
        const y = geo.yOfPrice(m.strike)
        if (y != null) ys.push(y)
      }
      placed = capFor(ys.sort((a, b) => a - b), h)
      capBySnap.set(idx, placed)
    }
    const cap = placed * opts.size

    for (const m of snap.marks) {
      const y = geo.yOfPrice(m.strike)
      if (y == null || y < -20 || y > h + 20) continue

      // The core has ratio 1, so it draws at exactly `cap` on every curve
      // setting — `curve` only changes how fast the ones BELOW it fall away.
      const shaped = opts.curve <= 1.001 ? m.ratio : Math.pow(m.ratio, opts.curve)
      const r = Math.max(BUBBLE_STYLE.minPx, cap * shaped)

      const positive = m.value >= 0
      const base = positive ? palette.pos : palette.neg
      const col = m.isCore ? (positive ? palette.posHot : palette.negHot) : base
      const opacity = (m.isCore ? 1 : minOpacity + m.ratio * (1 - minOpacity)) * layerAlpha

      ctx.beginPath()
      // Plain CSS pixels: the caller has already applied a devicePixelRatio
      // transform to the context, so multiplying by dpr here would scale it
      // twice and make a retina panel draw a band twice as fat as a normal one.
      ctx.arc(x, y, r, 0, Math.PI * 2)
      if (m.isCore) {
        ctx.shadowColor = rgba(base, 0.95)
        ctx.shadowBlur = Math.min(BUBBLE_STYLE.glowMaxPx, Math.max(1.5, r * BUBBLE_STYLE.glowTopFactor))
      }
      ctx.fillStyle = rgba(col, opacity)
      ctx.fill()
      if (m.isCore) {
        ctx.shadowBlur = 0
        ctx.shadowColor = 'transparent'
      }
    }
  }
}
