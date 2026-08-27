// ─────────────────────────────────────────────────────────────────────────────
// ES Candles — persisted settings and the frozen bubble constants.
//
// v2 keeps these in a "slot" blob so three charts on one page can share a
// toolbar. v3's ES Candles is a board CARD, and the board already gives each
// card its own identity, so this is one blob per card id — same idea, one less
// level of indirection, and no shared/own mirror to keep in sync.
//
// The RANGES and BUBBLE_STYLE numbers below are transcribed from v2's
// components/dashboard/es-candles/slotStore.ts verbatim. They are the result
// of a lot of looking at the thing; do not "tidy" them.
// ─────────────────────────────────────────────────────────────────────────────

export type Session = 'rth' | 'eth'
export type GexMetric = 'voloi' | 'vol'
export type BubbleBucket = 1 | 5 | 'bar'
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
  /** How many strikes draw per column, ranked by peak |GEX| across the session. */
  bubbleLevels: number
  /** Scales the whole ladder at once. */
  bubbleSize: number
  /** How hard the biggest levels pull away from the rest. 1 = straight linear. */
  bubbleCurve: number
  /** Overall opacity of the layer. */
  bubbleIntensity: number
  /** Time bucket a bubble column covers. */
  bubbleBucket: BubbleBucket
  /** Which GEX quantity a bubble is sized by. */
  gexMetric: GexMetric
  /** The forming-bar countdown in the top-right corner. */
  countdown: boolean
}

export const DEFAULT_SETTINGS: ChartSettings = {
  symbol: 'ES',
  session: 'eth',
  interval: 5,
  bubblesOn: true,
  bubbleLevels: 5,
  bubbleSize: 1,
  bubbleCurve: 1,
  bubbleIntensity: 1,
  bubbleBucket: 'bar',
  gexMetric: 'voloi',
  countdown: true,
}

export const BUBBLE_LEVELS_RANGE = { min: 1, max: 15 }
export const BUBBLE_SIZE_RANGE = { min: 0.4, max: 4 }
export const BUBBLE_CURVE_RANGE = { min: 1, max: 3 }
export const BUBBLE_INTENSITY_RANGE = { min: 0.2, max: 1 }

/**
 * Frozen look of the bubble layer. Everything here is a shape decision, not a
 * preference — the four sliders above are the preferences.
 */
export const BUBBLE_STYLE = {
  /** How many top-ranked strikes go hot + glow. */
  highlight: 1,
  /** Absolute radius cap, px. */
  maxPx: 20,
  /** Cap as a fraction of the ROW (strike) pitch. */
  maxPxRowFrac: 0.42,
  /** Cap as a fraction of the COLUMN (time) pitch. */
  maxPxColFrac: 0.45,
  /** Floor under the column term, so a zoomed-out chart still shows marks. */
  colBoundFloorPx: 7,
  /** Hard radius floor, px. */
  minPx: 0.8,
  glowTopFactor: 0.75,
  glowMinFactor: 0.35,
  glowMaxPx: 9,
  /** The weakest row fades to 1 − fade. */
  fade: 0.55,
  /** Gap kept between adjacent marks before they are allowed to touch. */
  colGapPx: 0.8,
} as const

/**
 * How many strikes to ASK the server for per column. Deliberately a constant
 * and not derived from `bubbleLevels`: a moving value would churn the request
 * URL on every slider drag and defeat the fetch cache. Ask wide, rank locally.
 */
export const BUBBLE_LADDER_REQUEST = 30

/** How far back the bubble history reaches, minutes. One full session + pre. */
export const GEX_HISTORY_MINUTES = 720

// ── Persistence ──────────────────────────────────────────────────────────────

const KEY_PREFIX = 'cb-v3-es-candles:'

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

/** Coerce an unknown parsed blob into a complete, in-range settings object. */
function coerce(raw: unknown): ChartSettings {
  const p = (raw ?? {}) as Partial<Record<keyof ChartSettings, unknown>>
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  const interval = INTERVALS.includes(p.interval as Interval) ? (p.interval as Interval) : DEFAULT_SETTINGS.interval
  return {
    symbol: typeof p.symbol === 'string' && p.symbol ? p.symbol.toUpperCase() : DEFAULT_SETTINGS.symbol,
    session: p.session === 'rth' ? 'rth' : 'eth',
    interval,
    bubblesOn: p.bubblesOn !== false,
    bubbleLevels: Math.round(
      clamp(num(p.bubbleLevels, DEFAULT_SETTINGS.bubbleLevels), BUBBLE_LEVELS_RANGE.min, BUBBLE_LEVELS_RANGE.max),
    ),
    bubbleSize: clamp(num(p.bubbleSize, DEFAULT_SETTINGS.bubbleSize), BUBBLE_SIZE_RANGE.min, BUBBLE_SIZE_RANGE.max),
    bubbleCurve: clamp(num(p.bubbleCurve, DEFAULT_SETTINGS.bubbleCurve), BUBBLE_CURVE_RANGE.min, BUBBLE_CURVE_RANGE.max),
    bubbleIntensity: clamp(
      num(p.bubbleIntensity, DEFAULT_SETTINGS.bubbleIntensity),
      BUBBLE_INTENSITY_RANGE.min,
      BUBBLE_INTENSITY_RANGE.max,
    ),
    bubbleBucket: p.bubbleBucket === 1 || p.bubbleBucket === 5 ? p.bubbleBucket : 'bar',
    gexMetric: p.gexMetric === 'vol' ? 'vol' : 'voloi',
    countdown: p.countdown !== false,
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
    localStorage.setItem(KEY_PREFIX + cardId, JSON.stringify(s))
  } catch {
    /* best-effort — the in-memory settings still drive this session */
  }
}
