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
// two things. They share the FEED (/api/chains) and nothing else.
//
// ── The four decisions ───────────────────────────────────────────────────────
//  1. THE COLUMNS ARE THE USER'S. Sixteen fields are available; four presets
//     seed the common reads and any subset can be picked. The layout persists,
//     because a chain layout is a habit, not a preference you re-set daily.
//  2. THE STRIKE WINDOW IS BOUNDED BY DEFAULT. SPX lists hundreds of strikes
//     per expiry and a chain that renders all of them on open is a page that
//     takes a second to paint before you have asked it anything. 40 around ATM
//     opens; "All" is one click and is an explicit choice.
//  3. THE ACCORDION IS THE EXPIRATION PICKER. There is no dropdown: expiries
//     are rows, several can be open at once, and each loads when it is opened.
//     That is the ToS/tasty behaviour and it is also the only shape that lets
//     two expiries be compared without leaving the page.
//  4. IT FOLLOWS THE BOARD SYMBOL. Like every other v3 page — the toolbar owns
//     the ticker (data/symbol.tsx) and this page carries no ticker box.
//
// REST + a 20s poll, no socket, no canvas: non-negotiables 2, 4, 5 and 6 have
// nothing to bite on here. The entry load is two parallel requests (#3).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePageSymbol } from '@/data/symbol'
import { Chip, PanelSection, Popover, SegGroup } from '@/design/primitives/Controls'
import { T, alpha } from '@/design/theme'
import { ChainGrid } from './chain/ChainGrid'
import {
  CHAIN_COLUMNS,
  CHAIN_PRESETS,
  DEFAULT_COLUMNS,
  resolveColumns,
  sanitizeColumns,
} from './chain/chainColumns'
import { useChainBook } from './chain/useChainBook'

const COLS_KEY = 'cb-v3-chain-columns'
const WINDOW_KEY = 'cb-v3-chain-window'

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

export default function Chain() {
  const { symbol } = usePageSymbol()
  const c = useChainBook(symbol)

  // ── Layout state ───────────────────────────────────────────────────────────
  // First render always uses the defaults and the stored layout is applied in
  // an effect, so the markup cannot mismatch on hydration — the same rule the
  // GEX matrix applies to its saved heat skin.
  const [columnKeys, setColumnKeys] = useState<string[]>(DEFAULT_COLUMNS)
  const [strikeWindow, setStrikeWindow] = useState('40')
  const [expiryCount, setExpiryCount] = useState('12')
  const [colsOpen, setColsOpen] = useState(false)

  useEffect(() => {
    const raw = readStored(COLS_KEY, '')
    if (raw) {
      try {
        setColumnKeys(sanitizeColumns(JSON.parse(raw)))
      } catch {
        /* a corrupt layout falls back to the default rather than blanking */
      }
    }
    const w = readStored(WINDOW_KEY, '')
    if (WINDOWS.some((o) => o.value === w)) setStrikeWindow(w)
  }, [])

  const applyColumns = useCallback((keys: string[]) => {
    const next = sanitizeColumns(keys)
    setColumnKeys(next)
    writeStored(COLS_KEY, JSON.stringify(next))
  }, [])

  const toggleColumn = useCallback(
    (key: string) => {
      const has = columnKeys.includes(key)
      // The last column may not be removed: a chain with no columns is a list
      // of strikes, and there is no control left on screen to get back from it.
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

  const changeWindow = useCallback((v: string) => {
    setStrikeWindow(v)
    writeStored(WINDOW_KEY, v)
  }, [])

  const columns = useMemo(() => resolveColumns(columnKeys), [columnKeys])
  const activePreset = useMemo(
    () => CHAIN_PRESETS.find((p) => p.columns.join(',') === columnKeys.join(',')),
    [columnKeys],
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

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setColsOpen((v) => !v)}
            title="Choose the columns, or start from a preset"
            className="flex items-center gap-1 rounded-sm border border-line px-2 py-0.5 text-2xs font-semibold tracking-wide text-muted hover:bg-raised hover:text-fg"
          >
            {activePreset ? activePreset.label : `${columns.length} columns`}
            <span className="text-3xs opacity-50">▾</span>
          </button>
          <Popover open={colsOpen} onClose={() => setColsOpen(false)} align="left">
            <div className="flex w-max max-w-xs flex-col gap-2">
              <PanelSection title="Preset">
                <div className="flex flex-wrap gap-1">
                  {CHAIN_PRESETS.map((p) => (
                    <Chip
                      key={p.key}
                      label={p.label}
                      title={p.title}
                      on={activePreset?.key === p.key}
                      onClick={() => applyColumns(p.columns)}
                    />
                  ))}
                </div>
              </PanelSection>
              <PanelSection title="Columns — inner to outer">
                <div className="flex flex-wrap gap-1">
                  {CHAIN_COLUMNS.map((col) => (
                    <Chip
                      key={col.key}
                      label={col.label}
                      title={col.title}
                      on={columnKeys.includes(col.key)}
                      onClick={() => toggleColumn(col.key)}
                    />
                  ))}
                </div>
              </PanelSection>
            </div>
          </Popover>
        </div>

        <span className="ml-auto flex items-center gap-2">
          {c.updatedAt > 0 && (
            <span className="tabular text-3xs" style={{ color: T.muted, opacity: 0.55 }}>
              {clockOf(c.updatedAt)}
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
            spot={spot}
            strikeWindow={Number(strikeWindow) || 0}
            onToggle={c.toggle}
          />
        )}
      </div>
    </main>
  )
}

/** The load clock, in ET — the session's own timezone, not the reader's. */
function clockOf(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return ''
  }
}
