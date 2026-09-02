// ─────────────────────────────────────────────────────────────────────────────
// Candles for the GEX Candles card: fetch, roll up, filter by session.
//
// ONE ENDPOINT for every symbol on the board:
//
//   /api/snapshots/etf-candles?symbol=&days=&interval=
//     → { symbol, interval, days, source, rows: [{ timestamp, open, … }] }
//
// …plus ES FUTURES, back since 2026-09-02 as the card's SPX/ES switch:
//
//   /api/snapshots/candles?daysBack=&limit=&interval=&lite=1
//     → { lite: 1, cols: [...], rows: [[timestamp, date, slotKey, …]] }
//
// The futures route is SELECT * out of Postgres, so its BIGINT and REAL
// columns arrive as QUOTED STRINGS unless `lite=1` asks for the columnar
// tuple form, where the handler emits real numbers. This card only ever asks
// lite. `interval` picks the 1m or the 5m table — they share a slotKey space
// and an unfiltered read returns them interleaved. `daysBack` is inclusive of
// today (date >= cutoff), so ONE request covers the window.
//
// Every value on that route is a real JSON number (the handler coerces each
// field). The futures route it replaced was SELECT * out of Postgres, so its
// BIGINT and REAL columns arrived as QUOTED STRINGS and needed a columnar
// `lite=1` mode to avoid them — none of which applies any more.
//
// The route returns HTTP 200 on failure, with an `error` key and no rows, so
// nothing here may branch on res.ok alone.
//
// The recorder stores 1-minute bars and the route buckets to 1 or 5. Anything
// coarser is rolled up client-side by rollup() below.
// ─────────────────────────────────────────────────────────────────────────────

import type { SymbolDef } from './symbols'
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

/** How many calendar days of history to pull. The route clamps this to 1..30. */
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

interface CandlesResponse {
  rows?: Array<Record<string, unknown>>
  source?: string
  error?: string
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * The interval to ASK FOR. The route only buckets to 1 or 5; 15/30/60 are
 * rolled up here. Everything above 5 pulls 5m bars — a 1h chart built from 1m
 * rows is twelve times the payload for an identical picture.
 */
export function nativeInterval(interval: Interval): 1 | 5 {
  return interval === 1 ? 1 : 5
}

export function candlesUrl(def: SymbolDef, interval: Interval, days = HISTORY_DAYS): string {
  return `/api/snapshots/etf-candles?symbol=${encodeURIComponent(def.key)}&days=${days}&interval=${nativeInterval(interval)}`
}

/**
 * `json` is whatever useQuery currently holds, which is `undefined` on the very
 * first render — before the request has resolved — and stays undefined if the
 * fetch fails. Both are normal states, not error states, so this returns an
 * empty series rather than throwing: the card is meant to render its frame,
 * toolbar and empty message while the data is still in the air.
 */
export function parseCandles(json: unknown): Bar[] {
  if (!json || typeof json !== 'object') return []
  const out: Bar[] = []
  for (const r of (json as CandlesResponse).rows ?? []) {
    const t = num(r.timestamp)
    if (!t) continue
    out.push({ t, o: num(r.open), h: num(r.high), l: num(r.low), c: num(r.close), v: num(r.volume) })
  }
  // Sorting an already-sorted array is cheap and removes a whole class of "the
  // chart drew backwards" bug if the route's ordering ever changes.
  out.sort((a, b) => a.t - b.t)
  return out
}

/** The ES futures history, lite-encoded. Same Bar shape out as the ETF route. */
export function esCandlesUrl(interval: Interval, days = HISTORY_DAYS): string {
  // 1m × ~23h × days, with room: the route caps `limit` at 50000.
  return `/api/snapshots/candles?daysBack=${days}&limit=20000&interval=${nativeInterval(interval)}&lite=1`
}

interface LiteCandlesResponse {
  lite?: number
  cols?: unknown
  rows?: unknown
}

/**
 * Parse the futures route. Handles the lite tuple form this card asks for AND
 * the verbose row form, so a client deployed ahead of a backend that ignores
 * `lite` still draws. Same "undefined is not an error" contract as
 * parseCandles.
 */
export function parseEsCandles(json: unknown): Bar[] {
  if (!json || typeof json !== 'object') return []
  const j = json as LiteCandlesResponse
  const rows = j.rows
  if (!Array.isArray(rows) || !rows.length) return []
  const out: Bar[] = []
  if (j.lite === 1 && Array.isArray(j.cols)) {
    const cols = j.cols as string[]
    const ix = (k: string) => cols.indexOf(k)
    const iT = ix('timestamp'), iO = ix('open'), iH = ix('high'), iL = ix('low'), iC = ix('close'), iV = ix('volume')
    if (iT < 0 || iC < 0) return []
    for (const tuple of rows as unknown[][]) {
      const t = num(tuple[iT])
      const c = num(tuple[iC])
      if (!t || !(c > 0)) continue
      out.push({ t, o: num(tuple[iO]), h: num(tuple[iH]), l: num(tuple[iL]), c, v: num(tuple[iV]) })
    }
  } else {
    for (const r of rows as Array<Record<string, unknown>>) {
      const t = num(r.timestamp)
      const c = num(r.close)
      if (!t || !(c > 0)) continue
      out.push({ t, o: num(r.open), h: num(r.high), l: num(r.low), c, v: num(r.volume) })
    }
  }
  out.sort((a, b) => a.t - b.t)
  return out
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
    const offset = etMinutesOfDay(b.t) - RTH_OPEN_MIN
    // Math.floor, not a truncating divide: pre-market offsets are negative and
    // truncation would fold 09:25 and 09:35 into one bucket.
    const key = `${etDateKey(b.t)}#${Math.floor(offset / interval)}`
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
 * Falls back to the full series rather than to an empty chart — a symbol with
 * no RTH rows yet should still draw something.
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
