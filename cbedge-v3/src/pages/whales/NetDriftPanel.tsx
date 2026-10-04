import { useMemo, useState } from 'react'
import { SegGroup } from '@/design/primitives/Controls'
import { useFrame } from '@/data/hooks'
import type { FlowFrame, FlowTapePrint } from '@/contract/frames'
import { useFlowHistory, useNetPremBins, useNetPremBoard, type NetPremBoardRow } from '@/data/flowData'
import {
  BIN_SEC,
  DEFAULT_MIN_PREMIUM,
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
//
// ── LSE + SCANNER UNIVERSE (2026-10-03, Brandon — option D) ──────────────────
// The numbers here are now the LSE-BLENDED net (`source=lse`): every $50K+
// print from LSE, signed by api-router's quote classification or by the
// matching Tasty print, and the band under $50K from Tasty. See LSE-BLENDED
// NET PREMIUM in server-with-proxy.js for the exact rules. /v3/flow is still
// Tasty-only, so the two pages can differ by the prints LSE caught that Tasty
// did not.
//
// The dropdown is replaced by a LEADERBOARD over the whole scanner universe
// (the server resolves the roster), ranked by |net|, with the chart under it
// for whichever row you click. Today only — the server keeps nothing new, and
// the date rolls the cache over at midnight ET.
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

const signInk = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-fg')
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtPremium(Math.abs(v))}`

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

  const { bins: netBins, switching } = useNetPremBins(active, date, isToday, FILTERS, true, 'lse')
  const board = useNetPremBoard(FILTERS, date, true)
  const ranked = useMemo<NetPremBoardRow[]>(
    () => (board.data?.tickers ?? []).slice().sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.ticker.localeCompare(b.ticker)),
    [board.data],
  )
  const maxAbs = useMemo(() => Math.max(1, ...ranked.map((r) => Math.abs(r.net))), [ranked])
  const lseShare = useMemo(() => {
    const row = ranked.find((r) => r.ticker === active)
    return row ? Math.round(row.lseShare * 100) : null
  }, [ranked, active])
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
        <h2 className="text-2xs font-bold uppercase tracking-[0.11em] text-fg">Net Drift (Premium)</h2>
        <span
          className={[
            'rounded-sm border px-1.5 py-px text-3xs font-bold tracking-[0.08em]',
            board.data && !board.data.lse ? 'border-line text-fg' : 'border-accent/50 bg-accent/10 text-accent',
          ].join(' ')}
          title={
            board.data && !board.data.lse
              ? 'No LSE data on the server — every number here is the Tasty tape'
              : `$50K+ prints from LSE, the band under it from Tasty${lseShare != null ? ` · ${active}: ${lseShare}% of counted premium is LSE` : ''}`
          }
        >
          {board.data && !board.data.lse ? 'TASTY' : 'LSE'}
        </span>
        <span className="text-3xs text-fg">today · resets midnight</span>
        {switching && <span className="text-2xs text-fg">loading…</span>}
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
      {/* ── LEADERBOARD ────────────────────────────────────────────────────
          The scanner universe ranked by |net|. Click a row to chart it. */}
      <div className={['overflow-auto border-b border-line', phone ? 'max-h-[200px]' : 'max-h-[232px]'].join(' ')}>
        <table className="w-full table-fixed border-collapse text-xs">
          <colgroup>
            <col className="w-[72px]" />
            <col />
            <col />
            <col className="w-[44%]" />
          </colgroup>
          <thead className="sticky top-0 z-[1] bg-surface">
            <tr className="text-2xs uppercase tracking-[0.09em] text-fg">
              <th className="px-2 py-1.5 text-left font-bold">Ticker</th>
              <th className="px-2 py-1.5 text-right font-bold">Calls</th>
              <th className="px-2 py-1.5 text-right font-bold">Puts</th>
              <th className="px-2 py-1.5 text-left font-bold">Net</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r) => (
              <tr
                key={r.ticker}
                onClick={() => setActive(r.ticker)}
                title={`Chart ${r.ticker}`}
                className={[
                  'cursor-pointer border-t border-line transition-colors',
                  r.ticker === active ? 'bg-raised' : 'hover:bg-raised',
                ].join(' ')}
              >
                <td className="truncate px-2 py-1 font-semibold text-fg">{r.ticker}</td>
                <td className={['tabular px-2 py-1 text-right', signInk(r.callNet)].join(' ')}>{signed(r.callNet)}</td>
                <td className={['tabular px-2 py-1 text-right', signInk(r.putNet)].join(' ')}>{signed(r.putNet)}</td>
                <td className="px-2 py-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={['h-1.5 shrink-0 rounded-full', r.net >= 0 ? 'bg-up' : 'bg-down'].join(' ')}
                      style={{ width: `${Math.max(2, (Math.abs(r.net) / maxAbs) * 60)}%` }}
                    />
                    <span className={['tabular whitespace-nowrap text-2xs font-semibold', signInk(r.net)].join(' ')}>{signed(r.net)}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!ranked.length && (
          <p className="px-3 py-3 text-center text-xs text-fg">
            {board.loading ? 'Loading the scanner universe…' : board.error ? 'Could not load the net premium board.' : 'No flow yet today.'}
          </p>
        )}
      </div>
      <div className={switching ? 'stale flex min-h-0 flex-1 flex-col' : 'flex min-h-0 flex-1 flex-col'}>
        <div className="flex flex-wrap items-center justify-center gap-6 px-3 py-2 text-xs font-semibold">
          <span style={{ color: NET_DRIFT_CALL }}>● Calls {fmtPremium(netSeries.lastCall)}</span>
          <span style={{ color: NET_DRIFT_PUT }}>● Puts {fmtPremium(netSeries.lastPut)}</span>
          <span className="text-fg">Net {fmtPremium(netSeries.lastCall + netSeries.lastPut)}</span>
          {spotSeries.last > 0 && (
            <span className="text-fg">
              <span className="opacity-40">─</span> {active} {fmtSpot(spotSeries.last)}
            </span>
          )}
          {chartSpan === '24h' && netSeries.hasData && (
            <span className="tabular text-fg">
              {fmtEtHm(netSeries.openSec)}–{fmtEtHm(netSeries.closeSec)} ET
            </span>
          )}
        </div>
        {/* Flex column on purpose — see the same note in pages/Flow.tsx. */}
        <div className={['flex w-full flex-col', phone ? 'h-[300px] min-h-[300px]' : 'h-[360px] min-h-[360px]'].join(' ')}>
          <NetDriftChart series={netSeries} ordersByMin={ordersByMin} spotPts={spotSeries.pts} locked />
        </div>
        {!netSeries.hasData && (
          <p className="px-3 pb-3 text-center text-xs text-fg">
            {live ? `No ${active} flow yet today.` : 'Connecting to feed…'}
          </p>
        )}
      </div>
    </div>
  )
}
