// ─────────────────────────────────────────────────────────────────────────────
// THE COLUMN REGISTRY.
//
// Two registries, because a chain has two KINDS of column and conflating them
// is what makes a net figure end up printed twice, once per wing:
//
//   WING columns    read ONE SIDE of a strike. They are mirrored — the same
//                   list, rendered backwards on the call wing — so bid sits
//                   against bid and a strike reads across in one movement.
//   CENTRE columns   read the STRIKE, both sides at once: net GEX, net OI, net
//                   premium. There is one of each per row, and they live in the
//                   middle block beside the strike, because a net has no side.
//
// ── The wing order is "inner first" ──────────────────────────────────────────
// The selected list is written in PUT order — left to right, starting at the
// strike — and the call side renders it reversed. Get that backwards and the
// two halves read as two tables that happen to share a strike column.
//
// Every colour is a token. `tone` returns one or undefined; undefined means the
// cell keeps the table's ink.
// ─────────────────────────────────────────────────────────────────────────────

import { T } from '@/design/theme'
import { fmtCount, fmtMoney } from '@/pages/optionsChain/format'
import type { ChainRow, OptionQuote } from './chainBook'

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

/** A centre column reads the whole strike. `spot` is the live underlying. */
export interface CenterColumn {
  key: string
  label: string
  title: string
  width: number
  read: (row: ChainRow, spot: number) => number | null
  fmt: (v: number) => string
  tone?: (v: number) => string | undefined
}

// ── Formatters ───────────────────────────────────────────────────────────────
// Local on purpose. optionsChain/format.ts writes GEX dollars — always signed,
// always compact — which is the opposite of what a QUOTE column wants: a bid of
// 1.35 must read "1.35", not "+$1". The centre columns ARE exposure dollars, so
// those import fmtMoney/fmtCount from that file rather than growing a second
// spelling of the same number.

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

// ── Wing columns ─────────────────────────────────────────────────────────────

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
    key: 'last',
    label: 'Last',
    title:
      'Last traded price — an actual print, not a quote. Blank means the contract has not traded today, which on a wing strike is normal.',
    width: 58,
    // 0 is "no print", not "printed at zero" — the placeholder is the honest
    // rendering, and it is why this reads null rather than falling back to mark.
    read: (q) => (q.live && q.last > 0 ? q.last : null),
    fmt: price,
    // Away from the mark by more than a tick or two, the last print is old.
    // Nothing to compare against here per-cell, so it takes the accent only to
    // say "this is a trade, not a quote".
    tone: () => T.cyan,
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
    read: (q) =>
      q.live && q.mark > 0 && q.ask > 0 && q.bid > 0 ? ((q.ask - q.bid) / q.mark) * 100 : null,
    fmt: pct1,
    // Above 10% of the mark the round trip costs more than most edges. Flagged
    // rather than hidden: a wide market is information, not an error.
    tone: (v) => (v >= 10 ? T.orange : undefined),
  },
  {
    key: 'iv',
    label: 'IV',
    title:
      'Implied volatility, annualised. With the greek source on Black-Scholes this is the SOLVED vol wherever the feed sent none.',
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
    title:
      "Contracts traded today. Zeroed before 09:30 ET — the feed's running total is still yesterday's until the bell.",
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
    title:
      "Today's volume over open interest. Above 1 means more contracts traded than were open — new positioning, not a churn of the existing book.",
    width: 52,
    read: (q) => (q.live && q.oi > 0 ? q.volume / q.oi : null),
    fmt: (v) => v.toFixed(2),
    tone: (v) => (v >= 1 ? T.cyan : undefined),
  },
  {
    key: 'premium',
    label: 'Prem',
    title: 'Premium traded on this side today = mark × volume × 100',
    width: 66,
    read: (q) => (q.live && q.volume > 0 && q.mark > 0 ? q.mark * q.volume * 100 : null),
    fmt: (v) => fmtMoney(v).replace(/^\+/, ''),
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
    title:
      'Rough probability of finishing in the money — |delta| × 100, the desk shorthand',
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

// ── Centre columns: the NET, per strike ──────────────────────────────────────
//
// The four exposure formulas are transcribed from pages/optionsChain/chainMath
// .ts VERBATIM, contract basis included, so a strike reads the SAME net GEX on
// this page as it does on the matrix. Re-deriving them "the same way" is
// exactly how one strike ends up carrying two numbers on two pages.
//
//   contracts = OI + volume, per side
//   GEX  = (γc·cc − γp·pc) · S² · 0.01 · 100
//   DEX  = (|Δc|·cc − |Δp|·pc) · S · 100
//   CHEX = (−θc·cc + θp·pc) · S · 100
//   VEX  = (νc·cc − νp·pc) · S · 100
//
// With the greek source set to Black-Scholes the grid hands these MODEL greeks
// instead of the feed's, so the net columns follow the toggle too — the whole
// point of having one.

const contracts = (q: OptionQuote): number => q.oi + q.volume

const money = (v: number): string => fmtMoney(v)

export const CENTER_COLUMNS: CenterColumn[] = [
  {
    key: 'netGex',
    label: 'Net GEX',
    title: 'Net gamma exposure = (γc·cc − γp·pc) · S² · 0.01 · 100, contracts = OI + volume',
    width: 82,
    read: (row, spot) =>
      spot > 0
        ? (row.call.gamma * contracts(row.call) - row.put.gamma * contracts(row.put)) *
          spot *
          spot *
          0.01 *
          100
        : null,
    fmt: money,
    tone: (v) => signTone(v),
  },
  {
    key: 'netDex',
    label: 'Net DEX',
    title: 'Net delta exposure = (|Δc|·cc − |Δp|·pc) · S · 100',
    width: 82,
    read: (row, spot) =>
      spot > 0
        ? (Math.abs(row.call.delta) * contracts(row.call) -
            Math.abs(row.put.delta) * contracts(row.put)) *
          spot *
          100
        : null,
    fmt: money,
    tone: (v) => signTone(v),
  },
  {
    key: 'netChex',
    label: 'Net CHEX',
    title: 'Net charm/theta exposure = (−θc·cc + θp·pc) · S · 100',
    width: 82,
    read: (row, spot) =>
      spot > 0
        ? (-row.call.theta * contracts(row.call) + row.put.theta * contracts(row.put)) * spot * 100
        : null,
    fmt: money,
    tone: (v) => signTone(v),
  },
  {
    key: 'netVex',
    label: 'Net VEX',
    title: 'Net vega exposure = (νc·cc − νp·pc) · S · 100',
    width: 82,
    read: (row, spot) =>
      spot > 0
        ? (row.call.vega * contracts(row.call) - row.put.vega * contracts(row.put)) * spot * 100
        : null,
    fmt: money,
    tone: (v) => signTone(v),
  },
  {
    key: 'netOi',
    label: 'Net OI',
    title: 'Call OI − put OI. Positive is a call-heavy strike.',
    width: 70,
    read: (row) => (row.call.oi || row.put.oi ? row.call.oi - row.put.oi : null),
    fmt: (v) => (v > 0 ? `+${fmtCount(v)}` : fmtCount(v)),
    tone: (v) => signTone(v),
  },
  {
    key: 'netVol',
    label: 'Net Vol',
    title: "Call volume − put volume, today's flow at this strike",
    width: 70,
    read: (row) => (row.call.volume || row.put.volume ? row.call.volume - row.put.volume : null),
    fmt: (v) => (v > 0 ? `+${fmtCount(v)}` : fmtCount(v)),
    tone: (v) => signTone(v),
  },
  {
    key: 'netPrem',
    label: 'Net Prem',
    title:
      'Net premium traded = (call mark × call vol − put mark × put vol) × 100. Positive means more money went into calls at this strike today.',
    width: 82,
    read: (row) => {
      const c = row.call.mark * row.call.volume
      const p = row.put.mark * row.put.volume
      return c || p ? (c - p) * 100 : null
    },
    fmt: money,
    tone: (v) => signTone(v),
  },
  {
    key: 'totPrem',
    label: 'Tot Prem',
    title: 'Total premium traded at this strike, both sides = (call + put) × volume × 100',
    width: 82,
    read: (row) => {
      const v = (row.call.mark * row.call.volume + row.put.mark * row.put.volume) * 100
      return v > 0 ? v : null
    },
    fmt: (v) => fmtMoney(v).replace(/^\+/, ''),
  },
]

export const CENTER_BY_KEY = new Map(CENTER_COLUMNS.map((c) => [c.key, c]))

// ── Presets ──────────────────────────────────────────────────────────────────
// Five layouts that answer five different questions, rather than one default
// nobody can change. `standard` is the ToS/tasty default read: what it costs,
// how volatile, how directional, how much is there.

export interface ChainPreset {
  key: string
  label: string
  title: string
  columns: string[]
  /** Centre columns this preset turns on. Empty for the quote-only reads. */
  center: string[]
}

export const CHAIN_PRESETS: ChainPreset[] = [
  {
    key: 'standard',
    label: 'Standard',
    title: 'The default read — quotes, the last print, IV, delta and the book',
    columns: ['bid', 'ask', 'mark', 'last', 'iv', 'delta', 'volume', 'oi'],
    center: [],
  },
  {
    key: 'greeks',
    label: 'Greeks',
    title: 'All four greeks against the mark and IV',
    columns: ['mark', 'iv', 'delta', 'gamma', 'theta', 'vega'],
    center: [],
  },
  {
    key: 'liquidity',
    label: 'Liquidity',
    title: 'What it costs to get in and out',
    columns: ['bid', 'ask', 'spread', 'spreadPct', 'last', 'volume', 'oi', 'volOi'],
    center: [],
  },
  {
    key: 'exposure',
    label: 'Exposure',
    title: 'The net book at each strike — GEX, DEX and net premium down the middle',
    columns: ['mark', 'iv', 'delta', 'gamma', 'volume', 'oi'],
    center: ['netGex', 'netDex', 'netOi', 'netPrem'],
  },
  {
    key: 'analysis',
    label: 'Analysis',
    title: 'Time value, breakeven and the odds',
    columns: ['mark', 'extrinsic', 'breakeven', 'itm', 'iv', 'delta', 'oi'],
    center: [],
  },
]

export const DEFAULT_COLUMNS: string[] = CHAIN_PRESETS[0]?.columns ?? ['bid', 'ask', 'mark']
export const DEFAULT_CENTER: string[] = []

/** Drop unknown keys and de-duplicate — a stored layout from an older build
 *  must not be able to crash the grid with a column that no longer exists. */
function clean(keys: unknown, known: Map<string, unknown>, fallback: string[]): string[] {
  if (!Array.isArray(keys)) return fallback
  const seen = new Set<string>()
  const out: string[] = []
  for (const k of keys) {
    const key = String(k)
    if (!known.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

export function sanitizeColumns(keys: unknown): string[] {
  const out = clean(keys, COLUMN_BY_KEY, DEFAULT_COLUMNS)
  return out.length ? out : DEFAULT_COLUMNS
}

/** Centre columns are allowed to be EMPTY — that is the default layout. */
export function sanitizeCenter(keys: unknown): string[] {
  return clean(keys, CENTER_BY_KEY, DEFAULT_CENTER)
}

export function resolveColumns(keys: string[]): ChainColumn[] {
  return keys.map((k) => COLUMN_BY_KEY.get(k)).filter((c): c is ChainColumn => !!c)
}

export function resolveCenter(keys: string[]): CenterColumn[] {
  return keys.map((k) => CENTER_BY_KEY.get(k)).filter((c): c is CenterColumn => !!c)
}

/**
 * Move one key by `delta` places, clamped. Returns the SAME array reference
 * when nothing moved, so a click on a disabled arrow cannot cause a re-render
 * of the whole grid.
 */
export function moveKey(keys: string[], key: string, delta: number): string[] {
  const from = keys.indexOf(key)
  if (from < 0) return keys
  const to = from + delta
  if (to < 0 || to >= keys.length) return keys
  const next = [...keys]
  next.splice(from, 1)
  next.splice(to, 0, key)
  return next
}
