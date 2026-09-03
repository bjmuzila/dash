// ─────────────────────────────────────────────────────────────────────────────
// MULTI GREEK REPLAY — four tickers rewound off ONE shared clock.
//
// The "Multi Greek" tab of /replay. It is the only tab of the four with no v3
// component behind it: board/multiGreek/MultiGreekCard.tsx is the LIVE ladder
// and has no replay path, so this is a build rather than a mount.
//
// Spec: docs/parity/replay.md — Part D. The arithmetic is transcribed from v2's
// app/mult-greek/MultGreekClient.tsx; the render layer is v3's, and the two
// places v3 already decided differently are kept (open decisions 3 and 4):
//
//   • CW must be ABOVE spot and PW BELOW it. v2 picks the top +GEX and most
//     −GEX strikes with no spot filter, which lets a "call wall" print under
//     the money. v3's columnStats guards both, and that guard is the shipped
//     definition everywhere else in v3.
//   • MAX_EXP_COLS is 3. The chain route returns the nearest expiration plus at
//     most two more, so v2's 4 made its "4" option silently identical to "3".
//
// Both come from board/multiGreek/mgMath.ts unchanged — one definition of a
// wall in v3, not two.
//
// WHAT REPLAY DOES *NOT* DO HERE. v2 keeps every live loop running while
// rewound and throws the output away: a 15s chain poll per ticker, an ES/SPX
// basis poll, the socket, an EM lookup, a 35-minute GEX ring. None of it
// reaches the screen. This page opens NONE of them — it is REST-only, two
// recorder endpoints, no socket, and nothing polls. That is a departure, and it
// is recorded as one in the spec rather than being quietly better.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { query } from '@/data/api'
import { PAGE_TICKER_RE, usePageSymbol } from '@/data/symbol'
import { alpha, T } from '@/design/theme'
import { Chip, PanelSection, Popover, SegGroup } from '@/design/primitives/Controls'
import { Slider } from '@/board/gexCandles/controls'
import { ReplayDock } from '@/design/primitives/ReplayDock'
import {
  BASIS_LABEL,
  EX0_KEY,
  MAX_COLS,
  MAX_EXP_COLS,
  cellAlpha,
  columnStats,
  fmtGex,
  type Basis,
  type Column,
} from '@/board/multiGreek/mgMath'
import {
  MG_REPLAY_BASE_MS,
  MG_REPLAY_SPEEDS,
  fmtMgReplayClock,
  mgEx0Sources,
  mgReplayColumns,
  mgReplayValues,
  mgTimeline,
  parseMgSession,
  pickMgFrame,
  type MgFrame,
  type MgSession,
} from './mgReplay'

/** Four panels. SLOT 1 follows the toolbar's board symbol (see the sync effect
 *  in MultiGreekReplay); slots 2-4 are independently typeable and stay put.
 *  That split is the live Multi Greek board's shape — panel 1 is the board
 *  ticker, the rest are added by hand — and it is the only way this tab can
 *  answer the toolbar without comparing a symbol with itself, which is what
 *  pinning all four to one symbol would do. The values below are the seeds for
 *  a board that has never been set; slot 1's is replaced on first render. */
const DEFAULT_TICKERS = ['SPX', 'SPY', 'QQQ', 'NDX'] as const

const TICKERS_KEY = 'cb-v3-replay-mg-tickers'
const COLS_KEY = 'cb-v3-replay-mg-col-count'
const EX0_KEY_STORE = 'cb-v3-replay-mg-ex0'
const BASIS_KEY = 'cb-v3-replay-mg-basis'

/** Strike rail width, matching the live card so the two boards read alike. */
const RAIL_PX = 76

/**
 * ── THE CORE BULLSEYE FILL ───────────────────────────────────────────────────
 * Byte-for-byte the live Multi Greek ladder's wash (board/multiGreek/
 * MultiGreekCard.tsx), and the same colour decision as the chain matrix's
 * `levelFillBg()` (pages/optionsChain/heatSkins.ts).
 *
 * Replay used to paint v2's FLAT gold at 85% over the whole cell, and that was
 * the bug both of those surfaces already fixed: a Core below spot is negative,
 * and at 85% the gold buried the red — two cells that meant opposite things
 * looked identical. The wash keeps gold where the eye looks for the marker (the
 * ★ / badge end of the cell) and is gone before the figure, which sits on the
 * ordinary heat and reads red or blue again.
 *
 * Stops are the ladder's 55/82, not the chain's 26/66: the ladder is scanned
 * across four panels at once, so gold holds through the figure and hands over
 * in the last quarter.
 */
const CB_WASH_ANGLE = '112deg'
const CB_GOLD = 'var(--color-level-cb)'
const CB_FILL = 'color-mix(in srgb, var(--color-level-cb) 85%, transparent)'
/** Fades to gold-at-zero, not `transparent`: a ramp through grey reads dirty. */
const CB_FADE = 'color-mix(in srgb, var(--color-level-cb) 0%, transparent)'
const CB_WASH = `linear-gradient(${CB_WASH_ANGLE},${CB_GOLD} 0%,${CB_FILL} 55%,${CB_FADE} 82%)`

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

/** Saved slots over the defaults, per slot, with duplicates reset to default. */
function loadTickers(): string[] {
  // string[], not the literal tuple's union: the whole point of the slots is
  // that a saved (or typed) symbol replaces a default.
  const base: string[] = [...DEFAULT_TICKERS]
  let saved: unknown = null
  try {
    saved = JSON.parse(localStorage.getItem(TICKERS_KEY) ?? 'null')
  } catch {
    saved = null
  }
  if (!Array.isArray(saved)) return base
  const out = [...base]
  saved.slice(0, base.length).forEach((v, i) => {
    const t = String(v ?? '').trim().toUpperCase()
    if (t && PAGE_TICKER_RE.test(t)) out[i] = t
  })
  // A repeated symbol is not a comparison — it is one panel fewer, silently.
  const seen = new Set<string>()
  return out.map((t, i) => {
    if (!seen.has(t)) {
      seen.add(t)
      return t
    }
    const fallback = base[i] ?? t
    if (seen.has(fallback)) return t
    seen.add(fallback)
    return fallback
  })
}

async function get<TResult>(url: string): Promise<TResult | null> {
  try {
    return await query<TResult>(url, { staleMs: 0 })
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// One panel
// ─────────────────────────────────────────────────────────────────────────────

interface PanelProps {
  ticker: string
  session: MgSession | null
  frame: MgFrame | null
  replayDate: string
  clock: number | null
  colCount: number
  showEx0: boolean
  basis: Basis
  intensity: number
  showLevels: boolean
  loading: boolean
  onCommitTicker: (next: string) => boolean
}

function ReplayPanel({
  ticker,
  session,
  frame,
  replayDate,
  clock,
  colCount,
  showEx0,
  basis,
  intensity,
  showLevels,
  loading,
  onCommitTicker,
}: PanelProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const userScrolledRef = useRef(false)
  const anchorRef = useRef('')
  const [draft, setDraft] = useState(ticker)
  const [editing, setEditing] = useState(false)
  useEffect(() => setDraft(ticker), [ticker])
  useEffect(() => setEditing(false), [ticker])

  /** Columns come from the SESSION, so they do not change as you scrub. */
  const allCols = useMemo(() => mgReplayColumns(session, replayDate), [session, replayDate])

  const { display, ex0Source } = useMemo(() => {
    const shown = allCols.slice(0, Math.max(1, Math.min(MAX_EXP_COLS, colCount)))
    if (!showEx0) return { display: shown, ex0Source: [] as Column[] }
    const sources = mgEx0Sources(allCols)
    if (!sources.length) return { display: shown, ex0Source: [] as Column[] }
    const total: Column = { key: EX0_KEY, expiration: '', daysTo: -1, label: 'ALL', subLabel: 'EX-0DTE' }
    return { display: [...shown, total], ex0Source: sources }
  }, [allCols, colCount, showEx0])

  const spot = frame?.spot ?? 0

  /** strike → value, per displayed column. The total column sums its sources. */
  const valuesByCol = useMemo(() => {
    const out = new Map<string, Map<number, number>>()
    if (!frame) return out
    for (const col of display) {
      const sources = col.key === EX0_KEY ? ex0Source.map((c) => c.expiration) : [col.expiration]
      out.set(col.key, mgReplayValues(frame, sources, basis))
    }
    return out
  }, [frame, display, ex0Source, basis])

  /**
   * The ladder is the SESSION's strike union, not the frame's — the whole day's
   * rungs, every step. A ladder that gained and lost rows as the recorder's
   * coverage moved would make scrubbing unreadable, and a strike this sweep did
   * not record has a row with no value rather than no row.
   */
  const rows = useMemo(() => (session ? [...session.strikes].sort((a, b) => b - a) : []), [session])

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
  // Two effects in this order on purpose: a ladder that genuinely changed clears
  // the user-scroll latch in the same commit the centring effect then acts on.
  // While rewound the ladder is fixed for the session, so this fires only when
  // the ATM strike moves — i.e. when spot crosses a strike — and otherwise holds
  // wherever the user left it.
  const anchorKey = `${atm ?? 0}|${rows.length}|${rows[0] ?? 0}`
  useEffect(() => {
    if (anchorRef.current === anchorKey) return
    anchorRef.current = anchorKey
    userScrolledRef.current = false
  }, [anchorKey])

  useEffect(() => {
    const el = bodyRef.current
    if (!el || atm == null || userScrolledRef.current) return
    const row = el.querySelector<HTMLElement>(`[data-strike="${atm}"]`)
    if (!row) return
    el.scrollTop = Math.max(0, Math.round(row.offsetTop - el.clientHeight / 2 + row.offsetHeight / 2))
  })

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
    // Empty RESTORES rather than removes: four panels is the shape of the page,
    // and a blank seat is not a comparison.
    if (!next || next === ticker) {
      setDraft(ticker)
      return
    }
    if (!onCommitTicker(next)) setDraft(ticker)
  }

  const gridCols = `${RAIL_PX}px repeat(${Math.max(1, display.length)}, minmax(0, 1fr))`
  const front = display[0]

  const levelOf = (colKey: string, strike: number): 'cb' | 'cw' | 'pw' | null => {
    const s = stats.get(colKey)
    if (!s) return null
    if (s.cb === strike) return 'cb'
    if (s.cw === strike) return 'cw'
    if (s.pw === strike) return 'pw'
    return null
  }

  /**
   * THE THREE EMPTY STATES, told apart.
   *
   * v2 has only two paths here and they collapse: a ticker with no session AND
   * a ticker whose clock sits before its first sweep both fall through to the
   * LIVE string "Select an expiry and click GO" — advice with no GO button
   * anywhere on the page, and its own intended wording
   * ("No recorded sweeps for X this session") is unreachable. Fixed rather than
   * transcribed: docs/parity/replay.md, open decision 2.
   */
  const emptyState = (): string | null => {
    if (loading) return 'Loading recorded session…'
    if (!session) return `No recorded sweeps for ${ticker} this session`
    if (!frame) {
      return clock == null
        ? `No recorded sweeps for ${ticker} this session`
        : `${ticker} had not swept yet at ${fmtMgReplayClock(clock)} ET`
    }
    if (!rows.length) return 'No strikes in range'
    return null
  }
  const empty = emptyState()

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-surface2">
      {/* Header — the ticker is bare text until you click it. A permanent
          bordered box was the widest thing in a narrow panel, spending it on
          three characters that change once a session. */}
      <div className="flex shrink-0 select-none items-center justify-between gap-1 border-b border-line px-1.5 py-px">
        {editing ? (
          <input
            autoFocus
            value={draft}
            maxLength={6}
            size={6}
            spellCheck={false}
            autoCapitalize="characters"
            placeholder="TICKER"
            onChange={(e) => setDraft(e.target.value.toUpperCase())}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => {
              commit()
              setEditing(false)
            }}
            // stopPropagation is load-bearing: the page binds Space to
            // play/pause, and a space typed into a ticker box must not scrub.
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
            className="w-[58px] min-w-0 shrink select-text border-0 border-b border-accent bg-transparent p-0 text-sm font-extrabold uppercase leading-none tracking-[0.06em] text-accent outline-none"
          />
        ) : (
          <button
            type="button"
            title={`This panel's ticker — click to type another symbol. Changing it reloads all four recordings, because the clock is shared.`}
            onClick={() => setEditing(true)}
            className="min-w-0 shrink truncate text-left text-sm font-extrabold uppercase leading-none tracking-[0.06em] text-accent hover:underline"
          >
            {ticker || 'TICKER'}
          </button>
        )}
        <span className="tabular truncate text-xs font-semibold text-fg">
          {/* The RECORDED spot, never a live one. */}
          {spot > 0 ? spot.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '--'}
        </span>
      </div>

      {/* Column headers AND totals in one block — the expiry, its date, its net. */}
      <div
        className="grid shrink-0 gap-px border-b border-line bg-surface px-1 py-0.5"
        style={{ gridTemplateColumns: gridCols }}
      >
        <div className="flex flex-col justify-between text-center leading-[1.15]">
          <span className="text-2xs font-extrabold uppercase tracking-[0.06em] text-fg">Strike</span>
          <span className="text-3xs font-extrabold uppercase tracking-[0.06em] text-muted">Total</span>
        </div>
        {display.map((c) => {
          const s = stats.get(c.key)
          const net = s?.netTotal ?? null
          const f = fmtGex(net)
          return (
            <div
              key={c.key}
              title={
                c.key === EX0_KEY
                  ? // Counted PER SWEEP, so it moves as you scrub while the column
                    // set stays fixed. That is the honest number: it says how many
                    // expiries this snapshot actually contributed.
                    `Total NET GEX per strike across ${
                      frame ? ex0Source.filter((x) => frame.expiries.includes(x.expiration)).length : 0
                    } recorded expiration(s), excluding 0DTE`
                  : undefined
              }
              className="flex min-w-0 flex-col justify-between text-center leading-[1.15]"
            >
              <div className="truncate text-2xs font-extrabold tracking-[0.04em] text-accent">{c.label}</div>
              <div className="truncate text-3xs font-bold text-fg">{c.subLabel}</div>
              <div
                className={[
                  'tabular min-w-0 truncate font-mono text-2xs font-extrabold',
                  net == null || net === 0 ? 'text-flat' : net > 0 ? 'text-gex-pos' : 'text-gex-neg',
                ].join(' ')}
              >
                {f.sign}
                {f.text}
                {s && s.netTotal !== 0 && (
                  <span className={['ml-0.5 text-3xs font-extrabold', s.posPct >= 50 ? 'text-up' : 'text-down'].join(' ')}>
                    {Math.round(s.posPct)}%
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div
        ref={bodyRef}
        className="relative min-h-0 flex-1 select-none overflow-y-auto px-1 [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {empty && <div className="px-1 py-3 text-xs text-muted opacity-50">{empty}</div>}
        {!empty &&
          rows.map((strike) => {
            const isAtm = strike === atm
            return (
              <div
                key={strike}
                data-strike={strike}
                className="relative grid gap-px py-px"
                style={{
                  gridTemplateColumns: gridCols,
                  ...(isAtm
                    ? {
                        boxShadow:
                          'inset 0 2px 0 var(--color-fg), inset 0 -2px 0 var(--color-fg), inset 2px 0 0 var(--color-fg), inset -2px 0 0 var(--color-fg)',
                        zIndex: 1,
                      }
                    : null),
                }}
              >
                <span className="truncate border-r border-line px-1 text-center font-mono text-xs font-extrabold text-muted">
                  {Number.isInteger(strike) ? strike : strike.toFixed(2)}
                </span>

                {display.map((c) => {
                  const s = stats.get(c.key)
                  const raw = valuesByCol.get(c.key)?.get(strike)
                  // MISSING vs ZERO. A strike this sweep did not record has no
                  // key at all and prints `--`; a strike it recorded as flat
                  // prints its zero. "No gamma here" and "not recorded at this
                  // moment" are different claims and the recorder can only ever
                  // make the second one.
                  const recorded = raw !== undefined
                  const v = raw ?? 0
                  const rank = s ? s.top3.indexOf(strike) : -1
                  const a = s && recorded ? cellAlpha(v, s.maxAbs, rank, intensity) : 0
                  const hue = v >= 0 ? 'var(--color-gex-pos)' : 'var(--color-gex-neg)'
                  const heat =
                    a > 0 ? `color-mix(in srgb, ${hue} ${(a * 100).toFixed(1)}%, transparent)` : 'transparent'
                  const level = showLevels && recorded ? levelOf(c.key, strike) : null
                  const isFront = front != null && c.key === front.key
                  const isCb = level === 'cb'
                  const f = recorded ? fmtGex(v) : { sign: '' as const, text: '--' }
                  return (
                    <div
                      key={c.key}
                      title={
                        recorded
                          ? undefined
                          : 'not recorded in this sweep — the recorder stores the walls, not every strike'
                      }
                      className={[
                        'tabular relative min-w-0 truncate rounded-[2px] px-1 text-center font-mono text-2xs text-fg',
                        isCb ? 'mg-cb-glow font-extrabold' : '',
                        recorded ? '' : 'opacity-50',
                      ].join(' ')}
                      style={
                        isCb
                          ? {
                              // THE CORE. Gold washes in from the left edge and
                              // clears before the figure; past that the cell is
                              // the ordinary heat, so the number reads on its
                              // own sign rather than on gold. See CB_WASH.
                              //
                              // A gradient layered over a background in one
                              // property is the only way to composite a
                              // translucent layer over another without knowing
                              // what the layer underneath resolved to.
                              background: `${CB_WASH}, ${heat}`,
                              textShadow: '0 1px 2px color-mix(in srgb, var(--color-app) 85%, transparent)',
                            }
                          : {
                              background: a > 0 ? heat : undefined,
                              outline: rank === 0 && recorded && v !== 0 ? `1px solid ${hue}` : undefined,
                              outlineOffset: -1,
                            }
                      }
                    >
                      <span className={f.sign === '+' ? 'text-up' : f.sign === '−' ? 'text-down' : 'text-muted'}>
                        {f.sign}
                      </span>
                      {f.text}

                      {isCb && !isFront && (
                        <span
                          title="Core Bullseye"
                          className="pointer-events-none absolute left-0.5 top-px text-2xs leading-none"
                          // Drawn in the app ground, not gold: the corner it
                          // sits in is where CB_WASH holds FULL gold, and a gold
                          // star on gold is an invisible star. No halo either —
                          // solid gold is already its ground, and the glow only
                          // softened the glyph's edge. Matches the live ladder.
                          style={{ color: 'var(--color-app)' }}
                        >
                          ★
                        </span>
                      )}

                      {level && isFront && (
                        <span
                          title={{ cb: 'Core Bullseye', cw: 'Call Wall', pw: 'Put Wall' }[level]}
                          className="pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 rounded-[3px] bg-app px-[3px] text-3xs font-black leading-[1.3] tracking-[0.04em] text-fg"
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

// ─────────────────────────────────────────────────────────────────────────────
// The tab
// ─────────────────────────────────────────────────────────────────────────────

export function MultiGreekReplay() {
  const { symbol: pageSymbol, setSymbol: setPageSymbol } = usePageSymbol()
  const [tickers, setTickers] = useState<string[]>(() => loadTickers())
  const [dates, setDates] = useState<string[]>([])
  const [date, setDate] = useState('')
  const [sessions, setSessions] = useState<Record<string, MgSession | null>>({})
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<number>(1)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const [colCount, setColCount] = useState(() => {
    const n = Number(readStored(COLS_KEY, String(MAX_EXP_COLS)))
    return Number.isFinite(n) ? Math.min(MAX_EXP_COLS, Math.max(1, Math.round(n))) : MAX_EXP_COLS
  })
  const [showEx0, setShowEx0] = useState(() => readStored(EX0_KEY_STORE, '1') !== '0')
  const [basis, setBasis] = useState<Basis>(() => (readStored(BASIS_KEY, 'oivol') === 'vol' ? 'vol' : 'oivol'))
  const [intensity, setIntensity] = useState(1.75)
  const [showLevels, setShowLevels] = useState(true)
  const [cogOpen, setCogOpen] = useState(false)

  // ── SLOT 1 FOLLOWS THE TOOLBAR ─────────────────────────────────────────────
  // The Replay hub's other three tabs follow the board symbol outright; this one
  // cannot, because four slots pinned to one symbol would leave the tab
  // comparing a symbol with itself, which is the entire reason the card has four
  // slots. So it takes the live Multi Greek board's shape instead: panel 1 IS
  // the board ticker, panels 2-4 are added by hand and stay where they were put.
  //
  // A symbol that already sits in another slot is not left doubled — a repeated
  // symbol is one panel fewer, silently, the same rule loadTickers() enforces on
  // a saved board. The displaced slot takes the symbol slot 1 just gave up, so
  // the tab still shows four distinct readings across a toolbar change.
  useEffect(() => {
    if (tickers[0] === pageSymbol) return
    const displaced = tickers[0]
    const out = tickers.map((t, i) => (i === 0 ? pageSymbol : t))
    const dup = out.findIndex((t, i) => i !== 0 && t === pageSymbol)
    if (dup > 0 && displaced) out[dup] = displaced
    setTickers(out)
    write(TICKERS_KEY, JSON.stringify(out))
  }, [pageSymbol, tickers])

  const key = tickers.join(',')

  // ── The recorded sessions, four at a time ──────────────────────────────────
  // Both waves fan out in PARALLEL (non-negotiable 3). The dates wave is a
  // UNION across the four: a session one ticker recorded and another did not is
  // still a session worth scrubbing, and intersecting would hide it.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const lists = await Promise.all(
        tickers.map((t) =>
          get<{ ok?: boolean; dates?: unknown }>(
            `/proxy/strike-growth/replay-meta?symbol=${encodeURIComponent(t)}`,
          ).then((j) => (Array.isArray(j?.dates) ? j.dates.map((d) => String(d).slice(0, 10)) : [])),
        ),
      )
      if (cancelled) return
      const ds = [...new Set(lists.flat())].sort().reverse()
      setDates(ds)
      setDate((cur) => (cur && ds.includes(cur) ? cur : (ds[0] ?? '')))
      if (!ds.length) setErr('No recorded sessions for these tickers.')
    })()
    return () => {
      cancelled = true
    }
    // `key`, not `tickers`: the array identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    if (!date) return
    let cancelled = false
    setSessions({})
    setIdx(0)
    setPlaying(false)
    setErr('')
    setLoading(true)
    void (async () => {
      const parsed = await Promise.all(
        tickers.map((t) =>
          get<unknown>(
            `/proxy/strike-growth/frames-by-expiry?symbol=${encodeURIComponent(t)}&date=${encodeURIComponent(date)}`,
          ).then(parseMgSession),
        ),
      )
      if (cancelled) return
      const out: Record<string, MgSession | null> = {}
      tickers.forEach((t, i) => {
        out[t] = parsed[i] ?? null
      })
      setSessions(out)
      setLoading(false)
      if (!Object.values(out).some(Boolean)) setErr(`No recorded frames on ${date}.`)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, date])

  const timeline = useMemo(() => mgTimeline(sessions), [sessions])

  /** Land on the LAST step, not the first — the end of the session is the state
   *  you were most recently looking at live, so it is the one that needs no
   *  orientation. */
  useEffect(() => setIdx(Math.max(0, timeline.length - 1)), [timeline])

  const clock = timeline.length ? (timeline[Math.min(idx, timeline.length - 1)] ?? null) : null

  const frames = useMemo(() => {
    const out: Record<string, MgFrame | null> = {}
    for (const t of tickers) out[t] = pickMgFrame(sessions[t] ?? null, clock)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sessions, clock])

  // ── Playback ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing || timeline.length < 2) return
    const id = setInterval(() => setIdx((i) => (i >= timeline.length - 1 ? i : i + 1)), MG_REPLAY_BASE_MS / speed)
    return () => clearInterval(id)
  }, [playing, speed, timeline.length])

  // Stop at the end, never loop — a session that silently restarts reads as live
  // data jumping backwards. Outside the updater on purpose: updaters must be
  // pure, and StrictMode calls them twice.
  useEffect(() => {
    if (playing && timeline.length > 0 && idx >= timeline.length - 1) setPlaying(false)
  }, [playing, idx, timeline.length])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return
      e.preventDefault()
      setPlaying((p) => !p)
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [])

  const commitTicker = useCallback(
    (slot: number, next: string): boolean => {
      if (!PAGE_TICKER_RE.test(next)) return false
      if (tickers.some((t, j) => j !== slot && t === next)) return false
      // Slot 1 IS the board symbol, so typing here moves the TOOLBAR and the
      // sync effect above brings the slot with it. Writing it locally instead
      // would put the panel and the toolbar on two different symbols — and the
      // effect would immediately snap the panel back, so the box would look
      // broken.
      if (slot === 0) {
        setPageSymbol(next)
        return true
      }
      const out = tickers.map((t, j) => (j === slot ? next : t))
      setTickers(out)
      write(TICKERS_KEY, JSON.stringify(out))
      return true
    },
    [tickers, setPageSymbol],
  )

  const commitCols = (n: number) => {
    const v = Math.min(MAX_EXP_COLS, Math.max(1, Math.round(n)))
    setColCount(v)
    write(COLS_KEY, String(v))
  }
  const commitEx0 = (on: boolean) => {
    setShowEx0(on)
    write(EX0_KEY_STORE, on ? '1' : '0')
  }
  const commitBasis = (b: Basis) => {
    setBasis(b)
    write(BASIS_KEY, b)
  }

  const noHistory = tickers.filter((t) => !sessions[t])

  const btn = (on: boolean): React.CSSProperties => ({
    height: 24,
    padding: '0 8px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 'var(--text-xs)',
    fontWeight: 800,
    fontFamily: 'inherit',
    lineHeight: 1,
    color: on ? T.bg : T.text,
    background: on ? T.orange : alpha(T.text, 0.05),
    border: `1px solid ${on ? T.orange : T.border}`,
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col p-2">
      {/* ── The transport ──────────────────────────────────────────────────────
          Docked to the bottom of the page, like v2's ES Candles transport — in
          FLOW, so it shrinks the panels rather than covering the strikes nearest
          the money. It carries no plate of its own: the dock is orange, and a
          rewound board announcing itself along the whole bottom edge of the
          screen is a stronger signal than a chip inside a panel. Which matters
          here more than anywhere — the recorder stores the WALLS, not every
          strike, so a grid that looks like a live chain while being a record of
          the walls is the single worst way this can be misread, and the caveat
          line on the right is the sentence that stops it. */}
      <ReplayDock>
        <span
          style={{
            fontWeight: 900,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: T.orange,
            flexShrink: 0,
          }}
        >
          Replay
        </span>

        <select
          value={date}
          disabled={!dates.length}
          onChange={(e) => {
            setPlaying(false)
            setDate(e.target.value)
          }}
          title="Recorded session. The recorder keeps roughly five trading days."
          style={{
            padding: '3px 6px',
            fontSize: 'var(--text-xs)',
            fontWeight: 800,
            fontFamily: 'var(--font-mono)',
            background: T.panelBg,
            color: T.cyan,
            border: `1px solid ${T.border}`,
            borderRadius: 6,
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          {dates.length ? (
            dates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))
          ) : (
            <option value="">—</option>
          )}
        </select>

        {/* HOW MANY SESSIONS ARE ACTUALLY THERE. This list is the UNION across
            the four slots (see the dates wave), and its length is the
            recorder's retention rather than anything this page controls — so it
            is stated, in the same place, on every replay transport in v3. */}
        <span
          style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, opacity: 0.6, flexShrink: 0 }}
          title="Recorded sessions across the four slots. Server-side retention decides this, not the board."
        >
          {dates.length === 1 ? '1 session' : `${dates.length} sessions`}
        </span>

        <button
          title="Previous minute"
          disabled={idx <= 0}
          onClick={() => {
            setPlaying(false)
            setIdx((i) => Math.max(0, i - 1))
          }}
          style={{ ...btn(false), opacity: idx > 0 ? 1 : 0.4 }}
        >
          ◀
        </button>
        <button
          title="Play / pause (Space)"
          disabled={timeline.length < 2}
          onClick={() => {
            // Playing from the end would show one frame and stop, which reads as
            // broken — rewind first.
            if (idx >= timeline.length - 1) setIdx(0)
            setPlaying((p) => !p)
          }}
          style={{ ...btn(playing), padding: '0 12px', opacity: timeline.length > 1 ? 1 : 0.4 }}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          title="Next minute"
          disabled={idx >= timeline.length - 1}
          onClick={() => {
            setPlaying(false)
            setIdx((i) => Math.min(timeline.length - 1, i + 1))
          }}
          style={{ ...btn(false), opacity: idx < timeline.length - 1 ? 1 : 0.4 }}
        >
          ▶
        </button>

        <input
          type="range"
          min={0}
          max={Math.max(0, timeline.length - 1)}
          value={Math.min(idx, Math.max(0, timeline.length - 1))}
          disabled={timeline.length < 2}
          onChange={(e) => {
            setPlaying(false)
            setIdx(Number(e.target.value))
          }}
          aria-label="Replay position"
          style={{ flex: 1, minWidth: 180, height: 3, accentColor: T.orange }}
        />

        <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: T.muted, opacity: 0.7 }}>Speed</span>
        {MG_REPLAY_SPEEDS.map((sp) => (
          <button key={sp} onClick={() => setSpeed(sp)} style={{ ...btn(speed === sp), height: 22, padding: '0 7px', fontSize: 'var(--text-2xs)' }}>
            {sp}×
          </button>
        ))}

        <span style={{ color: T.border }}>|</span>

        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 900, color: T.text }}>
          {clock != null ? `${fmtMgReplayClock(clock)} ET` : '--:--'}
        </span>
        <span style={{ color: T.muted, opacity: 0.6 }}>
          {timeline.length ? `${Math.min(idx, timeline.length - 1) + 1} / ${timeline.length}` : ''}
        </span>

        {loading && <span style={{ color: T.cyan, fontWeight: 700 }}>loading…</span>}
        {!loading && err && <span style={{ color: T.red, fontWeight: 700 }}>{err}</span>}
        {!loading && !err && timeline.length > 0 && (
          <span style={{ color: T.muted, opacity: 0.6 }}>
            · recorded walls only · sweeps held to the minute · Δ and EM off while rewound
            {noHistory.length ? ` · no history: ${noHistory.join(', ')}` : ''}
          </span>
        )}

        <div style={{ flex: 1 }} />

        <div className="relative">
          <button
            type="button"
            onClick={() => setCogOpen((v) => !v)}
            title={`Board settings — ${BASIS_LABEL[basis]} · ${colCount + (showEx0 ? 1 : 0)} of ${MAX_COLS} col`}
            aria-label="Multi Greek replay settings"
            style={{ ...btn(false), height: 22, padding: '0 8px' }}
          >
            ⚙
          </button>
          <Popover open={cogOpen} onClose={() => setCogOpen(false)}>
            <div className="flex w-60 flex-col gap-2">
              <PanelSection title="Columns">
                <SegGroup
                  title="How many EXPIRY columns each panel draws, nearest first. Three is every expiry the recorder stores."
                  options={[1, 2, 3].map((n) => ({ label: String(n), value: String(n) }))}
                  value={String(colCount)}
                  onChange={(v) => commitCols(Number(v))}
                />
                <div className="flex gap-1">
                  <Chip
                    label="ALL ex-0DTE"
                    on={showEx0}
                    onClick={() => commitEx0(!showEx0)}
                    title="Append a total column summing every recorded expiry except 0DTE — including expiries with no column of their own."
                  />
                </div>
              </PanelSection>
              <PanelSection title="Basis">
                <SegGroup
                  title="OI+VOL is the recorded net; VOL is the recorded volume-only series"
                  options={[
                    { label: 'OI+VOL', value: 'oivol' },
                    { label: 'VOL', value: 'vol' },
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
      </ReplayDock>

      <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto">
        {tickers.map((t, i) => (
          <ReplayPanel
            key={i}
            ticker={t}
            session={sessions[t] ?? null}
            frame={frames[t] ?? null}
            replayDate={date}
            clock={clock}
            colCount={colCount}
            showEx0={showEx0}
            basis={basis}
            intensity={intensity}
            showLevels={showLevels}
            loading={loading}
            onCommitTicker={(next) => commitTicker(i, next)}
          />
        ))}
      </div>
    </div>
  )
}

export default MultiGreekReplay
