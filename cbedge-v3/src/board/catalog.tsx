import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { ChartFrame } from '@/design/primitives/ChartFrame'
import { Stat } from '@/design/primitives/Stat'
import { Table } from '@/design/primitives/Table'
import { useField, watchFrame } from '@/data/hooks'
import { useQuery } from '@/data/api'
import type { GexFrame, FlowFrame } from '@/contract/frames'
import type { BoardItem } from '@/design/primitives/Board'
import { useCanvasRenderer, drawCandles, drawDivergingBars, drawLines, type Candle } from './chart-render'
import { useLwChartRenderer } from './lwChart'

// ─────────────────────────────────────────────────────────────────────────────
// The board's card catalog — the "+ Add card" dropdown lists exactly this
// array, in this order. Adding a card type to the terminal is one entry here;
// BoardPage and Board never need to change.
//
// Wired to real server-v2 data (2026-08-27): ES Candles, GEX Chart, Multi
// Chart and Flow Tape all read live/REST data now (see src/contract/frames.ts
// for the transcribed wire shapes and src/board/chart-render.ts for the
// canvas renderers — there's no chart library installed, so these are plain
// canvas 2D, swappable later without touching the cards). Key Levels and
// Economic Calendar & Earnings pull from the confirmed REST endpoints. Quick
// Links remains local/editable, no backend involved.
// ─────────────────────────────────────────────────────────────────────────────

export interface CardDef {
  id: string
  label: string
  /** Default footprint in grid units when first added to a board. */
  defaultSize: { w: number; h: number }
  render: () => ReactNode
}

interface CandleRow {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
}
interface CandlesResponse {
  rows: CandleRow[]
}

function toCandles(rows: CandleRow[] | undefined): Candle[] {
  if (!rows) return []
  // Number(): the real endpoint sends timestamp as a numeric STRING
  // ("1787716800000"), not a number — confirmed against the live API, not
  // guessed. The plain canvas renderer never cared (it draws by index), but
  // lightweight-charts is strict about `time` actually being a number.
  return rows.map((r) => ({ t: Number(r.timestamp), o: r.open, h: r.high, l: r.low, c: r.close }))
}

function candlesUrl(symbol: string, daysBack = 1) {
  return `/api/snapshots/candles?symbol=${encodeURIComponent(symbol)}&interval=5&daysBack=${daysBack}`
}

// ── ES Candles — real candlestick chart (lightweight-charts, lazy-loaded) with
// GEX bubbles overlaid at each strike's real price coordinate. See lwChart.ts
// for why this is a from-scratch v3-native chart and not a port of v2's
// EsChartCard. ──
function EsCandlesCard() {
  const { data, loading, error } = useQuery<CandlesResponse>(candlesUrl('ES'), { staleMs: 25_000 })
  const { onMount, setCandles, setGexRows } = useLwChartRenderer()
  const candles = useMemo(() => toCandles(data?.rows), [data])
  // TEMP DEBUG — remove once bubbles are confirmed live. Shows whether the
  // 'gex' frame is arriving at all and, if so, what shape its rows actually
  // have (the real backend's field names, not our assumed contract).
  const [gexDebug, setGexDebug] = useState<string>('gex: waiting…')

  useEffect(() => {
    setCandles(candles)
  }, [candles, setCandles])

  useEffect(
    () =>
      watchFrame<GexFrame>('gex', (frame) => {
        const rows = frame?.data.gexRows ?? []
        setGexRows(rows)
        const first = rows[0]
        setGexDebug(first ? `gex: ${rows.length} rows, keys=${Object.keys(first).join(',')}` : 'gex: 0 rows')
      }),
    [setGexRows],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <span className="shrink-0 text-[10px] text-faint">{gexDebug}</span>
      {error && <span className="shrink-0 text-xs text-down">{error.message}</span>}
      {!error && candles.length === 0 && (
        <span className="shrink-0 text-xs text-muted">{loading ? 'Loading…' : 'No candles for today yet.'}</span>
      )}
      <ChartFrame onMount={onMount} />
    </div>
  )
}

// ── GEX Chart ─────────────────────────────────────────────────────────────────
function GexChartCard() {
  const { onMount, onResize, setDraw } = useCanvasRenderer()

  useEffect(() => {
    return watchFrame<GexFrame>('gex', (frame) => {
      const rows = [...(frame?.data.gexRows ?? [])].sort((a, b) => a.strike - b.strike)
      setDraw((canvas, w, h) => drawDivergingBars(canvas, w, h, rows.map((r) => ({ label: String(r.strike), value: r.netGEX }))))
    })
  }, [setDraw])

  return <ChartFrame onMount={onMount} onResize={onResize} />
}

// ── Multi Chart — single ticker (candles) or multiple (normalized overlay) ──
const CHART_SYMBOLS = ['ES', 'NQ']

function MultiChartCard() {
  const [mode, setMode] = useState<'single' | 'multi'>('single')
  const [symbol, setSymbol] = useState('ES')
  const single = useQuery<CandlesResponse>(mode === 'single' ? candlesUrl(symbol) : null, { staleMs: 25_000 })
  const multiA = useQuery<CandlesResponse>(mode === 'multi' ? candlesUrl('ES') : null, { staleMs: 25_000 })
  const multiB = useQuery<CandlesResponse>(mode === 'multi' ? candlesUrl('NQ') : null, { staleMs: 25_000 })
  const { onMount, onResize, setDraw } = useCanvasRenderer()

  const singleCandles = useMemo(() => toCandles(single.data?.rows), [single.data])
  const normalized = useMemo(() => {
    const norm = (rows: CandleRow[] | undefined) => {
      const first = rows?.[0]
      if (!rows || !first) return []
      const base = first.close || 1
      return rows.map((r) => ((r.close - base) / base) * 100)
    }
    return [
      { color: '--color-series-1', points: norm(multiA.data?.rows) },
      { color: '--color-series-2', points: norm(multiB.data?.rows) },
    ]
  }, [multiA.data, multiB.data])

  useEffect(() => {
    if (mode === 'single') setDraw((canvas, w, h) => drawCandles(canvas, w, h, singleCandles))
    else setDraw((canvas, w, h) => drawLines(canvas, w, h, normalized))
  }, [mode, singleCandles, normalized, setDraw])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-1">
        {(['single', 'multi'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={[
              'rounded-sm px-2 py-0.5 text-xs capitalize transition-colors',
              mode === m ? 'bg-raised text-fg' : 'text-muted hover:text-fg',
            ].join(' ')}
          >
            {m} ticker
          </button>
        ))}
        {mode === 'single' && (
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="ml-auto rounded-sm border border-line bg-surface px-1.5 py-0.5 text-xs text-fg outline-none"
          >
            {CHART_SYMBOLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        {mode === 'multi' && <span className="ml-auto text-[10px] text-muted">ES vs NQ, % change</span>}
      </div>
      <ChartFrame onMount={onMount} onResize={onResize} />
    </div>
  )
}

// ── Flow Tape (Net Premium) — live rolling chart + recent prints ────────────
const FLOW_HISTORY_MAX = 120

function FlowTapeCard() {
  const { onMount, onResize, setDraw } = useCanvasRenderer()
  const [snapshot, setSnapshot] = useState<{ netPremium: number; buyPct: number; prints: number } | null>(null)
  const [tape, setTape] = useState<FlowFrame['data']['tape']>([])

  useEffect(() => {
    const history: number[] = []
    return watchFrame<FlowFrame>('flow', (frame) => {
      const d = frame?.data
      if (!d) return
      history.push(d.netPremium)
      if (history.length > FLOW_HISTORY_MAX) history.shift()
      setDraw((canvas, w, h) => drawLines(canvas, w, h, [{ color: '--color-accent', points: [...history] }]))
      setSnapshot({ netPremium: d.netPremium, buyPct: d.buyPct, prints: d.prints })
      setTape(d.tape ?? [])
    })
  }, [setDraw])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="grid shrink-0 grid-cols-3 gap-2">
        <Stat
          label="Net premium"
          value={snapshot ? `$${(snapshot.netPremium / 1000).toFixed(0)}k` : undefined}
          direction={snapshot ? (snapshot.netPremium >= 0 ? 'up' : 'down') : undefined}
          size="sm"
        />
        <Stat label="Buy %" value={snapshot ? `${(snapshot.buyPct * 100).toFixed(0)}%` : undefined} size="sm" />
        <Stat label="Prints" value={snapshot?.prints} size="sm" />
      </div>
      <div className="h-16 shrink-0">
        <ChartFrame onMount={onMount} onResize={onResize} />
      </div>
      <Table
        columns={[
          { key: 'strike', header: 'Strike', cell: (r) => `${r.strike}${r.type === 'call' ? 'C' : 'P'}`, width: '64px' },
          { key: 'side', header: 'Side', cell: (r) => r.side, width: '48px' },
          { key: 'premium', header: 'Premium', cell: (r) => `$${(r.premium / 1000).toFixed(0)}k`, numeric: true },
        ]}
        rows={[...tape].slice(-25).reverse()}
        rowKey={(r, i) => `${r.ts}-${i}`}
        empty="No prints this window"
      />
    </div>
  )
}

// ── Quick Links — fully functional today: user-editable, persisted locally. ──
const LINKS_KEY = 'cb-v3-quick-links'
type QuickLink = { id: string; label: string; url: string }

function loadLinks(): QuickLink[] {
  try {
    const raw = localStorage.getItem(LINKS_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveLinks(links: QuickLink[]) {
  try {
    localStorage.setItem(LINKS_KEY, JSON.stringify(links))
  } catch {
    /* best-effort */
  }
}

function QuickLinksCard() {
  const [links, setLinks] = useState<QuickLink[]>(() => loadLinks())
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')

  useEffect(() => saveLinks(links), [links])

  const add = () => {
    const l = label.trim()
    const u = url.trim()
    if (!l || !u) return
    setLinks((prev) => [...prev, { id: `${Date.now()}-${prev.length}`, label: l, url: u }])
    setLabel('')
    setUrl('')
  }
  const remove = (id: string) => setLinks((prev) => prev.filter((x) => x.id !== id))

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {links.length === 0 && <span className="text-xs text-faint">No links yet — add one below.</span>}
        {links.map((l) => (
          <div key={l.id} className="flex items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-raised">
            <a href={l.url} target="_blank" rel="noreferrer" className="flex-1 truncate text-sm text-fg hover:underline">
              {l.label}
            </a>
            {editing && (
              <button onClick={() => remove(l.id)} className="text-xs text-faint hover:text-down" title="Remove link">
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      {editing ? (
        <div className="flex shrink-0 flex-col gap-1 border-t border-line pt-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label"
            className="rounded-sm border border-line bg-bg px-2 py-1 text-xs text-fg outline-none focus:border-accent"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            className="rounded-sm border border-line bg-bg px-2 py-1 text-xs text-fg outline-none focus:border-accent"
          />
          <div className="flex justify-end gap-1">
            <button onClick={add} className="rounded-sm bg-accent px-2 py-1 text-xs text-bg">
              Add
            </button>
            <button onClick={() => setEditing(false)} className="rounded-sm px-2 py-1 text-xs text-muted hover:text-fg">
              Done
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="shrink-0 self-start text-xs text-muted hover:text-fg">
          Edit links
        </button>
      )}
    </div>
  )
}

// ── Key Levels — real values off the live 'gex' frame. ──
function KeyLevelsCard() {
  const callWall = useField<GexFrame, number | null>('gex', (f) => f?.data.callWall ?? null)
  const putWall = useField<GexFrame, number | null>('gex', (f) => f?.data.putWall ?? null)
  const gexFlip = useField<GexFrame, number | null>('gex', (f) => f?.data.gexFlip ?? null)
  const netGex = useField<GexFrame, number | null>('gex', (f) => f?.data.totalNetGex ?? null)

  type Row = { tag: string; label: string; value: number | null }
  const rows: Row[] = [
    { tag: 'CW', label: 'Call Wall', value: callWall },
    { tag: 'PW', label: 'Put Wall', value: putWall },
    { tag: 'GF', label: 'Gamma Flip', value: gexFlip },
    { tag: 'NG', label: 'Net GEX', value: netGex },
  ]

  return (
    <Table<Row>
      stale={rows.every((r) => r.value === null)}
      columns={[
        { key: 'tag', header: '', cell: (r) => <span className="text-xs text-faint">{r.tag}</span>, width: '32px' },
        { key: 'label', header: 'Level', cell: (r) => r.label },
        { key: 'value', header: 'Value', cell: (r) => (r.value === null ? '—' : r.value.toLocaleString()), numeric: true },
      ]}
      rows={rows}
      rowKey={(r) => r.tag}
    />
  )
}

// ── Econ Calendar & Earnings — real REST data, merged and sorted by time. ──
interface CalEvent {
  time: string
  title: string
  impact: string
}
interface CalendarResponse {
  events: CalEvent[]
}
interface EarningsRow {
  symbol: string
  company: string
  callTime: string
}
interface EarningsResponse {
  earnings: EarningsRow[]
}

type EconRow = { time: string; label: string; impact: string }

function EconCalendarCard() {
  const cal = useQuery<CalendarResponse>('/api/calendar', { staleMs: 60_000 })
  const earn = useQuery<EarningsResponse>('/api/earnings-today', { staleMs: 60_000 })

  const rows = useMemo<EconRow[]>(() => {
    const fromCal = (cal.data?.events ?? []).map((e) => ({ time: e.time, label: e.title, impact: e.impact }))
    const fromEarn = (earn.data?.earnings ?? []).map((e) => ({
      time: e.callTime,
      label: `${e.symbol} earnings — ${e.company}`,
      impact: 'Earnings',
    }))
    return [...fromCal, ...fromEarn].sort((a, b) => a.time.localeCompare(b.time))
  }, [cal.data, earn.data])

  return (
    <Table<EconRow>
      stale={cal.loading || earn.loading}
      columns={[
        { key: 'time', header: 'Time', cell: (r) => r.time, width: '56px' },
        { key: 'label', header: 'Event / Earnings', cell: (r) => r.label },
        { key: 'impact', header: 'Impact', cell: (r) => r.impact, width: '64px' },
      ]}
      rows={rows}
      rowKey={(r, i) => `${r.time}-${i}`}
      empty={cal.error || earn.error ? 'Could not load calendar/earnings' : 'Nothing scheduled'}
    />
  )
}

export const CARD_CATALOG: CardDef[] = [
  { id: 'es-candles', label: 'ES Candles', defaultSize: { w: 6, h: 9 }, render: () => <EsCandlesCard /> },
  { id: 'gex-chart', label: 'GEX Chart', defaultSize: { w: 6, h: 9 }, render: () => <GexChartCard /> },
  { id: 'multi-chart', label: 'Multi Chart', defaultSize: { w: 6, h: 9 }, render: () => <MultiChartCard /> },
  { id: 'flow-tape', label: 'Flow Tape (Net Premium)', defaultSize: { w: 6, h: 9 }, render: () => <FlowTapeCard /> },
  { id: 'quick-links', label: 'Quick Links', defaultSize: { w: 3, h: 6 }, render: () => <QuickLinksCard /> },
  { id: 'key-levels', label: 'Key Levels', defaultSize: { w: 3, h: 6 }, render: () => <KeyLevelsCard /> },
  { id: 'econ-calendar', label: 'Economic Calendar & Earnings', defaultSize: { w: 6, h: 6 }, render: () => <EconCalendarCard /> },
]

export const CARD_BY_ID = new Map(CARD_CATALOG.map((c) => [c.id, c]))

/** A fresh grid item for a catalog entry, dropped at the bottom of `existing`. */
export function placeNewCard(id: string, existing: BoardItem[]): BoardItem {
  const def = CARD_BY_ID.get(id)
  const { w, h } = def?.defaultSize ?? { w: 4, h: 6 }
  const y = existing.reduce((m, i) => Math.max(m, i.y + i.h), 0)
  return { id, x: 0, y, w, h }
}
