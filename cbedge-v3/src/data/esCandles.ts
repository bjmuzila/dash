import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { dedupeFetch } from './dedupeFetch'
import { useFrame } from './hooks'

// ─────────────────────────────────────────────────────────────────────────────
// OHLC BARS — ES futures off the socket, ETFs off the recorder.
//
// v2 split these across three files (hooks/useEsCandles, hooks/useEtfCandles,
// lib/snapdb's candle queries). They are one module here because they are one
// idea with two transports, and keeping the OUTPUT shape identical is the whole
// point: a panel can hold ES bars or SPY bars without knowing which.
//
//   useEsCandles   /api/snapshots/candles for history + the socket's
//                  `esCandles` frame for the bar still forming. ES only — the
//                  live feed subscribes futures, and there is no such stream
//                  for an ETF.
//   useEtfCandles  /api/snapshots/etf-candles on a 60s poll. The rows are
//                  WRITTEN once a minute by server-v2/etf-candle-recorder.js,
//                  so polling faster only re-fetches the same bars.
//
// Bolting a poll onto a socket hook would mean two lifecycles fighting inside
// one effect, so the transports stay separate and only the shape is shared.
// ─────────────────────────────────────────────────────────────────────────────

export interface EsCandleRecord {
  timestamp: number
  date: string
  slotKey: string
  time?: string
  symbol?: string
  intervalMinutes?: number
  source?: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  avgVolume?: number
  /** Per-slot volume baselines, attached only when `withAverages` is on. */
  avg5?: number
  avg14?: number
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Expand the `?lite=1` columnar payload ({cols, rows:[[…]]}) back into records.
 *
 * The verbose form repeats all twelve key names on every bar and ships pg
 * BIGINT/REAL columns as quoted strings — a 20-day 5m pull is ~114KB, most of
 * it punctuation. Falls through to the legacy `rows` shape when the server does
 * not answer lite, so a client deployed ahead of the backend still works.
 */
function expandCandles(json: unknown): EsCandleRecord[] {
  const j = (json ?? {}) as { lite?: number; cols?: unknown; rows?: unknown }
  const rows = j.rows
  if (!Array.isArray(rows) || !rows.length) return []

  const normalize = (r: Record<string, unknown>): EsCandleRecord => ({
    ...(r as unknown as EsCandleRecord),
    timestamp: num(r.timestamp),
    date: String(r.date ?? ''),
    slotKey: String(r.slotKey ?? ''),
    open: num(r.open),
    high: num(r.high),
    low: num(r.low),
    close: num(r.close),
    volume: num(r.volume),
  })

  if (j.lite !== 1 || !Array.isArray(j.cols)) {
    return (rows as Record<string, unknown>[]).map(normalize)
  }
  const cols = j.cols as string[]
  return (rows as unknown[][]).map((tuple) => {
    const rec: Record<string, unknown> = {}
    for (let i = 0; i < cols.length; i++) {
      const key = cols[i]
      if (key) rec[key] = tuple[i]
    }
    return normalize(rec)
  })
}

async function fetchCandles(url: string): Promise<EsCandleRecord[]> {
  const res = await dedupeFetch(url, { cache: 'no-store' }, 5_000)
  if (!res.ok) throw new Error(`candles HTTP ${res.status}`)
  return expandCandles(await res.json())
}

function etDateStr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}

// ── per-slot volume baselines ────────────────────────────────────────────────

function slotTimeOf(c: EsCandleRecord): string {
  // "YYYY-MM-DDTHH:MM" → "HH:MM"
  const i = c.slotKey.indexOf('T')
  return i >= 0 ? c.slotKey.slice(i + 1) : c.slotKey
}

function dateOf(c: EsCandleRecord): string {
  if (c.date) return c.date
  const i = c.slotKey.indexOf('T')
  return i >= 0 ? c.slotKey.slice(0, i) : ''
}

/** Average volume for each intraday slot over the previous `nDays` sessions. */
function buildSlotAverages(
  historical: EsCandleRecord[],
  today: string,
  nDays: number,
): Map<string, number> {
  const byDate = new Map<string, EsCandleRecord[]>()
  for (const c of historical) {
    const d = dateOf(c)
    if (!d || d >= today) continue
    const list = byDate.get(d)
    if (list) list.push(c)
    else byDate.set(d, [c])
  }
  const days = [...byDate.keys()].sort().slice(-nDays)
  const sums = new Map<string, { total: number; n: number }>()
  for (const d of days) {
    for (const c of byDate.get(d) ?? []) {
      const slot = slotTimeOf(c)
      const acc = sums.get(slot)
      if (acc) {
        acc.total += c.volume
        acc.n += 1
      } else {
        sums.set(slot, { total: c.volume, n: 1 })
      }
    }
  }
  const out = new Map<string, number>()
  for (const [slot, acc] of sums) out.set(slot, acc.n ? acc.total / acc.n : 0)
  return out
}

export interface UseEsCandlesResult {
  /** Today's bars only, with avg5 / avg14 attached when asked for. */
  candles: EsCandleRecord[]
  /** Rolling ~30h continuous-session view, so the overnight tape is included. */
  sessionCandles: EsCandleRecord[]
  /** The un-clipped history read. */
  historical: EsCandleRecord[]
  connected: boolean
  refresh: () => Promise<void>
}

/**
 * @param enabled       false disables the hook entirely.
 * @param historyDays   CALENDAR days of history. The prior TRADING session is
 *                      three of them back on a Monday and four after a holiday,
 *                      which is why callers that need it pass 8 rather than 3.
 * @param intervalMinutes 1 or 5. `es_candles` holds both keyed on the same slot
 *                      space, so an unfiltered read returns them interleaved.
 * @param withAverages  Compute the 5/14-day per-slot volume baselines attached
 *                      to `candles`. Off for callers that only want
 *                      `sessionCandles` / `historical`.
 */
export function useEsCandles(
  enabled = true,
  historyDays = 20,
  intervalMinutes: 1 | 5 = 5,
  withAverages = true,
): UseEsCandlesResult {
  const [todayRows, setTodayRows] = useState<EsCandleRecord[]>([])
  const [historical, setHistorical] = useState<EsCandleRecord[]>([])
  const [ok, setOk] = useState(false)

  // Live bars, kept REGARDLESS of date so the overnight (prior-day-dated)
  // session survives. `todayRows` is today-only and feeds `candles`, which the
  // relative-volume consumers expect to be today's alone.
  const liveRef = useRef<Map<string, EsCandleRecord>>(new Map())
  const [liveTick, setLiveTick] = useState(0)

  const frame = useFrame<{ data?: unknown }>(intervalMinutes === 1 ? 'es1mCandles' : 'esCandles')

  const load = useCallback(async () => {
    if (!enabled) return
    try {
      const [today, hist] = await Promise.all([
        fetchCandles(
          `/api/snapshots/candles?date=${etDateStr()}&interval=${intervalMinutes}&limit=2000&lite=1`,
        ),
        fetchCandles(
          `/api/snapshots/candles?daysBack=${historyDays}&limit=20000&interval=${intervalMinutes}&lite=1`,
        ),
      ])
      setTodayRows(today)
      setHistorical(hist)
      setOk(today.length > 0 || hist.length > 0)
    } catch {
      // Keep the last good bars on screen. A blip in one refresh must not blank
      // a chart that is otherwise correct.
      setOk(false)
    }
  }, [enabled, historyDays, intervalMinutes])

  useEffect(() => {
    if (!enabled) return
    void load()
  }, [enabled, load])

  /**
   * Live bars off the socket.
   *
   * The map is written on every frame and the RENDER is what is coalesced —
   * data/store.ts already batches frames into one rAF, so a tick that changes
   * nothing about the bar we hold costs one comparison rather than a re-render
   * of every consumer.
   */
  useEffect(() => {
    if (!enabled || !frame) return
    const raw = (frame as { data?: unknown }).data
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as { candles?: unknown } | undefined)?.candles)
        ? ((raw as { candles: unknown[] }).candles)
        : []
    if (!list.length) return
    let changed = false
    for (const item of list as Record<string, unknown>[]) {
      const slotKey = String(item.slotKey ?? '')
      if (!slotKey) continue
      const bar: EsCandleRecord = {
        timestamp: num(item.timestamp),
        date: String(item.date ?? ''),
        slotKey,
        open: num(item.open),
        high: num(item.high),
        low: num(item.low),
        close: num(item.close),
        volume: num(item.volume),
      }
      const prev = liveRef.current.get(slotKey)
      if (
        !prev ||
        prev.open !== bar.open ||
        prev.high !== bar.high ||
        prev.low !== bar.low ||
        prev.close !== bar.close ||
        prev.volume !== bar.volume
      ) {
        liveRef.current.set(slotKey, bar)
        changed = true
      }
    }
    if (changed) setLiveTick((n) => n + 1)
  }, [enabled, frame])

  const candles = useMemo<EsCandleRecord[]>(() => {
    void liveTick
    const today = etDateStr()
    const map = new Map<string, EsCandleRecord>()
    for (const c of todayRows) if (c.slotKey) map.set(c.slotKey, c)
    for (const c of liveRef.current.values()) if (dateOf(c) === today) map.set(c.slotKey, c)
    const rows = [...map.values()].sort(
      (a, b) => a.timestamp - b.timestamp || a.slotKey.localeCompare(b.slotKey),
    )
    if (!withAverages) return rows
    const avg5 = buildSlotAverages(historical, today, 5)
    const avg14 = buildSlotAverages(historical, today, 14)
    return rows.map((c) => {
      const slot = slotTimeOf(c)
      return { ...c, avg5: avg5.get(slot) ?? 0, avg14: avg14.get(slot) ?? 0 }
    })
  }, [todayRows, historical, withAverages, liveTick])

  /**
   * Rolling continuous-session view: ~30h of bars regardless of ET date, so the
   * overnight (prior-day-dated) session is included and a chart follows into a
   * new day. Live wins on slotKey.
   */
  const sessionCandles = useMemo<EsCandleRecord[]>(() => {
    void liveTick
    const cutoff = Date.now() - 30 * 60 * 60 * 1000
    const map = new Map<string, EsCandleRecord>()
    for (const c of historical) if (c.slotKey && c.timestamp >= cutoff) map.set(c.slotKey, c)
    for (const c of todayRows) if (c.slotKey && c.timestamp >= cutoff) map.set(c.slotKey, c)
    for (const c of liveRef.current.values()) if (c.timestamp >= cutoff) map.set(c.slotKey, c)
    return [...map.values()].sort(
      (a, b) => a.timestamp - b.timestamp || a.slotKey.localeCompare(b.slotKey),
    )
  }, [historical, todayRows, liveTick])

  return { candles, sessionCandles, historical, connected: ok, refresh: load }
}

// ── ETFs ─────────────────────────────────────────────────────────────────────

const ETF_REFRESH_MS = 60_000

export interface UseEtfCandlesResult {
  /** Bars oldest-first, same field names as the ES records. */
  rows: EsCandleRecord[]
  /** True once a request has come back (success or empty). */
  loaded: boolean
  /** Mirrors useEsCandles' `connected` so a status badge can stay generic. */
  connected: boolean
  refresh: () => Promise<void>
}

/**
 * @param symbol   "SPY" | "QQQ" | … — an EMPTY string disables the hook
 *                 entirely (no fetch, no interval), which is how a page turns
 *                 it off when it is back on the futures.
 * @param days     Calendar days of history to request.
 * @param interval Bar size in minutes. The server aggregates from stored 1m.
 */
export function useEtfCandles(symbol: string, days = 5, interval: 1 | 5 = 5): UseEtfCandlesResult {
  const [rows, setRows] = useState<EsCandleRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [ok, setOk] = useState(false)
  const unmountedRef = useRef(false)
  // Monotonic token: a slow SPY request must not land after the user has
  // already switched to QQQ and overwrite its bars with the wrong instrument.
  const seqRef = useRef(0)

  const sym = (symbol || '').trim().toUpperCase()

  const load = useCallback(async () => {
    if (!sym) return
    const seq = ++seqRef.current
    try {
      const next = await fetchCandles(
        `/api/snapshots/etf-candles?symbol=${encodeURIComponent(sym)}&days=${days}&interval=${interval}`,
      )
      if (unmountedRef.current || seq !== seqRef.current) return
      // Identity-guarded. The poll returns the whole history window every time
      // and at most one row of it is new; handing the consumer a fresh array
      // regardless costs a full re-render and a full redraw for nothing.
      //
      // FULL compare, not just the newest bar: the recorder revises earlier bars
      // (a late print, a corrected volume), so a last-bar-only check would drop
      // any mid-array correction for good.
      setRows((prev) => {
        if (prev.length !== next.length) return next
        for (let i = 0; i < next.length; i++) {
          const a = prev[i]
          const b = next[i]
          if (!a || !b) return next
          if (
            a.slotKey !== b.slotKey ||
            a.open !== b.open ||
            a.high !== b.high ||
            a.low !== b.low ||
            a.close !== b.close ||
            a.volume !== b.volume
          ) {
            return next
          }
        }
        return prev
      })
      setOk(next.length > 0)
    } catch {
      if (seq === seqRef.current && !unmountedRef.current) setOk(false)
    } finally {
      if (seq === seqRef.current && !unmountedRef.current) setLoaded(true)
    }
  }, [sym, days, interval])

  // Switching symbol must CLEAR first. Otherwise the chart shows QQQ's title
  // over SPY's bars for one refresh cycle, and — worse — the price scale keeps
  // the old instrument's range while the new bars stream in.
  useEffect(() => {
    setRows([])
    setLoaded(false)
    setOk(false)
  }, [sym, interval])

  useEffect(() => {
    unmountedRef.current = false
    if (!sym) {
      return () => {
        unmountedRef.current = true
      }
    }
    void load()
    const id = setInterval(() => void load(), ETF_REFRESH_MS)
    return () => {
      unmountedRef.current = true
      clearInterval(id)
    }
  }, [sym, load])

  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.timestamp - b.timestamp || a.slotKey.localeCompare(b.slotKey)),
    [rows],
  )

  return { rows: sorted, loaded, connected: ok, refresh: load }
}
