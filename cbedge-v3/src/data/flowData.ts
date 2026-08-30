// ─────────────────────────────────────────────────────────────────────────────
// /flow — the REST side.
//
// Four of the five hooks here could not be a plain useQuery, and the reasons
// are worth stating because each one is a bug v2 already paid for:
//
//   useFlowHistory     two-stage (a small slice paints, the full session
//                      replaces it) with an ordering guard, and a debounce that
//                      does NOT apply to the first run.
//   useNetPremBins     incremental `?since` with a merge, plus a sessionStorage
//                      warm start keyed on the exact filter querystring.
//   useContractStats   grouped by (ticker, expiry) over the VISIBLE rows, and
//                      merged rather than replaced.
//   useLiveSpots       two sources, second as fallback, merged not replaced.
//
// useCombinedHistory and usePremSplit are ordinary polls and do go through
// useQuery.
//
// None of this touches the socket — that is `flow` via useFrame, in the page.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@/data/api'
import type { FlowTapePrint } from '@/contract/frames'
import {
  BIN_SEC,
  CHART_MIN_PREMIUM,
  NETBINS_CACHE_KEY,
  NET_LATE_SEC,
  normTicker,
  type FlowFilters,
  type NetBin,
  type PremSplit,
  type Scope,
} from '@/data/flowMath'

// ── Shared query building ────────────────────────────────────────────────────

function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    sp.set(k, String(v))
  }
  return sp.toString()
}

/**
 * The filter half of a /proxy/flow-netprem or /proxy/flow-premsplit query.
 * One function so the chart, the split and the tape cannot drift apart about
 * what a filter means — the same reason the server has one
 * buildFlowPrintsWhere().
 */
function filterParams(f: FlowFilters): Record<string, string | number | undefined> {
  return {
    side: f.side !== 'all' ? f.side : undefined,
    type: f.optType !== 'all' ? f.optType : undefined,
    expiry: f.expiry !== 'all' ? f.expiry : undefined,
    dteMin: f.dteMin > 0 ? f.dteMin : undefined,
    dteMax: f.dteMax ?? undefined,
    otmOnly: f.otmOnly ? 1 : undefined,
  }
}

interface FlowHistoryResponse { date: string; tape: FlowTapePrint[] }
interface NetPremResponse { date: string; binSec: number; partial: boolean; bins: NetBin[] }
interface PremSplitResponse { date: string; split: PremSplit | null }

// ── Per-ticker session backfill ──────────────────────────────────────────────

/**
 * The active ticker's whole session.
 *
 * Per-ticker rather than a bare newest-N, because with the full roster
 * recording an unfiltered cap drops a single ticker's early prints — it looks
 * like "history starts at 11am", with no error.
 *
 * Two-stage: `limit=1000` newest-first paints the tape immediately, then
 * `limit=20000` lands behind it and replaces the slice. The `full` flag guards
 * the ordering — if the big pull wins the race, the small one is stale and must
 * not clobber it.
 *
 * `minPremium` is pushed to SQL so the server's 20k cap keeps the BIGGEST
 * prints across the whole session rather than the most recent slice.
 */
export function useFlowHistory(
  active: string,
  date: string,
  minPremium: number,
  enabled: boolean,
): { tape: FlowTapePrint[]; switching: boolean } {
  const [tape, setTape] = useState<FlowTapePrint[]>([])
  const [switching, setSwitching] = useState(false)
  // The first run fires immediately: the 400ms debounce exists for slider
  // drags, and paying it on mount just delays first paint for nothing.
  const firstRunRef = useRef(true)

  useEffect(() => {
    if (!enabled) {
      setSwitching(false)
      return
    }
    let cancelled = false
    setSwitching(true)

    const base = qs({ underlying: active, date, minPremium: minPremium > 0 ? minPremium : undefined })
    const pull = (limit: number) =>
      fetch(`/proxy/flow-history?${base}&limit=${limit}`, { credentials: 'same-origin' })
        .then((r) => (r.ok ? (r.json() as Promise<FlowHistoryResponse>) : null))

    let full = false
    const run = () => {
      void pull(1000)
        .then((j) => {
          if (cancelled || full) return
          if (j && Array.isArray(j.tape)) setTape(j.tape)
          setSwitching(false)
        })
        .catch(() => {
          if (!cancelled && !full) setSwitching(false)
        })
      void pull(20000)
        .then((j) => {
          if (cancelled) return
          full = true
          if (j && Array.isArray(j.tape)) setTape(j.tape)
          setSwitching(false)
        })
        .catch(() => {
          if (!cancelled) setSwitching(false)
        })
    }

    const wasFirst = firstRunRef.current
    firstRunRef.current = false
    const kick = setTimeout(run, wasFirst ? 0 : 400)
    return () => {
      cancelled = true
      clearTimeout(kick)
    }
  }, [active, date, minPremium, enabled])

  return { tape, switching }
}

// ── Combined (all tickers) day backfill ──────────────────────────────────────

/**
 * The whole day's tape for every ticker. Display only — 2k rows is plenty for a
 * table that renders 800, and the totals come from the SQL split below rather
 * than from summing this.
 */
export function useCombinedHistory(
  date: string,
  minPremium: number,
  isToday: boolean,
  enabled: boolean,
): FlowTapePrint[] {
  const url = enabled
    ? `/proxy/flow-history?${qs({ limit: 2000, date, minPremium: minPremium > 0 ? minPremium : undefined })}`
    : null
  const q = useQuery<FlowHistoryResponse>(url, {
    staleMs: 4_000,
    // Past sessions are immutable — only the live edge needs advancing.
    ...(isToday ? { pollMs: 15_000 } : {}),
  })
  return q.data?.tape ?? []
}

// ── Combined premium split ───────────────────────────────────────────────────

/**
 * Buy/sell × call/put over the FULL filtered session, aggregated in SQL.
 *
 * `underlying=ALL` is REQUIRED and is not decoration: server-v2's
 * parseFlowFilters() defaults a missing ?underlying to SPX, so a Combined
 * request that omitted it silently got SPX-only totals back under an
 * "All Tickers" heading — for the four split cards AND for the tape header's
 * count / Total / Calls / Puts, which prefer this response. Same for
 * `exIdx`, which the server ignored entirely until it was wired up.
 */
export function usePremSplit(
  date: string,
  scope: Scope,
  f: FlowFilters,
  isToday: boolean,
  enabled: boolean,
): PremSplit | null {
  const url = enabled
    ? `/proxy/flow-premsplit?${qs({
        date,
        underlying: 'ALL',
        exIdx: scope === 'exIdx' ? 1 : undefined,
        minPremium: f.minPremium > 0 ? f.minPremium : undefined,
        minSize: f.minSize > 0 ? f.minSize : undefined,
        ...filterParams(f),
      })}`
    : null
  const q = useQuery<PremSplitResponse>(url, {
    staleMs: 6_000,
    ...(isToday ? { pollMs: 15_000 } : {}),
  })
  return q.data?.split ?? null
}

// ── Net-drift bins ───────────────────────────────────────────────────────────

function readNetBinsCache(key: string): NetBin[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(NETBINS_CACHE_KEY)
    if (!raw) return null
    const j = JSON.parse(raw)
    return j && j.key === key && Array.isArray(j.bins) ? (j.bins as NetBin[]) : null
  } catch {
    return null
  }
}

function writeNetBinsCache(key: string, bins: NetBin[]): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(NETBINS_CACHE_KEY, JSON.stringify({ key, bins }))
  } catch {
    /* quota — a lost warm start costs one paint, not correctness */
  }
}

/**
 * Per-minute net premium + contract volume for one ticker, aggregated in SQL
 * over the WHOLE session — so the chart spans the full grid even when a busy
 * ticker's raw-row backfill is capped.
 *
 * The premium floor here is CHART_MIN_PREMIUM and NOT the tape's slider: see
 * the constant. Every other filter is tracked, so the chart still moves with
 * the filter panel.
 *
 * Two mechanisms on top of a plain poll:
 *
 *  • WARM START. `sessionStorage` holds the last payload, keyed on the exact
 *    filter querystring, so a revisit paints instantly from stale bins while
 *    the fetch refreshes behind it. Stale-by-hours is fine — the first poll
 *    pulls everything from the cached edge forward. Keyed on the querystring so
 *    a different ticker/date/filter can never show the wrong session.
 *
 *  • INCREMENTAL. Once a key has bins, later polls ask only for the live edge.
 *    The overlap is widened to at least NET_LATE_SEC of wall clock to match the
 *    server's own late-print re-scan; a narrow `since` would throw away exactly
 *    the bins the server just went and fetched.
 */
export function useNetPremBins(
  active: string,
  date: string,
  isToday: boolean,
  f: FlowFilters,
  enabled: boolean,
): { bins: NetBin[]; switching: boolean } {
  const [bins, setBins] = useState<NetBin[]>([])
  const [switching, setSwitching] = useState(false)
  const keyRef = useRef('')
  const binsRef = useRef<NetBin[]>([])

  const key = useMemo(
    () =>
      qs({
        underlying: active,
        bin: BIN_SEC,
        date,
        minPremium: CHART_MIN_PREMIUM,
        ...filterParams(f),
      }),
    [active, date, f],
  )

  useEffect(() => {
    if (!enabled) {
      setSwitching(false)
      return
    }
    let cancelled = false

    if (keyRef.current !== key) {
      const cached = readNetBinsCache(key)
      if (cached) {
        keyRef.current = key
        binsRef.current = cached
        setBins(cached)
        setSwitching(false)
      } else {
        setSwitching(true)
      }
    }

    const load = () => {
      const prev = keyRef.current === key ? binsRef.current : []
      const nowSec = Math.floor(Date.now() / 1000)
      const last = prev[prev.length - 1]
      const since =
        isToday && last ? Math.min(last.sec - 2 * BIN_SEC, nowSec - NET_LATE_SEC) : null

      fetch(`/proxy/flow-netprem?${key}${since != null ? `&since=${since}` : ''}`, {
        credentials: 'same-origin',
      })
        .then((r) => (r.ok ? (r.json() as Promise<NetPremResponse>) : null))
        .then((j) => {
          if (cancelled) return
          if (j && Array.isArray(j.bins)) {
            const merged =
              since != null ? [...prev.filter((b) => b.sec < since), ...j.bins] : j.bins
            keyRef.current = key
            binsRef.current = merged
            setBins(merged)
            writeNetBinsCache(key, merged)
          }
          setSwitching(false)
        })
        .catch(() => {
          if (!cancelled) setSwitching(false)
        })
    }

    load()
    const id = isToday ? setInterval(load, 5000) : null
    return () => {
      cancelled = true
      if (id) clearInterval(id)
    }
  }, [key, isToday, enabled])

  return { bins, switching }
}

// ── Per-contract Vol / OI / IV ───────────────────────────────────────────────

export interface ContractStat {
  vol: number | null
  oi: number | null
  /** Decimal from the API (0.184) — callers own the ×100 for display. */
  iv: number | null
  mark: number | null
}

type StatsMap = Record<string, Record<string, ContractStat>>

const STATS_POLL_MS = 20_000
/** Mirrors CONTRACT_STATS_MAX_GROUPS server-side; asking for more is truncated. */
const MAX_GROUPS = 16

export interface StatsInput {
  underlying?: string
  expiration?: string
  strike: number
  type: 'C' | 'P'
}

/**
 * Live Vol / OI / IV per contract, for the tape's three chain columns.
 *
 * A tape print carries only what was true at PRINT time. "What is this contract
 * doing right now" needs a live chain lookup, and doing that per row would be
 * hundreds of calls — so this sends GROUPS, one (ticker, expiry) pair per
 * distinct expiry on screen, and joins the response client-side. Most tapes
 * collapse to a handful of groups.
 *
 * Groups are RANKED by how many rows want each one, so the MAX_GROUPS cap drops
 * the long tail of one-off expiries rather than an arbitrary slice.
 *
 * The response is MERGED, never replaced: a group that scrolls off keeps its
 * last-known values, so scrolling back does not flash an em dash. A failed poll
 * leaves prior stats in place for the same reason.
 */
export function useContractStats(rows: readonly StatsInput[], enabled = true) {
  const [stats, setStats] = useState<StatsMap>({})

  const groupKey = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of rows) {
      const root = normTicker(r.underlying)
      if (!root || !r.expiration) continue
      const k = `${root}:${r.expiration}`
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_GROUPS)
      .map(([k]) => k)
      .sort()
      .join(',')
  }, [rows])

  useEffect(() => {
    if (!enabled || !groupKey) return
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch(`/proxy/contract-stats?groups=${encodeURIComponent(groupKey)}`, {
          credentials: 'same-origin',
        })
        if (!r.ok) return
        const j = await r.json()
        if (!cancelled && j?.stats) setStats((prev) => ({ ...prev, ...j.stats }))
      } catch {
        /* leave prior stats in place — a failed poll must not blank the tape */
      }
    }
    const kick = setTimeout(load, 200)
    const id = setInterval(load, STATS_POLL_MS)
    return () => {
      cancelled = true
      clearTimeout(kick)
      clearInterval(id)
    }
  }, [groupKey, enabled])

  return useMemo(() => {
    return (row: StatsInput): ContractStat | null => {
      const root = normTicker(row.underlying)
      if (!root || !row.expiration) return null
      const group = stats[`${root}|${row.expiration}`]
      if (!group) return null
      return group[`${row.strike}|${row.type}`] ?? null
    }
  }, [stats])
}

/**
 * Live underlying spot per ticker, for the % OTM column.
 *
 * A print's own `spot` is frozen at print time, so a strike that has since gone
 * ITM would still read as OTM without this. Theta /proxy/quotes first, the
 * Yahoo-backed /api/quotes-batch as the fallback. Only tickers actually on
 * screen are fetched.
 */
export function useLiveSpots(tickers: readonly string[], enabled = true): Record<string, number> {
  const [spots, setSpots] = useState<Record<string, number>>({})
  const key = useMemo(() => [...new Set(tickers.filter(Boolean))].sort().join(','), [tickers])

  useEffect(() => {
    if (!enabled || !key) return
    let cancelled = false

    const parse = (items: Array<Record<string, unknown>>) => {
      const map: Record<string, number> = {}
      for (const q of items) {
        const last = Number(q.last)
        const sym = String(q.symbol ?? '').toUpperCase()
        if (sym && last > 0) map[sym] = last
      }
      return map
    }
    const apply = (map: Record<string, number>) => {
      if (!cancelled && Object.keys(map).length) setSpots((prev) => ({ ...prev, ...map }))
    }
    const load = async () => {
      try {
        const r = await fetch(`/proxy/quotes?symbols=${encodeURIComponent(key)}`, {
          credentials: 'same-origin',
        })
        if (!r.ok) throw new Error('proxy/quotes failed')
        const d = await r.json()
        apply(parse(d?.data?.items ?? []))
      } catch {
        try {
          const r = await fetch(`/api/quotes-batch?symbols=${encodeURIComponent(key)}`, {
            credentials: 'same-origin',
          })
          if (!r.ok) return
          const d = await r.json()
          apply(parse(d?.data?.items ?? []))
        } catch {
          /* keep prior spots */
        }
      }
    }
    const kick = setTimeout(load, 200)
    const id = setInterval(load, 15_000)
    return () => {
      cancelled = true
      clearTimeout(kick)
      clearInterval(id)
    }
  }, [key, enabled])

  return spots
}

// ── Local 1-minute bars, for the dislocation-velocity read ───────────────────

export interface MinuteBar {
  high: number
  low: number
  close: number
  min: number
}

/**
 * Build 1-minute OHLC in state from a live price.
 *
 * Deliberately isolated from any shared candle store so it can never touch the
 * 5-minute bars. Coarse — roughly one sample per tick — which is fine for the
 * dislocation-velocity impulse read and would not be for a chart.
 */
export function useMinuteBars(price: number | undefined, maxBars = 90): MinuteBar[] {
  const [bars, setBars] = useState<MinuteBar[]>([])
  const curRef = useRef<MinuteBar | null>(null)

  useEffect(() => {
    if (!(price && price > 0)) return
    const min = Math.floor(Date.now() / 60000)
    const c = curRef.current
    if (!c || c.min !== min) {
      // Minute rollover — seal the previous bar, open a new one.
      const next: MinuteBar = { high: price, low: price, close: price, min }
      curRef.current = next
      setBars((b) => [...(c ? [...b, c] : b), next].slice(-maxBars))
    } else {
      // Same minute — extend the range.
      c.high = Math.max(c.high, price)
      c.low = Math.min(c.low, price)
      c.close = price
      setBars((b) => (b.length ? [...b.slice(0, -1), { ...c }] : [{ ...c }]))
    }
  }, [price, maxBars])

  return bars
}
