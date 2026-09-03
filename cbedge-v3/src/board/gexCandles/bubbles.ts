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
// window max; peers carry the sign colour flat and the bucket's biggest gets a
// boost, a GOLD gradient core and a ring in its own sign colour; same-bucket
// neighbours shrink and then jitter rather than overlap; nothing is ever
// spliced.
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
// and the caller takes it from the BAR INTERVAL — so the timeframe picker moves
// the bubbles, which is what anyone clicking it expects. The zoom decides only
// how many of those buckets fit, via the stride in drawBubbles.
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

/**
 * ── ONE GOLD MARK PER BUCKET; EVERYTHING ELSE IS THE SIGN ────────────────────
 *
 * `pos` / `neg` are the SATURATED sign colours (`--color-gex-pos` `#29b6f6`,
 * `--color-gex-neg` `#ff4757`) and they are the PEERS' fill. Blue is positive
 * gamma, red is negative, and that is the first thing the ladder has to say.
 * They are also the leader's RING and its glow — which is where the leader's
 * own sign comes from, since its core is not a sign colour at all.
 *
 * `lead` / `leadHi` (`--color-gex-lead` `#ffb300`, `--color-gex-lead-hi`
 * `#ffd76a`) are the leader's core, painted as a radial gradient: white at the
 * highlight, `leadHi` through the middle, `lead` at the rim.
 *
 * ── Why gold, and why only the leader ───────────────────────────────────────
 * Gold already means "the wall" everywhere else on this card — the CB tag on
 * the rail, the amber half of the GEX bars — so one hue carries one idea, and
 * a glance finds the biggest wall without reading anything.
 *
 * Only the leader, because gold on EVERY mark was tried on the mock sheet and
 * fails at the small end: rows 2-4 draw at 2-4px, and a gold fill with a 0.7px
 * sign ring is an olive smudge at that size — the sign is simply gone. Peers
 * keep a flat, saturated sign colour for the same reason they always have.
 *
 * (Before 2026-09-03 the leader was a pale tint of its own sign,
 * `--color-gex-pos-hot` / `-neg-hot`. Both tints were near-white and
 * near-identical to each other at 3px, so the core said "leader" but never said
 * which way — the ring was already doing that work alone. Do not go back to it,
 * and do not fill the peers with a tint either: that was tried on 2026-08-31
 * and cost the sign across the whole ladder.)
 */
export interface BubblePalette {
  pos: [number, number, number]
  neg: [number, number, number]
  /** The leader's gradient rim. */
  lead: [number, number, number]
  /** …and its mid-stop, between the white highlight and the rim. */
  leadHi: [number, number, number]
  /**
   * The gradient's innermost stop — the specular highlight on the leader's
   * core. A token (`--color-fg`), not a hardcoded white, so a light theme can
   * move it with everything else.
   */
  highlight: [number, number, number]
}

export interface BubbleGeometry {
  /**
   * Pixel x of an instant — ANCHORED ON THE BAR THAT CONTAINS IT.
   *
   * ── This is the alignment contract, and it is the whole reason the layer ──
   * A bucket's x must be the x of its CANDLE: four bubbles over four candles
   * have to sit on those four candles, not between them. The chart supplies
   * this by binary-searching its real bar array for the bar containing `ms`,
   * asking lightweight-charts for that bar's coordinate (which is the bar's
   * CENTRE), and then adding the sub-bar fraction × barSpacing. So a bucket
   * whose timestamp IS a bar's open lands exactly on that candle, and a finer
   * bucket inside a coarser bar lands proportionally across it.
   *
   * Null off the ends of the series — before the first bar, or more than two
   * bars past the last. NOT null merely for being scrolled off screen: the
   * coordinate is real and negative (or past the width) and the draw culls it,
   * which is what keeps a panned-away bucket from being pinned to an edge.
   */
  xOfTime: (ms: number) => number | null
  /**
   * The instant at a pixel x. Quantised to a bar — lightweight-charts'
   * coordinateToTime() answers with the NEAREST bar's time, not a continuous
   * inverse — so it is used only to pick an anchor near the middle of the plot,
   * never to place a mark. Placing with it is what put every bubble half a bar
   * off its candle: binary-searching a step function converges on the STEP, and
   * the step between two bars is the midpoint between their centres.
   */
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

const hexByte = (v: number): string =>
  Math.max(0, Math.min(255, Math.round(v)))
    .toString(16)
    .padStart(2, '0')

/**
 * A palette triple at an alpha, as `#rrggbbaa`.
 *
 * Hex and not a functional colour notation on purpose: `rgba()` / `hsla()` are
 * banned from src/ by scripts/check-theme.mjs (non-negotiable #1 in AGENTS.md),
 * and the 8-digit hex form is accepted by every canvas fill, stroke, shadow and
 * gradient stop. Same reasoning — and the same output — as tokenHexAlpha() in
 * src/design/theme.ts; this one takes the channels the palette already carries
 * rather than re-reading a token per mark, because it runs inside the chart's
 * rAF for every bubble on screen.
 */
function shade(c: [number, number, number], a: number): string {
  return `#${hexByte(c[0])}${hexByte(c[1])}${hexByte(c[2])}${hexByte(Math.max(0, Math.min(1, a)) * 255)}`
}

// ── WHERE A BUCKET GOES, AND WHY IT IS NO LONGER SEARCHED FOR ────────────────
//
// There used to be a `timeWindow()` + `xAtTime()` pair here: probe the plot for
// the x-range where `timeAtX()` answers, then binary-search that range for the
// x whose time is the bucket's. It was wrong, and it was wrong by HALF A BAR,
// every mark, always.
//
// `timeAtX()` is `coordinateToTime()`, and that is a STEP function: it reports
// the nearest bar's time, so it holds one value across a whole bar and jumps at
// the boundary. A binary search on `t < ms` cannot land in the middle of a step
// — it converges on the step itself, which sits at the MIDPOINT BETWEEN TWO BAR
// CENTRES. So every bucket was stamped on the seam between its candle and the
// one before it. Four bubbles over four candles came out visibly offset, which
// is exactly what it looked like.
//
// The chart knows its own bars, so it answers directly instead:
// `geo.xOfTime()` finds the containing bar, takes that bar's centre from
// `timeToCoordinate()`, and interpolates inside it. See BubbleGeometry.xOfTime.
// Nothing in here searches for a position any more.

/**
 * TWO budgets, because only ONE axis is crowded.
 *
 * `capPx` / `floorPx` / `topCapPx` are the HORIZONTAL half-width, and they are
 * what the bucket spacing bounds — the gap to the next bucket is the only thing
 * a mark can fuse across. `capYPx` / `floorYPx` / `topCapYPx` are the VERTICAL
 * half-height, which the spacing has nothing to say about: two strikes in a
 * bucket are tens of pixels apart on the price axis, and placeBucket's fit pass
 * already guarantees the ones that are not clear each other.
 *
 * ── AND THE TWO ARE ONLY DIFFERENT AT 1m ──────────────────────────────────
 * The split exists for one rung. At 1m a session view leaves ~3.4px of spacing,
 * a circle spends that on BOTH axes, all four rows land on `minPx` and the size
 * channel is dead. At 5m and coarser the profile cap binds first, the rows
 * already rank by eye, and the marks are round — that picture is correct and is
 * not to be changed. So the ratio lives in the rung's own profile
 * (`BUBBLES.profiles[n].aspect`) and every rung but 1m carries `aspect: 1`,
 * which makes `capYPx === capPx`, `floorYPx === floorPx`,
 * `topCapYPx === topCapPx`, and the ellipse a circle again.
 */
interface SizeProfile {
  capPx: number
  floorPx: number
  capYPx: number
  floorYPx: number
  topBoost: number
  /** Hard ceiling on the boosted leader — its own share of the spacing. */
  topCapPx: number
  topCapYPx: number
  /**
   * The rung's rank-vs-gamma blend, 0 at every rung but 1m. See
   * BUBBLES.profiles and the size law above placeBucket.
   */
  rankMix: number
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

  // ── 4. THE VERTICAL BUDGET, WHICH THE SPACING DOES NOT BOUND ──────────────
  // Everything above is the horizontal half-width and every one of its bounds
  // is the gap to the NEXT BUCKET. None of that applies going up and down: the
  // neighbour in y is another strike, tens of pixels away, and placeBucket's
  // fit pass owns the case where it is not.
  //
  // So the vertical budget is the rung's own profile, unshrunk — capped only
  // against the horizontal one by that rung's `aspect`, so a mark stays an oval
  // and does not become a bar.
  //
  // `aspect` is 1 everywhere except 1m, and at 1 the `Math.max(capPx, …)`
  // collapses each of these onto its horizontal twin: same cap, same floor,
  // same leader ceiling, `rx === ry`, and a circle of exactly the radius the 5m
  // and coarser rungs have always drawn. That is deliberate — 1m is the only
  // rung where the spacing runs out, and it is the only one this touches.
  const aspect = Math.max(1, p.aspect)
  const capYPx = Math.max(capPx, Math.min(p.capPx * scale, capPx * aspect))
  const topCapYPx = Math.max(topCapPx, Math.min(p.capPx * p.topBoost * scale, topCapPx * aspect))

  return {
    capPx,
    floorPx: Math.max(BUBBLES.minPx, Math.min(p.floorPx * scale, capPx * BUBBLES.floorOfCap)),
    capYPx,
    // The floor is a fraction of the budget it belongs to, so the vertical one
    // gets the vertical cap. Using the horizontal floor here would leave the
    // tall marks starting from a squashed bottom and reintroduce the flat-dot
    // look at the small end. At `aspect: 1` this is the same expression as
    // `floorPx` above, to the character.
    floorYPx: Math.max(BUBBLES.minPx, Math.min(p.floorPx * scale, capYPx * BUBBLES.floorOfCap)),
    topBoost: p.topBoost,
    topCapPx,
    topCapYPx,
    rankMix: p.rankMix,
    glowPx: Math.max(0, Math.min(BUBBLES.glowMaxPx, spare)),
    ringPx: p.ringPx * scale,
  }
}

interface Placed {
  mark: BubbleMark
  y: number
  /** Half-width. Bounded by the bucket spacing — this is the axis that fuses. */
  rx: number
  /** Half-height. Bounded by the profile and by the fit pass, not by spacing. */
  ry: number
  dx: number
}

/**
 * One bucket's marks, sized and then fitted so they do not overlap.
 *
 * ── The size law ──────────────────────────────────────────────────────────
 *   t  = (1 - rankMix) x (|gex| / windowMax) ** sizeCurve  +  rankMix x rank
 *   rx = floorPx  + t x (capPx  - floorPx),   x boost, capped at topCapPx
 *   ry = floorYPx + t x (capYPx - floorYPx),  x boost, capped at topCapYPx
 *
 * Compressive rather than linear because the top strike is routinely five to ten
 * times its neighbours: a linear law hands it the whole budget and leaves
 * everything else as identical specks at the floor. Under the curve a strike
 * holding a quarter of the max still draws at about a third of the range, so
 * the ladder stays rankable — and the top still stands apart, by the boost and the ring rather
 * than by flattening everything under it.
 *
 * `rankMix` is the guarantee underneath that: it reserves a slice of the budget
 * for the row's PLACE in its bucket, so rows 1-4 differ in size even when their
 * gamma does not — four near-equal strikes, or a quiet bucket where the whole
 * ladder sits near the floor. Both of those drew as four identical specks.
 *
 * `rx` and `ry` come off the SAME `t` and differ only in their budgets — see
 * SizeProfile for why the vertical one is bigger and what it fixed at 1m. One
 * `t` for both keeps a mark's shape constant as it grows, so the small marks
 * are the same family as the big ones rather than a different one.
 *
 * ── BOTH OF THOSE ARE 1m-ONLY ─────────────────────────────────────────────
 * `rankMix` and the vertical budget's `aspect` are per-rung, and every rung
 * above 1m carries the identity values (0 and 1). At 5m and coarser this law
 * reduces, term for term, to the one that was there before them: a circle of
 * radius `floorPx + ratio ** sizeCurve x (capPx - floorPx)`. That picture was
 * right; nothing here changes it.
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
  // `marks` arrives biggest-first, so the index IS the rank.
  const n = Math.max(1, snap.marks.length)
  for (let i = 0; i < snap.marks.length; i++) {
    const mark = snap.marks[i]!
    const y = geo.yOfPrice(mark.strike)
    if (y == null) continue

    // ── ONE POSITION ALONG THE BUDGET, SPENT ON BOTH AXES ───────────────────
    // `t` is 0..1 and it is the whole size decision; rx and ry then just read
    // it off their own budgets. Deriving both from one number is what keeps a
    // mark's shape constant as it grows — the alternative, sizing each axis
    // from its own curve, makes the small marks a different SHAPE from the big
    // ones and the ladder stops reading as one family of marks.
    //
    // Two terms:
    //   byGex   the row's share of the window max, compressed by `sizeCurve`.
    //           The honest read, and most of the answer.
    //   byRank  its position in its own bucket, 1st..nth → 1 .. 1/n. This is
    //           what makes rows 1-4 different sizes when the gamma alone would
    //           not: four strikes within a few percent of each other, or a
    //           quiet bucket where every row lands near the floor, both used to
    //           draw as four identical specks.
    // The blend is monotone in the rank and the marks are already sorted by
    // |netGex|, so nothing about the ORDER changes.
    //
    // `rankMix` IS PER RUNG AND IS ZERO ABOVE 1m. 5m and coarser rank by eye on
    // the gamma alone — that picture was right and is untouched — so there the
    // second term drops out and `t` is the plain `ratio ** sizeCurve` it has
    // always been. See BUBBLES.profiles.
    const byGex = Math.pow(mark.ratio, BUBBLES.sizeCurve)
    const byRank = 1 - i / n
    const t = size.rankMix > 0
      ? clamp((1 - size.rankMix) * byGex + size.rankMix * byRank, 0, 1)
      : byGex

    const bx = size.floorPx + t * (size.capPx - size.floorPx)
    const by = size.floorYPx + t * (size.capYPx - size.floorYPx)
    rows.push({
      mark,
      y,
      rx: mark.isTop ? Math.min(bx * size.topBoost, size.topCapPx) : bx,
      ry: mark.isTop ? Math.min(by * size.topBoost, size.topCapYPx) : by,
      dx: 0,
    })
  }
  rows.sort((a, b) => a.y - b.y)

  // The fit is VERTICAL and so it spends `ry`. Shrinking `rx` here would give
  // back width that was never the problem — the neighbour in y is a different
  // strike, not a different bucket — and would cost the size read twice over.
  for (let pass = 0; pass < BUBBLES.fitPasses; pass++) {
    let tightened = false
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1]!
      const b = rows[i]!
      const room = b.y - a.y - BUBBLES.gapPx
      const sum = a.ry + b.ry
      if (sum <= room) continue
      const f = room > 0 ? room / sum : 0
      a.ry = Math.max(BUBBLES.minPx, a.ry * f)
      b.ry = Math.max(BUBBLES.minPx, b.ry * f)
      tightened = true
    }
    if (!tightened) break
  }

  // A mark is never WIDER than it is tall. The budgets start out with the
  // vertical at least equal to the horizontal, but a hard vertical squeeze can
  // push `ry` under `rx`, and a wide flat dot is the shape this whole change is
  // getting away from.
  for (const row of rows) row.rx = Math.min(row.rx, row.ry)

  // Still colliding at the floor — the price scale is squeezed, or two strikes
  // are a fraction apart. Step them sideways in alternating directions.
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]!
    const b = rows[i]!
    if (b.y - a.y - BUBBLES.gapPx >= a.ry + b.ry) continue
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
   * True only when the user PINNED the bucket with the 1m / 5m tiles. It
   * loosens the stride to BUBBLES.pinnedPxPerDot, which trades size for density
   * — read that constant before passing this.
   *
   * NOT true for the ordinary interval-driven bucket. The interval changes the
   * bucket, which is what makes the picker visible; the stride is a separate,
   * legibility question and its answer is BUBBLES.bucketPxPerDot.
   */
  pinned = false,
): boolean {
  const { width: w, height: h } = geo
  if (!snaps.length || w <= 0 || h <= 0) return false
  // Bounds are the PLOT's, not the canvas's: the price scale owns the right
  // ~60px and the time axis the bottom ~26px, and a mark belongs in neither.
  const pw = Math.max(1, Math.min(geo.plotWidth, w))
  const ph = Math.max(1, Math.min(geo.plotHeight, h))

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
  // up zoomed in: it reported the plot's own width for a whole day of snapshots
  // no matter how far in you were, the bucket looked a fraction of a pixel wide,
  // and the stride threw away almost everything. Two instants one bucket apart,
  // near the middle of the plot, is the question actually being asked.
  //
  // `timeAtX` is only the ANCHOR here — a bar's time near the middle of the
  // pane, which is all a step function can honestly give — and both ends of the
  // measurement then go through `xOfTime`, the bar-anchored one the marks are
  // placed with. Measuring with anything else would size the trail against a
  // spacing it is not drawn at.
  //
  // Anchors are tried in order and the first that yields a real gap wins: the
  // pane's midpoint normally, then snapshots, so a pane whose middle is sitting
  // in whitespace still gets a spacing instead of falling back to stride 1.
  const anchors: number[] = []
  const tMid = geo.timeAtX(pw / 2)
  if (tMid != null) anchors.push(tMid)
  anchors.push(snaps[snaps.length >> 1]!.ts, last.ts, first.ts)
  let pxPerDot = 0
  for (const t of anchors) {
    const a = geo.xOfTime(t)
    if (a == null) continue
    const b = geo.xOfTime(t + bucketMs) ?? geo.xOfTime(t - bucketMs)
    if (b == null) continue
    const d = Math.abs(b - a)
    if (d > 0) { pxPerDot = d; break }
  }

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
  // This is what makes any rung safe at any zoom: zoom in and the stride falls
  // back to 1 and every bucket is there again.
  //
  // The target is the LEGIBLE spacing (BUBBLES.bucketPxPerDot, 11px), not a bare
  // "they don't touch" minimum, and that is a size decision as much as a density
  // one: the marks are capped at `capOfSpacing` of the spacing they are strided
  // to, so a smaller target buys more dots by making every one of them smaller,
  // until they are all sitting on `minPx` and the four rows of a bucket are one
  // size. Striding to a 2.5px floor did exactly that past a ~2h window.
  //
  // It no longer flattens the cadence controls, because the BUCKET is no longer
  // chosen by the pane: a 1m bucket strided to 11px still draws different dots,
  // at a different size, from a 5m bucket strided to 11px. Only an explicit PIN
  // loosens this — see BUBBLES.pinnedPxPerDot.
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
    // ON ITS CANDLE. xOfTime anchors the bucket to the bar that contains it —
    // see BubbleGeometry.xOfTime for why nothing here searches for the x.
    const x = geo.xOfTime(snap.ts)
    // Off the ends of the series: before the first bar, or past the last with
    // no candle to belong to. Not a position, so not drawn — this is what stops
    // a stale morning of GEX being stacked onto the closing bar, or a column of
    // bubbles floating in the whitespace to the right of the newest candle.
    if (x == null) continue
    // Scrolled out of the pane. A real coordinate, just not one on screen.
    if (x < -40 || x > pw + 40) continue
    // Age fades opacity only a LITTLE — the oldest bucket keeps `ageKeep` of it.
    // A trail that fades to nothing is a trail you cannot read the morning off,
    // and the morning is half of why it is drawn.
    const age = BUBBLES.ageKeep + (1 - BUBBLES.ageKeep) * ((snap.ts - first.ts) / span)

    for (const { mark: m, y, rx, ry, dx } of placeBucket(snap, geo, size)) {
      if (y < -20 || y > ph + 20) continue
      const positive = m.value >= 0
      // The SATURATED sign colour: the PEERS' fill, and the leader's ring+glow.
      const base = positive ? palette.pos : palette.neg
      const alpha = (m.isTop ? 1 : minOpacity + m.ratio * (1 - minOpacity)) * age
      const cx = x + dx

      if (m.isTop) {
        // ── THE ONE GOLD MARK ─────────────────────────────────────────────────
        // The leader is the biggest wall in its bucket and it says so in gold —
        // the same hue as the CB tag on the rail and the amber half of the GEX
        // bars. A radial gradient rather than a flat fill: white highlight,
        // `leadHi` through the middle, `lead` at the rim. The highlight is what
        // keeps a 4px mark reading as a lit sphere instead of a mustard dot, and
        // the rim is what keeps a 20px one from being a flat disc.
        //
        // The gradient is built in the mark's OWN space. Painting it in canvas
        // coordinates makes it circular while the mark is an oval, so at 1m the
        // rim colour lands at the top and bottom of a tall mark and never
        // reaches its sides. Scaling y by ry/rx, drawing a circle, then undoing
        // the transform gives an ellipse whose gradient is concentric with it —
        // and the path survives restore(), so the ring below still strokes at a
        // uniform width instead of being squashed with it.
        ctx.save()
        ctx.translate(cx, y)
        ctx.scale(1, ry / Math.max(0.001, rx))
        ctx.beginPath()
        ctx.arc(0, 0, rx, 0, Math.PI * 2)
        const grad = ctx.createRadialGradient(-rx * 0.24, -rx * 0.3, rx * 0.05, 0, 0, rx)
        grad.addColorStop(0, shade(palette.highlight, alpha))
        grad.addColorStop(0.5, shade(palette.leadHi, alpha))
        grad.addColorStop(1, shade(palette.lead, alpha))
        ctx.fillStyle = grad
        // The glow is the SIGN colour, held to `glowAlpha` and faded with age so
        // it stays a halo AROUND the mark. Measured off the WIDTH: the room it
        // has to spread into is the gap to the next bucket, which is the bound
        // `rx` already carries. Sizing it off the taller axis would put the halo
        // back across that gap, which is what fused the leader's row into a
        // sausage.
        ctx.shadowColor = shade(base, BUBBLES.glowAlpha * age)
        ctx.shadowBlur = Math.min(size.glowPx, rx * BUBBLES.glowFactor)
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.shadowColor = 'transparent'
        ctx.restore()
        // ── AND THE RING IS THE SIGN ──────────────────────────────────────────
        // It used to be white, on a core that already carried a cast of its own
        // sign. The core is gold now and carries none, so this ring is the only
        // thing saying whether the biggest wall is positive or negative gamma —
        // which is why it is the saturated colour at near-full alpha and not a
        // tint.
        ctx.lineWidth = size.ringPx
        ctx.strokeStyle = shade(base, 0.95 * age)
        ctx.stroke()
      } else {
        // The peers are the SIGN, at full strength. Blue is positive gamma and
        // red is negative, and that is the first thing the ladder has to say.
        // Flat, and NOT gold with a sign ring: rows 2-4 draw at 2-4px and at
        // that size a fill plus a sub-pixel ring is one olive smudge.
        ctx.beginPath()
        ctx.fillStyle = shade(base, alpha)
        ctx.ellipse(cx, y, rx, ry, 0, 0, Math.PI * 2)
        ctx.fill()
      }
      drew++
    }
  }
  ctx.restore()
  return drew > 0
}
