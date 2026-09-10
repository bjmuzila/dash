import { Fragment, useEffect, useMemo, useState } from 'react'
import { Page } from '@/design/primitives/Page'
import { Chip, SegGroup, SegMenu } from '@/design/primitives/Controls'
import { useQuery } from '@/data/api'
import { fmtPremium, fmtStrike, fmtTime } from '@/data/flowMath'
import { ContractProbe } from '@/board/topFlow/ContractProbe'
import { biasOf, biasTitle } from '@/board/topFlow/TopFlowCard'
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

const FLOORS = [
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

const SETTINGS_KEY = 'cb-v3-whales:filters'

interface Saved {
  preset: PresetKey
  floor: number
  ticker: string
  type: '' | 'C' | 'P'
  action: '' | 'BUY' | 'SELL'
  moneyness: 'all' | 'otm'
  sort: 'time' | 'premium'
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
      sort: j.sort === 'premium' ? 'premium' : DEFAULTS.sort,
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

function Tile({ k, v, sub, ink }: { k: string; v: string; sub?: string; ink?: string }) {
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2.5">
      <div className="text-2xs font-bold uppercase tracking-[0.11em] text-faint">{k}</div>
      <div className={['tabular mt-1.5 text-xl font-semibold', ink ?? 'text-fg'].join(' ')}>{v}</div>
      {sub && <div className="mt-0.5 text-2xs text-faint">{sub}</div>}
    </div>
  )
}

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-col rounded-md border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-2xs font-bold uppercase tracking-[0.11em] text-faint">{title}</h2>
        {note && <span className="ml-auto text-2xs text-faint">{note}</span>}
      </div>
      {children}
    </div>
  )
}

/** A bullish/bearish split bar. Both halves are drawn from the same total so
 *  two rows are comparable to each other, not just internally. */
function SplitBar({ bull, bear, max }: { bull: number; bear: number; max: number }) {
  const w = (v: number) => `${max > 0 ? Math.max(0, (v / max) * 100) : 0}%`
  return (
    <div className="flex h-[7px] overflow-hidden rounded-sm bg-fg/10">
      <i className="block h-full bg-up" style={{ width: w(bull) }} />
      <i className="block h-full bg-down" style={{ width: w(bear) }} />
    </div>
  )
}

export default function Whales() {
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
  const [sort, setSort] = useState<'time' | 'premium'>(saved.sort)
  // Clicking a bar in the session chart narrows the table to that day WITHOUT
  // touching the range — the tiles and the leaderboards stay on the range you
  // chose, which is what makes the day readable AS PART of it.
  const [day, setDay] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

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
    const sp = new URLSearchParams({ from, to, min_premium: String(floor), sort, limit: '300' })
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
  const selected = useMemo(
    () => (selectedId ? rows.find((r) => r.id === selectedId) ?? null : null),
    [rows, selectedId],
  )

  const s = d?.summary
  // Only prints that carry a side land in a directional bucket, so the
  // denominator is those two and not `total` — see the tile note below.
  const readable = (s?.bull ?? 0) + (s?.bear ?? 0)
  const pctOf = (v: number) => (readable > 0 ? `${Math.round((v / readable) * 100)}% of readable premium` : '—')
  const sessionMax = useMemo(
    () => Math.max(1, ...(d?.sessions ?? []).map((x) => Number(x.total))),
    [d],
  )
  const tickerMax = useMemo(
    () => Math.max(1, ...(d?.tickers ?? []).map((x) => Number(x.total))),
    [d],
  )
  const bucketMax = useMemo(
    () => Math.max(1, ...(d?.buckets ?? []).map((x) => Number(x.total))),
    [d],
  )
  const BUCKET_ORDER = ['0DTE', '1-7', '8-30', '31-90', '90+']
  const buckets = useMemo(
    () => BUCKET_ORDER.map((b) => (d?.buckets ?? []).find((x) => x.bucket === b) ?? { bucket: b, n: 0, total: 0 }),
    [d],
  )

  return (
    <Page title="Whale Archive">
      <div className="-mt-1 text-sm text-faint">
        Every option print of {money(d?.whaleFloor ?? 1_000_000)}+ premium, kept permanently. Whole market.
        {s ? ` · ${num(s.n)} prints across ${num(s.sessions)} sessions · ${money(s.total)} total premium` : ''}
        {maxDte !== null ? (
          <span className="text-faint">{maxDte === 0 ? ' · 0DTE only' : ` · ≤${maxDte} DTE`}</span>
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
          title="Hide prints below this dollar premium. $1M is the archive's own floor — nothing smaller is kept"
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

        <SegGroup<'time' | 'premium'>
          title="Row order"
          options={[{ label: 'NEWEST', value: 'time' }, { label: 'BIGGEST', value: 'premium' }]}
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

      {/* q.error covers the case this page shipped with for months: the route
          did not exist, the fetch failed, and the archive rendered as an empty
          archive with nothing to say. A failure has to look like a failure. */}
      {(d?.error || q.error) && (
        <div className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-sm text-warn">
          {d?.error ?? `Could not load the whale archive — ${q.error?.message ?? 'the request failed'}.`}
        </div>
      )}

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
          <Card
            title="Prints"
            note={d ? `${num(rows.length)} shown${s && s.n > rows.length ? ` of ${num(s.n)}` : ''}${day ? ` · ${day}` : ''}` : undefined}
          >
            <div className="flex min-h-0">
              <div className="max-h-[480px] min-w-0 flex-1 overflow-auto">
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
                      <th className="px-2 py-2 text-right font-bold">Premium</th>

                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      // A day header every time the session changes, so a
                      // multi-day range reads as days rather than one wall.
                      const newDay = i === 0 || rows[i - 1]!.sessionDate !== r.sessionDate
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
                              <td colSpan={10} className="border-t border-line bg-surface2 px-2 py-1.5 text-2xs font-bold uppercase tracking-[0.1em] text-muted">
                                {fmtDayHeader(r.sessionDate)}
                                {agg ? ` · ${num(agg.n)} prints · ${money(agg.total)}` : ''}
                              </td>
                            </tr>
                          )}
                          <tr
                            onClick={() => setSelectedId((id) => (id === r.id ? null : r.id))}
                            title="Open the contract's chart"
                            className={[
                              'cursor-pointer border-t border-line hover:bg-raised',
                              r.id === selectedId ? 'bg-raised' : '',
                            ].join(' ')}
                          >
                            <td className="tabular whitespace-nowrap px-2 py-1.5 text-faint">{fmtTime(r.ts)}</td>
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
                            <td className={['tabular px-2 py-1.5 text-right font-semibold', r.premium >= 10_000_000 ? 'text-warn' : biasInk].join(' ')}>
                              {money(r.premium)}
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

          {/* ── premium by session ────────────────────────────────────────── */}
          <Card title="Whale premium by session" note="click a bar to filter the table to that day">
            <div className="px-3 pb-2 pt-3">
              <div className="flex h-[104px] items-end gap-[5px]">
                {(d?.sessions ?? []).map((x) => {
                  const h = (v: number) => Math.max(1, (Number(v) / sessionMax) * 100)
                  return (
                    <button
                      key={x.d}
                      type="button"
                      onClick={() => setDay((cur) => (cur === x.d ? null : x.d))}
                      title={`${x.d} · ${num(x.n)} prints · ${money(x.total)}`}
                      className={[
                        'flex flex-1 flex-col justify-end gap-px rounded-sm',
                        day === x.d ? 'outline outline-1 outline-offset-2 outline-accent' : '',
                      ].join(' ')}
                    >
                      <div className="rounded-t-sm bg-up" style={{ height: `${h(x.bull)}%` }} />
                      <div className="rounded-b-sm bg-down opacity-85" style={{ height: `${h(x.bear)}%` }} />
                    </button>
                  )
                })}
                {!d?.sessions.length && <div className="w-full text-sm text-faint">No sessions in range.</div>}
              </div>
              <div className="mt-1.5 flex gap-[5px]">
                {(d?.sessions ?? []).map((x) => (
                  <div key={x.d} className="flex-1 text-center text-2xs text-faint">{x.d.slice(5)}</div>
                ))}
              </div>
              <div className="flex gap-3 pt-2 text-2xs text-faint">
                <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-up align-[-1px]" />Bullish</span>
                <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-down align-[-1px]" />Bearish</span>
                <span className="ml-auto">Mid and unclassified prints are in the total and in neither bucket</span>
              </div>
            </div>
          </Card>
        </div>

        {/* ── right column ───────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2">
          <Card title="Where the size went" note={span.label}>
            <div className="py-1">
              {(d?.tickers ?? []).map((t) => (
                <button
                  key={t.ticker}
                  type="button"
                  onClick={() => setTicker((cur) => (cur.toUpperCase() === t.ticker ? '' : t.ticker))}
                  className="grid w-full grid-cols-[56px_1fr_74px] items-center gap-2 px-3 py-1.5 text-left hover:bg-raised"
                  title={`${num(t.n)} prints · ${money(t.total)}`}
                >
                  <span className="text-sm font-semibold text-fg">{t.ticker}</span>
                  <SplitBar bull={Number(t.bull)} bear={Number(t.bear)} max={tickerMax} />
                  <span className="tabular text-right text-xs text-muted">{money(t.total)}</span>
                </button>
              ))}
              {!d?.tickers.length && <div className="px-3 py-2 text-sm text-faint">Nothing in range.</div>}
            </div>
          </Card>

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

          <Card title="Repeat strikes" note="3+ whale prints, same contract">
            <div className="py-1">
              {(d?.repeats ?? []).map((r) => (
                <div key={r.osi} className="grid grid-cols-[1fr_38px_74px] items-center gap-2 px-3 py-1.5">
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
                </div>
              ))}
              {!d?.repeats.length && (
                <div className="px-3 py-2 text-sm text-faint">
                  No contract was hit three times in this range.
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </Page>
  )
}
