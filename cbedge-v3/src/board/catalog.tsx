import type { ComponentType, ReactNode } from 'react'
import { Suspense, lazy, useEffect, useState } from 'react'
import type { BoardItem } from '@/design/primitives/Board'

// ─────────────────────────────────────────────────────────────────────────────
// The board's card catalog — the "+ Add card" dropdown lists exactly this
// array, in this order. Adding a card type to the terminal is one entry here;
// BoardPage and Board never need to change.
//
// THE BIG ONES ARE lazy(). GEX Candles, Multi Greek, Key Levels, the Economic
// Calendar, the GEX Chart, Net Premium, the Flow Tape and the Gauge Rail are
// each a real feature with its own module tree — GEX Candles and Net Premium
// each pull lightweight-charts, the Flow Tape pulls the whole print table and
// its contract drawer. Static imports would put all of them in the board's route
// chunk and every user would pay for the cards they do not have on their board.
// lazy() means a card's code arrives when the card does. The Suspense fallback
// is a blank fill, not a spinner: the card frame is already drawn around it,
// and a spinner inside a frame reads as an error.
//
// Quick Links stays static — it is a few lines and a chunk boundary would cost
// more than it saves.
// ─────────────────────────────────────────────────────────────────────────────

const GexCandlesCard = lazy(() => import('./gexCandles/GexCandlesCard').then((m) => ({ default: m.GexCandlesCard })))
const MultiGreekCard = lazy(() => import('./multiGreek/MultiGreekCard').then((m) => ({ default: m.MultiGreekCard })))
const KeyLevelsCard = lazy(() => import('./keyLevels/KeyLevelsCard').then((m) => ({ default: m.KeyLevelsCard })))
const KeyLevelsTitle = lazy(() => import('./keyLevels/KeyLevelsCard').then((m) => ({ default: m.KeyLevelsTitle })))
const EconCalendarCard = lazy(() =>
  import('./econCalendar/EconCalendarCard').then((m) => ({ default: m.EconCalendarCard })),
)
const GexChartCard = lazy(() => import('./gexChart/GexChartCard').then((m) => ({ default: m.GexChartCard })))
const NetPremiumCard = lazy(() => import('./netPremium/NetPremiumCard').then((m) => ({ default: m.NetPremiumCard })))
const FlowTapeCard = lazy(() => import('./flowTape/FlowTapeCard').then((m) => ({ default: m.FlowTapeCard })))
const GaugeRailCard = lazy(() => import('./gaugeRail/GaugeRailCard').then((m) => ({ default: m.GaugeRailCard })))

function Deferred({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="min-h-0 flex-1" />}>{children}</Suspense>
}

/**
 * A dynamic title falls back to the PLAIN LABEL while its chunk loads, never to
 * a blank: the header is the only thing on a card that is readable before the
 * body arrives, and a title that appears a beat after the card does is the
 * board looking broken for a beat.
 */
function KeyLevelsHeading() {
  return (
    <Suspense fallback={<>Key Levels</>}>
      <KeyLevelsTitle />
    </Suspense>
  )
}

export interface CardDef {
  id: string
  label: string
  /**
   * One emoji, in the rail's language (see NAV in shell/Shell.tsx). It is what
   * the "+ Add card" menu and the camera's menu are scanned by — at a glance
   * you are looking for the shape, not reading eight labels.
   */
  icon: string
  /**
   * A live header for cards whose subject is not fixed — the page ticker, the
   * contract date the numbers came from. Rendered by BoardPage IN PLACE OF
   * `label`, inside the drag handle, so it must stay one line of text.
   *
   * A COMPONENT, never a render function: it holds hooks of its own, and a
   * function called inline from BoardPage's render would make them BoardPage's
   * hooks — conditionally, which is the rules-of-hooks violation that only
   * shows up when a card is added or removed.
   *
   * `label` is still required, and still what the "+ Add card" menu lists.
   */
  Title?: ComponentType
  /** Default footprint in grid units when first added to a board. */
  defaultSize: { w: number; h: number }
  /**
   * `instanceId` is the id of the grid item being drawn — `gex-candles` for the
   * first copy of a card, `gex-candles#2` for the next (see INSTANCE IDS
   * below). Most cards ignore it; a card that keeps per-copy state or lets each
   * copy hold a different subject keys that state on it.
   */
  render: (instanceId: string) => ReactNode
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
    icon: '🕯️',
    label: 'GEX Candles',
    defaultSize: { w: 8, h: 12 },
    // The instance id is threaded in so the SECOND and later copies can hold
    // their own ticker (and their own settings) instead of all following the
    // board symbol — two copies of one chart is not why anyone adds a second.
    render: (instanceId) => (
      <Deferred>
        <GexCandlesCard instanceId={instanceId} />
      </Deferred>
    ),
  },
  {
    id: 'gex-chart',
    icon: '📊',
    label: 'GEX Chart',
    defaultSize: { w: 6, h: 12 },
    render: () => (
      <Deferred>
        <GexChartCard />
      </Deferred>
    ),
  },
  {
    // v2's home-page gauge strip, minus its IB Direction tile. A one-row card:
    // w 12 / h 5 is the strip shape it is drawn for — five tiles sharing the
    // full board width, tall enough for a label, a meter, a value and its
    // 15-minute change line and no taller.
    id: 'gauge-rail',
    icon: '🎚️',
    label: 'Gauge Rail',
    defaultSize: { w: 12, h: 5 },
    render: () => (
      <Deferred>
        <GaugeRailCard />
      </Deferred>
    ),
  },
  {
    id: 'multi-greek',
    icon: '🧮',
    label: 'Multi Greek',
    defaultSize: { w: 12, h: 14 },
    render: () => (
      <Deferred>
        <MultiGreekCard />
      </Deferred>
    ),
  },
  {
    id: 'net-premium',
    icon: '💵',
    label: 'Net Premium',
    defaultSize: { w: 8, h: 12 },
    render: () => (
      <Deferred>
        <NetPremiumCard />
      </Deferred>
    ),
  },
  {
    id: 'flow-tape',
    icon: '🌊',
    label: 'Flow Tape',
    defaultSize: { w: 12, h: 12 },
    render: () => (
      <Deferred>
        <FlowTapeCard />
      </Deferred>
    ),
  },
  { id: 'quick-links', icon: '🔗', label: 'Quick Links', defaultSize: { w: 3, h: 6 }, render: () => <QuickLinksCard /> },
  {
    id: 'key-levels',
    icon: '📏',
    label: 'Key Levels',
    Title: KeyLevelsHeading,
    defaultSize: { w: 12, h: 6 },
    render: () => (
      <Deferred>
        <KeyLevelsCard />
      </Deferred>
    ),
  },
  {
    id: 'econ-calendar',
    icon: '🗓️',
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
  // ── A SECOND COPY IS THE SIZE OF THE FIRST ─────────────────────────────────
  // The catalog's `defaultSize` is the right answer for the first one and the
  // wrong one for every copy after it: the card on the board has been resized
  // to fit this user's arrangement, and a second GEX Candles that arrives at the
  // factory size has to be dragged back to match before the pair can be read as
  // a pair. Two of the same card are almost always wanted side by side and the
  // same size — see the snap in design/primitives/Board.tsx, which is the other
  // half of this — so the newest existing copy's size is the better default.
  //
  // The LAST one placed, not the first: if there are already three and they were
  // resized over time, the most recent is the size currently being worked to.
  const sibling = [...existing].reverse().find((i) => cardTypeOf(i.id) === cardId)
  const { w, h } = sibling ?? def?.defaultSize ?? { w: 4, h: 6 }
  const y = existing.reduce((m, i) => Math.max(m, i.y + i.h), 0)
  return { id: newInstanceId(cardId, existing.map((i) => i.id)), x: 0, y, w, h }
}
