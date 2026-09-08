// ─────────────────────────────────────────────────────────────────────────────
// THE CHAIN BOOK — the wire shape of /api/chains, turned into calls-and-puts
// rows.
//
// This is NOT the GEX matrix's data layer. pages/optionsChain/useChainData.ts
// collapses a chain down to ONE number per strike per expiry (a greek) because
// that page is a heat grid. This page is the BOOK: every quote field the feed
// carries, per side, per strike — bid, ask, mark, volume, open interest, IV and
// the four greeks — because a trader reading an option chain is reading the
// quotes, not a derived exposure.
//
// The payload (server-v2/proxy-tastytrade.js → fetchChainFull) is:
//
//   { data: { underlyingPrice, rootSymbol, items: [
//       { "expiration-date": "2026-09-11", strikes: [
//           { "strike-price": "6500", call: {…}, put: {…} } ] } ] } }
//
// and each side carries exactly:
//   symbol · streamer-symbol · open-interest / openInterest · volume ·
//   delta · gamma · theta · vega · implied-volatility · bid · ask · mark
//
// There is NO `last` and no previous close on the wire, which is why this page
// has no Last and no Net Change column: an invented one would have to be `mark`
// under a different heading, and two columns showing the same number under
// different names is worse than one honest column.
//
// ── One request for the front of the board ───────────────────────────────────
// /api/chains WITHOUT an `expiration` returns the nearest THREE expirations in
// one payload (today's, if today is an expiry, plus the next two). The page
// fires that and the expiration list in parallel at entry, so the default view
// — the front expiry, expanded — is painted off the first response with no
// second round trip. That is v3 non-negotiable #3, and it is the reason this
// file exposes `fetchSeed` separately from `fetchExpiry`.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '@/data/api'
import { etDateKey, etToday } from '@/pages/optionsChain/marketSession'

/** One side of one strike, exactly as the feed carries it. */
export interface OptionQuote {
  /** OCC symbol, for a future order ticket. Empty when the side is missing. */
  symbol: string
  bid: number
  ask: number
  /** Feed mark, falling back to the bid/ask mid. 0 when neither is quoted. */
  mark: number
  volume: number
  oi: number
  /** Decimal, not percent: 0.124 is 12.4%. */
  iv: number
  delta: number
  gamma: number
  theta: number
  vega: number
  /** false when the feed carried no object for this side at this strike. */
  live: boolean
}

export interface ChainRow {
  strike: number
  call: OptionQuote
  put: OptionQuote
}

export interface ChainBook {
  expiration: string
  underlying: number
  rows: ChainRow[]
  /** Straddle IV at the strike nearest spot, as a decimal. 0 when unquoted. */
  atmIv: number
  callOi: number
  putOi: number
  callVol: number
  putVol: number
}

export interface ExpiryMeta {
  /** "2026-09-11" */
  value: string
  /** "Fri Sep 11" */
  label: string
  /** Calendar days from today (ET). 0 = today's expiry. */
  dte: number
  /** Third Friday of its month — the standard monthly. */
  monthly: boolean
}

const EMPTY_QUOTE: OptionQuote = {
  symbol: '',
  bid: 0,
  ask: 0,
  mark: 0,
  volume: 0,
  oi: 0,
  iv: 0,
  delta: 0,
  gamma: 0,
  theta: 0,
  vega: 0,
  live: false,
}

function fin(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function toQuote(raw: unknown): OptionQuote {
  if (!raw || typeof raw !== 'object') return EMPTY_QUOTE
  const o = raw as Record<string, unknown>
  const bid = fin(o['bid'])
  const ask = fin(o['ask'])
  let mark = fin(o['mark'])
  // Same ladder the matrix uses: feed mark, then the mid. A one-sided quote
  // still yields half the spread rather than a zero, which is what a book with
  // no bid actually means.
  if (!(mark > 0) && (bid > 0 || ask > 0)) mark = (bid + ask) / 2
  return {
    symbol: String(o['symbol'] ?? ''),
    bid,
    ask,
    mark,
    volume: Math.round(fin(o['volume'])),
    oi: Math.round(fin(o['open-interest'] ?? o['openInterest'])),
    iv: fin(o['implied-volatility']),
    delta: fin(o['delta']),
    gamma: fin(o['gamma']),
    theta: fin(o['theta']),
    vega: fin(o['vega']),
    live: true,
  }
}

interface ChainPayload {
  data?: {
    underlyingPrice?: unknown
    items?: Array<{ 'expiration-date'?: string; strikes?: unknown[] }>
  }
}

/**
 * Turn one payload into one book per expiration group it carries. Groups with
 * no parseable strike are dropped — an empty column is a lie the accordion
 * would show as "loaded, no strikes".
 */
export function parseChainPayload(json: ChainPayload | null): {
  underlying: number
  books: ChainBook[]
} {
  const underlying = fin(json?.data?.underlyingPrice)
  const items = json?.data?.items ?? []
  const books: ChainBook[] = []

  for (const group of items) {
    const expiration = String(group?.['expiration-date'] ?? '').slice(0, 10)
    if (!expiration) continue
    const rows: ChainRow[] = []
    let callOi = 0
    let putOi = 0
    let callVol = 0
    let putVol = 0

    for (const item of group?.strikes ?? []) {
      const it = item as Record<string, unknown>
      const strike = fin(it?.['strike-price'])
      if (!strike) continue
      const call = toQuote(it?.['call'])
      const put = toQuote(it?.['put'])
      callOi += call.oi
      putOi += put.oi
      callVol += call.volume
      putVol += put.volume
      rows.push({ strike, call, put })
    }
    if (!rows.length) continue
    rows.sort((a, b) => a.strike - b.strike)

    books.push({
      expiration,
      underlying,
      rows,
      atmIv: atmIvOf(rows, underlying),
      callOi,
      putOi,
      callVol,
      putVol,
    })
  }

  books.sort((a, b) => a.expiration.localeCompare(b.expiration))
  return { underlying, books }
}

/** Straddle IV at the nearest strike — the number a chain header quotes. */
function atmIvOf(rows: ChainRow[], spot: number): number {
  if (!rows.length || !(spot > 0)) return 0
  let best = rows[0] as ChainRow
  let bestGap = Math.abs(best.strike - spot)
  for (const r of rows) {
    const gap = Math.abs(r.strike - spot)
    if (gap < bestGap) {
      best = r
      bestGap = gap
    }
  }
  const legs = [best.call.iv, best.put.iv].filter((v) => v > 0)
  if (!legs.length) return 0
  return legs.reduce((a, b) => a + b, 0) / legs.length
}

// ── Expiration metadata ──────────────────────────────────────────────────────

const DAY_MS = 86_400_000
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Describe an expiry.
 *
 * Both dates are read at NOON UTC deliberately. "2026-07-01" parsed as local
 * midnight in a negative offset is Jun 30, and an expiry row headed with the
 * wrong weekday is the single most confusing thing a chain can print.
 */
export function expiryMeta(value: string): ExpiryMeta {
  const iso = String(value || '').slice(0, 10)
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return { value: iso, label: iso, dte: 0, monthly: false }
  const today = new Date(`${etDateKey(etToday())}T12:00:00Z`)
  const dte = Math.max(0, Math.round((d.getTime() - today.getTime()) / DAY_MS))
  const dow = d.getUTCDay()
  const dom = d.getUTCDate()
  return {
    value: iso,
    label: `${WEEKDAYS[dow]} ${MONTHS[d.getUTCMonth()]} ${dom}`,
    dte,
    // Third Friday: the only Friday that falls between the 15th and the 21st.
    monthly: dow === 5 && dom >= 15 && dom <= 21,
  }
}

// ── Fetches ──────────────────────────────────────────────────────────────────
// Every one answers null rather than throwing: a chain that fails to load shows
// its own message in the row it belongs to, and one bad expiry must not take
// the page down with it.

async function get<T>(url: string, staleMs = 0): Promise<T | null> {
  try {
    return await query<T>(url, { staleMs })
  } catch {
    return null
  }
}

const enc = encodeURIComponent

/** The front of the board — the nearest expirations, in ONE request. */
export function seedUrl(symbol: string): string {
  return `/api/chains?ticker=${enc(symbol)}&range=all`
}

export function expiryUrl(symbol: string, expiration: string): string {
  return `/api/chains?ticker=${enc(symbol)}&expiration=${enc(expiration)}&range=all`
}

export function expirationsUrl(symbol: string): string {
  return `/api/expirations?ticker=${enc(symbol)}`
}

/**
 * The seed carries a STALE WINDOW rather than staleMs 0, because the rail
 * prefetches this exact URL on hover (NAV.prefetch in shell/Shell.tsx). With no
 * window the page's own call would bypass the warmed entry and the prefetch
 * would be a request nobody reads. Refreshing goes through `bust`, which is a
 * different URL and therefore a different cache key.
 */
const SEED_STALE_MS = 15_000

export async function fetchSeed(symbol: string, bust = false) {
  return parseChainPayload(
    await get<ChainPayload>(seedUrl(symbol) + (bust ? '&noCache=1' : ''), bust ? 0 : SEED_STALE_MS),
  )
}

export async function fetchExpiry(symbol: string, expiration: string, bust = false) {
  const parsed = parseChainPayload(
    await get<ChainPayload>(expiryUrl(symbol, expiration) + (bust ? '&noCache=1' : '')),
  )
  // The proxy echoes the requested date, but a payload that omits it still
  // parses — take whatever single group came back rather than dropping it.
  const book =
    parsed.books.find((b) => b.expiration === expiration) ?? parsed.books[0] ?? null
  return { underlying: parsed.underlying, book }
}

/** The symbol's REAL listed expirations, so the accordion never offers a date
 *  the ticker does not trade. */
export async function fetchExpirations(symbol: string): Promise<ExpiryMeta[]> {
  const json = await get<{ data?: { items?: Array<Record<string, unknown>> } }>(
    expirationsUrl(symbol),
    30_000,
  )
  const items = json?.data?.items ?? []
  const seen = new Set<string>()
  const out: ExpiryMeta[] = []
  for (const it of items) {
    const value = String(it?.['expiration-date'] ?? '').slice(0, 10)
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(expiryMeta(value))
  }
  out.sort((a, b) => a.value.localeCompare(b.value))
  return out
}
