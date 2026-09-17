import { lazy, Suspense } from 'react'
import type { FlowTapePrint } from '@/contract/frames'
import { T, alpha } from '@/design/theme'
import type { ContractStat } from '@/data/flowData'
import {
  MAX_TAPE_ROWS,
  WHALE_FLOOR,
  dteOf,
  fmtContractCost,
  fmtPremium,
  fmtSpot,
  fmtStat,
  fmtTime,
  isBullish,
  printIdentity,
  type View,
} from '@/data/flowMath'

const ContractDrawer = lazy(() =>
  import('@/pages/flow/ContractDrawer').then((m) => ({ default: m.ContractDrawer })),
)

// ─────────────────────────────────────────────────────────────────────────────
// THE FLOW TAPE — the fifteen-column print table, and the one on the board.
//
// Lifted out of pages/Flow.tsx unchanged so the board's Flow Tape card is the
// SAME tape rather than a second one that looks like it. Two copies of a table
// with this many columns, this many tooltips and a drawer hanging off every
// whale row is two places for a column to go wrong, and the board card is
// exactly where nobody would notice.
//
// It is a grid rather than the Table primitive: a row here can EXPAND into a
// contract drawer, and a <tbody> that grows a full-width panel between two rows
// is a colspan trick that fights every other thing Table does well.
//
// Pure presentation — every input arrives as a prop. The caller owns the
// filtering, the merge and the live lookups, which is what lets the page drive
// it from its filter panel and the card drive it from one slider.
// ─────────────────────────────────────────────────────────────────────────────

/** A print plus its normalized display root. The caller does the norm once. */
export interface Row extends FlowTapePrint {
  tickerNorm: string
}

/** Ticker Time Side Strike Spot Type Size Cost/Ctr Premium | Vol OI IV %OTM DTE | Expiry Bias */
const GRID = '78px 56px 84px 72px 46px 74px 88px 96px 74px 68px 58px 66px 44px 88px 74px'
const GRID_COMBINED = `64px ${GRID}`

const HEADERS: Array<{ label: string; align?: 'right' | 'center'; title?: string }> = [
  { label: 'Time' },
  { label: 'Side' },
  { label: 'Strike', align: 'right' },
  { label: 'Spot', align: 'right' },
  { label: 'Type', align: 'center' },
  { label: 'Size', align: 'right' },
  { label: 'Cost/Ctr', align: 'right', title: 'Cost of one contract (price × 100)' },
  { label: 'Premium', align: 'right' },
  { label: 'Vol', align: 'right', title: "Contract's traded volume TODAY (live, not at print time)" },
  { label: 'OI', align: 'right', title: "Contract's current open interest" },
  { label: 'IV', align: 'right', title: 'Current implied volatility' },
  { label: '% OTM', align: 'right', title: 'Strike vs LIVE underlying spot. + = OTM, − = now ITM' },
  { label: 'DTE', align: 'right', title: 'Calendar days to expiration' },
  { label: 'Expiry', align: 'right' },
  { label: 'Bias', align: 'center' },
]

const CELL_ALIGN = { right: 'text-right', center: 'text-center' } as const

export interface TapeProps {
  rows: Row[]
  /** Rows BEFORE the render cap, so the footer can say what is being hidden. */
  totalRows: number
  view: View
  date: string
  isToday: boolean
  status: string
  label: string
  expandedKey: string | null
  onToggle: (k: string | null) => void
  lookupStat: (r: Row) => ContractStat | null
  spotByTicker: Record<string, number>
  /**
   * The cap the caller applied to `rows`. Only used in the "showing newest N of
   * M" footer — the slicing itself belongs to the caller, because the page and
   * the board card cap at different numbers.
   */
  cap?: number
}

export function Tape({
  rows,
  totalRows,
  view,
  date,
  isToday,
  status,
  label,
  expandedKey,
  onToggle,
  lookupStat,
  spotByTicker,
  cap = MAX_TAPE_ROWS,
}: TapeProps) {
  const template = view === 'combined' ? GRID_COMBINED : GRID

  if (totalRows === 0) {
    return (
      <p className="p-6 text-xs text-muted">
        {!isToday
          ? `No ${label} flow recorded for ${date}.`
          : status === 'LIVE'
            ? `No ${label} flow matches the current filters.`
            : 'Connecting to feed…'}
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: view === 'combined' ? 1180 : 1116 }}>
        <div
          className="grid gap-2 border-b border-line px-4 py-2 text-2xs font-bold uppercase tracking-[0.06em] text-muted"
          style={{ gridTemplateColumns: template }}
        >
          {view === 'combined' && <span>Ticker</span>}
          {HEADERS.map((h) => (
            <span key={h.label} className={h.align ? CELL_ALIGN[h.align] : undefined} title={h.title}>
              {h.label}
            </span>
          ))}
        </div>

        <div>
          {rows.map((o, i) => (
            <TapeRow
              key={`${o.ts}-${o.symbol}-${i}`}
              row={o}
              view={view}
              date={date}
              template={template}
              expandedKey={expandedKey}
              onToggle={onToggle}
              stat={lookupStat(o)}
              spotByTicker={spotByTicker}
            />
          ))}
          {totalRows > cap && (
            <p className="px-4 py-2.5 text-center text-xs text-muted">
              Showing newest {cap.toLocaleString()} of {totalRows.toLocaleString()} — tighten
              filters to narrow.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function TapeRow({
  row: o, view, date, template, expandedKey, onToggle, stat, spotByTicker,
}: {
  row: Row
  view: View
  date: string
  template: string
  expandedKey: string | null
  onToggle: (k: string | null) => void
  stat: ContractStat | null
  spotByTicker: Record<string, number>
}) {
  const bull = isBullish(o.side, o.type)
  const sideClass = o.side === 'buy' ? 'text-up' : 'text-down'

  // The EXPANSION key is the print's identity, never its index: the tape
  // re-sorts on every refresh, and an index-keyed drawer would silently
  // re-point at whatever print landed in that slot.
  const identity = printIdentity(o)
  const open = expandedKey === identity

  // A whale is a print big enough to be worth inspecting. Only these expand;
  // making every row expandable would invite a chain fetch for $50K of noise.
  const whale = Number(o.premium || 0) >= WHALE_FLOOR

  const d = dteOf(o.expiration, date)
  // Live moneyness: + = still OTM, − = has gone ITM since the print.
  const liveSpot = spotByTicker[o.tickerNorm] ?? o.spot ?? 0
  const otmPct =
    liveSpot > 0 && o.strike
      ? ((o.type === 'C' ? o.strike - liveSpot : liveSpot - o.strike) / liveSpot) * 100
      : null

  return (
    <div>
      <div
        onClick={whale ? () => onToggle(open ? null : identity) : undefined}
        role={whale ? 'button' : undefined}
        tabIndex={whale ? 0 : undefined}
        onKeyDown={
          whale
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onToggle(open ? null : identity)
                }
              }
            : undefined
        }
        title={whale ? 'Click to expand contract detail' : undefined}
        style={{
          gridTemplateColumns: template,
          ...(open ? { background: alpha(T.cyan, 0.1), outline: `1px solid ${alpha(T.cyan, 0.4)}` } : {}),
        }}
        className={[
          'grid items-center gap-2 border-b border-line px-4 py-2 text-xs tabular',
          whale ? 'cursor-pointer' : '',
          'hover:bg-raised',
        ].filter(Boolean).join(' ')}
      >
        {view === 'combined' && <span className="font-semibold text-accent">{o.tickerNorm}</span>}
        <span className="text-muted">{fmtTime(o.ts)}</span>
        <span className={['font-semibold', sideClass].join(' ')}>{o.side.toUpperCase()}</span>
        <span className="text-right text-fg">{o.strike.toLocaleString()}</span>
        <span className="text-right text-muted">{fmtSpot(o.spot)}</span>
        <span className={['text-center font-semibold', sideClass].join(' ')}>{o.type}</span>
        <span className="text-right text-fg" title={o.fills && o.fills > 1 ? `${o.fills} fills aggregated` : undefined}>
          {o.size.toLocaleString()}
          {o.fills && o.fills > 1 ? <span className="text-2xs text-muted"> ×{o.fills}</span> : null}
        </span>
        <span className="text-right text-fg">{fmtContractCost(o.price)}</span>
        {/* Whale premium reads bold — the one column you scan down. */}
        <span className={['text-right', sideClass, whale ? 'text-sm font-black' : 'font-semibold'].join(' ')}>
          {whale ? '▸ ' : ''}
          {fmtPremium(o.premium)}
        </span>
        <span className="text-right text-fg">{fmtStat(stat?.vol)}</span>
        <span className="text-right text-muted">{fmtStat(stat?.oi)}</span>
        <span className="text-right text-fg">
          {stat?.iv != null ? `${(stat.iv * 100).toFixed(1)}%` : '—'}
        </span>
        <span
          className={[
            'text-right font-semibold',
            otmPct == null ? 'text-muted' : otmPct >= 0 ? 'text-accent' : 'text-down',
          ].join(' ')}
          title={
            liveSpot > 0
              ? `Strike ${o.strike} vs live spot ${liveSpot.toFixed(2)} — ${otmPct != null && otmPct < 0 ? 'now ITM' : 'OTM'}`
              : 'No live spot yet'
          }
        >
          {otmPct == null ? '—' : `${otmPct.toFixed(1)}%`}
        </span>
        <span className="text-right text-muted">{d == null ? '—' : `${d}d`}</span>
        <span className="text-right text-muted">{o.expiration ?? '—'}</span>
        <span className={['text-center font-bold', bull ? 'text-up' : 'text-down'].join(' ')}>
          {bull ? '▲ BULL' : '▼ BEAR'}
        </span>
      </div>
      {open && (
        <Suspense fallback={<div className="border-b border-line px-4 py-3 text-xs text-muted">Loading contract detail…</div>}>
          <ContractDrawer
            order={o}
            ticker={o.tickerNorm}
            stat={stat}
            liveSpot={liveSpot}
            onClose={() => onToggle(null)}
          />
        </Suspense>
      )}
    </div>
  )
}
