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
 * 'auto' is the default and the right answer almost always: the bucket is a
 * question about how much room a dot has, and only the chart knows how wide the
 * pane is. It picks the smallest rung of `BUBBLES.bucketRungsMin` whose dots
 * land far enough apart, and re-picks on every zoom.
 *
 * 1 and 5 are MANUAL overrides, and they override the RUNG, not the stride: a
 * forced 1m on a whole session still strides, because 975 dots do not fit in
 * 1500px whatever anyone picked. So the honest description of a pinned value is
 * "never coarser than this", and at a wide zoom it lands on the same picture
 * auto would have drawn.
 *
 * (v2's slotStore carries the same three values plus a legacy 'bar' spelling,
 * which is the pre-rename name for 'auto'. v3 has no blobs old enough to hold
 * it, so it is not accepted here.)
 */
export type BubbleBucket = 1 | 5 | 'auto'
export const isBubbleBucket = (v: unknown): v is BubbleBucket => v === 1 || v === 5 || v === 'auto'
/**
 * Does this bucket follow the pane, rather than pin a rung?
 *
 * A type predicate, not a plain boolean: the false branch is where a pinned
 * bucket gets handed to ChartDrawOpts.bucketMin, which is `1 | 5 | null`.
 * Returning boolean leaves 'auto' in the type there and `tsc --noEmit` fails
 * the v3 build at GexCandlesCard.tsx:408.
 */
export const isAutoBucket = (v: BubbleBucket): v is 'auto' => v === 'auto'
/** What a fresh card starts on. */
export const BUBBLE_BUCKET_DEFAULT: BubbleBucket = 'auto'

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
   * The bubble time bucket: 'auto' follows the pane, 1 or 5 pins the rung.
   * See BubbleBucket. This is the ONLY bubble setting the user has — everything
   * else about the layer is the frozen BUBBLES block above.
   */
  bubbleBucket: BubbleBucket
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
}

/**
 * ── THE BUBBLE LAYER ─────────────────────────────────────────────────────────
 *
 * There are no settings. Bubbles are on or off; everything below is fixed, and
 * every number is here because removing it changes the picture in a way you can
 * name. The rules it implements, in order:
 *
 *   1 bubble per bucket        the trail is a SAMPLE, not a line. Bucket to 1m
 *                              or 5m by how wide the window is, last print in
 *                              the bucket wins.
 *   4-10 strikes, 1 a side     rank by |netGex|, force one above spot and one
 *                              below, then fill from the ranking.
 *   grow with net GEX          r = floor + sqrt(|gex| / windowMax) x (cap-floor)
 *   the top strike stands out  the bucket's largest gets x1.38, a white ring
 *                              and a bright core - about 18px against 7px peers
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
   * The bucket ladder, in minutes. The layer picks the SMALLEST rung whose dots
   * land far enough apart for a full-size mark to fit between them — see
   * `bucketPxPerDot`. One bubble per rung, last print in it wins.
   *
   * Not a fixed 1m or 5m: 1m is right on a half-hour view and 390 overlapping
   * dots across a session, and 5m is right on a session and six dots on a
   * half-hour. The rung is a consequence of the zoom, which is the only thing
   * that knows how much room a dot has.
   *
   * CAPPED AT 5m. 15m and coarser were reachable on a wide view and the result
   * was a scatter of lonely dots with the session's shape missing between them —
   * technically legible, useless to read. Past 5m the answer is not a coarser
   * BUCKET (which throws away the prints) but the stride (which keeps the
   * bucketing honest and just draws every Nth), so the ladder stops here and the
   * stride takes it from there. The 15/30/60 entries in `profiles` stay: a
   * strided 5m trail is SIZED by its effective spacing, so those are still
   * reached — as sizes, never as buckets.
   */
  bucketRungsMin: [1, 5],
  /**
   * Pixels a bucket must own before its rung is allowed.
   *
   * Set from the SMALLEST legible mark, not from a full-size one. That is the
   * difference between "zoom in and see more dots" and "zoom in and see the same
   * dots, bigger": at a full-size threshold (~37px) a 1m rung needed two hours
   * of chart to earn its place, so a 2h window drew 5m and a 30m window drew 1m
   * and there was nothing in between. At ~11px the finer rung is allowed as soon
   * as its dots can be told apart, and `capOfSpacing` shrinks the marks to fit
   * the room — so zooming in adds dots first and size second, which is the way
   * round you want it.
   *
   * 2 x minLegiblePx x a typical topBoost, plus the hairline.
   */
  bucketPxPerDot: 11,
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
  // roughly two fifths of the range.
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
  profiles: {
    1: { capPx: 9, floorPx: 1.6, topBoost: 1.6, ringPx: 1.1 },
    5: { capPx: 13, floorPx: 2.5, topBoost: 1.55, ringPx: 1.4 },
    15: { capPx: 16, floorPx: 3, topBoost: 1.5, ringPx: 1.6 },
    30: { capPx: 18, floorPx: 3.5, topBoost: 1.46, ringPx: 1.8 },
    60: { capPx: 20, floorPx: 4, topBoost: 1.42, ringPx: 2 },
  } as Record<number, { capPx: number; floorPx: number; topBoost: number; ringPx: number }>,
  /**
   * The exponent on `|gex| / windowMax`.
   *
   * Was a plain square root (0.5). At 0.5 a strike holding 5% of the max still
   * draws at 22% of the range and one holding 30% at 55%, which is most of the
   * ladder bunched in the top half of the size budget — every mark roughly the
   * same dot, the top one distinguishable only by its ring. Steeper spreads the
   * middle back out: 5% -> 16%, 30% -> 48%, and the biggest wall of the day
   * reads as bigger from across the room, which is the entire job of the layer.
   *
   * Do not go past ~0.75. Beyond that the law is effectively linear again and
   * everything below the leader collapses onto the floor.
   */
  sizeCurve: 0.62,
  /**
   * The floor, as a fraction of whatever cap survived the spacing shrink.
   *
   * Was 0.45, which at a wide zoom (cap ~4.6px) left a 2.5px range between the
   * smallest mark and the largest — under a hairline of separation once the ring
   * is on. At 0.25 the small end goes properly small and the spread is visible
   * at the zoom where the whole session is on screen. `minPx` is still the hard
   * bottom underneath it.
   */
  floorOfCap: 0.25,
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
   */
  topOfSpacing: 0.34,
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
  /** The weakest mark fades to 1 - fade. */
  fade: 0.45,
  /** The oldest bucket keeps this much of its opacity. Age reads, faintly. */
  ageKeep: 0.75,
  /**
   * The glow under the top mark. Its ring width is per-rung, in `profiles`.
   *
   * Both of these are CEILINGS, not amounts: the blur actually drawn is also
   * held to the room left beside the mark once its own radius is taken out of
   * the spacing, and at a tight zoom that room is zero and the glow simply does
   * not draw. A 7px halo painted across a 2px gap is what turned the leader's
   * row into one continuous sausage — the marks were clearing, the blur was not.
   */
  glowFactor: 0.6,
  glowMaxPx: 7,
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
const SETTINGS_V = 5
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
