import { useEffect, useMemo, useState } from 'react'
import { Page } from '@/design/primitives/Page'
import { Card } from '@/design/primitives/Card'
import { SegGroup, Chip } from '@/design/primitives/Controls'
import { useFrame } from '@/data/hooks'
import type { FlowFrame, FlowTapePrint } from '@/contract/frames'
import {
  useCombinedHistory,
  useContractStats,
  useFlowHistory,
  useLiveSpots,
  useMinuteBars,
  useNetPremBins,
  usePremSplit,
} from '@/data/flowData'
import { initDV, pushDV } from '@/data/dislocationVelocity'
import {
  BIN_SEC,
  DEFAULT_MIN_PREMIUM,
  DEFAULT_TICKERS,
  INDEX_TICKERS,
  MAX_TAPE_ROWS,
  PREMIUM_MAX,
  PREMIUM_MAX_COMBINED,
  PREMIUM_STEP,
  PREMIUM_STEP_COMBINED,
  buildNetSeries,
  buildSpotSeries,
  fmtEtHm,
  fmtPremium,
  fmtSpot,
  loadRecentTickers,
  mergeTape,
  normTicker,
  passesFilters,
  pushRecentTicker,
  sumTotals,
  todayYmdET,
  totalsFromSplit,
  type ChartSpan,
  type FlowFilters,
  type Scope,
  type SideFilter,
  type TypeFilter,
  type View,
} from '@/data/flowMath'
import { NetDriftChart } from '@/pages/flow/NetDriftChart'
// The tape lives in its own module so the board's Flow Tape card renders the
// SAME table this page does — see the header of pages/flow/FlowTape.tsx.
import { Tape, type Row } from '@/pages/flow/FlowTape'

// ─────────────────────────────────────────────────────────────────────────────
// /v3/flow — the port of v2's /app/flow (components/pages/Flow.tsx).
//
// The spec is docs/parity/flow.md: 214 rows, one per rendered value, and this
// file is finished when every one of them is on screen. The maths, the
// thresholds and the wording were transcribed into src/data/flowMath.ts rather
// than re-derived here — re-deriving from a description is exactly how the
// previous attempt lost the chart, three columns and the whole drawer.
//
// What is deliberately NOT v2:
//   • the socket. Live prints arrive as the `flow` frame through useFrame; this
//     page opens nothing (non-negotiable 2).
//   • the charts. Both go through ChartFrame, honour its visibility signal and
//     tag their canvases (non-negotiables 4, 5, 6).
//   • the palette. Every colour is a token. v2's `C.green` was a LIGHT BLUE and
//     its bullish accent was a hand-typed hex beside it; here bullish is
//     --color-up and that is the end of it.
//
// Known, recorded departures (docs/parity/flow.md, Appendix 1):
//   • the tape status badge has two states, not three — a page that does not own
//     the socket cannot honestly report RECONNECTING.
// ─────────────────────────────────────────────────────────────────────────────

function urlParam(name: string): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(name)
}

export default function Flow() {
  // ?chartonly=1 renders ONLY the Net Drift card — the capture embed.
  // ?ticker= presets the active ticker. ?dteMax= presets Max DTE.
  const [chartOnly] = useState(() => urlParam('chartonly') === '1')

  const [date, setDate] = useState<string>(() => todayYmdET())
  const isToday = date === todayYmdET()

  const [view, setView] = useState<View>('ticker')
  const [scope, setScope] = useState<Scope>('all')

  const [tickerList, setTickerList] = useState<string[]>([...DEFAULT_TICKERS])
  const [active, setActive] = useState<string>(() => {
    const t = urlParam('ticker')
    return t ? t.toUpperCase() : DEFAULT_TICKERS[0]
  })
  const [tickerInput, setTickerInput] = useState('')
  const [recentTickers, setRecentTickers] = useState<string[]>([])
  const [recentOpen, setRecentOpen] = useState(false)
  // Hydrated after mount so a server render and the first client render agree.
  useEffect(() => setRecentTickers(loadRecentTickers()), [])

  const [side, setSide] = useState<SideFilter>('all')
  const [optType, setOptType] = useState<TypeFilter>('all')
  const [minPremium, setMinPremium] = useState<number>(DEFAULT_MIN_PREMIUM)
  const [minSize, setMinSize] = useState<number>(0)
  const [expiry, setExpiry] = useState<string>('all')
  const [dteMin, setDteMin] = useState<number>(0)
  const [dteMax, setDteMax] = useState<number | null>(() => {
    const v = urlParam('dteMax')
    return v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v)
  })
  const [otmOnly, setOtmOnly] = useState(true)
  const [chartSpan, setChartSpan] = useState<ChartSpan>('rth')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const filters: FlowFilters = useMemo(
    () => ({ side, optType, minPremium, minSize, expiry, dteMin, dteMax, otmOnly }),
    [side, optType, minPremium, minSize, expiry, dteMin, dteMax, otmOnly],
  )

  // Switching back to a single ticker clamps the floor to that view's range.
  useEffect(() => {
    if (view === 'ticker' && minPremium > PREMIUM_MAX) setMinPremium(PREMIUM_MAX)
  }, [view, minPremium])

  // ── Data. Everything the active view needs is fired in parallel at entry;
  // the `enabled` flags are how a view's unused feeds are skipped rather than
  // raced (non-negotiable 3). ──
  const { tape: history, switching: historySwitching } = useFlowHistory(
    active, date, minPremium, view === 'ticker',
  )
  const combinedHistory = useCombinedHistory(date, minPremium, isToday, view === 'combined')
  const combinedSplit = usePremSplit(date, scope, filters, isToday, view === 'combined')
  const { bins: netBins, switching: netSwitching } = useNetPremBins(
    active, date, isToday, filters, view === 'ticker',
  )

  const flowFrame = useFrame<FlowFrame>('flow')
  const liveTape = useMemo(() => flowFrame?.data.tape ?? [], [flowFrame])
  // Two states, not v2's three — see the header note.
  const status: 'LIVE' | 'WAITING' = flowFrame ? 'LIVE' : 'WAITING'

  // ── Merge, scope, filter. ──
  const merged = useMemo(() => mergeTape(history, liveTape, isToday), [history, liveTape, isToday])
  const mergedCombined = useMemo(
    () => mergeTape(combinedHistory, liveTape, isToday),
    [combinedHistory, liveTape, isToday],
  )

  const expiryOptions = useMemo(() => {
    const set = new Set<string>()
    for (const o of merged) {
      if (o.underlying && normTicker(o.underlying) === active && o.expiration) set.add(o.expiration)
    }
    return [...set].sort()
  }, [merged, active])

  const combinedExpiryOptions = useMemo(() => {
    const set = new Set<string>()
    for (const o of mergedCombined) {
      if (scope === 'exIdx' && INDEX_TICKERS.has(normTicker(o.underlying))) continue
      if (o.expiration) set.add(o.expiration)
    }
    return [...set].sort()
  }, [mergedCombined, scope])

  /** Active ticker, all filters, OLDEST first — feeds the chart's hover index. */
  const filteredAsc = useMemo(
    () =>
      merged.filter(
        (o) => normTicker(o.underlying) === active && passesFilters(o, filters, date),
      ),
    [merged, active, filters, date],
  )
  const filtered = useMemo(() => [...filteredAsc].reverse(), [filteredAsc])

  const filteredCombined = useMemo(() => {
    const rows = mergedCombined.filter((o) => {
      if (scope === 'exIdx' && INDEX_TICKERS.has(normTicker(o.underlying))) return false
      return passesFilters(o, filters, date)
    })
    return rows.reverse()
  }, [mergedCombined, scope, filters, date])

  const tapeRows = view === 'combined' ? filteredCombined : filtered
  const visibleRows: Row[] = useMemo(
    () => tapeRows.slice(0, MAX_TAPE_ROWS).map((o) => ({ ...o, tickerNorm: normTicker(o.underlying) })),
    [tapeRows],
  )

  // 0DTE = today's expiration if there is one, else the soonest future one.
  const nearestExpiry = useMemo(() => {
    const opts = view === 'combined' ? combinedExpiryOptions : expiryOptions
    if (!opts.length) return null
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    return opts.find((x) => x >= today) ?? opts[opts.length - 1]
  }, [view, combinedExpiryOptions, expiryOptions])

  // ── Live per-contract stats and spots, driven by the VISIBLE rows only: the
  // fetch groups by (ticker, expiry), so this is a few calls however many
  // prints are on screen. ──
  const lookupStat = useContractStats(visibleRows, true)
  const visibleTickers = useMemo(
    () => [...new Set(visibleRows.map((o) => o.tickerNorm).filter(Boolean))],
    [visibleRows],
  )
  const spotByTicker = useLiveSpots(visibleTickers, true)

  // ── Dislocation velocity. A print's own `spot` is the SPX level on every
  // frame, so the newest live print is the freshest source; /proxy/quotes
  // returns last=0 for the SPX index, which is why it is the fallback and not
  // the other way round. ──
  const spxSpotFallback = useLiveSpots(['SPX'], true)
  const liveSpx = useMemo(() => {
    let px = 0
    let ts = 0
    for (const o of liveTape) if (o.spot && o.ts > ts) { ts = o.ts; px = o.spot }
    return px || spxSpotFallback['SPX']
  }, [liveTape, spxSpotFallback])
  const dvBars = useMinuteBars(liveSpx)
  const dv = useMemo(() => {
    let st = initDV()
    let out
    for (const b of dvBars) ({ state: st, out } = pushDV(st, b, { lambda: 0.05, zThresh: 2 }))
    return out
  }, [dvBars])

  // ── Net drift. ──
  const netSeries = useMemo(
    () => buildNetSeries(netBins, { isToday, date, chartSpan }),
    [netBins, isToday, date, chartSpan],
  )

  // Spot overlay for the drift chart. Built from the UNFILTERED active-ticker
  // tape on purpose: `spot` is the underlying level, identical on every print
  // in a minute, so narrowing by premium/DTE would only thin the line out for
  // no gain. Window comes from netSeries so RTH and 24H agree.
  const spotSeries = useMemo(
    () =>
      buildSpotSeries(
        merged.filter((o) => normTicker(o.underlying) === active),
        { openSec: netSeries.openSec, closeSec: netSeries.closeSec },
      ),
    [merged, active, netSeries.openSec, netSeries.closeSec],
  )

  /**
   * The visible tape indexed by minute bucket, biggest first — what the chart
   * hover lists.
   *
   * Built from `filtered` (the ACTIVE-TICKER list) exactly as v2 built it, which
   * has two consequences worth knowing rather than quietly fixing: it respects
   * the tape's Min Premium slider while the line behind it uses the fixed chart
   * floor, and in Combined view it still lists the active ticker's prints. Both
   * are recorded in docs/parity/flow.md, Appendix 1.
   */
  const ordersByMin = useMemo(() => {
    const idx = new Map<number, FlowTapePrint[]>()
    for (const o of filtered) {
      if (!o.isOtm) continue // the tooltip lists OTM prints only
      const minSec = Math.floor(o.ts / 1000 / BIN_SEC) * BIN_SEC
      const arr = idx.get(minSec)
      if (arr) arr.push(o)
      else idx.set(minSec, [o])
    }
    for (const arr of idx.values()) arr.sort((a, b) => (b.premium || 0) - (a.premium || 0))
    return idx
  }, [filtered])

  // ── Totals. Combined prefers the SQL split — exact, over the full filtered
  // session — and falls back to summing the capped tape only while that request
  // is in flight. ──
  const totals = useMemo(
    () => (view === 'combined' && combinedSplit ? totalsFromSplit(combinedSplit) : sumTotals(tapeRows)),
    [view, combinedSplit, tapeRows],
  )

  function resetFilters() {
    setSide('all'); setOptType('all'); setMinPremium(DEFAULT_MIN_PREMIUM); setMinSize(0)
    setExpiry('all'); setDteMin(0); setDteMax(null); setOtmOnly(true)
  }
  function applyBigOtmPreset() {
    setView('combined'); setScope('all')
    setSide('all'); setOptType('all'); setMinSize(0); setExpiry('all')
    setMinPremium(500_000); setDteMin(0); setDteMax(7); setOtmOnly(true)
  }
  const bigOtmActive =
    view === 'combined' && minPremium === 500_000 && dteMin === 0 && dteMax === 7 && otmOnly

  function selectTicker(raw: string) {
    const t = raw.trim().toUpperCase()
    if (!t) return
    setTickerList((prev) => (prev.includes(t) ? prev : [...prev, t]))
    setActive(t)
    setTickerInput('')
    setRecentTickers((prev) => pushRecentTicker(prev, t))
  }

  const combinedLabel = scope === 'exIdx' ? 'All − Indices' : 'All Tickers'
  const tapeLabel = view === 'combined' ? combinedLabel : active
  const premiumMax = view === 'combined' ? PREMIUM_MAX_COMBINED : PREMIUM_MAX
  const premiumStep = view === 'combined' ? PREMIUM_STEP_COMBINED : PREMIUM_STEP

  // ── The Net Drift card, shared by both layouts. Kept MOUNTED in Combined view
  // (hidden, not unmounted) so the once-created chart keeps its instance. ──
  const netDriftCard = (
    <Card
      flush
      className={view !== 'ticker' && !chartOnly ? 'hidden' : undefined}
      title={
        <span>
          Net Drift (Premium) — <span className="text-accent">{active}</span>
          {netSwitching && <span className="ml-2 text-xs text-muted">· loading…</span>}
        </span>
      }
    >
      <div className={netSwitching ? 'stale flex min-h-0 flex-1 flex-col' : 'flex min-h-0 flex-1 flex-col'}>
        <div className="flex flex-wrap items-center justify-center gap-6 px-3 py-2 text-xs font-semibold">
          <span className="text-up">● Calls {fmtPremium(netSeries.lastCall)}</span>
          <span className="text-down">● Puts {fmtPremium(netSeries.lastPut)}</span>
          <span className="text-muted">Net {fmtPremium(netSeries.lastCall + netSeries.lastPut)}</span>
          {spotSeries.last > 0 && (
            <span className="text-muted">
              <span className="opacity-40">─</span> {active} {fmtSpot(spotSeries.last)}
            </span>
          )}
          {!chartOnly && (
            <SegGroup<ChartSpan>
              value={chartSpan}
              onChange={setChartSpan}
              options={[
                { label: 'RTH', value: 'rth', title: 'Regular trading hours only (9:30–4:00 ET)' },
                { label: '24H', value: '24h', title: 'Full session — includes pre-open and the overnight global session' },
              ]}
            />
          )}
        </div>
        {chartSpan === '24h' && netSeries.hasData && (
          <p className="px-3 pb-2 text-center text-xs tabular text-muted">
            {fmtEtHm(netSeries.openSec)}–{fmtEtHm(netSeries.closeSec)} ET
          </p>
        )}
        {/* MUST be a flex column: NetDriftChart's root is `flex-1 min-h-0`, and
            so is the ChartFrame element lightweight-charts autoSizes to. In a
            plain block wrapper both resolve to auto height, the canvas collapses
            to a sliver and the drift lines render as a flat smear at the top of
            the card. */}
        <div className="flex h-[420px] min-h-[420px] w-full flex-col">
          <NetDriftChart series={netSeries} ordersByMin={ordersByMin} spotPts={spotSeries.pts} />
        </div>
        {!netSeries.hasData && (
          <p className="px-3 pb-3 text-center text-xs text-muted">
            {!isToday
              ? `No ${active} flow recorded for ${date}.`
              : status === 'LIVE'
                ? `No ${active} flow yet for the current filters.`
                : 'Connecting to feed…'}
          </p>
        )}
        {view === 'ticker' && !chartOnly && (
          <PremiumSplit totals={totals} caption="(Filtered Tape)" />
        )}
      </div>
    </Card>
  )

  if (chartOnly) {
    return (
      <Page fill>
        <div id="flow-chart-capture" className="flex min-h-0 flex-1 flex-col p-3">
          {netDriftCard}
        </div>
      </Page>
    )
  }

  return (
    <Page title="Options Flow">
      {/* ── View tabs, preset, session date ── */}
      <div className="flex flex-wrap items-center gap-3">
        <SegGroup<View>
          size="touch"
          value={view}
          onChange={setView}
          options={[
            { label: 'By Ticker', value: 'ticker' },
            { label: 'Combined', value: 'combined' },
          ]}
        />
        <Chip
          size="touch"
          label="0–7DTE ≥$500K OTM"
          on={bigOtmActive}
          onClick={applyBigOtmPreset}
          title="Combined · 0–7 DTE · ≥$500K premium · OTM only"
        />
        <div className="flex items-center gap-2">
          <label htmlFor="flow-session" className="text-2xs font-bold uppercase tracking-[0.08em] text-muted">
            Session
          </label>
          <input
            id="flow-session"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value || todayYmdET())}
            className="tabular rounded-sm border border-line bg-surface2 px-2 py-1 text-xs text-fg"
          />
          {!isToday && (
            <>
              <Chip label="Today" on={false} onClick={() => setDate(todayYmdET())} />
              <span className="tabular rounded-sm bg-raised px-2 py-0.5 text-2xs text-accent">
                HISTORICAL
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── Filters ── */}
      <Card
        title="Options Flow — Filters"
        actions={<Chip label="Reset" on={false} onClick={resetFilters} title="Side, type, premium, size, expiry, DTE and moneyness back to defaults" />}
      >
        <p className="mb-3 text-xs text-muted">
          {view === 'combined'
            ? 'Every ticker on one tape. Choose the scope, then filter.'
            : 'Live order flow off the shared feed. Pick a watched ticker to drive the chart + tape.'}
        </p>

        {view === 'combined' ? (
          <Field label="Scope">
            <SegGroup<Scope>
              size="touch"
              value={scope}
              onChange={setScope}
              options={[
                { label: 'All', value: 'all' },
                { label: 'All − Indices', value: 'exIdx' },
              ]}
            />
          </Field>
        ) : (
          <Field label={`Watchlist (${tickerList.length})`}>
            <div className="flex flex-wrap items-center gap-1.5">
              {tickerList.map((t) => (
                <Chip key={t} label={t} on={t === active} onClick={() => selectTicker(t)} />
              ))}
              <input
                list="flow-ticker-suggestions"
                value={tickerInput}
                autoComplete="off"
                spellCheck={false}
                placeholder="+ add ticker"
                onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === 'Enter') selectTicker(tickerInput) }}
                className="w-28 rounded-sm border border-line bg-surface2 px-2 py-0.5 text-2xs uppercase text-fg"
              />
              <datalist id="flow-ticker-suggestions">
                {DEFAULT_TICKERS.map((t) => <option key={t} value={t} />)}
              </datalist>
              <button
                type="button"
                onClick={() => selectTicker(tickerInput)}
                disabled={!tickerInput.trim()}
                className="rounded-sm border border-line px-2 py-0.5 text-2xs font-semibold tracking-wide text-accent disabled:cursor-not-allowed disabled:opacity-45"
              >
                GO
              </button>
              {recentTickers.length > 0 && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setRecentOpen((o) => !o)}
                    // The blur is delayed so the dropdown's own mousedown lands
                    // first — without it the panel closes before the click.
                    onBlur={() => setTimeout(() => setRecentOpen(false), 120)}
                    className="rounded-sm border border-line px-2 py-0.5 text-2xs font-semibold text-muted"
                  >
                    Recent ▾
                  </button>
                  {recentOpen && (
                    <div className="absolute left-0 top-[calc(100%+4px)] z-50 min-w-[120px] overflow-hidden rounded-sm border border-line bg-surface shadow-lg">
                      {recentTickers.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onMouseDown={() => { selectTicker(t); setRecentOpen(false) }}
                          className={[
                            'block w-full px-3 py-1.5 text-left text-xs font-semibold',
                            t === active ? 'bg-raised text-fg' : 'text-muted',
                          ].join(' ')}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Field>
        )}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <Field label="Side">
            <SegGroup<SideFilter>
              size="touch"
              value={side}
              onChange={setSide}
              options={[
                { label: 'ALL', value: 'all' },
                { label: 'BUY', value: 'buy' },
                { label: 'SELL', value: 'sell' },
              ]}
            />
          </Field>

          <Field label="Type">
            <SegGroup<TypeFilter>
              size="touch"
              value={optType}
              onChange={setOptType}
              options={[
                { label: 'ALL', value: 'all' },
                { label: 'CALL', value: 'C' },
                { label: 'PUT', value: 'P' },
              ]}
            />
          </Field>

          <div className="col-span-1 sm:col-span-2">
            <Field
              label={
                <>
                  Min Premium{' '}
                  <span className="text-accent">
                    {minPremium === 0 ? 'Any' : fmtPremium(minPremium)}
                  </span>
                </>
              }
            >
              <input
                type="range"
                min={0}
                max={premiumMax}
                step={premiumStep}
                value={minPremium}
                onChange={(e) => setMinPremium(Number(e.target.value))}
                className="w-full accent-[var(--color-accent)]"
              />
            </Field>
          </div>

          <Field label="Min Size">
            <NumField placeholder="contracts" value={minSize || ''} onChange={(v) => setMinSize(Number(v) || 0)} />
          </Field>

          <Field
            label={
              <>
                Expiry
                <button
                  type="button"
                  disabled={!nearestExpiry}
                  title={nearestExpiry ? `0DTE / nearest expiry: ${nearestExpiry}` : 'no expirations loaded'}
                  onClick={() => {
                    if (!nearestExpiry) return
                    // Toggle off leaves the DTE bounds alone; toggle on clears
                    // them, because an expiry and a DTE window are two ways of
                    // saying the same thing and they fight.
                    if (expiry === nearestExpiry) { setExpiry('all'); return }
                    setExpiry(nearestExpiry); setDteMin(0); setDteMax(null)
                  }}
                  className={[
                    'ml-2 rounded-sm border px-1.5 py-px text-3xs font-semibold',
                    nearestExpiry && expiry === nearestExpiry
                      ? 'border-accent bg-raised text-fg'
                      : 'border-line text-muted disabled:opacity-40',
                  ].join(' ')}
                >
                  0DTE
                </button>
              </>
            }
          >
            <select
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              className="tabular w-full rounded-sm border border-line bg-surface2 px-2 py-1 text-xs text-fg"
            >
              <option value="all">All</option>
              {(view === 'combined' ? combinedExpiryOptions : expiryOptions).map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </Field>

          <Field label="Min DTE">
            <NumField placeholder="days" value={dteMin || ''} onChange={(v) => setDteMin(Number(v) || 0)} />
          </Field>

          <Field label="Max DTE">
            {/* `0` is a real value here (0DTE only) and must not be coerced to
                "unset" — only an empty string means unset. */}
            <NumField
              placeholder="days"
              value={dteMax ?? ''}
              onChange={(v) => setDteMax(v === '' ? null : Number(v))}
            />
          </Field>

          <Field label="Moneyness">
            <SegGroup<'all' | 'otm'>
              size="touch"
              value={otmOnly ? 'otm' : 'all'}
              onChange={(v) => setOtmOnly(v === 'otm')}
              options={[
                { label: 'ALL', value: 'all' },
                { label: 'OTM', value: 'otm' },
              ]}
            />
          </Field>
        </div>
      </Card>

      {netDriftCard}

      {/* ── Dislocation velocity ── */}
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="text-2xs uppercase tracking-[0.08em] text-muted">
              Dislocation Velocity · SPX 1m
            </div>
            <div
              className={[
                'text-3xl font-bold leading-tight tabular',
                dv && dv.velocity > 0 ? 'text-up' : dv && dv.velocity < 0 ? 'text-down' : 'text-muted',
              ].join(' ')}
            >
              {dv ? dv.velocity.toFixed(2) : '—'}
            </div>
          </div>
          <div className="text-right text-xs tabular text-muted">
            <div>
              z {dv ? dv.z.toFixed(1) : '—'} · clv {dv ? dv.clv.toFixed(2) : '—'}
            </div>
            <div
              className={[
                'font-semibold',
                !dv || dv.regime === 'quiet'
                  ? 'text-muted'
                  : dv.regime === 'two-sided'
                    ? 'text-accent'
                    : dv.velocity > 0
                      ? 'text-up'
                      : 'text-down',
              ].join(' ')}
            >
              {dv ? dv.regime : 'building bars…'}
            </div>
          </div>
        </div>
      </Card>

      {view === 'combined' && (
        <Card flush title={<span>Premium Split — <span className="text-accent">{combinedLabel}</span></span>}>
          <PremiumSplit totals={totals} caption="(Full Session — SQL)" />
        </Card>
      )}

      {/* ── Tape ── */}
      <Card flush>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-5">
            <span className="text-sm font-bold uppercase tracking-[0.12em] text-fg">
              Flow Tape — {tapeLabel}
            </span>
            {view === 'ticker' && historySwitching && (
              <span className="text-xs font-semibold text-muted">loading…</span>
            )}
            <span className="text-xs text-muted">
              <strong className="tabular text-fg">{totals.count.toLocaleString()}</strong> orders
            </span>
            <span className="text-xs text-muted">
              Total <strong className="tabular text-fg">{fmtPremium(totals.prem)}</strong>
            </span>
            <span className="text-xs text-muted">
              Calls <strong className="tabular text-up">{fmtPremium(totals.callPrem)}</strong>
            </span>
            <span className="text-xs text-muted">
              Puts <strong className="tabular text-down">{fmtPremium(totals.putPrem)}</strong>
            </span>
          </div>
          <span
            className={[
              'tabular rounded-sm px-2 py-0.5 text-2xs',
              !isToday || status === 'LIVE' ? 'bg-raised text-accent' : 'bg-raised text-down',
            ].join(' ')}
          >
            {isToday ? status : `${date} · HISTORICAL`}
          </span>
        </div>

        <Tape
          rows={visibleRows}
          totalRows={tapeRows.length}
          view={view}
          date={date}
          isToday={isToday}
          status={status}
          label={tapeLabel}
          expandedKey={expandedKey}
          onToggle={setExpandedKey}
          lookupStat={lookupStat}
          spotByTicker={spotByTicker}
        />
      </Card>
    </Page>
  )
}

// ── Small building blocks ────────────────────────────────────────────────────

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-2xs font-bold uppercase tracking-[0.08em] text-muted">{label}</div>
      {children}
    </div>
  )
}

function NumField({
  value, onChange, placeholder,
}: {
  value: number | string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <input
      type="number"
      min={0}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="tabular w-full rounded-sm border border-line bg-surface2 px-2 py-1 text-xs text-fg"
    />
  )
}

/**
 * Buy/sell × call/put, coloured and heat-barred by DIRECTIONAL BIAS — so "sell
 * puts" reads bullish, which is the whole reason this is four tiles and not a
 * two-way split.
 */
function PremiumSplit({
  totals, caption,
}: {
  totals: { buyCall: number; buyPut: number; sellCall: number; sellPut: number }
  caption: string
}) {
  const cards = [
    { label: 'BUY CALLS', value: totals.buyCall, bull: true },
    { label: 'BUY PUTS', value: totals.buyPut, bull: false },
    { label: 'SELL CALL', value: totals.sellCall, bull: false },
    { label: 'SELL PUT', value: totals.sellPut, bull: true },
  ]
  const max = Math.max(1, ...cards.map((c) => c.value))
  return (
    <div className="px-4 pb-4 pt-1">
      <div className="mb-2 text-2xs font-bold uppercase tracking-[0.08em] text-muted">
        Premium Split {caption}
      </div>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {cards.map((c) => {
          // A 2% floor so a zero tile still shows a sliver — an empty track and
          // a missing track look the same and one of them is a bug.
          const pct = Math.max(2, (c.value / max) * 100)
          return (
            <div key={c.label} className="flex flex-col gap-2 rounded-md border border-line bg-surface2 px-3 py-3">
              <div className="flex items-center justify-between">
                <span className="text-2xs font-bold uppercase tracking-[0.08em] text-muted">
                  {c.label}
                </span>
                <span className={['text-2xs font-bold tracking-wide', c.bull ? 'text-up' : 'text-down'].join(' ')}>
                  {c.bull ? '▲ BULL' : '▼ BEAR'}
                </span>
              </div>
              <span className={['text-lg font-bold tabular', c.bull ? 'text-up' : 'text-down'].join(' ')}>
                {fmtPremium(c.value)}
              </span>
              <div className="h-1.5 overflow-hidden rounded-full bg-raised">
                <div
                  className={['h-full rounded-full', c.bull ? 'bg-up' : 'bg-down'].join(' ')}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
