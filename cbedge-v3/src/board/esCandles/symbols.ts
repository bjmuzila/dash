// ─────────────────────────────────────────────────────────────────────────────
// The chart's symbol universe — a v3-native port of v2's
// components/dashboard/es-candles/symbols.tsx, minus the dock chrome.
//
// Three tiers, same as v2:
//   1. a curated hardcoded list (below), always present, always first
//   2. the server roster from /api/es-candles/tickers, fetched once, lazily,
//      on the first time a picker opens — never on mount
//   3. anything the user types that looks like a ticker
//
// A symbol carries THREE names because the backend keeps three:
//   key/label      what the user sees and what we persist
//   gexSymbol      what the gamma tables are keyed by ($SPX for both ES and SPX)
//   candleSource   which candle endpoint knows about it — ES/NQ futures live in
//                  es_candles, everything else in etf_candles
// ─────────────────────────────────────────────────────────────────────────────

export type CandleSource = 'es' | 'etf'

export interface SymbolDef {
  key: string
  label: string
  /** Key the GEX history tables use. ES and SPX share `$SPX`. */
  gexSymbol: string
  /** Which candle endpoint serves it. */
  candleSource: CandleSource
  /** Symbol to send to the candle endpoint, when it differs from `key`. */
  candleSymbol?: string
  /**
   * True when the price axis is ES futures and the GEX strikes are SPX cash —
   * i.e. every strike needs the ES−SPX basis added before it can be drawn.
   * Only ES is in this position: SPX charts cash against cash (basis 0), and
   * SPY/QQQ/NVDA chart a symbol against its own strikes.
   */
  needsBasis?: boolean
}

export const SYMBOLS: SymbolDef[] = [
  { key: 'ES', label: 'ES', gexSymbol: '$SPX', candleSource: 'es', needsBasis: true },
  { key: 'SPX', label: 'SPX', gexSymbol: '$SPX', candleSource: 'etf', candleSymbol: 'SPX' },
  { key: 'SPY', label: 'SPY', gexSymbol: 'SPY', candleSource: 'etf' },
  { key: 'QQQ', label: 'QQQ', gexSymbol: 'QQQ', candleSource: 'etf' },
  { key: 'NDX', label: 'NDX', gexSymbol: 'NDX', candleSource: 'etf' },
  { key: 'VIX', label: 'VIX', gexSymbol: 'VIX', candleSource: 'etf' },
  { key: 'AAPL', label: 'AAPL', gexSymbol: 'AAPL', candleSource: 'etf' },
  { key: 'AMD', label: 'AMD', gexSymbol: 'AMD', candleSource: 'etf' },
  { key: 'AMZN', label: 'AMZN', gexSymbol: 'AMZN', candleSource: 'etf' },
  { key: 'GOOGL', label: 'GOOGL', gexSymbol: 'GOOGL', candleSource: 'etf' },
  { key: 'META', label: 'META', gexSymbol: 'META', candleSource: 'etf' },
  { key: 'MSFT', label: 'MSFT', gexSymbol: 'MSFT', candleSource: 'etf' },
  { key: 'NVDA', label: 'NVDA', gexSymbol: 'NVDA', candleSource: 'etf' },
  { key: 'SPCX', label: 'SPCX', gexSymbol: 'SPCX', candleSource: 'etf' },
  { key: 'TSLA', label: 'TSLA', gexSymbol: 'TSLA', candleSource: 'etf' },
]

const BY_KEY = new Map(SYMBOLS.map((s) => [s.key, s]))

export const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/

export function normalizeSymbol(s: string): string {
  return s.trim().toUpperCase()
}

/** A def for any symbol — curated, roster or freeform. Never returns null. */
export function symbolDef(key: string): SymbolDef {
  const k = normalizeSymbol(key)
  return BY_KEY.get(k) ?? { key: k, label: k, gexSymbol: k, candleSource: 'etf' }
}

// ── The server roster ────────────────────────────────────────────────────────
// One fetch per page load, shared across every picker, started on first open.
// A failure yields an empty list and is never retried: the curated list plus
// freeform entry is a complete fallback, and a retry loop behind a dropdown is
// the kind of thing nobody notices until it is hammering the backend.

const ROSTER_URL = '/api/es-candles/tickers'
let rosterCache: string[] | null = null
let rosterInflight: Promise<string[]> | null = null

export function loadRoster(): Promise<string[]> {
  if (rosterCache) return Promise.resolve(rosterCache)
  if (rosterInflight) return rosterInflight
  rosterInflight = fetch(ROSTER_URL, { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { tickers?: unknown } | null) => {
      const raw = Array.isArray(j?.tickers) ? j.tickers : []
      const seen = new Set<string>()
      const out: string[] = []
      for (const t of raw) {
        const k = normalizeSymbol(String(t))
        if (!TICKER_RE.test(k) || seen.has(k)) continue
        seen.add(k)
        out.push(k)
      }
      rosterCache = out
      return out
    })
    .catch(() => {
      rosterCache = []
      return []
    })
    .finally(() => {
      rosterInflight = null
    })
  return rosterInflight
}

// ── Favourites ───────────────────────────────────────────────────────────────
// Global across every chart, same key v2 uses, so a user's stars survive the
// move between /app/es-candles and /v3.

const FAV_KEY = 'es-candles-fav-symbols-v1'

export function loadFavSymbols(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.map((s) => normalizeSymbol(String(s))) : []
  } catch {
    return []
  }
}

export function saveFavSymbols(list: string[]): void {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(list))
  } catch {
    /* best-effort */
  }
}
