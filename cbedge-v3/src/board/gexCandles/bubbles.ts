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
// So: a strike's row is drawn ACROSS PIXELS, from the pixel where its history
// starts to the pixel where it ends. Switching timeframe changes `timeToX` and
// nothing else. No timeframe is passed in, because nothing here needs to know
// one.
//
// The row is a round-capped STROKE, not a series of stamped circles. Stamping
// every N pixels only merges into a band while the radius is bigger than N: a
// wall at r=9 looked solid at a 6px cadence and a 15%-of-core strike at r=1.4
// broke into a dotted line right next to it, at the same zoom, from the same
// code. A stroke of width 2r with round caps is the limit of that stamping loop
// as the step goes to zero — genuinely per-pixel, at a fraction of the cost, and
// solid at every magnitude.
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
//   THE CORE    the strongest of them. Draws at the largest radius the pane and
//               its neighbours allow, so it is findable at a glance whether the
//               whole session is quiet or busy. Takes the hot colour and glow.
//
//   EVERYTHING  radius = core radius × (its |GEX| ÷ the core's |GEX|). Linear,
//   ELSE        so size reads directly as "how much of this snapshot's gamma is
//               here". Anything under DUST of the core is dropped rather than
//               drawn as a speck.
//
// ── ROWS NEVER TOUCH ─────────────────────────────────────────────────────────
//
// Two strikes' rows merging into one slab is the failure this layer is most
// prone to, and it is a lie: it draws two levels as one. placeMarks() below
// makes non-overlap a HARD constraint applied LAST, after every setting has had
// its say, pairwise between vertical neighbours in pixels.
// ─────────────────────────────────────────────────────────────────────────────

import { BUBBLE_STYLE, type GexMetric } from './settings'
import { valueOf, type GexColumn } from './gexHistory'

/**
 * How many segments the band is cut into across its pixel span. Not a stamp
 * spacing — each segment is STROKED across its full width, so a row is solid at
 * every radius. See the note on discrete stamps in drawBubbles().
 *
 * Bounded rather than "every pixel" purely for cost: an 900px band at 1px would
 * be ~5,400 draw calls per frame at six marks, sixty times a second.
 */
const MAX_SEGMENTS = 320

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

// Removed 2026-08-28: nearestIndex() answered "which snapshot is at this pixel"
// for the old fixed-segment walk. drawBubbles now walks SNAPSHOTS and asks the
// inverse question — which pixel is this snapshot at — so nothing looks up a
// snapshot by time any more.

/** A mark resolved to a pixel row: where it sits and how fat it may be drawn. */
interface PlacedMark {
  mark: BubbleMark
  y: number
  r: number
}

/**
 * Below this a row would be sub-pixel anyway. It is the floor the fit pass may
 * shrink to, so two strikes landing on the same pixel stay visible as a hairline
 * instead of vanishing — at that size they cannot read as a merged slab.
 */
const HAIRLINE_PX = 0.35

/** Passes of the pairwise fit. Shrinking one pair can leave the next tight. */
const FIT_PASSES = 6

/**
 * Every mark in a snapshot, placed and sized so that NO TWO ROWS TOUCH.
 *
 * Two stages, and the order is the whole point:
 *
 *   WANT   each radius from its ratio alone — a fraction of the pane height,
 *          scaled by the size slider, shaped by `curve`. This is the picture the
 *          settings ask for, before geometry gets a say.
 *   FIT    walk the marks in y order and shrink any ADJACENT PAIR whose radii
 *          plus the hairline do not fit the gap between them, proportionally so
 *          the pair keeps its relative weight.
 *
 * This replaces a single per-snapshot cap taken from the tightest gap on the
 * ladder. That had two faults. The size slider was applied AFTER it, so anything
 * above 1× drew straight through the bound and merged rows — which is the bug
 * this fixes. And being global, one tight pair shrank every mark in the
 * snapshot, including marks with all the room in the world.
 *
 * VERTICAL SPACING IS THE ONLY BOUND, measured from the marks actually drawn at
 * the current zoom — never from the ladder's strike step, which with three marks
 * a side is tens of strikes away from the real gap. There is deliberately NO
 * horizontal bound: a mark's left and right neighbours are the same strike a few
 * pixels earlier and later, and those merging is not a collision, it is the band.
 * That is the whole reason the layer can step in pixels.
 *
 * The pane's height is the second term of WANT. Spacing alone would let six
 * marks on a tall, sparse pane grow until the ladder was mostly circle; a
 * fraction of the pane height keeps the band proportionate to the chart it is
 * drawn on, at every window size, with no per-layout pixel number to tune.
 */
function placeMarks(snap: BubbleSnapshot, geo: BubbleGeometry, opts: DrawOpts): PlacedMark[] {
  const base = Math.max(BUBBLE_STYLE.minPx, geo.height * BUBBLE_STYLE.heightFrac * opts.size)

  const placed: PlacedMark[] = []
  for (const mark of snap.marks) {
    const y = geo.yOfPrice(mark.strike)
    if (y == null) continue
    // The core has ratio 1, so it draws at exactly `base` on every curve
    // setting — `curve` only changes how fast the ones BELOW it fall away.
    const shaped = opts.curve <= 1.001 ? mark.ratio : Math.pow(mark.ratio, opts.curve)
    placed.push({ mark, y, r: Math.max(BUBBLE_STYLE.minPx, base * shaped) })
  }
  placed.sort((a, b) => a.y - b.y)

  for (let pass = 0; pass < FIT_PASSES; pass++) {
    let tightened = false
    for (let i = 1; i < placed.length; i++) {
      const above = placed[i - 1]
      const below = placed[i]
      if (!above || !below) continue
      const room = below.y - above.y - BUBBLE_STYLE.gapPx
      const sum = above.r + below.r
      if (sum <= room) continue
      const f = room > 0 ? room / sum : 0
      above.r = Math.max(HAIRLINE_PX, above.r * f)
      below.r = Math.max(HAIRLINE_PX, below.r * f)
      tightened = true
    }
    if (!tightened) break
  }

  return placed
}

/** The pixel window of the pane that the time scale can actually answer for. */
interface TimeWindow {
  xLo: number
  xHi: number
  tLo: number
  tHi: number
}

/**
 * Find the sub-range of [0, width] where timeAtX() returns a time.
 *
 * It is NOT the whole canvas. The overlay spans the card, the chart's PLOT does
 * not — the price scale owns the right ~60px — and coordinateToTime() answers
 * null outside the plot and outside the data. Probing the canvas edges gets
 * null at both ends, which is exactly how the first version of this helper
 * managed to fail on every single frame.
 *
 * A coarse scan finds a valid pixel, then each end is walked in by halving.
 * ~48 calls, all pure scale arithmetic, once per drawn frame.
 */
function timeWindow(geo: BubbleGeometry): TimeWindow | null {
  const w = geo.width
  const STEPS = 24
  let firstValid = -1
  let lastValid = -1
  for (let i = 0; i <= STEPS; i++) {
    const x = (w * i) / STEPS
    if (geo.timeAtX(x) != null) {
      if (firstValid < 0) firstValid = x
      lastValid = x
    }
  }
  if (firstValid < 0 || lastValid < 0) return null

  // Refine outward: the true edge lies between the last invalid probe and the
  // first valid one, one coarse step apart.
  const step = w / STEPS
  const refine = (valid: number, invalid: number) => {
    let v = valid
    let n = invalid
    for (let i = 0; i < 8; i++) {
      const mid = (v + n) / 2
      if (geo.timeAtX(mid) != null) v = mid
      else n = mid
    }
    return v
  }
  const xLo = firstValid > 0 ? refine(firstValid, Math.max(0, firstValid - step)) : 0
  const xHi = lastValid < w ? refine(lastValid, Math.min(w, lastValid + step)) : w

  const tLo = geo.timeAtX(xLo)
  const tHi = geo.timeAtX(xHi)
  if (tLo == null || tHi == null || !(tHi > tLo)) return null
  return { xLo, xHi, tLo, tHi }
}

/**
 * Where an instant sits on the pane, in pixels.
 *
 * NOT xOfTime(). lightweight-charts' timeToCoordinate() answers only for
 * timestamps that are IN the series — it does not interpolate — while the GEX
 * history is per MINUTE and the candles are 5m or coarser. Above 1m the band's
 * first and last snapshot almost never land on a bar, both calls returned null,
 * and drawBubbles bailed out before drawing anything: the whole layer vanished,
 * intermittently, on nothing more than whether the history's endpoints happened
 * to fall on a bar boundary.
 *
 * timeAtX() (coordinateToTime) IS defined across the plot and is monotonic in
 * x, so the inverse is a binary search over the window found above. A time off
 * either end clamps to that edge, which is what the band wants: a history that
 * starts before the visible range starts at the plot's left edge.
 */
function xAtTime(win: TimeWindow, geo: BubbleGeometry, ms: number): number {
  if (ms <= win.tLo) return win.xLo
  if (ms >= win.tHi) return win.xHi
  let lo = win.xLo
  let hi = win.xHi
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    const t = geo.timeAtX(mid)
    if (t == null) break
    if (t < ms) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/**
 * A sampled x -> time table for the pane, and the interpolated inverse.
 *
 * Built once per drawn frame. The alternative — a binary search per snapshot —
 * is 20 chart calls each, ~2,000 a frame at a session's worth of history, to
 * answer a question that is piecewise-linear in x and can simply be sampled.
 */
interface XMap {
  xs: number[]
  ts: number[]
}
const XMAP_SAMPLES = 128

function buildXMap(geo: BubbleGeometry, win: TimeWindow): XMap {
  const xs: number[] = []
  const ts: number[] = []
  for (let i = 0; i <= XMAP_SAMPLES; i++) {
    const x = win.xLo + ((win.xHi - win.xLo) * i) / XMAP_SAMPLES
    const t = geo.timeAtX(x)
    if (t == null) continue
    // Monotonic by construction; a repeated time (whitespace past the last bar)
    // would break the interpolation, so keep only strictly increasing samples.
    if (ts.length && t <= ts[ts.length - 1]!) continue
    xs.push(x)
    ts.push(t)
  }
  return { xs, ts }
}

/** Pixel for an instant, interpolated. Off either end clamps to that end. */
function xOf(map: XMap, ms: number): number | null {
  const n = map.ts.length
  if (n === 0) return null
  if (n === 1) return map.xs[0]!
  if (ms <= map.ts[0]!) return map.xs[0]!
  if (ms >= map.ts[n - 1]!) return map.xs[n - 1]!
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (map.ts[mid]! <= ms) lo = mid
    else hi = mid
  }
  const t0 = map.ts[lo]!
  const t1 = map.ts[hi]!
  const f = t1 === t0 ? 0 : (ms - t0) / (t1 - t0)
  return map.xs[lo]! + (map.xs[hi]! - map.xs[lo]!) * f
}

/**
 * How far a single snapshot's mark may stretch horizontally, as a multiple of
 * its own radius.
 *
 * A row is drawn one snapshot at a time, each stroke as long as the gap to its
 * neighbours — so when a session is squeezed into a few hundred pixels the
 * strokes tile and the row is the continuous band it should be. Zoom in far
 * enough and that gap becomes tens of pixels, and without this cap a minute of
 * gamma smeared across all of it: the layer turned into flat horizontal bars,
 * which is what it looked like at 1m. Capped, a mark stays a lozenge barely
 * wider than it is tall, so a row reads as a chain of bubbles at any zoom.
 */
const MAX_STRETCH_R = 0.8

/**
 * Returns whether anything was actually painted. False means the history does
 * not reach the visible window — zoomed or panned into candles older than the
 * first snapshot, or newer than the last. That is correct, and it is
 * indistinguishable from a broken layer, so the caller says so on screen.
 */
export function drawBubbles(
  ctx: CanvasRenderingContext2D,
  snaps: BubbleSnapshot[],
  geo: BubbleGeometry,
  opts: DrawOpts,
  palette: BubblePalette,
): boolean {
  const { width: w, height: h } = geo
  if (!snaps.length || w <= 0 || h <= 0) return false

  const first = snaps[0]
  const last = snaps[snaps.length - 1]
  if (!first || !last) return false

  // Extent comes from the DATA's own time range, clamped to the pane — not from
  // a lookback in bars. This is why the band starts where the session's gamma
  // history starts on every timeframe, with nothing to configure.
  const win = timeWindow(geo)
  if (!win) return false
  const xFirst = xAtTime(win, geo, first.ts)
  const xLast = xAtTime(win, geo, last.ts)
  const x0 = Math.max(0, Math.min(xFirst, xLast))
  const x1 = Math.min(w, Math.max(xFirst, xLast))
  if (x1 <= x0) return false

  const layerAlpha = Math.max(0.05, Math.min(1, opts.intensity))
  const minOpacity = Math.max(0.1, 1 - Math.max(0, Math.min(1, BUBBLE_STYLE.fade)))

  const map = buildXMap(geo, win)

  // ONE STROKE PER SNAPSHOT, not per fixed pixel segment.
  //
  // The old walk cut the band into 320 equal slices and asked each what the
  // gamma was there. That is the same picture as this at low zoom — the slices
  // are narrower than a snapshot and tile into a band — but at high zoom a
  // slice covers many minutes and the row became one uniform bar, with no way
  // to cap its length because the slice, not the snapshot, owned the geometry.
  // Walking snapshots puts the length back where it belongs: each mark stretches
  // to its neighbours, and no further than MAX_STRETCH_R of its own radius.
  const centres: number[] = []
  for (const snap of snaps) centres.push(xOf(map, snap.ts) ?? -1)

  // At a session's zoom there are more snapshots than pixels; drawing all of
  // them is thousands of redundant strokes for the same band. Stride so the
  // count stays bounded — the old MAX_SEGMENTS budget, spent on snapshots.
  const stride = Math.max(1, Math.ceil(snaps.length / MAX_SEGMENTS))

  const placedBySnap = new Map<number, PlacedMark[]>()

  ctx.lineCap = 'round'

  let drew = 0
  for (let i = 0; i < snaps.length; i += stride) {
    const snap = snaps[i]
    const cx = centres[i]!
    if (!snap || cx < 0) continue

    // Half the distance to each neighbour IN THE STRIDE, so a strided walk
    // still tiles instead of leaving gaps it never meant to leave.
    const prev = centres[Math.max(0, i - stride)]!
    const next = centres[Math.min(snaps.length - 1, i + stride)]!
    const gap = Math.max(0, Math.max(cx - prev, next - cx))

    let placed = placedBySnap.get(i)
    if (placed === undefined) {
      placed = placeMarks(snap, geo, opts)
      placedBySnap.set(i, placed)
    }

    for (const { mark: m, y, r } of placed) {
      if (y < -20 || y > h + 20) continue
      const half = Math.min(gap, r * MAX_STRETCH_R) / 2
      const xa = cx - half
      const xb = cx + half
      // Wholly off the pane, caps included.
      if (xb + r < 0 || xa - r > w) continue

      const positive = m.value >= 0
      const base = positive ? palette.pos : palette.neg
      const col = m.isCore ? (positive ? palette.posHot : palette.negHot) : base
      const opacity = (m.isCore ? 1 : minOpacity + m.ratio * (1 - minOpacity)) * layerAlpha

      // Plain CSS pixels: the caller has already applied a devicePixelRatio
      // transform to the context, so multiplying by dpr here would scale it
      // twice and make a retina panel draw a band twice as fat as a normal one.
      //
      // lineWidth 2r + round caps == a circle of radius r swept from xa to xb.
      // A zero-length stroke still paints a full circle, which is what draws a
      // lone snapshot.
      ctx.beginPath()
      ctx.lineWidth = r * 2
      ctx.strokeStyle = rgba(col, opacity)
      if (m.isCore) {
        ctx.shadowColor = rgba(base, 0.95)
        ctx.shadowBlur = Math.min(BUBBLE_STYLE.glowMaxPx, Math.max(1.5, r * BUBBLE_STYLE.glowTopFactor))
      }
      ctx.moveTo(xa, y)
      ctx.lineTo(xb, y)
      ctx.stroke()
      drew++
      if (m.isCore) {
        ctx.shadowBlur = 0
        ctx.shadowColor = 'transparent'
      }
    }
  }
  return drew > 0
}
