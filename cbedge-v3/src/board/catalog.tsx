import type { ReactNode } from 'react'
import { Suspense, lazy, useEffect, useState } from 'react'
import { ChartFrame } from '@/design/primitives/ChartFrame'
import { Stat } from '@/design/primitives/Stat'
import { Table } from '@/design/primitives/Table'
import { watchFrame } from '@/data/hooks'
import type { GexFrame, FlowFrame } from '@/contract/frames'
import type { BoardItem } from '@/design/primitives/Board'
import { useCanvasRenderer, drawDivergingBars, drawLines } from './chart-render'

// ─────────────────────────────────────────────────────────────────────────────
// The board's card catalog — the "+ Add card" dropdown lists exactly this
// array, in this order. Adding a card type to the terminal is one entry here;
// BoardPage and Board never need to change.
//
// THE BIG FOUR ARE lazy(). ES Candles, Multi Greek, Key Levels and the
// Economic Calendar are each a real feature with its own module tree — ES
// Candles alone pulls lightweight-charts. Static imports would put all of them
// in the board's route chunk and every user would pay for the three cards they
// do not have on their board. lazy() means a card's code arrives when the card
// does. The Suspense fallback is a blank fill, not a spinner: the card frame is
// already drawn around it, and a spinner inside a frame reads as an error.
//
// The small ones (GEX Chart, Flow Tape, Quick Links) stay static — they are a
// few lines each and a chunk boundary would cost more than it saves.
// ─────────────────────────────────────────────────────────────────────────────

const EsCandlesCard = lazy(() => import('./esCandles/EsCandlesCard').then((m) => ({ default: m.EsCandlesCard })))
const MultiGreekCard = lazy(() => import('./multiGreek/MultiGreekCard').then((m) => ({ default: m.MultiGreekCard })))
const KeyLevelsCard = lazy(() => import('./keyLevels/KeyLevelsCard').then((m) => ({ default: m.KeyLevelsCard })))
const EconCalendarCard = lazy(() =>
  import('./econCalendar/EconCalendarCard').then((m) => ({ default: m.EconCalendarCard })),
)

function Deferred({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="min-h-0 flex-1" />}>{children}</Suspense>
}

export interface CardDef {
  id: string
  label: string
  /** Default footprint in grid units when first added to a board. */
  defaultSize: { w: number; h: number }
  render: () => ReactNode
}

// ── GEX Chart — the live chain as diverging bars ─────────────────────────────
function GexChartCard() {
  const { onMount, onResize, setDraw } = useCanvasRenderer()

  useEffect(() => {
    return watchFrame<GexFrame>('gex', (frame) => {
      const rows = [...(frame?.data.gexRows ?? [])].sort((a, b) => a.strike - b.strike)
      setDraw((canvas, w, h) =>
        drawDivergingBars(canvas, w, h, rows.map((r) => ({ label: String(r.strike), value: r.netGEX }))),
      )
    })
  }, [setDraw])

  return <ChartFrame onMount={onMount} onResize={onResize} />
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

// ── Quick Links — fully local: user-editable, persisted per browser. ─────────
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

export const CARD_CATALOG: CardDef[] = [
  {
    id: 'es-candles',
    label: 'ES Candles',
    defaultSize: { w: 8, h: 12 },
    render: () => (
      <Deferred>
        <EsCandlesCard />
      </Deferred>
    ),
  },
  { id: 'gex-chart', label: 'GEX Chart', defaultSize: { w: 6, h: 9 }, render: () => <GexChartCard /> },
  {
    id: 'multi-greek',
    label: 'Multi Greek',
    defaultSize: { w: 12, h: 14 },
    render: () => (
      <Deferred>
        <MultiGreekCard />
      </Deferred>
    ),
  },
  { id: 'flow-tape', label: 'Flow Tape (Net Premium)', defaultSize: { w: 6, h: 9 }, render: () => <FlowTapeCard /> },
  { id: 'quick-links', label: 'Quick Links', defaultSize: { w: 3, h: 6 }, render: () => <QuickLinksCard /> },
  {
    id: 'key-levels',
    label: 'Key Levels',
    defaultSize: { w: 12, h: 6 },
    render: () => (
      <Deferred>
        <KeyLevelsCard />
      </Deferred>
    ),
  },
  {
    id: 'econ-calendar',
    label: 'Economic Calendar & Earnings',
    defaultSize: { w: 6, h: 12 },
    render: () => (
      <Deferred>
        <EconCalendarCard />
      </Deferred>
    ),
  },
]

export const CARD_BY_ID = new Map(CARD_CATALOG.map((c) => [c.id, c]))

/** A fresh grid item for a catalog entry, dropped at the bottom of `existing`. */
export function placeNewCard(id: string, existing: BoardItem[]): BoardItem {
  const def = CARD_BY_ID.get(id)
  const { w, h } = def?.defaultSize ?? { w: 4, h: 6 }
  const y = existing.reduce((m, i) => Math.max(m, i.y + i.h), 0)
  return { id, x: 0, y, w, h }
}
