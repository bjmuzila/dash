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
//               minPerSide of them on each side of that column's spot,
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

import { BUBBLES, type GexMetric } from './settings'
import { valueOf, type GexColumn } from './gexHistory'

// Removed 2026-08-29: MAX_SEGMENTS, and the stroke walk it budgeted. The layer
// stamps on a pixel cadence now (see drawBubbles), so the count is bounded by
// the pane's own width divided by the mark size — there is nothing left to cap.

// Removed 2026-08-29: `cutoffPct`, and the DUST constant before it. Both were a
// second gate on top of the row count, and with `levels` fixed at four the
// fourth-strongest strike on the board is worth drawing by definition — so all a
// share cutoff could do was silently delete a row you asked for.

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
}

/**
 * Note what is NOT in BuildOpts: no bar times, no interval, no bucket. The
 * model is a function of the GEX history alone, so it survives a candle refresh
 * and a timeframe change without being rebuilt.
 */
export function buildBubbleModel(columns: GexColumn[], opts: BuildOpts): BubbleSnapshot[] {
  const { metric } = opts
  if (!columns.length) return []

  const { levels, minPerSide, smoothWindow, dwell } = BUBBLES

  const cols = [...columns].sort((a, b) => a.slotTs - b.slotTs)

  // ── SMOOTH FIRST, THEN SELECT ─────────────────────────────────────────────
  //
  // The selection used to rank each column on its RAW |GEX|, and that is where
  // the dashes came from. Measured on a real session (1,215 columns, levels=4):
  // 25 distinct bands on screen and 158 row-endings — five rows drawn, twenty-
  // five drawn SOMEWHERE. Widening the rank slack barely moved it: hyst=16 still
  // left 20 bands and 21 breaks, and slack that wide stops meaning anything.
  //
  // The reason is that ranks 4, 5 and 6 sit within noise of each other and swap
  // every other minute. Rank slack treats the symptom; ranking on the SMOOTHED
  // series removes the noise itself, and it is the same series the radius is
  // already drawn from — so what decides a row and what sizes it finally agree.
  const union = new Set<number>()
  for (const col of cols) for (const cell of col.cells) union.add(cell.strike)
  if (!union.size) return []

  const raw = new Map<number, number[]>()
  for (const k of union) raw.set(k, new Array(cols.length).fill(0))
  cols.forEach((col, i) => {
    for (const cell of col.cells) raw.get(cell.strike)![i] = valueOf(cell, metric)
  })

  // A centred mean over `smoothWindow` snapshots either side. The minute-to-
  // minute wobble in a strike's gamma is noise at this scale — drawn as a
  // one-pixel slice of a row, it reads as lumpiness and nothing else, and
  // ranked, it reads as a row that keeps stopping. The shape that carries
  // meaning — the build through the morning, the bleed into the close —
  // survives the window untouched.
  const smoothed = new Map<number, number[]>()
  for (const k of union) {
    const r = raw.get(k)!
    const o = new Array<number>(r.length)
    for (let i = 0; i < r.length; i++) {
      let sum = 0
      let n = 0
      for (let j = i - smoothWindow; j <= i + smoothWindow; j++) {
        if (j < 0 || j >= r.length) continue
        sum += r[j]!
        n++
      }
      o[i] = n ? sum / n : 0
    }
    smoothed.set(k, o)
  }

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
  // ── AND A ROW HAS A MINIMUM LENGTH ────────────────────────────────────────
  // `dwell` is the other half of the fix above: once a row starts it draws for
  // at least that many columns, and once it would end it holds on for that many
  // more. A level worth marking held for minutes, so a band that exists for
  // ninety seconds is noise however it got selected — and a row that flickers
  // out and back is the same lie as a dashed line.
  const shownAt: Array<Set<number>> = []
  const leaderAt: number[] = []
  const drawnUnion = new Set<number>()
  // strike -> how many more columns it is entitled to, having been selected.
  const credit = new Map<number, number>()
  let prevShown: Set<number> = new Set()
  cols.forEach((col, i) => {
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
      const a = Math.abs(smoothed.get(cell.strike)![i]!)
      totalAbs += a
      if (a > 0) scored.push({ strike: cell.strike, a })
    }
    scored.sort((x, y) => y.a - x.a)
    const rankOf = new Map<number, number>()
    scored.forEach((x, i2) => rankOf.set(x.strike, i2))

    // Incumbents first — kept while they still have dwell credit — then fill
    // from the ranking. A newcomer only takes a slot an incumbent has vacated.
    //
    // There was a rank-slack term here too (`< levels + hyst`). The sweep says
    // it does nothing once the ranking reads the smoothed series: hyst 0 and
    // hyst 16 give the same 25 bands and the same breaks, because the noise it
    // was absorbing is no longer in the input. Dwell does the whole job.
    const keep = [...prevShown]
      .filter((k) => (credit.get(k) ?? 0) > 0)
      .sort((a, b) => (rankOf.get(a) ?? Infinity) - (rankOf.get(b) ?? Infinity))
    const set = new Set<number>(keep.slice(0, levels))
    // No second gate. `levels` is four, and the fourth-strongest strike on the
    // board is worth drawing by definition — a share cutoff on top of it could
    // only ever remove a row you asked for, which is exactly what it did.
    for (const x of scored) {
      if (set.size >= levels) break
      set.add(x.strike)
    }

    // ── The min-per-side swap, against THIS column's spot ──────────────────
    // Where price was at 11:00 is what decides which side an 11:00 row is on.
    if (spot > 0 && levels >= 2 * minPerSide && set.size >= 2 * minPerSide) {
      const inSet = [...set].sort((a, b) => (rankOf.get(a) ?? Infinity) - (rankOf.get(b) ?? Infinity))
      let nAbove = 0
      for (const k of inSet) if (k >= spot) nAbove++
      const nBelow = inSet.length - nAbove
      if (nAbove < minPerSide || nBelow < minPerSide) {
        const wantAbove = nAbove < minPerSide
        const swapIn = scored.find((x) => (wantAbove ? x.strike >= spot : x.strike < spot) && !set.has(x.strike))
        if (swapIn) {
          set.delete(inSet[inSet.length - 1]!)
          set.add(swapIn.strike)
        }
      }
    }

    // ── Dwell accounting. GET THIS WRONG AND EVERY ROW IS PERMANENT ───────
    // Credit is refreshed only by GENUINELY ranking in the top N. The first
    // version refreshed it for everything in `set` — including the strikes that
    // were only in `set` BECAUSE they had credit — so a row renewed its own
    // lease every column and never ended. The measured symptom was a beautiful
    // lie: 8 rows and almost no breaks over a whole session, because the eight
    // were whatever happened to be top of the board in the fixture's first
    // minute (an overnight book of round-number strikes) and nothing could ever
    // displace them. The 7710 wall holding -472B into the close was not drawn.
    //
    // So: rank inside `levels` refreshes the lease; anything else spends it.
    for (const k of set) {
      if ((rankOf.get(k) ?? Infinity) < levels) credit.set(k, dwell)
      else credit.set(k, Math.max(0, (credit.get(k) ?? 0) - 1))
    }
    for (const k of prevShown) if (!set.has(k)) credit.set(k, 0)

    prevShown = set
    shownAt.push(set)
    for (const k of set) drawnUnion.add(k)
    // This column's own leader among the drawn rows — which is the point of a
    // glow on a trail: it shows WHEN a level was the one running the board.
    let leader = -1
    let leaderRank = Infinity
    for (const k of set) {
      const r = rankOf.get(k) ?? Infinity
      if (r < leaderRank) { leaderRank = r; leader = k }
    }
    leaderAt.push(leader)
  })
  if (!drawnUnion.size) return []

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

function rgba(c: [number, number, number], a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`
}

// Removed 2026-08-28: nearestIndex() answered "which snapshot is at this pixel"
// for the old fixed-segment walk. drawBubbles now walks SNAPSHOTS and asks the
// inverse question — which pixel is this snapshot at — so nothing looks up a
// snapshot by time any more.

/**
 * Below this a mark would be sub-pixel anyway. It is the floor the size plan may
 * shrink to, so two strikes landing on the same pixel stay visible as specks
 * instead of vanishing — at that size they cannot read as one merged mark.
 */
const HAIRLINE_PX = 0.35

interface SizePlan {
  floor: number
  span: number
  rows: number
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * The size law for the WHOLE FRAME, worked out once from the reference snapshot.
 *
 * It used to be worked out inside placeMarks, per snapshot. Every term in it —
 * the pane cap and the tightest pair — was therefore re-derived from
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
 * The spacing cap reads every strike drawn ANYWHERE on the chart, not just the
 * newest column's — rows come and go through the session, and two that sat a
 * point apart at 11:00 are the pair that actually has to fit.
 */
function planSizes(ref: BubbleSnapshot, allStrikes: number[], geo: BubbleGeometry): SizePlan {
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
  // How fat a row MAY be: a fraction of the pane, railed in pixels, and never
  // more than half the tightest gap on screen less the hairline — that second
  // bound is the non-overlap guarantee and nothing is allowed to argue with it.
  const paneCap = clamp(geo.height * BUBBLES.topFrac, BUBBLES.topMinPx, BUBBLES.topMaxPx)
  const spacingCap = Number.isFinite(tightest) ? tightest / 2 - BUBBLES.gapPx / 2 : paneCap
  const top = Math.max(BUBBLES.minPx, Math.min(paneCap, spacingCap))
  // The floor cannot exceed the top, or a crowded pane would draw every row at
  // the same size and the layer would stop saying anything.
  const floorWanted = clamp(top * BUBBLES.floorOfTop, BUBBLES.floorMinPx, BUBBLES.floorMaxPx)
  const floor = Math.max(HAIRLINE_PX, Math.min(floorWanted, top * 0.85))

  return { floor, span: Math.max(0, top - floor), rows: ref.marks.length }
}

// Removed 2026-08-29: placeMarks(), which resolved a whole snapshot's marks to
// (y, r) at once. The stamp loop asks for one mark at one pixel, so the plan
// (planSizes) is the only shared part left and the per-snapshot pass is dead.

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

// Removed 2026-08-29: buildXMap()/xOf(), the sampled time->x table. It existed
// to place one stroke per snapshot without paying a binary search each; the
// stamp loop walks pixels and asks timeAtX directly, which is the same question
// the other way round and needs no table.

/**
 * ── THEY ARE BUBBLES, SO THEY ARE STAMPED ────────────────────────────────────
 *
 * A row is a chain of separate round marks laid down at a FIXED PIXEL CADENCE —
 * one every `2 × top + 2 × gapPx` across the row's span — and the gamma behind
 * each one is looked up by time at that pixel.
 *
 * Both earlier versions were continuous, and both were wrong for the same
 * reason: they took their cadence from the DATA. One stroke per snapshot at a
 * session's zoom is a thousand strokes across fifteen hundred pixels, so
 * whatever the radius, they overlap into a solid bar — and a bar is a different
 * claim than a trail. It says the level was one thing for the whole stretch,
 * where the marks say it was sampled, repeatedly, and here is what it read each
 * time. The first attempt capped stroke length instead (`MAX_STRETCH_R`), which
 * broke rows into dashes as soon as the gap between snapshots exceeded the
 * radius — the same failure from the other side.
 *
 * Cadence in PIXELS fixes both at once, because it is the only thing that is
 * constant across zooms. Spacing is derived from the mark size itself, so marks
 * are guaranteed to clear each other horizontally at every zoom by exactly the
 * same hairline that separates two rows vertically — zoom in and there are more
 * of them, zoom out and there are fewer, and it reads as a chain of bubbles
 * either way. Nothing to configure and no timeframe term anywhere.
 *
 * The cadence uses the frame's TOP radius, not each mark's own, so every row
 * stamps at the same x positions. A weak row is then a faint dotted line under a
 * wall's fat chain, aligned with it, and the eye can read down a column.
 */

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
  palette: BubblePalette,
): boolean {
  const { width: w, height: h } = geo
  if (!snaps.length || w <= 0 || h <= 0) return false

  const first = snaps[0]
  const last = snaps[snaps.length - 1]
  if (!first || !last) return false

  // Extent comes from the DATA's own time range, clamped to the pane — not from
  // a lookback in bars. This is why the trail starts where the session's gamma
  // history starts on every timeframe, with nothing to configure.
  const win = timeWindow(geo)
  if (!win) return false
  const xFirst = xAtTime(win, geo, first.ts)
  const xLast = xAtTime(win, geo, last.ts)
  const x0 = Math.max(0, Math.min(xFirst, xLast))
  const x1 = Math.min(w, Math.max(xFirst, xLast))
  if (x1 <= x0) return false

  const minOpacity = 1 - BUBBLES.fade

  // One plan for the frame — see planSizes. `top` is floor + span.
  const allStrikes = new Set<number>()
  for (const snap of snaps) for (const m of snap.marks) allStrikes.add(m.strike)
  const plan = planSizes(last, [...allStrikes], geo)
  const top = plan.floor + plan.span
  const step = Math.max(2.5, 2 * top + 2 * BUBBLES.gapPx)

  // Which snapshot a pixel belongs to. The trail is per-minute and the pane is
  // per-pixel, so this is a lookup, not an iteration: at a session's zoom one
  // stamp covers many minutes and at a tight zoom many pixels share a minute.
  const nearest = (ms: number): BubbleSnapshot | null => {
    if (ms <= first.ts) return first
    if (ms >= last.ts) return last
    let lo = 0
    let hi = snaps.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (snaps[mid]!.ts <= ms) lo = mid
      else hi = mid
    }
    const a2 = snaps[lo]!
    const b2 = snaps[hi]!
    return ms - a2.ts <= b2.ts - ms ? a2 : b2
  }

  let drew = 0
  for (let x = x0 + step / 2; x <= x1; x += step) {
    const t = geo.timeAtX(x)
    if (t == null) continue
    const snap = nearest(t)
    if (!snap) continue

    for (const m of snap.marks) {
      const y = geo.yOfPrice(m.strike)
      if (y == null || y < -20 || y > h + 20) continue
      const r = plan.floor + plan.span * Math.pow(m.ratio, BUBBLES.curve)
      if (x + r < 0 || x - r > w) continue

      const positive = m.value >= 0
      const base = positive ? palette.pos : palette.neg
      const col = m.isCore ? (positive ? palette.posHot : palette.negHot) : base
      const opacity = m.isCore ? 1 : minOpacity + m.ratio * (1 - minOpacity)

      // Plain CSS pixels: the caller has already applied a devicePixelRatio
      // transform, so multiplying by dpr here would scale it twice.
      ctx.beginPath()
      ctx.fillStyle = rgba(col, opacity)
      if (m.isCore) {
        ctx.shadowColor = rgba(base, 0.95)
        ctx.shadowBlur = Math.min(BUBBLES.glowMaxPx, Math.max(1.5, r * BUBBLES.glowFactor))
      }
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      drew++
      if (m.isCore) {
        ctx.shadowBlur = 0
        ctx.shadowColor = 'transparent'
      }
    }
  }
  return drew > 0
}
