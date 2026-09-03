// ─────────────────────────────────────────────────────────────────────────────
// GEX Candles — persisted settings and the frozen bubble constants.
//
// v2 keeps these in a "slot" blob so three charts on one page can share a
// toolbar. v3's chart is a board CARD, and the board already gives each
// card its own identity, so this is one blob per card id — same idea, one less
// level of indirection, and no shared/own mirror to keep in sync.
//
// The bubble layer has no settings — see BUBBLES below for the eleven numbers
// that replaced six sliders and an Auto mode, and for why each one survived.
// ─────────────────────────────────────────────────────────────────────────────

import { normalizeSymbol } from './symbols'

export type Session = 'rth' | 'eth'
export type GexMetric = 'voloi' | 'vol'
export type Interval = 1 | 5 | 15 | 30 | 60

export const INTERVALS: Interval[] = [1, 5, 15, 30, 60]
export const INTERVAL_LABEL: Record<Interval, string> = {
  1: '1m',
  5: '5m',
  15: '15m',
  30: '30m',
  60: '1h',
}

/**
 * Which time bucket the bubbles aggregate at. Storage is always one column per
 * MINUTE; this is a DRAW-time aggregation.
 *
 * 'auto' is the default and the right answer almost always: FOLLOW THE BAR
 * INTERVAL, clamped into `BUBBLES.bucketRungsMin` — one bubble per bar on 1m and
 * 5m, and a 5m bucket on 15m and coarser, where the ladder caps.
 *
 * It used to mean "follow the pane": the smallest rung whose dots landed far
 * enough apart, re-picked on every zoom. That is why the interval picker did
 * nothing to this layer, and why 1m bubbles only appeared once you had zoomed
 * most of the way in.
 *
 * 1 and 5 are MANUAL overrides, and they override the BUCKET, not the stride: a
 * forced 1m on a whole session still strides, because 975 dots do not fit in
 * 1500px whatever anyone picked.
 *
 * (v2's slotStore carries the same three values plus a legacy 'bar' spelling,
 * which is the pre-rename name for 'auto'. v3 has no blobs old enough to hold
 * it, so it is not accepted here.)
 */
export type BubbleBucket = 1 | 5 | 'auto'
export const isBubbleBucket = (v: unknown): v is BubbleBucket => v === 1 || v === 5 || v === 'auto'
/**
 * Does this bucket follow the bar interval, rather than pin a rung?
 *
 * A type predicate, not a plain boolean: the false branch is where a pinned
 * bucket gets handed to ChartDrawOpts.bucketMin, which is `1 | 5 | null`.
 * Returning boolean leaves 'auto' in the type there and `tsc --noEmit` fails
 * the v3 build at GexCandlesCard.tsx:408.
 */
export const isAutoBucket = (v: BubbleBucket): v is 'auto' => v === 'auto'
/** What a fresh card starts on. */
export const BUBBLE_BUCKET_DEFAULT: BubbleBucket = 'auto'

/**
 * The Bubble size slider's range.
 *
 * Half-size to two-and-a-half. The bottom is where a mark is still a mark
 * rather than a speck — BUBBLES.minPx is the hard floor underneath it and no
 * scale can go below that. The top is generous on purpose: at a wide zoom the
 * spacing bound has already shrunk the marks hard, so a 1.4 that looks big on a
 * half-hour view is barely visible across a session, and a ceiling tuned for
 * the tight case would make the slider useless in the loose one.
 */
export const BUBBLE_SCALE_MIN = 0.5
export const BUBBLE_SCALE_MAX = 2.5
export const BUBBLE_SCALE_STEP = 0.1

/** A stored (or absent) scale, coerced into range. Anything unusable is 1. */
export function clampScale(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 1
  return Math.min(BUBBLE_SCALE_MAX, Math.max(BUBBLE_SCALE_MIN, n))
}

export interface ChartSettings {
  symbol: string
  session: Session
  interval: Interval
  /** Master on/off for the whole bubble layer. */
  bubblesOn: boolean
  /** Which GEX quantity a bubble is sized by. Also what the rail lists. */
  gexMetric: GexMetric
  /** The forming-bar countdown in the top-right corner. */
  countdown: boolean
  /** The strike ladder down the right-hand side, pinned to the price axis. */
  railOn: boolean
  /**
   * Which expiry the bubbles draw. '' follows the NEAREST, which is the
   * default and the eventual permanent behaviour; a value pins it, which is
   * what the toolbar dropdown is for.
   *
   * A pinned expiry that is not in the current symbol's list is ignored rather
   * than erroring — that is what happens on every symbol change, since SPX's
   * dates are not AMZN's.
   */
  expiry: string
  /**
   * The bubble time bucket: 'auto' follows the BAR INTERVAL, 1 or 5 pins the
   * rung. See BubbleBucket.
   */
  bubbleBucket: BubbleBucket
  /**
   * Overall bubble size, as a MULTIPLIER on the tuned defaults. 1 is those
   * defaults exactly — sizeFor()'s arithmetic is the same expression at 1, so
   * this cannot drift the resting look.
   *
   * A multiplier rather than a pixel size on purpose. The numbers in BUBBLES
   * are a system: cap, floor, boost, ring and glow are in proportion to each
   * other AND to the measured spacing between dots, and handing one of them out
   * to be set absolutely breaks every relationship the layer was tuned around.
   * One dial over the whole system keeps them and just makes the picture bigger
   * or smaller, which is what "I want them bigger" actually means.
   *
   * These two are now the only bubble settings the user has; everything else
   * about the layer is the frozen BUBBLES block above.
   */
  bubbleScale: number
  /**
   * ES FUTURES CANDLES under SPX gamma — v2's original pairing, back as a
   * per-card switch (2026-09-02). Only meaningful while the page symbol is
   * SPX: the gamma stays `$SPX`, the candles come off `es_candles` + the
   * socket's `esCandles` / `es1mCandles` frames, and every strike is pushed
   * through the ES−SPX basis (/proxy/es-spx-basis) before it is drawn. On any
   * other symbol the flag is ignored — there is no futures tape for AMZN.
   */
  esCandles: boolean
}

export const DEFAULT_SETTINGS: ChartSettings = {
  symbol: 'SPX',
  session: 'eth',
  interval: 5,
  bubblesOn: true,
  gexMetric: 'voloi',
  countdown: true,
  // On by default: the rail is the numbers behind the bubbles, and a bubble
  // layer with no way to read the figure it is drawn from is half a feature.
  railOn: true,
  expiry: '',
  bubbleBucket: BUBBLE_BUCKET_DEFAULT,
  bubbleScale: 1,
  esCandles: false,
}

/**
 * ── THE BUBBLE LAYER ─────────────────────────────────────────────────────────
 *
 * There are no settings. Bubbles are on or off; everything below is fixed, and
 * every number is here because removing it changes the picture in a way you can
 * name. The rules it implements, in order:
 *
 *   1 bubble per bucket        the trail is a SAMPLE, not a line. Bucket to 1m
 *                              or 5m by the BAR INTERVAL, last print in the
 *                              bucket wins; the zoom strides what is drawn.
 *   4-10 strikes, 1 a side     rank by |netGex|, force one above spot and one
 *                              below, then fill from the ranking.
 *   grow with net GEX          r = floor + sqrt(|gex| / windowMax) x (cap-floor)
 *   peers carry the sign       saturated blue for positive gamma, red for
 *                              negative — the ladder's first statement
 *   the top strike stands out  the bucket's largest is the one WHITE mark, plus
 *                              the size boost, a white ring and a glow in the
 *                              sign colour
 *   old dots survive           never below minPx, and age only fades opacity a
 *                              little
 *   no overlap if possible     same-bucket neighbours shrink toward the floor,
 *                              then take a few px of X jitter
 *   history stays the day      nothing is ever spliced. 'per-bar' keeps each
 *                              bucket's own strikes on the axis; 'latest' locks
 *                              the Y set to the current picks and plots those
 *                              backward through the session
 *
 * What is deliberately NOT here, so nobody adds it back: a share cutoff (with
 * four rows the fourth-strongest strike is worth drawing by definition, so a
 * second gate could only ever delete a row you asked for), an auto row count
 * (four plus a surprise is not simpler than four), and the six sliders and Auto
 * mode this replaced - a setting is a question you have to keep re-answering,
 * and the chart has one right answer at a time.
 */
export const BUBBLES = {
  // ── 1 bubble per bucket ──────────────────────────────────────────────────
  /**
   * The bucket ladder, in minutes. The rung is the BAR INTERVAL, clamped into
   * this list — one bubble per bar, last print in it wins.
   *
   * It used to be a consequence of the ZOOM (the smallest rung whose dots landed
   * `bucketPxPerDot` apart), and the bar interval had nothing to do with it.
   * That made the interval picker inert on this layer: 1m -> 5m moved nothing,
   * and 5m -> 1m only came back after zooming most of the way in, which is where
   * the span rule finally allowed the finer rung. The zoom still decides how
   * many of the buckets FIT — that is the stride in drawBubbles — but it no
   * longer decides how often a reading is taken.
   *
   * CAPPED AT 5m — so 15m/30m/1h bars all draw a 5m bucket. 15m and coarser
   * buckets give a scatter of lonely dots with the session's shape missing —
   * technically legible, useless to read. Past 5m the answer is not a coarser
   * BUCKET (which throws away the prints) but the stride (which keeps the
   * bucketing honest and just draws every Nth), so the ladder stops here and the
   * stride takes it from there. The 15/30/60 entries in `profiles` stay: a
   * strided 5m trail is SIZED by its effective spacing, so those are still
   * reached — as sizes, never as buckets.
   */
  bucketRungsMin: [1, 5],
  /**
   * THE STRIDE TARGET: the spacing the drawn dots are thinned to. It no longer
   * picks the bucket (the bar interval does) but it is still the number that
   * decides how many of those buckets are drawn, and therefore how big they are.
   *
   * Set from the SMALLEST legible mark, not a full-size one: 2 x minLegiblePx x
   * a typical topBoost, plus the hairline. At ~11px a mark can still be told
   * apart from its neighbour AND `capOfSpacing` leaves it a real radius to vary
   * within — which is the whole point, because size is the signal.
   *
   * WHY IT IS NOT SMALLER. `capOfSpacing` (0.28) sizes every mark off the
   * EFFECTIVE spacing, and `minPx` (1.2) is the hard floor underneath. Below
   * ~4.3px per drawn dot the cap has fallen to the floor and every row of the
   * bucket draws at 1.2px: four levels, one size, no ranking. Measured across a
   * 770px plot: at a 2.5px target a 1m bucket gives top 1.95px / 4th 1.26px on a
   * 2.5h window and 1.20px / 1.20px on a session. At 11px the same window gives
   * 5.85 / 1.99 and a session 4.50 / 1.74. The spread survives.
   *
   * This does NOT make the interval picker inert. That used to be the trade —
   * when AUTO also picked the bucket from the zoom, 1m and 5m collapsed onto the
   * same rung and then onto the same dots. Now the bucket is the interval, so at
   * a 2.5h window 1m draws every 3rd minute at 5.85px and 5m every 5th at
   * 9.75px: different dots, visibly different sizes, both legible.
   */
  bucketPxPerDot: 11,
  /**
   * The same target for an explicitly PINNED bucket — the 1m / 5m tiles only.
   *
   * A pin is somebody asking for sub-bar detail on a coarser chart, the same
   * opt-in the Bubble size slider is, so its only remaining job is to stop the
   * dots literally merging into a line — a spacing floor rather than a
   * legibility target. At 2.5px a pinned 1m draws every minute down to a
   * ~90-minute view and thins from there, and the marks shrink to fit.
   *
   * DO NOT apply this to the interval-driven default. It was, for a few hours on
   * 2026-08-31, on the reasoning that an interval-driven bucket is a chosen
   * cadence too — and it is, but the loosened stride is a SIZE decision, not a
   * cadence one. The result was the numbers above: every mark on the floor past
   * a ~2h window, the size channel dead, and the sizeCurve / floorOfCap tuning
   * that shipped the same morning completely inert because the spacing bound was
   * what was binding.
   */
  pinnedPxPerDot: 2.5,
  /** The smallest radius a mark can have and still read as a mark. */
  minLegiblePx: 3.5,

  // ── The strike set ───────────────────────────────────────────────────────
  /** Rows per bucket. The design range is 4–10; four is the resting value. */
  levels: 4,
  /** Forced before the ranking fills the rest — one above spot, one below. */
  minPerSide: 1,
  /**
   * 'per-bar'  each bucket keeps the strikes IT chose, so a level stays on the
   *            axis where it happened even after spot walks away from it.
   * 'latest'   the Y set is locked to the current bucket's picks and those same
   *            strikes are plotted backward through the session.
   */
  strikeMode: 'per-bar' as 'per-bar' | 'latest',

  // ── Size, PER RUNG ───────────────────────────────────────────────────────
  //   r = floorPx + (|gex| / windowMax) ** sizeCurve * (capPx - floorPx),  x topBoost
  //
  // Compressive, not linear: the top strike is routinely 5-10x its neighbours
  // and a linear law spends the whole budget on it, leaving the rest as
  // identical specks. Under the curve a 25%-of-max strike still draws at
  // roughly a third of the range.
  //
  // ── AND THE NUMBERS ARE PER BUCKET SIZE ──────────────────────────────────
  // A 13px cap is right at 5m and absurd at 1m: five times the dots in the same
  // width, so marks that clear each other at 5m fuse into ribbons at 1m. That is
  // not a tuning failure, it is the same number being asked two different
  // questions — and the fix is not one cleverer number, it is one per rung.
  //
  // Each rung's profile is what that bucket looks right at, at the zoom where
  // the auto rule would pick it. Rungs between the listed ones take the nearest
  // profile below.
  //
  // ── `aspect` and `rankMix` ARE 1m-ONLY, DELIBERATELY ─────────────────────
  //
  // 1m is the only rung where the horizontal spacing bound genuinely runs out.
  // At 5m and coarser the profile cap binds first, the four rows already rank
  // by eye, and the marks are round — that picture is right and is not to be
  // touched. So both of the 1m rescues live in the PROFILE, not in a global,
  // and every coarser rung carries the identity values (`aspect: 1`,
  // `rankMix: 0`) which make the arithmetic in sizeFor/placeBucket the exact
  // expression it was before they existed.
  //
  //   aspect   how many times taller than wide a mark may draw. At 1m on a
  //            session view the spacing bound is ~3.4px and, spent on BOTH axes
  //            by a circle, it put all four rows on `minPx` — the size channel
  //            dead. Sideways there is genuinely no room; vertically there is a
  //            whole pane, and placeBucket's fit pass already keeps two strikes
  //            clear of each other. 2.4 is a firm oval and still obviously a
  //            mark; past ~3 the trail reads as a set of vertical BARS, which
  //            is the "this level was one thing for the whole stretch" claim
  //            the layer exists not to make.
  //
  //   rankMix  the share of the size budget given to a row's PLACE in its
  //            bucket (1st..4th -> 1, .75, .5, .25) rather than to its gamma.
  //            `sizeCurve` alone says nothing when a bucket's four strikes are
  //            within a few percent of each other, or when the whole bucket is
  //            quiet and every row lands near the floor — both common at 1m,
  //            both drawing as four identical specks. 0.4 and not more: past
  //            about half the budget a mark stops reporting magnitude and
  //            starts reporting only its position in a list. The marks are
  //            sorted by |netGex| first and the blend is monotone in the rank,
  //            so the ORDER never changes.
  profiles: {
    1: { capPx: 9, floorPx: 1.6, topBoost: 1.6, ringPx: 1.1, aspect: 2.4, rankMix: 0.4 },
    5: { capPx: 13, floorPx: 2.5, topBoost: 1.55, ringPx: 1.4, aspect: 1, rankMix: 0 },
    15: { capPx: 16, floorPx: 3, topBoost: 1.5, ringPx: 1.6, aspect: 1, rankMix: 0 },
    30: { capPx: 18, floorPx: 3.5, topBoost: 1.46, ringPx: 1.8, aspect: 1, rankMix: 0 },
    60: { capPx: 20, floorPx: 4, topBoost: 1.42, ringPx: 2, aspect: 1, rankMix: 0 },
  } as Record<
    number,
    { capPx: number; floorPx: number; topBoost: number; ringPx: number; aspect: number; rankMix: number }
  >,
  /**
   * The exponent on `|gex| / windowMax`.
   *
   * Was a plain square root (0.5), then 0.62. At 0.5 a strike holding 5% of the
   * max still draws at 22% of the range and one holding 30% at 55%, which is
   * most of the ladder bunched in the top half of the size budget — every mark
   * roughly the same dot, the top one distinguishable only by its ring. Steeper
   * spreads the middle back out, and the biggest wall of the day reads as bigger
   * from across the room, which is the entire job of the layer.
   *
   * 0.72 (2026-08-31): at 0.62 the four rows of a bucket were still landing too
   * close together — with `levels: 4` the 4th row drew at ~48% of the cap and
   * the top at 100%, and on screen that is two sizes, not four. At 0.72 the 4th
   * is ~39% and the rows rank by eye. Paired with a lower `floorOfCap`.
   *
   * 0.75 (2026-08-31, later the same day): deliberately ON the ceiling below,
   * because the requested picture is the one where the four rows step down
   * hard. Do not go past it — beyond ~0.75 the law is effectively linear again
   * and everything below the leader collapses onto the floor, at which point the
   * ladder has two sizes instead of four for the opposite reason.
   */
  sizeCurve: 0.75,
  /**
   * The floor, as a fraction of whatever cap survived the spacing shrink.
   *
   * Was 0.45, then 0.25. At 0.45, on a wide zoom (cap ~4.6px), there was a 2.5px
   * range between the smallest mark and the largest — under a hairline of
   * separation once the ring is on.
   *
   * 0.14 (2026-08-31): the other half of the `sizeCurve` bump. The floor is the
   * bottom of the range the curve spreads things over, so raising the exponent
   * alone only moves the marks a little — most of the budget was still spent
   * before the smallest row got there. `minPx` is still the hard bottom, and at
   * the wider zooms it is what binds, not this.
   */
  floorOfCap: 0.14,
  /**
   * …and the profile is then SHRUNK to the room that actually exists.
   *
   * A profile is right at the zoom its rung was chosen for. Force a rung the
   * auto rule would not have picked — which the lab exists to let you do, and
   * which a pinned setting would do every day — and the dots land closer than
   * the profile assumes. So the cap is additionally held to this fraction of the
   * measured gap between two dots. It only ever shrinks: at the intended zoom it
   * is inert, and at 1m across a whole session it turns what were fused ribbons
   * into a fine dotted trail, which is the truthful picture of 975 samples in
   * 1500 pixels.
   *
   * This bounds the PEERS ONLY. It used to be divided by `topBoost` so the
   * boosted leader fit inside it too — which meant one dot per bucket dictated
   * the size of all the others, and the whole ladder paid a 30-40% tax for a
   * mark that already has a ring and a glow to set it apart.
   */
  capOfSpacing: 0.28,
  /**
   * The leader's own share of the spacing — larger than the peers', so it stands
   * apart, and still a bound, so it cannot fuse.
   *
   * Just under 0.5, which is the geometric limit: two marks one spacing apart
   * touch when each is half the spacing. Removing the leader's bound altogether
   * looked fine on a session view and drew a continuous sausage at a 30-minute
   * zoom, where the profile cap binds instead of the spacing and the boost then
   * put 14px of radius into 15px of room.
   *
   * 0.44 (2026-08-31, later the same day). THIS is the number that sets the
   * leader-to-4th-row spread, and it had been the thing holding it down: the
   * leader is the row the spacing bound clips first, so at every ordinary zoom
   * the boost was being thrown away and the top mark drew at
   * `topOfSpacing / capOfSpacing` = 1.36x the peers' bound however big its gamma
   * was. At 0.44 the ratio to `capOfSpacing` is 1.57, which is finally the
   * profiles' own `topBoost` (1.42-1.6) — so the boost lands instead of being
   * clipped, and the leader draws at 3.0-4.5x the 4th row across every zoom
   * instead of 2.5-4.0.
   *
   * 0.44 and not higher, because 0.5 is where consecutive leaders TOUCH. At 0.44
   * a leader's diameter is ~0.88 of the spacing: a visible hairline between one
   * bucket and the next, and no hairline is the sausage. If this needs to go
   * further the honest lever is the STRIDE (`bucketPxPerDot`), which buys room
   * rather than spending room that is not there.
   */
  topOfSpacing: 0.44,
  /** Absolute floor. Old dots never shrink past this, whatever the fit does. */
  minPx: 1.2,

  // ── Not overlapping ──────────────────────────────────────────────────────
  /** Hairline kept between two marks in the same bucket. */
  gapPx: 0.8,
  /** Passes of the pairwise vertical shrink before jitter is used. */
  fitPasses: 6,
  /** Max horizontal nudge, px, for a pair that still does not fit after that. */
  jitterPx: 3,

  // ── Colour ───────────────────────────────────────────────────────────────
  //
  // PEERS CARRY THE SIGN, the LEADER IS WHITE. Peers are filled with the
  // saturated `--color-gex-pos` / `-neg`; the pale `-hot` tokens belong to the
  // leader alone, pushed further toward white by `topTint` below. See
  // BubblePalette in bubbles.ts, including why filling everything with the pale
  // tint was tried on 2026-08-31 and reverted the same day.
  /**
   * How much whiter the LEADER's core is than its own hot tint, 0..1 to white.
   *
   * The leader is the one mark that is not the sign colour, so this is what
   * makes "brightest" read as WHITE rather than as a paler dot of the same hue.
   * It is not the only signal — the size boost, the white ring and the glow are
   * all still there — but it is the one that works at a glance, and at a glance
   * is how the biggest wall gets found.
   *
   * 0.45 rather than 1.0 because the two hot tints are not equally light
   * (`#c8f5ff` is nearly white already, `#ffcdd2` is not) and a mark taken all
   * the way to white loses its sign entirely up close. This lands both sides
   * near-white with just enough cast left to tell them apart.
   */
  topTint: 0.45,
  /** The weakest mark fades to 1 - fade. */
  fade: 0.45,
  /** The oldest bucket keeps this much of its opacity. Age reads, faintly. */
  ageKeep: 0.75,
  /**
   * The glow under the top mark. Its ring width is per-rung, in `profiles`.
   *
   * `glowFactor` and `glowMaxPx` are CEILINGS, not amounts: the blur actually
   * drawn is also held to the room left beside the mark once its own radius is
   * taken out of the spacing, and at a tight zoom that room is zero and the glow
   * simply does not draw. A 7px halo painted across a 2px gap is what turned the
   * leader's row into one continuous sausage — the marks were clearing, the blur
   * was not.
   *
   * `glowAlpha` is the strength of the saturated sign colour in that halo, and
   * it was an un-named 0.95 in the draw call. At 0.95, under a core that the age
   * fade has made translucent, the halo shows THROUGH the mark — which is how
   * the negative leader came to look like a red dot with a white outline. It is
   * also multiplied by age now, so an old leader's halo fades with the rest of
   * it instead of outliving its own core.
   */
  glowFactor: 0.6,
  glowMaxPx: 7,
  glowAlpha: 0.6,
} as const

/**
 * How many strikes to ASK the server for per column. Deliberately a constant
 * and not derived from `BUBBLES.levels`: asking for exactly what is drawn would
 * mean the ranking could never see a strike it did not already pick. Ask wide,
 * rank locally.
 */
export const BUBBLE_LADDER_REQUEST = 30


/**
 * How far back the bubble history reaches, minutes. One full session + pre.
 *
 * This used to have a 48h TESTING PHASE partner (`GEX_HISTORY_MINUTES_PREV_DAY`)
 * behind a `Prev day` chip, so the layer could hold two sessions at once and a
 * Sun/Mon/Both picker chose between them. It was the single biggest cost on the
 * card — the history route returns one column PER MINUTE, so 2880 was four
 * times the columns, four times the payload and four times the parse of this
 * 720 — and the second session it bought was usually the recorder's frozen
 * weekend republish rather than a real one. The card follows the selected
 * expiration's session now; the reach, the chip and the picker are all gone.
 *
 * The route clamps `minutes` to 5760, comfortably above anything asked here —
 * the weekend branch in GexCandlesCard reaches further than this to clear a
 * Saturday or Sunday and still lands well inside it.
 */
export const GEX_HISTORY_MINUTES = 720

// ── Persistence ──────────────────────────────────────────────────────────────

const KEY_PREFIX = 'cb-v3-gex-candles:'

/**
 * Blob version, written alongside the settings and checked on load.
 *
 * v7 (2026-09-02): `esCandles` added — the SPX/ES candle switch. An older blob
 * has no such key and coerce falls back to false, which is the cash-index
 * chart those blobs already drew.
 *
 * v6 (2026-08-31): `bubbleScale` added. An older blob has no such key,
 * clampScale falls back to 1, and 1 is the size those blobs already drew.
 *
 * v5 (2026-08-31): `prevDay` and `bubbleDay` removed with the 48h testing reach
 * and the Sun/Mon/Both day picker. Both are listed in STALE_ON_UPGRADE so the
 * dead keys are dropped from the blob on first load rather than riding along
 * forever — nothing reads them either way, this just keeps the blob honest.
 *
 * v4 (2026-08-29): `bubbleBucket` added — the one bubble setting there is. An
 * older blob has no such key, `coerce` falls back to 'auto', and that is the
 * behaviour those blobs already had, so nothing needs forcing.
 *
 * v3 (2026-08-29): the bubble knobs are gone from ChartSettings entirely, so
 * there is nothing left to force onto anyone — an old blob's stale keys are
 * simply never read. Kept because the next default that needs pushing will need
 * this, and re-deriving the mechanism is worse than leaving it inert.
 */
const SETTINGS_V = 7
const STALE_ON_UPGRADE: string[] = ['prevDay', 'bubbleDay']

/** Coerce an unknown parsed blob into a complete, in-range settings object. */
function coerce(raw: unknown): ChartSettings {
  const p = (raw ?? {}) as Partial<Record<string, unknown>>
  // An older blob hands back `undefined` for an upgraded key, so the fallbacks
  // below take the new default without any per-key special casing.
  if ((raw as { v?: unknown } | null)?.v !== SETTINGS_V) {
    for (const k of STALE_ON_UPGRADE) delete p[k]
  }
  const interval = INTERVALS.includes(p.interval as Interval) ? (p.interval as Interval) : DEFAULT_SETTINGS.interval
  return {
    // normalizeSymbol also retires ES/NQ onto SPX/NDX, so a blob saved before
    // the futures were dropped reopens on a symbol that still has candles
    // rather than on a dead one with an empty chart.
    symbol: typeof p.symbol === 'string' && p.symbol ? normalizeSymbol(p.symbol) : DEFAULT_SETTINGS.symbol,
    session: p.session === 'rth' ? 'rth' : 'eth',
    interval,
    bubblesOn: p.bubblesOn !== false,
    gexMetric: p.gexMetric === 'vol' ? 'vol' : 'voloi',
    countdown: p.countdown !== false,
    railOn: p.railOn !== false,
    expiry: typeof p.expiry === 'string' ? p.expiry : '',
    bubbleBucket: isBubbleBucket(p.bubbleBucket) ? p.bubbleBucket : DEFAULT_SETTINGS.bubbleBucket,
    bubbleScale: clampScale(p.bubbleScale),
    esCandles: p.esCandles === true,
  }
}

export function loadSettings(cardId: string): ChartSettings {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + cardId)
    return coerce(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(cardId: string, s: ChartSettings): void {
  try {
    // `v` rides along in the blob rather than in ChartSettings: it is a storage
    // concern, and nothing that reads settings should have to know about it.
    localStorage.setItem(KEY_PREFIX + cardId, JSON.stringify({ ...s, v: SETTINGS_V }))
  } catch {
    /* best-effort — the in-memory settings still drive this session */
  }
}
