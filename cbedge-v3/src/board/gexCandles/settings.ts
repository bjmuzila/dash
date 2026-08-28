// ─────────────────────────────────────────────────────────────────────────────
// GEX Candles — persisted settings and the frozen bubble constants.
//
// v2 keeps these in a "slot" blob so three charts on one page can share a
// toolbar. v3's chart is a board CARD, and the board already gives each
// card its own identity, so this is one blob per card id — same idea, one less
// level of indirection, and no shared/own mirror to keep in sync.
//
// The RANGES and BUBBLE_STYLE numbers below are transcribed from v2's
// components/dashboard/es-candles/slotStore.ts verbatim. They are the result
// of a lot of looking at the thing; do not "tidy" them.
// ─────────────────────────────────────────────────────────────────────────────

import type { GexDay } from './gexHistory'
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

export interface ChartSettings {
  symbol: string
  session: Session
  interval: Interval
  /** Master on/off for the whole bubble layer. */
  bubblesOn: boolean
  /**
   * Tune the six settings below from the chart itself — see BUBBLE_AUTO.
   *
   * On by default. The sliders stay in the panel while it is on, dimmed: the
   * values they hold are exactly what comes back when it is switched off, and a
   * control that disappears takes that answer with it.
   */
  bubbleAuto: boolean
  /**
   * How many strikes draw IN TOTAL, strongest first across the whole board —
   * with at least `BUBBLE_MIN_PER_SIDE` of them on each side of spot.
   *
   * Was per-side. A fixed count each way drew as many levels below spot as
   * above whether or not the ones below were worth drawing, and it could not
   * answer "show me the four that matter": on a lopsided board the
   * fourth-strongest strike is often the third one above spot, and per-side had
   * no way to reach it. Ranking the whole board and then guaranteeing one row a
   * side gets both — the strikes that actually hold the gamma, and never a
   * picture of only the resistance overhead.
   */
  bubbleLevels: number
  /** The TOP radius, as a multiple of the pane-height cap. */
  bubbleSize: number
  /** The smallest a drawn mark may be, in CSS pixels. */
  bubbleFloor: number
  /**
   * Drop any strike holding under this PERCENT of the board's total |GEX|.
   * A number you can read straight off the GEX table.
   */
  bubbleCutoff: number
  /** How hard the biggest levels pull away from the rest. 1 = straight linear. */
  bubbleCurve: number
  /** Overall opacity of the layer. */
  bubbleIntensity: number
  /** Which GEX quantity a bubble is sized by. Also what the rail lists. */
  gexMetric: GexMetric
  /** The forming-bar countdown in the top-right corner. */
  countdown: boolean
  /** The strike ladder down the right-hand side, pinned to the price axis. */
  railOn: boolean
  /** TESTING PHASE ONLY — reach back 48h so yesterday's bubbles draw too. */
  prevDay: boolean
  /**
   * TESTING PHASE ONLY — which of the days the 48h reach returned actually
   * draws. `prevDay` is the REACH (how far back the request asks); this is the
   * DISPLAY (which of what came back is on the chart), and the toolbar's day
   * picker is where it is set. Two controls because they answer two questions
   * and only one of them costs a request.
   *
   * Semantic rather than a date — see GexDay. With `prevDay` off there is only
   * one session in the data, the picker does not render and this is inert.
   */
  bubbleDay: GexDay
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
}

export const DEFAULT_SETTINGS: ChartSettings = {
  symbol: 'SPX',
  session: 'eth',
  interval: 5,
  bubblesOn: true,
  bubbleAuto: true,
  // The top four on the board, one of them guaranteed on each side of spot.
  // Four marks is enough to see the corridor you are trading inside without the
  // ladder turning into a wall of circles, and ranking them across the whole
  // board rather than three-and-three means the four drawn are the four that
  // are actually holding gamma.
  bubbleLevels: 4,
  bubbleSize: 1,
  // ~1.5px. Every level that survives the gates is visible; whether a level is
  // ON the chart is the cutoff's decision, never the size slider's.
  bubbleFloor: 1.5,
  // 0.4% of the board. Low enough to keep a real secondary level, high enough
  // that the long tail of sub-1% strikes does not speckle the pane.
  bubbleCutoff: 0.4,
  // Above 1 by default: on a typical ladder the top strikes sit within a few
  // percent of each other, and straight linear makes six near-identical
  // circles. 1.5 separates the walls without flattening everything below them.
  bubbleCurve: 1.5,
  bubbleIntensity: 1,
  gexMetric: 'voloi',
  countdown: true,
  // On by default: the rail is the numbers behind the bubbles, and a bubble
  // layer with no way to read the figure it is drawn from is half a feature.
  railOn: true,
  // ON for the testing phase, so the layer has something to draw at any hour.
  // The default flips to false when this is retired — see the note on
  // GEX_HISTORY_MINUTES_PREV_DAY.
  prevDay: true,
  // BOTH days while the layer is being tuned — the point of the 48h reach is
  // seeing a whole day of gamma migration at once. The finished card has one
  // session and no picker; 'latest' is what that collapses to.
  bubbleDay: 'both',
  expiry: '',
}

/**
 * TOTAL strikes drawn, not per side — the top of the range is what the old
 * per-side 8 came to in marks, so nobody loses reach.
 */
export const BUBBLE_LEVELS_RANGE = { min: 1, max: 16 }
/**
 * How many of the drawn strikes must sit on EACH side of spot.
 *
 * The selection is a ranking of the whole board, and gamma is routinely lopsided
 * enough to put every drawn row above price — at which point the chart says
 * nothing about what is underneath it, which is half the read. If a side comes
 * out empty the weakest drawn strike is swapped for the strongest one over
 * there.
 *
 * A FLOOR, not a split: with genuinely one-sided gamma the remaining rows still
 * all land on the heavy side, so the guarantee costs one mark and only when a
 * side would otherwise be blank. Inert below 2 × this, where honouring it would
 * mean drawing more rows than the slider says.
 */
export const BUBBLE_MIN_PER_SIDE = 1
/**
 * A multiple of `BUBBLE_STYLE.heightFrac` of the pane — so on a ~950px pane
 * 1.00× is a ~33px radius and the old 0.40× floor was still ~13px, which on a
 * SPARSE ladder (1 or 2 a side, where nothing else bounds the top) is a 27px
 * blob and the smallest the slider could make it. Hence 0.10× ≈ 3px: the low
 * end has to be able to draw a DOT, because the spacing cap only kicks in once
 * the ladder is busy enough to crowd itself.
 */
export const BUBBLE_SIZE_RANGE = { min: 0.1, max: 4 }
export const BUBBLE_FLOOR_RANGE = { min: 0, max: 8 }
/** Percent of the board's total |GEX|. */
export const BUBBLE_CUTOFF_RANGE = { min: 0, max: 5 }
// Below 1 is now allowed: it FLATTENS the ladder, which is what you want when
// the small levels are the ones being read.
export const BUBBLE_CURVE_RANGE = { min: 0.3, max: 3 }
export const BUBBLE_INTENSITY_RANGE = { min: 0.2, max: 1 }

/**
 * ── AUTO ─────────────────────────────────────────────────────────────────────
 *
 * Every setting above has a right answer that depends on things you cannot see
 * from the panel: how many levels this board actually has, how far the top one
 * is from the rest, how tall the pane is, how close the rows land at this zoom.
 * Auto computes all six from those factors — the data ones once per model
 * build, the pixel ones on every drawn frame — and the sliders stay in the
 * panel, dimmed, as the manual override.
 *
 * This is the AUTO POLICY, not a second set of defaults. Each number answers a
 * question about the picture:
 *
 *   levelShare   what counts as a level. A strike holding at least 5% of the
 *                board's gamma is one; under that it is a wing, and drawing it
 *                costs a row and buys nothing. Clamped to [minLevels,
 *                maxLevels] — four is the resting number, a genuinely flat
 *                board may widen to six.
 *
 *   cutoffOfTop  the speck gate, as a fraction of the LEADER's share rather
 *                than a fixed percent — 0.4% of the board means something
 *                different on a board whose wall holds 20% and one whose
 *                biggest strike holds 4%.
 *
 *   topFrac      the biggest mark, as a fraction of the pane height, railed to
 *                a pixel range so a very short or very tall pane still lands
 *                somewhere sane. Small enough that the band never buries the
 *                candles under it.
 *
 *   crowdTrim    every row past the fourth takes a little off the top: six rows
 *                at the four-row size is a busier chart than the extra rows are
 *                worth.
 *
 *   floorOfTop   the smallest drawn mark, as a fraction of the biggest — so the
 *                weakest level stays a visible dot at every zoom without ever
 *                being big enough to be mistaken for a real one.
 *
 *   spreadGain   the curve. When the drawn strikes sit within a few percent of
 *                each other, straight-linear draws six near-identical circles
 *                and the ladder is unrankable; the exponent separates them.
 *                When there IS a dominant wall the numbers already separate, so
 *                it stays near linear. Measured off the median drawn mark's
 *                ratio to the core, per snapshot.
 *
 *   dimPerRow    a busier layer sits quieter against the candles.
 *
 * What auto never touches: what a size MEANS. r = floor + (top − floor) ×
 * ratio^variance under every rule here — auto moves the ends of that range and
 * the exponent, never one mark on its own.
 */
export const BUBBLE_AUTO = {
  levelShare: 0.05,
  minLevels: 4,
  maxLevels: 6,
  cutoffOfTop: 0.06,
  cutoffMinPct: 0.25,
  cutoffMaxPct: 1.5,
  // ── HOW FAT A ROW MAY BE ───────────────────────────────────────────────
  // Was 3% of the pane, railed 5–15px. On an 800px pane that is a 15px radius
  // — a THIRTY-PIXEL band — and with a strike every point the rows ran into
  // each other and buried the candles between them. A level is a line you read
  // price against; at 30px it is a region, and price is inside it more often
  // than not, which tells you nothing.
  //
  // 1.2% railed 2.5–6px puts a row at 5–12px: unmistakably a band rather than
  // a hairline, thin enough that four of them leave the candles legible.
  topFrac: 0.012,
  topMinPx: 2.5,
  topMaxPx: 6,
  crowdTrim: 0.05,
  floorOfTop: 0.22,
  floorMinPx: 0.7,
  floorMaxPx: 1.6,
  spreadGain: 1.5,
  curveMin: 0.9,
  curveMax: 2.2,
  dimPerRow: 0.05,
  dimFloor: 0.7,
} as const

function clampTo(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * How many strikes to draw, from the board's own shape. `sharesDesc` is each
 * strike's share of the column total, biggest first — sorted, so the first
 * strike under the bar ends the walk.
 */
export function autoLevels(sharesDesc: number[]): number {
  let n = 0
  for (const s of sharesDesc) {
    if (s >= BUBBLE_AUTO.levelShare) n++
    else break
  }
  return clampTo(n, BUBBLE_AUTO.minLevels, BUBBLE_AUTO.maxLevels)
}

/** The speck gate, as a percent of the board, scaled to the leader's share. */
export function autoCutoffPct(topShare: number): number {
  return clampTo(topShare * 100 * BUBBLE_AUTO.cutoffOfTop, BUBBLE_AUTO.cutoffMinPct, BUBBLE_AUTO.cutoffMaxPct)
}

/** Target radius of the biggest mark, px, before the spacing cap has its say. */
export function autoTopPx(paneH: number, rows: number): number {
  const target = clampTo(paneH * BUBBLE_AUTO.topFrac, BUBBLE_AUTO.topMinPx, BUBBLE_AUTO.topMaxPx)
  const trim = 1 - BUBBLE_AUTO.crowdTrim * Math.max(0, rows - BUBBLE_AUTO.minLevels)
  return Math.max(BUBBLE_AUTO.topMinPx * 0.8, target * trim)
}

/** Smallest drawn mark, px, from the biggest one. */
export function autoFloorPx(topPx: number): number {
  return clampTo(topPx * BUBBLE_AUTO.floorOfTop, BUBBLE_AUTO.floorMinPx, BUBBLE_AUTO.floorMaxPx)
}

/** The size exponent, from how tightly the drawn marks are bunched. */
export function autoVariance(medianRatio: number): number {
  return clampTo(
    BUBBLE_AUTO.curveMin + BUBBLE_AUTO.spreadGain * clampTo(medianRatio, 0, 1),
    BUBBLE_AUTO.curveMin,
    BUBBLE_AUTO.curveMax,
  )
}

/** Layer opacity, from how many rows are on the chart. */
export function autoIntensity(rows: number): number {
  return Math.max(BUBBLE_AUTO.dimFloor, 1 - BUBBLE_AUTO.dimPerRow * Math.max(0, rows - BUBBLE_AUTO.minLevels))
}

/**
 * Frozen look of the bubble layer. Everything here is a shape decision, not a
 * preference — the four sliders above are the preferences.
 */
export const BUBBLE_STYLE = {
  /** Hard radius floor, px — the absolute limit under the user's own floor. */
  minPx: 0.8,
  /** The core may not exceed this fraction of the pane's height. Spacing alone
   *  would let six marks on a tall, sparse pane grow until the ladder was
   *  mostly circle; this keeps the band proportionate to the chart at every
   *  window size, with no per-layout pixel number to tune. */
  heightFrac: 0.035,
  glowTopFactor: 0.6,
  // 9 was a bloom wider than the mark it lit. The core is found by being the
  // biggest row, not by being the brightest thing on the chart.
  glowMaxPx: 5,
  /** The weakest mark fades to 1 − fade. */
  fade: 0.55,
  /** Hairline kept between marks, so "not overlapping" reads as separate
   *  rather than as tangent. */
  gapPx: 0.8,
} as const

// Removed 2026-08-27: maxPxRowFrac / maxPxColFrac / colBoundFloorPx derived the
// radius cap from the LADDER's strike step, which is not the spacing the marks
// are drawn at; the cap is now measured per column from the nearest vertical
// neighbour among the marks actually drawn (capFor() in bubbles.ts). `highlight`
// went with the switch to per-column normalisation: the glow belongs to the
// column's core, which is by definition exactly one mark, so there is no count
// left to configure.

/**
 * How many strikes to ASK the server for per column. Deliberately a constant
 * and not derived from `bubbleLevels`: a moving value would churn the request
 * URL on every slider drag and defeat the fetch cache. Ask wide, rank locally.
 */
export const BUBBLE_LADDER_REQUEST = 30

/** How far back the bubble history reaches, minutes. One full session + pre. */
export const GEX_HISTORY_MINUTES = 720

/**
 * ── TESTING PHASE ONLY ───────────────────────────────────────────────────────
 * 48 hours, so the bubble layer carries YESTERDAY's ladder as well as today's.
 *
 * This exists to give the layer something to draw outside market hours and to
 * make a day's worth of gamma migration visible while the card is being built.
 * It is not what the card is for: the finished version shows the current
 * session, which is `GEX_HISTORY_MINUTES` above.
 *
 * It is also the single biggest cost on this card: the history route returns one
 * column PER MINUTE, so 2880 is four times the columns — and four times the
 * payload and parse — of the 720 default. If the bubbles feel slow, this is the
 * first thing to turn off.
 *
 * To retire it: delete this constant, the `prevDay` and `bubbleDay` settings,
 * the `Prev day` chip in GexCandlesCard's Layers panel, the day picker beside
 * the expiry dropdown, and the session-day block at the foot of gexHistory.ts.
 * (The other half of that eventual change — one expiry instead of
 * `anyExpiry=1` — is already done; the toolbar's expiry dropdown names it.)
 *
 * The route clamps `minutes` to 5760, so this is well inside what it will serve.
 */
export const GEX_HISTORY_MINUTES_PREV_DAY = 2880

// ── Persistence ──────────────────────────────────────────────────────────────

const KEY_PREFIX = 'cb-v3-gex-candles:'

/**
 * Blob version, written alongside the settings and checked on load.
 *
 * A default only reaches someone who has never touched the control, and
 * `bubbleLevels` is persisted — so changing DEFAULT_SETTINGS did nothing on any
 * browser that had opened the card once. When a stored blob is older than this,
 * the keys listed in `STALE_ON_UPGRADE` fall back to the default instead of to
 * what was saved.
 *
 * v2 (2026-08-28): `bubbleLevels` stopped meaning "per side" and became a total.
 * A saved 3 was six marks and would silently have become three, and it was the
 * wrong number either way — the default moved to 4.
 *
 * Bump this ONLY to push a default onto people who already have a value.
 * Everything else in the blob is untouched: this is not a settings reset.
 */
const SETTINGS_V = 2
const STALE_ON_UPGRADE = ['bubbleLevels'] as const

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

/** Coerce an unknown parsed blob into a complete, in-range settings object. */
function coerce(raw: unknown): ChartSettings {
  const p = (raw ?? {}) as Partial<Record<keyof ChartSettings, unknown>>
  // An older blob hands back `undefined` for the upgraded keys, so the `num()`
  // fallbacks below take the new default without any per-key special casing.
  if ((raw as { v?: unknown } | null)?.v !== SETTINGS_V) {
    for (const k of STALE_ON_UPGRADE) delete p[k]
  }
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  const interval = INTERVALS.includes(p.interval as Interval) ? (p.interval as Interval) : DEFAULT_SETTINGS.interval
  return {
    // normalizeSymbol also retires ES/NQ onto SPX/NDX, so a blob saved before
    // the futures were dropped reopens on a symbol that still has candles
    // rather than on a dead one with an empty chart.
    symbol: typeof p.symbol === 'string' && p.symbol ? normalizeSymbol(p.symbol) : DEFAULT_SETTINGS.symbol,
    session: p.session === 'rth' ? 'rth' : 'eth',
    interval,
    bubblesOn: p.bubblesOn !== false,
    bubbleAuto: p.bubbleAuto !== false,
    bubbleLevels: Math.round(
      clamp(num(p.bubbleLevels, DEFAULT_SETTINGS.bubbleLevels), BUBBLE_LEVELS_RANGE.min, BUBBLE_LEVELS_RANGE.max),
    ),
    bubbleSize: clamp(num(p.bubbleSize, DEFAULT_SETTINGS.bubbleSize), BUBBLE_SIZE_RANGE.min, BUBBLE_SIZE_RANGE.max),
    bubbleFloor: clamp(num(p.bubbleFloor, DEFAULT_SETTINGS.bubbleFloor), BUBBLE_FLOOR_RANGE.min, BUBBLE_FLOOR_RANGE.max),
    bubbleCutoff: clamp(
      num(p.bubbleCutoff, DEFAULT_SETTINGS.bubbleCutoff),
      BUBBLE_CUTOFF_RANGE.min,
      BUBBLE_CUTOFF_RANGE.max,
    ),
    bubbleCurve: clamp(num(p.bubbleCurve, DEFAULT_SETTINGS.bubbleCurve), BUBBLE_CURVE_RANGE.min, BUBBLE_CURVE_RANGE.max),
    bubbleIntensity: clamp(
      num(p.bubbleIntensity, DEFAULT_SETTINGS.bubbleIntensity),
      BUBBLE_INTENSITY_RANGE.min,
      BUBBLE_INTENSITY_RANGE.max,
    ),
    gexMetric: p.gexMetric === 'vol' ? 'vol' : 'voloi',
    countdown: p.countdown !== false,
    railOn: p.railOn !== false,
    prevDay: p.prevDay !== false,
    bubbleDay: p.bubbleDay === 'latest' || p.bubbleDay === 'prev' ? p.bubbleDay : 'both',
    expiry: typeof p.expiry === 'string' ? p.expiry : '',
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
