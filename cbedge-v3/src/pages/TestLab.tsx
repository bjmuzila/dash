import { useEffect, useMemo, useState } from 'react'
import { Page } from '@/design/primitives/Page'
import { Card } from '@/design/primitives/Card'
import { SegGroup, Chip } from '@/design/primitives/Controls'
import { useQuery } from '@/data/api'
import type { FlowTapePrint } from '@/contract/frames'

// ─────────────────────────────────────────────────────────────────────────────
// TestLab — replaces v2's /app/test (components/pages/TestLab.tsx).
//
// v2 called this route a tab BAR owned by the global toolbar's sub-strip
// (SectionSubStrip, reading components/shared/sectionNav.ts's TESTLAB_SECTION)
// with the page itself only switching on a `tab` state variable it read back
// out of the URL and a window event. v3's Shell has no such sub-strip yet, so
// the switcher moves onto the page as a plain SegGroup — same tab set, same
// order, same default ("squeeze"), just local `useState` instead of a
// URL-plus-event round trip through a toolbar this app doesn't have.
//
// The tab ORDER below is reconstructed from v2's render chain (the ternary in
// its default export), not from sectionNav.ts, which this port does not have
// source for: Squeeze first (it's the initial tab), then the four tabs moved
// in from /scanner on 2026-08-16, then Condition Rail (added 2026-08-23), then
// the original Test Lab tabs, with Flow Inventory last as the `else` branch.
//
// Only ONE tab's body is real here: Flow Inventory, which lives inline in
// this file in v2 too (SPX/SPY/QQQ options-flow inventory off the same flow
// tape /flow reads — server-v2 /proxy/flow-history, persisted flow_prints
// tagged by `underlying`). Every other tab's body lives in a v2 module too
// large to bring across in one file; each renders as a real Card with its
// real title, naming what still needs porting. See the `// TODO(v3):` above
// each one for the exact v2 symbol.
// ─────────────────────────────────────────────────────────────────────────────

type TestTab =
  | 'squeeze'
  | 'gex'
  | 'gexpct'
  | 'marketquality'
  | 'statprompter'
  | 'condrail'
  | 'dealergamma'
  | 'gexmap'
  | 'premdiff'
  | 'seasonality'
  | 'flow'

const TABS: { label: string; value: TestTab }[] = [
  { label: 'Squeeze', value: 'squeeze' },
  { label: 'GEX Scanner', value: 'gex' },
  { label: 'GEX %', value: 'gexpct' },
  { label: 'Market Quality', value: 'marketquality' },
  { label: 'Stat Prompter', value: 'statprompter' },
  { label: 'Condition Rail', value: 'condrail' },
  { label: 'Dealer Gamma', value: 'dealergamma' },
  { label: 'GEX Map', value: 'gexmap' },
  { label: 'Prem Diff', value: 'premdiff' },
  { label: 'Seasonality', value: 'seasonality' },
  { label: 'Flow Inventory', value: 'flow' },
]

// ── Flow Inventory — types & aggregation ────────────────────────────────────
//
// The wire/REST contract only describes FlowTapePrint's fields as v3 actually
// needs them (src/contract/frames.ts): `type` is 'call' | 'put', `side` a
// free string. v2's local FlowOrder used "P"/"C" and "buy"/"sell" against the
// same underlying data; the checks below read the v3 contract's spelling.

interface FlowHistoryResponse {
  tape?: FlowTapePrint[]
}
interface FlowPanel {
  ticker: string
  data: SymbolData | null
  error: Error | null
  loading: boolean
}

interface Slice {
  label: string
  pct: number
  /** Index into SERIES_CLASSES — see the no-literal-colour note below. */
  seriesIdx: number
}
type Tone = 'bought' | 'sold' | 'highlight'
interface Row {
  label: string
  value: string
  tone?: Tone
}
interface SymbolData {
  symbol: string
  subtitle: string
  date: string
  slices: Slice[]
  bullish: number
  bearish: number
  summary: Row[]
  premium: Row[]
  final30: { label: string; value: string }[]
  atmBets: { label: string; value: string }[]
  filters: string[]
  series: string
  totalPremium: string
  totalPremiumCompact: string
}

// Order requested in v2: SPX, SPY, QQQ.
const FLOW_TICKERS = [
  { ticker: 'SPX', subtitle: 'S&P 500 Index Front Month Options Inventory' },
  { ticker: 'SPY', subtitle: 'SPDR S&P 500 ETF Front Month Options Inventory' },
  { ticker: 'QQQ', subtitle: 'Invesco QQQ Trust Front Month Options Inventory' },
] as const satisfies ReadonlyArray<{ ticker: string; subtitle: string }>

// One Tailwind series token per pie category. Written as literal class names
// (not built with a template string) because Tailwind's scanner only picks up
// classes it can see spelled out in source — a computed `text-series-${n}`
// would never make it into the generated CSS.
const SERIES_CLASSES = [
  { text: 'text-series-1', bg: 'bg-series-1' },
  { text: 'text-series-2', bg: 'bg-series-2' },
  { text: 'text-series-3', bg: 'bg-series-3' },
  { text: 'text-series-4', bg: 'bg-series-4' },
  { text: 'text-series-5', bg: 'bg-series-5' },
] as const

// `satisfies`, not an index signature: a Record<string, number> lookup is
// `number | undefined` under noUncheckedIndexedAccess, and the five keys below
// are the only ones any caller passes. This keeps the values typed as numbers
// without a non-null assertion at every use site.
/** Bounds-safe read of the ramp above — a slice index can only ever be 0–4,
 *  but the compiler cannot know that from an array index alone. */
function seriesClass(i: number): { text: string; bg: string } {
  return SERIES_CLASSES[i] ?? SERIES_CLASSES[0]
}

const CATEGORY_SERIES = {
  'OTM Puts Bought': 0,
  'OTM Puts Sold': 1,
  'OTM Calls Bought': 2,
  'OTM Calls Sold': 3,
  'ITM Calls Sold': 4,
} satisfies Record<string, number>

function fmtUsd(n: number): string {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`
}

/** Compact $ for the pie's centre readout — "$1.24B" beats an 11-digit string. */
function fmtUsdCompact(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${sign}$${Math.round(abs / 1e3)}K`
  return `${sign}$${Math.round(abs)}`
}

function pctOf(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 1000) / 10 : 0
}

// Final 30 minutes of RTH (15:30–16:00 ET).
function isFinal30(ts: number): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(ts))
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  const mins = h * 60 + m
  return mins >= 15 * 60 + 30 && mins <= 16 * 60
}

function fmtEt(ms: number): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(ms))
}

// Aggregates a raw tape (from /proxy/flow-history) into the summary/donut/
// final-30/ATM-bets shape SymbolPanel renders. Ported 1:1 from v2's
// aggregateFlow, field names adjusted to the v3 wire contract.
function aggregateFlow(ticker: string, subtitle: string, orders: FlowTapePrint[]): SymbolData {
  let otmPutsBought = 0,
    otmPutsSold = 0,
    otmCallsBought = 0,
    otmCallsSold = 0,
    itmCallsSold = 0
  let allPutsBought = 0,
    allPutsSold = 0,
    allCallsBought = 0,
    allCallsSold = 0
  let bullPrem = 0,
    bearPrem = 0,
    totalPremium = 0
  let f30PutsBought = 0,
    f30PutsSold = 0,
    f30CallsBought = 0,
    f30CallsSold = 0
  let atmPutsBought = 0,
    atmPutsSold = 0,
    atmCallsBought = 0,
    atmCallsSold = 0
  const expiryCounts = new Map<string, number>()

  for (const o of orders) {
    const prem = o.premium || 0
    const isPut = o.type === 'put'
    const isBuy = o.side === 'buy'
    totalPremium += prem
    if (o.expiration) expiryCounts.set(o.expiration, (expiryCounts.get(o.expiration) ?? 0) + 1)

    if (isPut) {
      if (isBuy) allPutsBought += prem
      else allPutsSold += prem
    } else {
      if (isBuy) allCallsBought += prem
      else allCallsSold += prem
    }

    const bullish = (isBuy && !isPut) || (!isBuy && isPut) // buy calls / sell puts
    if (bullish) bullPrem += prem
    else bearPrem += prem

    if (o.isOtm) {
      if (isPut) {
        if (isBuy) otmPutsBought += prem
        else otmPutsSold += prem
      } else {
        if (isBuy) otmCallsBought += prem
        else otmCallsSold += prem
      }
    } else {
      // ITM/ATM bucket — feeds "ATM Bets"; ITM Calls Sold also breaks out
      // separately into the summary/donut, matching v2.
      if (isPut) {
        if (isBuy) atmPutsBought += prem
        else atmPutsSold += prem
      } else {
        if (isBuy) atmCallsBought += prem
        else {
          atmCallsSold += prem
          itmCallsSold += prem
        }
      }
    }

    if (isFinal30(o.ts)) {
      if (isPut) {
        if (isBuy) f30PutsBought += prem
        else f30PutsSold += prem
      } else {
        if (isBuy) f30CallsBought += prem
        else f30CallsSold += prem
      }
    }
  }

  const sliceTotal = otmPutsBought + otmPutsSold + otmCallsBought + otmCallsSold + itmCallsSold
  const slices: Slice[] = [
    { label: 'OTM Puts Bought', pct: pctOf(otmPutsBought, sliceTotal), seriesIdx: CATEGORY_SERIES['OTM Puts Bought'] },
    { label: 'OTM Puts Sold', pct: pctOf(otmPutsSold, sliceTotal), seriesIdx: CATEGORY_SERIES['OTM Puts Sold'] },
    { label: 'OTM Calls Bought', pct: pctOf(otmCallsBought, sliceTotal), seriesIdx: CATEGORY_SERIES['OTM Calls Bought'] },
    { label: 'OTM Calls Sold', pct: pctOf(otmCallsSold, sliceTotal), seriesIdx: CATEGORY_SERIES['OTM Calls Sold'] },
    { label: 'ITM Calls Sold', pct: pctOf(itmCallsSold, sliceTotal), seriesIdx: CATEGORY_SERIES['ITM Calls Sold'] },
  ].sort((a, b) => b.pct - a.pct)

  const bullBearTotal = bullPrem + bearPrem
  const bullish = bullBearTotal > 0 ? Math.round((bullPrem / bullBearTotal) * 100) : 50
  const topExpiry = [...expiryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]

  return {
    symbol: ticker,
    subtitle,
    date: new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date()),
    slices,
    bullish,
    bearish: 100 - bullish,
    summary: [
      { label: 'OTM Puts Sold', value: fmtUsd(otmPutsSold), tone: 'sold' },
      { label: 'OTM Calls Bought', value: fmtUsd(otmCallsBought), tone: 'bought' },
      { label: 'OTM Puts Bought', value: fmtUsd(otmPutsBought), tone: 'bought' },
      { label: 'OTM Calls Sold', value: fmtUsd(otmCallsSold), tone: 'sold' },
      { label: 'ITM Calls Sold', value: fmtUsd(itmCallsSold), tone: 'sold' },
      { label: 'All Puts Bought', value: fmtUsd(allPutsBought), tone: 'highlight' },
      { label: 'All Puts Sold', value: fmtUsd(allPutsSold), tone: 'highlight' },
      { label: 'All Calls Bought', value: fmtUsd(allCallsBought) },
      { label: 'All Calls Sold', value: fmtUsd(allCallsSold) },
    ],
    premium: [
      { label: 'All Puts (Premium)', value: fmtUsd(allPutsBought + allPutsSold), tone: 'highlight' },
      { label: 'All Calls (Premium)', value: fmtUsd(allCallsBought + allCallsSold) },
    ],
    final30: [
      { label: 'Puts Bought', value: fmtUsd(f30PutsBought) },
      { label: 'Puts Sold', value: fmtUsd(f30PutsSold) },
      { label: 'Calls Bought', value: fmtUsd(f30CallsBought) },
      { label: 'Calls Sold', value: fmtUsd(f30CallsSold) },
    ],
    atmBets: [
      { label: 'Puts Bought', value: fmtUsd(atmPutsBought) },
      { label: 'Puts Sold', value: fmtUsd(atmPutsSold) },
      { label: 'Calls Sold', value: fmtUsd(atmCallsSold) },
      { label: 'Calls Bought', value: fmtUsd(atmCallsBought) },
    ],
    filters: ['Live session tape', `${orders.length.toLocaleString()} prints`],
    series: topExpiry ?? '—',
    totalPremium: fmtUsd(totalPremium),
    totalPremiumCompact: fmtUsdCompact(totalPremium),
  }
}

// ── The pie ──────────────────────────────────────────────────────────────────
//
// Geometry ported from v2's Pie (itself borrowed from the owner-vite Chart
// Types "pie" example): inline SVG solid wedges cut by a small gap, radius =
// 0.41 × box. Interaction — one shared `hover` index driving both the wedges
// and the legend, the active wedge popping out along its own mid-angle with a
// colour-matched glow — also ported from v2's Budget.tsx-derived CategoryDonutCard
// pattern. The one real change is colour: v2 painted each wedge from a
// HOME_THEME hex constant; here every wedge sets a `text-series-N` class and
// fills with `currentColor`, and the hover glow reads `currentColor` too, so
// no hex/rgb ever appears in this file.

function polarPt(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

/** Pie wedge path (solid — no inner radius). */
function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const large = a1 - a0 > 180 ? 1 : 0
  const [x0, y0] = polarPt(cx, cy, r, a0)
  const [x1, y1] = polarPt(cx, cy, r, a1)
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`
}

interface PieHover {
  hover: number | null
  onHover: (i: number | null) => void
}

function Pie({
  slices,
  size = 190,
  hover,
  onHover,
  centerValue,
  centerLabel,
}: { slices: Slice[]; size?: number; centerValue: string; centerLabel: string } & PieHover) {
  const c = size / 2
  const r = size * 0.41 // same 82/200 ratio as v2's reference pie
  const pop = r * 0.11 // same pop-out ratio as v2's CategoryDonutCard (5/46)
  const total = slices.reduce((sum, s) => sum + Math.max(s.pct, 0), 0)
  const active = hover !== null ? slices[hover] : null

  // Angles accumulate over the ORIGINAL indices so the pie and the legend
  // stay index-aligned even when a category is at 0% and draws nothing.
  let a = 0
  const arcs = slices.map((s) => {
    const sweep = total > 0 && s.pct > 0 ? (s.pct / total) * 360 : 0
    const seg = { s, a0: a, a1: a + sweep, sweep }
    a += sweep
    return seg
  })

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width="100%"
        height="100%"
        onMouseLeave={() => onHover(null)}
        className="block overflow-visible"
        role="img"
        aria-label="Options flow inventory by premium"
      >
        {arcs.map(({ s, a0, a1, sweep }, i) => {
          if (sweep <= 0) return null
          const on = hover === i
          const dim = hover !== null && !on
          const gap = sweep > 2 ? 0.6 : 0 // don't let the gap swallow slivers
          const d = arcPath(c, c, r, a0 + gap, a1 - gap)
          const mid = (((a0 + a1) / 2 - 90) * Math.PI) / 180
          const ox = on ? Math.cos(mid) * pop : 0
          const oy = on ? Math.sin(mid) * pop : 0
          return (
            <g key={s.label} style={{ transform: `translate(${ox.toFixed(2)}px, ${oy.toFixed(2)}px)`, transition: 'transform .15s ease' }}>
              <path
                d={d}
                className={[seriesClass(s.seriesIdx).text, 'fill-current stroke-surface cursor-pointer transition-opacity duration-150'].join(' ')}
                strokeWidth={1.5}
                opacity={dim ? 0.32 : 1}
                onMouseEnter={() => onHover(i)}
                style={{ filter: on ? 'drop-shadow(0 0 10px currentColor)' : undefined }}
              >
                <title>{`${s.label} — ${s.pct}%`}</title>
              </path>
            </g>
          )
        })}
      </svg>

      {/* Centre readout floats over the pie so the wedges stay solid. */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div style={{ maxWidth: size * 0.92 }}>
          <div className="tabular overflow-hidden text-ellipsis whitespace-nowrap text-lg font-black text-fg">
            {active ? `${active.pct}%` : centerValue}
          </div>
          <div className="overflow-hidden text-ellipsis whitespace-nowrap text-xs font-extrabold uppercase tracking-widest text-faint">
            {active ? active.label : centerLabel}
          </div>
        </div>
      </div>
    </div>
  )
}

function Legend({ slices, hover, onHover }: { slices: Slice[] } & PieHover) {
  return (
    <div className="flex flex-col gap-0.5" onMouseLeave={() => onHover(null)}>
      {slices.map((s, i) => {
        const on = hover === i
        const dim = hover !== null && !on
        return (
          <div
            key={s.label}
            onMouseEnter={() => onHover(i)}
            className={[
              'flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1 text-sm transition-colors',
              on ? 'bg-raised' : '',
              dim ? 'opacity-45' : '',
            ].join(' ')}
          >
            <span className={['h-3 w-3 shrink-0 rounded-sm', seriesClass(s.seriesIdx).bg].join(' ')} />
            <span className={['text-fg', on ? 'font-extrabold' : 'font-medium'].join(' ')}>{s.label}</span>
            <span className="tabular ml-auto font-bold text-fg">{s.pct}%</span>
          </div>
        )
      })}
    </div>
  )
}

function SentimentPills({ bullish, bearish }: { bullish: number; bearish: number }) {
  return (
    <div className="mt-3.5 flex gap-2">
      <div className="tabular flex-1 rounded-sm bg-up px-3.5 py-2 text-center text-sm font-extrabold text-bg">Bullish {bullish}%</div>
      <div className="tabular flex-1 rounded-sm bg-down px-3.5 py-2 text-center text-sm font-extrabold text-bg">Bearish {bearish}%</div>
    </div>
  )
}

function toneClass(tone?: Tone): string {
  if (tone === 'bought') return 'text-warn'
  if (tone === 'sold') return 'text-up'
  return 'text-fg'
}

function DataRow({ label, value, tone }: Row) {
  return (
    <div className={['flex items-center justify-between rounded-sm px-2 py-1.5 text-sm', tone === 'highlight' ? 'bg-raised/60' : ''].join(' ')}>
      <span className={tone === 'highlight' ? 'font-bold text-fg' : 'font-medium text-fg'}>{label}</span>
      <span className={['tabular font-mono text-sm font-bold', toneClass(tone)].join(' ')}>{value}</span>
    </div>
  )
}

function SideBox({ title, rows }: { title: string; rows: { label: string; value: string }[] }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line p-4">
      <div className="mb-1.5 text-sm font-extrabold uppercase tracking-wide text-warn">{title}</div>
      {rows.map((r) => (
        <DataRow key={r.label} label={r.label} value={r.value} />
      ))}
    </div>
  )
}

function Footer({ data }: { data: SymbolData }) {
  return (
    <div className="mt-4 flex justify-between gap-3 border-t border-line pt-3.5 text-sm">
      <div>
        <div className="mb-1 text-sm font-bold uppercase tracking-wide text-up">Filters</div>
        {data.filters.map((f) => (
          <div key={f} className="text-fg">
            {f}
          </div>
        ))}
      </div>
      <div>
        <div className="mb-1 text-sm font-bold uppercase tracking-wide text-up">Series</div>
        <div className="text-fg">{data.series}</div>
      </div>
      <div className="text-right">
        <div className="mb-1 text-sm font-bold uppercase tracking-wide text-up">Total Premium</div>
        <div className="tabular font-mono text-sm font-bold text-fg">{data.totalPremium}</div>
      </div>
    </div>
  )
}

function SymbolPanel({ data, error }: { data: SymbolData; error: Error | null }) {
  // One hover index shared by the pie and its legend, so hovering either side
  // highlights both — same pattern as v2's CategoryDonutCard.
  const [hover, setHover] = useState<number | null>(null)

  return (
    <Card
      title={
        <span className="flex items-baseline gap-2 truncate">
          <span className="font-semibold text-fg">{data.symbol}</span>
          <span className="truncate text-xs font-normal text-faint">
            {data.subtitle} · Data: {data.date}
          </span>
        </span>
      }
    >
      {/* A poll failure never blanks a panel that already has good data —
          it keeps showing the last aggregation and flags the failure here. */}
      {error && <p className="mb-2 text-xs text-down">Last refresh failed: {error.message} — showing last good data.</p>}
      <div className="flex flex-wrap items-center gap-5">
        <Pie slices={data.slices} hover={hover} onHover={setHover} centerValue={data.totalPremiumCompact} centerLabel="Premium" />
        <div className="min-w-[170px] flex-1">
          <Legend slices={data.slices} hover={hover} onHover={setHover} />
          <SentimentPills bullish={data.bullish} bearish={data.bearish} />
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <div>
          <div className="mb-2 text-sm font-extrabold uppercase tracking-wide text-warn">Day&rsquo;s Summary by Premium (Dollar Volume)</div>
          <div className="flex flex-col gap-0.5">
            {data.summary.map((r) => (
              <DataRow key={r.label} {...r} />
            ))}
          </div>
          <div className="mt-2.5 flex flex-col gap-0.5 border-t border-line pt-2">
            {data.premium.map((r) => (
              <DataRow key={r.label} {...r} />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <SideBox title="Final 30 Minutes" rows={data.final30} />
          <SideBox title="ATM Bets" rows={data.atmBets} />
        </div>
      </div>

      <Footer data={data} />
    </Card>
  )
}

// A per-ticker `useQuery` call rather than v2's hand-rolled
// Promise.allSettled + setInterval hook: v2 needed that machinery specifically
// because ONE Promise.all rejecting used to blank every panel (see its
// comment on useFlowInventory). Three independent useQuery calls give the
// same per-ticker isolation for free — one ticker's request failing cannot
// touch the other two's state — while also being the house pattern for
// firing parallel fetches at the top of a route.
function useFlowTape(ticker: string) {
  return useQuery<FlowHistoryResponse>(`/proxy/flow-history?underlying=${ticker}&limit=20000`, { pollMs: 30_000 })
}

function FlowInventoryTab() {
  const spx = useFlowTape('SPX')
  const spy = useFlowTape('SPY')
  const qqq = useFlowTape('QQQ')

  const spxData = useMemo(() => (spx.data ? aggregateFlow('SPX', FLOW_TICKERS[0].subtitle, spx.data.tape ?? []) : null), [spx.data])
  const spyData = useMemo(() => (spy.data ? aggregateFlow('SPY', FLOW_TICKERS[1].subtitle, spy.data.tape ?? []) : null), [spy.data])
  const qqqData = useMemo(() => (qqq.data ? aggregateFlow('QQQ', FLOW_TICKERS[2].subtitle, qqq.data.tape ?? []) : null), [qqq.data])

  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  useEffect(() => {
    if (spxData || spyData || qqqData) setLoadedAt(Date.now())
  }, [spxData, spyData, qqqData])

  const reload = () => {
    spx.refetch()
    spy.refetch()
    qqq.refetch()
  }

  const panels: FlowPanel[] = [
    { ticker: 'SPX', data: spxData, error: spx.error, loading: spx.loading },
    { ticker: 'SPY', data: spyData, error: spy.error, loading: spy.loading },
    { ticker: 'QQQ', data: qqqData, error: qqq.error, loading: qqq.loading },
  ]
  // Only a ticker with NO good data yet gets called out up top — one that
  // already has a panel on screen reports its own failure inline instead
  // (see the `error &&` line inside SymbolPanel), so it isn't named twice.
  const errorEntries = panels.filter((p): p is FlowPanel & { error: Error } => p.error !== null && p.data === null)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted">{loadedAt ? `Live flow tape · updated ${fmtEt(loadedAt)} ET` : 'Loading live flow tape…'}</span>
        <Chip label="Refresh" on={false} onClick={reload} title="Re-fetch SPX, SPY and QQQ now" />
      </div>
      {errorEntries.length > 0 && (
        <p className="text-xs text-down">Flow data error: {errorEntries.map((p) => `${p.ticker}: ${p.error.message}`).join(' · ')}</p>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(460px,1fr))] gap-5">
        {panels.map((p) =>
          p.data ? (
            <SymbolPanel key={p.ticker} data={p.data} error={p.error} />
          ) : (
            <Card key={p.ticker} title={p.ticker}>
              <p className={p.error ? 'text-xs text-down' : 'text-xs text-faint'}>{p.error ? `Error: ${p.error.message}` : p.loading ? 'Loading…' : 'No data yet.'}</p>
            </Card>
          ),
        )}
      </div>
      <p className="text-center text-xs leading-relaxed text-faint">
        Methodology (reference): &ldquo;Assessing Option Demand from Signed Volume Order Flow&rdquo; — Garrett DeSimone, Ph.D., Head of Quantitative Research,
        OptionMetrics
      </p>
    </div>
  )
}

// ── Stub tabs — bodies that live in a v2 module too large to port in one file ─

function StubTab({ title, note }: { title: string; note: string }) {
  return (
    <Card title={title}>
      <p className="text-xs text-faint">{note}</p>
    </Card>
  )
}

export default function TestLab() {
  const [tab, setTab] = useState<TestTab>('squeeze')

  return (
    <Page title="Test Lab">
      <SegGroup options={TABS} value={tab} onChange={setTab} title="Test Lab sections" />

      {tab === 'squeeze' ? (
        // TODO(v3): port SqueezeBoard from v2 @/app/squeeze/page — the
        // multi-widget squeeze board (own layout, own data hooks).
        <StubTab title="Squeeze" note="Squeeze board not yet ported — needs SqueezeBoard's multi-widget layout from v2's app/squeeze/page.tsx." />
      ) : tab === 'gex' ? (
        // TODO(v3): port GexScannerTab from v2 @/components/scanner/GexScannerTab.
        <StubTab title="GEX Scanner" note="GEX Scanner not yet ported — v2's components/scanner/GexScannerTab.tsx." />
      ) : tab === 'gexpct' ? (
        // TODO(v3): port GexPctTab from v2 @/components/scanner/GexPctTab.
        <StubTab title="GEX %" note="GEX % scanner not yet ported — v2's components/scanner/GexPctTab.tsx." />
      ) : tab === 'marketquality' ? (
        // TODO(v3): port MarketQualityTab from v2 @/components/scanner/MarketQualityTab.
        <StubTab title="Market Quality" note="Market Quality not yet ported — v2's components/scanner/MarketQualityTab.tsx." />
      ) : tab === 'statprompter' ? (
        // TODO(v3): port StatPrompterTab from v2 @/components/scanner/StatPrompterTab.
        <StubTab title="Stat Prompter" note="Stat Prompter not yet ported — v2's components/scanner/StatPrompterTab.tsx." />
      ) : tab === 'condrail' ? (
        // TODO(v3): port ConditionRailTab from v2 @/components/scanner/ConditionRailTab
        // — the Stat Prompter's IB book driven from a criteria rail (added 2026-08-23).
        <StubTab title="Condition Rail" note="Condition Rail not yet ported — v2's components/scanner/ConditionRailTab.tsx." />
      ) : tab === 'dealergamma' ? (
        // TODO(v3): port DealerGammaTab from v2 @/app/test/DealerGammaTab.
        <StubTab title="Dealer Gamma" note="Dealer Gamma not yet ported — v2's app/test/DealerGammaTab.tsx." />
      ) : tab === 'gexmap' ? (
        // TODO(v3): port GexMapTab from v2 @/app/test/GexMapTab.
        <StubTab title="GEX Map" note="GEX Map not yet ported — v2's app/test/GexMapTab.tsx." />
      ) : tab === 'premdiff' ? (
        // TODO(v3): port PremDiffTab from v2 @/app/test/PremDiffTab.
        <StubTab title="Prem Diff" note="Prem Diff not yet ported — v2's app/test/PremDiffTab.tsx." />
      ) : tab === 'seasonality' ? (
        // TODO(v3): port SeasonalityView from v2 @/components/seasonality/SeasonalityView
        // — also mounted on the public /explore/seasonality page in v2, so this body
        // is shared, not Test-Lab-specific; port it once and reuse it here too.
        <StubTab title="Seasonality" note="Seasonality not yet ported — v2's components/seasonality/SeasonalityView.tsx (shared with /explore/seasonality)." />
      ) : (
        <FlowInventoryTab />
      )}
    </Page>
  )
}
