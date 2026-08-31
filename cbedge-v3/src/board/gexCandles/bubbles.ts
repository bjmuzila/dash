// ─────────────────────────────────────────────────────────────────────────────
// The GEX bubble layer.
//
//   buildBubbleModel()  selection and magnitude. Pure — no pixels, no bars, no
//                       timeframe. Takes a bucket width and nothing else.
//   drawBubbles()       pixels. Runs inside the chart's rAF, because the axes
//                       move on every pan, zoom and autoscale.
//
// See BUBBLES in settings.ts for the seven rules this implements and the numbers
// behind them. The short version: one bubble per bucket, last print wins; four
// strikes with one forced on each side of spot; radius by sqrt of |gex| over the
// window max; the bucket's biggest gets a boost and a white ring; same-bucket
// neighbours shrink and then jitter rather than overlap; nothing is ever spliced.
//
// ── WHY IT IS STAMPED AND NOT DRAWN ──────────────────────────────────────────
//
// Two earlier versions drew each row as a continuous stroke and both came out as
// solid bars, for the same reason: they took their cadence from the DATA. One
// stroke per snapshot at a session's zoom is a thousand strokes across fifteen
// hundred pixels, so whatever the radius they merge — and a bar is a different
// claim than a trail. It says the level was one thing for the whole stretch,
// where the dots say it was sampled, repeatedly, and here is what it read each
// time. Capping stroke length instead broke rows into dashes the moment the gap
// exceeded the radius: the same failure from the other side.
//
// The bucket is the cadence now, which is what "1 bubble per timeframe" means,
// and the caller picks it from how wide the visible window is.
// ─────────────────────────────────────────────────────────────────────────────

import { BUBBLES, type GexMetric } from './settings'
import { valueOf, type GexColumn } from './gexHistory'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export interface BubbleMark {
  strike: number
  value: number
  /** |value| over the WINDOW's biggest, 0..1. This is what sets the radius. */
  ratio: number
  /** True for the largest |netGex| in this bucket — the one that stands apart. */
  isTop: boolean
}

export interface BubbleSnapshot {
  /** Epoch ms of the BUCKET, not of the print inside it. */
  ts: number
  /** Biggest first, so smaller marks land on top of bigger ones. */
  marks: BubbleMark[]
}

export interface BuildOpts {
  metric: GexMetric
  /**
   * Bucket width. The caller knows how wide the visible window is and the model
   * does not — 1m over a whole session is 390 dots across 1500 pixels, which is
   * a line again, and 5m over thirty minutes is six.
   */
  bucketMs: number
}

/**
 * Selection and magnitude. Pure: no pixels, no bars, no timeframe.
 */
export function buildBubbleModel(columns: GexColumn[], opts: BuildOpts): BubbleSnapshot[] {
  const { metric } = opts
  if (!columns.length) return []
  const { levels, minPerSide, strikeMode } = BUBBLES
  const bucketMs = Math.max(60_000, opts.bucketMs)

  // ── ONE BUBBLE PER BUCKET, LAST PRINT WINS ────────────────────────────────
  // Not a mean. The bucket is a SAMPLE of the board — "this is what it read at
  // 10:35" — and averaging five minutes of a wall being built smears exactly the
  // move the dot exists to show.
  const byBucket = new Map<number, GexColumn>()
  for (const col of [...columns].sort((a, b) => a.slotTs - b.slotTs)) {
    byBucket.set(Math.floor(col.slotTs / bucketMs) * bucketMs, col)
  }
  const buckets = [...byBucket.entries()].sort((a, b) => a[0] - b[0])
  if (!buckets.length) return []

  // ── windowMax ─────────────────────────────────────────────────────────────
  // ONE denominator for every mark on screen, taken over the whole window. Per
  // bucket it would renormalise every quiet minute back up to full size, which
  // is what made the trail bulge and pinch instead of tapering.
  let windowMax = 0
  for (const [, col] of buckets) {
    for (const c of col.cells) {
      const a = Math.abs(valueOf(c, metric))
      if (a > windowMax) windowMax = a
    }
  }
  if (windowMax <= 0) return []

  const spotOf = (col: GexColumn): number => {
    if (col.spot > 0) return col.spot
    let lo = Infinity
    let hi = -Infinity
    for (const c of col.cells) {
      if (c.strike < lo) lo = c.strike
      if (c.strike > hi) hi = c.strike
    }
    return Number.isFinite(lo) && Number.isFinite(hi) ? (lo + hi) / 2 : 0
  }

  /**
   * The bucket's strikes: FORCE one above spot and one below, then fill from
   * the ranking.
   *
   * Forced first, not swapped in afterwards. Gamma is routinely lopsided enough
   * that every top strike sits on one side of price, and a chart of only the
   * resistance overhead is half a picture — so the two sides are taken before
   * the ranking gets to spend the remaining slots, which it does purely on
   * |netGex| and without caring which side they land on.
   */
  const pick = (col: GexColumn): Array<{ strike: number; value: number }> => {
    const spot = spotOf(col)
    const ranked = col.cells
      .map((c) => ({ strike: c.strike, value: valueOf(c, metric) }))
      .filter((x) => x.value !== 0)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    if (!ranked.length) return []

    const out: Array<{ strike: number; value: number }> = []
    const taken = new Set<number>()
    if (spot > 0) {
      for (let i = 0; i < minPerSide; i++) {
        const above = ranked.find((x) => x.strike >= spot && !taken.has(x.strike))
        if (above) { out.push(above); taken.add(above.strike) }
        const below = ranked.find((x) => x.strike < spot && !taken.has(x.strike))
        if (below) { out.push(below); taken.add(below.strike) }
      }
    }
    for (const x of ranked) {
      if (out.length >= levels) break
      if (taken.has(x.strike)) continue
      out.push(x)
      taken.add(x.strike)
    }
    return out.slice(0, levels)
  }

  // ── strikeMode ────────────────────────────────────────────────────────────
  // Neither mode ever splices a snapshot. 'per-bar' keeps each bucket's own
  // picks, so a wall that ran the 11:00 high keeps its dots up at the high where
  // it happened. 'latest' locks the Y set to the newest bucket's picks and plots
  // THOSE strikes backward — the same rows all the way across, which is the
  // right read when the question is "where has today's board been".
  const latestSet = new Set(pick(buckets[buckets.length - 1]![1]).map((x) => x.strike))

  // No dwell, no hysteresis, no smoothing. Every one of those was a patch for
  // the CONTINUOUS renderer, where a strike dropping out for a print left a
  // visible hole in a line. A dot that is not there for one bucket is just a
  // gap in a chain of dots, which is what a sample looks like — and `strikeMode`
  // is the real answer to "keep the level on the axis".
  const out: BubbleSnapshot[] = []

  for (const [ts, col] of buckets) {
    const chosen = strikeMode === 'latest'
      ? col.cells
          .filter((c) => latestSet.has(c.strike))
          .map((c) => ({ strike: c.strike, value: valueOf(c, metric) }))
          .filter((x) => x.value !== 0)
      : pick(col)

    if (!chosen.length) continue

    let top = 0
    for (const x of chosen) top = Math.max(top, Math.abs(x.value))
    let taggedTop = false
    const marks: BubbleMark[] = chosen
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .map((x) => {
        const isTop = !taggedTop && Math.abs(x.value) === top
        if (isTop) taggedTop = true
        return { strike: x.strike, value: x.value, ratio: clamp(Math.abs(x.value) / windowMax, 0, 1), isTop }
      })

    out.push({ ts, marks })
  }
  return out
}

// ── Drawing ──────────────────────────────────────────────────────────────────

export interface BubblePalette {
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
  /**
   * The PLOT rect, in the same CSS pixels — the canvas minus the right price
   * scale and the bottom time axis.
   *
   * The overlay spans the whole card and the plot does not, and
   * `coordinateToTime()` keeps answering for an x that is already underneath the
   * price scale: it is index arithmetic, not a hit test. So probing the canvas
   * width put the window's right edge out in the axis gutter and the newest
   * buckets were stamped straight over the price labels. Everything here is
   * bounded by these two numbers, and the draw clips to them as well.
   */
  plotWidth: number
  plotHeight: number
}

function rgba(c: [number, number, number], a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`
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
 * It is NOT the whole canvas: the overlay spans the card, the chart's PLOT does
 * not — the price scale owns the right ~60px — and coordinateToTime() answers
 * null outside the plot and outside the data. Probing the canvas edges gets null
 * at both ends, which is how the first version of this helper managed to fail on
 * every single frame.
 */
function timeWindow(geo: BubbleGeometry): TimeWindow | null {
  // The PLOT's width, never the canvas's. See BubbleGeometry.plotWidth.
  const w = Math.max(1, Math.min(geo.plotWidth, geo.width))
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
 * history is per minute and the candles are 5m or coarser, so a bucket almost
 * never lands on a bar and the whole layer vanished intermittently on nothing
 * more than whether it did. timeAtX() IS defined across the plot and monotonic
 * in x, so the inverse is a binary search over the window found above.
 *
 * ── null OUTSIDE THE WINDOW, NOT CLAMPED TO ITS EDGES ────────────────────────
 * This used to answer `win.xLo` for anything older than the window and `win.xHi`
 * for anything newer. That is not a position, it is a pin: every bucket recorded
 * before the visible range — the whole morning, when you are looking at the last
 * two hours — was stamped on the left edge, on top of each other, and stayed
 * glued there through pans and zooms while the candles underneath moved. Same
 * story on the right, where the pinned column landed in the price-scale gutter.
 * A bucket that is not in the window is not on the chart; it is skipped.
 */
function xAtTime(win: TimeWindow, geo: BubbleGeometry, ms: number): number | null {
  if (ms < win.tLo || ms > win.tHi) return null
  if (ms === win.tLo) return win.xLo
  if (ms === win.tHi) return win.xHi
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

interface SizeProfile {
  capPx: number
  floorPx: number
  topBoost: number
  /** Hard ceiling on the boosted leader — its own share of the spacing. */
  topCapPx: number
  /** Blur allowed under the leader, bounded by the room left beside it. */
  glowPx: number
  ringPx: number
}

/**
 * The size numbers for the bucket actually on screen.
 *
 * TWO steps, and both are load-bearing:
 *
 * 1. The rung's own PROFILE. A 13px cap is right at 5m and absurd at 1m — five
 *    times the dots in the same width — so the numbers are per rung rather than
 *    one set asked two different questions. See BUBBLES.profiles.
 *
 * 2. Shrunk to the room that actually exists. A profile is right at the zoom its
 *    rung was chosen for; force a rung the auto rule would not have picked and
 *    the dots land closer than the profile assumes. The cap is therefore also
 *    held to `capOfSpacing` of the measured gap between two dots. It only ever
 *    shrinks — inert at the intended zoom, and at 1m across a whole session it
 *    turns fused ribbons into a fine dotted trail, which is the truthful picture
 *    of 975 samples in 1500 pixels.
 */
function sizeFor(bucketMs: number, pxPerDot: number, scale = 1): SizeProfile {
  const mins = Math.max(1, Math.round(bucketMs / 60_000))
  const rungs = Object.keys(BUBBLES.profiles)
    .map(Number)
    .sort((a, b) => a - b)
  // Nearest listed rung at or below this one, so an unlisted bucket is never
  // sized by a profile meant for a coarser one.
  const rung = [...rungs].reverse().find((r) => r <= mins) ?? rungs[0]!
  const p = BUBBLES.profiles[rung]!
  // TWO spacing bounds, because the leader and its peers are answering
  // different questions.
  //
  // The peers get `capOfSpacing`. This used to be divided by `topBoost` so the
  // boosted leader would also land inside it — which meant ONE dot per bucket
  // set the size of every other dot in it, and the whole ladder paid a 30-40%
  // tax for a mark that already has a ring and a glow to set it apart.
  //
  // The leader gets its own, larger share (`topOfSpacing`) instead. Larger, but
  // still a bound: let it off the leash entirely and at a tight zoom it draws at
  // the profile cap x boost — 14px of radius into 15px of spacing — and the top
  // row fuses into one continuous sausage, which is the exact failure this layer
  // was rebuilt to stop.
  //
  // 3. THE USER'S OWN MULTIPLIER (`scale`, the Layers panel's Bubble size
  //    slider). It multiplies BOTH sides of the min above — the profile cap and
  //    the share of the spacing — rather than being applied to the finished
  //    radius, and the difference matters: scaling the answer would let the
  //    spacing bound silently eat the whole adjustment at a tight zoom, so the
  //    slider would do nothing exactly where someone reaches for it. Scaling
  //    both means it reads as "give every mark N× the room it was allotted",
  //    and it is inert at 1 by construction — the arithmetic is the same
  //    expression it always was.
  //
  //    Above 1 the marks CAN fuse horizontally. That is the user asking for it,
  //    the same bargain the manual 1m/5m bucket already offers, and the vertical
  //    fit below still stops two strikes being drawn as one blob.
  const room = pxPerDot > 0 ? BUBBLES.capOfSpacing * pxPerDot * scale : p.capPx * scale
  const capPx = Math.max(BUBBLES.minPx, Math.min(p.capPx * scale, room))
  const topRoom = pxPerDot > 0 ? BUBBLES.topOfSpacing * pxPerDot * scale : p.capPx * p.topBoost * scale
  const topCapPx = Math.max(capPx, Math.min(p.capPx * p.topBoost * scale, topRoom))
  // And the GLOW gets whatever is left over, which is often nothing.
  //
  // This was the real reason the leader's row looked like one continuous
  // sausage rather than a row of dots: the marks themselves were clearing each
  // other by a pixel or two, and then a 7px gaussian halo painted straight
  // across the gap. Blur is not free real estate — it has to come out of the
  // same spacing everything else is measured against.
  const spare = pxPerDot > 0 ? pxPerDot / 2 - topCapPx : BUBBLES.glowMaxPx
  return {
    capPx,
    floorPx: Math.max(BUBBLES.minPx, Math.min(p.floorPx * scale, capPx * BUBBLES.floorOfCap)),
    topBoost: p.topBoost,
    topCapPx,
    glowPx: Math.max(0, Math.min(BUBBLES.glowMaxPx, spare)),
    ringPx: p.ringPx * scale,
  }
}

interface Placed {
  mark: BubbleMark
  y: number
  r: number
  dx: number
}

/**
 * One bucket's marks, sized and then fitted so they do not overlap.
 *
 * ── The size law ──────────────────────────────────────────────────────────
 *   r = floorPx + (|gex| / windowMax) ** sizeCurve x (capPx - floorPx),  x boost
 *
 * Compressive rather than linear because the top strike is routinely five to ten
 * times its neighbours: a linear law hands it the whole budget and leaves
 * everything else as identical specks at the floor. Under the curve a strike
 * holding a quarter of the max still draws at about two fifths of the range, so
 * the ladder stays rankable — and the top still stands apart, by the boost and the ring rather
 * than by flattening everything under it.
 *
 * ── Then the fit ──────────────────────────────────────────────────────────
 * Two marks in the same bucket merging is a lie: it draws two levels as one. So
 * neighbours in y shrink TOWARD the floor, proportionally, keeping their
 * relative weight; and a pair that still cannot fit after `fitPasses` takes a
 * few pixels of X jitter instead — better a dot nudged off its minute than two
 * levels drawn as one blob, and at this cadence a 3px nudge is well inside the
 * bucket it belongs to. Nothing is ever dropped, and nothing goes below minPx:
 * an old dot stays on the chart.
 */
function placeBucket(snap: BubbleSnapshot, geo: BubbleGeometry, size: SizeProfile): Placed[] {
  const rows: Placed[] = []
  for (const mark of snap.marks) {
    const y = geo.yOfPrice(mark.strike)
    if (y == null) continue
    const base = size.floorPx + Math.pow(mark.ratio, BUBBLES.sizeCurve) * (size.capPx - size.floorPx)
    const r = mark.isTop ? Math.min(base * size.topBoost, size.topCapPx) : base
    rows.push({ mark, y, r, dx: 0 })
  }
  rows.sort((a, b) => a.y - b.y)

  for (let pass = 0; pass < BUBBLES.fitPasses; pass++) {
    let tightened = false
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1]!
      const b = rows[i]!
      const room = b.y - a.y - BUBBLES.gapPx
      const sum = a.r + b.r
      if (sum <= room) continue
      const f = room > 0 ? room / sum : 0
      a.r = Math.max(BUBBLES.minPx, a.r * f)
      b.r = Math.max(BUBBLES.minPx, b.r * f)
      tightened = true
    }
    if (!tightened) break
  }

  // Still colliding at the floor — the price scale is squeezed, or two strikes
  // are a fraction apart. Step them sideways in alternating directions.
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]!
    const b = rows[i]!
    if (b.y - a.y - BUBBLES.gapPx >= a.r + b.r) continue
    b.dx = a.dx >= 0 ? -BUBBLES.jitterPx : BUBBLES.jitterPx
  }
  return rows
}

/**
 * Returns whether anything was painted. False means the history does not reach
 * the visible window — panned into candles older than the first bucket, or newer
 * than the last. That is correct, and indistinguishable from a broken layer, so
 * the caller says so on screen.
 */
export function drawBubbles(
  ctx: CanvasRenderingContext2D,
  snaps: BubbleSnapshot[],
  geo: BubbleGeometry,
  palette: BubblePalette,
  /** The Bubble size slider, 1 = the tuned default. See sizeFor. */
  scale = 1,
  /**
   * True when the BUCKET was pinned by the user (the 1m / 5m tiles) rather than
   * chosen by the pane. It loosens the stride — see BUBBLES.pinnedPxPerDot.
   */
  pinned = false,
): boolean {
  const { width: w, height: h } = geo
  if (!snaps.length || w <= 0 || h <= 0) return false
  // Bounds are the PLOT's, not the canvas's: the price scale owns the right
  // ~60px and the time axis the bottom ~26px, and a mark belongs in neither.
  const pw = Math.max(1, Math.min(geo.plotWidth, w))
  const ph = Math.max(1, Math.min(geo.plotHeight, h))
  const win = timeWindow(geo)
  if (!win) return false

  const first = snaps[0]!
  const last = snaps[snaps.length - 1]!
  const span = Math.max(1, last.ts - first.ts)
  const minOpacity = 1 - BUBBLES.fade

  // The bucket and the pixels it owns, measured off the snapshots themselves —
  // the model already decided both and the draw should not be told twice.
  // Median rather than mean: a gap in the recording (a feed outage, a weekend)
  // is one huge diff that would otherwise claim there is far more room than
  // there is.
  const diffs: number[] = []
  for (let i = 1; i < snaps.length; i++) diffs.push(snaps[i]!.ts - snaps[i - 1]!.ts)
  diffs.sort((a, b) => a - b)
  const bucketMs = diffs.length ? diffs[diffs.length >> 1]! : 60_000
  // Pixels a bucket owns AT THE CURRENT ZOOM, measured locally rather than from
  // the data's whole span. The span version was wrong in a way that only showed
  // up zoomed in: xAtTime CLAMPS to the visible window, so a whole day of
  // snapshots reports the plot's own width no matter how far in you are, the
  // bucket looks a fraction of a pixel wide, and the stride throws away almost
  // everything. Two times one bucket apart, in the middle of the plot, is the
  // question actually being asked.
  const tMid = geo.timeAtX((win.xLo + win.xHi) / 2) ?? first.ts
  // One bucket either side of the midpoint, whichever of the two is still inside
  // the window — xAtTime answers null outside it now, and a clamped answer here
  // would report a fraction of the real spacing and stride away most of the trail.
  const xMid = xAtTime(win, geo, tMid)
  const xStep = xAtTime(win, geo, tMid + bucketMs) ?? xAtTime(win, geo, tMid - bucketMs)
  const pxPerDot = xMid != null && xStep != null ? Math.abs(xStep - xMid) : 0

  // ── THE DOTS ARE STRIDED WHEN THERE IS NOT ROOM FOR ALL OF THEM ───────────
  //
  // There is a hard physical limit here and it is worth stating plainly: 975
  // samples across 1,500 pixels is 1.5px each, and you cannot draw 975
  // distinguishable circles in that. Shrinking them does not help — two 1.2px
  // dots 1.5px apart still touch, which is the ribbon. Neither does any size
  // number, because the problem is not the size.
  //
  // So when the dots cannot all fit, only some of them are drawn: every Nth
  // bucket, chosen so the ones that ARE drawn clear each other. Nothing is
  // faked — each drawn dot is still one real bucket, last print and all — the
  // trail is simply sampled at the resolution the pane can actually show.
  //
  // This is what makes a forced rung safe at any zoom. Force 1m and zoom out and
  // it lands on the same picture the auto rule would have picked, because at
  // that width there IS only one legible answer. Zoom in and the stride falls
  // back to 1 and every minute is there again.
  // The stride targets the SAME spacing the auto rung is chosen for, not a bare
  // "they don't touch" minimum. Striding to the minimum was the first attempt
  // and it is barely better than the ribbon: 3px dots across a session are a
  // dotted line you cannot read a size off, and size is the entire signal. At
  // the auto spacing a forced rung lands on exactly the picture auto would have
  // drawn — which is correct, because at that width there is only one legible
  // answer and pretending otherwise is what made this look horrible zoomed out.
  //
  // A PINNED rung strides against a much smaller target (see
  // BUBBLES.pinnedPxPerDot). Measuring a pin against the same legible spacing
  // Auto uses is what made the 1m / 5m picker do nothing: 1m strides to every
  // Nth minute, 5m to every Nth/5, and both land on the same dots.
  const strideTarget = pinned ? BUBBLES.pinnedPxPerDot : BUBBLES.bucketPxPerDot
  const stride = pxPerDot > 0 ? Math.max(1, Math.ceil(strideTarget / pxPerDot)) : 1
  // The profile is chosen for the EFFECTIVE cadence — the bucket as drawn, not
  // as bucketed — so a strided 1m trail is sized like the rung it is showing.
  const size = sizeFor(bucketMs * stride, pxPerDot * stride, scale)

  // ── CLIPPED TO THE PLOT ───────────────────────────────────────────────────
  // A mark whose centre is legally inside the plot still has a radius, a ring
  // and a glow, and the newest bucket sits within a few pixels of the price
  // scale. Without this the right-hand marks bled over the axis labels. Clipping
  // rather than dropping them, so the edge dot is cut off by the axis the way it
  // is in every other chart, instead of vanishing a bucket early.
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, pw, ph)
  ctx.clip()

  let drew = 0
  for (let i = 0; i < snaps.length; i += stride) {
    const snap = snaps[i]!
    const x = xAtTime(win, geo, snap.ts)
    // Outside the visible window entirely: not on this chart. See xAtTime.
    if (x == null) continue
    if (x < -40 || x > pw + 40) continue
    // Age fades opacity only a LITTLE — the oldest bucket keeps `ageKeep` of it.
    // A trail that fades to nothing is a trail you cannot read the morning off,
    // and the morning is half of why it is drawn.
    const age = BUBBLES.ageKeep + (1 - BUBBLES.ageKeep) * ((snap.ts - first.ts) / span)

    for (const { mark: m, y, r, dx } of placeBucket(snap, geo, size)) {
      if (y < -20 || y > ph + 20) continue
      const positive = m.value >= 0
      const base = positive ? palette.pos : palette.neg
      const hot = positive ? palette.posHot : palette.negHot
      const alpha = (m.isTop ? 1 : minOpacity + m.ratio * (1 - minOpacity)) * age
      const cx = x + dx

      if (m.isTop) {
        // Bright core, white ring. Colour and the boost carry "this is the one",
        // so the size law underneath it stays readable for everything else.
        ctx.beginPath()
        ctx.fillStyle = rgba(hot, alpha)
        ctx.shadowColor = rgba(base, 0.95)
        ctx.shadowBlur = Math.min(size.glowPx, r * BUBBLES.glowFactor)
        ctx.arc(cx, y, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.shadowColor = 'transparent'
        ctx.beginPath()
        ctx.lineWidth = size.ringPx
        ctx.strokeStyle = `rgba(255,255,255,${0.85 * age})`
        ctx.arc(cx, y, r, 0, Math.PI * 2)
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.fillStyle = rgba(base, alpha)
        ctx.arc(cx, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
      drew++
    }
  }
  ctx.restore()
  return drew > 0
}
