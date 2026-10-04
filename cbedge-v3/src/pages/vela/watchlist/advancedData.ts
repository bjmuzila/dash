// ─────────────────────────────────────────────────────────────────────────────
// VELA WATCHLIST — what the Advanced view reads, beyond the quotes (store.ts).
// Every source is one the app already serves; nothing here is new on the server.
//
//   STATS     per symbol, the chart tape: 30 days of 5-minute regular-hours bars
//             through the chart's own provider (CbEdgeProvider.getBars — the same
//             cached request a 5m chart of that symbol makes). From them: today's
//             open / high / low and volume, RELATIVE VOLUME (today's volume so
//             far against the average of the last 20 sessions at the same minute
//             of the day), the 5-day line, the 30-day range, the closes 5 and ~21
//             sessions back (the 5D / 1M change), and today's intraday line.
//             Read at most every 2 minutes per symbol, 3 at a time.
//   GEX       per symbol with an options chain: /api/chains front expiry through
//             board/chainGex (the Key Levels study's own read): net GEX (OI +
//             volume, summed over strikes), call wall, put wall, gamma flip.
//             ES / NQ have no chain of their own (they point at SPX / NDX).
//             Every 5 minutes, 2 at a time, for the first 30 symbols.
//   WHALES    today's ≥ $1M prints for every ticker in one read
//             (/api/lse/whales, no ticker filter): net premium (bullish −
//             bearish) and the prints themselves, per underlying. Every minute.
//   EARNINGS  /proxy/earnings-week (this week and next: date, before / after the
//             open, EPS estimate, market cap) and /api/public-earnings (the
//             earnings study: what the stock did on each of its last reports, for
//             the large caps it covers). Every 30 minutes.
//   CALENDAR  /api/calendar — the week's US economic events. Every 30 minutes.
// ─────────────────────────────────────────────────────────────────────────────

import type { OHLCV } from '@luxalgo/vela'
import { query } from '@/data/api'
import { etDateKey, etMinutesOfDay } from '@/board/gexCandles/candles'
import { chainGexUrl, chainToGex } from '@/board/chainGex'
import { CbEdgeProvider, resolveSym } from '@/pages/vela/cbedgeProvider'

export interface SymStats {
  open: number | null
  high: number | null
  low: number | null
  /** The last bar's close (the price when there is no quote). */
  last: number | null
  /** The previous session's last close. */
  prevClose: number | null
  volume: number | null
  relVol: number | null
  /** Closes across the last 5 sessions, thinned to ~48 points. */
  spark: number[]
  /** Today's 5-minute closes (regular hours). */
  intraday: number[]
  range30: { lo: number; hi: number } | null
  /** Last close of the session 5 / ~21 sessions back. */
  close5: number | null
  close21: number | null
  at: number
}

export interface GexSummary {
  net: number
  callWall: number | null
  putWall: number | null
  flip: number | null
  spot: number
}

export interface WhalePrint {
  ts: number
  sym: string
  type: 'C' | 'P' | null
  strike: number | null
  expiry: string | null
  premium: number
  action: 'BUY' | 'SELL' | null
  bias: 1 | -1 | 0
}
export interface WhaleAgg {
  net: number
  gross: number
  count: number
  prints: WhalePrint[]
}

export interface EarnNext {
  date: string
  session: 'pre' | 'after' | 'unknown'
  epsEst: string | null
  marketCap: number | null
}
export interface EarnMove {
  date: string
  when: string
  day: number | null
  gap: number | null
}

export interface EconEvent {
  date: string
  time: string
  label: string
  title: string
  impact: string
  forecast: string
  previous: string
  actual: string
}

const provider = new CbEdgeProvider()
const listeners = new Set<() => void>()
export function onAdvancedData(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
let notifyQueued = false
function notify(): void {
  if (notifyQueued) return
  notifyQueued = true
  queueMicrotask(() => {
    notifyQueued = false
    for (const fn of listeners) fn()
  })
}

/** Run `fn` over `items`, `n` at a time. */
async function pool<T>(items: readonly T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]!)
    }),
  )
}

// ── Stats off the chart tape ─────────────────────────────────────────────────

const stats = new Map<string, SymStats | null>()
const statsAt = new Map<string, number>()
export const statsOf = (sym: string): SymStats | null | undefined => stats.get(sym)

function thin(xs: number[], max: number): number[] {
  if (xs.length <= max) return xs
  const step = xs.length / max
  const out: number[] = []
  for (let i = 0; i < max; i++) out.push(xs[Math.floor(i * step)]!)
  out.push(xs[xs.length - 1]!)
  return out
}

export function statsFromBars(bars: readonly OHLCV[]): SymStats | null {
  if (!bars.length) return null
  // sessions, oldest first
  const days: OHLCV[][] = []
  let key = ''
  for (const b of bars) {
    const k = etDateKey(b.time)
    if (k !== key) {
      days.push([])
      key = k
    }
    days[days.length - 1]!.push(b)
  }
  const today = days[days.length - 1]!
  const prev = days[days.length - 2]
  let hi = -Infinity
  let lo = Infinity
  let vol = 0
  for (const b of today) {
    hi = Math.max(hi, b.high)
    lo = Math.min(lo, b.low)
    vol += b.volume ?? 0
  }
  // relative volume: today so far vs the same minute of the day, last 20 sessions
  const nowMin = etMinutesOfDay(today[today.length - 1]!.time)
  const past = days.slice(-21, -1)
  let sum = 0
  let n = 0
  for (const d of past) {
    let v = 0
    for (const b of d) if (etMinutesOfDay(b.time) <= nowMin) v += b.volume ?? 0
    if (v > 0) {
      sum += v
      n++
    }
  }
  const avg = n ? sum / n : 0
  let rlo = Infinity
  let rhi = -Infinity
  for (const b of bars) {
    rlo = Math.min(rlo, b.low)
    rhi = Math.max(rhi, b.high)
  }
  const lastClose = (d: OHLCV[] | undefined) => (d && d.length ? d[d.length - 1]!.close : null)
  const five = days.slice(-5).flatMap((d) => d.map((b) => b.close))
  return {
    open: today[0]!.open,
    high: Number.isFinite(hi) ? hi : null,
    low: Number.isFinite(lo) ? lo : null,
    last: today[today.length - 1]!.close,
    prevClose: lastClose(prev),
    volume: vol > 0 ? vol : null,
    relVol: vol > 0 && avg > 0 ? vol / avg : null,
    spark: thin(five, 48),
    intraday: today.map((b) => b.close),
    range30: Number.isFinite(rlo) && Number.isFinite(rhi) ? { lo: rlo, hi: rhi } : null,
    close5: lastClose(days[days.length - 6]),
    close21: lastClose(days[days.length - 22] ?? days[0]),
    at: Date.now(),
  }
}

export async function loadStats(syms: readonly string[]): Promise<void> {
  const now = Date.now()
  const due = syms.filter((s) => now - (statsAt.get(s) ?? 0) > 120_000).slice(0, 80)
  for (const s of due) statsAt.set(s, now)
  await pool(due, 3, async (s) => {
    try {
      const bars = await provider.getBars(s, '5', {})
      stats.set(s, statsFromBars(bars))
    } catch {
      if (!stats.has(s)) stats.set(s, null)
    }
    notify()
  })
}

// ── GEX ─────────────────────────────────────────────────────────────────────

const gex = new Map<string, GexSummary | null>()
const gexAt = new Map<string, number>()
/** The chain a symbol's GEX comes from, or null (futures point at their index instead). */
export function gexTicker(sym: string): string | null {
  const r = resolveSym(sym)
  return r.kind === 'futures' ? null : r.key
}
export const gexOf = (sym: string): GexSummary | null | undefined => gex.get(sym)

export async function loadGex(syms: readonly string[]): Promise<void> {
  const now = Date.now()
  const due = syms.filter((s) => gexTicker(s) && now - (gexAt.get(s) ?? 0) > 300_000).slice(0, 30)
  for (const s of due) gexAt.set(s, now)
  await pool(due, 2, async (s) => {
    try {
      const json = await query<unknown>(chainGexUrl(gexTicker(s)!), { staleMs: 120_000 })
      const c = chainToGex(json)
      if (!c.rows.length) {
        gex.set(s, null)
      } else {
        let net = 0
        for (const r of c.rows) net += (r.netGEX ?? 0) + (r.netVolGEX ?? 0)
        gex.set(s, { net, callWall: c.callWall, putWall: c.putWall, flip: c.flip, spot: c.spot })
      }
    } catch {
      if (!gex.has(s)) gex.set(s, null)
    }
    notify()
  })
}

// ── Whale prints, today, every ticker ────────────────────────────────────────

let whales = new Map<string, WhaleAgg>()
let whalesAt = 0
let whalesDay = ''
/** `SPXW` / `NDXP` prints are SPX / NDX. */
const under = (u: string) => u.toUpperCase().replace(/^(SPX|NDX|RUT|VIX|XSP)[WP]$/, '$1')
export const whalesOf = (sym: string): WhaleAgg | undefined => whales.get(sym)
export const whalesDayKey = (): string => whalesDay

export async function loadWhales(): Promise<void> {
  if (Date.now() - whalesAt < 60_000) return
  whalesAt = Date.now()
  const day = etDateKey(Date.now())
  try {
    const r = await fetch(`/api/lse/whales?from=${day}&to=${day}&min_premium=1000000&sort=time&limit=500`, { cache: 'no-store', credentials: 'same-origin' })
    if (!r.ok) return
    const j = (await r.json()) as { rows?: Record<string, unknown>[] }
    const out = new Map<string, WhaleAgg>()
    for (const row of j.rows ?? []) {
      const sym = under(String(row.underlying ?? row.ticker ?? ''))
      const premium = Number(row.premium) || 0
      const ts = typeof row.ts === 'number' ? row.ts : Date.parse(String(row.ts ?? ''))
      if (!sym || !(premium > 0) || !Number.isFinite(ts)) continue
      const type = row.type === 'C' || row.type === 'P' ? row.type : null
      const action = row.action === 'BUY' || row.action === 'SELL' ? row.action : null
      const bias: 1 | -1 | 0 = !type || !action ? 0 : (action === 'BUY') === (type === 'C') ? 1 : -1
      const p: WhalePrint = {
        ts,
        sym,
        type,
        strike: Number.isFinite(Number(row.strike)) ? Number(row.strike) : null,
        expiry: typeof row.expiry === 'string' ? row.expiry : null,
        premium,
        action,
        bias,
      }
      let a = out.get(sym)
      if (!a) out.set(sym, (a = { net: 0, gross: 0, count: 0, prints: [] }))
      a.net += bias * premium
      a.gross += premium
      a.count++
      a.prints.push(p)
    }
    for (const a of out.values()) a.prints.sort((x, y) => y.ts - x.ts)
    whales = out
    whalesDay = day
    notify()
  } catch {
    /* keep the last read */
  }
}

// ── Earnings ────────────────────────────────────────────────────────────────

let earnNext = new Map<string, EarnNext>()
let earnMoves = new Map<string, EarnMove[]>()
let earnAt = 0
export const earnNextOf = (sym: string): EarnNext | undefined => earnNext.get(sym)
export const earnMovesOf = (sym: string): EarnMove[] | undefined => earnMoves.get(sym)

export async function loadEarnings(): Promise<void> {
  if (Date.now() - earnAt < 30 * 60_000) return
  earnAt = Date.now()
  const today = etDateKey(Date.now())
  await Promise.all([
    (async () => {
      try {
        const j = await query<{ rows?: Record<string, unknown>[] }>('/proxy/earnings-week?week=both', { staleMs: 10 * 60_000 })
        const m = new Map<string, EarnNext>()
        for (const r of j?.rows ?? []) {
          const sym = String(r.symbol ?? '').toUpperCase()
          const date = String(r.date ?? '')
          if (!sym || date < today) continue
          const prev = m.get(sym)
          if (prev && prev.date <= date) continue
          const s = r.session === 'pre' || r.session === 'after' ? r.session : 'unknown'
          const cap = Number(r.market_cap)
          m.set(sym, { date, session: s, epsEst: typeof r.eps_est === 'string' && r.eps_est ? r.eps_est : null, marketCap: Number.isFinite(cap) && cap > 0 ? cap : null })
        }
        earnNext = m
      } catch {
        /* none */
      }
    })(),
    (async () => {
      try {
        const j = await query<{ tickers?: Record<string, unknown[]> }>('/api/public-earnings', { staleMs: 60 * 60_000 })
        const m = new Map<string, EarnMove[]>()
        for (const [sym, rows] of Object.entries(j?.tickers ?? {})) {
          if (!Array.isArray(rows)) continue
          const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
          m.set(
            sym.toUpperCase(),
            rows
              .map((x) => x as Record<string, unknown>)
              .map((x) => ({ date: String(x.date ?? ''), when: String(x.when ?? ''), day: num(x.day), gap: num(x.gap) }))
              .filter((x) => x.date)
              .sort((a, b) => b.date.localeCompare(a.date)),
          )
        }
        earnMoves = m
      } catch {
        /* none */
      }
    })(),
  ])
  notify()
}

// ── Economic calendar ───────────────────────────────────────────────────────

let econ: EconEvent[] = []
let econAt = 0
export const econEvents = (): readonly EconEvent[] => econ

export async function loadEcon(): Promise<void> {
  if (Date.now() - econAt < 30 * 60_000) return
  econAt = Date.now()
  try {
    const j = await query<{ events?: Record<string, unknown>[] } | Record<string, unknown>[]>('/api/calendar', { staleMs: 10 * 60_000 })
    const list = Array.isArray(j) ? j : (j?.events ?? [])
    econ = list
      // the US calendar (the feed's other countries are not this desk's)
      .filter((e) => !e.country || String(e.country).toUpperCase() === 'USD' || String(e.country).toUpperCase() === 'US')
      .map((e) => ({
        date: String(e.date ?? ''),
        time: String(e.time ?? ''),
        label: String(e.time_formatted ?? e.time ?? ''),
        title: String(e.title ?? ''),
        impact: String(e.impact ?? ''),
        forecast: String(e.forecast ?? ''),
        previous: String(e.previous ?? ''),
        actual: String(e.actual ?? ''),
      }))
      .filter((e) => e.date && e.title)
      .sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time)))
    notify()
  } catch {
    /* none */
  }
}
