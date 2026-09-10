import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CardToolbar } from '@/design/primitives/Card'
import { Chip, PanelSection, Popover, SegGroup } from '@/design/primitives/Controls'
import { useQuery } from '@/data/api'
import { STALE_AFTER_SEC, fmtAgo, fmtPremium, fmtTime } from '@/data/flowMath'
import { useTick } from '@/data/flowData'
import { ContractProbe } from './ContractProbe'

// ─────────────────────────────────────────────────────────────────────────────
// TOP FLOW — the whole options market's biggest prints, from the LSE vault.
//
// Not a second Flow Tape. The Flow Tape is OUR recorder, one ticker at a time,
// riding the socket; this is a WHOLE-MARKET sweep — every underlying the vault
// sees — ranked by dollar premium. The two answer different questions ("what is
// SPX doing" vs "where did the size go today") and neither replaces the other.
//
// ── One request, one server-side sweep ───────────────────────────────────────
// The card polls /api/lse/top-flow, which holds ONE cached vault sweep for the
// whole site and filters it per request (see the block in server-v2/
// api-router.js). Every cogwheel setting is therefore free: changing Min
// Premium or Max DTE re-filters the same cached session rather than firing a
// vault call. The server's own floor is the lowest stop this card offers, so a
// setting below it cannot exist and cannot silently return a short list.
//
// ── SIDE and BUY/SELL are captured, and say so when they are not ─────────────
// The vault sends no aggressor and no quote, and its chain endpoint is a live
// snapshot — so a print's side cannot be looked up after the fact at any price.
// The server classifies each print against the bid/ask WHILE IT IS FRESH and
// freezes the verdict. Three things follow, and the card has to show all three
// rather than collapse them into a blank cell:
//
//   pending  the print arrived seconds ago and its quote has not landed yet
//   stale    it arrived while the server was not looking and is now too old to
//            judge — never guessed against a late quote
//   mid      it filled between the bid and the ask, which is a real answer and
//            not a missing one. Buy/Sell is n/a, deliberately: calling a mid
//            print a buy because it is a cent above the midpoint is noise
//            dressed as signal.
//
// Hovering any Side cell gives the bid/ask it was judged against and how many
// seconds after the print that quote was taken — the one number that says how
// much to trust the row.
//
// ── Why the freshness line is not a LIVE badge ───────────────────────────────
// The vault serves the trailing week of prints and how far behind its live edge
// runs is not documented (md files/LSE-DATA-LIMITS.md). So the header states two
// facts and draws no conclusion: when the server last swept, and how old the
// newest print in the session is. Past STALE_AFTER_SEC that age goes warn-
// coloured, but only while the vault's session date is today's — an evening
// board is not permanently orange.
// ─────────────────────────────────────────────────────────────────────────────

/** Dollars. The first stop must match TF_BASE_MIN_PREMIUM on the server. */
const PREMIUM_STOPS = [
  { label: '$50K', value: 50_000 },
  { label: '$100K', value: 100_000 },
  { label: '$250K', value: 250_000 },
  { label: '$500K', value: 500_000 },
  { label: '$1M', value: 1_000_000 },
] as const

/** null = no cap. 0 = same-day expiries only. */
const DTE_STOPS = [
  { label: '0', value: 0, title: 'Same-day expiries only' },
  { label: '≤7', value: 7, title: 'This week' },
  { label: '≤30', value: 30, title: 'Within a month' },
  { label: '≤90', value: 90, title: 'Within a quarter' },
  { label: 'ANY', value: null, title: 'No expiry limit' },
] as const

const ROW_STOPS = [25, 50, 100] as const

type SortKey = 'premium' | 'time'
/** Moneyness AT PRINT TIME — see the note on the toolbar control. */
type Moneyness = 'otm' | 'all'

interface Settings {
  minPremium: number
  maxDte: number | null
  sort: SortKey
  rows: number
  /** Column ids, left to right. See the COLUMN ORDER note below. */
  order: string[]
  /**
   * Show prints whose side could not be read — mid fills, and the ones that
   * arrived unclassified. OFF by default: a row you cannot attribute to a buyer
   * or a seller is not a weaker row on this card, it is an unreadable one.
   */
  showUnreadable: boolean
  /** 'otm' keeps only strikes that were out of the money when they printed. */
  moneyness: Moneyness
}

/** Where the fill sat against the quote at the time it printed. */
export type FlowSide = 'above_ask' | 'ask' | 'mid' | 'bid' | 'below_bid'

export interface TopFlowRow {
  id: string
  /** Epoch ms. */
  ts: number
  osi: string | null
  underlying: string | null
  type: 'C' | 'P' | null
  strike: number | null
  expiry: string | null
  dte: number | null
  size: number | null
  price: number | null
  premium: number
  spot: number | null
  side: FlowSide | null
  action: 'BUY' | 'SELL' | null
  /** Why there is no side: 'pending' | 'stale' | 'no-price' | 'locked' | … */
  sideReason: string | null
  bid: number | null
  ask: number | null
  /** ms between the print and the quote it was judged against. */
  quoteAgeMs: number | null
  /** The contract's own day volume and open interest, live. */
  vol: number | null
  oi: number | null
}

interface TopFlowResponse {
  rows: TopFlowRow[]
  count: number
  matched: number
  sessionDate: string | null
  asOf: string | null
  newestTs: number | null
  baseMinPremium: number
  refreshMs: number
  sideAvailable: boolean
  sides: 'directional' | 'all'
  moneyness: Moneyness
  /** What the filters removed, by reason. */
  excluded: { mid: number; pending: number; stale: number; other: number; itm: number }
  classifyMaxAgeMs: number
  error: string | null
  statsError: string | null
}

/** Matches the server's cache window — polling faster only re-serves the cache. */
const POLL_MS = 20_000

const fmtNum = (n: number | null) => (n === null ? '—' : n.toLocaleString())
const fmtPrice = (n: number | null) => (n === null ? '—' : n.toFixed(2))
const fmtStrike = (n: number | null) => (n === null ? '—' : String(n))
/** "Sep 19" — the year is noise on a tape where everything is inside a year. */
const fmtExpiry = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

const SIDE_LABEL: Record<FlowSide, string> = {
  above_ask: '> ASK',
  ask: 'ASK',
  mid: 'MID',
  bid: 'BID',
  below_bid: '< BID',
}
/** Buy-ish reads up, sell-ish reads down, mid stays neutral on purpose. */
const SIDE_INK: Record<FlowSide, string> = {
  above_ask: 'text-up',
  ask: 'text-up',
  mid: 'text-muted',
  bid: 'text-down',
  below_bid: 'text-down',
}
const REASON_TITLE: Record<string, string> = {
  pending: 'Just printed — the quote it will be judged against has not landed yet. It fills in on the next refresh.',
  stale: 'This print arrived while the server was not watching, and is now too old to judge. A side is never guessed against a quote taken minutes later.',
  'no-quote': 'The contract had no two-sided market when the quote was pulled.',
  'no-price': 'The print carried no readable fill price.',
  locked: 'The quote was locked or crossed (ask at or below bid) — every price is at-bid and at-ask at once, so there is no read.',
  source: 'The side came from the data source itself, not inferred from a quote.',
}

function SideCell({ r }: { r: TopFlowRow }) {
  if (r.side) {
    const quote =
      r.bid !== null && r.ask !== null
        ? `Quote when judged: ${r.bid.toFixed(2)} × ${r.ask.toFixed(2)}`
        : 'No quote recorded'
    const lag =
      r.quoteAgeMs === null
        ? ''
        : ` · taken ${Math.round(r.quoteAgeMs / 1000)}s after the print`
    return (
      <span className={SIDE_INK[r.side]} title={`Filled at ${fmtPrice(r.price)}. ${quote}${lag}`}>
        {SIDE_LABEL[r.side]}
      </span>
    )
  }
  const reason = r.sideReason ?? 'pending'
  return (
    <span className="text-faint opacity-70" title={REASON_TITLE[reason] ?? reason}>
      {reason === 'pending' ? '…' : '—'}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COLUMNS
//
// One array, and the header, the body and the drag-to-reorder all read it. A
// column added here appears in all three with no other edit — which is the
// point: three hand-kept lists of twelve columns is three chances to put the
// Premium value under the Vol heading.
//
// `id` is PERSISTED in the saved order, so renaming one silently resets that
// user's layout to default. Change `label` freely; leave `id` alone.
// ─────────────────────────────────────────────────────────────────────────────

interface Col {
  id: string
  label: string
  /** Header tooltip — where a two-letter column earns its explanation. */
  title?: string
  align: 'left' | 'right'
  cell: (r: TopFlowRow) => ReactNode
  /** Row-dependent cell classes (the up/down inks). */
  cellClass?: (r: TopFlowRow) => string
  cellTitle?: (r: TopFlowRow) => string | undefined
  /** Values that must not break across two lines. */
  nowrap?: boolean
}

const COLS: Col[] = [
  {
    id: 'time', label: 'Time', align: 'left', nowrap: true,
    cell: (r) => fmtTime(r.ts),
    cellClass: () => 'tabular text-faint',
  },
  {
    id: 'ticker', label: 'Ticker', align: 'left',
    cell: (r) => r.underlying ?? '—',
    cellClass: () => 'font-semibold text-fg',
  },
  {
    id: 'contract', label: 'Contract', align: 'left', nowrap: true,
    cell: (r) => (
      <>
        <span className="text-fg">{fmtStrike(r.strike)}</span>
        <span className="text-faint"> {fmtExpiry(r.expiry)}</span>
      </>
    ),
    cellClass: () => 'tabular text-muted',
  },
  {
    id: 'cp', label: 'C/P', align: 'left',
    cell: (r) => r.type ?? '?',
    cellClass: (r) => `font-semibold ${r.type === 'P' ? 'text-down' : 'text-up'}`,
  },
  {
    id: 'side', label: 'Side', align: 'left', nowrap: true,
    title: 'Where the fill sat against the bid/ask at print time',
    cell: (r) => <SideCell r={r} />,
    cellClass: () => 'tabular font-semibold',
  },
  {
    id: 'bs', label: 'B/S', align: 'left',
    title: 'Above ask or at ask = bought. At bid or below bid = sold. Mid is not a read',
    cell: (r) => r.action ?? (r.side === 'mid' ? 'n/a' : '—'),
    cellClass: (r) =>
      `font-semibold ${r.action === 'BUY' ? 'text-up' : r.action === 'SELL' ? 'text-down' : 'text-faint opacity-70'}`,
    cellTitle: (r) =>
      r.action
        ? undefined
        : r.side === 'mid'
          ? 'Filled between the bid and the ask — genuinely ambiguous, so no call is made'
          : REASON_TITLE[r.sideReason ?? 'pending'],
  },
  {
    id: 'dte', label: 'DTE', align: 'right',
    cell: (r) => (r.dte === null ? '—' : r.dte),
    cellClass: () => 'tabular text-muted',
  },
  {
    id: 'size', label: 'Size', align: 'right',
    cell: (r) => fmtNum(r.size),
    cellClass: () => 'tabular text-muted',
  },
  {
    id: 'price', label: 'Price', align: 'right',
    cell: (r) => fmtPrice(r.price),
    cellClass: () => 'tabular text-muted',
  },
  {
    id: 'premium', label: 'Premium', align: 'right',
    cell: (r) => fmtPremium(r.premium),
    cellClass: (r) => `tabular font-semibold ${r.type === 'P' ? 'text-down' : 'text-up'}`,
  },
  {
    id: 'vol', label: 'Vol', align: 'right',
    title: "The contract's own volume so far today",
    cell: (r) => fmtNum(r.vol),
    cellClass: () => 'tabular text-muted',
  },
  {
    id: 'oi', label: 'OI', align: 'right',
    title: "The contract's open interest",
    cell: (r) => fmtNum(r.oi),
    cellClass: () => 'tabular text-muted',
  },
]

const COL_BY_ID = new Map(COLS.map((c) => [c.id, c]))
const DEFAULT_ORDER = COLS.map((c) => c.id)

/**
 * A saved order, repaired against the CURRENT column list.
 *
 * Two failure modes, both of which have to heal silently rather than throw the
 * layout away:
 *
 *   • an id that no longer exists (a column was removed) is DROPPED, not left
 *     to render undefined;
 *   • an id that is missing (a column was ADDED since this order was saved) is
 *     APPENDED. Without this, every existing user's card would simply never
 *     show a new column, which is a bug report nobody can diagnose from the UI.
 */
function repairOrder(saved: unknown): string[] {
  const list = Array.isArray(saved) ? saved.filter((x): x is string => typeof x === 'string') : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of list) {
    if (COL_BY_ID.has(id) && !seen.has(id)) { seen.add(id); out.push(id) }
  }
  for (const id of DEFAULT_ORDER) if (!seen.has(id)) out.push(id)
  return out
}

const DEFAULTS: Settings = {
  minPremium: 250_000,
  maxDte: null,
  sort: 'premium',
  rows: 50,
  order: DEFAULT_ORDER,
  showUnreadable: false,
  moneyness: 'all',
}

/** Per COPY of the card, not per card type — two Top Flows side by side are
 *  almost always two different questions (0DTE whales vs the month's biggest),
 *  and two different column orders to go with them. */
const settingsKey = (instanceId: string) => `cb-v3-board-topflow:${instanceId}`

function loadSettings(instanceId: string): Settings {
  try {
    const raw = localStorage.getItem(settingsKey(instanceId))
    if (!raw) return DEFAULTS
    const j = JSON.parse(raw) as Partial<Settings>
    return {
      // Each field validated on its own: a stored value from an older stop list
      // must fall back to the default, not poison the whole object.
      minPremium: PREMIUM_STOPS.some((s) => s.value === j.minPremium)
        ? (j.minPremium as number) : DEFAULTS.minPremium,
      maxDte: DTE_STOPS.some((s) => s.value === (j.maxDte ?? null))
        ? (j.maxDte ?? null) : DEFAULTS.maxDte,
      sort: j.sort === 'time' || j.sort === 'premium' ? j.sort : DEFAULTS.sort,
      rows: ROW_STOPS.includes(j.rows as (typeof ROW_STOPS)[number]) ? (j.rows as number) : DEFAULTS.rows,
      order: repairOrder(j.order),
      showUnreadable: j.showUnreadable === true,
      moneyness: j.moneyness === 'otm' ? 'otm' : DEFAULTS.moneyness,
    }
  } catch {
    return DEFAULTS
  }
}

function Cog({
  s,
  onPatch,
  orderChanged,
}: {
  s: Settings
  onPatch: (p: Partial<Settings>) => void
  orderChanged: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Top Flow settings"
        title="Sort, minimum premium, expiry window, row count and column order"
        className={[
          'flex items-center rounded-sm border px-1.5 py-0.5 leading-none transition-colors',
          open ? 'border-accent bg-raised text-fg' : 'border-line text-muted opacity-60 hover:opacity-100',
        ].join(' ')}
      >
        <svg
          aria-hidden
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
      </button>
      <Popover open={open} onClose={() => setOpen(false)}>
        <div className="flex w-56 flex-col gap-2">
          <PanelSection title="Sort">
            <SegGroup<SortKey>
              title="What the list is ranked by"
              options={[
                { label: 'BIGGEST', value: 'premium', title: 'The session’s largest prints by dollar premium — a leaderboard, so rows move as bigger trades land' },
                { label: 'NEWEST', value: 'time', title: 'Most recent first — a tape, newest at the top' },
              ]}
              value={s.sort}
              onChange={(v) => onPatch({ sort: v })}
            />
          </PanelSection>
          <PanelSection title="Min premium">
            <SegGroup<string>
              title="Hide prints below this dollar premium"
              options={PREMIUM_STOPS.map((p) => ({ label: p.label, value: String(p.value) }))}
              value={String(s.minPremium)}
              onChange={(v) => onPatch({ minPremium: Number(v) })}
            />
            <span className="text-3xs leading-snug text-faint opacity-70">
              $50K is the floor the server sweeps at — nothing smaller is collected, so no
              lower setting exists.
            </span>
          </PanelSection>
          <PanelSection title="Max DTE">
            <SegGroup<string>
              title="Only contracts expiring within this many days"
              options={DTE_STOPS.map((d) => ({
                label: d.label,
                value: String(d.value),
                title: d.title,
              }))}
              value={String(s.maxDte)}
              onChange={(v) => onPatch({ maxDte: v === 'null' ? null : Number(v) })}
            />
          </PanelSection>
          <PanelSection title="Rows">
            <SegGroup<string>
              title="How many prints to list"
              options={ROW_STOPS.map((n) => ({ label: String(n), value: String(n) }))}
              value={String(s.rows)}
              onChange={(v) => onPatch({ rows: Number(v) })}
            />
          </PanelSection>
          <PanelSection title="Prints">
            <Chip
              label="SHOW UNREADABLE"
              on={s.showUnreadable}
              onClick={() => onPatch({ showUnreadable: !s.showUnreadable })}
              title="Include prints whose side could not be read — mid fills, and ones that arrived unclassified. Off by default: if you cannot tell which side it was, it is not a row you can trade off"
            />
            <span className="text-3xs leading-snug text-faint opacity-70">
              Filtered on the SERVER, before the row limit — so 50 rows means 50
              readable prints, not 50 minus the mids.
            </span>
          </PanelSection>
          <PanelSection title="Columns">
            <span className="text-3xs leading-snug text-faint opacity-70">
              Drag a column heading sideways to move it. The order is saved for this card.
            </span>
            {/* Only once there is something to undo — a Reset that resets to
                what you are already looking at is a dead control. */}
            {orderChanged && (
              <button
                type="button"
                onClick={() => onPatch({ order: DEFAULT_ORDER })}
                className="self-start rounded-sm border border-line px-2 py-0.5 text-2xs font-semibold text-muted opacity-60 transition-colors hover:opacity-100"
              >
                RESET ORDER
              </button>
            )}
          </PanelSection>
        </div>
      </Popover>
    </div>
  )
}

export function TopFlowCard({ instanceId = 'top-flow' }: { instanceId?: string } = {}) {
  const [s, setS] = useState<Settings>(() => loadSettings(instanceId))
  const patch = (p: Partial<Settings>) => setS((prev) => ({ ...prev, ...p }))

  useEffect(() => {
    try {
      localStorage.setItem(settingsKey(instanceId), JSON.stringify(s))
    } catch {
      /* best-effort — the in-memory choice still drives this session */
    }
  }, [instanceId, s])

  // ── Column drag ────────────────────────────────────────────────────────────
  //
  // HTML5 drag-and-drop rather than pointer events, for one specific reason:
  // this card lives on a board whose tiles are themselves dragged with pointer
  // events. A pointer-based reorder here would be racing the board's own drag
  // for the same gesture. `draggable` runs on a different event channel
  // entirely, and the pointerdown guard below stops the board ever seeing the
  // press that starts a column drag.
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  // ── Row click → the contract probe ─────────────────────────────────────────
  //
  // The SELECTED ID is held, not the row object: the list re-polls every 20s and
  // a held object would freeze the drawer's Vol/OI at whatever they were when it
  // opened, while the row behind it kept updating. Looking the id up each render
  // means the panel tracks the same print the table is showing, and closes
  // itself when that print filters out from under it.
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // The drawer costs ~330px. On a full-width board card that is a third of the
  // table; on a half-width one it is the whole thing, so below the threshold the
  // probe TAKES OVER the card instead of squeezing the list into a gutter.
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => {
      if (e) setNarrow(e.contentRect.width < 720)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const cols = useMemo(
    () => s.order.map((id) => COL_BY_ID.get(id)).filter((c): c is Col => Boolean(c)),
    [s.order],
  )
  const orderChanged = useMemo(
    () => s.order.join(',') !== DEFAULT_ORDER.join(','),
    [s.order],
  )

  const moveColumn = (from: string, to: string) => {
    if (from === to) return
    const next = s.order.filter((id) => id !== from)
    const at = next.indexOf(to)
    if (at === -1) return
    // Dropping on a column to the RIGHT of where you started lands AFTER it;
    // to the left, before it. That is what the drop indicator is drawing, and
    // it is the behaviour every spreadsheet has trained the hand for.
    const fromIdx = s.order.indexOf(from)
    const toIdx = s.order.indexOf(to)
    next.splice(fromIdx < toIdx ? at + 1 : at, 0, from)
    patch({ order: next })
  }

  const url = useMemo(() => {
    const sp = new URLSearchParams({
      min_premium: String(s.minPremium),
      sort: s.sort,
      limit: String(s.rows),
    })
    if (s.maxDte !== null) sp.set('max_dte', String(s.maxDte))
    if (s.showUnreadable) sp.set('sides', 'all')
    if (s.moneyness === 'otm') sp.set('moneyness', 'otm')
    return `/api/lse/top-flow?${sp.toString()}`
    // Column order is presentation only — it must NOT rebuild the URL and
    // refetch the session every time a heading is dragged.
  }, [s.minPremium, s.maxDte, s.sort, s.rows, s.showUnreadable, s.moneyness])

  const q = useQuery<TopFlowResponse>(url, { staleMs: 10_000, pollMs: POLL_MS })
  const rows = q.data?.rows ?? []

  // The age of the newest print has to keep counting once the data stops
  // arriving — that is the whole point of showing it. Nothing else re-renders
  // this card when a feed goes quiet.
  const tick = useTick()
  const ageSec = useMemo(
    () => {
      const ts = q.data?.newestTs
      return ts ? Math.max(0, (Date.now() - ts) / 1000) : null
    },
    // `tick` is the trigger, not an input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q.data?.newestTs, tick],
  )
  // Staleness only MEANS anything while the vault's session is today's. Outside
  // market hours the newest print is hours old by definition, and colouring
  // that warn every evening would train the eye to ignore the one signal on the
  // card that matters during the day.
  const todayEt = useMemo(
    () =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date()),
    // Recomputed on the slow clock so the card rolls over at midnight ET
    // without a remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick],
  )
  const liveSession = Boolean(q.data?.sessionDate) && q.data?.sessionDate === todayEt
  const stale = liveSession && ageSec !== null && ageSec >= STALE_AFTER_SEC
  const failed = Boolean(q.error) || Boolean(q.data?.error)

  const totalPrem = useMemo(() => rows.reduce((sum, r) => sum + r.premium, 0), [rows])
  // Buy/sell balance across what is ON SCREEN — the one number that turns a
  // list of prints into a read. Mid prints are in neither bucket by design.
  const flowSkew = useMemo(() => {
    let buy = 0
    let sell = 0
    for (const r of rows) {
      if (r.action === 'BUY') buy += r.premium
      else if (r.action === 'SELL') sell += r.premium
    }
    return { buy, sell }
  }, [rows])

  const selected = useMemo(
    () => (selectedId ? rows.find((r) => r.id === selectedId) ?? null : null),
    [rows, selectedId],
  )
  // The print scrolled out of the filters (or the session rolled). Nothing to
  // show, so stop showing it rather than pinning a stale panel open.
  useEffect(() => {
    if (selectedId && q.data && !rows.some((r) => r.id === selectedId)) setSelectedId(null)
  }, [selectedId, rows, q.data])

  const ex = q.data?.excluded
  const hiddenCount = ex ? ex.mid + ex.pending + ex.stale + ex.other + ex.itm : 0

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2"
      // For the caption under a CopyShot. See shell/snapshot.ts.
      data-capture-meta={`whole market · ${s.sort === 'premium' ? 'biggest' : 'newest'} · ≥${fmtPremium(s.minPremium)}${s.maxDte === null ? '' : ` · ≤${s.maxDte} DTE`}`}
    >
      <CardToolbar>
        <span
          title={
            failed
              ? `The last sweep failed — showing the last data that arrived. ${q.data?.error ?? q.error?.message ?? ''}`
              : 'When the server last swept the vault'
          }
          className={[
            'tabular w-[54px] rounded-sm bg-raised px-2 py-0.5 text-center text-3xs',
            failed ? 'text-warn' : q.data ? 'text-accent' : 'text-down',
          ].join(' ')}
        >
          {failed ? 'ERROR' : q.data ? 'VAULT' : 'WAITING'}
        </span>
        {/* Only when the quote feed is the thing that is down. The rest of the
            card is fine in that state, so this must not read as a card error. */}
        {q.data && q.data.statsError ? (
          <span
            className="w-[46px] text-2xs text-warn"
            title={`Live quotes / volume / OI are unavailable, so Side, Buy-Sell, Vol and OI are blank. ${q.data.statsError}`}
          >
            no quotes
          </span>
        ) : null}
        {/* In the TOOLBAR rather than the cog: this is the one filter that gets
            flipped mid-session while you are reading the tape, and a control you
            reach for that often does not belong two clicks deep. */}
        <SegGroup<Moneyness>
          title="Moneyness at the moment the print hit the tape"
          options={[
            { label: 'OTM', value: 'otm', title: 'Only strikes that were out of the money when they printed — calls above spot, puts below it' },
            { label: 'ALL', value: 'all', title: 'Every strike, in and out of the money' },
          ]}
          value={s.moneyness}
          onChange={(v) => patch({ moneyness: v })}
        />
        <Cog s={s} onPatch={patch} orderChanged={orderChanged} />
      </CardToolbar>

      <div className="flex flex-wrap items-baseline gap-4 px-1 text-xs text-muted">
        <span className="font-bold uppercase tracking-[0.08em] text-fg">
          {s.sort === 'premium' ? 'Biggest' : 'Newest'}
        </span>
        <span>
          <strong className="tabular text-fg">{rows.length.toLocaleString()}</strong>
          {q.data && q.data.matched > rows.length ? (
            <span className="text-faint"> of {q.data.matched.toLocaleString()}</span>
          ) : null}{' '}
          prints
        </span>
        <span>
          Total <strong className="tabular text-fg">{fmtPremium(totalPrem)}</strong>
        </span>
        <span title="Premium that lifted the offer vs premium that hit the bid, across the rows on screen. Mid prints are in neither.">
          Bought <strong className="tabular text-up">{fmtPremium(flowSkew.buy)}</strong>
          {' · '}
          Sold <strong className="tabular text-down">{fmtPremium(flowSkew.sell)}</strong>
        </span>
        <span className="text-faint">
          ≥{fmtPremium(s.minPremium)}
          {s.maxDte === null ? '' : ` · ≤${s.maxDte} DTE`}
          {s.moneyness === 'otm' ? ' · OTM' : ''}
        </span>
        {/* A filter that removes rows has to say so. Silently showing fewer
            prints than the market printed is how a card gets mistrusted. */}
        {hiddenCount > 0 && (
          <span
            className="text-faint opacity-70"
            title={[
              `Unreadable side: ${q.data?.excluded.mid ?? 0} mid, ${q.data?.excluded.pending ?? 0} awaiting a quote, ${q.data?.excluded.stale ?? 0} too old to judge.`,
              (q.data?.excluded.itm ?? 0) > 0 ? `In the money at print time: ${q.data?.excluded.itm ?? 0}.` : '',
              'SHOW UNREADABLE is in the cog; OTM/ALL is in the toolbar.',
            ].filter(Boolean).join(' ')}
          >
            {hiddenCount.toLocaleString()} hidden
          </span>
        )}
        {/* Two facts, no verdict — see the header note. */}
        {q.data?.newestTs ? (
          <span
            className={['tabular ml-auto', stale ? 'text-warn' : 'text-faint'].join(' ')}
            title="The newest print in the vault's session, and how long ago it was. This is the feed's live edge, not this card's refresh"
          >
            {liveSession
              ? `newest ${fmtTime(q.data.newestTs)} · ${fmtAgo(ageSec)} ago`
              : `session ${q.data.sessionDate} · closed`}
          </span>
        ) : null}
      </div>

      <div ref={wrapRef} className="flex min-h-0 flex-1">
        {/* Hidden, not unmounted, when the probe takes over a narrow card: the
            table's scroll position survives closing the panel. */}
        <div
          className="min-h-0 flex-1 overflow-auto"
          style={narrow && selected ? { display: 'none' } : undefined}
        >
        <table className="w-full border-collapse text-2xs">
          <thead className="sticky top-0 z-[1] bg-bg">
            <tr className="text-3xs uppercase tracking-[0.08em] text-faint">
              {cols.map((c) => {
                const isDragging = dragId === c.id
                const isOver = overId === c.id && dragId !== null && dragId !== c.id
                // Which edge the drop indicator sits on has to match where the
                // column will actually land, or the line lies about the result.
                const fromIdx = dragId ? s.order.indexOf(dragId) : -1
                const toIdx = s.order.indexOf(c.id)
                const insertAfter = fromIdx !== -1 && fromIdx < toIdx
                return (
                  <th
                    key={c.id}
                    scope="col"
                    draggable
                    // The board tile underneath drags on pointerdown. Without
                    // this, grabbing a heading picks up the whole card.
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onDragStart={(e) => {
                      setDragId(c.id)
                      e.dataTransfer.effectAllowed = 'move'
                      // Firefox refuses to start a drag with no payload set.
                      try { e.dataTransfer.setData('text/plain', c.id) } catch { /* older browsers */ }
                    }}
                    onDragOver={(e) => {
                      if (!dragId) return
                      // preventDefault is what makes this a valid drop target.
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                      if (overId !== c.id) setOverId(c.id)
                    }}
                    onDragLeave={() => setOverId((id) => (id === c.id ? null : id))}
                    onDrop={(e) => {
                      e.preventDefault()
                      if (dragId) moveColumn(dragId, c.id)
                      setDragId(null)
                      setOverId(null)
                    }}
                    onDragEnd={() => { setDragId(null); setOverId(null) }}
                    title={c.title ? `${c.title} — drag to reorder` : 'Drag to reorder'}
                    className={[
                      'cursor-grab select-none px-1.5 py-1 font-bold transition-colors active:cursor-grabbing',
                      c.align === 'right' ? 'text-right' : 'text-left',
                      isDragging ? 'opacity-40' : '',
                      // A 2px inset shadow rather than a border: a border would
                      // change the cell's width mid-drag and shuffle every
                      // heading sideways under the pointer.
                      isOver
                        ? insertAfter
                          ? 'shadow-[inset_-2px_0_0_0_var(--color-accent)]'
                          : 'shadow-[inset_2px_0_0_0_var(--color-accent)]'
                        : '',
                    ].join(' ')}
                  >
                    {c.label}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                onClick={() => setSelectedId((id) => (id === r.id ? null : r.id))}
                title="Open the contract's chart"
                className={[
                  'cursor-pointer border-t border-line hover:bg-raised',
                  r.id === selectedId ? 'bg-raised' : '',
                ].join(' ')}
              >
                {cols.map((c) => (
                  <td
                    key={c.id}
                    title={c.cellTitle ? c.cellTitle(r) : undefined}
                    className={[
                      'px-1.5 py-1',
                      c.align === 'right' ? 'text-right' : 'text-left',
                      c.nowrap ? 'whitespace-nowrap' : '',
                      c.cellClass ? c.cellClass(r) : '',
                    ].join(' ')}
                  >
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {/* An empty list has three causes and they are not the same problem. */}
        {rows.length === 0 && (
          <div className="px-1.5 py-3 text-xs text-faint">
            {failed
              ? 'The vault sweep failed — nothing to show yet.'
              : q.loading || !q.data
                ? 'Loading…'
                : hiddenCount > 0
                  ? `Nothing left after filtering — ${hiddenCount.toLocaleString()} prints hidden${q.data?.statsError ? ' (the quote feed is down, so nothing can be classified)' : ''}. Try ALL in the toolbar, or SHOW UNREADABLE in the cog.`
                  : 'No prints match these filters yet.'}
          </div>
        )}
        </div>

        {selected && (
          <div
            className={[
              'flex min-h-0 shrink-0 flex-col',
              narrow ? 'w-full' : 'w-[330px] border-l border-line',
            ].join(' ')}
          >
            {/* Keyed on the print id so switching rows remounts the panel —
                otherwise the range tabs and the fallback-source state carry over
                from the last contract. */}
            <ContractProbe key={selected.id} row={selected} onClose={() => setSelectedId(null)} />
          </div>
        )}
      </div>
    </div>
  )
}
