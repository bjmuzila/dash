// ─────────────────────────────────────────────────────────────────────────────
// THE CB EDGE DATA PROVIDER FOR VELA.
//
// Vela (github.com/LuxAlgo/Vela, Apache-2.0) ships providers for three crypto
// venues and nothing else. A chart on this dashboard has to draw OUR tape —
// SPX, the ETFs and single names the recorder keeps, and the ES / NQ futures —
// so this is Vela's `DataProvider` port implemented over the same routes the
// GEX Candles card already reads. No new backend route, no second recorder:
//
//   history   /api/snapshots/etf-candles      every cash symbol (SPX, SPY, NVDA…)
//             /api/snapshots/candles          ES and NQ futures (lite tuples)
//   long      D / W / M reach past the tape's ~30 sessions (longHistory below):
//             /api/vela/history (years of daily / weekly / monthly bars, when
//             the server has it), then — owner — the LSE vault (/api/lse/candles),
//             then /api/dxlink/candles (weekly, ~13 months) for W and M
//   deep      owner only: ES / NQ intraday older than the tape comes from the
//             LSE vault as Vela scrolls back (getBars' backward pages)
//   live      /api/snapshots/etf-candles/live/stream   SSE, ~1 frame a second,
//             with the /live probe underneath as the quiet-stream fallback
//             es1mCandles / nq1mCandles       the socket's futures frames, read
//                                             through watchFrame (non-negotiable 2:
//                                             pages never touch the socket)
//
// The URL builders, the parsers and the zero-guarding all come from
// board/gexCandles/candles.ts, so a fix to how a bar is read is a fix here too.
//
// ── What the routes can and cannot answer ────────────────────────────────────
// They serve "the last N days", not an arbitrary [from, to) window, and they
// bucket to 1m or 5m only. So:
//
//   · Every request pulls the widest window the timeframe needs once (through
//     api.ts `query`, so a second cell on the same symbol shares it) and is then
//     filtered to Vela's `range` here. Vela's backfill asks for bars older than
//     the oldest it holds; that filter answers EMPTY, which is exactly how Vela
//     learns the history ended (`history:complete`, reason `genesis`).
//   · Anything coarser than 5m is rolled up client-side, anchored to 09:30 ET
//     like rollup() in candles.ts — an hourly bar must start at the cash open.
//     Daily bars are rolled from the 5m tape too, so D shows ~30 sessions, not
//     years. That is the depth the recorder keeps; inventing more is not on.
//
// ── Sessions ─────────────────────────────────────────────────────────────────
// Every symbol declares `session` / `session_extended` in its SymbolInfo, which
// is what turns on Vela's RTH/ETH switch and its pre/post shading. `regular` is
// the default (Vela's own convention: an unset session is the provider default,
// and the switch draws RTH lit), and the filter is the same 09:30–16:00 ET one
// the GEX Candles card uses.
//
// EVERYTHING OUTSIDE 09:30–16:00 IS SHADED on an ETH chart (Brandon, 2026-10-05:
// "9:30–4:00 eastern should not be shaded, the rest should"). The cash names'
// tape carries the overnight session too (Sunday–Thursday 20:00–04:00), which a
// 04:00–20:00 extended window left unshaded, so a Monday morning read as if the
// session had started at 20:00 Sunday. Cash names now declare an OVERNIGHT
// extended session, `2000-2000`, the same shape the futures' `1800-1700` is:
// Vela then shades every weekday from 00:00 to the open, from the close to
// 24:00, and Sunday from 20:00 (Friday stops at 20:00), in one extended tint.
// The calendar's extended windows match it (the evening before at 20:00 to that
// day's 20:00), so the market badge reads the overnight hours as a session; the
// legend card names them PRE-MARKET / AFTER HOURS / OVERNIGHT by the clock.
//
// The calendar (`getCalendar`) is WEEKDAYS ONLY. No route here knows the
// exchange holidays, so on a holiday the market badge will say open while no
// bars arrive. Honest about it here rather than pretending.
// ─────────────────────────────────────────────────────────────────────────────

import type { BarRange, DataProvider, OHLCV, ProviderInfo, SymbolDescriptor, SymbolInfo } from '@luxalgo/vela'
import { query } from '@/data/api'
import { watchFrame, watchWake } from '@/data/hooks'
import {
  LIVE_FALLBACK_MS,
  LIVE_QUIET_MS,
  RTH_CLOSE_MIN,
  RTH_OPEN_MIN,
  candlesUrl,
  esCandlesUrl,
  etDateKey,
  etMinutesOfDay,
  liveCandleUrl,
  liveStreamUrl,
  parseCandles,
  parseEsCandles,
  type Bar,
} from '@/board/gexCandles/candles'
import { SYMBOLS, TICKER_RE, loadRoster, symbolDef } from '@/board/gexCandles/symbols'
import { tickerLogoUrls } from '@/pages/economicCalendar/ChipLogo'

/** The registration name. A symbol typed as `cbedge:XYZ` routes here directly. */
import { PROVIDER_NAME } from './providerName'
export { PROVIDER_NAME }

const MIN_MS = 60_000
const DAY_MS = 86_400_000

/** History windows, in SESSIONS, per native bucket (the ETF route counts sessions since 2026-10-07; clamps to 30). */
const DAYS_1M = 5
const DAYS_5M = 30
/** The ETF route defaults `limit` to 5000 rows — 30 days of 5m ETH is ~5,800. */
const ETF_ROW_LIMIT = 8000
/** How long one history pull is shared before a new request goes out. */
const HISTORY_STALE_MS = 20_000
/** Hidden longer than this, the live feed re-reads history on return to fill the gap. */
const CATCH_UP_AFTER_MS = 30_000
// Reopen backoff for a live stream the browser closed (non-200 on reconnect).
const REOPEN_MIN_MS = 3_000
const REOPEN_MAX_MS = 60_000
/** A live minute older than this cannot START a forming bar (see subscribe). */
const STALE_LIVE_MS = 30 * MIN_MS

/** Futures open at 18:00 ET for the next day's session. */
const FUT_OPEN_MIN = 18 * 60
/** The cash names' after hours end, and their overnight session opens, at 20:00 ET. */
const CASH_NIGHT_MIN = 20 * 60

// ── Symbols ──────────────────────────────────────────────────────────────────

// The values are Vela's symbol-search tab vocabulary: 'stock', 'etf' and
// 'futures' land under their tabs; 'index' shows under All.
export type SymKind = 'index' | 'etf' | 'stock' | 'futures'

export interface ResolvedSym {
  /** The ticker as the routes want it. */
  key: string
  kind: SymKind
  /** Futures product, for /api/snapshots/candles?symbol= and the socket frame. */
  fut?: 'ES' | 'NQ'
}

const FUTURES: Record<string, 'ES' | 'NQ'> = { ES: 'ES', '/ES': 'ES', ES1: 'ES', NQ: 'NQ', '/NQ': 'NQ', NQ1: 'NQ' }
const INDEXES = new Set(['SPX', 'NDX', 'VIX', 'RUT', 'XSP'])
// The funds: this app's original thirteen plus the scanner's fund list
// (data/scannerTickers.ts ETF_SYMBOLS), inlined so the page chunk does not carry
// the whole scanner universe. Without them IBIT, SOXL, TQQQ… were typed 'stock'
// and landed under Stocks in the ticker picker.
const ETFS = new Set([
  'SPY', 'QQQ', 'IWM', 'DIA', 'TLT', 'GLD', 'SLV', 'XLF', 'XLE', 'XLK', 'SMH', 'HYG', 'USO',
  'IBIT', 'ETHA', 'SOXL', 'TQQQ', 'TSLL', 'SQQQ', 'SOXS', 'VXX', 'IEF', 'BNO', 'FXI', 'DRAM', 'EWZ',
  'EEM', 'LQD', 'EFA', 'GDX', 'KWEB', 'EWY', 'ARKK', 'IGV', 'SOXX', 'XLC', 'XLY', 'XLV', 'SKHY',
])

const DESCRIPTIONS: Record<string, string> = {
  SPX: 'S&P 500 Index',
  NDX: 'Nasdaq-100 Index',
  VIX: 'CBOE Volatility Index',
  SPY: 'SPDR S&P 500 ETF',
  QQQ: 'Invesco QQQ Trust',
  IWM: 'iShares Russell 2000 ETF',
  ES: 'E-mini S&P 500 futures (front month)',
  NQ: 'E-mini Nasdaq-100 futures (front month)',
  AAPL: 'Apple',
  AMD: 'Advanced Micro Devices',
  AMZN: 'Amazon',
  GOOGL: 'Alphabet',
  META: 'Meta Platforms',
  MSFT: 'Microsoft',
  NVDA: 'NVIDIA',
  TSLA: 'Tesla',
}

function kindOf(key: string): SymKind {
  if (FUTURES[key]) return 'futures'
  if (INDEXES.has(key)) return 'index'
  if (ETFS.has(key)) return 'etf'
  return 'stock'
}

/**
 * Resolve what Vela hands us. Futures are matched BEFORE symbolDef(), because
 * symbolDef() deliberately maps ES → SPX and NQ → NDX for the board (the GEX
 * Candles card charts the futures through its switch, not as symbols). Here a
 * futures contract is a symbol in its own right.
 */
export function resolveSym(ticker: string): ResolvedSym {
  const raw = ticker.trim().toUpperCase().replace(/!$/, '')
  const fut = FUTURES[raw]
  if (fut) return { key: fut, kind: 'futures', fut }
  const key = symbolDef(raw).key
  return { key, kind: kindOf(key) }
}

/**
 * The venue the charts NAME — the legend's "SPX · VOLTICK.IO · 5m", the picker's badge.
 * Vela shows a descriptor's `prefix` there instead of the provider name. Display only:
 * `cbedge:SPX` (the provider name) still routes here, so saved layouts load unchanged,
 * and `VOLTICK.IO:SPX` resolves too, through this prefix.
 */
export const VENUE = 'VOLTICK.IO'

/** Every name the ticker picker shows (symbolNames.ts), loaded on first use. */
let namesP: Promise<Readonly<Record<string, string>>> | null = null
function symbolNames(): Promise<Readonly<Record<string, string>>> {
  return (namesP ??= import('./symbolNames').then(
    (m) => m.SYMBOL_NAMES,
    () => {
      namesP = null
      return DESCRIPTIONS
    },
  ))
}

function descriptor(key: string, names: Readonly<Record<string, string>>): SymbolDescriptor {
  const kind = kindOf(key)
  return { ticker: key, description: names[key] ?? DESCRIPTIONS[key], type: kind, prefix: VENUE }
}

// ── ET time helpers ──────────────────────────────────────────────────────────

const ET_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

/** ET wall clock minus UTC, in minutes, at instant `ms` (e.g. -240 in summer). */
function etOffsetMin(ms: number): number {
  const p: Record<string, number> = {}
  for (const part of ET_PARTS.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value)
  }
  const wall = Date.UTC(p.year ?? 1970, (p.month ?? 1) - 1, p.day ?? 1, (p.hour ?? 0) % 24, p.minute ?? 0)
  return Math.round((wall - Math.floor(ms / MIN_MS) * MIN_MS) / MIN_MS)
}

/** Epoch ms of an ET wall-clock time. Two passes so a DST edge lands right. */
function etWall(y: number, mo: number, d: number, minuteOfDay: number): number {
  const guess = Date.UTC(y, mo - 1, d, 0, minuteOfDay)
  const first = guess - etOffsetMin(guess) * MIN_MS
  const second = guess - etOffsetMin(first) * MIN_MS
  return second
}

/** 'YYYY-MM-DD' → [y, m, d]. */
function ymd(key: string): [number, number, number] {
  const [y, m, d] = key.split('-').map(Number)
  return [y ?? 1970, m ?? 1, d ?? 1]
}

/** The ET calendar date one day after `key`. */
function nextDateKey(key: string): string {
  const [y, m, d] = ymd(key)
  return new Date(Date.UTC(y, m - 1, d) + DAY_MS).toISOString().slice(0, 10)
}

/** Day of week (0 = Sunday) for an ET date key. */
function weekday(key: string): number {
  const [y, m, d] = ymd(key)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

const isRth = (t: number) => {
  const m = etMinutesOfDay(t)
  return m >= RTH_OPEN_MIN && m < RTH_CLOSE_MIN
}

// ── Timeframes ───────────────────────────────────────────────────────────────

type Tf = { kind: 'min'; minutes: number } | { kind: 'day' } | { kind: 'week' } | { kind: 'month' }

/** Vela's vocabulary: a bare number is minutes, D/W/M are named, `4h` etc. are aliases. */
function parseTf(timeframe: string): Tf {
  const tf = timeframe.trim()
  // D / W / M (a multiple — 2D, 3M — is served as its base unit; Pine's capital M is a
  // month, never minutes)
  if (/^\d*D$/i.test(tf)) return { kind: 'day' }
  if (/^\d*W$/i.test(tf)) return { kind: 'week' }
  if (/^\d*M$/.test(tf) || /^\d*MO$/i.test(tf)) return { kind: 'month' }
  const m = /^(\d+)\s*([mhdw])?$/i.exec(tf)
  if (m) {
    const n = Math.max(1, parseInt(m[1] ?? '1', 10))
    const unit = (m[2] ?? 'm').toLowerCase()
    if (unit === 'd') return { kind: 'day' }
    if (unit === 'w') return { kind: 'week' }
    return { kind: 'min', minutes: unit === 'h' ? n * 60 : n }
  }
  return { kind: 'min', minutes: 5 }
}

/** The bucket the route is asked for. 5m whenever the timeframe is a multiple of it. */
function nativeOf(tf: Tf): 1 | 5 {
  return tf.kind === 'min' && tf.minutes % 5 !== 0 ? 1 : 5
}

/**
 * The session date a bar belongs to. Futures roll at 18:00 ET: the evening
 * belongs to the NEXT day's session, as on every futures chart. Cash symbols
 * use the plain ET date (their 16:00–20:00 post-market belongs to today).
 */
function sessionDate(t: number, fut: boolean): string {
  const key = etDateKey(t)
  return fut && etMinutesOfDay(t) >= FUT_OPEN_MIN ? nextDateKey(key) : key
}

/** Bucket open time for `t` under `tf`. Minute buckets are anchored to 09:30 ET. */
function bucketFor(tf: Tf, fut: boolean): (t: number) => number {
  if (tf.kind === 'min') {
    const size = tf.minutes
    return (t) => {
      const m = etMinutesOfDay(t)
      const off = m - RTH_OPEN_MIN
      let back = ((off % size) + size) % size
      // Never let a bucket reach back across ET midnight — rollup() keys on the
      // date for the same reason.
      if (back > m) back = m
      return Math.floor(t / MIN_MS) * MIN_MS - back * MIN_MS
    }
  }
  if (tf.kind === 'day') {
    return (t) => {
      const [y, m, d] = ymd(sessionDate(t, fut))
      return etWall(y, m, d, 0)
    }
  }
  if (tf.kind === 'month') {
    return (t) => {
      const [y, m] = ymd(sessionDate(t, fut))
      return etWall(y, m, 1, 0)
    }
  }
  return (t) => {
    const key = sessionDate(t, fut)
    const [y, m, d] = ymd(key)
    // Monday of that week, at ET midnight.
    const back = (weekday(key) + 6) % 7
    const monday = new Date(Date.UTC(y, m - 1, d) - back * DAY_MS)
    return etWall(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), 0)
  }
}

/** Roll native bars up into `bucket`. Input oldest-first; output oldest-first. */
function aggregate(bars: Bar[], bucket: (t: number) => number): OHLCV[] {
  const out: OHLCV[] = []
  let cur: OHLCV | null = null
  for (const b of bars) {
    const t = bucket(b.t)
    if (!cur || t !== cur.time) {
      if (cur) out.push(cur)
      cur = { time: t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }
      continue
    }
    cur.high = Math.max(cur.high, b.h)
    cur.low = Math.min(cur.low, b.l)
    cur.close = b.c
    cur.volume = (cur.volume ?? 0) + b.v
  }
  if (cur) out.push(cur)
  // A bucket keyed on a DST edge can come out of order; the port wants sorted
  // and de-duplicated by open-time.
  out.sort((a, b) => a.time - b.time)
  return out.filter((b, i) => i === 0 || b.time !== out[i - 1]?.time)
}

// ── History ──────────────────────────────────────────────────────────────────

function historyUrl(sym: ResolvedSym, native: 1 | 5): string {
  const days = native === 1 ? DAYS_1M : DAYS_5M
  if (sym.fut) return esCandlesUrl(native, days, sym.fut)
  return `${candlesUrl(symbolDef(sym.key), native, days)}&limit=${ETF_ROW_LIMIT}`
}

/**
 * The URL the page's default chart (SPX, 5m) asks for first — exported so the
 * route can warm it at module scope and the rail can prefetch it on hover.
 * Shell.tsx carries the same string as a literal; keep the two in step.
 */
export const DEFAULT_HISTORY_URL = historyUrl({ key: 'SPX', kind: 'index' }, 5)

async function nativeBars(sym: ResolvedSym, native: 1 | 5, staleMs = HISTORY_STALE_MS): Promise<Bar[]> {
  const json = await query<unknown>(historyUrl(sym, native), { staleMs })
  return sym.fut ? parseEsCandles(json) : parseCandles(json)
}

// ── The feed's own last price, per ticker ────────────────────────────────────
// The chart's price is THIS feed: the newest bar of the tape it loaded, then the
// live stream (SSE for cash names, the socket's 1m frames for ES / NQ). The
// ticker chip, the picker's rows and the watchlist used to show a separate
// 15 s quote poll (/api/quotes-batch, Yahoo underneath, and CME-DELAYED about
// ten minutes for ES=F / NQ=F), so the chip read 7,821.75 with the candles at
// 7,827.00 (Brandon, 2026-10-08). Every bar a chart loads or streams notes its
// close here, BEFORE any session filter, so an RTH chart still knows the
// overnight price the way the quote did. watchlist/store.ts quoteOf() puts it
// over the quote only for a ticker a chart is SHOWING: one with a live
// subscription, or a history load in the last FEED_FRESH_MS (the moment before
// the chart subscribes). A ticker the chart left, or one only read for stats
// (watchlist, level alerts, the session strip), falls back to the quote rather
// than freezing at an old price.
const feedLast = new Map<string, { t: number; c: number; at: number }>()
/** Live subscriptions per ticker: a price is only the chart's while a chart is on it. */
const feedSubsByKey = new Map<string, number>()
const FEED_FRESH_MS = 10_000
const feedSubs = new Set<() => void>()
let feedTimer: ReturnType<typeof setTimeout> | null = null
/** Live ticks come about once a second per chart: listeners hear at most this often. */
const FEED_NOTIFY_MS = 250

function noteFeed(key: string, t: number, c: number, live: boolean): void {
  if (!(c > 0) || !Number.isFinite(t)) return
  const cur = feedLast.get(key)
  // History is fetched through a 20 s cache: it never replaces a live price for the same minute.
  if (cur && (t < cur.t || (t === cur.t && !live))) return
  if (cur && cur.t === t && cur.c === c) {
    cur.at = Date.now()
    return
  }
  feedLast.set(key, { t, c, at: Date.now() })
  if (!feedTimer && feedSubs.size) {
    feedTimer = setTimeout(() => {
      feedTimer = null
      for (const fn of feedSubs) fn()
    }, FEED_NOTIFY_MS)
  }
}

/** The last price this page's chart feed has for `ticker` (the chart's own number), or null if no chart has loaded it. */
export function feedPrice(ticker: string): number | null {
  const key = resolveSym(ticker).key
  const f = feedLast.get(key)
  if (!f) return null
  return (feedSubsByKey.get(key) ?? 0) > 0 || Date.now() - f.at < FEED_FRESH_MS ? f.c : null
}

/** Told (at most every FEED_NOTIFY_MS) when a feed price moves. */
export function onFeedPrice(fn: () => void): () => void {
  feedSubs.add(fn)
  return () => feedSubs.delete(fn)
}

function sessionFilter(bars: Bar[], session: string | undefined): Bar[] {
  if (session === 'extended') return bars
  return bars.filter((b) => isRth(b.t))
}

/**
 * The tape's own bars for `ticker`, un-rolled: 1m (~5 days) or 5m (~30 days),
 * session-filtered like the chart. For studies that read INSIDE a chart bar
 * (Cumulative Volume Delta's intrabars). The same request the chart makes for
 * that native timeframe, through `query`, so a chart already on it shares it.
 */
export async function nativeTape(ticker: string, native: 1 | 5, session: string | undefined, staleMs?: number): Promise<OHLCV[]> {
  const raw = sessionFilter(await nativeBars(resolveSym(ticker), native, staleMs), session)
  return raw.map((b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }))
}

/** What a live feed needs to continue the newest history bar without double counting. */
interface Seed {
  bar: OHLCV
  /** Open time of the newest NATIVE bar inside `bar`. */
  lastNativeT: number
}

const seeds = new Map<string, Seed>()
const seedKey = (key: string, timeframe: string, session: string | undefined) =>
  `${key}|${timeframe}|${session === 'extended' ? 'eth' : 'rth'}`

async function loadAggregated(
  sym: ResolvedSym,
  timeframe: string,
  session: string | undefined,
  staleMs?: number,
): Promise<OHLCV[]> {
  const tf = parseTf(timeframe)
  const native = nativeOf(tf)
  const tape = await nativeBars(sym, native, staleMs)
  // the chart's own price, before the session filter (see feedPrice)
  const newest = tape[tape.length - 1]
  if (newest) noteFeed(sym.key, newest.t, newest.c, false)
  const raw = sessionFilter(tape, session)
  const bucket = bucketFor(tf, !!sym.fut)
  let out = aggregate(raw, bucket)
  // The window's first bucket is usually cut: "the last 30 days" starts
  // wherever the route's cutoff lands, not at a session open, so the oldest
  // daily bar would be a stub of an evening. Drop it rather than draw a bar
  // that never traded like that. Minute buckets only when visibly partial.
  const first = raw[0]
  if (out.length > 1 && first && (tf.kind !== 'min' || bucket(first.t) !== first.t)) out.shift()
  // D / W / M: years of older bars in front of the tape's
  if (tf.kind !== 'min') out = withLongHistory(out, await longHistory(sym, tf.kind), bucket)
  const last = out[out.length - 1]
  const lastNative = raw[raw.length - 1]
  if (last && lastNative) {
    seeds.set(seedKey(sym.key, timeframe, session), { bar: { ...last }, lastNativeT: lastNative.t })
  }
  return out
}

// ── Long history (D / W / M) ─────────────────────────────────────────────────
// The tape is ~30 sessions deep — a weekly chart of it is six bars. Coarse
// timeframes take their older bars from whichever long source answers first;
// the tape's own buckets still win wherever it has them (it is the recorder's,
// RTH-exact, and the forming bar is live).

const LONG_STALE_MS = 15 * 60_000
/**
 * How long one long-history source may take before D / W / M stop waiting for it
 * and draw the tape's own bars (2026-10-07 audit: the 1D spinner hung). A late
 * answer still lands in query()'s cache, so the next load of that chart has it.
 */
const LONG_SOURCE_TIMEOUT_MS = 8_000
/** A coarse load that has drawn nothing by now is failed, not left spinning (loadWatchdog.ts says so). */
export const COARSE_LOAD_TIMEOUT_MS = 20_000

/** `p`, or `fallback` once `ms` has passed — whichever comes first. */
function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      () => {
        clearTimeout(t)
        resolve(fallback)
      },
    )
  })
}

/** Thrown when a coarse timeframe's load runs past COARSE_LOAD_TIMEOUT_MS. */
export class LoadTimeoutError extends Error {
  constructor(what: string) {
    super(`${what} timed out`)
    this.name = 'LoadTimeoutError'
  }
}
type Coarse = 'day' | 'week' | 'month'
const YF_INTERVAL: Record<Coarse, string> = { day: '1d', week: '1wk', month: '1mo' }
const LSE_TF: Record<Coarse, string> = { day: '1d', week: '1w', month: '1mo' }

/** Is the signed-in user the owner? One read of /api/auth/me per few minutes, shared. */
export async function isOwner(): Promise<boolean> {
  try {
    const me = await query<{ user?: { isOwner?: boolean } | null }>('/api/auth/me', { staleMs: 5 * 60_000 })
    return me?.user?.isOwner === true
  } catch {
    return false
  }
}

/** A clean bar, or null — a missing (0) open / high / low falls back to the close, never to 0. */
const toBar = (t: number, o: number, h: number, l: number, c: number, v: number): Bar | null => {
  if (![t, o, h, l, c].every(Number.isFinite) || !(c > 0) || !(t > 0)) return null
  const open = o > 0 ? o : c
  return { t, o: open, h: Math.max(h > 0 ? h : c, open, c), l: Math.min(l > 0 ? l : c, open, c), c, v: Number.isFinite(v) ? v : 0 }
}

function parseVelaHistory(json: unknown): Bar[] {
  const rows = (json as { bars?: unknown } | null)?.bars
  if (!Array.isArray(rows)) return []
  const out: Bar[] = []
  for (const r of rows as Record<string, unknown>[]) {
    const b = toBar(n(r.t), n(r.o), n(r.h), n(r.l), n(r.c), n(r.v))
    if (b) out.push(b)
  }
  return out.sort((a, b) => a.t - b.t)
}

/** /api/lse/candles rows: { timestamp: ISO, open, high, low, close, volume }. */
function parseLse(json: unknown): Bar[] {
  const rows = (json as { rows?: unknown } | null)?.rows
  if (!Array.isArray(rows)) return []
  const out: Bar[] = []
  for (const r of rows as Record<string, unknown>[]) {
    const t = typeof r.timestamp === 'number' ? r.timestamp : Date.parse(String(r.timestamp ?? r.ts ?? ''))
    const b = toBar(t, n(r.open), n(r.high), n(r.low), n(r.close), n(r.volume))
    if (b) out.push(b)
  }
  return out.sort((a, b) => a.t - b.t)
}

/** /api/dxlink/candles: { data: { items: [{ time, open, high, low, close, volume }] } } — weekly. */
function parseDxHistory(json: unknown): Bar[] {
  const items = (json as { data?: { items?: unknown } } | null)?.data?.items
  if (!Array.isArray(items)) return []
  const out: Bar[] = []
  for (const r of items as Record<string, unknown>[]) {
    const b = toBar(n(r.time), n(r.open), n(r.high), n(r.low), n(r.close), n(r.volume))
    if (b) out.push(b)
  }
  return out.sort((a, b) => a.t - b.t)
}

/**
 * The vault's symbol for this ticker, or null when the vault has no EXACT match.
 * The resolver is exact-only (server-v2 /api/lse/resolve): its old name search
 * turned SPX into SPXC and VIX into ENVX, and those stocks' years were spliced
 * under the index bars. A miss is "no vault history", never "use the key anyway".
 * Cached for the page.
 */
const lseNames = new Map<string, Promise<string | null>>()
function lseSymbol(key: string): Promise<string | null> {
  let p = lseNames.get(key)
  if (!p) {
    p = query<{ symbol?: unknown }>(`/api/lse/resolve?q=${encodeURIComponent(key)}`, { staleMs: 24 * 3_600_000 })
      .then((j) => (typeof j?.symbol === 'string' && j.symbol.toUpperCase() === key.toUpperCase() ? j.symbol : null))
      .catch(() => null)
    lseNames.set(key, p)
  }
  return p
}

const ymdUtc = (t: number) => new Date(t).toISOString().slice(0, 10)

async function lseBars(sym: ResolvedSym, timeframe: string, start: number, end: number | null, limit = 5000): Promise<Bar[]> {
  // An index never goes to the vault: there is no exact index symbol there, and
  // any non-exact answer is some other company (see lseSymbol).
  if (!sym.fut && sym.kind === 'index') return []
  const name = sym.fut ?? (await lseSymbol(sym.key))
  if (!name) return []
  const ds = sym.fut ? '&dataset=futures' : ''
  const endQ = end != null ? `&end=${ymdUtc(end + DAY_MS)}` : ''
  const url = `/api/lse/candles?symbol=${encodeURIComponent(name)}&timeframe=${timeframe}&start=${ymdUtc(start)}${endQ}&limit=${limit}&order=desc${ds}`
  return parseLse(await query<unknown>(url, { staleMs: LONG_STALE_MS }))
}

/**
 * Older coarse bars for `sym`, oldest first, or [] when no source answers. Each
 * source is tried once per page load per symbol (query() caches the miss as a
 * thrown error only for its stale window, so a route that is not deployed costs
 * one 404, not one per chart).
 */
const longMiss = new Set<string>()
async function longHistory(sym: ResolvedSym, kind: Coarse): Promise<Bar[]> {
  const key = sym.fut ?? sym.key
  const tryOnce = async (id: string, get: () => Promise<Bar[]>): Promise<Bar[]> => {
    if (longMiss.has(id)) return []
    const run = (async () => {
      try {
        const bars = await get()
        if (!bars.length) longMiss.add(id)
        return bars
      } catch {
        longMiss.add(id)
        return [] as Bar[]
      }
    })()
    // a source that does not answer in time is skipped THIS load (not marked a miss:
    // its late answer is cached by query() for the next one)
    return (await within(run, LONG_SOURCE_TIMEOUT_MS, null as Bar[] | null)) ?? []
  }
  const yf = await tryOnce(`yf|${key}|${kind}`, async () =>
    parseVelaHistory(await query<unknown>(`/api/vela/history?symbol=${encodeURIComponent(key)}&interval=${YF_INTERVAL[kind]}`, { staleMs: LONG_STALE_MS })),
  )
  if (yf.length) return yf
  // Indexes: /api/vela/history is the only long source (explicitly mapped
  // server-side). Without it, D / W fall back to bars built from the tape.
  if (sym.kind === 'index' && kind === 'day') return []
  if (sym.kind !== 'index' && (await isOwner())) {
    const years = kind === 'day' ? 10 : 25
    const lse = await tryOnce(`lse|${key}|${kind}`, () => lseBars(sym, LSE_TF[kind], Date.now() - years * 365 * DAY_MS, null))
    if (lse.length) return lse
  }
  if (kind === 'day') return []
  // weekly bars, ~13 months — a month bar is its weeks rolled up by bucket
  const dxSym = sym.fut ? `/${sym.fut}` : sym.kind === 'index' ? `$${sym.key}` : sym.key
  return tryOnce(`dx|${key}`, async () => parseDxHistory(await query<unknown>(`/api/dxlink/candles?symbol=${encodeURIComponent(dxSym)}`, { staleMs: LONG_STALE_MS })))
}

/**
 * Does the long source price the same instrument as the tape? Compared on a
 * bucket both hold (closes within 25%), else the newest older bar against the
 * tape's first open (within 2x). A wrong-ticker splice — SPX Technologies at
 * ~$170 under SPX at ~6,700, Enovix at ~$2.56 under VIX — fails by orders of
 * magnitude, so the history is dropped instead of drawn. A legitimate source
 * agrees with the recorder to a fraction of a percent.
 */
function sameInstrument(recent: OHLCV[], long: OHLCV[]): boolean {
  const first = recent[0]
  if (!first) return true
  const byTime = new Map(long.map((b) => [b.time, b]))
  for (const r of recent.slice(0, 5)) {
    const l = byTime.get(r.time)
    if (l && r.close > 0 && l.close > 0) return Math.abs(l.close / r.close - 1) <= 0.25
  }
  const prev = [...long].reverse().find((b) => b.time < first.time)
  if (!prev || !(prev.close > 0) || !(first.open > 0)) return true
  const ratio = prev.close / first.open
  return ratio >= 0.5 && ratio <= 2
}

/** The tape's buckets, with the long source's older buckets in front of them. */
function withLongHistory(recent: OHLCV[], long: Bar[], bucket: (t: number) => number): OHLCV[] {
  if (!long.length) return recent
  const rolled = aggregate(long, bucket)
  if (!sameInstrument(recent, rolled)) {
    console.warn('[vela] long history does not match the tape (wrong instrument?) — showing the tape only')
    return recent
  }
  const cut = recent[0]?.time ?? Infinity
  const older = rolled.filter((b) => b.time < cut)
  return older.length ? [...older, ...recent] : recent
}

// ── Deep futures history (owner) ─────────────────────────────────────────────
// Vela asks for a DEPTH (`limit` — 500 bars by default, thousands when a range
// chip like 3M / 1Y / ALL is picked) and reads a shorter answer as "history
// ends here". The tape holds ~30 days, so for the owner an ES / NQ request the
// tape cannot fill is topped up from the LSE vault (/api/lse/candles, owner-only
// at the server too): the older bars, in front of the tape's. One vault page —
// 5,000 rows — per request; an explicit backward page (`to` before the tape)
// is answered from the vault the same way.

/**
 * The vault timeframe a chart timeframe is built from: the largest that divides it AND
 * 30 — the vault's hour bars open on the hour, the chart's hours open at 09:30, so an
 * hourly chart is built from 30-minute bars.
 */
function lseIntraday(minutes: number): { tf: string; native: number } {
  for (const [tf, m] of [['30m', 30], ['15m', 15], ['5m', 5], ['3m', 3], ['1m', 1]] as const) {
    if (minutes % m === 0 && 30 % m === 0) return { tf, native: m }
  }
  return { tf: '1m', native: 1 }
}

/** Up to `need` chart bars of `sym` older than `before`, from the vault (owner only). */
async function deepFutures(sym: ResolvedSym, tf: Tf, before: number, need: number, session: string | undefined): Promise<OHLCV[]> {
  if (tf.kind !== 'min' || !sym.fut || need <= 0) return []
  if (!(await isOwner())) return []
  const { tf: lseTf, native } = lseIntraday(tf.minutes)
  // regular hours keep ~6.5 of the futures' ~23 hours: ask for that much more
  const rth = session !== 'extended'
  const rows = Math.min(5000, Math.ceil(need * (tf.minutes / native) * (rth ? 3.6 : 1.05)) + 10)
  const start = before - Math.max(3 * DAY_MS, rows * native * MIN_MS * (rth ? 1.2 : 1.6))
  let bars = await lseBars(sym, lseTf, start, before, rows)
  bars = sessionFilter(bars, session).filter((b) => b.t < before)
  const out = aggregate(bars, bucketFor(tf, true))
  return out.length > need ? out.slice(out.length - need) : out
}

// ── Live ─────────────────────────────────────────────────────────────────────

interface MinuteBar {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(x) ? x : 0
}

/**
 * A live row → a minute bar, or null. Same rule as sanitize() in candles.ts: a
 * bar still being assembled can carry a 0 in its open or low, and one candle to
 * zero autoscales the whole pane to nothing.
 */
function toMinute(row: unknown): MinuteBar | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const t = n(r.timestamp ?? r.time)
  const c = n(r.close)
  if (!(t > 0) || !(c > 0)) return null
  const o = n(r.open) > 0 ? n(r.open) : c
  const h = Math.max(n(r.high) > 0 ? n(r.high) : c, o, c)
  const l = Math.min(n(r.low) > 0 ? n(r.low) : c, o, c)
  if (h - l > c * 0.25) return null
  return { t, o, h, l, c, v: Math.max(0, n(r.volume)) }
}

/**
 * Folds live 1m bars into the forming bar of ANY timeframe. The first bucket may
 * continue a history bar (the seed): its open, and the volume it already
 * counted, carry over, and a live minute inside the seed's newest native bar
 * adds price but not volume — that native bar's volume is already in the seed.
 */
class LiveBucket {
  private cur: OHLCV | null = null
  private base: Seed | null
  private readonly minutes = new Map<number, MinuteBar>()

  constructor(
    private readonly bucket: (t: number) => number,
    private readonly nativeMs: number,
    seed: Seed | null,
  ) {
    this.base = seed
    if (seed) this.cur = { ...seed.bar }
  }

  get time(): number {
    return this.cur?.time ?? 0
  }

  apply(m: MinuteBar): OHLCV | null {
    const b = this.bucket(m.t)
    if (this.cur && b < this.cur.time) return null
    if (!this.cur || b > this.cur.time) {
      if (this.base && this.base.bar.time !== b) this.base = null
      this.minutes.clear()
      this.cur = { time: b, open: m.o, high: m.h, low: m.l, close: m.c, volume: 0 }
    }
    this.minutes.set(m.t, m)

    const base = this.base
    const coveredTo = base ? base.lastNativeT + this.nativeMs : -Infinity
    let high = base ? base.bar.high : -Infinity
    let low = base ? base.bar.low : Infinity
    let volume = base ? (base.bar.volume ?? 0) : 0
    let firstT = Infinity
    let lastT = -Infinity
    for (const x of this.minutes.values()) {
      if (x.h > high) high = x.h
      if (x.l < low) low = x.l
      if (x.t >= coveredTo) volume += x.v
      if (x.t < firstT) firstT = x.t
      if (x.t > lastT) lastT = x.t
    }
    const first = this.minutes.get(firstT)
    const last = this.minutes.get(lastT)
    const open = base ? base.bar.open : (first?.o ?? this.cur.open)
    const close = base && lastT < base.lastNativeT ? base.bar.close : (last?.c ?? this.cur.close)
    this.cur = { time: b, open, high, low, close, volume }
    return { ...this.cur }
  }

  /** Restart from a fresh history bar (after a catch-up re-read). */
  reseed(seed: Seed | null): void {
    this.base = seed
    this.minutes.clear()
    this.cur = seed ? { ...seed.bar } : null
  }
}

/** Every bar in a socket candle frame, oldest first. Delta frames carry only what changed. */
function frameBars(data: unknown): MinuteBar[] {
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { candles?: unknown } | undefined)?.candles)
      ? (data as { candles: unknown[] }).candles
      : []
  const out: MinuteBar[] = []
  for (const row of list) {
    const m = toMinute(row)
    if (m) out.push(m)
  }
  return out.sort((a, b) => a.t - b.t)
}

/** The rows for `key` in a /live or /live/stream payload, oldest first. */
function liveRows(json: unknown, key: string): MinuteBar[] {
  const rows = (json as { rows?: Record<string, unknown> } | null)?.rows
  const list = rows && typeof rows === 'object' ? rows[key] : null
  if (!Array.isArray(list)) return []
  const out: MinuteBar[] = []
  for (const row of list) {
    const m = toMinute(row)
    if (m) out.push(m)
  }
  return out.sort((a, b) => a.t - b.t)
}

// ── Calendar ─────────────────────────────────────────────────────────────────

function calendar(kind: SymKind, from: number, to: number, session: string | undefined): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = []
  const extended = session === 'extended'
  // Start a day early so a futures window opening the evening before is caught.
  let key = etDateKey(from - DAY_MS)
  const stop = etDateKey(to + DAY_MS)
  for (let guard = 0; guard < 400 && key <= stop; guard++, key = nextDateKey(key)) {
    const wd = weekday(key)
    if (wd === 0 || wd === 6) continue
    const [y, m, d] = ymd(key)
    let start: number
    let end: number
    if (!extended || kind === 'index') {
      start = etWall(y, m, d, RTH_OPEN_MIN)
      end = etWall(y, m, d, RTH_CLOSE_MIN)
    } else if (kind === 'futures') {
      // The session for `key` opens 18:00 ET the evening before, closes 17:00.
      start = etWall(y, m, d, FUT_OPEN_MIN) - DAY_MS
      end = etWall(y, m, d, 17 * 60)
    } else {
      // The overnight session (20:00 the evening before), pre-market, RTH and after
      // hours to 20:00: the cash names' tape, one window per weekday (see Sessions).
      const prev = new Date(Date.UTC(y, m - 1, d) - DAY_MS)
      start = etWall(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate(), CASH_NIGHT_MIN)
      end = etWall(y, m, d, CASH_NIGHT_MIN)
    }
    if (end > from && start < to) out.push([Math.max(start, from), Math.min(end, to)] as const)
  }
  return out
}

/** The same session windows for the top bar's session clock (sessionClockView.ts), so
 *  its "closes in" and the chart's shading come from one calendar. */
export const sessionWindows = calendar

// ── The provider ─────────────────────────────────────────────────────────────

const TIMEFRAMES = ['1', '2', '3', '5', '10', '15', '30', '60', '120', '240', 'D', 'W', 'M'] as const

export class CbEdgeProvider implements DataProvider {
  info(): ProviderInfo {
    return {
      name: PROVIDER_NAME,
      displayName: 'Voltick.io',
      supportedTimeframes: TIMEFRAMES,
      capabilities: { enumerate: true, stream: true, symbolInfo: true },
    }
  }

  async listSymbols(): Promise<SymbolDescriptor[]> {
    const seen = new Set<string>()
    const out: SymbolDescriptor[] = []
    const names = await symbolNames()
    const add = (key: string) => {
      if (seen.has(key) || !TICKER_RE.test(key)) return
      seen.add(key)
      out.push(descriptor(key, names))
    }
    for (const s of SYMBOLS) add(s.key)
    add('ES')
    add('NQ')
    // The server roster (the scanner universe). One fetch per page load, shared
    // with every picker in the app; a failure is an empty list, never a retry.
    for (const k of await loadRoster()) add(k)
    return out
  }

  async getSymbolInfo(ticker: string): Promise<SymbolInfo | undefined> {
    const sym = resolveSym(ticker)
    const fut = sym.kind === 'futures'
    const names = await symbolNames()
    return {
      ticker: sym.key,
      description: names[sym.key] ?? DESCRIPTIONS[sym.key] ?? sym.key,
      type: sym.kind,
      timezone: 'America/New_York',
      session: '0930-1600',
      // Futures trade evening-to-evening; cash names round the clock Sunday 20:00 to
      // Friday 20:00 (overnight, pre-market, RTH, after hours): both OVERNIGHT
      // windows, so everything outside RTH is shaded (see Sessions). An index has
      // no extended tape, so it declares none and Vela shades nothing outside RTH.
      ...(fut ? { session_extended: '1800-1700' } : sym.kind === 'index' ? {} : { session_extended: '2000-2000' }),
      minmov: fut ? 25 : 1,
      pricescale: 100,
      currency: 'USD',
    }
  }

  resolveSymbolIcon(s: SymbolDescriptor): string | undefined {
    if (s.type !== 'stock' && s.type !== 'etf') return undefined
    // The same-origin mirror only (stage 1 of ChipLogo's ladder): a same-origin
    // image cannot taint the chart canvas, so the PNG export keeps working. A
    // miss is a 404 and Vela falls back to the initials badge.
    return tickerLogoUrls(s.ticker)[0]
  }

  async getCalendar(
    ticker: string,
    range: { from: number; to: number; session?: string },
  ): Promise<ReadonlyArray<readonly [number, number]>> {
    return calendar(resolveSym(ticker).kind, range.from, range.to, range.session)
  }

  async getBars(ticker: string, timeframe: string, range: BarRange): Promise<OHLCV[]> {
    const sym = resolveSym(ticker)
    const coarse = parseTf(timeframe).kind !== 'min'
    // D / W / M: never an endless spinner. Past the limit the load fails, and
    // loadWatchdog.ts puts the reason on screen.
    let bars = coarse
      ? await within(
          loadAggregated(sym, timeframe, range.session).then((b) => b as OHLCV[] | null),
          COARSE_LOAD_TIMEOUT_MS,
          null,
        ).then((b) => {
          if (b === null) throw new LoadTimeoutError(`${sym.key} ${timeframe} bars`)
          return b
        })
      : await loadAggregated(sym, timeframe, range.session)
    // The owner's futures go on into the vault where the tape runs out: a backward
    // page older than the tape, or a depth (`limit`) the tape cannot fill
    const oldest = bars[0]?.time
    const tf = parseTf(timeframe)
    if (sym.fut && tf.kind === 'min' && oldest != null) {
      const older = range.to != null && range.to < oldest
      const inWindow = older ? 0 : bars.filter((b) => (range.to == null || b.time <= range.to) && (range.from == null || b.time >= range.from)).length
      const short = !older && range.limit != null && inWindow < range.limit && (range.from == null || range.from < oldest)
      if (older || short) {
        try {
          const before = older ? range.to! + 1 : oldest
          const need = older ? (range.limit ?? 2000) : range.limit! - inWindow
          const deep = await deepFutures(sym, tf, before, need, range.session)
          if (deep.length) bars = older ? deep : [...deep, ...bars]
        } catch {
          /* the vault down: the history simply ends where the tape does */
        }
      }
    }
    const { from, to, limit } = range
    if (to != null) bars = bars.filter((b) => b.time <= to)
    if (from != null) bars = bars.filter((b) => b.time >= from)
    if (limit != null && limit > 0 && bars.length > limit) bars = bars.slice(bars.length - limit)
    return bars
  }

  subscribe(
    ticker: string,
    timeframe: string,
    onBar: (bar: OHLCV) => void,
    opts?: { session?: string },
  ): () => void {
    const sym = resolveSym(ticker)
    const session = opts?.session
    const tf = parseTf(timeframe)
    const bucket = bucketFor(tf, !!sym.fut)
    const nativeMs = nativeOf(tf) * MIN_MS
    const live = new LiveBucket(bucket, nativeMs, seeds.get(seedKey(sym.key, timeframe, session)) ?? null)
    let stopped = false
    feedSubsByKey.set(sym.key, (feedSubsByKey.get(sym.key) ?? 0) + 1)
    const unfeed = () => feedSubsByKey.set(sym.key, Math.max(0, (feedSubsByKey.get(sym.key) ?? 1) - 1))

    const push = (m: MinuteBar) => {
      if (stopped) return
      // the chip's price (see feedPrice): before the session filter, and not off a replayed boot frame
      if (m.t >= Date.now() - STALE_LIVE_MS) noteFeed(sym.key, m.t, m.c, true)
      if (session !== 'extended' && !isRth(m.t)) return
      // With no history bar to continue, a minute from a replayed last-known
      // frame (the store restores those from IndexedDB at boot) could be days
      // old. Starting the forming bar there would paint it behind the chart.
      if (!live.time && m.t < Date.now() - STALE_LIVE_MS) return
      const bar = live.apply(m)
      if (bar) onBar(bar)
    }

    // After a long hidden spell the stream has missed bars that Vela will never
    // ask for again. Re-read history and replay everything from the forming bar
    // on, oldest first: equal open-times update, larger ones append.
    const catchUp = async () => {
      try {
        const bars = await loadAggregated(sym, timeframe, session, 0)
        if (stopped) return
        const from = live.time
        for (const b of bars) if (b.time >= from) onBar(b)
        live.reseed(seeds.get(seedKey(sym.key, timeframe, session)) ?? null)
      } catch {
        /* the next live frame still moves the chart; the gap stays until a reload */
      }
    }

    // ── Futures: the socket's 1m frame, through the sanctioned hook ─────────
    if (sym.fut) {
      const frame = sym.fut === 'NQ' ? 'nq1mCandles' : 'es1mCandles'
      // The store holds `{ type, ts, data }` with the candle array as `data`
      // (data/socket.ts), exactly what GexCandlesCard reads off the same type.
      const unsub = watchFrame<{ data?: unknown }>(frame, (f) => {
        for (const m of frameBars(f?.data)) push(m)
      })
      // After a sleep or a network change the socket reconnects (data/socket.ts)
      // but the minutes in between never arrive as frames. Re-read them.
      const unwake = watchWake(() => void catchUp())
      return () => {
        stopped = true
        unfeed()
        unsub()
        unwake()
      }
    }

    // ── Cash symbols: SSE, with the probe underneath ─────────────────────────
    // Same two-transport shape as GexCandlesCard: the stream is the real path,
    // and the 3s probe only fires after LIVE_QUIET_MS of silence. Nothing has to
    // detect whether SSE works — if frames arrive the poll never runs.
    const def = symbolDef(sym.key)
    const pollUrl = liveCandleUrl(def)
    let es: EventSource | null = null
    let pollId: ReturnType<typeof setInterval> | null = null
    let lastStreamAt = 0
    let hiddenAt = 0

    const poll = async () => {
      if (stopped || Date.now() - lastStreamAt < LIVE_QUIET_MS) return
      try {
        const res = await fetch(pollUrl, { cache: 'no-store', credentials: 'same-origin' })
        if (!res.ok || stopped) return
        for (const m of liveRows(await res.json(), def.key)) push(m)
      } catch {
        /* a dropped probe is not an error — the next one is seconds away */
      }
    }

    // A browser closes an EventSource FOR GOOD when a reconnect gets a non-200
    // answer — the 502 while the dashboard restarts on a deploy, or a 401.
    // Before 2026-10-09 nothing reopened it, so after any restart every cash
    // chart sat on the poll (which was itself 501ing) until the tab was hidden
    // and shown again. Now a CLOSED stream is reopened with backoff, and the
    // minutes it missed are healed with catchUp() once it is back.
    let reopenId: ReturnType<typeof setTimeout> | null = null
    let reopenDelay = REOPEN_MIN_MS
    let reopened = false

    const openStream = () => {
      if (stopped || es || document.hidden) return
      const stream = new EventSource(liveStreamUrl(def))
      es = stream
      // onopen = the server answered 200: the restart is over. A quiet symbol
      // (an index overnight) may not send a data frame for minutes, so the
      // heal runs here rather than on the first message.
      stream.onopen = () => {
        reopenDelay = REOPEN_MIN_MS
        if (reopened) {
          reopened = false
          void catchUp()
        }
      }
      stream.onmessage = (ev) => {
        try {
          lastStreamAt = Date.now()
          for (const m of liveRows(JSON.parse(ev.data as string), def.key)) push(m)
        } catch {
          /* a malformed frame is not a reason to tear down a working stream */
        }
      }
      // While readyState is CONNECTING the browser is retrying by itself (the
      // route sends `retry: 3000`) and the poll covers the gap. Only CLOSED —
      // the browser has given up — needs us.
      stream.onerror = () => {
        if (stopped || es !== stream || stream.readyState !== EventSource.CLOSED) return
        es = null
        if (reopenId) clearTimeout(reopenId)
        reopenId = setTimeout(() => {
          reopenId = null
          reopened = true
          openStream()
        }, reopenDelay)
        reopenDelay = Math.min(reopenDelay * 2, REOPEN_MAX_MS)
      }
    }

    const start = () => {
      if (stopped) return
      openStream()
      if (pollId) return
      void poll()
      pollId = setInterval(() => void poll(), LIVE_FALLBACK_MS)
    }

    const halt = () => {
      es?.close()
      es = null
      if (reopenId) {
        clearTimeout(reopenId)
        reopenId = null
      }
      if (pollId) {
        clearInterval(pollId)
        pollId = null
      }
    }

    // A hidden tab drops the stream, which is also what lets the server release
    // the symbol — a stream's hold does not expire on its own.
    const onVis = () => {
      if (document.hidden) {
        if (!hiddenAt) hiddenAt = Date.now()
        halt()
        return
      }
      const away = hiddenAt ? Date.now() - hiddenAt : 0
      hiddenAt = 0
      start()
      if (away > CATCH_UP_AFTER_MS) void catchUp()
    }

    // Sleep / network change (watchWake in data/hooks.ts): the stream may be
    // half-open and the minutes in between are gone. Reopen and re-read.
    const onWake = () => {
      if (stopped || document.hidden) return
      halt()
      start()
      void catchUp()
    }

    onVis()
    document.addEventListener('visibilitychange', onVis)
    const unwake = watchWake(onWake)
    return () => {
      stopped = true
      unfeed()
      halt()
      document.removeEventListener('visibilitychange', onVis)
      unwake()
    }
  }
}
