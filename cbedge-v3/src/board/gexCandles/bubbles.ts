// ─────────────────────────────────────────────────────────────────────────────
// The GEX bubble layer.
//
// Split in two on purpose:
//
//   buildBubbleModel()  bucketing, session ranking, magnitude → ratio.
//                       Pure, no pixels, memoised by the card against the
//                       inputs that actually change it.
//   drawBubbles()       ratio → radius → arc. Runs inside the chart's rAF and
//                       does no allocation-heavy work, because the price axis
//                       moves on every pan, zoom and autoscale and this has to
//                       keep up with it.
//
// THE SIZE LAW, carried over from v2 verbatim because it is the whole feel of
// the thing: radius is a function of |net GEX| ONLY. Being the session's
// biggest wall changes a bubble's COLOUR and gives it a glow; it never changes
// its size. Two strikes with the same gamma are the same mark whether or not
// one of them happens to be ranked first, which is what makes the ladder
// readable as a ladder instead of as a ranking.
//
// The reference a ratio is measured against is the running session peak with a
// floor under it (BUBBLE_REF_FLOOR_FRAC of the whole session's peak). Without
// the floor, the first column of the day is by definition the session maximum
// and every bubble in it draws at full size; with it, a quiet open looks quiet.
// ─────────────────────────────────────────────────────────────────────────────

import { BUBBLE_STYLE, type BubbleBucket, type GexMetric } from './settings'
import { valueOf, type GexColumn } from './gexHistory'

/** The running reference never falls below this fraction of the session peak. */
const REF_FLOOR_FRAC = 0.3

export interface BubbleMark {
  strike: number
  value: number
  /** |value| ÷ the bucket's reference, 0..1. This is what sets the radius. */
  ratio: number
  /** 0-based rank among the session's strongest strikes, or -1 for a plain mark. */
  wallRank: number
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
  levels: number
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
  const { bucket, metric, levels, barTimes, intervalMs } = opts
  if (!columns.length || !barTimes.length || levels <= 0) return []

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
  const keys = [...byBucket.keys()].sort((a, b) => a - b)
  if (!keys.length) return []

  // ── 2. Session peak, for the reference floor. One pass over everything.
  let sessionMax = 0
  for (const key of keys) {
    for (const cell of byBucket.get(key)!.cells) {
      const a = Math.abs(valueOf(cell, metric))
      if (a > sessionMax) sessionMax = a
    }
  }
  if (sessionMax <= 0) return []
  const floor = sessionMax * REF_FLOOR_FRAC

  // ── 3. Walk forward. `peak` is each strike's biggest |value| SO FAR, which is
  //       what decides which strikes are drawn — so a level that mattered at
  //       10:00 keeps its trail through the afternoon instead of vanishing the
  //       moment something else outgrows it.
  const peak = new Map<number, number>()
  let runMax = 0
  const frames: BubbleFrame[] = []
  const highlight = Math.max(0, BUBBLE_STYLE.highlight)

  for (const key of keys) {
    const col = byBucket.get(key)!
    for (const cell of col.cells) {
      const a = Math.abs(valueOf(cell, metric))
      if (a > (peak.get(cell.strike) ?? 0)) peak.set(cell.strike, a)
      if (a > runMax) runMax = a
    }

    const ranked = [...peak.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0])
    const shown = new Set(ranked.slice(0, levels))
    const wallRank = new Map<number, number>()
    ranked.slice(0, highlight).forEach((s, i) => wallRank.set(s, i))

    const ref = Math.max(runMax, floor)
    const marks: BubbleMark[] = []
    for (const cell of col.cells) {
      if (!shown.has(cell.strike)) continue
      const v = valueOf(cell, metric)
      if (v === 0) continue
      marks.push({
        strike: cell.strike,
        value: v,
        ratio: Math.min(Math.abs(v) / ref, 1),
        wallRank: wallRank.get(cell.strike) ?? -1,
      })
    }
    if (!marks.length) continue
    marks.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))

    const barT = barTimes[barIndexAt(barTimes, key)]
    if (barT === undefined) continue
    const frac = bucketMs > 0 && intervalMs > 0 ? Math.min(0.999, Math.max(0, (key - barT) / intervalMs)) : 0
    frames.push({ barT, frac, marks })
  }

  return frames
}

// ── Drawing ──────────────────────────────────────────────────────────────────

export interface BubblePalette {
  /** [r,g,b] for a positive-gamma mark, and its hot variant for a wall. */
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
  /** Pixel distance between two adjacent strikes. */
  rowPitch: number
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

export function drawBubbles(
  ctx: CanvasRenderingContext2D,
  frames: BubbleFrame[],
  geo: BubbleGeometry,
  opts: DrawOpts,
  palette: BubblePalette,
): void {
  const { width: w, height: h, barPitch, rowPitch } = geo
  if (!frames.length || w <= 0 || h <= 0) return

  const layerAlpha = Math.max(0.05, Math.min(1, opts.intensity))
  const minOpacity = Math.max(0.1, 1 - Math.max(0, Math.min(1, BUBBLE_STYLE.fade)))
  const sizeMul = opts.size

  // The radius cap is the tightest of three bounds: an absolute ceiling, the
  // row pitch and the column pitch. Row and column both matter — a chart zoomed
  // out in time and in on price needs the column bound; the reverse needs the
  // row bound; either alone produces a smear at some zoom level.
  const colBound = Math.max(barPitch * BUBBLE_STYLE.maxPxColFrac, BUBBLE_STYLE.colBoundFloorPx)
  const rowBound = rowPitch > 0 ? rowPitch * BUBBLE_STYLE.maxPxRowFrac : BUBBLE_STYLE.maxPx
  const maxPx = Math.max(1.2, sizeMul * Math.min(BUBBLE_STYLE.maxPx, rowBound, colBound))
  const rxCap = Math.max(0.35, sizeMul * Math.max(barPitch / 2 - BUBBLE_STYLE.colGapPx, BUBBLE_STYLE.colBoundFloorPx / 2))
  const ryCap = Math.max(0.35, sizeMul * Math.max(rowPitch / 2 - BUBBLE_STYLE.colGapPx, 1))

  for (const frame of frames) {
    const xBar = geo.xOfBar(frame.barT)
    if (xBar == null) continue
    const x = xBar + frame.frac * barPitch
    if (x < -20 || x > w + 20) continue

    for (const m of frame.marks) {
      // The strike IS the price. Every symbol v3 charts is charted against its
      // own strikes, so there is no basis to add — that conversion existed only
      // for the ES chart, whose axis was futures while its strikes were SPX.
      const y = geo.yOfPrice(m.strike)
      if (y == null || y < -20 || y > h + 20) continue

      const shaped = opts.curve <= 1.001 ? m.ratio : Math.pow(m.ratio, opts.curve)
      const r = Math.max(BUBBLE_STYLE.minPx, maxPx * shaped)
      if (r < 0.12) continue

      const isWall = m.wallRank >= 0
      const positive = m.value >= 0
      const base = positive ? palette.pos : palette.neg
      const hot = positive ? palette.posHot : palette.negHot
      const col = isWall ? hot : base
      const opacity = (isWall ? 1 : minOpacity + m.ratio * (1 - minOpacity)) * layerAlpha

      const rx = Math.min(r, rxCap)
      const ry = Math.min(r, ryCap)

      ctx.beginPath()
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
      if (isWall) {
        // The glow is what separates "the wall" from "a big strike" at a glance.
        // Drawn with the canvas shadow rather than a cached sprite: only
        // BUBBLE_STYLE.highlight marks per column take this path, so the sprite
        // atlas v2 needs for a full heatmap would be machinery for nothing here.
        const hiT = 0
        ctx.shadowColor = rgba(base, 0.95)
        ctx.shadowBlur = Math.min(
          BUBBLE_STYLE.glowMaxPx,
          Math.max(
            1.5,
            Math.max(rx, ry) *
              (BUBBLE_STYLE.glowTopFactor - (BUBBLE_STYLE.glowTopFactor - BUBBLE_STYLE.glowMinFactor) * hiT),
          ),
        )
      }
      ctx.fillStyle = rgba(col, opacity)
      ctx.fill()
      if (isWall) {
        ctx.shadowBlur = 0
        ctx.shadowColor = 'transparent'
      }
    }
  }
}
