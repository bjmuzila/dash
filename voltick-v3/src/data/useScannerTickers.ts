// ─────────────────────────────────────────────────────────────────────────────
// The live scanner universe, from GET /proxy/scanner-tickers.
//
// `scannerTickers.ts` deliberately carries no React and no hook — server code
// imports its constants — and its header already says "prefer useScannerTickers()
// at runtime". This is that hook; v3 did not have one, so every picker was stuck
// on the build-time fallback and a ticker added on the owner Watchlists page
// never appeared without a redeploy.
//
// The static list stays the FIRST PAINT and the failure mode: a dead proxy
// degrades to a stale picker rather than an empty one, which is the difference
// between "this list is a bit behind" and "this feature is broken".
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'
import { SCANNER_TICKERS } from './scannerTickers'

export interface ScannerTickers {
  tickers: string[]
  loading: boolean
  /** True once the server's own list has replaced the fallback. */
  live: boolean
}

export function useScannerTickers(fallback: string[] = SCANNER_TICKERS): ScannerTickers {
  const [tickers, setTickers] = useState<string[]>(fallback)
  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/proxy/scanner-tickers', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { tickers?: unknown }) => {
        if (cancelled) return
        const list = Array.isArray(j?.tickers) ? j.tickers : []
        const clean = list.map((t: unknown) => String(t).trim().toUpperCase()).filter(Boolean)
        if (clean.length) {
          setTickers([...new Set<string>(clean)])
          setLive(true)
        }
      })
      .catch(() => {
        /* keep the fallback */
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { tickers, loading, live }
}
