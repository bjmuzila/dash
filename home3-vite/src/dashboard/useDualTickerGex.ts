import { useEffect, useState } from 'react'

// Per-strike net GEX for SPY / QQQ keyed by MONEYNESS OFFSET (…-1, 0=ATM, +1…),
// ported from hooks/useDualTickerGex.ts. The home heatmap's rows are SPX strikes;
// SPY/QQQ don't share SPX's ladder, so each ticker is indexed relative to its own
// ATM and the columns compare gamma-structure SHAPE at matching offsets.
export type GexBasis = 'oi-vol' | 'vol-only'

export interface OffsetGex { strike: number; netGEX: number }
export type OffsetGexMap = Record<number, OffsetGex>
export interface TickerGex { map: OffsetGexMap; spot: number; atmStrike: number; expiration: string }
export type DualTickerGex = Record<string, TickerGex>

const SIDE_STRIKES = 20
const num = (v: unknown): number => { const n = parseFloat(String(v ?? 0)); return Number.isFinite(n) ? n : 0 }

async function resolveExpiration(ticker: string, wanted: string, signal: AbortSignal): Promise<string | null> {
  const json = await fetch(`/api/expirations?ticker=${encodeURIComponent(ticker)}`, { signal })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null)
  const items: Array<Record<string, unknown>> = json?.data?.items ?? []
  if (!items.length) return null
  const dates = [...new Set(items.map((it) => String(it['expiration-date'] ?? '').slice(0, 10)).filter(Boolean))].sort()
  return dates.find((d) => d === wanted) ?? dates.find((d) => d >= wanted) ?? null
}

interface RawSide { gamma?: unknown; volume?: unknown; 'open-interest'?: unknown; openInterest?: unknown }

async function loadTicker(ticker: string, basis: GexBasis, wantedExpiry: string, signal: AbortSignal): Promise<TickerGex | null> {
  const expiration = await resolveExpiration(ticker, wantedExpiry, signal)
  if (!expiration) return null
  const json = await fetch(`/api/chains?ticker=${encodeURIComponent(ticker)}&expiration=${encodeURIComponent(expiration)}&range=all`, { signal })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null)
  const data = json?.data as Record<string, unknown> | undefined
  const items = (data?.items as unknown[]) ?? []
  const spot = num(data?.underlyingPrice)
  if (!items.length || !(spot > 0)) return null
  const groups = (items as { 'expiration-date'?: string; strikes?: unknown[] }[]).filter(
    (g) => String(g['expiration-date'] ?? '').slice(0, 10) === expiration.slice(0, 10))
  const useGroups = groups.length ? groups : (items as { strikes?: unknown[] }[])
  const acc = new Map<number, OffsetGex>()
  for (const group of useGroups) {
    for (const item of group.strikes ?? []) {
      const it = item as Record<string, unknown>
      const strike = num(it['strike-price'])
      if (!strike) continue
      const c = it.call as RawSide | undefined
      const p = it.put as RawSide | undefined
      const posOf = (o: RawSide | undefined): number => {
        if (!o) return 0
        const oi = basis === 'vol-only' ? 0 : num(o['open-interest'] ?? o.openInterest)
        return oi + num(o.volume)
      }
      const callPos = posOf(c), putPos = posOf(p)
      if (callPos === 0 && putPos === 0) continue
      const netGEX = Math.abs(num(c?.gamma)) * callPos * spot * spot - Math.abs(num(p?.gamma)) * putPos * spot * spot
      acc.set(strike, { strike, netGEX })
    }
  }
  if (!acc.size) return null
  const sorted = [...acc.values()].sort((a, b) => a.strike - b.strike)
  let atmIdx = 0, best = Infinity
  sorted.forEach((r, i) => { const d = Math.abs(r.strike - spot); if (d < best) { best = d; atmIdx = i } })
  const map: OffsetGexMap = {}
  const lo = Math.max(0, atmIdx - SIDE_STRIKES), hi = Math.min(sorted.length - 1, atmIdx + SIDE_STRIKES)
  for (let i = lo; i <= hi; i++) map[i - atmIdx] = sorted[i]
  return { map, spot, atmStrike: sorted[atmIdx].strike, expiration }
}

export function useDualTickerGex(tickers: readonly string[], basis: GexBasis, expiration: string, refreshMs = 60_000, enabled = true) {
  const [data, setData] = useState<DualTickerGex>({})
  const cycle = `${expiration}|${basis}|${tickers.join(',')}`
  useEffect(() => {
    if (!enabled || !expiration) return
    const list = tickers.filter(Boolean)
    if (!list.length) return
    const ctrl = new AbortController()
    let cancelled = false
    const run = async () => {
      const results = await Promise.allSettled(list.map((t) => loadTicker(t.toUpperCase(), basis, expiration, ctrl.signal)))
      if (cancelled || ctrl.signal.aborted) return
      const next: DualTickerGex = {}
      results.forEach((res, i) => { if (res.status === 'fulfilled' && res.value) next[list[i].toUpperCase()] = res.value })
      setData(next)
    }
    run()
    const id = refreshMs > 0 ? setInterval(run, refreshMs) : null
    return () => { cancelled = true; ctrl.abort(); if (id) clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycle, refreshMs, enabled])
  return data
}
