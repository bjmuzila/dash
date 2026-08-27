// ─────────────────────────────────────────────────────────────────────────────
// The GEX bubble layer.
//
// Split in two on purpose:
//
//   buildBubbleModel()  bucketing, selection, magnitude → ratio. Pure, no
//                       pixels, memoised by the card against the inputs that
//                       actually change it.
//   drawBubbles()       ratio → radius → arc. Runs inside the chart's rAF and
//                       does no allocation-heavy work, because the price axis
//                       moves on every pan, zoom and autoscale and this has to
//                       keep up with it.
//
// ── WHAT A BUBBLE MEANS ──────────────────────────────────────────────────────
//
// Per column (one time bucket):
//
//   SELECTION   the strongest `perSide` strikes ABOVE spot and the strongest
//               `perSide` BELOW it, by |net GEX| in that bucket. Three a side
//               by default. Splitting on spot is the point: the top six strikes
//               overall are frequently all on one side, and a picture of only
//               the resistance above you is not a picture of the gamma you are
//               trading inside of.
//
//   THE CORE    the single strongest of the selected strikes. It always draws
//               at the largest radius the column's spacing allows — full size,
//               every bucket, regardless of whether the whole session is quiet
//               or busy. It also takes the hot colour and the glow.
//
//   EVERYTHING  radius = core radius × (its |GEX| ÷ the core's |GEX|). So a
//   ELSE        strike carrying half the core's gamma is half the core's
//               radius, and a bubble's size reads directly as "how much of this
//               column's gamma is here".
//
// That normalisation is PER COLUMN, not across the session. It means every
// bucket has one full-size mark, which is what makes the ladder readable at any
// point in the day — the trade is that you cannot compare 10:00's core against
// 15:00's by size alone. Sizes answer "where is the gamma right now", and the
// answer to "is there more of it than there was" is on the Key Levels tiles.
// ─────────────────────────────────────────────────────────────────────────────

import { BUBBLE_STYLE, type BubbleBucket, type GexMetric } from './settings'
import { valueOf, type GexColumn } from './gexHistory'

export interface BubbleMark {
  strike: number
  value: number
  /** |value| ÷ the column's core, 0..1. This is what sets the radius. */
  ratio: number
  /** True for the column's single strongest strike — the core. */
  isCore: boolean
}

export interface BubbleFrame {
  /** Open time (epoch ms) of the bar this column sits in. */
  barT: number
  /** 0..1 — where inside that bar the column falls. 0 for whole-bar buckets. */
  frac: number
  /** Biggest |value| first, so the smaller marks land on top of the bigger. */
  marks: BubbleMark[]
}

export interface BuildOpts {
  bucket: BubbleBucket
  metric: GexMetric
  /** How many strikes to draw on EACH side of spot. */
  perSide: number
  /** Bar open times, ascending. */
  barTimes: number[]
  /** Chart interval in ms — how wide one bar is in clock time. */
  intervalMs: number
}

/** Index of the last bar at or before `ts`, or -1. Binary search: this runs per column. */
function barIndexAt(barTimes: number[], ts: number): number {
  let lo = 0
  let hi = barTimes.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const at = barTimes[mid]
    if (at === undefined) break
    if (at <= ts) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

export function buildBubbleModel(columns: GexColumn[], opts: BuildOpts): BubbleFrame[] {
  const { bucket, metric, perSide, barTimes, intervalMs } = opts
  if (!columns.length || !barTimes.length || perSide <= 0) return []

  const bucketMs = bucket === 'bar' ? 0 : bucket * 60_000

  // ── 1. Collapse columns into buckets. Last snapshot in a bucket wins — a
  //       bucket is a photograph of the ladder at that moment, not a mean of
  //       it, because a mean of a gamma ladder is not a gamma ladder.
  const byBucket = new Map<number, GexColumn>()
  for (const col of columns) {
    let key: number
    if (bucketMs > 0) {
      key = Math.floor(col.slotTs / bucketMs) * bucketMs
    } else {
      // Whole-bar buckets key on the bar the snapshot falls in. A snapshot from
      // before the first bar we hold has no bar to belong to and is dropped.
      const barT = barTimes[barIndexAt(barTimes, col.slotTs)]
      if (barT === undefined) continue
      key = barT
    }
    const prev = byBucket.get(key)
    if (!prev || col.slotTs >= prev.slotTs) byBucket.set(key, col)
  }

  const frames: BubbleFrame[] = []

  for (const key of [...byBucket.keys()].sort((a, b) => a - b)) {
    const col = byBucket.get(key)
    if (!col) continue

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

    // The core is the strongest of what was picked, and it is the denominator
    // for everything else in this column.
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
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))

    // A tie on |value| would mark two cores. Keep the first — the sort above
    // already put it in front — so exactly one mark per column glows.
    let seenCore = false
    for (const m of marks) {
      if (m.isCore && seenCore) m.isCore = false
      else if (m.isCore) seenCore = true
    }

    const barT = barTimes[barIndexAt(barTimes, key)]
    if (barT === undefined) continue
    const frac = bucketMs > 0 && intervalMs > 0 ? Math.min(0.999, Math.max(0, (key - barT) / intervalMs)) : 0
    frames.push({ barT, frac, marks })
  }

  return frames
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
  /** Pixel x of a bar's centre, or null when it is scrolled off the scale. */
  xOfBar: (barT: number) => number | null
  /** Pixel y of a price, or null. */
  yOfPrice: (price: number) => number | null
  /** Pixel distance between two adjacent bars. */
  barPitch: number
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

/**
 * The radius the column's CORE gets — the largest that keeps different strikes
 * visually apart.
 *
 * VERTICAL IS A HARD BOUND. Two different strikes running into each other is a
 * misread level, so the cap is half the closest gap between the marks actually
 * being drawn, measured in pixels at the current zoom. It is measured, not
 * derived from the ladder's strike step: with three marks a side those strikes
 * are usually tens of strikes apart, and a cap built from the step crushed
 * every bubble to the floor.
 *
 * HORIZONTAL IS A SOFT BOUND. Neighbours left and right are the SAME strike one
 * bucket earlier and later, so letting those merge is not a collision — it is
 * the trail, and it is how a level that has held all session reads as a band.
 * Hence the floor: on a chart zoomed out to where bars are two pixels apart,
 * clamping to half a bar would leave nothing to see.
 */
function capFor(ys: number[], barPitch: number): number {
  let minGap = Infinity
  for (let i = 1; i < ys.length; i++) {
    const hi = ys[i]
    const lo = ys[i - 1]
    if (hi === undefined || lo === undefined) continue
    const gap = hi - lo
    if (gap > 0 && gap < minGap) minGap = gap
  }
  const vertical = Number.isFinite(minGap) ? minGap / 2 - BUBBLE_STYLE.gapPx : BUBBLE_STYLE.maxPx
  const horizontal = Math.max(barPitch / 2 - BUBBLE_STYLE.gapPx, BUBBLE_STYLE.horizFloorPx)
  return Math.max(BUBBLE_STYLE.minPx, Math.min(BUBBLE_STYLE.maxPx, vertical, horizontal))
}

export function drawBubbles(
  ctx: CanvasRenderingContext2D,
  frames: BubbleFrame[],
  geo: BubbleGeometry,
  opts: DrawOpts,
  palette: BubblePalette,
): void {
  const { width: w, height: h, barPitch } = geo
  if (!frames.length || w <= 0 || h <= 0) return

  const layerAlpha = Math.max(0.05, Math.min(1, opts.intensity))
  const minOpacity = Math.max(0.1, 1 - Math.max(0, Math.min(1, BUBBLE_STYLE.fade)))

  for (const frame of frames) {
    const xBar = geo.xOfBar(frame.barT)
    if (xBar == null) continue
    const x = xBar + frame.frac * barPitch
    if (x < -20 || x > w + 20) continue

    // Resolve every mark to a pixel first: the cap is a function of how far
    // apart they landed at THIS zoom, so it cannot be known until they have
    // coordinates.
    //
    // The strike IS the price. Every symbol v3 charts is charted against its
    // own strikes, so there is no basis to add — that conversion existed only
    // for the ES chart, whose axis was futures while its strikes were SPX.
    const placed: Array<{ y: number; value: number; ratio: number; isCore: boolean }> = []
    for (const m of frame.marks) {
      const y = geo.yOfPrice(m.strike)
      if (y == null || y < -20 || y > h + 20) continue
      placed.push({ y, value: m.value, ratio: m.ratio, isCore: m.isCore })
    }
    if (!placed.length) continue

    // `size` at 1.00× means exactly "the core fills its slot and nothing
    // touches". Above 1.00× marks may overlap — the documented trade for
    // bigger marks on a tight chart, not an accident.
    const cap =
      capFor(
        placed.map((p) => p.y).sort((a, b) => a - b),
        barPitch,
      ) * opts.size

    for (const p of placed) {
      // The core has ratio 1, so it draws at exactly `cap` on every curve
      // setting — `curve` only changes how fast the ones BELOW it fall away.
      const shaped = opts.curve <= 1.001 ? p.ratio : Math.pow(p.ratio, opts.curve)
      const r = Math.max(BUBBLE_STYLE.minPx, cap * shaped)
      if (r < 0.12) continue

      const positive = p.value >= 0
      const base = positive ? palette.pos : palette.neg
      const col = p.isCore ? (positive ? palette.posHot : palette.negHot) : base
      const opacity = (p.isCore ? 1 : minOpacity + p.ratio * (1 - minOpacity)) * layerAlpha

      ctx.beginPath()
      ctx.arc(x, p.y, r, 0, Math.PI * 2)
      if (p.isCore) {
        // The glow is what separates the core from "a big strike" at a glance.
        // Drawn with the canvas shadow rather than a cached sprite: exactly one
        // mark per column takes this path, so the sprite atlas v2 needs for a
        // full heatmap would be machinery for nothing here.
        ctx.shadowColor = rgba(base, 0.95)
        ctx.shadowBlur = Math.min(BUBBLE_STYLE.glowMaxPx, Math.max(1.5, r * BUBBLE_STYLE.glowTopFactor))
      }
      ctx.fillStyle = rgba(col, opacity)
      ctx.fill()
      if (p.isCore) {
        ctx.shadowBlur = 0
        ctx.shadowColor = 'transparent'
      }
    }
  }
}
