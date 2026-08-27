import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Table } from '@/design/primitives/Table'
import type { BoardItem } from '@/design/primitives/Board'

// ─────────────────────────────────────────────────────────────────────────────
// The board's card catalog — the "+ Add card" dropdown lists exactly this
// array, in this order. Adding a card type to the terminal is one entry here;
// BoardPage and Board never need to change.
//
// Real data (ES candles, GEX-by-strike, the multi-ticker chart, the flow tape)
// isn't wired yet — v3's contract (src/contract/frames.ts) doesn't carry those
// frame shapes yet, and AGENTS.md rule #4 ("charts are imperative, mounted
// through ChartFrame") means those need a real chart-library integration, not
// a placeholder div. Each of those renders a clearly-labelled pending state
// instead of fake numbers, so nobody mistakes it for live data. Key Levels,
// Econ Calendar/Earnings and Quick Links are plain data/UI, not charts, so
// Quick Links is fully working today and the other two are stubbed the same
// "pending" way pending their own REST wiring.
// ─────────────────────────────────────────────────────────────────────────────

export interface CardDef {
  id: string
  label: string
  /** Default footprint in grid units when first added to a board. */
  defaultSize: { w: number; h: number }
  render: () => ReactNode
}

function Pending({ note }: { note: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
      <span className="text-xs text-faint">{note}</span>
    </div>
  )
}

function EsCandlesCard() {
  return <Pending note="ES candles — chart pending (needs the candle frame + a chart library mount)" />
}

function GexChartCard() {
  return <Pending note="GEX by strike — chart pending (needs the gex frame + a chart library mount)" />
}

function MultiChartCard() {
  const [mode, setMode] = useState<'single' | 'multi'>('single')
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 gap-1">
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
      </div>
      <Pending note={`Chart pending — ${mode === 'single' ? 'one ticker' : 'overlaid tickers'} (needs a chart-library mount)`} />
    </div>
  )
}

function FlowTapeCard() {
  return <Pending note="Net premium / flow tape — chart pending (needs the flow frame + a chart library mount)" />
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
        <button
          onClick={() => setEditing(true)}
          className="shrink-0 self-start text-xs text-muted hover:text-fg"
        >
          Edit links
        </button>
      )}
    </div>
  )
}

// ── Key Levels — same shape as the premarket page's levels list. ──
type Level = { label: string; strike: string; tag: string; direction: 'up' | 'down' | 'flat' }
const PLACEHOLDER_LEVELS: Level[] = [
  { label: 'Core Bullseye', strike: '—', tag: 'CB', direction: 'flat' },
  { label: 'Call Wall', strike: '—', tag: 'CW', direction: 'up' },
  { label: 'Put Wall', strike: '—', tag: 'PW', direction: 'down' },
  { label: 'Gamma Flip', strike: '—', tag: 'GF', direction: 'flat' },
]

function KeyLevelsCard() {
  return (
    <Table<Level>
      stale
      columns={[
        { key: 'tag', header: '', cell: (r) => <span className="text-xs text-faint">{r.tag}</span>, width: '32px' },
        { key: 'label', header: 'Level', cell: (r) => r.label },
        { key: 'strike', header: 'Strike', cell: (r) => r.strike, numeric: true },
      ]}
      rows={PLACEHOLDER_LEVELS}
      rowKey={(r) => r.tag}
    />
  )
}

// ── Econ Calendar & Earnings — same shape as the home page's version. ──
type EconRow = { time: string; event: string; impact: 'High' | 'Med' | 'Low' }
const PLACEHOLDER_ECON: EconRow[] = [
  { time: '—', event: 'Not wired yet — needs /api/calendar + /api/earnings via src/data/api.ts', impact: 'Low' },
]

function EconCalendarCard() {
  return (
    <Table<EconRow>
      stale
      columns={[
        { key: 'time', header: 'Time', cell: (r) => r.time, width: '56px' },
        { key: 'event', header: 'Event / Earnings', cell: (r) => r.event },
        { key: 'impact', header: 'Impact', cell: (r) => r.impact, width: '56px' },
      ]}
      rows={PLACEHOLDER_ECON}
      rowKey={(r, i) => i}
    />
  )
}

export const CARD_CATALOG: CardDef[] = [
  { id: 'es-candles', label: 'ES Candles', defaultSize: { w: 6, h: 9 }, render: () => <EsCandlesCard /> },
  { id: 'gex-chart', label: 'GEX Chart', defaultSize: { w: 6, h: 9 }, render: () => <GexChartCard /> },
  { id: 'multi-chart', label: 'Multi Chart', defaultSize: { w: 6, h: 9 }, render: () => <MultiChartCard /> },
  { id: 'flow-tape', label: 'Flow Tape (Net Premium)', defaultSize: { w: 6, h: 7 }, render: () => <FlowTapeCard /> },
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
