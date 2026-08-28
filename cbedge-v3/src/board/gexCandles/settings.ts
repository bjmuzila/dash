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
  /** How many strikes draw on EACH side of spot, strongest first. */
  bubbleLevels: number
  /** Scales the whole ladder at once. */
  bubbleSize: number
  /** How hard the biggest levels pull away from the rest. 1 = straight linear. */
  bubbleCurve: number
  /** Overall opacity of the layer. */
  bubbleIntensity: number
  /** Which GEX quantity a bubble is sized by. */
  gexMetric: GexMetric
  /** The forming-bar countdown in the top-right corner. */
  countdown: boolean
}

export const DEFAULT_SETTINGS: ChartSettings = {
  symbol: 'SPX',
  session: 'eth',
  interval: 5,
  bubblesOn: true,
  // Three a side. Six marks is enough to see the corridor you are trading
  // inside without the ladder turning into a wall of circles.
  bubbleLevels: 3,
  bubbleSize: 1,
  bubbleCurve: 1,
  bubbleIntensity: 1,
  gexMetric: 'voloi',
  countdown: true,
}

/** Per SIDE of spot, so the drawn count is up to 2× this. */
export const BUBBLE_LEVELS_RANGE = { min: 1, max: 8 }
export const BUBBLE_SIZE_RANGE = { min: 0.4, max: 4 }
export const BUBBLE_CURVE_RANGE = { min: 1, max: 3 }
export const BUBBLE_INTENSITY_RANGE = { min: 0.2, max: 1 }

/**
 * Frozen look of the bubble layer. Everything here is a shape decision, not a
 * preference — the four sliders above are the preferences.
 */
export const BUBBLE_STYLE = {
  /** Hard radius floor, px. */
  minPx: 0.8,
  /** The core may not exceed this fraction of the pane's height. Spacing alone
   *  would let six marks on a tall, sparse pane grow until the ladder was
   *  mostly circle; this keeps the band proportionate to the chart at every
   *  window size, with no per-layout pixel number to tune. */
  heightFrac: 0.035,
  glowTopFactor: 0.75,
  glowMaxPx: 9,
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

// ── Persistence ──────────────────────────────────────────────────────────────

const KEY_PREFIX = 'cb-v3-gex-candles:'

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

/** Coerce an unknown parsed blob into a complete, in-range settings object. */
function coerce(raw: unknown): ChartSettings {
  const p = (raw ?? {}) as Partial<Record<keyof ChartSettings, unknown>>
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
