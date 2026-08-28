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
//   SELECTION   the strongest `levels` strikes IN EACH COLUMN, with at least
//               BUBBLE_MIN_PER_SIDE of them on each side of that column's spot,
//               and a rank of hysteresis so a row does not break when two
//               strikes trade places for a minute.
//
//               Per column, so a vertical slice holds exactly `levels` rows and
//               a level that ran the board at the 11:00 high keeps its trail up
//               at the high, where it happened. A session-wide ranking cannot
//               do that: gamma grows into the bell, so the afternoon wins every
//               comparison it is in and the chart becomes the last hour drawn
//               wide.
//
//   RADIUS      |GEX| over the SESSION's biggest drawn value, not the
//               snapshot's own core. Per-snapshot normalisation renormalises
//               every quiet minute back up to full size, which is what made the
//               rows bulge and pinch like caterpillars instead of tapering. One
//               denominator means a row is comparable to itself an hour ago and
//               to the row above it.
//
//   SMOOTHING   a centred mean over SMOOTH_WINDOW snapshots, so a row carries
//               the session's shape without the minute-to-minute noise.
//
//   THE CORE    the column's own leader among the drawn rows — the glow shows
//               WHEN a level was the one running the board.
//
// ── ROWS NEVER TOUCH ─────────────────────────────────────────────────────────
//
// Two strikes' rows merging into one slab is the failure this layer is most
// prone to, and it is a lie: it draws two levels as one. planSizes() below caps
// the top radius at half the tightest on-screen gap, once for the whole frame,
// so two neighbours at full size cannot reach each other by construction.
// ─────────────────────────────────────────────────────────────────────────────

import {
  BUBBLE_STYLE,
  BUBBLE_MIN_PER_SIDE,
  autoCutoffPct,
  autoFloorPx,
  autoIntensity,
  autoLevels,
  autoTopPx,
  autoVariance,
  type GexMetric,
} from './settings'
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

/**
 * Half-width, in snapshots, of the centred mean applied to every row's series.
 *
 * A strike's gamma wobbles minute to minute, and at this scale that wobble is
 * drawn as a one-pixel slice of a row — so it reads as lumpiness and nothing
 * else. Two either side (five minutes on a 1m history) is enough to flatten it
 * while leaving the shape that carries meaning — the build through the morning,
 * the bleed into the close — completely intact.
 */
const SMOOTH_WINDOW = 2

/**
 * Rank slack for a strike already being drawn. See the selection loop: it is
 * what stops a row breaking into dashes when it trades places with its
 * neighbour for a minute.
 */
const HYST = 2

// Removed 2026-08-28: DUST, a fixed 4%-of-the-core floor. It was doing the
// cutoff's job with the wrong denominator — 4% of the biggest strike says
// nothing about whether a level matters, and it was not adjustable. `cutoffPct`
// in BuildOpts replaces it, measured against the whole board.

export interface BubbleMark {
  strike: number
  value: number
  /** |value| ÷ the snapshot's core, 0..1. This is what sets the radius. */
  ratio: number
  /**
   * |value| ÷ Σ|value| ACROSS THE WHOLE LADDER, 0..1 — this strike's share of
   * the board, the same number the GEX table prints as a percentage.
   *
   * `ratio` says how a strike compares to the biggest one; `share` says how
   * much of the day's gamma is actually parked there. They are different
   * questions and the layer needs both: ratio sizes the bubble, share decides
   * whether it is worth drawing at all. A 3% strike next to a 30% wall has
   * ratio 0.1 either way, but on a quiet board that 3% is a level and on a
   * lopsided one it is noise — only share can tell those apart.
   */
  share: number
  /** True for the strongest DRAWN strike in this snapshot. */
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
  /**
   * How many strikes to keep in TOTAL, strongest first across the board — with
   * at least BUBBLE_MIN_PER_SIDE of them on each side of spot.
   */
  levels: number
  /**
   * Drop any strike holding less than this share of the board, as a PERCENT.
   * 0 keeps everything the levels gate let through.
   *
   * Two gates, deliberately, because they answer different questions: levels
   * is "how busy do I want the chart", cutoff is "below what does a level stop
   * mattering at all". A single knob doing both is how the old DUST constant
   * ended up meaning neither.
   */
  cutoffPct: number
  /**
   * Ignore both numbers above and take them from the board instead — see
   * BUBBLE_AUTO. Read ONCE, off the newest column: `levels` and `cutoffPct` are
   * the SHAPE of the chart, and a shape that changed column by column would
   * make the row count breathe as the session scrolled past.
   */
  auto?: boolean
}

/**
 * Note what is NOT in BuildOpts: no bar times, no interval, no bucket. The
 * model is a function of the GEX history alone, so it survives a candle refresh
 * and a timeframe change without being rebuilt.
 */
export function buildBubbleModel(columns: GexColumn[], opts: BuildOpts): BubbleSnapshot[] {
  const { metric } = opts
  if (!columns.length) return []

  const live = columns[columns.length - 1]

  // ── AUTO, decided once off the newest column ──────────────────────────────
  let levels = opts.levels
  let cutoffPct = opts.cutoffPct
  if (opts.auto) {
    const absDesc = live
      ? live.cells.map((c) => Math.abs(valueOf(c, metric))).filter((v) => v > 0).sort((a, b) => b - a)
      : []
    const total = absDesc.reduce((s, v) => s + v, 0)
    if (total > 0) {
      const shares = absDesc.map((v) => v / total)
      levels = autoLevels(shares)
      cutoffPct = autoCutoffPct(shares[0] ?? 0)
    }
  }
  if (levels <= 0) return []

  const cols = [...columns].sort((a, b) => a.slotTs - b.slotTs)

  // ── TOP N AT EVERY MOMENT, AND THE HISTORY IS KEPT ────────────────────────
  //
  // The selection is made PER COLUMN, and a strike is drawn only over the
  // stretch where it was actually in the top N. A vertical slice anywhere on
  // the chart therefore holds exactly N rows — never the union of everything
  // that was ever a level — while a wall that dominated the 11:00 high keeps
  // its trail up at the high, where it happened.
  //
  // A SESSION-WIDE ranking was tried and is wrong: gamma grows into the bell,
  // so the afternoon wins every comparison it is in, an entire morning of
  // levels ranks below a mediocre 15:00 strike, and the chart becomes "the last
  // hour, drawn wide". Ranking within a column never makes that comparison.
  //
  // ── INCUMBENTS GET HYSTERESIS ─────────────────────────────────────────────
  // A hard top-N boundary is a coin flip for the strikes sitting on it: ranks N
  // and N+1 swap for a minute, both rows break, and the trail comes out as
  // dashes. A strike already being drawn keeps its place while it stays inside
  // N + HYST, so it takes a real fall out of the ladder — not a tick of noise —
  // to end a row.
  const shownAt: Array<Set<number>> = []
  const leaderAt: number[] = []
  const union = new Set<number>()
  let prevShown: Set<number> = new Set()
  for (const col of cols) {
    let spot = col.spot
    if (!(spot > 0)) {
      let lo = Infinity
      let hi = -Infinity
      for (const c of col.cells) {
        if (c.strike < lo) lo = c.strike
        if (c.strike > hi) hi = c.strike
      }
      spot = Number.isFinite(lo) && Number.isFinite(hi) ? (lo + hi) / 2 : 0
    }

    let totalAbs = 0
    const scored: Array<{ strike: number; a: number }> = []
    for (const cell of col.cells) {
      const a = Math.abs(valueOf(cell, metric))
      totalAbs += a
      if (a > 0) scored.push({ strike: cell.strike, a })
    }
    scored.sort((x, y) => y.a - x.a)
    const rankOf = new Map<number, number>()
    scored.forEach((x, i) => rankOf.set(x.strike, i))

    // Incumbents first, in their current order, then fill from the ranking — a
    // newcomer only takes a slot an incumbent has vacated.
    const keep = [...prevShown]
      .filter((k) => (rankOf.get(k) ?? Infinity) < levels + HYST)
      .sort((a, b) => (rankOf.get(a) ?? 0) - (rankOf.get(b) ?? 0))
    const set = new Set<number>(keep.slice(0, levels))
    for (const x of scored) {
      if (set.size >= levels) break
      // The cutoff is a share of THIS column's board — the same figure the GEX
      // table prints — and it only ever blocks a NEWCOMER. An incumbent dipping
      // under it keeps its row, or the gate would punch holes in a trail.
      if (totalAbs > 0 && (x.a / totalAbs) * 100 < cutoffPct) continue
      set.add(x.strike)
    }

    // ── The min-per-side swap, against THIS column's spot ──────────────────
    // Where price was at 11:00 is what decides which side an 11:00 row is on.
    if (spot > 0 && levels >= 2 * BUBBLE_MIN_PER_SIDE && set.size >= 2 * BUBBLE_MIN_PER_SIDE) {
      const inSet = [...set].sort((a, b) => (rankOf.get(a) ?? 0) - (rankOf.get(b) ?? 0))
      let nAbove = 0
      for (const k of inSet) if (k >= spot) nAbove++
      const nBelow = inSet.length - nAbove
      if (nAbove < BUBBLE_MIN_PER_SIDE || nBelow < BUBBLE_MIN_PER_SIDE) {
        const wantAbove = nAbove < BUBBLE_MIN_PER_SIDE
        const swapIn = scored.find((x) => (wantAbove ? x.strike >= spot : x.strike < spot) && !set.has(x.strike))
        if (swapIn) {
          set.delete(inSet[inSet.length - 1]!)
          set.add(swapIn.strike)
        }
      }
    }

    prevShown = set
    shownAt.push(set)
    for (const k of set) union.add(k)
    // This column's own leader among the drawn rows — which is the point of a
    // glow on a trail: it shows WHEN a level was the one running the board.
    let leader = -1
    let leaderRank = Infinity
    for (const k of set) {
      const r = rankOf.get(k) ?? Infinity
      if (r < leaderRank) { leaderRank = r; leader = k }
    }
    leaderAt.push(leader)
  }
  if (!union.size) return []

  // Dense per-strike series over the union, so the smoothing pass below is a
  // plain window. A strike is only DRAWN where shownAt says, but it is smoothed
  // over its whole history — otherwise the two ends of a row would be smoothed
  // against zeros and taper to nothing for no reason.
  const series = new Map<number, number[]>()
  for (const k of union) series.set(k, new Array(cols.length).fill(0))
  cols.forEach((col, i) => {
    for (const cell of col.cells) {
      const arr = series.get(cell.strike)
      if (arr) arr[i] = valueOf(cell, metric)
    }
  })

  // ── SMOOTHED ALONG TIME ───────────────────────────────────────────────────
  // A centred mean over SMOOTH_WINDOW snapshots. The minute-to-minute wobble in
  // a strike's gamma is noise at this scale — it is drawn as a one-pixel-wide
  // slice of a row, so it reads as lumpiness and nothing else. The shape that
  // carries meaning is the build and the bleed across the session, and that
  // survives the window untouched.
  const smoothed = new Map<number, number[]>()
  for (const k of union) {
    const raw = series.get(k)!
    const outSeries = new Array<number>(raw.length)
    for (let i = 0; i < raw.length; i++) {
      let sum = 0
      let n = 0
      for (let j = i - SMOOTH_WINDOW; j <= i + SMOOTH_WINDOW; j++) {
        if (j < 0 || j >= raw.length) continue
        sum += raw[j]!
        n++
      }
      outSeries[i] = n ? sum / n : 0
    }
    smoothed.set(k, outSeries)
  }

  // ── ONE NORMALISER FOR THE WHOLE SESSION ──────────────────────────────────
  // Radius is |GEX| over the biggest DRAWN value of the session, not over the
  // snapshot's own core — per-snapshot normalisation renormalises every quiet
  // minute back up to full size, which is what made the rows bulge and pinch
  // like caterpillars instead of tapering. One denominator means a row is
  // comparable to itself an hour ago and to the row above it.
  let sessionCore = 0
  shownAt.forEach((set, i) => {
    for (const k of set) sessionCore = Math.max(sessionCore, Math.abs(smoothed.get(k)![i]!))
  })
  if (sessionCore <= 0) return []

  const out: BubbleSnapshot[] = []
  cols.forEach((col, i) => {
    const set = shownAt[i]!
    let totalAbs = 0
    for (const cell of col.cells) totalAbs += Math.abs(valueOf(cell, metric))
    const marks: BubbleMark[] = []
    for (const k of set) {
      const value = smoothed.get(k)![i]!
      if (value === 0) continue
      marks.push({
        strike: k,
        value,
        ratio: Math.min(1, Math.abs(value) / sessionCore),
        share: totalAbs > 0 ? Math.abs(value) / totalAbs : 0,
        isCore: k === leaderAt[i],
      })
    }
    if (!marks.length) return
    marks.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    out.push({ ts: col.slotTs, marks })
  })

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
  /**
   * The TOP radius, as a multiple of the pane-height cap. The strongest strike
   * on the board draws at this; everything else is a fraction of it.
   */
  size: number
  /**
   * The smallest a drawn mark may be, in CSS pixels. Every mark that survives
   * the gates starts here and grows — so a level that is on the chart is always
   * visible, and "on the chart" is the cutoff's decision, not the size slider's.
   */
  floorPx: number
  /**
   * How hard the top strikes pull away from the rest. 1 is straight linear in
   * ratio — half the gamma, half the bubble. Above 1 only the real walls stay
   * big; below 1 the ladder flattens and the small levels stay readable.
   */
  variance: number
  intensity: number
  /**
   * Ignore the four above and take them from the pane and the snapshot instead
   * — see BUBBLE_AUTO. Evaluated per FRAME, because every factor it reads
   * (pane height, row spacing at this zoom, how bunched this snapshot is) moves
   * with the chart.
   */
  auto?: boolean
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

/**
 * Every mark in a snapshot, placed and sized so that NO TWO ROWS TOUCH.
 *
 * ── The size of a bubble means one thing ────────────────────────────────────
 *
 *   r = floor + (top − floor) × ratio^variance
 *
 * `floor` is the minimum every drawn mark gets, `top` is what the strongest
 * strike gets, and `ratio` is that strike's |GEX| over the strongest strike's.
 * Nothing else moves a radius. You can read a bubble off the GEX table and back
 * again, which is the property the layer never had before.
 *
 * ── Why the top is CAPPED, and why that is the whole trick ──────────────────
 *
 * Two strikes 13px apart cannot both be 26px bubbles, whatever the slider says.
 * Something has to give. The old code gave by DROPPING a mark, which is the
 * wrong answer in the most expensive way: a wall vanished from the chart
 * because a bigger wall happened to be next to it, and there was nothing on
 * screen to say so.
 *
 * So the LADDER'S TOP RADIUS is capped instead, measured from the tightest pair
 * actually being drawn at the current zoom. Every mark then scales by the same
 * factor, so the picture stays proportional to the numbers — it just gets
 * smaller when the pane is crowded, and the size slider takes full effect again
 * the moment the price axis opens up or the gates thin the ladder. Nothing is
 * ever deleted to make room. Removing a level is `levels` and `cutoffPct`'s
 * job, decided on the DATA, before any of this runs.
 *
 * The pane's height is the second bound on the top. Spacing alone would let six
 * marks on a tall, sparse pane grow until the ladder was mostly circle; a
 * fraction of the pane height keeps the band proportionate to the chart it is
 * drawn on, at every window size, with no per-layout pixel number to tune.
 *
 * VERTICAL SPACING IS THE ONLY BOUND. There is deliberately NO horizontal one:
 * a mark's left and right neighbours are the same strike a few pixels earlier
 * and later, and those merging is not a collision, it is the band. That is the
 * whole reason the layer can step in pixels.
 */
interface SizePlan {
  floor: number
  span: number
  variance: number
  rows: number
}

/**
 * The size law for the WHOLE FRAME, worked out once from the reference snapshot.
 *
 * It used to be worked out inside placeMarks, per snapshot. Every term in it —
 * the pane cap, the tightest pair, the variance — was therefore re-derived from
 * whichever marks that particular minute happened to hold, so a row's radius
 * moved for reasons that had nothing to do with its own gamma: a neighbour
 * missing from one column widened the tightest gap, the cap went up, and every
 * mark in that column drew fatter. Strung along a row, that is the bulging,
 * pinching caterpillar the layer kept producing.
 *
 * One plan for the frame means the only thing that varies along a row is the
 * strike's own |GEX| at that minute — which is the whole point of drawing it as
 * a trail rather than a straight line.
 *
 * The variance and the crowd trim read the NEWEST snapshot — how busy the chart
 * is right now — while the spacing cap reads every strike drawn anywhere, since
 * that is the pair that actually has to fit.
 */
function planSizes(
  ref: BubbleSnapshot,
  allStrikes: number[],
  geo: BubbleGeometry,
  opts: DrawOpts,
): SizePlan {
  // The spacing cap is measured over EVERY strike drawn anywhere on the chart,
  // not just the newest column's. Rows come and go through the session, and two
  // that sat a point apart at 11:00 are the pair that has to fit — sizing off
  // the current column alone would let them overlap back there, which is the
  // one thing this layer must never do.
  const ys: number[] = []
  for (const strike of allStrikes) {
    const y = geo.yOfPrice(strike)
    if (y != null) ys.push(y)
  }
  ys.sort((a, b) => a - b)

  // The tightest pair ON SCREEN — not the ladder's strike step, which with four
  // rows on the board is tens of strikes away from the real gap.
  let tightest = Infinity
  for (let i = 1; i < ys.length; i++) {
    const gap = ys[i]! - ys[i - 1]!
    if (gap < tightest) tightest = gap
  }

  // The pane cap answers "how big MAY the ladder be" from the window; auto
  // answers "how big SHOULD it be" from the window and the row count. The
  // spacing cap is untouched either way — it is the non-overlap guarantee and
  // neither of them is allowed to argue with it.
  // The crowd trim reads the LIVE row count, not the union: how busy the chart
  // looks right now is a question about what is on it now.
  const paneCap = opts.auto
    ? autoTopPx(geo.height, ref.marks.length)
    : geo.height * BUBBLE_STYLE.heightFrac * opts.size
  const spacingCap = Number.isFinite(tightest) ? tightest / 2 - BUBBLE_STYLE.gapPx / 2 : paneCap
  const top = Math.max(BUBBLE_STYLE.minPx, Math.min(paneCap, spacingCap))
  // The floor cannot exceed the top, or a crowded pane would draw every mark at
  // the same size and the layer would stop saying anything.
  const floorWanted = opts.auto ? autoFloorPx(top) : opts.floorPx
  const floor = Math.max(HAIRLINE_PX, Math.min(floorWanted, top * 0.85))

  // The exponent, on auto, is measured off the reference's spread: the median
  // row's ratio to the core. Bunched (median near 1) and a linear law draws
  // near-identical bands, so it steepens; a real wall pulls the median down and
  // it goes back to linear, because the numbers already separate.
  let variance = opts.variance
  if (opts.auto) {
    const ratios = ref.marks.map((m) => m.ratio).sort((a, b) => b - a)
    variance = autoVariance(ratios.length ? ratios[Math.floor(ratios.length / 2)]! : 0)
  }

  return { floor, span: Math.max(0, top - floor), variance, rows: ref.marks.length }
}

/**
 * One snapshot's marks placed against the frame's plan.
 *
 * No fitting pass any more: `top` is capped at half the tightest on-screen gap
 * less the hairline, so two neighbouring rows at full size cannot reach each
 * other by construction. The old pairwise shrink was correcting a cap that was
 * re-derived per snapshot and could therefore be wrong; with one plan it cannot.
 */
function placeMarks(snap: BubbleSnapshot, geo: BubbleGeometry, plan: SizePlan): PlacedMark[] {
  const placed: PlacedMark[] = []
  for (const mark of snap.marks) {
    const y = geo.yOfPrice(mark.strike)
    if (y == null) continue
    const shaped = plan.variance <= 1.001 && plan.variance >= 0.999
      ? mark.ratio
      : Math.pow(mark.ratio, plan.variance)
    placed.push({ mark, y, r: plan.floor + plan.span * shaped })
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
 * Rows are drawn as CONTINUOUS ribbons: each snapshot's stroke reaches half way
 * to its neighbours on both sides, so consecutive strokes meet exactly and a
 * row is unbroken from its first minute to its last.
 *
 * There used to be a cap here — a mark could stretch no further than 0.8 of its
 * own radius — to stop a single minute smearing across a zoomed-in pane. With
 * thin marks that cap is what BROKE the rows: at any zoom where the gap between
 * snapshots exceeded the radius, the strokes stopped short of each other and the
 * row came out as a dotted line, which is what the weak levels looked like.
 *
 * A level that held for an hour is one thing for that hour, so a solid row is
 * also the truer picture. Its thickness still carries the history — that is what
 * the per-snapshot radius is for — and the smoothing pass in buildBubbleModel
 * makes that thickness change gradually enough to read as a taper rather than a
 * chain of beads.

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

  // Row count off the newest snapshot: it is the one the reader is looking at,
  // and taking it per snapshot would make the layer's opacity flicker along the
  // trail as marks came and went.
  const layerAlpha = Math.max(0.05, Math.min(1, opts.auto ? autoIntensity(last.marks.length) : opts.intensity))
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
  // to its neighbours, meeting them exactly, so a row is one unbroken ribbon.
  const centres: number[] = []
  for (const snap of snaps) centres.push(xOf(map, snap.ts) ?? -1)

  // At a session's zoom there are more snapshots than pixels; drawing all of
  // them is thousands of redundant strokes for the same band. Stride so the
  // count stays bounded — the old MAX_SEGMENTS budget, spent on snapshots.
  const stride = Math.max(1, Math.ceil(snaps.length / MAX_SEGMENTS))

  // ONE size plan for the frame. See planSizes.
  const allStrikes = new Set<number>()
  for (const snap of snaps) for (const m of snap.marks) allStrikes.add(m.strike)
  const plan = planSizes(last, [...allStrikes], geo, opts)

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
      placed = placeMarks(snap, geo, plan)
      placedBySnap.set(i, placed)
    }

    for (const { mark: m, y, r } of placed) {
      if (y < -20 || y > h + 20) continue
      const half = gap / 2
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
