import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
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

export interface Bar {
  /** Epoch ms, bar open. */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}
export interface BarsResponse { bars: Bar[]; count?: number; source?: string; error?: string }

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

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE PICKING, LIFTED OUT OF THE COMPONENT
//
// The Tracked contracts card has to load the SAME bars this panel loads, from
// outside a render — once to freeze the picture the moment a contract is
// tracked, and once per row to put a mark in the list. Two copies of "which
// route holds this contract" is two things to keep in step, and the copy that
// drifts is the one that quietly stops finding anything.
// ─────────────────────────────────────────────────────────────────────────────

/** The part of a row that decides where its bars come from. */
export interface ProbeKey {
  underlying: string | null
  expiry: string | null
  strike: number | null
  type: string | null
  osi: string | null
  /** The print's own moment — or "now" for a contract nobody printed into. */
  ts: number
}

/** Both routes that might hold this contract, best bet first. Either can be null. */
export function probeUrls(row: ProbeKey, startMs: number): Array<string | null> {
  // Rounded, not raw: this value goes into `?strike=` below, and the vault
  // matches on the exact string — `504.99999999999994` finds nothing.
  const strike = roundStrike(row.strike) ?? 0
  const hasParts = Boolean(row.underlying && row.expiry && strike > 0 && row.type)
  const proxy = hasParts
    ? `/proxy/option-history?${new URLSearchParams({
        ticker: row.underlying!, expiry: row.expiry!, strike: String(strike), type: row.type!,
        start: ymd(startMs), end: ymd(Date.now()),
      }).toString()}`
    : null
  const vault = row.osi
    ? `/api/lse/contract-candles?${new URLSearchParams({
        ticker: row.osi, start: ymd(startMs), end: ymd(Date.now() + 86_400_000),
      }).toString()}`
    : hasParts
      ? `/api/lse/contract-candles?${new URLSearchParams({
          underlying: row.underlying!, strike: String(strike), expiry: row.expiry!,
          type: row.type === 'C' ? 'call' : 'put',
          start: ymd(startMs), end: ymd(Date.now() + 86_400_000),
        }).toString()}`
      : null
  // Today's print reads dxLink first; anything older goes to the vault first.
  return ymd(row.ts) === ymd(Date.now()) ? [proxy, vault] : [vault, proxy]
}

/**
 * The bars, from whichever of the two routes has them. Same fallback the panel
 * does: an EMPTY answer is not an error, it is the other source's turn.
 *
 * `days` is how far back from the row's own moment to read — 0 is that session,
 * 2 is the 3D window the card freezes at.
 */
export async function loadProbeBars(row: ProbeKey, days = 2, signal?: AbortSignal): Promise<Bar[]> {
  const urls = probeUrls(row, row.ts - days * 86_400_000)
  for (const u of urls) {
    if (!u) continue
    try {
      const r = await fetch(u, { credentials: 'same-origin', signal })
      if (!r.ok) continue
      const j = (await r.json()) as BarsResponse
      const bars = (j?.bars ?? []).filter((b) => b && b.close > 0)
      if (bars.length) return bars
    } catch {
      /* try the other source; a dead route is not a dead contract */
    }
  }
  return []
}

export function ContractProbe({ row, onClose, entryAt }: {
  row: TopFlowRow
  onClose: () => void
  /**
   * When the entry price is NOT tied to a moment — a hand-typed cost basis on
   * the whale page's contract lookup, say — pass null and the chart draws the
   * entry as a rung with no marker. Left undefined it is the print's own
   * timestamp, which is the normal case.
   *
   * Without this a typed entry would be marked at `row.ts`, and a lookup's
   * `ts` is "now" — so the dot would land on the last bar of the day at a price
   * nothing traded at there.
   */
  entryAt?: number | null
}) {
  const [range, setRange] = useState<Range>('1d')
  // 0 = the source the print's age says to try; 1 = the other one. Reset on
  // every row and every range, or a fallback taken for one contract sticks to
  // the next.
  const [attempt, setAttempt] = useState(0)
  useEffect(() => { setAttempt(0) }, [row.id, range])

  const span = RANGES.find((r) => r.key === range) ?? RANGES[0]!
  const startMs = row.ts - span.days * 86_400_000

  const urls = useMemo(
    () => probeUrls(row, startMs),
    [row.underlying, row.expiry, row.strike, row.type, row.osi, row.ts, startMs],
  )

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

  // The probe lives in a ~330px column inside the card, which is where a chart
  // carrying an entry line, a high, a low, a price rail and a volume histogram
  // stops being readable. The ⤢ pops the SAME panel out over the page — see the
  // portal at the bottom of this return.
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [expanded])

  const body = (big: boolean) => (
    <>
      <div className="flex items-baseline gap-2">
        <span className={[big ? 'text-lg' : 'text-sm', 'font-bold tracking-[0.02em] text-fg'].join(' ')}>
          {row.underlying ?? '—'}
        </span>
        <span className={[
          'tabular rounded-sm border border-warn/50 bg-warn/10 px-1.5 py-px font-bold text-warn',
          big ? 'text-xs' : 'text-2xs',
        ].join(' ')}>
          {fmtStrike(row.strike)}{row.type ?? ''}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={big ? 'Collapse' : 'Expand'}
            title={big ? 'Collapse (Esc)' : 'Expand'}
            className="flex h-6 w-6 items-center justify-center rounded-sm border border-line text-muted hover:text-fg"
          >
            <ProbeExpandIcon size={12} collapse={big} />
          </button>
          <button
            type="button"
            onClick={() => (big ? setExpanded(false) : onClose())}
            aria-label="Close"
            className="text-sm leading-none text-muted hover:text-fg"
          >
            ✕
          </button>
        </span>
      </div>
      <div className="tabular -mt-1 text-2xs text-muted">{fmtDate(row.expiry)}</div>

      <div className="flex items-center gap-2">
        <span className={[big ? 'text-xl' : 'text-base', 'leading-none', ink].join(' ')}>{dir < 0 ? '▼' : '▲'}</span>
        <span className={['tabular font-bold leading-none', big ? 'text-4xl' : 'text-2xl', ink].join(' ')}>
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
        {/* Vol/OI are LIVE numbers, joined at serve time on the Top Flow card.
            An archived whale print carries neither — there is no "now" for it —
            so the pair is omitted rather than printed as two permanent dashes.
            A dash means "this should have a value and does not"; on that surface
            they never will, which is a different statement. Either both are
            present (Top Flow) or neither is (the archive). */}
        {row.vol !== null || row.oi !== null ? (
          <>
            {' · '}
            <span className="text-3xs text-faint">VOL</span> <span className="text-fg">{row.vol?.toLocaleString() ?? '—'}</span>
            {' · '}
            <span className="text-3xs text-faint">OI</span> <span className="text-fg">{row.oi?.toLocaleString() ?? '—'}</span>
          </>
        ) : null}
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
        <ProbeChart bars={bars} entry={entry} entryTs={entryAt === undefined ? row.ts : entryAt} size={row.size} wide={big} />
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
        {big ? ' · click outside or press Esc to close' : ''}
      </div>
    </>
  )

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">{body(false)}</div>

      {/* Popped out over the page. Portalled onto <body> because every ancestor —
          the probe column, the card, the board tile — clips or stacks, and an
          overlay drawn inside any of them is trimmed to that box. The four
          properties that decide whether it is visible at all are inline rather
          than utilities, for the same reason the notes clip lightbox does it:
          this node lives outside the app root, where a purged or shadowed class
          would leave it a 0×0 transparent box and the button would read dead. */}
      {expanded && typeof document !== 'undefined' && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Contract probe"
          onClick={() => setExpanded(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            background: 'color-mix(in srgb, var(--color-bg) 90%, transparent)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex flex-col gap-3 rounded-md border border-line bg-surface2 p-5"
            style={{
              width: 'min(1100px, 94vw)',
              maxHeight: '92vh',
              minHeight: 0,
              overflowY: 'auto',
            }}
          >
            {body(true)}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

/** Four corner arrows out (expand) or in (collapse). */
function ProbeExpandIcon({ size = 12, collapse = false }: { size?: number; collapse?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {collapse ? (
        <>
          <polyline points="20 10 14 10 14 4" />
          <polyline points="4 14 10 14 10 20" />
          <line x1="14" y1="10" x2="21" y2="3" />
          <line x1="10" y1="14" x2="3" y2="21" />
        </>
      ) : (
        <>
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </>
      )}
    </svg>
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

export function ProbeChart({ bars, entry, entryTs, size, wide = false }: {
  bars: Bar[]
  entry: number | null
  /** Epoch ms of the print. Places the entry MARKER on the line — the dashed
   *  rung says what was paid, the dot says when. */
  entryTs?: number | null
  size: number | null
  /** Popped out over the page — a bigger canvas, and type scaled to match it. */
  wide?: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  const W = wide ? 1000 : 320
  const H = wide ? 460 : 250
  const PADL = wide ? 14 : 8
  const PADR = wide ? 62 : 46
  const PADT = wide ? 22 : 16
  const PADB = wide ? 30 : 24
  const GAP = wide ? 14 : 9
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

  // ── WHICH VOLUME BARS GET A NUMBER ──────────────────────────────────────
  // Only the ones that stand out. A number over every bar is a wall of type
  // nobody reads, and the reason to look at this pane at all is "which minute
  // did the size go through" — so the labels are the answer to that and
  // nothing else.
  //
  // A bar qualifies on BOTH counts: at least 3x the day's average bar, and at
  // least a third of the tallest. The average alone labels a dead contract's
  // every twitch; the fraction alone labels nothing on a session with one
  // enormous print. Capped at four, biggest first, and a label is dropped if it
  // would land on top of one already placed.
  const volLabels = useMemo(() => {
    if (n < 6) return [] as number[]
    const floor = Math.max(vAvg * 3, vMax * 0.33)
    const cand = vols
      .map((v, i) => ({ v, i }))
      .filter((c) => c.v > 0 && c.v >= floor)
      .sort((a, b) => b.v - a.v)
      .slice(0, 4)
    const kept: number[] = []
    const minGap = 30 * (wide ? 1.75 : 1)
    for (const c of cand) {
      if (kept.some((k) => Math.abs(x(k) - x(c.i)) < minGap)) continue
      kept.push(c.i)
    }
    return kept
    // x() and the sizing constants are derived from the same inputs, so the
    // bar list and the width are the whole dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vols, vAvg, vMax, n, W, PADL, PADR, wide])

  // WHERE the entry sits on the line. The print timestamp is matched to the
  // nearest bar OPEN rather than the first bar at or after it, so a fill a few
  // seconds either side of a boundary lands on the bar it belongs to. Out of
  // range (an entry before the window starts, on 3D/1W/1M) draws no marker —
  // pinning it to bar 0 would put the dot on a minute it was not printed in.
  const entryI = useMemo(() => {
    if (entryTs == null || !Number.isFinite(entryTs) || n === 0) return null
    const first = bars[0]!.time, lastT = bars[n - 1]!.time
    const span = lastT - first
    const slack = Math.max(60_000, span / Math.max(1, n - 1))
    if (entryTs < first - slack || entryTs > lastT + slack) return null
    let best = 0, bestD = Infinity
    for (let i = 0; i < n; i++) {
      const d = Math.abs(bars[i]!.time - entryTs)
      if (d < bestD) { bestD = d; best = i }
    }
    return best
  }, [bars, entryTs, n])

  const label = { fill: 'var(--color-fg)', fontFamily: MONO } as const
  const fmt = (v: number) => v.toFixed(2)
  /** Keep a point label inside the plot when its point is near an edge. */
  const EDGE = 26
  const edgeAnchor = (i: number) =>
    x(i) < PADL + EDGE ? 'start' : x(i) > W - PADR - EDGE ? 'end' : 'middle'
  const edgeX = (i: number) =>
    x(i) < PADL + EDGE ? PADL : x(i) > W - PADR - EDGE ? W - PADR : x(i)
  // Type and glyph sizes are in USER units and both viewBoxes display at roughly
  // 1:1, so without this the popped-out chart would draw the same 9px labels on
  // a canvas three times the width.
  const S = wide ? 1.75 : 1

  const onMove = (e: ReactMouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const vx = ((e.clientX - box.left) / box.width) * W
    const i = Math.round(((vx - PADL) / (W - PADL - PADR)) * (n - 1))
    setHover(i < 0 ? 0 : i > n - 1 ? n - 1 : i)
  }
  const hp = hover == null ? null : bars[hover]!
  const hpl = hp == null || entry == null ? null : (hp.close - entry) * 100
  const hpct = hp == null || entry == null || entry <= 0 ? null : ((hp.close - entry) / entry) * 100

  // ── THE HOVER READOUT ──────────────────────────────────────────────────
  // A whale chart can answer a question a plain option chart cannot: what the
  // PRINT is worth at the minute under the cursor. Size is on the row, so the
  // position's value (mark x size x 100) and the open P/L against the entry are
  // both arithmetic — and they are the numbers actually being asked for when
  // someone scrubs a $9.78M print across the day.
  //
  // Every row is conditional on the input it needs. A lookup has no entry and
  // no size, so it renders as time + mark + volume and the box shrinks to fit
  // rather than printing four dashes.
  const dollars = (v: number) => {
    const a = Math.abs(v)
    const sign = v < 0 ? '\u2212' : ''
    if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`
    if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(0)}K`
    return `${sign}$${a.toFixed(0)}`
  }
  const hrows: Array<{ k: string; v: string; ink?: string; big?: boolean }> = []
  if (hp) {
    hrows.push({ k: 'MARK', v: fmt(hp.close), big: true })
    if (hpl != null) {
      hrows.push({
        k: 'VS ENTRY',
        v: `${hpl >= 0 ? '+' : '\u2212'}$${Math.abs(hpl).toFixed(0)}/ct`,
        ink: hpl >= 0 ? 'var(--color-up)' : 'var(--color-down)',
      })
    }
    hrows.push({ k: 'BAR VOL', v: hp.volume >= 1000 ? `${(hp.volume / 1000).toFixed(1)}k` : String(hp.volume) })
    if (size && size > 0) {
      hrows.push({ k: 'POSITION', v: dollars(hp.close * size * 100), ink: 'var(--color-warn)' })
      if (entry != null && entry > 0) {
        const pl = (hp.close - entry) * size * 100
        hrows.push({ k: 'OPEN P/L', v: dollars(pl), ink: pl >= 0 ? 'var(--color-up)' : 'var(--color-down)' })
      }
    }
  }
  const BOXW = 132 * S
  const HEADH = 20 * S
  const ROWH = 15 * S
  const BOXH = HEADH + hrows.length * ROWH + 6 * S

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
          <text x={W - PADR + 7 * S} y={y(v) + 3.4 * S} fontSize={9.5 * S} fontWeight={700} style={label}>{fmt(v)}</text>
        </g>
      ))}

      <path d={area} fill="url(#cbtf-wash)" />

      {entry != null && entry > 0 && (
        <>
          <line x1={PADL} y1={y(entry)} x2={W - PADR} y2={y(entry)}
            style={{ stroke: 'var(--color-fg)' }} strokeWidth={1} strokeDasharray="1 3" opacity={0.55} />
          {/* With no marker to hang it on, the rung keeps its left-edge label. */}
          {entryI == null && (
            <text x={PADL + 2} y={y(entry) - 5 * S} fontSize={9 * S} fontWeight={700} letterSpacing="0.6" style={label}>
              ENTRY {fmt(entry)}
            </text>
          )}
        </>
      )}

      <path d={line} fill="none" style={{ stroke: 'var(--color-accent)' }} strokeWidth={1.4 * S}
        strokeLinejoin="round" strokeLinecap="round" />

      {/* ENTRY MARKER. Same ring vocabulary as the high and the low, filled with
          the page ground so the price line reads THROUGH it rather than behind
          a blob. Sits on the print's bar, at the price paid. The label flips to
          the left inside the last fifth of the canvas and above the dot when the
          entry is in the bottom third, so it never runs off the rail or collides
          with the volume pane. */}
      {entry != null && entry > 0 && entryI != null && (() => {
        const ex = x(entryI)
        // ON THE LINE, not on the rung. The fill price and the bar's mark are
        // two different numbers — a print that crossed the spread filled at
        // 11.50 while the mark sat at 12.80 — and a dot floating in open space
        // below the line reads as a bug. The dashed rung already says WHAT was
        // paid; the dot says WHEN, so it belongs on the price it is pointing at.
        const ey = y(bars[entryI]!.close)
        const flip = ex > PADL + (W - PADL - PADR) * 0.8
        const lowHalf = ey > PADT + priceH * 0.66
        return (
          <g>
            <circle cx={ex} cy={ey} r={4 * S} fill="none"
              style={{ stroke: 'var(--color-fg)' }} strokeWidth={1.4 * S} opacity={0.85} />
            <circle cx={ex} cy={ey} r={1.6 * S} style={{ fill: 'var(--color-fg)' }} />
            <text
              x={flip ? ex - 8 * S : ex + 8 * S}
              y={lowHalf ? ey - 8 * S : ey + 12 * S}
              textAnchor={flip ? 'end' : 'start'}
              fontSize={9 * S}
              fontWeight={700}
              letterSpacing="0.6"
              style={label}
            >
              ENTRY {fmt(entry)}
            </text>
          </g>
        )
      })()}

      {/* The high or the low is often the FIRST or LAST bar, and a centred label
          there hangs half off the canvas — "H 15.23" rendered as "15.23" with
          the H clipped. Anchor to the edge instead when it is close to one. */}
      <circle cx={x(hiI)} cy={y(hi)} r={2.6 * S} fill="none" style={{ stroke: 'var(--color-up)' }} strokeWidth={1.4 * S} />
      <text x={edgeX(hiI)} y={y(hi) - 8 * S} textAnchor={edgeAnchor(hiI)} fontSize={9 * S} fontWeight={700}
        style={{ fill: 'var(--color-up)', fontFamily: MONO }}>H {fmt(hi)}</text>
      <circle cx={x(loI)} cy={y(lo)} r={2.6 * S} fill="none" style={{ stroke: 'var(--color-down)' }} strokeWidth={1.4 * S} />
      <text x={edgeX(loI)} y={y(lo) + 13 * S} textAnchor={edgeAnchor(loI)} fontSize={9 * S} fontWeight={700}
        style={{ fill: 'var(--color-down)', fontFamily: MONO }}>L {fmt(lo)}</text>

      {/* Last mark, in the rail, tinted by where it sits against the entry. Pill
          type is the page ground, not white — it is on a solid green or red. */}
      <circle cx={x(n - 1)} cy={y(last)} r={2.8 * S} style={{ fill: pillVar }} />
      <rect x={W - PADR + 2} y={y(last) - 7.5 * S} width={38 * S} height={15 * S} rx={7.5 * S} style={{ fill: pillVar }} />
      <text x={W - PADR + 2 + 19 * S} y={y(last) + 3.2 * S} textAnchor="middle" fontSize={9.5 * S} fontWeight={700}
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

      {/* The standout bars, numbered. A tall bar's top is at the very edge of
          the pane, so its label goes INSIDE it in the page ground rather than
          above it in the gap, where it would collide with the price chart. */}
      {volLabels.map((i) => {
        const v = vols[i]!
        const top = vy(v)
        const inside = top < vTop + 11 * S
        const anchor = x(i) < PADL + 22 * S ? 'start' : x(i) > W - PADR - 22 * S ? 'end' : 'middle'
        return (
          <text
            key={`vl-${i}`}
            x={anchor === 'start' ? PADL : anchor === 'end' ? W - PADR : x(i)}
            y={inside ? top + 8.5 * S : top - 3 * S}
            textAnchor={anchor}
            fontSize={8.5 * S}
            fontWeight={700}
            // Inside the bar the ink is still WHITE, not the page ground: the
            // bar it sits on is the accent blue, and dark-on-accent was
            // unreadable at 8.5px (2026-09-14).
            style={{
              fill: inside || i !== fillIdx ? 'var(--color-fg)' : 'var(--color-accent)',
              fontFamily: MONO,
            }}
            opacity={inside || i === fillIdx ? 1 : 0.7}
          >
            {v >= 10_000 ? `${(v / 1000).toFixed(0)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}
          </text>
        )
      })}
      <text x={W - PADR + 7 * S} y={vTop + 8 * S} fontSize={9 * S} fontWeight={700} style={label}>
        {vMax >= 1000 ? `${(vMax / 1000).toFixed(1)}k` : vMax}
      </text>
      <text x={PADL + 2} y={vTop + 8 * S} fontSize={8 * S} fontWeight={700} letterSpacing="0.9" style={label} opacity={0.8}>
        VOLUME{size ? ` · PRINT ${size.toLocaleString()}` : ''}
      </text>

      <text x={PADL} y={H - 6 * S} fontSize={9 * S} fontWeight={700} style={label}>{etTime(bars[0]!.time)}</text>
      <text x={W - PADR} y={H - 6 * S} textAnchor="end" fontSize={9 * S} fontWeight={700} style={label}>
        {etTime(bars[n - 1]!.time)}
      </text>

      {hp && (
        <g>
          <line x1={x(hover as number)} y1={PADT} x2={x(hover as number)} y2={vTop + volH}
            style={{ stroke: 'var(--color-fg)' }} strokeWidth={1} strokeDasharray="2 3" opacity={0.4} />
          <circle cx={x(hover as number)} cy={y(hp.close)} r={3 * S}
            style={{ fill: 'var(--color-bg)', stroke: 'var(--color-accent)' }} strokeWidth={1.6 * S} />
          {/* Clamped on both ends. The box follows the cursor until it would
              cross the price rail, then stops — a readout sliding under the rail
              labels is worse than one that stops moving. */}
          <g transform={`translate(${Math.min(W - PADR - BOXW - 2, Math.max(PADL, x(hover as number) + 10))},${PADT + 2})`}>
            <rect width={BOXW} height={BOXH} rx={6 * S}
              style={{ fill: 'var(--color-surface2)', stroke: 'var(--color-line)' }} strokeWidth={1} />
            {/* Header band: the minute, and the move in percent. A rounded rect
                plus a square one, so only the TOP corners round. */}
            <rect width={BOXW} height={HEADH} rx={6 * S} style={{ fill: 'var(--color-raised)' }} />
            <rect y={HEADH - 6 * S} width={BOXW} height={6 * S} style={{ fill: 'var(--color-raised)' }} />
            <text x={9 * S} y={HEADH - 6 * S} fontSize={9 * S} fontWeight={700} style={label} opacity={0.65}>
              {etTime(hp.time)}
            </text>
            {hpct != null && (
              <text x={BOXW - 9 * S} y={HEADH - 6 * S} textAnchor="end" fontSize={9 * S} fontWeight={700}
                style={{ fill: hpct >= 0 ? 'var(--color-up)' : 'var(--color-down)', fontFamily: MONO }}>
                {hpct >= 0 ? '+' : '\u2212'}{Math.abs(hpct).toFixed(1)}%
              </text>
            )}
            {hrows.map((r, i) => {
              const ry = HEADH + (i + 1) * ROWH - 4 * S
              return (
                <g key={r.k}>
                  <text x={9 * S} y={ry} fontSize={8 * S} fontWeight={700} letterSpacing="0.08em"
                    style={label} opacity={0.45}>{r.k}</text>
                  <text x={BOXW - 9 * S} y={ry} textAnchor="end" fontSize={(r.big ? 11 : 9.5) * S} fontWeight={700}
                    style={{ fill: r.ink ?? 'var(--color-fg)', fontFamily: MONO }}>{r.v}</text>
                </g>
              )
            })}
          </g>
        </g>
      )}
    </svg>
  )
}
