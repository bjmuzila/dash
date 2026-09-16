import { Fragment, useEffect, useMemo, useState } from 'react'
import { Page } from '@/design/primitives/Page'
import { Chip, SegGroup, SegMenu } from '@/design/primitives/Controls'
import { DatePicker } from '@/design/primitives/DatePicker'
import { useQuery } from '@/data/api'
import { fmtPremium, fmtStrike, fmtTime } from '@/data/flowMath'
import { ContractProbe } from '@/board/topFlow/ContractProbe'
import { biasOf, biasTitle } from '@/board/topFlow/TopFlowCard'
import { TrackedAlertsCard, TrackButton } from './whales/TrackedAlertsCard'
import { contractKey, useWhaleAlerts } from './whales/alertsStore'
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

  const s = d?.summary
  // Only prints that carry a side land in a directional bucket, so the
  // denominator is those two and not `total` — see the tile note below.
  const readable = (s?.bull ?? 0) + (s?.bear ?? 0)
  const pctOf = (v: number) => (readable > 0 ? `${Math.round((v / readable) * 100)}% of readable premium` : '—')
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
                      <th
                        className="px-2 py-2 text-right font-bold"
                        title="Keep this contract in Tracked contracts, at the bottom of the page"
                      >Track</th>
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
                              <td colSpan={11} className="border-t border-line bg-surface2 px-2 py-1.5 text-2xs font-bold uppercase tracking-[0.1em] text-muted">
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
        </div>
      </div>

      {/* ── tracked contracts ──────────────────────────────────────────────
          Full width UNDER both columns, not in the right rail: its rows carry
          a note and a two-pane chart, and neither survives a 320px column.
          Last on the page because it is the thing you scroll to on purpose —
          the archive above is what you came for, this is what you kept.
      ──────────────────────────────────────────────────────────────────── */}
      <TrackedAlertsCard store={alerts} />
    </Page>
  )
}
