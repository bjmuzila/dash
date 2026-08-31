import { useMemo } from 'react'
import { CardToolbar } from '@/design/primitives/Card'
import { useFrame } from '@/data/hooks'
import { usePageSymbol } from '@/data/symbol'
import type { FlowFrame, FlowTapePrint } from '@/contract/frames'
import { useFlowHistory, useNetPremBins } from '@/data/flowData'
import {
  BIN_SEC,
  CHART_MIN_PREMIUM,
  buildNetSeries,
  buildSpotSeries,
  fmtPremium,
  fmtSpot,
  mergeTape,
  normTicker,
  todayYmdET,
  type FlowFilters,
} from '@/data/flowMath'
import { NetDriftChart } from '@/pages/flow/NetDriftChart'
import { fmtContractDate } from '../cardTitle'

// ─────────────────────────────────────────────────────────────────────────────
// NET PREMIUM — the /flow page's Net Drift chart, as a board card.
//
// Cumulative net CALL premium against cumulative net PUT premium, one point per
// minute, the minute's contract volume docked underneath and the underlying's
// own path drawn behind it. Same chart component the page mounts
// (pages/flow/NetDriftChart.tsx) and the same server aggregate behind it
// (/proxy/flow-netprem), so the card and the page can never disagree about what
// a minute's net premium was.
//
// Three deliberate narrowings versus the page:
//
//   1. THE CLOSEST EXPIRATION ONLY. The page lets you pick an expiry or a DTE
//      window; the card is always the front one. A board card is a glance, and
//      a drift line that sums every expiry on the board answers a question
//      nobody asked it.
//   2. OTM ONLY. Both sides. In-the-money premium is mostly intrinsic value
//      changing hands, which drifts with spot rather than with positioning and
//      swamps the line it is drawn next to.
//   3. RTH span, no toggle. The page's 24H switch is a lookback tool.
//
// ── Why this fetches the tape before it fetches the chart ────────────────────
// Non-negotiable 3 says a route fires everything in parallel at entry, and this
// is the one place that cannot: "the closest expiration" is not knowable until
// something has said which expirations this ticker HAS. The tape is that
// something, and the card needs it anyway for the hover list and the spot
// overlay — so it is one hop, not a waterfall of convenience. The bins request
// stays disabled until the expiry is known rather than firing an unscoped one
// that would have to be thrown away.
//
// ── The ticker ───────────────────────────────────────────────────────────────
// Follows the board's page symbol. Flow IS recorded per ticker
// (/proxy/flow-history?underlying=…), so unlike the socket's `flow` frame this
// card is not SPX-only. A ticker the recorder has never seen gets an honest
// "not available" rather than an empty grid that looks like a quiet day.
// ─────────────────────────────────────────────────────────────────────────────

export function NetPremiumCard() {
  const { symbol } = usePageSymbol()
  const active = normTicker(symbol)
  const date = todayYmdET()

  // The tape. Floored at the chart's own noise floor, not the page's slider —
  // this card has no slider and the drift line is meant to carry everything.
  const { tape: history, switching: historySwitching } = useFlowHistory(
    active, date, CHART_MIN_PREMIUM, true,
  )

  // Live prints. The socket streams the index only, so for any other ticker the
  // ticker gate below drops them and the card runs off the REST tape alone.
  const flowFrame = useFrame<FlowFrame>('flow')
  const liveTape = useMemo(() => flowFrame?.data.tape ?? [], [flowFrame])
  const merged = useMemo(() => mergeTape(history, liveTape, true), [history, liveTape])
  const own = useMemo(
    () => merged.filter((o) => normTicker(o.underlying) === active),
    [merged, active],
  )

  /**
   * The closest expiration: today's if this ticker printed one, else the
   * soonest future one, else — for a tape that is entirely in the past — the
   * last one there is. Same rule as the page's 0DTE button.
   */
  const expiry = useMemo(() => {
    const set = new Set<string>()
    for (const o of own) if (o.expiration) set.add(o.expiration)
    const opts = [...set].sort()
    if (!opts.length) return null
    return opts.find((x) => x >= date) ?? opts[opts.length - 1] ?? null
  }, [own, date])

  const filters: FlowFilters = useMemo(
    () => ({
      side: 'all',
      optType: 'all',
      minPremium: 0,
      minSize: 0,
      expiry: expiry ?? 'all',
      dteMin: 0,
      dteMax: null,
      otmOnly: true,
    }),
    [expiry],
  )

  const { bins, switching: binsSwitching } = useNetPremBins(
    active, date, true, filters, expiry != null,
  )

  const series = useMemo(
    () => buildNetSeries(bins, { isToday: true, date, chartSpan: 'rth' }),
    [bins, date],
  )

  // Spot overlay off the UNFILTERED ticker tape: `spot` is the underlying level
  // and is identical on every print in a minute, so narrowing it by expiry or
  // moneyness would only thin the line for no gain.
  const spotSeries = useMemo(
    () => buildSpotSeries(own, { openSec: series.openSec, closeSec: series.closeSec }),
    [own, series.openSec, series.closeSec],
  )

  // The hover list, indexed by minute, biggest premium first — narrowed to the
  // same prints the line is drawn from so the tooltip explains the chart rather
  // than sitting beside it.
  const ordersByMin = useMemo(() => {
    const idx = new Map<number, FlowTapePrint[]>()
    for (const o of own) {
      if (!o.isOtm) continue
      if (expiry && o.expiration !== expiry) continue
      const minSec = Math.floor(o.ts / 1000 / BIN_SEC) * BIN_SEC
      const arr = idx.get(minSec)
      if (arr) arr.push(o)
      else idx.set(minSec, [o])
    }
    for (const arr of idx.values()) arr.sort((a, b) => (b.premium || 0) - (a.premium || 0))
    return idx
  }, [own, expiry])

  // The tape has been asked and came back with nothing for this ticker. Only
  // once it has SETTLED — useFlowHistory reports `switching` from its very
  // first render, so this cannot flash on the way in.
  const unavailable = !historySwitching && own.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CardToolbar>
        <span className="text-2xs font-bold uppercase tracking-[0.08em] text-muted">
          OTM · closest expiry
        </span>
        <span className="tabular text-2xs font-semibold text-accent">
          {active}
          {expiry ? ` · ${fmtContractDate(expiry)}` : ''}
        </span>
      </CardToolbar>

      {unavailable ? (
        <p className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-sm text-muted">
          {active} — not available. Coming soon.
        </p>
      ) : (
        <div
          className={[
            'flex min-h-0 flex-1 flex-col',
            historySwitching || binsSwitching ? 'stale' : '',
          ].filter(Boolean).join(' ')}
        >
          <div className="flex flex-wrap items-center justify-center gap-4 pb-2 text-xs font-semibold">
            <span className="text-up">● Calls {fmtPremium(series.lastCall)}</span>
            <span className="text-down">● Puts {fmtPremium(series.lastPut)}</span>
            <span className="text-muted">Net {fmtPremium(series.lastCall + series.lastPut)}</span>
            {spotSeries.last > 0 && (
              <span className="text-muted">
                <span className="opacity-40">─</span> {active} {fmtSpot(spotSeries.last)}
              </span>
            )}
          </div>
          {/* MUST be a flex column: NetDriftChart's root is `flex-1 min-h-0`,
              and so is the ChartFrame element lightweight-charts autoSizes to.
              In a plain block wrapper both resolve to auto height, the canvas
              collapses to a sliver and the drift lines render as a flat smear
              across the top of the card. */}
          <div className="flex min-h-0 flex-1 flex-col">
            <NetDriftChart series={series} ordersByMin={ordersByMin} spotPts={spotSeries.pts} />
          </div>
          {!series.hasData && (
            <p className="pt-2 text-center text-xs text-muted">
              {expiry
                ? `No ${active} OTM flow yet for ${fmtContractDate(expiry)}.`
                : 'Waiting for the first print…'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
