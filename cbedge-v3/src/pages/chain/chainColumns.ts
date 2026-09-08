// ─────────────────────────────────────────────────────────────────────────────
// THE COLUMN REGISTRY.
//
// One entry per readable field, and the ONLY place a chain column is defined.
// The grid renders whatever list of keys it is handed, mirrored on the call
// side, so adding a column is one entry here and nothing else.
//
// ── The order is "inner first" ───────────────────────────────────────────────
// A real chain is a MIRROR: bid and ask sit against the strike on both sides,
// and the outermost column is the same field on both wings. So the selected
// list is written in PUT order — left to right, starting at the strike — and
// the call side renders it reversed. Get that backwards and the two halves read
// as two different tables that happen to share a strike column.
//
// Every colour is a token. `tone` returns one or undefined; undefined means the
// cell keeps the table's ink.
// ─────────────────────────────────────────────────────────────────────────────

import { T } from '@/design/theme'
import type { OptionQuote } from './chainBook'

export type ChainSide = 'call' | 'put'

export interface CellCtx {
  strike: number
  spot: number
  side: ChainSide
}

export interface ChainColumn {
  key: string
  /** Column head. Short — this row is 10px. */
  label: string
  /** Column head tooltip: the full name, and the formula where there is one. */
  title: string
  width: number
  /** null = nothing to show. The grid draws the placeholder rather than a 0. */
  read: (q: OptionQuote, ctx: CellCtx) => number | null
  fmt: (v: number, ctx: CellCtx) => string
  tone?: (v: number, ctx: CellCtx) => string | undefined
}

// ── Formatters ───────────────────────────────────────────────────────────────
// Local on purpose. optionsChain/format.ts writes GEX dollars — always signed,
// always compact — which is the opposite of what a quote column wants: a bid of
// 1.35 must read "1.35", not "+$1".

const price = (v: number): string => v.toFixed(2)
const int = (v: number): string => Math.round(v).toLocaleString('en-US')
const pct1 = (v: number): string => `${v.toFixed(1)}%`

function intrinsic(ctx: CellCtx): number {
  return ctx.side === 'call'
    ? Math.max(0, ctx.spot - ctx.strike)
    : Math.max(0, ctx.strike - ctx.spot)
}

const signTone = (v: number): string | undefined =>
  v > 0 ? T.green : v < 0 ? T.red : undefined

// ── The columns ──────────────────────────────────────────────────────────────

export const CHAIN_COLUMNS: ChainColumn[] = [
  {
    key: 'bid',
    label: 'Bid',
    title: 'Best bid',
    width: 58,
    read: (q) => (q.live ? q.bid : null),
    fmt: price,
  },
  {
    key: 'ask',
    label: 'Ask',
    title: 'Best offer',
    width: 58,
    read: (q) => (q.live ? q.ask : null),
    fmt: price,
  },
  {
    key: 'mark',
    label: 'Mark',
    title: 'Feed mark, falling back to the bid/ask mid',
    width: 58,
    read: (q) => (q.live ? q.mark : null),
    fmt: price,
  },
  {
    key: 'spread',
    label: 'Sprd',
    title: 'Ask − bid, in dollars',
    width: 52,
    read: (q) => (q.live && q.ask > 0 && q.bid > 0 ? q.ask - q.bid : null),
    fmt: price,
  },
  {
    key: 'spreadPct',
    label: 'Sprd%',
    title: 'Spread as a percentage of the mark — the liquidity read',
    width: 54,
    read: (q) => (q.live && q.mark > 0 && q.ask > 0 && q.bid > 0 ? ((q.ask - q.bid) / q.mark) * 100 : null),
    fmt: pct1,
    // Above 10% of the mark the round trip costs more than most edges. Flagged
    // rather than hidden: a wide market is information, not an error.
    tone: (v) => (v >= 10 ? T.orange : undefined),
  },
  {
    key: 'iv',
    label: 'IV',
    title: 'Implied volatility, annualised',
    width: 58,
    read: (q) => (q.live && q.iv > 0 ? q.iv * 100 : null),
    fmt: pct1,
  },
  {
    key: 'delta',
    label: 'Δ',
    title: 'Delta — the feed sign, so puts read negative',
    width: 56,
    read: (q) => (q.live ? q.delta : null),
    fmt: (v) => v.toFixed(3),
    tone: (v) => signTone(v),
  },
  {
    key: 'gamma',
    label: 'Γ',
    title: 'Gamma per $1 of underlying',
    width: 60,
    read: (q) => (q.live ? q.gamma : null),
    fmt: (v) => v.toFixed(4),
  },
  {
    key: 'theta',
    label: 'Θ',
    title: 'Theta — decay per day, per contract',
    width: 56,
    read: (q) => (q.live ? q.theta : null),
    fmt: (v) => v.toFixed(2),
    tone: (v) => signTone(v),
  },
  {
    key: 'vega',
    label: 'ν',
    title: 'Vega — dollars per 1 point of IV',
    width: 54,
    read: (q) => (q.live ? q.vega : null),
    fmt: (v) => v.toFixed(2),
  },
  {
    key: 'volume',
    label: 'Vol',
    title: "Contracts traded today. Zeroed before 09:30 ET — the feed's running total is still yesterday's until the bell.",
    width: 62,
    read: (q) => (q.live ? q.volume : null),
    fmt: int,
  },
  {
    key: 'oi',
    label: 'OI',
    title: 'Open interest — the settled book, as of the prior close',
    width: 66,
    read: (q) => (q.live ? q.oi : null),
    fmt: int,
  },
  {
    key: 'volOi',
    label: 'V/OI',
    title: "Today's volume over open interest. Above 1 means more contracts traded than were open — new positioning, not a churn of the existing book.",
    width: 52,
    read: (q) => (q.live && q.oi > 0 ? q.volume / q.oi : null),
    fmt: (v) => v.toFixed(2),
    tone: (v) => (v >= 1 ? T.cyan : undefined),
  },
  {
    key: 'extrinsic',
    label: 'Extr',
    title: 'Extrinsic (time) value = mark − intrinsic. This is what decays.',
    width: 58,
    read: (q, ctx) => (q.live && q.mark > 0 ? Math.max(0, q.mark - intrinsic(ctx)) : null),
    fmt: price,
  },
  {
    key: 'itm',
    label: 'ITM%',
    title: 'Rough probability of finishing in the money — |delta| × 100, the desk shorthand',
    width: 54,
    read: (q) => (q.live && q.delta !== 0 ? Math.abs(q.delta) * 100 : null),
    fmt: (v) => `${v.toFixed(0)}%`,
  },
  {
    key: 'breakeven',
    label: 'B/E',
    title: 'Breakeven at expiry for a long single: strike ± mark',
    width: 72,
    read: (q, ctx) =>
      q.live && q.mark > 0 ? (ctx.side === 'call' ? ctx.strike + q.mark : ctx.strike - q.mark) : null,
    fmt: (v) => (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2)),
  },
]

export const COLUMN_BY_KEY = new Map(CHAIN_COLUMNS.map((c) => [c.key, c]))

// ── Presets ──────────────────────────────────────────────────────────────────
// Four layouts that answer four different questions, rather than one default
// nobody can change. `standard` is the ToS/tasty default read: what it costs,
// how volatile, how directional, how much is there.

export interface ChainPreset {
  key: string
  label: string
  title: string
  columns: string[]
}

export const CHAIN_PRESETS: ChainPreset[] = [
  {
    key: 'standard',
    label: 'Standard',
    title: 'The default read — quotes, IV, delta and the book',
    columns: ['bid', 'ask', 'mark', 'iv', 'delta', 'volume', 'oi'],
  },
  {
    key: 'greeks',
    label: 'Greeks',
    title: 'All four greeks against the mark and IV',
    columns: ['mark', 'iv', 'delta', 'gamma', 'theta', 'vega'],
  },
  {
    key: 'liquidity',
    label: 'Liquidity',
    title: 'What it costs to get in and out',
    columns: ['bid', 'ask', 'spread', 'spreadPct', 'volume', 'oi', 'volOi'],
  },
  {
    key: 'analysis',
    label: 'Analysis',
    title: 'Time value, breakeven and the odds',
    columns: ['mark', 'extrinsic', 'breakeven', 'itm', 'iv', 'delta', 'oi'],
  },
]

export const DEFAULT_COLUMNS: string[] = CHAIN_PRESETS[0]?.columns ?? ['bid', 'ask', 'mark']

/** Drop unknown keys and de-duplicate — a stored layout from an older build
 *  must not be able to crash the grid with a column that no longer exists. */
export function sanitizeColumns(keys: unknown): string[] {
  if (!Array.isArray(keys)) return DEFAULT_COLUMNS
  const seen = new Set<string>()
  const out: string[] = []
  for (const k of keys) {
    const key = String(k)
    if (!COLUMN_BY_KEY.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out.length ? out : DEFAULT_COLUMNS
}

export function resolveColumns(keys: string[]): ChainColumn[] {
  return keys.map((k) => COLUMN_BY_KEY.get(k)).filter((c): c is ChainColumn => !!c)
}
