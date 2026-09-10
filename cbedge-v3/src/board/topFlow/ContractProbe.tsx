import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useQuery } from '@/data/api'
import { fmtPremium, fmtStrike, roundStrike } from '@/data/flowMath'
import type { TopFlowRow } from './TopFlowCard'

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT PROBE — what the print did after it printed.
//
// Opened by clicking a row in Top Flow. The treatment is the owner probe's
// (owner-vite/src/pages/Probe.tsx) and premarket's Core Contracts chart, so the
// same picture reads the same way on all three: ice line over a fading wash, a
// dashed break-even at the fill, the high marked green and the low red, a
// RIGHT-HAND price rail with the last mark in a pill tinted by P/L, and the
// contract's own volume sharing the x axis underneath.
//
// ── TWO SOURCES, AND THE CLIENT PICKS ────────────────────────────────────────
// A print from TODAY is drawn from /proxy/option-history — dxLink, the same feed
// the /flow drawer already rides, and the freshest thing available. Anything
// older comes from /api/lse/contract-candles, because option-history is anchored
// to the print's own session and will not reach back.
//
// The choice is made HERE rather than server-side for one reason: this component
// knows the print's timestamp, and the server would have to be told it anyway.
// Both routes answer the same `{ time, open, high, low, close, volume }` shape,
// so nothing below cares which one replied.
//
// It also FALLS BACK either way on an empty answer. That is not belt-and-braces:
// a contract that expired inside the vault's ~120-day window is gone from dxLink
// long before it is gone from the vault, and a 0DTE that printed an hour ago is
// in dxLink before the vault has it. Whichever we ask first, the other one is
// sometimes the one holding the bars.
//
// ── WHY IT CAN LEGITIMATELY HAVE NOTHING ─────────────────────────────────────
// The vault drops expired contracts about 120 days after expiry and its archive
// begins 2026-01-02 (md files/LSE-DATA-LIMITS.md). Past either edge there is no
// chart to draw and never will be, so the panel says which edge it hit instead
// of showing an empty frame that reads as a bug.
// ─────────────────────────────────────────────────────────────────────────────

interface Bar {
  /** Epoch ms, bar open. */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}
interface BarsResponse { bars: Bar[]; count?: number; source?: string; error?: string }

type Range = '1d' | '3d' | '1w' | '1m'
const RANGES: Array<{ key: Range; label: string; days: number }> = [
  { key: '1d', label: '1D', days: 0 },
  { key: '3d', label: '3D', days: 2 },
  { key: '1w', label: '1W', days: 6 },
  { key: '1m', label: '1M', days: 29 },
]

const ymd = (ms: number) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms))

const etTime = (ms: number) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(new Date(ms))

const fmtDate = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' })
}

/** ~120 days past expiry the vault drops the contract; before this there is nothing at all. */
const VAULT_FLOOR_MS = Date.parse('2026-01-02T00:00:00Z')
const VAULT_EXPIRY_GRACE_DAYS = 120

export function ContractProbe({ row, onClose }: { row: TopFlowRow; onClose: () => void }) {
  const [range, setRange] = useState<Range>('1d')
  // 0 = the source the print's age says to try; 1 = the other one. Reset on
  // every row and every range, or a fallback taken for one contract sticks to
  // the next.
  const [attempt, setAttempt] = useState(0)
  useEffect(() => { setAttempt(0) }, [row.id, range])

  const printedToday = ymd(row.ts) === ymd(Date.now())
  const span = RANGES.find((r) => r.key === range) ?? RANGES[0]!
  const startMs = row.ts - span.days * 86_400_000

  const urls = useMemo(() => {
    // Rounded, not raw: this value goes into `?strike=` below, and the vault
    // matches on the exact string — `504.99999999999994` finds nothing.
    const strike = roundStrike(row.strike) ?? 0
    const proxy = row.underlying && row.expiry && strike > 0 && row.type
      ? `/proxy/option-history?${new URLSearchParams({
          ticker: row.underlying, expiry: row.expiry, strike: String(strike), type: row.type,
          start: ymd(startMs), end: ymd(Date.now()),
        }).toString()}`
      : null
    const vault = row.osi
      ? `/api/lse/contract-candles?${new URLSearchParams({
          ticker: row.osi, start: ymd(startMs), end: ymd(Date.now() + 86_400_000),
        }).toString()}`
      : row.underlying && row.expiry && strike > 0 && row.type
        ? `/api/lse/contract-candles?${new URLSearchParams({
            underlying: row.underlying, strike: String(strike), expiry: row.expiry,
            type: row.type === 'C' ? 'call' : 'put',
            start: ymd(startMs), end: ymd(Date.now() + 86_400_000),
          }).toString()}`
        : null
    // Today's print reads dxLink first; anything older goes to the vault first.
    return printedToday ? [proxy, vault] : [vault, proxy]
  }, [row.underlying, row.expiry, row.strike, row.type, row.osi, startMs, printedToday])

  const url = urls[attempt] ?? null
  const q = useQuery<BarsResponse>(url, { staleMs: 30_000 })
  const bars = useMemo(() => (q.data?.bars ?? []).filter((b) => b.close > 0), [q.data])

  // An empty answer is not an error — it is the other source's turn.
  useEffect(() => {
    if (attempt === 0 && q.data && bars.length === 0 && urls[1]) setAttempt(1)
  }, [attempt, q.data, bars.length, urls])

  // Why there is nothing, when there is nothing. Both of these are permanent
  // facts about the archive, not a failed request, and saying so is the
  // difference between "no data" and "this will never load".
  const expiredOut = useMemo(() => {
    if (!row.expiry) return false
    const exp = Date.parse(`${row.expiry}T00:00:00Z`)
    return Number.isFinite(exp) && Date.now() - exp > VAULT_EXPIRY_GRACE_DAYS * 86_400_000
  }, [row.expiry])
  const beforeArchive = row.ts < VAULT_FLOOR_MS

  const entry = row.price
  const last = bars.length ? bars[bars.length - 1]!.close : null
  const pct = entry != null && entry > 0 && last != null ? ((last - entry) / entry) * 100 : null
  const perCt = entry != null && last != null ? (last - entry) * 100 : null
  const dir = pct == null ? 0 : pct > 0 ? 1 : pct < 0 ? -1 : 0
  const ink = dir > 0 ? 'text-up' : dir < 0 ? 'text-down' : 'text-muted'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-bold tracking-[0.02em] text-fg">{row.underlying ?? '—'}</span>
        <span className="tabular rounded-sm border border-warn/50 bg-warn/10 px-1.5 py-px text-2xs font-bold text-warn">
          {fmtStrike(row.strike)}{row.type ?? ''}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-auto text-sm leading-none text-muted hover:text-fg"
        >
          ✕
        </button>
      </div>
      <div className="tabular -mt-1 text-2xs text-muted">{fmtDate(row.expiry)}</div>

      <div className="flex items-center gap-2">
        <span className={['text-base leading-none', ink].join(' ')}>{dir < 0 ? '▼' : '▲'}</span>
        <span className={['tabular text-2xl font-bold leading-none', ink].join(' ')}>
          {pct == null ? '—' : `${Math.abs(pct).toFixed(1)}%`}
        </span>
      </div>

      <div className="tabular text-2xs text-muted">
        <span className="text-3xs text-faint">IN</span> <span className="text-fg">{entry?.toFixed(2) ?? '—'}</span>
        {' → '}
        <span className="text-3xs text-faint">NOW</span> <span className="text-fg">{last?.toFixed(2) ?? '—'}</span>
        {perCt != null && (
          <>
            {' · '}
            <span className={ink}>{perCt >= 0 ? '+' : '−'}${Math.abs(perCt).toFixed(0)}/ct</span>
          </>
        )}
      </div>
      <div className="tabular text-2xs text-muted">
        <span className="text-3xs text-faint">SIZE</span> <span className="text-fg">{row.size?.toLocaleString() ?? '—'}</span>
        {' · '}
        <span className="text-3xs text-faint">PREM</span> <span className="text-fg">{fmtPremium(row.premium)}</span>
        {' · '}
        <span className="text-3xs text-faint">VOL</span> <span className="text-fg">{row.vol?.toLocaleString() ?? '—'}</span>
        {' · '}
        <span className="text-3xs text-faint">OI</span> <span className="text-fg">{row.oi?.toLocaleString() ?? '—'}</span>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-t border-line pt-2">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={[
              'tabular rounded-sm border px-2 py-0.5 text-2xs transition-colors',
              range === r.key ? 'border-fg/25 bg-raised text-fg' : 'border-line text-muted hover:text-fg',
            ].join(' ')}
          >
            {r.label}
          </button>
        ))}
        <span className="ml-auto text-3xs text-faint">
          {q.loading && !bars.length ? 'loading…' : q.data?.source === 'lse' ? 'vault' : bars.length ? 'live' : ''}
        </span>
      </div>

      {bars.length >= 2 ? (
        <ProbeChart bars={bars} entry={entry} size={row.size} />
      ) : (
        <div className="px-1 py-6 text-2xs leading-relaxed text-faint">
          {q.loading
            ? 'Loading…'
            : beforeArchive
              ? 'This print is older than the contract archive, which begins 2026-01-02. There are no bars for it and there will not be.'
              : expiredOut
                ? 'This contract expired more than ~120 days ago and has aged out of the archive. Nothing to draw.'
                : q.error
                  ? `Could not load bars — ${q.error.message}`
                  : 'No bars for this contract in the window.'}
        </div>
      )}

      <div className="tabular text-3xs text-faint">
        Option price (mark) · contract volume · entry @ {entry?.toFixed(2) ?? '—'} · printed {etTime(row.ts)}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// The picture.
//
// Every label is `--color-fg` — not a white alpha. Chart type sits over a wash
// and a line, and an alpha that reads fine on a flat card turns to mud over the
// gradient. Colours go through `style`, never presentation attributes: a var()
// in stroke="" does not resolve and the chart falls back to black.
// ─────────────────────────────────────────────────────────────────────────────

const MONO = 'ui-monospace,Menlo,Consolas,monospace'

function ProbeChart({ bars, entry, size }: { bars: Bar[]; entry: number | null; size: number | null }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 320, H = 250
  const PADL = 8, PADR = 46, PADT = 16, PADB = 24, GAP = 9
  const volH = Math.round((H - PADT - PADB - GAP) * 0.24)
  const priceH = H - PADT - PADB - GAP - volH

  const n = bars.length
  const ys = bars.map((b) => b.close)
  const hi = Math.max(...ys), lo = Math.min(...ys)
  const hiI = ys.indexOf(hi), loI = ys.indexOf(lo)
  // The entry line is part of the picture, not an annotation on top of it — a
  // domain that excludes it draws it off-canvas.
  const dom = entry != null && entry > 0 ? [...ys, entry] : ys
  let minY = Math.min(...dom), maxY = Math.max(...dom)
  if (minY === maxY) { minY -= 1; maxY += 1 }
  const pad = (maxY - minY) * 0.13
  minY -= pad; maxY += pad

  const x = (i: number) => PADL + (n <= 1 ? 0 : i / (n - 1)) * (W - PADL - PADR)
  const y = (v: number) => PADT + ((maxY - v) / (maxY - minY || 1)) * priceH
  const pts = bars.map((b, i) => `${x(i).toFixed(1)},${y(b.close).toFixed(1)}`)
  const line = `M${pts.join(' L')}`
  const area = `${line} L${x(n - 1).toFixed(1)},${PADT + priceH} L${x(0).toFixed(1)},${PADT + priceH} Z`

  const last = ys[n - 1]!
  const up = entry != null ? last - entry : null
  const pillVar = up == null ? 'var(--color-accent)' : up >= 0 ? 'var(--color-up)' : 'var(--color-down)'

  // Volume. The bar the print landed in is the accent one — on a whale print it
  // usually towers over its neighbours, and that is the fastest tell between an
  // opening trade and one that joined a busy contract.
  const vols = bars.map((b) => b.volume)
  const vMax = Math.max(1, ...vols)
  const vAvg = vols.reduce((a, b) => a + b, 0) / (vols.length || 1)
  const vTop = PADT + priceH + GAP
  const vy = (v: number) => vTop + volH - (v / vMax) * volH
  const bw = Math.max(1, ((W - PADL - PADR) / n) * 0.62)
  const fillIdx = vols.indexOf(vMax)

  const label = { fill: 'var(--color-fg)', fontFamily: MONO } as const
  const fmt = (v: number) => v.toFixed(2)

  const onMove = (e: ReactMouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const vx = ((e.clientX - box.left) / box.width) * W
    const i = Math.round(((vx - PADL) / (W - PADL - PADR)) * (n - 1))
    setHover(i < 0 ? 0 : i > n - 1 ? n - 1 : i)
  }
  const hp = hover == null ? null : bars[hover]!
  const hpl = hp == null || entry == null ? null : (hp.close - entry) * 100

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <defs>
        <linearGradient id="cbtf-wash" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--color-accent)' }} stopOpacity={0.20} />
          <stop offset="100%" style={{ stopColor: 'var(--color-accent)' }} stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* Three rungs — high, entry, low. Five lines over a wash is fence, not
          scale, and these are the only prices the chart is asked about. */}
      {[hi, entry != null && entry > 0 ? entry : (hi + lo) / 2, lo].map((v, i) => (
        <g key={i}>
          <line x1={PADL} y1={y(v)} x2={W - PADR} y2={y(v)} style={{ stroke: 'var(--color-line)' }} strokeWidth={1} />
          <text x={W - PADR + 7} y={y(v) + 3.4} fontSize={9.5} fontWeight={700} style={label}>{fmt(v)}</text>
        </g>
      ))}

      <path d={area} fill="url(#cbtf-wash)" />

      {entry != null && entry > 0 && (
        <>
          <line x1={PADL} y1={y(entry)} x2={W - PADR} y2={y(entry)}
            style={{ stroke: 'var(--color-fg)' }} strokeWidth={1} strokeDasharray="1 3" opacity={0.55} />
          <text x={PADL + 2} y={y(entry) - 5} fontSize={9} fontWeight={700} letterSpacing="0.6" style={label}>
            ENTRY {fmt(entry)}
          </text>
        </>
      )}

      <path d={line} fill="none" style={{ stroke: 'var(--color-accent)' }} strokeWidth={1.4}
        strokeLinejoin="round" strokeLinecap="round" />

      <circle cx={x(hiI)} cy={y(hi)} r={2.6} fill="none" style={{ stroke: 'var(--color-up)' }} strokeWidth={1.4} />
      <text x={x(hiI)} y={y(hi) - 8} textAnchor="middle" fontSize={9} fontWeight={700}
        style={{ fill: 'var(--color-up)', fontFamily: MONO }}>H {fmt(hi)}</text>
      <circle cx={x(loI)} cy={y(lo)} r={2.6} fill="none" style={{ stroke: 'var(--color-down)' }} strokeWidth={1.4} />
      <text x={x(loI)} y={y(lo) + 13} textAnchor="middle" fontSize={9} fontWeight={700}
        style={{ fill: 'var(--color-down)', fontFamily: MONO }}>L {fmt(lo)}</text>

      {/* Last mark, in the rail, tinted by where it sits against the entry. Pill
          type is the page ground, not white — it is on a solid green or red. */}
      <circle cx={x(n - 1)} cy={y(last)} r={2.8} style={{ fill: pillVar }} />
      <rect x={W - PADR + 2} y={y(last) - 7.5} width={38} height={15} rx={7.5} style={{ fill: pillVar }} />
      <text x={W - PADR + 21} y={y(last) + 3.2} textAnchor="middle" fontSize={9.5} fontWeight={700}
        style={{ fill: 'var(--color-bg)', fontFamily: MONO }}>{fmt(last)}</text>

      {/* ── volume ─────────────────────────────────────────────────────────── */}
      <line x1={PADL} y1={vTop + volH} x2={W - PADR} y2={vTop + volH}
        style={{ stroke: 'var(--color-line)' }} strokeWidth={1} />
      {bars.map((b, i) => (
        <rect
          key={b.time}
          x={x(i) - bw / 2}
          y={vy(b.volume)}
          width={bw}
          height={Math.max(0.6, vTop + volH - vy(b.volume))}
          style={{ fill: i === fillIdx ? 'var(--color-accent)' : 'var(--color-fg)' }}
          opacity={i === fillIdx ? 1 : 0.28}
        />
      ))}
      <line x1={PADL} y1={vy(vAvg)} x2={W - PADR} y2={vy(vAvg)}
        style={{ stroke: 'var(--color-fg)' }} strokeWidth={1} strokeDasharray="1 3" opacity={0.3} />
      <text x={W - PADR + 7} y={vTop + 8} fontSize={9} fontWeight={700} style={label}>
        {vMax >= 1000 ? `${(vMax / 1000).toFixed(1)}k` : vMax}
      </text>
      <text x={PADL + 2} y={vTop + 8} fontSize={8} fontWeight={700} letterSpacing="0.9" style={label} opacity={0.8}>
        VOLUME{size ? ` · PRINT ${size.toLocaleString()}` : ''}
      </text>

      <text x={PADL} y={H - 6} fontSize={9} fontWeight={700} style={label}>{etTime(bars[0]!.time)}</text>
      <text x={W - PADR} y={H - 6} textAnchor="end" fontSize={9} fontWeight={700} style={label}>
        {etTime(bars[n - 1]!.time)}
      </text>

      {hp && (
        <g>
          <line x1={x(hover as number)} y1={PADT} x2={x(hover as number)} y2={PADT + priceH}
            style={{ stroke: 'var(--color-fg)' }} strokeWidth={1} strokeDasharray="2 3" opacity={0.4} />
          <circle cx={x(hover as number)} cy={y(hp.close)} r={3}
            style={{ fill: 'var(--color-bg)', stroke: 'var(--color-accent)' }} strokeWidth={1.6} />
          <g transform={`translate(${Math.min(W - PADR - 96, Math.max(PADL, x(hover as number) + 8))},${PADT + 2})`}>
            <rect width={94} height={34} rx={5}
              style={{ fill: 'var(--color-surface2)', stroke: 'var(--color-line)' }} strokeWidth={1} />
            <text x={7} y={13} fontSize={8.5} fontWeight={700} style={label}>{etTime(hp.time)}</text>
            <text x={7} y={27} fontSize={11} fontWeight={700} style={label}>{fmt(hp.close)}</text>
            {hpl != null && (
              <text x={54} y={27} fontSize={9.5} fontWeight={700}
                style={{ fill: hpl >= 0 ? 'var(--color-up)' : 'var(--color-down)', fontFamily: MONO }}>
                {hpl >= 0 ? '+' : '−'}${Math.abs(hpl).toFixed(0)}
              </text>
            )}
          </g>
        </g>
      )}
    </svg>
  )
}
