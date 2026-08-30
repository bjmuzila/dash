import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CardToolbar } from '@/design/primitives/Card'
import { useQuery } from '@/data/api'
import { PAGE_TICKER_RE, usePageSymbol } from '@/data/symbol'
import { SegGroup, Slider, Popover, PanelSection, Chip } from '../gexCandles/controls'
import { CellCard } from './CellCard'
import {
  BASIS_LABEL,
  EX0_KEY,
  MAX_EXP_COLS,
  MAX_COLS,
  cellAlpha,
  columnStats,
  fmtGex,
  parseChain,
  pickColumns,
  strikeGex,
  withEx0Column,
  type Basis,
  type ParsedChain,
  type StrikeRow,
} from './mgMath'

// ─────────────────────────────────────────────────────────────────────────────
// Multi Greek — v2's /mult-greek board, as a single card.
//
// Up to four ticker panels side by side. Each is a strike ladder read DOWN, with
// one column per upcoming expiry read ACROSS, and the cell is that strike's net
// GEX at that expiry. The whole point is the across-read: the same strike on
// several symbols at the same DTE.
//
// ── Which symbols ────────────────────────────────────────────────────────────
// The FIRST panel is the BOARD's ticker — the card opens on whatever the page is
// already showing rather than on a hardcoded SPX, so it never contradicts the
// rest of the board on load. Typing in that panel's box moves the whole board,
// which is the only honest thing it can do: the panel IS the page symbol, not a
// copy of it.
//
// Every other panel is one the user ADDED — up to three of them, each removable
// with the ✕ in its header. That is why this card no longer ships four fixed
// slots: three of those four were guesses, and a guess that costs a quarter of
// the board is worse than an empty seat the user fills themselves.
//
// That is also why the column count is ONE setting for the whole board rather
// than one per panel — four panels on different counts stop lining up, and a
// board that does not line up cannot answer the question it exists to answer.
//
// The count is EXPIRY columns — 1, 2 or 3, which is every expiry the chain
// route has (it returns the nearest plus up to two more). The ex-0DTE TOTAL is
// its own switch and its own extra column, summing every non-0DTE expiry
// available whether or not that expiry is drawn. Four columns maximum.
//
// ── Marks on the ladder ──────────────────────────────────────────────────────
//   ATM        a white ring around the row
//   CB         the cell goes GOLD and its number keeps the GEX hue, so the core
//              is findable across four ladders at a glance while the sign is
//              still readable. Front expiry adds the named badge and a pulse;
//              later expiries get a ★ in the corner — the same strike, marked
//              more quietly because the front expiry is the one being traded.
//   CW / PW    ringed badges in their own colours, front expiry only
//
// ── Not carried over ─────────────────────────────────────────────────────────
// Replay, the Δ 5/15/30m stamps, the cell click-through book, the full-page
// chain overlay, screenshot/Discord capture and the second (VIVID) heat skin.
// Each is its own feature rather than part of the ladder, and the ladder is
// what "the Multi Greek page" means.
// ─────────────────────────────────────────────────────────────────────────────

/** Panels beyond the board's own ticker. Four panels total is the board's width. */
const MAX_EXTRA_PANELS = 3

/** The pre-split key: four fixed slots. Read once, to carry a saved board over. */
const LEGACY_TICKERS_KEY = 'cb-v3-mg-tickers'
const EXTRA_TICKERS_KEY = 'cb-v3-mg-extra-tickers'
const COLS_KEY = 'cb-v3-mg-col-count'
const EX0_STORE_KEY = 'cb-v3-mg-ex0'
const BASIS_STORE_KEY = 'cb-v3-mg-basis'

/** Strike rail width, matching v2 so the two boards read at the same rhythm. */
const RAIL_PX = 76

/**
 * The Core Bullseye fill — v2's VIVID skin, value for value: gold at 85%,
 * laid OVER the cell's heat wash rather than replacing it.
 */
const CB_FILL = 'color-mix(in srgb, var(--color-level-cb) 85%, transparent)'

function readStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* best-effort */
  }
}

function readList(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string' && PAGE_TICKER_RE.test(v.trim().toUpperCase()))
      .map((v) => v.trim().toUpperCase())
  } catch {
    return []
  }
}

/**
 * The ADDED panels — never the board's own ticker, which is panel one and is
 * held by the page, not by this card.
 *
 * A board saved by the four-fixed-slots build is carried over rather than
 * dropped: slots 2-4 of that blob were the user's own choices and are exactly
 * what the extras list means now. Slot 1 is discarded — that seat belongs to the
 * page symbol from here on.
 */
function loadExtras(pageSymbol: string): string[] {
  const migrated = readStored(EXTRA_TICKERS_KEY, '') !== ''
  const raw = migrated ? readList(EXTRA_TICKERS_KEY) : readList(LEGACY_TICKERS_KEY).slice(1)
  const seen = new Set<string>([pageSymbol.toUpperCase()])
  const out: string[] = []
  for (const t of raw) {
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
    if (out.length >= MAX_EXTRA_PANELS) break
  }
  return out
}

/**
 * `live=0` is load-bearing, and only for SPX.
 *
 * Without it the chain adapter serves the subscribed underlying from the live
 * WebSocket subscriber, which streams exactly ONE expiry — so SPX came back
 * with a single expiration and its panel was stuck at one column no matter what
 * the board was set to, while SPY/QQQ/NDX fell through to REST and got three.
 * The flag opts this caller out of that fast path; the ladder is read ACROSS
 * expiries, so a one-expiry chain is not a chain it can use.
 *
 * It costs SPX the live path, which is the right trade here: the panel polls on
 * a 15s cadence anyway and the REST response is the only one with the columns.
 */
function chainsUrl(ticker: string): string {
  return `/api/chains?ticker=${encodeURIComponent(ticker)}&range=all&live=0`
}

// ── One panel ────────────────────────────────────────────────────────────────

interface PanelProps {
  ticker: string
  anchor: string
  colCount: number
  showEx0: boolean
  basis: Basis
  intensity: number
  showLevels: boolean
  /** Returns false when the symbol was refused (a duplicate), so the box snaps back. */
  onCommitTicker: (next: string) => boolean
  /**
   * Present only on ADDED panels. The first panel is the board's ticker and has
   * nothing to remove — closing it would leave the card showing a symbol the
   * rest of the board is not on.
   */
  onRemove?: () => void
  /** Panel one carries a mark saying it follows the board rather than itself. */
  isPageSymbol?: boolean
  /** A cell was clicked — the card opens above the whole board, not per panel. */
  onOpenCell: (cell: OpenCell) => void
}

/** What the click card needs, resolved at click time from the panel's own chain. */
export interface OpenCell {
  ticker: string
  strike: number
  expiry: string
  daysTo: number
  row: StrikeRow | undefined
  netGex: number
  x: number
  y: number
}

function TickerPanel({
  ticker,
  anchor,
  colCount,
  showEx0,
  basis,
  intensity,
  showLevels,
  onCommitTicker,
  onRemove,
  isPageSymbol,
  onOpenCell,
}: PanelProps) {
  // 15s, matching v2's auto-refresh. staleMs alone would never refetch — it is
  // a cache TTL, not an interval — so the ladder would freeze at whatever it
  // loaded with.
  const q = useQuery<unknown>(ticker ? chainsUrl(ticker) : null, { staleMs: 15_000, pollMs: 15_000 })
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const userScrolledRef = useRef(false)
  const anchorRef = useRef('')
  const [draft, setDraft] = useState(ticker)
  useEffect(() => setDraft(ticker), [ticker])

  const chain: ParsedChain = useMemo(() => parseChain(q.data), [q.data])
  const spot = chain.underlying

  const { display, ex0Source } = useMemo(() => {
    const all = pickColumns(
      chain.expiries.map((e) => e.expiration),
      anchor || chain.expiries[0]?.expiration || '',
    )
    return withEx0Column(all, colCount, showEx0)
  }, [chain.expiries, anchor, colCount, showEx0])

  const byExp = useMemo(() => new Map(chain.expiries.map((e) => [e.expiration, e])), [chain.expiries])

  /** strike → value, per displayed column. The total column sums its sources. */
  const valuesByCol = useMemo(() => {
    const out = new Map<string, Map<number, number>>()
    for (const col of display) {
      const m = new Map<number, number>()
      const sources = col.key === EX0_KEY ? ex0Source.map((c) => c.expiration) : [col.expiration]
      for (const exp of sources) {
        const chainForExp = byExp.get(exp)
        if (!chainForExp) continue
        for (const [strike, row] of chainForExp.byStrike) {
          m.set(strike, (m.get(strike) ?? 0) + strikeGex(row, spot, basis))
        }
      }
      out.set(col.key, m)
    }
    return out
  }, [byExp, display, ex0Source, spot, basis])

  const rows = useMemo(() => {
    const all = new Set<number>()
    for (const m of valuesByCol.values()) for (const s of m.keys()) all.add(s)
    return [...all].sort((a, b) => b - a)
  }, [valuesByCol])

  const stats = useMemo(() => {
    const out = new Map<string, ReturnType<typeof columnStats>>()
    for (const col of display) out.set(col.key, columnStats(valuesByCol.get(col.key) ?? new Map(), spot))
    return out
  }, [display, valuesByCol, spot])

  const atm = useMemo(() => {
    const first = rows[0]
    if (!spot || first === undefined) return null
    return rows.reduce((best, s) => (Math.abs(s - spot) < Math.abs(best - spot) ? s : best), first)
  }, [rows, spot])

  // ── Centre on the money ────────────────────────────────────────────────────
  // Two effects, in this order on purpose: effects run in declaration order, so
  // a ladder that has genuinely changed clears the user-scroll latch in the
  // same commit that the centring effect below then acts on.
  const anchorKey = `${atm ?? 0}|${rows.length}|${rows[0] ?? 0}`
  useEffect(() => {
    if (anchorRef.current === anchorKey) return
    anchorRef.current = anchorKey
    userScrolledRef.current = false
  }, [anchorKey])

  // No dependency array, matching v2: the ladder can be re-laid-out by a resize
  // or a column change that no single value here captures, and re-centring is
  // idempotent. The latch is what stops it fighting the user.
  useEffect(() => {
    const el = bodyRef.current
    if (!el || atm == null || userScrolledRef.current) return
    const row = el.querySelector<HTMLElement>(`[data-strike="${atm}"]`)
    if (!row) return
    // offsetTop is measured from the nearest POSITIONED ancestor, which is why
    // the scroll container carries `relative` below. v2 does not, so its ATM
    // row lands a constant offset (panel header + column header + totals row)
    // below true centre. Fixed here rather than reproduced.
    el.scrollTop = Math.max(0, Math.round(row.offsetTop - el.clientHeight / 2 + row.offsetHeight / 2))
  })

  // Latch only when the gesture actually moved the panel — a wheel event on an
  // already-pinned ladder should not stop it re-centring later.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const mark = () => {
      const before = el.scrollTop
      requestAnimationFrame(() => {
        if (el.scrollTop !== before) userScrolledRef.current = true
      })
    }
    el.addEventListener('wheel', mark, { passive: true })
    el.addEventListener('touchmove', mark, { passive: true })
    return () => {
      el.removeEventListener('wheel', mark)
      el.removeEventListener('touchmove', mark)
    }
  }, [])

  const commit = () => {
    const next = draft.trim().toUpperCase()
    if (!next || next === ticker) {
      setDraft(ticker)
      return
    }
    if (!onCommitTicker(next)) setDraft(ticker)
  }

  const gridCols = `${RAIL_PX}px repeat(${Math.max(1, display.length)}, minmax(0, 1fr))`
  const front = display[0]

  /** The badge a strike earns in a column, if any. */
  const levelOf = (colKey: string, strike: number): 'cb' | 'cw' | 'pw' | null => {
    const s = stats.get(colKey)
    if (!s) return null
    if (s.cb === strike) return 'cb'
    if (s.cw === strike) return 'cw'
    if (s.pw === strike) return 'pw'
    return null
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-surface2">
      {/* header — every panel is typeable; panel one types the BOARD's ticker */}
      <div className="flex shrink-0 select-none items-center justify-between gap-1.5 border-b border-line px-2.5 py-1.5">
        <input
          value={draft}
          maxLength={6}
          spellCheck={false}
          autoCapitalize="characters"
          placeholder="TICKER"
          title={
            isPageSymbol
              ? "This panel follows the board's ticker — typing here moves the whole board"
              : "This panel's ticker — type a symbol and press Enter"
          }
          onChange={(e) => setDraft(e.target.value.toUpperCase())}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commit}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
            if (e.key === 'Escape') {
              setDraft(ticker)
              e.currentTarget.blur()
            }
          }}
          className="w-[92px] shrink-0 select-text rounded-md border border-line bg-bg px-1.5 py-px text-[17px] font-extrabold uppercase tracking-[0.1em] text-accent outline-none focus:border-accent"
        />
        <div className="flex min-w-0 items-center gap-1.5">
          {isPageSymbol && (
            <span
              title="This panel is the board's ticker"
              className="shrink-0 rounded-sm border border-line px-1 py-px text-[8px] font-black uppercase tracking-[0.08em] text-faint"
            >
              Board
            </span>
          )}
          <span className="tabular text-xs font-semibold text-fg">
            {spot > 0 ? spot.toLocaleString('en-US', { maximumFractionDigits: 2 }) : q.loading ? '…' : '—'}
          </span>
          {onRemove && (
            <button
              type="button"
              title={`Remove the ${ticker} panel`}
              aria-label={`Remove the ${ticker} panel`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onRemove()
              }}
              className="shrink-0 rounded-sm px-1 text-[11px] font-bold leading-none text-faint hover:bg-raised hover:text-down"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* column headers */}
      <div
        className="grid shrink-0 gap-px border-b border-line bg-surface px-1 py-1"
        style={{ gridTemplateColumns: gridCols }}
      >
        <span className="self-center text-center text-[11px] font-extrabold uppercase tracking-[0.06em] text-fg">
          Strike
        </span>
        {display.map((c) => (
          <div key={c.key} className="min-w-0 text-center leading-[1.15]">
            <div className="truncate text-[11px] font-extrabold tracking-[0.04em] text-accent">{c.label}</div>
            <div className="truncate text-[9px] font-bold text-fg">{c.subLabel}</div>
          </div>
        ))}
      </div>

      {/* totals */}
      <div className="grid shrink-0 gap-px border-b border-line px-1 py-1" style={{ gridTemplateColumns: gridCols }}>
        <span className="text-center text-[11px] font-extrabold uppercase tracking-[0.06em] text-fg">Total</span>
        {display.map((c) => {
          const s = stats.get(c.key)
          const net = s?.netTotal ?? null
          const f = fmtGex(net)
          return (
            <div
              key={c.key}
              className={[
                'tabular min-w-0 truncate text-center font-mono text-[11px] font-extrabold',
                net == null || net === 0 ? 'text-flat' : net > 0 ? 'text-gex-pos' : 'text-gex-neg',
              ].join(' ')}
            >
              {f.sign}
              {f.text}
              {s && s.netTotal !== 0 && (
                <span
                  className={['ml-1 text-[9px] font-extrabold', s.posPct >= 50 ? 'text-up' : 'text-down'].join(' ')}
                >
                  {Math.round(s.posPct)}%
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* ladder — `relative` so a row's offsetTop is measured from this box */}
      <div ref={bodyRef} className="relative min-h-0 flex-1 overflow-y-auto px-1">
        {rows.length === 0 && (
          <div className="px-1 py-3 text-[11px] text-muted opacity-50">
            {q.error ? 'Chain unavailable' : q.loading ? 'Waiting for the chain…' : 'No strikes'}
          </div>
        )}
        {rows.map((strike) => {
          const isAtm = strike === atm
          return (
            <div
              key={strike}
              data-strike={strike}
              className="relative grid gap-px py-px"
              style={{
                gridTemplateColumns: gridCols,
                // An inset ring rather than a real border: a 2px border adds 4px
                // of row height and makes the whole ladder jump as spot crosses
                // a strike. v2 learned this the same way.
                ...(isAtm
                  ? {
                      boxShadow:
                        'inset 0 2px 0 var(--color-fg), inset 0 -2px 0 var(--color-fg), inset 2px 0 0 var(--color-fg), inset -2px 0 0 var(--color-fg)',
                      zIndex: 1,
                    }
                  : null),
              }}
            >
              {/* No ATM chip. The row's white ring already says which strike is
                  at the money, and a badge in the rail cost the strike number
                  half its width on four ladders at once. */}
              <span className="truncate border-r border-line px-1 text-center font-mono text-[11px] font-extrabold text-muted">
                {Number.isInteger(strike) ? strike : strike.toFixed(2)}
              </span>

              {display.map((c) => {
                const s = stats.get(c.key)
                const v = valuesByCol.get(c.key)?.get(strike) ?? 0
                const rank = s ? s.top3.indexOf(strike) : -1
                const alpha = s ? cellAlpha(v, s.maxAbs, rank, intensity) : 0
                const hue = v >= 0 ? 'var(--color-gex-pos)' : 'var(--color-gex-neg)'
                const heat =
                  alpha > 0 ? `color-mix(in srgb, ${hue} ${(alpha * 100).toFixed(1)}%, transparent)` : 'transparent'
                const level = showLevels ? levelOf(c.key, strike) : null
                const isFront = front != null && c.key === front.key
                const isCb = level === 'cb'
                const f = fmtGex(v)
                // The ex-0DTE TOTAL has no single expiry behind it, so there is
                // no chain row to open and no baseline to diff — it stays inert
                // rather than opening a card that could only say "—".
                const clickable = c.key !== EX0_KEY
                return (
                  <div
                    key={c.key}
                    onClick={
                      clickable
                        ? (ev) => {
                            ev.stopPropagation()
                            onOpenCell({
                              ticker,
                              strike,
                              expiry: c.expiration,
                              daysTo: c.daysTo,
                              row: byExp.get(c.expiration)?.byStrike.get(strike),
                              netGex: v,
                              x: ev.clientX,
                              y: ev.clientY,
                            })
                          }
                        : undefined
                    }
                    className={[
                      'tabular relative min-w-0 truncate rounded-[2px] px-1 text-center font-mono text-[10px] text-fg',
                      isCb ? 'mg-cb-glow font-extrabold' : '',
                      clickable ? 'cursor-pointer' : '',
                    ].join(' ')}
                    style={
                      isCb
                        ? {
                            // THE CORE, EXACTLY AS v2'S VIVID SKIN DRAWS IT.
                            //
                            // Gold at 85%, BLENDED OVER the heat rather than
                            // replacing it — that 0.85 is v2's own number, and
                            // the reason for it is that gold at full strength
                            // swamps the row AND takes the sign with it. Laid
                            // over the wash, the cyan or red underneath still
                            // shows through, so the cell says "core" and "which
                            // way the gamma points" at the same time.
                            //
                            // The figure is WHITE with v2's drop shadow, not the
                            // GEX hue: a mid-tone hue on gold is the weakest
                            // pair on the board, and the fill beneath is already
                            // carrying the sign.
                            //
                            // Two identical gradient stops is how a flat colour
                            // gets layered over a background in one property —
                            // the same trick v2's levelFillBg() uses.
                            background: `linear-gradient(${CB_FILL}, ${CB_FILL}), ${heat}`,
                            textShadow: '0 1px 2px color-mix(in srgb, var(--color-app) 85%, transparent)',
                          }
                        : {
                            background: alpha > 0 ? heat : undefined,
                            outline: rank === 0 && v !== 0 ? `1px solid ${hue}` : undefined,
                            outlineOffset: -1,
                          }
                    }
                  >
                    <span
                      className={f.sign === '+' ? 'text-up' : f.sign === '−' ? 'text-down' : 'text-muted'}
                    >
                      {f.sign}
                    </span>
                    {f.text}

                    {/* Later expiries mark their own CB with a star. Same
                        strike, quieter mark — the front expiry is the one being
                        traded, so it gets the named badge. Drawn in the app
                        ground, not gold: the cell underneath it IS gold now, and
                        a gold star on gold is an invisible star. */}
                    {isCb && !isFront && (
                      <span
                        title="Core Bullseye"
                        className="pointer-events-none absolute left-0.5 top-px text-[10px] leading-none"
                        style={{
                          color: 'var(--color-app)',
                          textShadow: '0 0 2px color-mix(in srgb, var(--color-fg) 55%, transparent)',
                        }}
                      >
                        ★
                      </span>
                    )}

                    {/* Front expiry names the level, ringed in its own colour. */}
                    {level && isFront && (
                      <span
                        title={{ cb: 'Core Bullseye', cw: 'Call Wall', pw: 'Put Wall' }[level]}
                        className="pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 rounded-[3px] bg-app px-[3px] text-[8px] font-black leading-[1.3] tracking-[0.04em] text-fg"
                        style={{ boxShadow: `inset 0 0 0 1px var(--color-level-${level})` }}
                      >
                        {level.toUpperCase()}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── The card ─────────────────────────────────────────────────────────────────

export function MultiGreekCard() {
  // Panel one. Read from the page rather than stored here, so the card opens on
  // whatever the board is already showing.
  const { symbol: pageSymbol, setSymbol: setPageSymbol } = usePageSymbol()
  const [extras, setExtras] = useState<string[]>(() => loadExtras(pageSymbol))
  const [addOpen, setAddOpen] = useState(false)
  const [addDraft, setAddDraft] = useState('')
  // A blob written before the split stored 4 here; it clamps to 3, which is the
  // same number of expiry columns that setting ever actually drew.
  const [colCount, setColCount] = useState(() => {
    const n = Number(readStored(COLS_KEY, String(MAX_EXP_COLS)))
    return Number.isFinite(n) ? Math.min(MAX_EXP_COLS, Math.max(1, Math.round(n))) : MAX_EXP_COLS
  })
  const [showEx0, setShowEx0] = useState(() => readStored(EX0_STORE_KEY, '1') !== '0')
  const [basis, setBasis] = useState<Basis>(() => {
    const v = readStored(BASIS_STORE_KEY, 'oivol')
    return v === 'vol' || v === 'oi' ? v : 'oivol'
  })
  const [intensity, setIntensity] = useState(1.75)
  const [showLevels, setShowLevels] = useState(true)
  const [cogOpen, setCogOpen] = useState(false)
  // The click card lives at BOARD level, not inside a panel: it is positioned
  // in viewport coordinates and only one can be open at a time, so a panel
  // owning it would mean four independent copies and four ways to leave one
  // behind when another opens.
  const [openCell, setOpenCell] = useState<OpenCell | null>(null)

  // SPX's front expiry anchors every panel's column pick. Deduped against the
  // SPX panel's own request — including its poll — so this costs nothing extra.
  const spxQ = useQuery<unknown>(chainsUrl('SPX'), { staleMs: 15_000 })
  const anchor = useMemo(() => {
    const parsed = parseChain(spxQ.data)
    return parsed.expiries[0]?.expiration ?? ''
  }, [spxQ.data])

  const commitCols = (n: number) => {
    const v = Math.min(MAX_EXP_COLS, Math.max(1, Math.round(n)))
    setColCount(v)
    write(COLS_KEY, String(v))
  }
  const commitEx0 = (on: boolean) => {
    setShowEx0(on)
    write(EX0_STORE_KEY, on ? '1' : '0')
  }
  const commitBasis = (b: Basis) => {
    setBasis(b)
    write(BASIS_STORE_KEY, b)
  }

  // The board's ticker can be moved from anywhere — the toolbar search, another
  // card — onto a symbol this card already has as an added panel. Drop the
  // duplicate rather than draw the same ladder twice.
  useEffect(() => {
    const s = pageSymbol.toUpperCase()
    setExtras((prev) => {
      if (!prev.includes(s)) return prev
      const out = prev.filter((t) => t !== s)
      write(EXTRA_TICKERS_KEY, JSON.stringify(out))
      return out
    })
  }, [pageSymbol])

  /** Panel one, then the added ones. */
  const tickers = useMemo(() => [pageSymbol.toUpperCase(), ...extras], [pageSymbol, extras])

  const writeExtras = useCallback((next: string[]) => {
    write(EXTRA_TICKERS_KEY, JSON.stringify(next))
  }, [])

  /**
   * A symbol already on the board is refused. The panels are read ACROSS, so the
   * same ticker twice does not add a comparison — it removes one, silently.
   *
   * Slot 0 is the page symbol: committing it moves the BOARD. That is why the
   * refusal check there is against the extras only, and why nothing is written
   * to this card's own storage for it.
   */
  const commitTicker = useCallback(
    (slot: number, next: string): boolean => {
      if (!PAGE_TICKER_RE.test(next)) return false
      if (slot === 0) {
        if (extras.includes(next)) return false
        setPageSymbol(next)
        return true
      }
      const i = slot - 1
      if (next === pageSymbol.toUpperCase()) return false
      if (extras.some((t, j) => j !== i && t === next)) return false
      const out = extras.map((t, j) => (j === i ? next : t))
      setExtras(out)
      writeExtras(out)
      return true
    },
    [extras, pageSymbol, setPageSymbol, writeExtras],
  )

  const addTicker = useCallback(() => {
    const next = addDraft.trim().toUpperCase()
    if (!PAGE_TICKER_RE.test(next)) return
    if (extras.length >= MAX_EXTRA_PANELS) return
    if (next === pageSymbol.toUpperCase() || extras.includes(next)) {
      setAddDraft('')
      return
    }
    const out = [...extras, next]
    setExtras(out)
    writeExtras(out)
    setAddDraft('')
    setAddOpen(false)
  }, [addDraft, extras, pageSymbol, writeExtras])

  const removeTicker = useCallback(
    (i: number) => {
      const out = extras.filter((_, j) => j !== i)
      setExtras(out)
      writeExtras(out)
      // The open card belongs to a panel that may have just gone; nothing on
      // screen should outlive the ladder it was read from.
      setOpenCell((prev) => (prev && prev.ticker === extras[i] ? null : prev))
    },
    [extras, writeExtras],
  )

  const full = extras.length >= MAX_EXTRA_PANELS

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* The board's state is legible from the panels themselves — the tickers
          are in their own headers, the expiries in the column headers — so the
          only thing the toolbar needs to carry is the way in to the settings,
          and it goes in the Card's header rather than in a second bar under it. */}
      <CardToolbar>
        {/* Add a panel. Capped at three beyond the board's own ticker: a fifth
            ladder on a 12-column card is narrower than the numbers in it. */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setAddOpen((v) => !v)}
            disabled={full}
            title={
              full
                ? 'Four panels is the most this card draws — remove one with its ✕ first'
                : 'Add another ticker panel'
            }
            className={[
              'rounded-sm border border-line px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]',
              full ? 'cursor-not-allowed text-muted opacity-40' : 'text-muted hover:bg-raised hover:text-fg',
            ].join(' ')}
          >
            + Ticker
            <span className="ml-1 opacity-60">
              {tickers.length}/{MAX_EXTRA_PANELS + 1}
            </span>
          </button>
          <Popover open={addOpen && !full} onClose={() => setAddOpen(false)} align="left">
            <div className="flex w-48 flex-col gap-1.5">
              <PanelSection title="Add panel">
                <input
                  autoFocus
                  value={addDraft}
                  maxLength={6}
                  spellCheck={false}
                  autoCapitalize="characters"
                  placeholder="TICKER"
                  onChange={(e) => setAddDraft(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addTicker()
                    }
                    if (e.key === 'Escape') setAddOpen(false)
                  }}
                  className="w-full rounded-sm border border-line bg-bg px-1.5 py-1 text-[13px] font-extrabold uppercase tracking-[0.1em] text-accent outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={addTicker}
                  className="rounded-sm border border-line px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted hover:bg-raised hover:text-fg"
                >
                  Add
                </button>
              </PanelSection>
            </div>
          </Popover>
        </div>
        <div className="relative">
        <button
          type="button"
          onClick={() => setCogOpen((v) => !v)}
          title={`${BASIS_LABEL[basis]} · ${colCount + (showEx0 ? 1 : 0)} of ${MAX_COLS} col`}
          className="rounded-sm border border-line px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted hover:bg-raised hover:text-fg"
        >
          ⚙ Board
        </button>
        <Popover open={cogOpen} onClose={() => setCogOpen(false)}>
          <div className="flex w-60 flex-col gap-2">
            <PanelSection title="Columns">
              <SegGroup
                title="How many EXPIRY columns each panel draws, nearest first. Three is every expiry the chain route returns."
                options={[1, 2, 3].map((n) => ({ label: String(n), value: String(n) }))}
                value={String(colCount)}
                onChange={(v) => commitCols(Number(v))}
              />
              <div className="flex gap-1">
                <Chip
                  label="ALL ex-0DTE"
                  on={showEx0}
                  onClick={() => commitEx0(!showEx0)}
                  title="Append a total column summing every available expiry except 0DTE — including expiries that have no column of their own. Four columns maximum."
                />
              </div>
            </PanelSection>
            <PanelSection title="Basis">
              <SegGroup
                title="OI+VOL is open interest plus today's volume; OI alone is the apples-to-apples basis against other GEX vendors"
                options={[
                  { label: 'OI+VOL', value: 'oivol' },
                  { label: 'VOL', value: 'vol' },
                  { label: 'OI', value: 'oi' },
                ]}
                value={basis}
                onChange={(v) => commitBasis(v as Basis)}
              />
            </PanelSection>
            <PanelSection title="Heat">
              <Slider
                label="intensity"
                value={intensity}
                min={0.5}
                max={3}
                step={0.05}
                format={(v) => (v <= 0.51 ? 'flat' : `${v.toFixed(2)}×`)}
                onChange={setIntensity}
                title="How hard the wash ramps. The top three strikes in a column keep their fixed steps at every setting."
              />
              <div className="flex gap-1">
                <Chip
                  label="CB / CW / PW"
                  on={showLevels}
                  onClick={() => setShowLevels((v) => !v)}
                  title="Mark the Core Bullseye, Call Wall and Put Wall. The front expiry names them; later expiries star their own CB."
                />
              </div>
            </PanelSection>
          </div>
        </Popover>
        </div>
      </CardToolbar>

      <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto">
        {tickers.map((t, i) => (
          <TickerPanel
            key={i === 0 ? '__page__' : t}
            ticker={t}
            isPageSymbol={i === 0}
            onRemove={i === 0 ? undefined : () => removeTicker(i - 1)}
            anchor={anchor}
            colCount={colCount}
            showEx0={showEx0}
            basis={basis}
            intensity={intensity}
            showLevels={showLevels}
            onCommitTicker={(next) => commitTicker(i, next)}
            onOpenCell={(cell) =>
              // Clicking the cell that is already open closes it, so the same
              // gesture is both "look" and "put it away".
              setOpenCell((prev) =>
                prev && prev.ticker === cell.ticker && prev.strike === cell.strike && prev.expiry === cell.expiry
                  ? null
                  : cell,
              )
            }
          />
        ))}
      </div>

      {openCell && (
        <CellCard
          ticker={openCell.ticker}
          strike={openCell.strike}
          expiry={openCell.expiry}
          daysTo={openCell.daysTo}
          call={openCell.row?.call ?? null}
          put={openCell.row?.put ?? null}
          netGex={openCell.netGex}
          x={openCell.x}
          y={openCell.y}
          onClose={() => setOpenCell(null)}
        />
      )}
    </div>
  )
}
