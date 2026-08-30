import type { ReactNode } from 'react'
import { Suspense, lazy, useEffect, useState } from 'react'
import { ChartFrame } from '@/design/primitives/ChartFrame'
import { Stat } from '@/design/primitives/Stat'
import { Table } from '@/design/primitives/Table'
import { watchFrame } from '@/data/hooks'
import { CardToolbar } from '@/design/primitives/Card'
import { SOCKET_SYMBOL, isSocketSymbol, usePageSymbol } from '@/data/symbol'
import type { FlowFrame } from '@/contract/frames'
import type { BoardItem } from '@/design/primitives/Board'
import { useCanvasRenderer, drawLines } from './chart-render'

// ─────────────────────────────────────────────────────────────────────────────
// The board's card catalog — the "+ Add card" dropdown lists exactly this
// array, in this order. Adding a card type to the terminal is one entry here;
// BoardPage and Board never need to change.
//
// THE BIG ONES ARE lazy(). GEX Candles, Multi Greek, Key Levels, the Economic
// Calendar and now the GEX Chart are each a real feature with its own module
// tree — GEX Candles alone pulls lightweight-charts. Static imports would put
// all of them in the board's route chunk and every user would pay for the cards
// they do not have on their board. lazy() means a card's code arrives when the
// card does. The Suspense fallback is a blank fill, not a spinner: the card
// frame is already drawn around it, and a spinner inside a frame reads as an
// error.
//
// GEX Chart joined the list when it stopped being four lines of
// drawDivergingBars and became a real chart with its own renderer, two axes and
// a basis switch.
//
// The small ones (Flow Tape, Quick Links) stay static — they are a few lines
// each and a chunk boundary would cost more than it saves.
// ─────────────────────────────────────────────────────────────────────────────

const GexCandlesCard = lazy(() => import('./gexCandles/GexCandlesCard').then((m) => ({ default: m.GexCandlesCard })))
const MultiGreekCard = lazy(() => import('./multiGreek/MultiGreekCard').then((m) => ({ default: m.MultiGreekCard })))
const KeyLevelsCard = lazy(() => import('./keyLevels/KeyLevelsCard').then((m) => ({ default: m.KeyLevelsCard })))
const EconCalendarCard = lazy(() =>
  import('./econCalendar/EconCalendarCard').then((m) => ({ default: m.EconCalendarCard })),
)
const GexChartCard = lazy(() => import('./gexChart/GexChartCard').then((m) => ({ default: m.GexChartCard })))

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

// ── Flow Tape (Net Premium) — live rolling chart + recent prints ────────────
//
// THE ONE CARD THAT CANNOT FOLLOW THE PAGE TICKER. The `flow` frame is SPX
// prints and there is no per-ticker source for options flow anywhere in
// server-v2 — unlike the gex cards, which have /api/chains to fall back on.
// So it says SPX on its face when the board is on something else, rather than
// quietly showing SPX's tape under an AMZN heading.
const FLOW_HISTORY_MAX = 120

function FlowTapeCard() {
  const { onMount, onResize, onVisibility, setDraw } = useCanvasRenderer()
  const { symbol } = usePageSymbol()
  const following = isSocketSymbol(symbol)
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
      {!following && (
        <CardToolbar>
          <span
            title={`Options flow is only recorded for ${SOCKET_SYMBOL}. This card does not follow the board's ticker`}
            className="rounded-sm border border-warn px-1.5 py-px text-3xs font-bold uppercase tracking-[0.08em] text-warn"
          >
            {SOCKET_SYMBOL} only
          </span>
        </CardToolbar>
      )}
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
        <ChartFrame onMount={onMount} onResize={onResize} onVisibility={onVisibility} />
      </div>
      <Table
        columns={[
          // `r.type` is already 'C' | 'P' — see FlowTapePrint. It used to be
          // compared against 'call', which the wire has never carried, so this
          // column suffixed every strike 'P' regardless of what printed.
          { key: 'strike', header: 'Strike', cell: (r) => `${r.strike}${r.type}`, width: '64px' },
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
    id: 'gex-candles',
    label: 'GEX Candles',
    defaultSize: { w: 8, h: 12 },
    render: () => (
      <Deferred>
        <GexCandlesCard />
      </Deferred>
    ),
  },
  {
    id: 'gex-chart',
    label: 'GEX Chart',
    defaultSize: { w: 6, h: 12 },
    render: () => (
      <Deferred>
        <GexChartCard />
      </Deferred>
    ),
  },
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

/**
 * Card ids that have been renamed, and what they are now.
 *
 * A saved board is a list of ids, and BoardPage drops any id the catalog does
 * not know — which is right for a card that was deleted and wrong for one that
 * was merely renamed: the user would open the board to find their chart gone
 * and have to re-add and re-place it. Run every loaded id through here first.
 *
 * `es-candles` → `gex-candles`: the futures were dropped, so the card is no
 * longer about ES.
 * `multi-chart` → `multi-greek`: the ES-vs-NQ overlay was replaced outright by
 * the Multi Greek ladder, which is what that slot is for now.
 */
const RENAMED: Record<string, string> = {
  'es-candles': 'gex-candles',
  'multi-chart': 'multi-greek',
}

// ─────────────────────────────────────────────────────────────────────────────
// INSTANCE IDS — a board can hold the SAME card more than once.
//
// A grid item's `id` is an INSTANCE id, not a catalog id. The first copy of a
// card keeps the bare catalog id (`gex-chart`); every copy after it gets a
// `#n` suffix (`gex-chart#2`). Two consequences, both deliberate:
//
//   - Every layout ever saved is still valid, and still means what it meant.
//     No migration pass, no version field.
//   - Anything keyed on the bare id — a saved board from last week, the
//     `data-card-id` selectors perf-check drives — keeps working, because the
//     first instance is still spelled exactly the way it always was.
//
// The suffix is a SUFFIX, not a rename: the catalog is looked up through
// `cardTypeOf()`, which strips it.
// ─────────────────────────────────────────────────────────────────────────────

const INSTANCE_SEP = '#'

/** The catalog id behind an instance id. `gex-chart#2` → `gex-chart`. */
export function cardTypeOf(instanceId: string): string {
  const i = instanceId.indexOf(INSTANCE_SEP)
  return i === -1 ? instanceId : instanceId.slice(0, i)
}

/** Renames apply to the TYPE; an instance suffix rides along untouched. */
export function migrateCardId(id: string): string {
  const i = id.indexOf(INSTANCE_SEP)
  if (i === -1) return RENAMED[id] ?? id
  const type = id.slice(0, i)
  return `${RENAMED[type] ?? type}${id.slice(i)}`
}

/**
 * A free instance id for `cardId`, given the ids already on the board.
 *
 * Counts up rather than reusing the lowest free number, so removing card #2 and
 * adding another does not resurrect the old name — the ids in a saved layout
 * stay stable for as long as the card is there, which is what makes per-card
 * state keyed on them safe to add later.
 */
export function newInstanceId(cardId: string, takenIds: Iterable<string>): string {
  const taken = new Set(takenIds)
  if (!taken.has(cardId)) return cardId
  for (let n = 2; ; n++) {
    const candidate = `${cardId}${INSTANCE_SEP}${n}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * A fresh grid item for a catalog entry, dropped at the bottom of `existing`.
 * `cardId` is a CATALOG id; the item comes back with an instance id that does
 * not collide with anything already placed.
 */
export function placeNewCard(cardId: string, existing: BoardItem[]): BoardItem {
  const def = CARD_BY_ID.get(cardId)
  const { w, h } = def?.defaultSize ?? { w: 4, h: 6 }
  const y = existing.reduce((m, i) => Math.max(m, i.y + i.h), 0)
  return { id: newInstanceId(cardId, existing.map((i) => i.id)), x: 0, y, w, h }
}
