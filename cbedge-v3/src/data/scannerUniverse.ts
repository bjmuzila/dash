// ─────────────────────────────────────────────────────────────────────────────
// THE TICKER UNIVERSE.
//
// Live from /proxy/scanner-tickers (which reads server-v2/scanner-tickers.js),
// falling back to the static SCANNER_TICKERS list on any failure — so a dead
// proxy degrades to a STALE picker rather than an empty one.
//
// Lives in data/ rather than beside a page because the app toolbar's ticker
// dropdown needs it, and that dropdown is mounted on EVERY page.
//
// ── `enabled` is not an optimisation, it is the point ────────────────────────
// The toolbar renders on every route, so an unconditional fetch here is a
// request on the critical path of every page load, for a list nobody sees until
// they open the menu. The static fallback already renders the picker correctly,
// so the live list is fetched on FIRST OPEN and cached from then on.
//
// It also stopped `npm run perf` passing: the mock server answers a subset of
// the API on purpose, so an unconditional toolbar fetch put a 404 on every board
// load, and perf-check counts a failed request as a page error.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'
import { query } from '@/data/api'
import { SCANNER_TICKERS } from '@/data/scannerTickers'

/** Five minutes: the watchlist changes when someone edits a file on the VPS. */
const UNIVERSE_STALE_MS = 300_000

export function useScannerUniverse(enabled = true): string[] {
  const [tickers, setTickers] = useState<string[]>(SCANNER_TICKERS)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void (async () => {
      try {
        const j = await query<{ tickers?: unknown[] }>('/proxy/scanner-tickers', {
          staleMs: UNIVERSE_STALE_MS,
        })
        if (cancelled) return
        const clean = (Array.isArray(j?.tickers) ? j.tickers : [])
          .map((t) => String(t).trim().toUpperCase())
          .filter(Boolean)
        if (clean.length) setTickers([...new Set(clean)])
      } catch {
        /* keep the fallback */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled])
  return tickers
}
