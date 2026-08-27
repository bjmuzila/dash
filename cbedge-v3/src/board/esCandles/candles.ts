// ─────────────────────────────────────────────────────────────────────────────
// Candles for the ES Candles card: fetch, roll up, filter by session.
//
// TWO ENDPOINTS, not one. The backend keeps futures and equities in different
// tables and the routes are not interchangeable — /api/snapshots/candles only
// looks at the symbol to decide ES vs NQ, so asking it for SPY silently hands
// back ES bars. That silent-wrong-data failure is the reason the split lives
// in one file with a comment on it.
//
//   es   → /api/snapshots/candles?daysBack&interval&limit&lite=1   (ES, NQ)
//   etf  → /api/snapshots/etf-candles?symbol&days&interval         (everything else)
//
// `lite=1` is not an optimisation flourish: the verbose form is SELECT * out of
// Postgres, so BIGINT and REAL columns arrive as QUOTED STRINGS. The columnar
// lite form is real JSON numbers, which is what lightweight-charts requires for
// `time` and what every price comparison here assumes.
//
// Both endpoints return HTTP 200 on failure with an `error` key and no rows, so
// nothing downstream may branch on res.ok alone.
// ─────────────────────────────────────────────────────────────────────────────

import type { CandleSource, SymbolDef } from './symbols'
import type { Interval, Session } from './settings'

export interface Bar {
  /** Epoch ms of the bar's OPEN. */
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

/** How many calendar days of history to pull. */
export const HISTORY_DAYS = 5

// ── ET helpers ───────────────────────────────────────────────────────────────
// One formatter, built once. Constructing an Intl.DateTimeFormat per bar is
// startlingly expensive and this runs over thousands of them.

const ET_HM = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const ET_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Minutes since ET midnight for an epoch-ms instant. */
export function etMinutesOfDay(ms: number): number {
  const parts = ET_HM.formatToParts(new Date(ms))
  let h = 0
  let m = 0
  for (const p of parts) {
    if (p.type === 'hour') h = Number(p.value) % 24
    else if (p.type === 'minute') m = Number(p.value)
  }
  return h * 60 + m
}

/** 'YYYY-MM-DD' in ET. */
export function etDateKey(ms: number): string {
  return ET_DATE.format(new Date(ms))
}

export const RTH_OPEN_MIN = 9 * 60 + 30 // 09:30 ET
export const RTH_CLOSE_MIN = 16 * 60 // 16:00 ET

// ── Fetch ────────────────────────────────────────────────────────────────────

interface LiteResponse {
  lite?: number
  cols?: string[]
  rows?: unknown[][]
}
interface VerboseResponse {
  rows?: Array<Record<string, unknown>>
  error?: string
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function fromLite(json: LiteResponse): Bar[] {
  const cols = json.cols ?? []
  const idx = (name: string) => cols.indexOf(name)
  const iT = idx('timestamp')
  const iO = idx('open')
  const iH = idx('high')
  const iL = idx('low')
  const iC = idx('close')
  const iV = idx('volume')
  if (iT < 0 || iC < 0) return []
  const out: Bar[] = []
  for (const r of json.rows ?? []) {
    const t = num(r[iT])
    if (!t) continue
    out.push({ t, o: num(r[iO]), h: num(r[iH]), l: num(r[iL]), c: num(r[iC]), v: iV >= 0 ? num(r[iV]) : 0 })
  }
  return out
}

function fromVerbose(json: VerboseResponse): Bar[] {
  const out: Bar[] = []
  for (const r of json.rows ?? []) {
    const t = num(r.timestamp)
    if (!t) continue
    out.push({ t, o: num(r.open), h: num(r.high), l: num(r.low), c: num(r.close), v: num(r.volume) })
  }
  return out
}

/**
 * The interval to ASK FOR. The recorders only store 1m and 5m; 15/30/60 are
 * rolled up here. Everything above 5 pulls 5m bars — a 1h chart built from 1m
 * rows is twelve times the payload for an identical picture.
 */
export function nativeInterval(interval: Interval): 1 | 5 {
  return interval === 1 ? 1 : 5
}

export function candlesUrl(def: SymbolDef, interval: Interval, days = HISTORY_DAYS): string {
  const iv = nativeInterval(interval)
  if (def.candleSource === 'es') {
    const sym = def.key === 'NQ' ? '&symbol=%2FNQ' : ''
    return `/api/snapshots/candles?daysBack=${days}&limit=20000&interval=${iv}&lite=1${sym}`
  }
  const sym = encodeURIComponent(def.candleSymbol ?? def.key)
  return `/api/snapshots/etf-candles?symbol=${sym}&days=${days}&interval=${iv}`
}

export function parseCandles(source: CandleSource, json: unknown): Bar[] {
  const bars =
    source === 'es' && (json as LiteResponse)?.lite
      ? fromLite(json as LiteResponse)
      : fromVerbose(json as VerboseResponse)
  // The no-filter form of /api/snapshots/candles comes back DESC. Sorting is
  // cheap on an already-sorted array and removes a whole class of "the chart
  // drew backwards" bug.
  bars.sort((a, b) => a.t - b.t)
  return bars
}

// ── Roll-up ──────────────────────────────────────────────────────────────────

/**
 * Aggregate native bars into `interval`-minute bars, ANCHORED TO 09:30 ET
 * rather than to the hour. An hourly chart whose buckets start at 09:00 puts
 * the cash open in the middle of a bar, which is the one boundary that has to
 * be a boundary.
 */
export function rollup(bars: Bar[], interval: Interval): Bar[] {
  if (interval <= 5 || bars.length === 0) return bars
  const out: Bar[] = []
  let cur: Bar | null = null
  let curKey = ''
  for (const b of bars) {
    const mins = etMinutesOfDay(b.t)
    const offset = mins - RTH_OPEN_MIN
    // Math.floor, not a truncating divide: pre-market offsets are negative and
    // truncation would fold 09:25 and 09:35 into one bucket.
    const bucket = Math.floor(offset / interval)
    const key = `${etDateKey(b.t)}#${bucket}`
    if (!cur || key !== curKey) {
      if (cur) out.push(cur)
      cur = { ...b }
      curKey = key
      continue
    }
    cur.h = Math.max(cur.h, b.h)
    cur.l = Math.min(cur.l, b.l)
    cur.c = b.c
    cur.v += b.v
  }
  if (cur) out.push(cur)
  return out
}

/**
 * RTH = the New York cash session only. A pure client-side row filter, exactly
 * as v2 does it: lightweight-charts' scale is index-based, so the 16:00 → 09:30
 * gap closes by itself and no session shading or timeScale surgery is needed.
 *
 * Falls back to the full series rather than to an empty chart — an overnight
 * symbol with no RTH rows yet should still draw something.
 */
export function filterSession(bars: Bar[], session: Session): Bar[] {
  if (session !== 'rth') return bars
  const rth = bars.filter((b) => {
    const m = etMinutesOfDay(b.t)
    return m >= RTH_OPEN_MIN && m < RTH_CLOSE_MIN
  })
  return rth.length ? rth : bars
}

/** mm:ss, or h:mm:ss past an hour. */
export function fmtCountdown(msLeft: number): string {
  const s = Math.max(0, Math.floor(msLeft / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (v: number) => String(v).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}
