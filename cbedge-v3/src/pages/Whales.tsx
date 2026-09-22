import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Page } from '@/design/primitives/Page'
import { Chip, SegGroup, SegMenu } from '@/design/primitives/Controls'
import { DatePicker } from '@/design/primitives/DatePicker'
import { readableError, useQuery } from '@/data/api'
import { fmtPremium, fmtStrike, fmtTime } from '@/data/flowMath'
import { ContractProbe, loadProbeBars } from '@/board/topFlow/ContractProbe'
import { biasOf, biasTitle } from '@/board/topFlow/TopFlowCard'
import { TrackedAlertsCard, TrackButton } from './whales/TrackedAlertsCard'
import { contractKey, useWhaleAlerts } from './whales/alertsStore'
import { NetDriftPanel } from './whales/NetDriftPanel'
import type { TopFlowRow } from '@/board/topFlow/TopFlowCard'

// ─────────────────────────────────────────────────────────────────────────────
// /whales — THE $1M+ ARCHIVE.
//
// Every option print of a million dollars or more in premium, whole market,
// kept permanently. Where the Top Flow card is "what is printing right now",
// this is the record: months of it, filterable, and the only surface that can
// answer "has anyone been building this strike".
//
// ── IT IS NOT A SECOND TABLE ─────────────────────────────────────────────────
// A whale is a row in lse_top_flow_prints with a big enough premium, and the
// only thing that makes it permanent is the retention sweep skipping it (see
// the WHALES ARE NEVER SWEPT note in api-router.js). A second copy of the same
// print would be a second thing to keep in step, and the two would disagree the
// first time a side landed on one and not the other.
//
// ── THE TOTALS ARE NOT THE TABLE'S TOTALS ────────────────────────────────────
// Every roll-up on this page is computed in SQL over the WHOLE filtered range;
// the table renders at most `rowCap` of them. That split is deliberate and is
// the same one /proxy/flow-premsplit makes for the flow page: a total that only
// counts what fitted on screen is a number that lies quietly. So the tiles can
// legitimately say $8.42B while the table shows 200 rows.
//
// ── "OF READABLE PREMIUM" ────────────────────────────────────────────────────
// Bought and Sold only count prints that carry a side. Mid fills and prints
// that were never classified are in the TOTAL and in neither bucket — see the
// capture note in api-router.js for why a side cannot be recovered after the
// fact. The tiles say so rather than letting the two numbers look like they
// should add up to the third.
// ─────────────────────────────────────────────────────────────────────────────

interface WhaleRow extends TopFlowRow { sessionDate: string }
interface Bucketed { bucket: string; n: number; total: number }
/** `bull`/`bear` are premium bucketed by DIRECTION; `bought`/`sold` by the raw
 *  fill. They are different questions and the server returns both — see the
 *  BULLISH/BEARISH note on /api/lse/whales. */
interface Agg { n: number; total: number; bull: number; bear: number; bought: number; sold: number }
interface TickerAgg extends Agg { ticker: string }
interface SessionAgg extends Agg { d: string }
interface RepeatAgg extends Agg {
  osi: string; ticker: string; strike: string; type: string; expiry: string
}
interface WhalesResponse {
  range: { from: string; to: string }
  summary: (Agg & { calls: number; puts: number; sessions: number }) | null
  biggest: WhaleRow | null
  sessions: SessionAgg[]
  tickers: TickerAgg[]
  buckets: Bucketed[]
  repeats: RepeatAgg[]
  rows: WhaleRow[]
  rowCap: number
  whaleFloor: number
  sides?: 'directional' | 'all'
  maxDte?: number | null
  /** What the readable filter is holding back. Zero when sides === 'all'.
   *  Optional so a cached SPA talking to a server that predates it degrades to
   *  "no note" rather than throwing on a missing key. */
  unreadable?: { n: number; premium: number }
  /** Vol/OI are live-only and are not archived — null on every row here. */
  liveStats?: boolean
  error?: string | null
}

const PRESETS = [
  { key: '1d', label: '1D', days: 0 },
  { key: '5d', label: '5D', days: 4 },
  { key: '1m', label: '1M', days: 29 },
  { key: '3m', label: '3M', days: 89 },
  { key: 'all', label: 'ALL', days: 3650 },
] as const
type PresetKey = (typeof PRESETS)[number]['key']

/** null = no cap. 0 = same-day expiries only. Mirrors the live Top Flow card's
 *  stops on purpose — the same filter should offer the same choices on both. */
const DTE_STOPS: Array<{ label: string; value: number | null; title: string }> = [
  { label: 'ANY', value: null, title: 'No expiry limit' },
  { label: '0DTE', value: 0, title: 'Same-day expiries only' },
  { label: '≤7', value: 7, title: 'Expiring this week' },
  { label: '≤30', value: 30, title: 'Expiring within a month' },
  { label: '≤90', value: 90, title: 'Expiring within a quarter' },
]

// The ≥$500K stop is offered even though the API clamps `min_premium` UP to its
// own floor (TF_WHALE_FLOOR, from LSE_WHALE_FLOOR, $1M by default): below that
// line the table keeps only the last seven days, so a lower ask would hand back
// a week dressed as an archive. Until that env var is lowered on the VPS,
// picking $500K returns the $1M list — and rather than let the control look
// broken, the header says so (see the clamp note there). Lower LSE_WHALE_FLOOR
// and both the note and the clamp go away on their own: the page reads the floor
// off the response, it is not hardcoded here.
const FLOORS = [
  { label: '≥$500K', value: 500_000 },
  { label: '≥$1M', value: 1_000_000 },
  { label: '≥$2.5M', value: 2_500_000 },
  { label: '≥$5M', value: 5_000_000 },
]

// ─────────────────────────────────────────────────────────────────────────────
// SAVED FILTERS
//
// Per browser, in localStorage. The archive is a surface you come back to with
// the same question ("index whales, 0DTE, biggest first"), and re-picking six
// controls every morning is the tax this removes.
//
// Two things are deliberately NOT saved:
//
//   day         the session drill-down from clicking a bar. It is scoped to a
//               range you may not be on next time, so restoring it would open
//               the page filtered to a date the current range does not contain
//               — an empty table with no visible cause.
//   selectedId  the open contract probe. The print may not even be in the
//               filtered set on the next visit.
//
// Every field is validated ON ITS OWN against the current option lists. A stored
// value from an older list falls back to that field's default rather than
// poisoning the whole object — one retired premium stop must not wipe the other
// five settings.
// ─────────────────────────────────────────────────────────────────────────────

/** Row order. `change` is sorted HERE, not by the server — it ranks on the
 *  HIGH column (best % move since the print), which only exists client-side.
 *  The fetch for it asks for the newest 300, the same set NEWEST shows. */
type SortKey = 'time' | 'premium' | 'change'

const SETTINGS_KEY = 'cb-v3-whales:filters'

interface Saved {
  preset: PresetKey
  floor: number
  ticker: string
  type: '' | 'C' | 'P'
  action: '' | 'BUY' | 'SELL'
  moneyness: 'all' | 'otm'
  sort: SortKey
  maxDte: number | null
  showUnreadable: boolean
}

const DEFAULTS: Saved = {
  preset: '5d',
  floor: 1_000_000,
  ticker: '',
  type: '',
  action: '',
  moneyness: 'all',
  sort: 'time',
  maxDte: null,
  showUnreadable: false,
}

function loadSettings(): Saved {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULTS
    const j = JSON.parse(raw) as Partial<Saved>
    return {
      preset: PRESETS.some((p) => p.key === j.preset) ? (j.preset as PresetKey) : DEFAULTS.preset,
      floor: FLOORS.some((f) => f.value === j.floor) ? (j.floor as number) : DEFAULTS.floor,
      // Capped, uppercased and stripped the same way the input does, so a hand-
      // edited localStorage cannot put a 400-character ticker in the query.
      ticker: typeof j.ticker === 'string' ? j.ticker.trim().toUpperCase().slice(0, 12) : DEFAULTS.ticker,
      type: j.type === 'C' || j.type === 'P' ? j.type : DEFAULTS.type,
      action: j.action === 'BUY' || j.action === 'SELL' ? j.action : DEFAULTS.action,
      moneyness: j.moneyness === 'otm' ? 'otm' : DEFAULTS.moneyness,
      sort: j.sort === 'premium' || j.sort === 'change' ? j.sort : DEFAULTS.sort,
      // `null` is a real stored value (no cap) and 0 is a real stored value
      // (same-day only), so this cannot be a truthiness test.
      maxDte: DTE_STOPS.some((x) => x.value === (j.maxDte ?? null)) ? (j.maxDte ?? null) : DEFAULTS.maxDte,
      showUnreadable: j.showUnreadable === true,
    }
  } catch {
    // Private mode, blocked site data, or a corrupt entry. Defaults are a
    // working page; a throw here would be a blank one.
    return DEFAULTS
  }
}

const etYmd = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)

const num = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString())
const money = (v: number | null | undefined) => fmtPremium(Number(v ?? 0))
const fmtExpiry = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
const fmtDayHeader = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// ─────────────────────────────────────────────────────────────────────────────
// CURRENT PRICE (2026-09-21)
//
// The archive stores what a print PAID; this is what the contract is worth now,
// so every row answers "is this whale up or down". One batched request per
// hundred contracts to /proxy/api/tt/option-marks — the existing marks reader
// (live subscriber first, TastyTrade REST otherwise) — not a fetch per row. A
// contract that has expired, or that the broker does not return, is simply
// absent and the cell prints a dash.
//
// The symbol is BUILT from the four contract fields rather than trusted from
// `osi`, because TastyTrade wants the padded OCC form ("INTC  261016C00120000")
// and the archive's `osi` is whatever the feed that wrote it used. SPX flow is
// the PM-settled weekly root, SPXW; NDX and RUT likewise.
// ─────────────────────────────────────────────────────────────────────────────

const OCC_ROOT: Record<string, string> = { SPX: 'SPXW', NDX: 'NDXP', RUT: 'RUTW' }

function occOf(r: Pick<TopFlowRow, 'underlying' | 'expiry' | 'type' | 'strike'>): string | null {
  if (!r.underlying || !r.expiry || !r.type || r.strike == null) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.expiry)
  if (!m) return null
  const u = r.underlying.trim().toUpperCase()
  const root = (OCC_ROOT[u] ?? u).padEnd(6, ' ')
  const k = Math.round(Number(r.strike) * 1000)
  if (!Number.isFinite(k) || k <= 0) return null
  return `${root}${m[1]!.slice(2)}${m[2]}${m[3]}${r.type === 'P' ? 'P' : 'C'}${String(k).padStart(8, '0')}`
}
const occKey = (s: string) => s.replace(/\s+/g, '')

/** Current mark per contract (keyed by the space-free OCC). Refreshes every minute. */
function useContractMarks(rows: TopFlowRow[]): Map<string, number> {
  const symbols = useMemo(() => {
    const set = new Map<string, string>()
    for (const r of rows) {
      const o = occOf(r)
      if (o) set.set(occKey(o), o)
    }
    // Row order, not alphabetical: the first batch of 100 is the top of the
    // table, which is what is on screen when the page opens.
    return [...set.values()]
  }, [rows])
  const sig = [...symbols].sort().join(',')
  const [marks, setMarks] = useState<Map<string, number>>(new Map())
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!symbols.length) return
    let on = true
    const ctrl = new AbortController()
    const run = async () => {
      const next = new Map<string, number>()
      for (let i = 0; i < symbols.length; i += 100) {
        const chunk = symbols.slice(i, i + 100)
        try {
          const r = await fetch(
            `/proxy/api/tt/option-marks?symbols=${encodeURIComponent(chunk.join(','))}`,
            { credentials: 'same-origin', signal: ctrl.signal },
          )
          if (!r.ok) continue
          const j = (await r.json()) as { data?: { items?: Array<{ symbol: string; mark?: number; last?: number; bid?: number; ask?: number }> } }
          for (const it of j.data?.items ?? []) {
            const v = Number(it.mark) > 0 ? Number(it.mark) : Number(it.last) > 0 ? Number(it.last) : null
            if (v != null) next.set(occKey(it.symbol), v)
          }
        } catch {
          if (!on) return
        }
      }
      // Merge rather than replace: a chunk that failed this minute keeps the
      // value it had the last time instead of blanking to a dash.
      if (on) setMarks((prev) => new Map([...prev, ...next]))
    }
    void run()
    return () => { on = false; ctrl.abort() }
    // `sig` stands in for `symbols` — same contracts, same request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, tick])

  return marks
}

/** The mark for a row, or null. */
const markOf = (marks: Map<string, number>, r: TopFlowRow) => {
  const o = occOf(r)
  return o ? marks.get(occKey(o)) ?? null : null
}

// ─────────────────────────────────────────────────────────────────────────────
// HIGH SINCE THE PRINT (2026-09-21)
//
// The best mark the contract has reached from the print's own bar to now — "how
// good did this whale's trade get". Read from the same bars the probe draws
// (loadProbeBars: vault first for old prints, dxLink for today's), once per
// CONTRACT from its earliest print in the list, then sliced per row so two
// prints on the same strike each get the high since THEIR fill. Four requests
// at a time; re-read every five minutes.
// ─────────────────────────────────────────────────────────────────────────────

type HighSeries = Array<[number, number]>  // [bar open ms, bar high]

// ── VISIBLE FIRST ────────────────────────────────────────────────────────────
// ~250 contracts at four at a time is a minute or two of fetching. The queue is
// read LIVE by the workers: each one takes a contract that has a row on screen
// right now before anything else, then falls back to table order. Scroll and
// the next free worker follows you. Rows opt in with `data-rid={row.id}`.

/** Row ids currently inside the viewport (clipped by their scroll container). */
function useVisibleRowIds(dep: unknown): React.MutableRefObject<Set<string>> {
  const visible = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.rid
        if (!id) continue
        if (e.isIntersecting) visible.current.add(id)
        else visible.current.delete(id)
      }
    })
    // After paint, so the rows this render produced are in the DOM.
    const raf = window.requestAnimationFrame(() => {
      document.querySelectorAll<HTMLElement>('[data-rid]').forEach((el) => io.observe(el))
    })
    return () => { window.cancelAnimationFrame(raf); io.disconnect(); visible.current = new Set() }
  }, [dep])
  return visible
}

function useContractHighs(
  rows: TopFlowRow[],
  visible: React.MutableRefObject<Set<string>>,
): Map<string, number> {
  const jobs = useMemo(() => {
    const m = new Map<string, TopFlowRow>()
    for (const r of rows) {
      const o = occOf(r)
      if (!o) continue
      const k = occKey(o)
      const cur = m.get(k)
      if (!cur || r.ts < cur.ts) m.set(k, r)
    }
    // Table order — the fallback when nothing on screen is still waiting.
    return [...m.entries()]
  }, [rows])
  const sig = jobs.map(([k, r]) => `${k}@${r.ts}`).sort().join(',')
  // contract key → the row ids that show it, so a visible ROW can pull its
  // CONTRACT to the front of the queue.
  const rowsByKey = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const r of rows) {
      const o = occOf(r)
      if (!o) continue
      const k = occKey(o)
      const list = m.get(k)
      if (list) list.push(r.id)
      else m.set(k, [r.id])
    }
    return m
  }, [rows])
  const rowsByKeyRef = useRef(rowsByKey)
  rowsByKeyRef.current = rowsByKey
  const [series, setSeries] = useState<Map<string, HighSeries>>(new Map())
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 5 * 60_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!jobs.length) return
    let on = true
    const ctrl = new AbortController()
    const pending = jobs.slice()
    const next = () => {
      const vis = visible.current
      if (vis.size) {
        const at = pending.findIndex(([k]) => (rowsByKeyRef.current.get(k) ?? []).some((id) => vis.has(id)))
        if (at >= 0) return pending.splice(at, 1)[0]!
      }
      return pending.shift()
    }
    const worker = async () => {
      while (on && pending.length) {
        const job = next()
        if (!job) break
        const [k, r] = job
        try {
          const bars = await loadProbeBars(
            { underlying: r.underlying, expiry: r.expiry, strike: r.strike, type: r.type, osi: r.osi, ts: r.ts },
            0,
            ctrl.signal,
          )
          const hs: HighSeries = bars
            .filter((b) => Number.isFinite(b.high) && b.high > 0)
            .map((b) => [b.time, b.high])
          if (on && hs.length) setSeries((m) => new Map(m).set(k, hs))
        } catch {
          /* no bars → no high; the cell prints a dash */
        }
      }
    }
    void Promise.all([worker(), worker(), worker(), worker()])
    return () => { on = false; ctrl.abort() }
    // `sig` stands in for `jobs`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, tick])

  return useMemo(() => {
    const out = new Map<string, number>()
    for (const r of rows) {
      const o = occOf(r)
      const hs = o ? series.get(occKey(o)) : undefined
      if (!hs) continue
      // The bar that CONTAINS the print counts: open at or before the fill
      // but within one bar width of it. Bars before that are someone else's day.
      let firstIdx = -1
      for (let j = 0; j < hs.length; j++) {
        if (hs[j]![0] <= r.ts) firstIdx = j
        else break
      }
      if (firstIdx < 0) firstIdx = 0
      let hi = 0
      for (let j = firstIdx; j < hs.length; j++) hi = Math.max(hi, hs[j]![1])
      if (hi > 0) out.set(r.id, hi)
    }
    return out
  }, [rows, series])
}

/** "+12% 4.10" — the move leads, the price follows. */
function MoveCell({ value, entry }: { value: number | null; entry: number | null }) {
  const chg = value != null && entry != null && entry > 0 ? ((value - entry) / entry) * 100 : null
  const ink = chg == null ? 'text-muted' : chg >= 0 ? 'text-up' : 'text-down'
  return (
    <td className="tabular whitespace-nowrap px-2 py-1.5 text-right">
      {chg != null && (
        <span className={['font-semibold', ink].join(' ')}>
          {chg >= 0 ? '+' : ''}{chg.toFixed(0)}%
        </span>
      )}
      <span className={[chg != null ? 'ml-1 text-2xs opacity-80' : 'font-semibold', ink].join(' ')}>
        {value != null ? value.toFixed(2) : '—'}
      </span>
    </td>
  )
}

type PhoneTab = 'prints' | 'size' | 'lookup' | 'tracked' | 'drift'
const PHONE_TABS: Array<{ key: PhoneTab; label: string }> = [
  { key: 'prints', label: 'PRINTS' },
  { key: 'size', label: 'SIZE' },
  { key: 'lookup', label: 'LOOKUP' },
  { key: 'tracked', label: 'TRACKED' },
  { key: 'drift', label: 'DRIFT' },
]

/** Full-width segmented row for the phone filter sheet — thumb-sized, labelled. */
function PhoneSeg({ label, options, value, onChange }: {
  label: string
  options: Array<{ label: string; value: string }>
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 text-3xs font-bold uppercase tracking-[0.1em] text-faint">{label}</div>
      <div className="flex overflow-hidden rounded-sm border border-line">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={[
              'flex-1 py-2 text-xs font-bold tracking-[0.04em]',
              o.value === value ? 'bg-accent/15 text-accent' : 'text-faint',
            ].join(' ')}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Tile({ k, v, sub, ink }: { k: string; v: string; sub?: string; ink?: string }) {
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2.5">
      <div className="text-2xs font-bold uppercase tracking-[0.11em] text-faint">{k}</div>
      <div className={['tabular mt-1.5 text-xl font-semibold', ink ?? 'text-fg'].join(' ')}>{v}</div>
      {sub && <div className="mt-0.5 text-2xs text-faint">{sub}</div>}
    </div>
  )
}

function Card({ title, note, className, children }: {
  title: string
  note?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={['flex min-h-0 flex-col rounded-md border border-line bg-surface', className ?? ''].join(' ')}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-2xs font-bold uppercase tracking-[0.11em] text-faint">{title}</h2>
        {note && <span className="ml-auto text-2xs text-faint">{note}</span>}
      </div>
      {children}
    </div>
  )
}

export default function Whales({ phone = false }: { phone?: boolean } = {}) {
  // Lazy initialiser, not a useEffect that overwrites afterwards: reading
  // storage on first render means the first fetch already goes out with the
  // saved filters, instead of one request at the defaults and a second one a
  // tick later.
  const [saved] = useState<Saved>(loadSettings)
  const [preset, setPreset] = useState<PresetKey>(saved.preset)
  const [floor, setFloor] = useState(saved.floor)
  const [ticker, setTicker] = useState(saved.ticker)
  const [type, setType] = useState<'' | 'C' | 'P'>(saved.type)
  const [action, setAction] = useState<'' | 'BUY' | 'SELL'>(saved.action)
  const [moneyness, setMoneyness] = useState<'all' | 'otm'>(saved.moneyness)
  const [maxDte, setMaxDte] = useState<number | null>(saved.maxDte)
  // Unreadable prints — mid fills and the ones that were never classified — are
  // OFF by default, matching the live Top Flow card. Filtered on the SERVER,
  // before the row limit, so 300 rows means 300 readable prints.
  const [showUnreadable, setShowUnreadable] = useState(saved.showUnreadable)
  const [sort, setSort] = useState<SortKey>(saved.sort)
  // Clicking a bar in the session chart narrows the table to that day WITHOUT
  // touching the range — the tiles and the leaderboards stay on the range you
  // chose, which is what makes the day readable AS PART of it.
  const [day, setDay] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Phone layout only (see the PHONE LAYOUT note above the return). Declared
  // unconditionally — hooks cannot sit behind the `phone` branch.
  const [phoneTab, setPhoneTab] = useState<PhoneTab>('prints')
  const [filtersOpen, setFiltersOpen] = useState(false)

  // ── CONTRACT LOOKUP ────────────────────────────────────────────────────────
  // The archive answers "what printed big"; this answers "what did THIS contract
  // do", print or no print. They are different questions and the second one was
  // only reachable by finding a whale row for the contract first — so a strike
  // nobody swung a million dollars at had no way in at all.
  //
  // Deliberately NOT saved to localStorage with the filters: a lookup is a
  // question you asked once, and restoring last week's expiry on open would put
  // a dead contract in the panel every morning.
  const [lkTicker, setLkTicker] = useState(saved.ticker || 'SPY')
  const [lkStrike, setLkStrike] = useState('')
  const [lkExpiry, setLkExpiry] = useState('')
  const [lkType, setLkType] = useState<'C' | 'P'>('C')
  // Optional. With them the probe's hover box can answer the two questions it
  // answers for a print — what the position is worth at that minute, and what
  // it is up — for a contract you are only thinking about.
  const [lkSize, setLkSize] = useState('')
  const [lkEntry, setLkEntry] = useState('')
  const [lookup, setLookup] = useState<WhaleRow | null>(null)

  // ── TRACKED CONTRACTS ──────────────────────────────────────────────────────
  // A tracked contract is a row in Postgres against your LOGIN — the one thing
  // on this page that is not per browser, because a contract you flagged at the
  // desk is one you want on the laptop. The card renders at the bottom; the two
  // ways in are the TRACK cell on a print and the button beside LOOK UP.
  //
  // `busyKey` is the contract being written, not a boolean: two rows pressed in
  // the same second must not both go grey.
  const alerts = useWhaleAlerts()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const trackedIds = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of alerts.alerts) m.set(contractKey(a), a.id)
    return m
  }, [alerts.alerts])

  /** The card's identity for a row, or null when the row is not a whole contract. */
  const trackKeyOf = (r: WhaleRow) =>
    r.underlying && r.expiry && r.type && r.strike != null
      ? `${r.underlying}|${r.strike}|${r.type}|${r.expiry}`
      : null

  /** Track, or untrack if it is already there — the button is a toggle. */
  const toggleTrack = async (r: WhaleRow, source: 'whale' | 'lookup') => {
    // All four identity fields are nullable on a flow row, and a row missing
    // any of them is not a contract the probe could draw either — so it is not
    // one the card can hold. The button is not rendered for those (trackKeyOf
    // returns null); this is the same guard, for the callers that are not it.
    const key = trackKeyOf(r)
    if (!key || !r.underlying || !r.expiry || !r.type || r.strike == null) return
    if (busyKey) return
    setBusyKey(key)
    try {
      const existing = trackedIds.get(key)
      if (existing != null) { await alerts.remove(existing); return }
      await alerts.track({
        underlying: r.underlying,
        strike: r.strike,
        optType: r.type === 'P' ? 'P' : 'C',
        expiry: r.expiry,
        osi: r.osi,
        source,
        // A lookup has no print behind it. Sending the synthetic "now" as a
        // print time would make the row claim a fill that never happened.
        printTs: source === 'whale' ? r.ts : null,
        printSize: r.size,
        printPremium: source === 'whale' ? r.premium : null,
        entryPrice: r.price,
      })
    } finally {
      setBusyKey(null)
    }
  }


  useEffect(() => {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ preset, floor, ticker, type, action, moneyness, sort, maxDte, showUnreadable }),
      )
    } catch {
      /* best-effort — the in-memory choice still drives this session */
    }
  }, [preset, floor, ticker, type, action, moneyness, sort, maxDte, showUnreadable])

  const span = PRESETS.find((p) => p.key === preset) ?? PRESETS[1]!
  const to = etYmd(new Date())
  const from = etYmd(new Date(Date.now() - span.days * 86_400_000))

  const url = useMemo(() => {
    const sp = new URLSearchParams({ from, to, min_premium: String(floor), sort: sort === 'change' ? 'time' : sort, limit: '300' })
    if (ticker.trim()) sp.set('ticker', ticker.trim().toUpperCase())
    if (type) sp.set('type', type)
    if (action) sp.set('action', action)
    if (moneyness === 'otm') sp.set('moneyness', 'otm')
    if (showUnreadable) sp.set('sides', 'all')
    // 0 is a real value here (same-day only), so this is an explicit null test.
    if (maxDte !== null) sp.set('max_dte', String(maxDte))
    return `/api/lse/whales?${sp.toString()}`
  }, [from, to, floor, sort, ticker, type, action, moneyness, showUnreadable, maxDte])

  const q = useQuery<WhalesResponse>(url, { staleMs: 30_000, pollMs: 60_000 })
  const d = q.data

  const rows = useMemo(
    () => (d?.rows ?? []).filter((r) => !day || r.sessionDate === day),
    [d, day],
  )
  const marks = useContractMarks(rows)
  const visibleRows = useVisibleRowIds(`${rows.length}:${rows[0]?.id ?? ''}:${phoneTab}:${sort}`)
  const highs = useContractHighs(rows, visibleRows)

  // HIGHEST CHANGE: best % from the print price to the HIGH since the print.
  // Rows whose high has not loaded yet (or has no price) sink to the bottom and
  // climb into place as the HIGH column fills — the visible-first queue means
  // the top of the list settles first.
  const shown = useMemo(() => {
    if (sort !== 'change') return rows
    const pct = (r: WhaleRow) => {
      const h = highs.get(r.id)
      return h != null && r.price != null && r.price > 0 ? (h - r.price) / r.price : -Infinity
    }
    return rows.slice().sort((a, b) => pct(b) - pct(a) || b.ts - a.ts)
  }, [rows, highs, sort])
  // A ranked list crosses days on every row, so the day headers go and each
  // row carries its own date instead.
  const byDay = sort !== 'change'
  const when = (r: WhaleRow) => (byDay ? fmtTime(r.ts) : `${r.sessionDate.slice(5).replace('-', '/')} ${fmtTime(r.ts)}`)
  const selected = useMemo(
    () => (selectedId ? rows.find((r) => r.id === selectedId) ?? null : null),
    [rows, selectedId],
  )

  const lkStrikeNum = Number(lkStrike)
  const lkReady =
    lkTicker.trim().length > 0 &&
    Number.isFinite(lkStrikeNum) && lkStrikeNum > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(lkExpiry)

  // ContractProbe draws a CONTRACT, and everything else on its face — entry,
  // size, premium — is about one PRINT. A lookup has no print, so those fields
  // are null and the probe renders them as dashes, which is the true answer:
  // there is no entry here, only the contract's day.
  //
  // `ts` is the probe's time anchor, not a claim that something traded now — it
  // is what the 1D/3D/1W/1M windows are measured back from, so "now" is the
  // only value that means "the most recent bars".
  const openLookup = () => {
    if (!lkReady) return
    const t = lkTicker.trim().toUpperCase()
    // Blank means "not asked", not zero — an empty size must leave POSITION off
    // the hover box rather than print $0.
    const sizeN = Number(lkSize)
    const size = Number.isFinite(sizeN) && sizeN > 0 ? Math.round(sizeN) : null
    const entryN = Number(lkEntry)
    const price = Number.isFinite(entryN) && entryN > 0 ? entryN : null
    setLookup({
      // Keyed on the whole question, size and cost included, so editing any
      // field remounts the probe rather than leaving the previous contract's
      // bars on screen mid-fetch.
      id: `lookup:${t}:${lkExpiry}:${lkStrikeNum}:${lkType}:${size ?? ''}:${price ?? ''}`,
      ts: Date.now(),
      osi: null,
      underlying: t,
      type: lkType,
      strike: lkStrikeNum,
      expiry: lkExpiry,
      dte: null,
      size,
      price,
      premium: size && price ? size * price * 100 : 0,
      spot: null,
      side: null, action: null, sideReason: null,
      bid: null, ask: null, quoteAgeMs: null, vol: null, oi: null,
      sessionDate: etYmd(new Date()),
    })
  }

  /** Load a contract into the lookup panel and show it — used by the repeat
   *  strikes list, where every row IS a contract worth looking into. */
  const lookupContract = (ticker: string, strike: number, expiry: string, type: string) => {
    const t = ticker.trim().toUpperCase()
    const cp = type === 'P' ? 'P' : 'C'
    setLkTicker(t)
    setLkStrike(String(strike))
    setLkExpiry(expiry)
    setLkType(cp)
    setLkSize('')
    setLkEntry('')
    setLookup({
      id: `lookup:${t}:${expiry}:${strike}:${cp}`,
      ts: Date.now(),
      osi: null,
      underlying: t,
      type: cp,
      strike,
      expiry,
      dte: null, size: null, price: null, premium: 0, spot: null,
      side: null, action: null, sideReason: null,
      bid: null, ask: null, quoteAgeMs: null, vol: null, oi: null,
      sessionDate: etYmd(new Date()),
    })
  }

  // On the phone the lookup lives on its own tab, so a repeat strike tapped on
  // SIZE has to take you there or the contract loads somewhere you cannot see.
  useEffect(() => {
    if (phone && lookup) setPhoneTab('lookup')
  }, [phone, lookup])

  const s = d?.summary
  // Only prints that carry a side land in a directional bucket, so the
  // denominator is those two and not `total` — see the tile note below.
  const readable = (s?.bull ?? 0) + (s?.bear ?? 0)
  const pctOf = (v: number) => (readable > 0 ? `${Math.round((v / readable) * 100)}% of readable premium` : '—')
  const bucketMax = useMemo(
    () => Math.max(1, ...(d?.buckets ?? []).map((x) => Number(x.total))),
    [d],
  )
  const BUCKET_ORDER = ['0DTE', '1-7', '8-30', '31-90', '90+']
  const buckets = useMemo(
    () => BUCKET_ORDER.map((b) => (d?.buckets ?? []).find((x) => x.bucket === b) ?? { bucket: b, n: 0, total: 0 }),
    [d],
  )


  // ── Shared sections ─────────────────────────────────────────────────────────
  // Hoisted out of the desktop return so the phone layout renders the SAME
  // JSX rather than a copy that drifts. Desktop placement is unchanged.
  const errorBanner = (
        <div className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-sm text-warn">
          {d?.error
            ? readableError(d.error)
            : `Could not load the whale archive — ${readableError(q.error)}.`}
        </div>
  )
  const lookupCard = (
    <>
          {/* ── contract lookup ──────────────────────────────────────────────
              Four fields and the same probe the table opens. The expiry is the
              themed DatePicker, never a native <input type="date">: that widget
              renders the OS calendar — a white Chrome popup on Windows — which
              inside this rail reads as a bug (see DatePicker's own note).
          ──────────────────────────────────────────────────────────────────── */}
          <Card title="Contract lookup" note="any strike, print or not">
            <div className="flex flex-col gap-2 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <input
                  value={lkTicker}
                  onChange={(e) => setLkTicker(e.target.value.toUpperCase().slice(0, 12))}
                  onKeyDown={(e) => { if (e.key === 'Enter') openLookup() }}
                  placeholder="TICKER"
                  aria-label="Underlying"
                  className="tabular min-w-0 flex-1 rounded-sm border border-line bg-bg px-2 py-1 text-xs uppercase text-fg outline-none placeholder:text-faint placeholder:opacity-60 focus:border-accent"
                />
                <input
                  value={lkStrike}
                  onChange={(e) => setLkStrike(e.target.value.replace(/[^\d.]/g, '').slice(0, 9))}
                  onKeyDown={(e) => { if (e.key === 'Enter') openLookup() }}
                  placeholder="STRIKE"
                  inputMode="decimal"
                  aria-label="Strike"
                  className="tabular min-w-0 flex-1 rounded-sm border border-line bg-bg px-2 py-1 text-xs text-fg outline-none placeholder:text-faint placeholder:opacity-60 focus:border-accent"
                />
              </div>

              <div className="flex items-center gap-2">
                <DatePicker
                  value={lkExpiry}
                  onChange={setLkExpiry}
                  size="sm"
                  placeholder="EXPIRY"
                  title="Contract expiry"
                  // The picker's `sm` trigger is content-width by design (it is
                  // a toolbar chip everywhere else). Here it is a FIELD, sitting
                  // under two full-width inputs, so the trigger is stretched to
                  // the wrapper rather than left as a pill floating in a gap.
                  className="flex-1 [&>button]:w-full [&>button]:py-1 [&>button]:text-left"
                />
                <SegGroup<'C' | 'P'>
                  title="Calls or puts"
                  options={[{ label: 'CALL', value: 'C' }, { label: 'PUT', value: 'P' }]}
                  value={lkType}
                  onChange={setLkType}
                />
              </div>

              {/* Both optional. Size alone gives POSITION on the hover box; size
                  and cost together give OPEN P/L and the entry rung. */}
              <div className="flex items-center gap-2">
                <input
                  value={lkSize}
                  onChange={(e) => setLkSize(e.target.value.replace(/[^\d]/g, '').slice(0, 7))}
                  onKeyDown={(e) => { if (e.key === 'Enter') openLookup() }}
                  placeholder="SIZE (opt)"
                  inputMode="numeric"
                  aria-label="Contracts held"
                  title="Contracts — turns on POSITION in the hover readout"
                  className="tabular min-w-0 flex-1 rounded-sm border border-line bg-bg px-2 py-1 text-xs text-fg outline-none placeholder:text-faint placeholder:opacity-60 focus:border-accent"
                />
                <input
                  value={lkEntry}
                  onChange={(e) => setLkEntry(e.target.value.replace(/[^\d.]/g, '').slice(0, 8))}
                  onKeyDown={(e) => { if (e.key === 'Enter') openLookup() }}
                  placeholder="COST (opt)"
                  inputMode="decimal"
                  aria-label="Cost basis"
                  title="What you paid per contract — turns on the entry rung and OPEN P/L"
                  className="tabular min-w-0 flex-1 rounded-sm border border-line bg-bg px-2 py-1 text-xs text-fg outline-none placeholder:text-faint placeholder:opacity-60 focus:border-accent"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openLookup}
                  disabled={!lkReady}
                  title={lkReady ? 'Draw this contract' : 'Needs a ticker, a strike and an expiry'}
                  className={[
                    'flex-1 rounded-sm border px-2 py-1 text-2xs font-bold uppercase tracking-[0.1em] transition-colors',
                    lkReady
                      ? 'border-accent bg-accent/10 text-accent hover:bg-accent/20'
                      : 'cursor-not-allowed border-line text-faint opacity-50',
                  ].join(' ')}
                >
                  Look up
                </button>
                {/* Tracks what the FIELDS say, not what the panel is showing —
                    so a contract can be tracked without drawing it first, and
                    an edited strike tracks the strike you just typed. Size and
                    cost ride along when they are filled: they are what turns a
                    watch into a position the card can price. */}
                {lkReady && (() => {
                  const t = lkTicker.trim().toUpperCase()
                  const k = `${t}|${lkStrikeNum}|${lkType}|${lkExpiry}`
                  const sizeN = Number(lkSize)
                  const entryN = Number(lkEntry)
                  return (
                    <TrackButton
                      tracked={trackedIds.has(k)}
                      busy={busyKey === k}
                      onClick={() => void toggleTrack({
                        id: `lookup-track:${k}`,
                        ts: Date.now(),
                        osi: null,
                        underlying: t,
                        type: lkType,
                        strike: lkStrikeNum,
                        expiry: lkExpiry,
                        dte: null,
                        size: Number.isFinite(sizeN) && sizeN > 0 ? Math.round(sizeN) : null,
                        price: Number.isFinite(entryN) && entryN > 0 ? entryN : null,
                        premium: 0,
                        spot: null,
                        side: null, action: null, sideReason: null,
                        bid: null, ask: null, quoteAgeMs: null, vol: null, oi: null,
                        sessionDate: etYmd(new Date()),
                      }, 'lookup')}
                    />
                  )
                })()}
              </div>
            </div>

            {lookup ? (
              <div className="flex min-h-[360px] flex-col border-t border-line">
                <ContractProbe key={lookup.id} row={lookup} onClose={() => setLookup(null)} entryAt={null} />
              </div>
            ) : (
              <div className="border-t border-line px-3 py-2 text-2xs leading-relaxed text-faint">
                Any contract, whether or not a whale ever touched it. Add a size
                and a cost and the hover readout carries what the position is
                worth and what it is up.
              </div>
            )}
          </Card>
    </>
  )
  const sizeCard = (
    <>
          {/* ── WHERE THE SIZE WENT: TWO RANKINGS, NOT ONE ────────────────────
              One list ranked by TOTAL with a split bar made the card answer
              "who printed the most", and left "who is the biggest bullish bet
              and who is the biggest bearish bet" to be eyeballed off the ratio
              of two colours in a seven-pixel bar. Those are the two questions
              actually being asked of it, so they get a column each, sorted on
              their own side.

              The two columns are NOT the same tickers in the same order, and
              that is the point — a name can top one and be absent from the
              other. Each bar is scaled to the biggest value in ITS OWN column,
              so within a column the lengths compare; across columns they do
              not, which is why the dollar figure is always on the row.

              Both columns draw from the same server list (the top tickers by
              total premium for the range), so a name that never cracks that
              list cannot appear here even if it leads one side. Widening it is
              a `tickers` limit change on /api/lse/whales, not a UI change.
          ──────────────────────────────────────────────────────────────────── */}
          <Card title="Where the size went" note={span.label}>
            <div className="grid grid-cols-2 gap-px bg-line">
              {([
                { key: 'bull' as const, label: 'Bullish', ink: 'text-up', bar: 'bg-up' },
                { key: 'bear' as const, label: 'Bearish', ink: 'text-down', bar: 'bg-down' },
              ]).map((side) => {
                const list = (d?.tickers ?? [])
                  .map((t) => ({ ticker: t.ticker, n: Number(t.n), v: Number(t[side.key]), total: Number(t.total) }))
                  // A ticker with nothing on this side is not a zero-length bar,
                  // it is not on this side. Dropping it keeps the column short
                  // and honest instead of padding it with names at $0.
                  .filter((x) => x.v > 0)
                  .sort((a, b) => b.v - a.v)
                const max = Math.max(1, ...list.map((x) => x.v))
                return (
                  <div key={side.key} className="min-w-0 bg-surface py-1">
                    <div className={['px-2.5 pb-1 text-2xs font-bold uppercase tracking-[0.11em]', side.ink].join(' ')}>
                      {side.label}
                    </div>
                    {list.map((x) => (
                      <button
                        key={x.ticker}
                        type="button"
                        onClick={() => setTicker((cur) => (cur.toUpperCase() === x.ticker ? '' : x.ticker))}
                        className="block w-full px-2.5 py-1 text-left hover:bg-raised"
                        title={`${x.ticker} — ${money(x.v)} ${side.label.toLowerCase()} of ${money(x.total)} total · ${num(x.n)} prints`}
                      >
                        <span className="flex items-baseline justify-between gap-1.5">
                          <span className="truncate text-xs font-semibold text-fg">{x.ticker}</span>
                          <span className={['tabular shrink-0 text-2xs', side.ink].join(' ')}>{money(x.v)}</span>
                        </span>
                        <span className="mt-0.5 block h-[5px] overflow-hidden rounded-sm bg-fg/10">
                          <i className={['block h-full', side.bar].join(' ')} style={{ width: `${(x.v / max) * 100}%` }} />
                        </span>
                      </button>
                    ))}
                    {!list.length && (
                      <div className="px-2.5 py-2 text-2xs text-faint">Nothing {side.label.toLowerCase()} in range.</div>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>
    </>
  )
  const bucketsCard = (
          <Card title="Expiry buckets" note="by premium">
            <div className="py-1">
              {buckets.map((b) => (
                <div key={b.bucket} className="grid grid-cols-[56px_1fr_74px] items-center gap-2 px-3 py-1.5">
                  <span className="text-xs text-muted">{b.bucket}</span>
                  <div className="h-[7px] overflow-hidden rounded-sm bg-fg/10">
                    <i className="block h-full bg-accent" style={{ width: `${(Number(b.total) / bucketMax) * 100}%` }} />
                  </div>
                  <span className="tabular text-right text-xs text-muted">{money(b.total)}</span>
                </div>
              ))}
            </div>
          </Card>
  )
  const repeatsCard = (
          <Card title="Repeat strikes" note="3+ whale prints, same contract">
            <div className="py-1">
              {(d?.repeats ?? []).map((r) => (
                <button
                  key={r.osi}
                  type="button"
                  onClick={() => lookupContract(r.ticker, Number(r.strike), r.expiry, r.type)}
                  title="Open this contract in the lookup"
                  className="grid w-full grid-cols-[1fr_38px_74px] items-center gap-2 px-3 py-1.5 text-left hover:bg-raised"
                >
                  <span className="truncate text-xs text-fg">
                    {/* SQL hands this back as text (MAX(payload->>'strike')), so it
                        carries the raw float's digits — back through Number() to
                        round it like every other strike on the page. */}
                    {r.ticker} {fmtStrike(Number(r.strike))}{r.type} <span className="text-faint">{fmtExpiry(r.expiry)}</span>
                  </span>
                  <span className="text-xs text-faint">×{r.n}</span>
                  <span
                    title={`${num(r.n)} whale prints · ${money(r.bull)} bullish vs ${money(r.bear)} bearish`}
                    className={['tabular text-right text-xs font-semibold', Number(r.bull) >= Number(r.bear) ? 'text-up' : 'text-down'].join(' ')}
                  >
                    {money(r.total)}
                  </span>
                </button>
              ))}
              {!d?.repeats.length && (
                <div className="px-3 py-2 text-sm text-faint">
                  No contract was hit three times in this range.
                </div>
              )}
            </div>
          </Card>
  )

  // ── PHONE LAYOUT (/m/whales) ───────────────────────────────────────────────
  // The SAME page, not a second one: every piece of state, the one fetch, the
  // saved filters, the lookup and the tracked store above are shared, and the
  // roll-up cards below are the desktop's own JSX (hoisted into consts for the
  // purpose). Only the arrangement is phone-side:
  //
  //   strip      range + ticker + FILTERS pill + sort. The five folded filters
  //              move into a bottom sheet; the pill counts how many are off
  //              their default, which is the desktop's accent rule as a number.
  //   tiles      three, not five — premium + call/put split, bullish, bearish.
  //   sub-tabs   PRINTS · SIZE · LOOKUP · TRACKED · DRIFT. The desktop's right
  //              column and bottom row become tabs instead of a 3,000px scroll.
  //   prints     two-line rows instead of an 11-column table.
  //   probe      the same ContractProbe, as a full-height sheet instead of the
  //              330px side panel.
  //
  // Driven by the `phone` PROP (MWhales passes it), not useIsPhone(): the tab
  // bar's "Desktop site" opt-out lands a phone on /whales, and that has to be
  // the desktop layout or the opt-out does nothing here.
  if (phone) {
    const nonDefault =
      (floor !== DEFAULTS.floor ? 1 : 0) +
      (maxDte !== DEFAULTS.maxDte ? 1 : 0) +
      (type !== DEFAULTS.type ? 1 : 0) +
      (action !== DEFAULTS.action ? 1 : 0) +
      (moneyness !== DEFAULTS.moneyness ? 1 : 0) +
      (showUnreadable !== DEFAULTS.showUnreadable ? 1 : 0)
    const resetFilters = () => {
      setFloor(DEFAULTS.floor)
      setMaxDte(DEFAULTS.maxDte)
      setType(DEFAULTS.type)
      setAction(DEFAULTS.action)
      setMoneyness(DEFAULTS.moneyness)
      setShowUnreadable(DEFAULTS.showUnreadable)
    }
    const callPut = s && s.calls + s.puts > 0
      ? `${Math.round((s.calls / (s.calls + s.puts)) * 100)} / ${Math.round((s.puts / (s.calls + s.puts)) * 100)}`
      : '—'
    const selKey = selected ? trackKeyOf(selected) : null

    return (
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-2">
          <span aria-hidden>🐋</span>
          <h1 className="text-sm font-bold text-fg">Whale Archive</h1>
          <span className="tabular ml-auto text-2xs text-faint">
            {q.loading && !d ? 'loading…' : d ? `${d.range.from.slice(5)} → ${d.range.to.slice(5)}` : ''}
          </span>
        </header>

        <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto whitespace-nowrap border-b border-line px-3 py-2">
          <SegGroup<PresetKey>
            size="touch"
            title="How far back the archive is read"
            options={PRESETS.map((p) => ({ label: p.label, value: p.key }))}
            value={preset}
            onChange={(v) => { setPreset(v); setDay(null) }}
          />
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder="TICKER"
            aria-label="Filter to one underlying"
            autoCapitalize="characters"
            className="tabular w-[72px] shrink-0 rounded-sm border border-line bg-bg px-2 py-1.5 text-xs uppercase text-fg outline-none placeholder:text-faint placeholder:opacity-60 focus:border-accent"
          />
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className={[
              'flex shrink-0 items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-2xs font-bold tracking-[0.06em]',
              nonDefault ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted',
            ].join(' ')}
          >
            FILTERS
            {nonDefault > 0 && (
              <span className="rounded-full bg-accent px-1.5 text-3xs text-bg">{nonDefault}</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setSort((v) => (v === 'time' ? 'premium' : v === 'premium' ? 'change' : 'time'))}
            title="Row order"
            className="shrink-0 rounded-sm border border-line px-2.5 py-1.5 text-2xs font-bold tracking-[0.06em] text-muted"
          >
            {sort === 'time' ? 'NEWEST' : sort === 'premium' ? 'BIGGEST' : 'TOP CHANGE'} ⇅
          </button>
          {day && (
            <button
              type="button"
              onClick={() => setDay(null)}
              className="shrink-0 rounded-sm border border-accent bg-accent/10 px-2 py-1.5 text-2xs font-semibold text-accent"
            >
              {day} ✕
            </button>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {(d && floor < (d.whaleFloor ?? 0)) || (d && !showUnreadable && (d.unreadable?.n ?? 0) > 0) ? (
            <div className="px-3 pt-2 text-2xs leading-relaxed text-faint">
              {d && floor < (d.whaleFloor ?? 0) ? (
                <span className="text-warn">Asked for {money(floor)}, archive floor is {money(d.whaleFloor)}. </span>
              ) : null}
              {d && !showUnreadable && (d.unreadable?.n ?? 0) > 0
                ? `${num(d.unreadable?.n)} unreadable hidden (${money(d.unreadable?.premium)}).`
                : null}
            </div>
          ) : null}

          {(d?.error || q.error) && <div className="px-3 pt-2">{errorBanner}</div>}

          <div className="grid shrink-0 grid-cols-2 gap-1.5 px-3 py-2">
            <div className="col-span-2 flex items-end justify-between rounded-md border border-line bg-surface px-2.5 py-2">
              <div>
                <div className="text-3xs font-bold uppercase tracking-[0.1em] text-faint">Whale premium</div>
                <div className="tabular mt-0.5 text-lg font-bold text-fg">{money(s?.total)}</div>
                {s && <div className="tabular text-3xs text-faint">{num(s.sessions)} sessions · {num(s.n)} prints</div>}
              </div>
              <div className="text-right">
                <div className="text-3xs font-bold uppercase tracking-[0.1em] text-faint">Call / put</div>
                <div className="tabular mt-0.5 text-sm font-bold text-fg">{callPut}</div>
              </div>
            </div>
            <div className="rounded-md border border-line bg-surface px-2.5 py-2">
              <div className="text-3xs font-bold uppercase tracking-[0.1em] text-faint">Bullish</div>
              <div className="tabular mt-0.5 text-lg font-bold text-up">{money(s?.bull)}</div>
              {s && <div className="tabular text-3xs text-faint">{readable > 0 ? `${Math.round((s.bull / readable) * 100)}%` : '—'}</div>}
            </div>
            <div className="rounded-md border border-line bg-surface px-2.5 py-2">
              <div className="text-3xs font-bold uppercase tracking-[0.1em] text-faint">Bearish</div>
              <div className="tabular mt-0.5 text-lg font-bold text-down">{money(s?.bear)}</div>
              {s && <div className="tabular text-3xs text-faint">{readable > 0 ? `${Math.round((s.bear / readable) * 100)}%` : '—'}</div>}
            </div>
          </div>

          <div className="sticky top-0 z-[1] flex shrink-0 gap-4 overflow-x-auto border-b border-line bg-bg px-3">
            {PHONE_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setPhoneTab(t.key)}
                className={[
                  'shrink-0 py-2 text-2xs font-bold tracking-[0.08em]',
                  phoneTab === t.key ? 'text-fg shadow-[inset_0_-2px_0_var(--color-accent)]' : 'text-faint',
                ].join(' ')}
              >
                {t.label}
              </button>
            ))}
          </div>

          {phoneTab === 'prints' && (
            <div className="pb-3">
              {shown.map((r, i) => {
                const newDay = byDay && (i === 0 || shown[i - 1]!.sessionDate !== r.sessionDate)
                const agg = newDay ? d?.sessions.find((x) => x.d === r.sessionDate) : null
                const bias = biasOf(r)
                const biasInk = bias === 'bullish' ? 'text-up' : bias === 'bearish' ? 'text-down' : 'text-faint'
                const sideInk = r.action === 'BUY' ? 'text-up' : r.action === 'SELL' ? 'text-down' : 'text-faint'
                const k = trackKeyOf(r)
                return (
                  <Fragment key={r.id}>
                    {newDay && (
                      <div className="border-t border-line bg-surface2 px-3 py-1.5 text-3xs font-bold uppercase tracking-[0.1em] text-muted">
                        {fmtDayHeader(r.sessionDate)}
                        {agg ? ` · ${num(agg.n)} prints · ${money(agg.total)}` : ''}
                      </div>
                    )}
                    <div
                      data-rid={r.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedId(r.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') setSelectedId(r.id) }}
                      className={[
                        'flex items-center gap-2 border-t border-line px-3 py-2 active:bg-raised',
                        r.id === selectedId ? 'bg-raised' : '',
                      ].join(' ')}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-sm font-bold text-fg">{r.underlying ?? '—'}</span>
                          <span className={['tabular text-sm font-bold', r.type === 'P' ? 'text-down' : 'text-up'].join(' ')}>
                            {fmtStrike(r.strike)}{r.type ?? '?'}
                          </span>
                          <span className="tabular text-2xs text-faint">{fmtExpiry(r.expiry)}</span>
                        </div>
                        <div className="tabular mt-0.5 flex gap-1.5 overflow-hidden whitespace-nowrap text-2xs text-faint">
                          <span className={['font-semibold', biasInk].join(' ')}>
                            {bias ? `${bias === 'bullish' ? '▲ BULL' : '▼ BEAR'} ${r.action === 'BUY' ? 'B' : 'S'}${r.type ?? ''}` : r.side === 'mid' ? 'n/a' : '—'}
                          </span>
                          <span className={sideInk}>
                            {r.side === 'above_ask' ? '> ASK' : r.side === 'below_bid' ? '< BID' : r.side ? r.side.toUpperCase() : '—'}
                          </span>
                          <span>{num(r.size)} @ {r.price?.toFixed(2) ?? '—'}</span>
                          {(() => {
                            const now = markOf(marks, r)
                            if (now == null) return null
                            const chg = r.price != null && r.price > 0 ? ((now - r.price) / r.price) * 100 : null
                            const hi = highs.get(r.id)
                            return (
                              <>
                                <span className={chg == null ? 'text-muted' : chg >= 0 ? 'text-up' : 'text-down'}>
                                  → {chg != null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(0)}% ` : ''}{now.toFixed(2)}
                                </span>
                                {hi != null && <span className="text-faint">H {hi.toFixed(2)}</span>}
                              </>
                            )
                          })()}
                          {r.dte != null && <span>{r.dte}d</span>}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className={['tabular text-sm font-bold', r.premium >= 10_000_000 ? 'text-warn' : biasInk].join(' ')}>
                          {money(r.premium)}
                        </div>
                        <div className="tabular mt-0.5 text-3xs text-faint">{when(r)}</div>
                      </div>
                      {k && (
                        <TrackButton
                          compact
                          tracked={trackedIds.has(k)}
                          busy={busyKey === k}
                          onClick={() => void toggleTrack(r, 'whale')}
                        />
                      )}
                    </div>
                  </Fragment>
                )
              })}
              {!rows.length && (
                <div className="px-3 py-4 text-sm text-faint">
                  {q.loading ? 'Loading…' : 'No whale prints match these filters in this range.'}
                </div>
              )}
              {d && s && s.n > rows.length && (
                <div className="px-3 py-2 text-3xs text-faint">
                  {num(rows.length)} shown of {num(s.n)} — narrow the range or raise the floor to see the rest.
                </div>
              )}
            </div>
          )}

          {phoneTab === 'size' && (
            <div className="flex flex-col gap-2 p-3">
              {sizeCard}
              {bucketsCard}
              {repeatsCard}
            </div>
          )}
          {phoneTab === 'lookup' && <div className="p-3">{lookupCard}</div>}
          {phoneTab === 'tracked' && <div className="min-w-0 p-3"><TrackedAlertsCard store={alerts} /></div>}
          {phoneTab === 'drift' && <div className="min-w-0 p-3"><NetDriftPanel phone /></div>}
        </div>

        {/* ── filters sheet ─────────────────────────────────────────────── */}
        {filtersOpen && (
          <div className="fixed inset-0 z-50 flex flex-col justify-end">
            <button
              type="button"
              aria-label="Close filters"
              onClick={() => setFiltersOpen(false)}
              className="absolute inset-0 bg-bg/80"
            />
            <div className="relative max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface px-3.5 pb-[calc(14px+env(safe-area-inset-bottom))] pt-2">
              <div className="mx-auto mb-3 mt-1 h-1 w-9 rounded-full bg-line" />
              <PhoneSeg
                label="Floor"
                options={FLOORS.map((f) => ({ label: f.label, value: String(f.value) }))}
                value={String(floor)}
                onChange={(v) => setFloor(Number(v))}
              />
              <PhoneSeg
                label="DTE at print"
                options={DTE_STOPS.map((x) => ({ label: x.label, value: String(x.value) }))}
                value={String(maxDte)}
                onChange={(v) => setMaxDte(v === 'null' ? null : Number(v))}
              />
              <PhoneSeg
                label="Calls / puts"
                options={[{ label: 'BOTH', value: '' }, { label: 'CALLS', value: 'C' }, { label: 'PUTS', value: 'P' }]}
                value={type}
                onChange={(v) => setType(v as '' | 'C' | 'P')}
              />
              <PhoneSeg
                label="Fill"
                options={[{ label: 'EITHER', value: '' }, { label: 'BUY', value: 'BUY' }, { label: 'SELL', value: 'SELL' }]}
                value={action}
                onChange={(v) => setAction(v as '' | 'BUY' | 'SELL')}
              />
              <PhoneSeg
                label="Strike"
                options={[{ label: 'ALL', value: 'all' }, { label: 'OTM', value: 'otm' }]}
                value={moneyness}
                onChange={(v) => setMoneyness(v as 'all' | 'otm')}
              />
              <button
                type="button"
                role="switch"
                aria-checked={showUnreadable}
                onClick={() => setShowUnreadable((v) => !v)}
                className="flex w-full items-center justify-between py-2 text-xs text-muted"
              >
                <span>Show unreadable prints</span>
                <span className={['relative h-5 w-9 rounded-full transition-colors', showUnreadable ? 'bg-accent' : 'bg-line'].join(' ')}>
                  <span className={['absolute top-0.5 h-4 w-4 rounded-full bg-fg transition-all', showUnreadable ? 'left-[18px]' : 'left-0.5'].join(' ')} />
                </span>
              </button>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={resetFilters}
                  className="flex-1 rounded-md border border-line py-2.5 text-xs font-bold tracking-[0.08em] text-muted"
                >
                  RESET
                </button>
                <button
                  type="button"
                  onClick={() => { setFiltersOpen(false); setPhoneTab('prints') }}
                  className="flex-1 rounded-md border border-accent bg-accent/10 py-2.5 text-xs font-bold tracking-[0.08em] text-accent"
                >
                  {q.loading ? 'SHOW PRINTS' : `SHOW ${num(rows.length)} PRINTS`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── probe sheet ───────────────────────────────────────────────── */}
        {selected && (
          <div className="fixed inset-0 z-50 flex flex-col justify-end">
            <button
              type="button"
              aria-label="Close contract"
              onClick={() => setSelectedId(null)}
              className="absolute inset-0 bg-bg/80"
            />
            <div className="relative flex h-[calc(100%-32px)] flex-col overflow-hidden rounded-t-2xl border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
              <div className="mx-auto mb-1 mt-2 h-1 w-9 shrink-0 rounded-full bg-line" />
              <ContractProbe key={selected.id} row={selected} onClose={() => setSelectedId(null)} />
              {selKey && (
                <div className="flex shrink-0 justify-end gap-2 border-t border-line px-3 py-2.5">
                  <TrackButton
                    tracked={trackedIds.has(selKey)}
                    busy={busyKey === selKey}
                    onClick={() => void toggleTrack(selected, 'whale')}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    )
  }


  return (
    <Page title="Whale Archive">
      <div className="-mt-1 text-sm text-faint">
        Every option print of {money(d?.whaleFloor ?? 1_000_000)}+ premium, kept permanently. Whole market.
        {s ? ` · ${num(s.n)} prints across ${num(s.sessions)} sessions · ${money(s.total)} total premium` : ''}
        {maxDte !== null ? (
          <span className="text-faint">{maxDte === 0 ? ' · 0DTE only' : ` · ≤${maxDte} DTE`}</span>
        ) : null}
        {/* The FLOOR pick can be BELOW what the server will serve: /api/lse/whales
            clamps min_premium up to its own floor because under that line the
            table is a rolling 7-day mirror, not the archive. Saying so is the
            difference between a control that looks broken and one that explains
            itself. Read off the response, so lowering LSE_WHALE_FLOOR on the VPS
            retires this note with no code change. */}
        {d && floor < (d.whaleFloor ?? 0) ? (
          <span
            className="text-warn"
            title="Prints below the archive floor are only kept for seven days, so the API raises a lower ask rather than return a week of data dressed as the archive. Lowering LSE_WHALE_FLOOR on the server is what opens this up."
          >
            {' '}· asked for {money(floor)}, archive floor is {money(d.whaleFloor)}
          </span>
        ) : null}
        {/* An archive that is quietly showing you less than it holds has to say
            so. Only when something is actually hidden — a permanent parenthetical
            about a filter that is removing nothing is noise. */}
        {d && !showUnreadable && (d.unreadable?.n ?? 0) > 0 ? (
          <span
            className="text-faint"
            title="These prints never got a readable side and never will — a side cannot be recovered after the fact. They are excluded from every total on this page. Turn on SHOW UNREADABLE to include them."
          >
            {' '}· {num(d.unreadable?.n)} unreadable hidden ({money(d.unreadable?.premium)})
          </span>
        ) : null}
      </div>

      {/* ── filters ───────────────────────────────────────────────────────────
          FOLDED, not spelled out. Unfolded this row was nine segmented groups
          and twenty-four buttons, none of them labelled — two different buttons
          read `ALL` (one a range, one a moneyness) four pixels apart. Each group
          that has a real default now folds to a labelled pill showing its
          current value, and a pill only wears the accent when it is OFF that
          default. So "what is narrowing this list" is a colour scan instead of
          a nine-group read.

          Range and sort stay UNFOLDED: their options are peers, not a default
          and four deviations, so there is nothing to colour and folding them
          would cost a click to buy nothing.
      ─────────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <SegGroup<PresetKey>
          title="How far back the archive is read"
          options={PRESETS.map((p) => ({ label: p.label, value: p.key }))}
          value={preset}
          onChange={(v) => { setPreset(v); setDay(null) }}
        />
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="TICKER"
          aria-label="Filter to one underlying"
          className="tabular w-24 rounded-sm border border-line bg-bg px-2 py-0.5 text-xs uppercase text-fg outline-none placeholder:text-faint placeholder:opacity-60 focus:border-accent"
        />

        <span aria-hidden className="h-4 w-px shrink-0 bg-line" />

        <SegMenu<string>
          label="FLOOR"
          title="Hide prints below this dollar premium. The archive's own floor is the server's — a pick under it is clamped up, and the header says so when that happens"
          options={FLOORS.map((f) => ({ label: f.label, value: String(f.value) }))}
          value={String(floor)}
          defaultValue={String(DEFAULTS.floor)}
          onChange={(v) => setFloor(Number(v))}
        />
        <SegMenu<string>
          label="STRIKE"
          title="Moneyness AT PRINT TIME — a call bought 40 points OTM at 10am was an OTM buy, whatever the index did by 3pm"
          options={[
            { label: 'ALL', value: 'all', title: 'Every strike, in and out of the money' },
            { label: 'OTM', value: 'otm', title: 'Only strikes that were out of the money when they printed' },
          ]}
          value={moneyness}
          defaultValue={DEFAULTS.moneyness}
          onChange={(v) => setMoneyness(v as 'all' | 'otm')}
        />
        {/* DTE AT PRINT TIME, not days from now — the archive is historical, so
            "0DTE" means it was a same-day expiry when it printed, which is the
            thing about the trade. Prints with no readable DTE are dropped by
            this filter rather than let through; a row that cannot answer the
            question does not belong in a filtered list. Values cross as strings
            because the control is keyed on strings, and 'null' is the no-cap
            option — which is why the read back is an explicit string test. */}
        <SegMenu<string>
          label="DTE"
          title="Days to expiry AT PRINT TIME"
          options={DTE_STOPS.map((x) => ({ label: x.label, value: String(x.value), title: x.title }))}
          value={String(maxDte)}
          defaultValue={String(DEFAULTS.maxDte)}
          onChange={(v) => setMaxDte(v === 'null' ? null : Number(v))}
        />
        <SegMenu<string>
          label="C/P"
          title="Calls, puts or both"
          options={[
            { label: 'BOTH', value: '' },
            { label: 'CALLS', value: 'C' },
            { label: 'PUTS', value: 'P' },
          ]}
          value={type}
          defaultValue={DEFAULTS.type}
          onChange={(v) => setType(v as '' | 'C' | 'P')}
        />
        <SegMenu<string>
          label="FILL"
          title="Which side of the quote it filled on. This is the raw fill, NOT the direction — a SELL on a put is a bullish trade"
          options={[
            { label: 'EITHER', value: '' },
            { label: 'BUY', value: 'BUY' },
            { label: 'SELL', value: 'SELL' },
          ]}
          value={action}
          defaultValue={DEFAULTS.action}
          onChange={(v) => setAction(v as '' | 'BUY' | 'SELL')}
        />

        <span aria-hidden className="h-4 w-px shrink-0 bg-line" />

        <SegGroup<SortKey>
          title="Row order"
          options={[
            { label: 'NEWEST', value: 'time' },
            { label: 'BIGGEST', value: 'premium' },
            {
              label: 'HIGHEST CHANGE',
              value: 'change',
              title: 'Ranked by the HIGH column — the best % the contract reached above the print price since it printed. Ranks the newest 300 prints; rows climb into place as their highs load',
            },
          ]}
          value={sort}
          onChange={setSort}
        />
        {/* Stays a visible switch rather than a sixth pill: it changes what the
            tiles MEAN, not just which rows are listed. */}
        <Chip
          label="SHOW UNREADABLE"
          on={showUnreadable}
          onClick={() => setShowUnreadable((v) => !v)}
          title="Include prints whose side could not be read — mid fills, and ones that were never classified against a quote. Off by default: a print you cannot attribute to a buyer or a seller has no direction, so it cannot be in the bullish or bearish totals"
        />
        {day && (
          <button
            type="button"
            onClick={() => setDay(null)}
            className="rounded-sm border border-accent bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent"
            title="Showing one session — click to go back to the whole range"
          >
            {day} ✕
          </button>
        )}
        <span className="ml-auto text-2xs text-faint">
          {q.loading && !d ? 'loading…' : d ? `${d.range.from} → ${d.range.to}` : ''}
        </span>
      </div>

      {(d?.error || q.error) && errorBanner}

      {/* ── tiles ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Tile k="Whale premium" v={money(s?.total)} sub={s ? `${num(s.sessions)} sessions · ${num(s.n)} prints` : undefined} />
        <Tile k="Bullish" v={money(s?.bull)} ink="text-up" sub={s ? pctOf(s.bull) : undefined} />
        <Tile k="Bearish" v={money(s?.bear)} ink="text-down" sub={s ? pctOf(s.bear) : undefined} />
        <Tile
          k="Biggest print"
          v={money(d?.biggest?.premium)}
          ink="text-warn"
          sub={d?.biggest ? `${d.biggest.underlying} ${fmtStrike(d.biggest.strike)}${d.biggest.type} · ${d.biggest.sessionDate}` : undefined}
        />
        <Tile
          k="Call / put split"
          v={s && s.calls + s.puts > 0 ? `${Math.round((s.calls / (s.calls + s.puts)) * 100)} / ${Math.round((s.puts / (s.calls + s.puts)) * 100)}` : '—'}
          sub="by premium, not contracts"
        />
      </div>

      <div className="grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-2">

          {/* ── prints ───────────────────────────────────────────────────── */}
          {/* Fixed height: ~20 rows visible (sticky header + 20 × ~29px), the
              rest scrolls inside the card. Not an endless card. */}
          <Card
            title="Prints"
            note={d ? `${num(rows.length)} shown${s && s.n > rows.length ? ` of ${num(s.n)}` : ''}${day ? ` · ${day}` : ''}` : undefined}
          >
            <div className="flex min-h-0 flex-1">
              <div className="h-[612px] min-w-0 flex-1 overflow-auto">
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 z-[1] bg-surface">
                    <tr className="text-2xs uppercase tracking-[0.09em] text-faint">
                      <th className="px-2 py-2 text-left font-bold">Time</th>
                      <th className="px-2 py-2 text-left font-bold">Ticker</th>
                      <th className="px-2 py-2 text-left font-bold">Contract</th>
                      <th className="px-2 py-2 text-left font-bold">C/P</th>
                      <th className="px-2 py-2 text-left font-bold">Side</th>
                      <th
                        className="px-2 py-2 text-left font-bold"
                        title="What the print says about the UNDERLYING, not the contract. Buying calls or selling puts is bullish; selling calls or buying puts is bearish"
                      >Bias</th>
                      <th className="px-2 py-2 text-right font-bold">DTE</th>
                      <th className="px-2 py-2 text-right font-bold">Size</th>
                      <th className="px-2 py-2 text-right font-bold">Price</th>
                      <th
                        className="px-2 py-2 text-right font-bold"
                        title="The contract's highest mark since the print, and how far that is above the print price. Re-read every five minutes"
                      >High</th>
                      <th
                        className="px-2 py-2 text-right font-bold"
                        title="The contract's mark right now, and the move from the print price. Refreshes every minute; a dash means the broker has no quote (expired or delisted)"
                      >Now</th>
                      <th className="px-2 py-2 text-right font-bold">Premium</th>
                      <th
                        className="px-2 py-2 text-right font-bold"
                        title="Keep this contract in Tracked contracts, at the bottom of the page"
                      >Track</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r, i) => {
                      // A day header every time the session changes, so a
                      // multi-day range reads as days rather than one wall.
                      const newDay = byDay && (i === 0 || shown[i - 1]!.sessionDate !== r.sessionDate)
                      const agg = newDay ? d?.sessions.find((x) => x.d === r.sessionDate) : null
                      // Side stays inked by where the FILL sat; the Bias cell
                      // is inked by what the trade means. Two questions, two
                      // colour rules — a sold put is a bid-side fill (red Side)
                      // and a bullish position (green Bias), and collapsing
                      // that into one ink is what made this table misread.
                      const ink = r.action === 'BUY' ? 'text-up' : r.action === 'SELL' ? 'text-down' : 'text-faint'
                      const bias = biasOf(r)
                      const biasInk = bias === 'bullish' ? 'text-up' : bias === 'bearish' ? 'text-down' : 'text-faint'
                      return (
                        // Keyed on the PRINT, not the index: a fragment in an
                        // array needs its own key, and the row inside it is the
                        // thing that has an identity.
                        <Fragment key={r.id}>
                          {newDay && (
                            <tr>
                              <td colSpan={13} className="border-t border-line bg-surface2 px-2 py-1.5 text-2xs font-bold uppercase tracking-[0.1em] text-muted">
                                {fmtDayHeader(r.sessionDate)}
                                {agg ? ` · ${num(agg.n)} prints · ${money(agg.total)}` : ''}
                              </td>
                            </tr>
                          )}
                          <tr
                            data-rid={r.id}
                            onClick={() => setSelectedId((id) => (id === r.id ? null : r.id))}
                            title="Open the contract's chart"
                            className={[
                              'cursor-pointer border-t border-line hover:bg-raised',
                              r.id === selectedId ? 'bg-raised' : '',
                            ].join(' ')}
                          >
                            <td className="tabular whitespace-nowrap px-2 py-1.5 text-faint">{when(r)}</td>
                            <td className="px-2 py-1.5 font-semibold text-fg">{r.underlying ?? '—'}</td>
                            <td className="tabular whitespace-nowrap px-2 py-1.5 text-muted">
                              <span className="text-fg">{fmtStrike(r.strike)}</span>{' '}
                              <span className="text-faint">{fmtExpiry(r.expiry)}</span>
                            </td>
                            <td className={['px-2 py-1.5 font-semibold', r.type === 'P' ? 'text-down' : 'text-up'].join(' ')}>{r.type ?? '?'}</td>
                            <td className={['tabular whitespace-nowrap px-2 py-1.5 font-semibold', ink].join(' ')}>
                              {r.side === 'above_ask' ? '> ASK' : r.side === 'below_bid' ? '< BID' : r.side ? r.side.toUpperCase() : '—'}
                            </td>
                            <td
                              className={['whitespace-nowrap px-2 py-1.5 font-semibold', biasInk].join(' ')}
                              title={
                                bias
                                  ? biasTitle(r, bias)
                                  : r.side === 'mid'
                                    ? 'Filled between the bid and the ask — genuinely ambiguous, so no direction is called'
                                    : 'This print was never classified against a quote, and cannot be after the fact'
                              }
                            >
                              {bias ? (
                                <>
                                  <span aria-hidden>{bias === 'bullish' ? '▲' : '▼'}</span>{' '}
                                  {bias === 'bullish' ? 'BULLISH' : 'BEARISH'}
                                  {/* The raw verb kept faint beside it: the bias is the
                                      read, but you still need to see which of the four
                                      trades produced it. */}
                                  <span className="font-normal text-faint opacity-70">
                                    {' '}{r.action === 'BUY' ? 'B' : 'S'}{r.type}
                                  </span>
                                </>
                              ) : r.side === 'mid' ? 'n/a' : '—'}
                            </td>
                            <td className="tabular px-2 py-1.5 text-right text-muted">{r.dte ?? '—'}</td>
                            <td className="tabular px-2 py-1.5 text-right text-muted">{num(r.size)}</td>
                            <td className="tabular px-2 py-1.5 text-right text-muted">{r.price?.toFixed(2) ?? '—'}</td>
                            <MoveCell value={highs.get(r.id) ?? null} entry={r.price} />
                            <MoveCell value={markOf(marks, r)} entry={r.price} />
                            <td className={['tabular px-2 py-1.5 text-right font-semibold', r.premium >= 10_000_000 ? 'text-warn' : biasInk].join(' ')}>
                              {money(r.premium)}
                            </td>
                            {/* stopPropagation lives in TrackButton: this cell
                                is inside a row whose click opens the probe, and
                                tracking a print is not a request to open it. */}
                            <td className="px-2 py-1.5 text-right">
                              {(() => {
                                const k = trackKeyOf(r)
                                if (!k) return null
                                return (
                                  <TrackButton
                                    compact
                                    tracked={trackedIds.has(k)}
                                    busy={busyKey === k}
                                    onClick={() => void toggleTrack(r, 'whale')}
                                  />
                                )
                              })()}
                            </td>
                          </tr>
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
                {!rows.length && (
                  <div className="px-2 py-4 text-sm text-faint">
                    {q.loading ? 'Loading…' : 'No whale prints match these filters in this range.'}
                  </div>
                )}
              </div>

              {selected && (
                <div className="flex w-[330px] shrink-0 flex-col border-l border-line">
                  <ContractProbe key={selected.id} row={selected} onClose={() => setSelectedId(null)} />
                </div>
              )}
            </div>
          </Card>

          {/* The WHALE PREMIUM BY SESSION chart was removed 2026-09-14 — on a
              one- or two-session range it is a single 104px slab of green and
              red that says nothing the tiles do not. The `day` drill-down it
              drove is kept below (state, row filter, day chip) so bringing the
              chart back is one block, not a rewrite. */}
        </div>

        {/* ── right column ───────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2">

          {lookupCard}


          {/* ── the roll-ups ────────────────────────────────────────────────────────────
              Under the lookup, IN THE SAME COLUMN. These were briefly a
              third child of a two-column grid, which wrapped them onto a
              new row and drew them full width under the table. The grid has
              two columns, so it gets exactly two children.
          ──────────────────────────────────────────────────────────── */}
          {sizeCard}

          {bucketsCard}

          {repeatsCard}
        </div>
      </div>

      {/* ── net drift + tracked contracts ──────────────────────────────────
          One row UNDER both columns, split in half: Net Drift (from /v3/flow)
          on the left, tracked contracts on the right. Neither goes in the
          320px rail — the tracked rows carry a note and a two-pane chart.
      ──────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 items-start gap-2 xl:grid-cols-2">
        <div className="min-w-0"><NetDriftPanel /></div>
        <div className="min-w-0"><TrackedAlertsCard store={alerts} /></div>
      </div>
    </Page>
  )
}
