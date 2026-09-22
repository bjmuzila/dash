import { useMemo, useState } from 'react'
import { Select, SegGroup } from '@/design/primitives/Controls'
import { useFrame } from '@/data/hooks'
import type { FlowFrame, FlowTapePrint } from '@/contract/frames'
import { useFlowHistory, useNetPremBins } from '@/data/flowData'
import {
  BIN_SEC,
  DEFAULT_MIN_PREMIUM,
  DEFAULT_TICKERS,
  buildNetSeries,
  buildSpotSeries,
  fmtEtHm,
  fmtPremium,
  fmtSpot,
  mergeTape,
  normTicker,
  passesFilters,
  todayYmdET,
  type ChartSpan,
  type FlowFilters,
} from '@/data/flowMath'
import { NET_DRIFT_CALL, NET_DRIFT_PUT } from '@/design/theme'
import { NetDriftChart } from '@/pages/flow/NetDriftChart'

// ─────────────────────────────────────────────────────────────────────────────
// Net Drift on the Whale Archive — the Flow page's drift chart, lifted as-is.
// Same hooks, same maths, same chart component; only the ticker picker is new
// (a dropdown over the Flow watchlist, SPX by default). Filters are fixed at
// the Flow page's defaults, so this chart matches /v3/flow on first load.
// ─────────────────────────────────────────────────────────────────────────────

const FILTERS: FlowFilters = {
  side: 'all',
  optType: 'all',
  minPremium: DEFAULT_MIN_PREMIUM,
  minSize: 0,
  expiry: 'all',
  dteMin: 0,
  dteMax: null,
  otmOnly: true,
}

const TICKER_OPTIONS = DEFAULT_TICKERS.map((t) => ({ value: t as string, label: t as string }))

/**
 * `phone`: shorter chart (320px). The chart is width-locked everywhere — the
 * whole session fits, left-aligned, no sideways pan or zoom.
 *
 * 24H is SPX-only (2026-09-22). SPX options trade the overnight GTH session, so
 * its tape has a pre-open to show; nothing else on the list does, and a 24H
 * toggle on SPY just re-drew RTH. The pick is remembered, but any other ticker
 * reads as RTH and hides the toggle — switching back to SPX restores it.
 */
export function NetDriftPanel({ phone = false }: { phone?: boolean } = {}) {
  const [active, setActive] = useState<string>('SPX')
  const [spanPick, setChartSpan] = useState<ChartSpan>('rth')
  const allows24h = active === 'SPX'
  const chartSpan: ChartSpan = allows24h ? spanPick : 'rth'
  const date = todayYmdET()
  const isToday = true

  const { bins: netBins, switching } = useNetPremBins(active, date, isToday, FILTERS, true)
  const { tape: history } = useFlowHistory(active, date, DEFAULT_MIN_PREMIUM, true)

  const flowFrame = useFrame<FlowFrame>('flow')
  const liveTape = useMemo(() => flowFrame?.data.tape ?? [], [flowFrame])
  const live = !!flowFrame

  const netSeries = useMemo(
    () => buildNetSeries(netBins, { isToday, date, chartSpan }),
    [netBins, isToday, date, chartSpan],
  )
  const spotSeries = useMemo(
    () => buildSpotSeries(netBins, { openSec: netSeries.openSec, closeSec: netSeries.closeSec }),
    [netBins, netSeries.openSec, netSeries.closeSec],
  )

  // Hover index: the active ticker's OTM prints by minute, biggest first.
  const ordersByMin = useMemo(() => {
    const merged = mergeTape(history, liveTape, isToday)
    const idx = new Map<number, FlowTapePrint[]>()
    for (const o of merged) {
      if (normTicker(o.underlying) !== active || !o.isOtm) continue
      if (!passesFilters(o, FILTERS, date)) continue
      const minSec = Math.floor(o.ts / 1000 / BIN_SEC) * BIN_SEC
      const arr = idx.get(minSec)
      if (arr) arr.push(o)
      else idx.set(minSec, [o])
    }
    for (const arr of idx.values()) arr.sort((a, b) => (b.premium || 0) - (a.premium || 0))
    return idx
  }, [history, liveTape, isToday, active, date])

  return (
    <div className="flex min-h-0 flex-col rounded-md border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-2xs font-bold uppercase tracking-[0.11em] text-faint">Net Drift (Premium)</h2>
        <Select
          value={active}
          onChange={setActive}
          ariaLabel="Net drift ticker"
          menuWidth="w-28"
          options={TICKER_OPTIONS}
        />
        {switching && <span className="text-2xs text-faint">loading…</span>}
        {allows24h && (
          <span className="ml-auto">
            <SegGroup<ChartSpan>
              value={chartSpan}
              onChange={setChartSpan}
              options={[
                { label: 'RTH', value: 'rth', title: 'Regular trading hours only (9:30–4:00 ET)' },
                { label: '24H', value: '24h', title: 'Full session — includes pre-open and the overnight global session' },
              ]}
            />
          </span>
        )}
      </div>
      <div className={switching ? 'stale flex min-h-0 flex-1 flex-col' : 'flex min-h-0 flex-1 flex-col'}>
        <div className="flex flex-wrap items-center justify-center gap-6 px-3 py-2 text-xs font-semibold">
          <span style={{ color: NET_DRIFT_CALL }}>● Calls {fmtPremium(netSeries.lastCall)}</span>
          <span style={{ color: NET_DRIFT_PUT }}>● Puts {fmtPremium(netSeries.lastPut)}</span>
          <span className="text-muted">Net {fmtPremium(netSeries.lastCall + netSeries.lastPut)}</span>
          {spotSeries.last > 0 && (
            <span className="text-muted">
              <span className="opacity-40">─</span> {active} {fmtSpot(spotSeries.last)}
            </span>
          )}
          {chartSpan === '24h' && netSeries.hasData && (
            <span className="tabular text-muted">
              {fmtEtHm(netSeries.openSec)}–{fmtEtHm(netSeries.closeSec)} ET
            </span>
          )}
        </div>
        {/* Flex column on purpose — see the same note in pages/Flow.tsx. */}
        <div className={['flex w-full flex-col', phone ? 'h-[320px] min-h-[320px]' : 'h-[420px] min-h-[420px]'].join(' ')}>
          <NetDriftChart series={netSeries} ordersByMin={ordersByMin} spotPts={spotSeries.pts} locked />
        </div>
        {!netSeries.hasData && (
          <p className="px-3 pb-3 text-center text-xs text-muted">
            {live ? `No ${active} flow yet today.` : 'Connecting to feed…'}
          </p>
        )}
      </div>
    </div>
  )
}
