import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@/data/api'
import { SegGroup, Slider, Popover, PanelSection, Chip } from '../esCandles/controls'
import {
  BASIS_LABEL,
  EX0_KEY,
  MAX_EXP_COLS,
  cellAlpha,
  columnStats,
  fmtGex,
  parseChain,
  pickColumns,
  strikeGex,
  withEx0Column,
  type Basis,
  type ParsedChain,
} from './mgMath'

// ─────────────────────────────────────────────────────────────────────────────
// Multi Greek — v2's /mult-greek board, as a single card.
//
// Four ticker panels side by side. Each is a strike ladder read DOWN, with one
// column per upcoming expiry read ACROSS, and the cell is that strike's net GEX
// at that expiry. The whole point is the across-read: the same strike on SPX,
// SPY, QQQ and a symbol of your choosing, at the same DTE.
//
// That is also why the column count is ONE setting for the whole board rather
// than one per panel — four panels on different counts stop lining up, and a
// board that does not line up cannot answer the question it exists to answer.
//
// The count is columns ON SCREEN, not expiries: at the full four the last real
// expiry column is replaced by the synthetic ex-0DTE TOTAL (it still feeds the
// sum), so 4 = three expiries plus a total and 3 = three expiries, no total.
// See withEx0Column() in mgMath.ts.
//
// ── Requests ─────────────────────────────────────────────────────────────────
// Each panel fetches its own /api/chains. Nothing is gated on anything else:
// all four fire the moment the card mounts, and the SPX-anchored column pick
// happens afterward, in a memo, over whatever has landed. The parent also asks
// for SPX's chain to derive that anchor — src/data/api.ts dedupes it, so the
// panel and the parent share one request.
//
// ── Not carried over ─────────────────────────────────────────────────────────
// Replay, the Δ 5/15/30m stamps, the cell click-through book, the full-page
// chain overlay, screenshot/Discord capture and the second heat skin. Each is
// its own feature rather than part of the ladder, and the ladder is what "the
// Multi Greek page" means.
// ─────────────────────────────────────────────────────────────────────────────

const BASE_TICKERS = ['SPX', 'SPY', 'QQQ']
const CUSTOM_KEY = 'cb-v3-mg-custom-ticker'
const COLS_KEY = 'cb-v3-mg-col-count'
const BASIS_STORE_KEY = 'cb-v3-mg-basis'

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

function chainsUrl(ticker: string): string {
  return `/api/chains?ticker=${encodeURIComponent(ticker)}&range=all`
}

// ── One panel ────────────────────────────────────────────────────────────────

interface PanelProps {
  ticker: string
  anchor: string
  colCount: number
  basis: Basis
  intensity: number
  showLevels: boolean
  /** Only the 4th slot is editable. */
  onTickerChange?: (t: string) => void
}

function TickerPanel({ ticker, anchor, colCount, basis, intensity, showLevels, onTickerChange }: PanelProps) {
  const q = useQuery<unknown>(ticker ? chainsUrl(ticker) : null, { staleMs: 15_000 })
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [draft, setDraft] = useState(ticker)
  useEffect(() => setDraft(ticker), [ticker])

  const chain: ParsedChain = useMemo(() => parseChain(q.data), [q.data])
  const spot = chain.underlying

  const { display, ex0Source } = useMemo(() => {
    const cols = pickColumns(
      chain.expiries.map((e) => e.expiration),
      anchor || chain.expiries[0]?.expiration || '',
      colCount,
    )
    return withEx0Column(cols, colCount)
  }, [chain.expiries, anchor, colCount])

  /** strike → value, per displayed column. The total column sums its sources. */
  const valuesByCol = useMemo(() => {
    const byExp = new Map(chain.expiries.map((e) => [e.expiration, e]))
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
  }, [chain.expiries, display, ex0Source, spot, basis])

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
    if (!spot || !rows.length) return null
    return rows.reduce((best, s) => (Math.abs(s - spot) < Math.abs(best - spot) ? s : best), rows[0])
  }, [rows, spot])

  // Centre the ladder on the money whenever the ladder itself changes. Keyed on
  // the shape of the data, not on a scroll listener, so a user who has scrolled
  // away is not yanked back on every 15s refresh.
  const anchorKey = `${atm}|${rows.length}|${rows[0]}`
  useEffect(() => {
    const el = bodyRef.current
    if (!el || atm == null) return
    const target = el.querySelector<HTMLElement>(`[data-strike="${atm}"]`)
    if (target) el.scrollTop = Math.max(0, target.offsetTop - el.clientHeight / 2)
  }, [anchorKey, atm])

  const gridCols = `56px repeat(${Math.max(1, display.length)}, minmax(0, 1fr))`
  const front = display[0]

  /** The badge a strike earns in a column, if any. */
  const levelOf = (colKey: string, strike: number): 'cb' | 'cw' | 'pw' | null => {
    if (!showLevels) return null
    // Badges ride the front expiry only. Every column's own CB/CW/PW would be
    // four different answers to "where is the wall" in one panel.
    if (!front || colKey !== front.key) return null
    const s = stats.get(colKey)
    if (!s) return null
    if (s.cb === strike) return 'cb'
    if (s.cw === strike) return 'cw'
    if (s.pw === strike) return 'pw'
    return null
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-surface2">
      {/* header */}
      <div className="flex shrink-0 items-baseline justify-between gap-1.5 border-b border-line px-2 py-1.5">
        {onTickerChange ? (
          <input
            value={draft}
            maxLength={6}
            onChange={(e) => setDraft(e.target.value.toUpperCase())}
            onBlur={() => onTickerChange(draft.trim() || ticker)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            className="w-16 rounded-sm border border-line bg-bg px-1 py-0.5 text-xs font-bold tracking-wide text-fg outline-none focus:border-accent"
          />
        ) : (
          <span className="text-xs font-bold tracking-wide text-fg">{ticker}</span>
        )}
        <span className="tabular text-[11px] text-muted opacity-70">
          {spot > 0 ? spot.toLocaleString('en-US', { maximumFractionDigits: 2 }) : q.loading ? '…' : '—'}
        </span>
      </div>

      {/* column headers */}
      <div className="grid shrink-0 gap-px border-b border-line px-1 py-1" style={{ gridTemplateColumns: gridCols }}>
        <span />
        {display.map((c) => (
          <div key={c.key} className="min-w-0 text-center leading-tight">
            <div className="truncate text-[10px] font-bold text-accent">{c.label}</div>
            <div className="truncate text-[8px] text-muted opacity-60">{c.subLabel}</div>
          </div>
        ))}
      </div>

      {/* totals */}
      <div className="grid shrink-0 gap-px border-b border-line px-1 py-1" style={{ gridTemplateColumns: gridCols }}>
        <span className="text-[9px] uppercase tracking-[0.08em] text-muted opacity-50">Total</span>
        {display.map((c) => {
          const s = stats.get(c.key)
          const f = fmtGex(s?.netTotal ?? null)
          return (
            <div key={c.key} className="tabular min-w-0 text-center font-mono text-[10px]">
              <span className={f.sign === '+' ? 'text-up' : f.sign === '−' ? 'text-down' : 'text-muted'}>{f.sign}</span>
              <span className="text-fg">{f.text}</span>
              {s && s.netTotal !== 0 && (
                <span className={['ml-1 text-[8px]', s.posPct >= 50 ? 'text-up' : 'text-down'].join(' ')}>
                  {Math.round(s.posPct)}%
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* ladder */}
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-1">
        {rows.length === 0 && (
          <div className="px-1 py-3 text-[11px] text-muted opacity-50">
            {q.error ? 'Chain unavailable' : q.loading ? 'Waiting for the chain…' : 'No strikes'}
          </div>
        )}
        {rows.map((strike) => (
          <div
            key={strike}
            data-strike={strike}
            className={['grid gap-px py-px', strike === atm ? 'rounded-sm ring-1 ring-line' : ''].join(' ')}
            style={{ gridTemplateColumns: gridCols }}
          >
            <span className="tabular truncate text-center font-mono text-[11px] text-muted opacity-70">
              {strike.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </span>
            {display.map((c) => {
              const s = stats.get(c.key)
              const v = valuesByCol.get(c.key)?.get(strike) ?? 0
              const rank = s ? s.top3.indexOf(strike) : -1
              const alpha = s ? cellAlpha(v, s.maxAbs, rank, intensity) : 0
              const hue = v >= 0 ? 'var(--color-gex-pos)' : 'var(--color-gex-neg)'
              const level = levelOf(c.key, strike)
              const f = fmtGex(v)
              return (
                <div
                  key={c.key}
                  className="tabular relative min-w-0 truncate rounded-[2px] px-1 text-center font-mono text-[10px] text-fg"
                  style={{
                    background: alpha > 0 ? `color-mix(in srgb, ${hue} ${(alpha * 100).toFixed(1)}%, transparent)` : undefined,
                    outline: rank === 0 && v !== 0 ? `1px solid ${hue}` : undefined,
                  }}
                  title={level ? { cb: 'Core Bullseye', cw: 'Call Wall', pw: 'Put Wall' }[level] : undefined}
                >
                  <span className={f.sign === '+' ? 'text-up' : f.sign === '−' ? 'text-down' : 'text-muted'}>
                    {f.sign}
                  </span>
                  {f.text}
                  {level && (
                    <span
                      className="absolute left-0.5 top-0 text-[7px] font-black uppercase"
                      style={{ color: `var(--color-level-${level})` }}
                    >
                      {level}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── The card ─────────────────────────────────────────────────────────────────

export function MultiGreekCard() {
  const [custom, setCustom] = useState(() => readStored(CUSTOM_KEY, 'IWM'))
  const [colCount, setColCount] = useState(() => {
    const n = Number(readStored(COLS_KEY, String(MAX_EXP_COLS)))
    return Number.isFinite(n) ? Math.min(MAX_EXP_COLS, Math.max(1, Math.round(n))) : MAX_EXP_COLS
  })
  const [basis, setBasis] = useState<Basis>(() => {
    const v = readStored(BASIS_STORE_KEY, 'oivol')
    return v === 'vol' || v === 'oi' ? v : 'oivol'
  })
  const [intensity, setIntensity] = useState(1.75)
  const [showLevels, setShowLevels] = useState(true)
  const [cogOpen, setCogOpen] = useState(false)

  // SPX's front expiry anchors every panel's column pick. Deduped against the
  // SPX panel's own request, so this costs nothing extra.
  const spxQ = useQuery<unknown>(chainsUrl('SPX'), { staleMs: 15_000 })
  const anchor = useMemo(() => {
    const parsed = parseChain(spxQ.data)
    return parsed.expiries[0]?.expiration ?? ''
  }, [spxQ.data])

  const tickers = [...BASE_TICKERS, custom]

  const commitCols = (n: number) => {
    const v = Math.min(MAX_EXP_COLS, Math.max(1, Math.round(n)))
    setColCount(v)
    write(COLS_KEY, String(v))
  }
  const commitBasis = (b: Basis) => {
    setBasis(b)
    write(BASIS_STORE_KEY, b)
  }
  const commitCustom = (t: string) => {
    const v = t.trim().toUpperCase()
    if (!v) return
    setCustom(v)
    write(CUSTOM_KEY, v)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="relative flex shrink-0 flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.1em] text-muted opacity-60">
          {tickers.join(' · ')} · {BASIS_LABEL[basis]}
          {colCount !== MAX_EXP_COLS ? ` · ${colCount} COL` : ''}
        </span>
        <div className="relative ml-auto">
          <button
            type="button"
            onClick={() => setCogOpen((v) => !v)}
            className="rounded-sm border border-line px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted hover:bg-raised hover:text-fg"
          >
            ⚙ Board
          </button>
          <Popover open={cogOpen} onClose={() => setCogOpen(false)}>
            <div className="flex w-60 flex-col gap-2">
              <PanelSection title="Columns">
                <SegGroup
                  title="How many columns each panel draws. At 4 the last expiry column becomes the ex-0DTE total."
                  options={[1, 2, 3, 4].map((n) => ({ label: String(n), value: String(n) }))}
                  value={String(colCount)}
                  onChange={(v) => commitCols(Number(v))}
                />
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
                    title="Mark the Core Bullseye, Call Wall and Put Wall on the front expiry"
                  />
                </div>
              </PanelSection>
            </div>
          </Popover>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto">
        {tickers.map((t, i) => (
          <TickerPanel
            key={`${i}-${t}`}
            ticker={t}
            anchor={anchor}
            colCount={colCount}
            basis={basis}
            intensity={intensity}
            showLevels={showLevels}
            onTickerChange={i === 3 ? commitCustom : undefined}
          />
        ))}
      </div>
    </div>
  )
}
