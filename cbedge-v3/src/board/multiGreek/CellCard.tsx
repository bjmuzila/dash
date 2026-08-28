import { useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@/data/api'
import { fmtGex, type Leg } from './mgMath'

// ─────────────────────────────────────────────────────────────────────────────
// The cell click card — one strike, one expiry, opened where you clicked.
//
// Everything above the divider comes from the chain the ladder was already
// drawn from: volume, open interest, and net premium as `volume × mark × 100`.
// No request. The cell you clicked already had all of it; the ladder just has
// room to print one number per cell.
//
// Everything BELOW the divider is history, and history is the one thing the
// chain cannot supply — a chain is a photograph of now. Those come from
// `/api/mult-greek-gex-change`, which returns the recorder's stored NET GEX for
// this cell at −5 / −15 / −30 minutes and at the open. The card diffs its LIVE
// value against them, exactly as v2 does.
//
// Three states for a delta, and they mean different things:
//   a number      the recorder has a reading that far back
//   building…     the recorder is up but has not reached that far back yet
//   no baseline   the recorder is not running (no DATABASE_URL, or this
//                 ticker/expiry is outside the set it records)
// v2 collapses the last two into "building…", which reads as "wait a bit" on a
// board that is never going to fill in.
// ─────────────────────────────────────────────────────────────────────────────

const CARD_W = 264
/** Kept clear of the viewport edge so the card is never half off-screen. */
const EDGE = 8

interface GexChange {
  vNow: number | null
  v5: number | null
  v15: number | null
  v30: number | null
  vOpen: number | null
}

export interface CellCardProps {
  ticker: string
  strike: number
  expiry: string
  daysTo: number
  call: Leg | null
  put: Leg | null
  /** The live net GEX in the cell that was clicked — what the deltas measure from. */
  netGex: number
  /** Viewport coordinates of the click. */
  x: number
  y: number
  onClose: () => void
}

/** `volume × mark × 100` — the premium that actually traded today at this leg. */
function netPrem(leg: Leg | null): number | null {
  if (!leg || !(leg.mark > 0)) return null
  return leg.vol * leg.mark * 100
}

function fmtInt(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('en-US')
}

function fmtMoney(v: number | null): string {
  if (v == null || !Number.isFinite(v) || v === 0) return '—'
  const f = fmtGex(v)
  return `${f.sign}${f.text}`
}

/** Expiry as `Aug 28`, from a YYYY-MM-DD string. Noon UTC so ET cannot shift it. */
function fmtExpiry(expiry: string): string {
  const d = new Date(`${expiry}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return expiry
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })
}

function LegBox({ label, leg, tone }: { label: string; leg: Leg | null; tone: 'pos' | 'neg' }) {
  const colour = tone === 'pos' ? 'var(--color-gex-pos)' : 'var(--color-gex-neg)'
  const row = (k: string, v: string) => (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[9px] uppercase tracking-[0.06em] text-muted opacity-60">{k}</span>
      <span className="tabular font-mono text-[10.5px] font-bold text-fg">{v}</span>
    </div>
  )
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-md border border-line bg-surface2 px-2 py-1.5">
      <span className="text-[9px] font-black uppercase tracking-[0.1em]" style={{ color: colour }}>
        {label}
      </span>
      {row('Volume', fmtInt(leg?.vol))}
      {row('OI', fmtInt(leg?.oi))}
      {row('Net Prem', fmtMoney(netPrem(leg)))}
    </div>
  )
}

export function CellCard({ ticker, strike, expiry, daysTo, call, put, netGex, x, y, onClose }: CellCardProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Capture-phase pointerdown would close the card before a click INSIDE it
    // reached its own handler; bubble phase plus the contains() check is what
    // lets the close button work.
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // A minute, matching the recorder's own cadence — asking faster returns the
  // same row twice.
  const q = useQuery<{ data?: GexChange | null }>(
    `/api/mult-greek-gex-change?ticker=${encodeURIComponent(ticker)}&expiry=${encodeURIComponent(expiry)}&strike=${strike}`,
    { staleMs: 30_000, pollMs: 60_000 },
  )
  const change = q.data?.data ?? null

  const pos = useMemo(() => {
    const vw = typeof window === 'undefined' ? 1200 : window.innerWidth
    const vh = typeof window === 'undefined' ? 800 : window.innerHeight
    // Below-right of the pointer by default; flipped back inside the viewport
    // rather than allowed to run off it.
    const left = Math.min(Math.max(EDGE, x + 14), vw - CARD_W - EDGE)
    const top = Math.min(Math.max(EDGE, y + 14), vh - 300)
    return { left, top }
  }, [x, y])

  const callPrem = netPrem(call)
  const putPrem = netPrem(put)
  const premDiff = callPrem == null && putPrem == null ? null : (callPrem ?? 0) - (putPrem ?? 0)

  const deltaRow = (label: string, past: number | null | undefined) => {
    let text: string
    let tone = 'text-muted opacity-50'
    if (q.loading && change == null) text = '…'
    else if (change == null) text = 'no baseline'
    else if (past == null) text = 'building'
    else {
      const d = netGex - past
      const f = fmtGex(d)
      text = d === 0 ? '—' : `${f.sign}${f.text}`
      tone = d > 0 ? 'text-gex-pos' : d < 0 ? 'text-gex-neg' : 'text-muted opacity-50'
    }
    return (
      <div key={label} className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] text-muted opacity-70">{label}</span>
        <span className={['tabular font-mono text-[10.5px] font-bold', tone].join(' ')}>{text}</span>
      </div>
    )
  }

  return (
    <div
      ref={ref}
      // Fixed, not absolute: the Card this ladder lives in has overflow-hidden,
      // and an absolutely-positioned card would be clipped by it at every edge.
      style={{ position: 'fixed', left: pos.left, top: pos.top, width: CARD_W, zIndex: 60 }}
      className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-2.5 shadow-lg"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="tabular truncate font-mono text-[14px] font-extrabold text-fg">
          {ticker} {Number.isInteger(strike) ? strike.toLocaleString('en-US') : strike.toFixed(2)}
        </span>
        <span className="flex shrink-0 items-baseline gap-2">
          <span className="whitespace-nowrap text-[10px] text-muted opacity-60">
            {Math.max(0, daysTo)}DTE · {fmtExpiry(expiry)}
          </span>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="text-[11px] leading-none text-faint hover:text-fg"
          >
            ✕
          </button>
        </span>
      </div>

      <div className="flex gap-2">
        <LegBox label="Calls" leg={call} tone="pos" />
        <LegBox label="Puts" leg={put} tone="neg" />
      </div>

      <div className="flex flex-col gap-1 border-t border-line pt-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] text-muted opacity-70">Net Prem (C−P)</span>
          <span
            className={[
              'tabular font-mono text-[11px] font-bold',
              premDiff == null || premDiff === 0
                ? 'text-muted opacity-50'
                : premDiff > 0
                  ? 'text-gex-pos'
                  : 'text-gex-neg',
            ].join(' ')}
          >
            {fmtMoney(premDiff)}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-muted opacity-80">Net GEX</span>
          <span
            className={[
              'tabular font-mono text-[12px] font-extrabold',
              netGex === 0 ? 'text-muted opacity-50' : netGex > 0 ? 'text-gex-pos' : 'text-gex-neg',
            ].join(' ')}
          >
            {fmtMoney(netGex)}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1 border-t border-line pt-2">
        {deltaRow('Δ 5 min', change?.v5)}
        {deltaRow('Δ 15 min', change?.v15)}
        {deltaRow('Δ 30 min', change?.v30)}
        {deltaRow('Δ Open', change?.vOpen)}
      </div>
    </div>
  )
}
