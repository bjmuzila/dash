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
 * ── THE BUBBLE LAYER, IN ELEVEN NUMBERS ──────────────────────────────────────
 *
 * There used to be six sliders, an Auto mode, and about twenty constants behind
 * it deciding how many rows to draw, when a level stopped counting, how much to
 * dim a busy chart. Every one of them was answerable, none of them was ever
 * answered the same way twice, and the layer still came out wrong — because a
 * setting is a question you have to keep re-answering, and the chart only has
 * one right answer at a time.
 *
 * So there are no settings any more. Bubbles are on or off. Everything else is
 * below, fixed, and each number is here because removing it changes the picture
 * in a way you can name:
 *
 *   levels / minPerSide   what you asked for: the four strikes actually holding
 *                         gamma, never all on one side of price.
 *   smoothWindow          ranks 4, 5 and 6 sit inside each other's noise and
 *                         swap every other minute; ranking on the smoothed
 *                         series is what stops a row dashing into segments.
 *                         Measured: it took the average segment from a few
 *                         minutes to 58.
 *   dwell                 minimum row length. A band that exists for ninety
 *                         seconds is noise however it got selected.
 *   topFrac / min / max   how fat a row may be, as a fraction of the pane,
 *                         railed in pixels. 3% railed to 15px was a THIRTY-pixel
 *                         band — at that size a level stops being a line you
 *                         read price against and becomes a region price is
 *                         usually inside.
 *   floorOfTop            the weakest drawn row, as a fraction of the biggest:
 *                         visible, never mistakable for a real one.
 *   curve                 the size exponent. Four rows on a typical board sit
 *                         within a few percent of each other and a straight
 *                         proportional law draws four identical bands.
 *   fade / gapPx / glow   the look: how far the weakest row fades, the hairline
 *                         that keeps two rows from reading as one, and how hard
 *                         the column's leader burns.
 *
 * GONE, and why, so nobody adds them back:
 *   the cutoff gate       redundant once `levels` is four. The fourth-strongest
 *                         strike on the board is worth drawing by definition;
 *                         a second gate could only ever remove a row you asked
 *                         for, which it did, silently.
 *   auto level count      widened 4 -> 6 on a flat board. "Six sometimes" is not
 *                         simpler than four, it is four plus a surprise.
 *   crowd trim / dim      both scaled the picture by the row count. With the row
 *                         count fixed they are constants multiplied by one.
 *   the six sliders       see above.
 */
export const BUBBLES = {
  /** Rows drawn per column, ranked within that column. */
  levels: 4,
  /** How many of them must sit on each side of that column's spot. */
  minPerSide: 1,
  /** Half-width, in columns, of the centred mean the ranking and radius read. */
  smoothWindow: 5,
  /** Minimum row length, in columns, once a strike genuinely ranks. */
  dwell: 20,
  /** Top radius as a fraction of the pane height, railed to these pixels. */
  topFrac: 0.012,
  topMinPx: 2.5,
  topMaxPx: 6,
  /** The weakest drawn row, as a fraction of the top, railed to these pixels. */
  floorOfTop: 0.22,
  floorMinPx: 0.7,
  floorMaxPx: 1.6,
  /** Size exponent: r = floor + (top - floor) * ratio^curve. */
  curve: 1.5,
  /** The weakest row fades to 1 - fade. */
  fade: 0.55,
  /** Hairline kept between two rows, so "not overlapping" reads as separate. */
  gapPx: 0.8,
  /** The leader's glow, as a multiple of its own radius, capped. */
  glowFactor: 0.6,
  glowMaxPx: 5,
  /** Absolute radius floor, below which a row is not a row. */
  minPx: 0.8,
} as const

/**
 * How many strikes to ASK the server for per column. Deliberately a constant
 * and not derived from `BUBBLES.levels`: asking for exactly what is drawn would
 * mean the ranking could never see a strike it did not already pick. Ask wide,
 * rank locally.
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
 * v3 (2026-08-29): the bubble knobs are gone from ChartSettings entirely, so
 * there is nothing left to force onto anyone — an old blob's stale keys are
 * simply never read. Kept because the next default that needs pushing will need
 * this, and re-deriving the mechanism is worse than leaving it inert.
 */
const SETTINGS_V = 3
const STALE_ON_UPGRADE: string[] = []

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
