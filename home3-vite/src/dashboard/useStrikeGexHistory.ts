import { useEffect, useState } from 'react'

// Ported verbatim from hooks/useStrikeGexHistory.ts.
/** Per-strike net GEX baselines keyed by age bucket ("open" | "5" | "15" | "30"). */
export type GexBaselines = Record<number, Record<string, number>>

interface PointResponse { mode?: string; ages?: number[]; baselines?: GexBaselines }

export function useStrikeGexHistory(expiry: string, ages: number[] = [5, 15, 30], pollMs = 30_000, tolerant = false): GexBaselines {
  const [baselines, setBaselines] = useState<GexBaselines>({})
  const agesKey = ages.join(',')
  useEffect(() => {
    if (!expiry) { setBaselines({}); return }
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch(`/proxy/gex-history?expiry=${encodeURIComponent(expiry)}&ages=${encodeURIComponent(agesKey)}${tolerant ? '&tolerant=1' : ''}`, { cache: 'no-store' })
        if (!r.ok) return
        const json: PointResponse = await r.json()
        if (cancelled) return
        setBaselines(json?.baselines ?? {})
      } catch { /* ignore — falls back to no ghosts */ }
    }
    load()
    const id = setInterval(load, pollMs)
    return () => { cancelled = true; clearInterval(id) }
  }, [expiry, agesKey, pollMs, tolerant])
  return baselines
}
