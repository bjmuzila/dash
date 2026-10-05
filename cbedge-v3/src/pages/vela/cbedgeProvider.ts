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
// The calendar (`getCalendar`) is WEEKDAYS ONLY. No route here knows the
// exchange holidays, so on a holiday the market badge will say open while no
// bars arrive. Honest about it here rather than pretending.
// ─────────────────────────────────────────────────────────────────────────────

import type { BarRange, DataProvider, OHLCV, ProviderInfo, SymbolDescriptor, SymbolInfo } from '@luxalgo/vela'
import { query } from '@/data/api'
import { watchFrame } from '@/data/hooks'
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

/** History windows, in calendar days, per native bucket. The ETF route clamps to 30. */
const DAYS_1M = 5
const DAYS_5M = 30
/** The ETF route defaults `limit` to 5000 rows — 30 days of 5m ETH is ~5,800. */
const ETF_ROW_LIMIT = 8000
/** How long one history pull is shared before a new request goes out. */
const HISTORY_STALE_MS = 20_000
/** Hidden longer than this, the live feed re-reads history on return to fill the gap. */
const CATCH_UP_AFTER_MS = 30_000
/** A live minute older than this cannot START a forming bar (see subscribe). */
const STALE_LIVE_MS = 30 * MIN_MS

/** Futures open at 18:00 ET for the next day's session. */
const FUT_OPEN_MIN = 18 * 60

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

function sessionFilter(bars: Bar[], session: string | undefined): Bar[] {
  if (session === 'extended') return bars
  return bars.filter((b) => isRth(b.t))
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
  const raw = sessionFilter(await nativeBars(sym, native, staleMs), session)
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

/** The symbol the LSE vault knows this ticker by (its own resolver), cached for the page. */
const lseNames = new Map<string, Promise<string>>()
function lseSymbol(key: string): Promise<string> {
  let p = lseNames.get(key)
  if (!p) {
    p = query<{ symbol?: unknown }>(`/api/lse/resolve?q=${encodeURIComponent(key)}`, { staleMs: 24 * 3_600_000 })
      .then((j) => (typeof j?.symbol === 'string' && j.symbol ? j.symbol : key))
      .catch(() => key)
    lseNames.set(key, p)
  }
  return p
}

const ymdUtc = (t: number) => new Date(t).toISOString().slice(0, 10)

async function lseBars(sym: ResolvedSym, timeframe: string, start: number, end: number | null, limit = 5000): Promise<Bar[]> {
  const name = sym.fut ?? (await lseSymbol(sym.key))
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
    try {
      const bars = await get()
      if (!bars.length) longMiss.add(id)
      return bars
    } catch {
      longMiss.add(id)
      return []
    }
  }
  const yf = await tryOnce(`yf|${key}|${kind}`, async () =>
    parseVelaHistory(await query<unknown>(`/api/vela/history?symbol=${encodeURIComponent(key)}&interval=${YF_INTERVAL[kind]}`, { staleMs: LONG_STALE_MS })),
  )
  if (yf.length) return yf
  if (await isOwner()) {
    const years = kind === 'day' ? 10 : 25
    const lse = await tryOnce(`lse|${key}|${kind}`, () => lseBars(sym, LSE_TF[kind], Date.now() - years * 365 * DAY_MS, null))
    if (lse.length) return lse
  }
  if (kind === 'day') return []
  // weekly bars, ~13 months — a month bar is its weeks rolled up by bucket
  const dxSym = sym.fut ? `/${sym.fut}` : sym.kind === 'index' ? `$${sym.key}` : sym.key
  return tryOnce(`dx|${key}`, async () => parseDxHistory(await query<unknown>(`/api/dxlink/candles?symbol=${encodeURIComponent(dxSym)}`, { staleMs: LONG_STALE_MS })))
}

/** The tape's buckets, with the long source's older buckets in front of them. */
function withLongHistory(recent: OHLCV[], long: Bar[], bucket: (t: number) => number): OHLCV[] {
  if (!long.length) return recent
  const cut = recent[0]?.time ?? Infinity
  const older = aggregate(long, bucket).filter((b) => b.time < cut)
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
      start = etWall(y, m, d, 4 * 60)
      end = etWall(y, m, d, 20 * 60)
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
      // Futures trade evening-to-evening; cash names 04:00–20:00. An index has no
      // extended tape, so it declares none and Vela shades nothing outside RTH.
      ...(fut ? { session_extended: '1800-1700' } : sym.kind === 'index' ? {} : { session_extended: '0400-2000' }),
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
    let bars = await loadAggregated(sym, timeframe, range.session)
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

    const push = (m: MinuteBar) => {
      if (stopped) return
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
      return () => {
        stopped = true
        unsub()
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

    const start = () => {
      if (stopped || es) return
      es = new EventSource(liveStreamUrl(def))
      es.onmessage = (ev) => {
        try {
          lastStreamAt = Date.now()
          for (const m of liveRows(JSON.parse(ev.data as string), def.key)) push(m)
        } catch {
          /* a malformed frame is not a reason to tear down a working stream */
        }
      }
      // No onerror that closes: EventSource reconnects by itself (the route
      // sends `retry: 3000`), and the poll covers the gap meanwhile.
      void poll()
      pollId = setInterval(() => void poll(), LIVE_FALLBACK_MS)
    }

    const halt = () => {
      es?.close()
      es = null
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

    onVis()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stopped = true
      halt()
      document.removeEventListener('visibilitychange', onVis)
    }
  }
}
