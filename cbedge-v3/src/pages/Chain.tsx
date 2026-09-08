// ─────────────────────────────────────────────────────────────────────────────
// CHAIN — /v3/chain
//
// THE OPTION CHAIN, in the sense thinkorswim and tastytrade mean it: calls on
// the left, puts on the right, strikes down the middle, expirations as
// collapsible groups, and the quotes themselves in the cells.
//
// ── Why this is a SECOND page and not a rewrite of /v3/options-chain ─────────
// /v3/options-chain is not this. It is a GEX MATRIX — one column per expiration
// across a shared strike axis, every cell a derived exposure painted by a heat
// skin. It answers "where is the gamma". This page answers the other question a
// chain is opened for: "what is this contract quoted at, how liquid is it, and
// what are its greeks". One surface cannot do both without one of them
// becoming a mode of the other, and a mode is where a page goes to be half of
// two things. They share the FEED (/api/chains) and nothing else — and where
// they both compute a net exposure, this page uses the matrix's formulas
// verbatim so one strike cannot read two numbers on two pages.
//
// ── The decisions ────────────────────────────────────────────────────────────
//  1. THE LAYOUT IS THE USER'S — which columns, and IN WHAT ORDER. Eighteen
//     wing fields and eight centre (net) fields, five presets to start from,
//     and every list is reorderable. It all persists, because a chain layout is
//     a habit, not a preference you re-set daily.
//  2. THE STRIKE WINDOW IS BOUNDED BY DEFAULT. SPX lists hundreds of strikes
//     per expiry and a chain that renders all of them on open is a page that
//     takes a second to paint before you have asked it anything. 40 around ATM
//     opens; "All" is one click and is an explicit choice.
//  3. THE ACCORDION IS THE EXPIRATION PICKER. There is no dropdown: expiries
//     are rows, several can be open at once, and each loads when it is opened.
//     That is the ToS/tasty behaviour and it is also the only shape that lets
//     two expiries be compared without leaving the page.
//  4. GREEKS HAVE A SOURCE, AND IT IS VISIBLE. Feed by default; Black-Scholes
//     recomputes every greek — and every net exposure built on them — from one
//     model, solving IV off the mark wherever the feed sent none. It is a
//     labelled toggle, never a silent substitution.
//  5. EVERY NUMBER SAYS WHEN IT WAS COLLECTED. One clock in the toolbar for the
//     page, and one on EACH open expiry row, because only expanded expiries
//     poll — a single stamp would claim a freshness the collapsed rows do not
//     have.
//  6. IT FOLLOWS THE BOARD SYMBOL. Like every other v3 page — the toolbar owns
//     the ticker (data/symbol.tsx) and this page carries no ticker box.
//
// REST + a 20s poll, no socket, no canvas: non-negotiables 2, 4, 5 and 6 have
// nothing to bite on here. The entry load is two parallel requests (#3).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePageSymbol } from '@/data/symbol'
import { Chip, PanelSection, Popover, SegGroup } from '@/design/primitives/Controls'
import { T, alpha } from '@/design/theme'
import { ChainGrid, etClock, type ChainDisplay, type GreekSource } from './chain/ChainGrid'
import { BS_DIV_YIELD, BS_RATE } from './chain/blackScholes'
import {
  CENTER_COLUMNS,
  CENTER_BY_KEY,
  CHAIN_COLUMNS,
  CHAIN_PRESETS,
  COLUMN_BY_KEY,
  DEFAULT_CENTER,
  DEFAULT_COLUMNS,
  moveKey,
  resolveCenter,
  resolveColumns,
  sanitizeCenter,
  sanitizeColumns,
} from './chain/chainColumns'
import { useChainBook } from './chain/useChainBook'

const COLS_KEY = 'cb-v3-chain-columns'
const CENTER_KEY = 'cb-v3-chain-center'
const WINDOW_KEY = 'cb-v3-chain-window'
const GREEKS_KEY = 'cb-v3-chain-greeks'
const DISPLAY_KEY = 'cb-v3-chain-display'

interface SegOption {
  label: string
  value: string
  title?: string
}

/** Strikes drawn per expiry, centred on spot. 0 = every listed strike. */
const WINDOWS: SegOption[] = [
  { label: '20', value: '20', title: '20 strikes around the money' },
  { label: '40', value: '40', title: '40 strikes around the money' },
  { label: '80', value: '80', title: '80 strikes around the money' },
  { label: 'All', value: '0', title: 'Every listed strike — slow on SPX' },
]

/** How much of the expiry ladder the accordion offers. SPX lists ~100. */
const EXPIRY_COUNTS: SegOption[] = [
  { label: '6', value: '6' },
  { label: '12', value: '12' },
  { label: '30', value: '30' },
  { label: 'All', value: '0' },
]

const GREEK_SOURCES: SegOption[] = [
  { label: 'Feed', value: 'feed', title: "The vendor's greeks, exactly as they arrive" },
  {
    label: 'B-S',
    value: 'bs',
    title: `Black-Scholes, recomputed against the live spot at r ${(BS_RATE * 100).toFixed(1)}% / q ${(
      BS_DIV_YIELD * 100
    ).toFixed(1)}%. Solves IV off the mark where the feed sent none, and the net exposures follow.`,
  },
]

const DEFAULT_DISPLAY: ChainDisplay = { zebra: true, itm: true, lines: false }

function readStored(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* private mode — the choice still holds for this session */
  }
}

function readJson<T>(key: string, parse: (raw: unknown) => T, fallback: T): T {
  const raw = readStored(key, '')
  if (!raw) return fallback
  try {
    return parse(JSON.parse(raw))
  } catch {
    // A corrupt layout falls back to the default rather than blanking the page.
    return fallback
  }
}

/** Ticks once a second while the tab is visible — for the "how old is this"
 *  readout, and nothing else. Stops when hidden: a background tab counting
 *  seconds nobody can see is a wakeup a minute for no reason. */
function useSecond(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      setNow(Date.now())
    }
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

function ago(ms: number, now: number): string {
  if (!ms) return ''
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

export default function Chain() {
  const { symbol } = usePageSymbol()
  const c = useChainBook(symbol)

  // ── Layout state ───────────────────────────────────────────────────────────
  // First render always uses the defaults and the stored layout is applied in
  // an effect, so the markup cannot mismatch on hydration — the same rule the
  // GEX matrix applies to its saved heat skin.
  const [columnKeys, setColumnKeys] = useState<string[]>(DEFAULT_COLUMNS)
  const [centerKeys, setCenterKeys] = useState<string[]>(DEFAULT_CENTER)
  const [strikeWindow, setStrikeWindow] = useState('40')
  const [expiryCount, setExpiryCount] = useState('12')
  const [greekSource, setGreekSource] = useState<GreekSource>('feed')
  const [display, setDisplay] = useState<ChainDisplay>(DEFAULT_DISPLAY)
  const [colsOpen, setColsOpen] = useState(false)

  useEffect(() => {
    setColumnKeys(readJson(COLS_KEY, sanitizeColumns, DEFAULT_COLUMNS))
    setCenterKeys(readJson(CENTER_KEY, sanitizeCenter, DEFAULT_CENTER))
    setDisplay(
      readJson<ChainDisplay>(
        DISPLAY_KEY,
        (raw) => {
          const o = (raw ?? {}) as Partial<ChainDisplay>
          return {
            zebra: typeof o.zebra === 'boolean' ? o.zebra : DEFAULT_DISPLAY.zebra,
            itm: typeof o.itm === 'boolean' ? o.itm : DEFAULT_DISPLAY.itm,
            lines: typeof o.lines === 'boolean' ? o.lines : DEFAULT_DISPLAY.lines,
          }
        },
        DEFAULT_DISPLAY,
      ),
    )
    const w = readStored(WINDOW_KEY, '')
    if (WINDOWS.some((o) => o.value === w)) setStrikeWindow(w)
    const g = readStored(GREEKS_KEY, '')
    if (g === 'feed' || g === 'bs') setGreekSource(g)
  }, [])

  // ── Layout writers ─────────────────────────────────────────────────────────
  const applyColumns = useCallback((keys: string[]) => {
    const next = sanitizeColumns(keys)
    setColumnKeys(next)
    writeStored(COLS_KEY, JSON.stringify(next))
  }, [])

  const applyCenter = useCallback((keys: string[]) => {
    const next = sanitizeCenter(keys)
    setCenterKeys(next)
    writeStored(CENTER_KEY, JSON.stringify(next))
  }, [])

  const applyPreset = useCallback(
    (key: string) => {
      const p = CHAIN_PRESETS.find((x) => x.key === key)
      if (!p) return
      applyColumns(p.columns)
      applyCenter(p.center)
    },
    [applyColumns, applyCenter],
  )

  const toggleColumn = useCallback(
    (key: string) => {
      const has = columnKeys.includes(key)
      // The last WING column may not be removed: a chain with no wing columns
      // is a list of strikes, and there is no cell left to click back from.
      // Centre columns have no such floor — empty is their default.
      if (has && columnKeys.length === 1) return
      applyColumns(
        has
          ? columnKeys.filter((k) => k !== key)
          : // Appended, so a new column lands on the OUTSIDE of both wings and
            // the columns already being read do not move under the cursor.
            [...columnKeys, key],
      )
    },
    [columnKeys, applyColumns],
  )

  const toggleCenter = useCallback(
    (key: string) => {
      applyCenter(
        centerKeys.includes(key) ? centerKeys.filter((k) => k !== key) : [...centerKeys, key],
      )
    },
    [centerKeys, applyCenter],
  )

  const changeWindow = useCallback((v: string) => {
    setStrikeWindow(v)
    writeStored(WINDOW_KEY, v)
  }, [])

  const changeGreeks = useCallback((v: string) => {
    const next: GreekSource = v === 'bs' ? 'bs' : 'feed'
    setGreekSource(next)
    writeStored(GREEKS_KEY, next)
  }, [])

  const toggleDisplay = useCallback((key: keyof ChainDisplay) => {
    setDisplay((cur) => {
      const next = { ...cur, [key]: !cur[key] }
      writeStored(DISPLAY_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const columns = useMemo(() => resolveColumns(columnKeys), [columnKeys])
  const center = useMemo(() => resolveCenter(centerKeys), [centerKeys])
  const activePreset = useMemo(
    () =>
      CHAIN_PRESETS.find(
        (p) => p.columns.join(',') === columnKeys.join(',') && p.center.join(',') === centerKeys.join(','),
      ),
    [columnKeys, centerKeys],
  )

  const expiries = useMemo(() => {
    const n = Number(expiryCount) || 0
    // An expiry that is OPEN is always offered, whatever the count — collapsing
    // the ladder must not make a chain you are reading disappear.
    if (!n || c.expiries.length <= n) return c.expiries
    const head = c.expiries.slice(0, n)
    const shown = new Set(head.map((e) => e.value))
    const extra = c.expiries.filter((e) => !shown.has(e.value) && c.open.includes(e.value))
    return [...head, ...extra].sort((a, b) => a.value.localeCompare(b.value))
  }, [c.expiries, c.open, expiryCount])

  // ── Centre on spot, once per symbol ────────────────────────────────────────
  // The scroll container opens at the top, which on a 40-strike window is 20
  // strikes above the money. The spot row is tagged in the grid; this finds it
  // after the first book lands and centres it, and does not fight the user
  // afterwards.
  const scrollRef = useRef<HTMLDivElement>(null)
  const centredFor = useRef('')
  useEffect(() => {
    const box = scrollRef.current
    if (!box || !c.updatedAt) return
    const key = `${symbol}|${c.open.join(',')}`
    if (centredFor.current === key) return
    const id = requestAnimationFrame(() => {
      const marker = box.querySelector('[data-cb-spot]')
      if (!(marker instanceof HTMLElement)) return
      centredFor.current = key
      // Measured, not offsetTop: the scroll container is not a positioned
      // ancestor, so offsetTop would be relative to something further up the
      // tree and the page would jump to the wrong place.
      const delta = marker.getBoundingClientRect().top - box.getBoundingClientRect().top
      box.scrollTop = Math.max(0, box.scrollTop + delta - box.clientHeight / 2)
    })
    return () => cancelAnimationFrame(id)
  }, [symbol, c.updatedAt, c.open])

  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await c.refresh()
    } finally {
      setRefreshing(false)
    }
  }, [c, refreshing])

  const now = useSecond(c.updatedAt > 0)
  const spot = c.underlying

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* ── Toolbar. Pinned; the grid scrolls below it in its own container so
             the column header stays stuck to the top of that scroll area. ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-bg px-2.5 py-1.5">
        <span className="text-sm font-bold tracking-wide text-fg">{symbol}</span>
        <span className="tabular text-sm font-semibold" style={{ color: T.cyan }}>
          {spot > 0 ? spot.toFixed(2) : '—'}
        </span>
        <span className="text-3xs uppercase tracking-[0.16em]" style={{ color: T.muted, opacity: 0.5 }}>
          Option chain
        </span>

        <span className="mx-1 h-4 w-px" style={{ background: T.border }} />

        <span className="text-3xs uppercase tracking-wide" style={{ color: T.muted, opacity: 0.6 }}>
          Strikes
        </span>
        <SegGroup options={WINDOWS} value={strikeWindow} onChange={changeWindow} />

        <span className="text-3xs uppercase tracking-wide" style={{ color: T.muted, opacity: 0.6 }}>
          Expiries
        </span>
        <SegGroup options={EXPIRY_COUNTS} value={expiryCount} onChange={setExpiryCount} />

        <span className="text-3xs uppercase tracking-wide" style={{ color: T.muted, opacity: 0.6 }}>
          Greeks
        </span>
        <SegGroup options={GREEK_SOURCES} value={greekSource} onChange={changeGreeks} />

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setColsOpen((v) => !v)}
            title="Add, remove and reorder columns, or start from a preset"
            className="flex items-center gap-1 rounded-sm border border-line px-2 py-0.5 text-2xs font-semibold tracking-wide text-muted hover:bg-raised hover:text-fg"
          >
            {activePreset ? activePreset.label : `${columns.length + center.length} cols`}
            <span className="text-3xs opacity-50">▾</span>
          </button>
          <Popover open={colsOpen} onClose={() => setColsOpen(false)} align="left">
            <div className="flex w-64 flex-col gap-2">
              <PanelSection title="Preset">
                <div className="flex flex-wrap gap-1">
                  {CHAIN_PRESETS.map((p) => (
                    <Chip
                      key={p.key}
                      label={p.label}
                      title={p.title}
                      on={activePreset?.key === p.key}
                      onClick={() => applyPreset(p.key)}
                    />
                  ))}
                </div>
              </PanelSection>

              <PanelSection title="Wing columns · top = nearest the strike">
                <OrderList
                  keys={columnKeys}
                  labelOf={(k) => COLUMN_BY_KEY.get(k)?.label ?? k}
                  titleOf={(k) => COLUMN_BY_KEY.get(k)?.title ?? ''}
                  onMove={(k, d) => applyColumns(moveKey(columnKeys, k, d))}
                  onRemove={(k) => toggleColumn(k)}
                  removable={columnKeys.length > 1}
                />
                <AddRow
                  all={CHAIN_COLUMNS.map((x) => ({ key: x.key, label: x.label, title: x.title }))}
                  active={columnKeys}
                  onAdd={toggleColumn}
                />
              </PanelSection>

              <PanelSection title="Centre columns · net, per strike">
                <OrderList
                  keys={centerKeys}
                  labelOf={(k) => CENTER_BY_KEY.get(k)?.label ?? k}
                  titleOf={(k) => CENTER_BY_KEY.get(k)?.title ?? ''}
                  onMove={(k, d) => applyCenter(moveKey(centerKeys, k, d))}
                  onRemove={toggleCenter}
                  removable
                  empty="None — the middle is just the strike."
                />
                <AddRow
                  all={CENTER_COLUMNS.map((x) => ({ key: x.key, label: x.label, title: x.title }))}
                  active={centerKeys}
                  onAdd={toggleCenter}
                />
              </PanelSection>

              <PanelSection title="Display">
                <div className="flex flex-wrap gap-1">
                  <Chip
                    label="Zebra"
                    title="Alternate row shading — what makes a wide row trackable across the full width"
                    on={display.zebra}
                    onClick={() => toggleDisplay('zebra')}
                  />
                  <Chip
                    label="ITM shade"
                    title="Wash the in-the-money side of each wing"
                    on={display.itm}
                    onClick={() => toggleDisplay('itm')}
                  />
                  <Chip
                    label="Grid lines"
                    title="A rule between every column, not just around the centre block"
                    on={display.lines}
                    onClick={() => toggleDisplay('lines')}
                  />
                </div>
              </PanelSection>
            </div>
          </Popover>
        </div>

        {/* ── When this data was collected ───────────────────────────────────
            The page clock is the most recent load of ANY open expiry; each
            expiry row carries its own, because only expanded expiries poll. */}
        <span className="ml-auto flex items-center gap-2">
          {c.updatedAt > 0 && (
            <span
              className="tabular text-3xs"
              title={`Collected at ${etClock(c.updatedAt)} ET · polls every 20s while the session is live`}
              style={{ color: T.muted, opacity: 0.6 }}
            >
              ⟳ {etClock(c.updatedAt)} ET · {ago(c.updatedAt, now)}
            </span>
          )}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing || !c.open.length}
            title="Re-fetch every expanded expiry, bypassing the server cache"
            className="rounded-sm border border-line px-2 py-0.5 text-2xs font-semibold tracking-wide text-muted hover:bg-raised hover:text-fg disabled:opacity-40"
          >
            {refreshing ? '↻ …' : '↻ Now'}
          </button>
        </span>
      </div>

      {c.error && (
        <div
          className="shrink-0 border-b border-line px-3 py-1.5 text-2xs"
          style={{ background: alpha(T.red, 0.1), color: T.red }}
        >
          {c.error}
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        {c.booting ? (
          <div className="p-6 text-center text-sm" style={{ color: T.muted, opacity: 0.6 }}>
            Loading {symbol} chain…
          </div>
        ) : expiries.length === 0 ? (
          <div className="p-6 text-center text-sm" style={{ color: T.muted, opacity: 0.6 }}>
            No listed expirations for {symbol}.
          </div>
        ) : (
          <ChainGrid
            expiries={expiries}
            books={c.books}
            open={c.open}
            pending={c.pending}
            columns={columns}
            center={center}
            spot={spot}
            strikeWindow={Number(strikeWindow) || 0}
            greekSource={greekSource}
            display={display}
            onToggle={c.toggle}
          />
        )}
      </div>
    </main>
  )
}

// ── The layout editor ────────────────────────────────────────────────────────
// Two halves, and they are deliberately different controls. ORDER is a list
// with arrows, because order is a sequence and a grid of chips cannot show one.
// MEMBERSHIP is a chip row, because it is a set. A single drag-and-drop widget
// would do both and would also be the one control on this page that does not
// work from a keyboard.

interface OrderListProps {
  keys: string[]
  labelOf: (key: string) => string
  titleOf: (key: string) => string
  onMove: (key: string, delta: number) => void
  onRemove: (key: string) => void
  removable: boolean
  empty?: string
}

function OrderList({ keys, labelOf, titleOf, onMove, onRemove, removable, empty }: OrderListProps) {
  if (!keys.length) {
    return (
      <span className="text-3xs" style={{ color: T.muted, opacity: 0.5 }}>
        {empty ?? 'None.'}
      </span>
    )
  }
  return (
    <div className="flex flex-col gap-0.5">
      {keys.map((k, i) => (
        <div
          key={k}
          className="flex items-center gap-1 rounded-sm border border-line px-1 py-0.5"
          style={{ background: alpha(T.text, 0.03) }}
        >
          <span className="tabular text-3xs" style={{ color: T.muted, opacity: 0.4, width: 14 }}>
            {i + 1}
          </span>
          <span className="flex-1 truncate text-2xs font-semibold text-fg" title={titleOf(k)}>
            {labelOf(k)}
          </span>
          <ArrowBtn label="▲" title="Move nearer the strike" disabled={i === 0} onClick={() => onMove(k, -1)} />
          <ArrowBtn
            label="▼"
            title="Move further out"
            disabled={i === keys.length - 1}
            onClick={() => onMove(k, 1)}
          />
          <ArrowBtn
            label="✕"
            title={removable ? 'Remove this column' : 'The last wing column cannot be removed'}
            disabled={!removable}
            onClick={() => onRemove(k)}
          />
        </div>
      ))}
    </div>
  )
}

function ArrowBtn({
  label,
  title,
  disabled,
  onClick,
}: {
  label: string
  title: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="rounded-sm px-1 text-3xs text-muted hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-25"
    >
      {label}
    </button>
  )
}

function AddRow({
  all,
  active,
  onAdd,
}: {
  all: Array<{ key: string; label: string; title: string }>
  active: string[]
  onAdd: (key: string) => void
}) {
  const rest = all.filter((x) => !active.includes(x.key))
  if (!rest.length) return null
  return (
    <div className="flex flex-wrap gap-1 pt-1">
      {rest.map((x) => (
        <Chip key={x.key} label={`+ ${x.label}`} title={x.title} on={false} onClick={() => onAdd(x.key)} />
      ))}
    </div>
  )
}
