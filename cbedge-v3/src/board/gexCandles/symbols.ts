// ─────────────────────────────────────────────────────────────────────────────
// The chart's symbol universe.
//
// ES AND NQ ARE DELIBERATELY ABSENT (2026-08-27). Dropping the futures is what
// lets this whole module tree be simple:
//
//   · One candle endpoint. /api/snapshots/etf-candles serves every symbol here.
//     The futures route, /api/snapshots/candles, only ever looked at the symbol
//     to choose between the ES and NQ tables — asking it for SPY silently
//     returned ES bars — and it is now unreferenced by v3.
//   · No basis. An ES chart plots futures prices while its strikes are SPX
//     cash, ~40-60 points apart, so every strike had to be converted through
//     /proxy/es-spx-basis before a GEX bubble could be drawn at it. Every
//     symbol below charts against its OWN strikes, so a bubble goes at the
//     strike price and there is nothing to convert, nothing to fetch, and no
//     "basis unavailable" state to design around.
//
// SPX cash candles are recorded by server-v2/etf-candle-recorder.js (its hot
// lane, added 2026-08-27) and /api/snapshots/etf-candles is the only route that
// serves them, with a dxlink-live fallback while the table fills.
//
// Three tiers of symbol, as in v2:
//   1. the curated list below, always present, always first
//   2. the server roster from /api/es-candles/tickers, fetched once, lazily,
//      on the first time a picker opens — never on mount
//   3. anything the user types that looks like a ticker
// ─────────────────────────────────────────────────────────────────────────────

export interface SymbolDef {
  key: string
  label: string
  /**
   * Key the GEX history tables are keyed by. Only SPX differs from its own
   * ticker — gamma is stored under `$SPX` while the candle feed knows `SPX`.
   */
  gexSymbol: string
}

export const SYMBOLS: SymbolDef[] = [
  { key: 'SPX', label: 'SPX', gexSymbol: '$SPX' },
  { key: 'SPY', label: 'SPY', gexSymbol: 'SPY' },
  { key: 'QQQ', label: 'QQQ', gexSymbol: 'QQQ' },
  { key: 'NDX', label: 'NDX', gexSymbol: 'NDX' },
  { key: 'VIX', label: 'VIX', gexSymbol: 'VIX' },
  { key: 'AAPL', label: 'AAPL', gexSymbol: 'AAPL' },
  { key: 'AMD', label: 'AMD', gexSymbol: 'AMD' },
  { key: 'AMZN', label: 'AMZN', gexSymbol: 'AMZN' },
  { key: 'GOOGL', label: 'GOOGL', gexSymbol: 'GOOGL' },
  { key: 'META', label: 'META', gexSymbol: 'META' },
  { key: 'MSFT', label: 'MSFT', gexSymbol: 'MSFT' },
  { key: 'NVDA', label: 'NVDA', gexSymbol: 'NVDA' },
  { key: 'SPCX', label: 'SPCX', gexSymbol: 'SPCX' },
  { key: 'TSLA', label: 'TSLA', gexSymbol: 'TSLA' },
]

const BY_KEY = new Map(SYMBOLS.map((s) => [s.key, s]))

export const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/

/** Symbols v3 no longer charts, and what a saved setting for one becomes. */
const RETIRED: Record<string, string> = { ES: 'SPX', '/ES': 'SPX', NQ: 'NDX', '/NQ': 'NDX' }

export function normalizeSymbol(s: string): string {
  const k = s.trim().toUpperCase()
  return RETIRED[k] ?? k
}

/** A def for any symbol — curated, roster or freeform. Never returns null. */
export function symbolDef(key: string): SymbolDef {
  const k = normalizeSymbol(key)
  return BY_KEY.get(k) ?? { key: k, label: k, gexSymbol: k }
}

/** The ticker the options-chain routes want, which never carries the `$`. */
export function chainTicker(def: SymbolDef): string {
  return def.gexSymbol.replace(/^\$/, '')
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
// Deliberately the SAME localStorage key v2 uses, so a user's stars survive the
// move between /app/es-candles and /v3. It holds a plain string array and v3
// only ever reads and rewrites that shape, so neither app can corrupt it for
// the other. This is the one storage key v3 shares; everything else it invented
// is namespaced `cb-v3-`.

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
