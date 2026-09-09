import { useEffect, useMemo, useState } from 'react'
import { CardToolbar } from '@/design/primitives/Card'
import { PanelSection, Popover, SegGroup } from '@/design/primitives/Controls'
import { useQuery } from '@/data/api'
import { STALE_AFTER_SEC, fmtAgo, fmtPremium, fmtTime } from '@/data/flowMath'
import { useTick } from '@/data/flowData'

// ─────────────────────────────────────────────────────────────────────────────
// TOP FLOW — the whole options market's biggest prints, from the LSE vault.
//
// Not a second Flow Tape. The Flow Tape is OUR recorder, one ticker at a time,
// riding the socket; this is a WHOLE-MARKET sweep — every underlying the vault
// sees — ranked by dollar premium. The two answer different questions ("what is
// SPX doing" vs "where did the size go today") and neither replaces the other.
//
// ── One request, one server-side sweep ───────────────────────────────────────
// The card polls /api/lse/top-flow, which holds ONE cached vault sweep for the
// whole site and filters it per request (see the block in server-v2/
// api-router.js). Every cogwheel setting is therefore free: changing Min
// Premium or Max DTE re-filters the same cached session rather than firing a
// vault call. The server's own floor is the lowest stop this card offers, so a
// setting below it cannot exist and cannot silently return a short list.
//
// ── Why the freshness line is not a LIVE badge ───────────────────────────────
// The vault serves the trailing week of prints and how far behind its live edge
// runs is not documented (md files/LSE-DATA-LIMITS.md). So the header states two
// facts and draws no conclusion: when the server last swept, and how old the
// newest print in the session is. Past STALE_AFTER_SEC that age goes warn-
// coloured. A card that claimed LIVE and then quietly froze is exactly the
// failure the Flow Tape's "last print … ago" line exists to prevent, and this
// one has MORE room to go wrong, not less — it is a third-party feed.
// ─────────────────────────────────────────────────────────────────────────────

/** Dollars. The first stop must match TF_BASE_MIN_PREMIUM on the server. */
const PREMIUM_STOPS = [
  { label: '$50K', value: 50_000 },
  { label: '$100K', value: 100_000 },
  { label: '$250K', value: 250_000 },
  { label: '$500K', value: 500_000 },
  { label: '$1M', value: 1_000_000 },
] as const

/** null = no cap. 0 = same-day expiries only. */
const DTE_STOPS = [
  { label: '0', value: 0, title: 'Same-day expiries only' },
  { label: '≤7', value: 7, title: 'This week' },
  { label: '≤30', value: 30, title: 'Within a month' },
  { label: '≤90', value: 90, title: 'Within a quarter' },
  { label: 'ANY', value: null, title: 'No expiry limit' },
] as const

const ROW_STOPS = [25, 50, 100] as const

type SortKey = 'premium' | 'time'

interface Settings {
  minPremium: number
  maxDte: number | null
  sort: SortKey
  rows: number
}

const DEFAULTS: Settings = { minPremium: 250_000, maxDte: null, sort: 'premium', rows: 50 }

/** Per COPY of the card, not per card type — two Top Flows side by side are
 *  almost always two different questions (0DTE whales vs the month's biggest). */
const settingsKey = (instanceId: string) => `cb-v3-board-topflow:${instanceId}`

function loadSettings(instanceId: string): Settings {
  try {
    const raw = localStorage.getItem(settingsKey(instanceId))
    if (!raw) return DEFAULTS
    const j = JSON.parse(raw) as Partial<Settings>
    return {
      // Each field validated on its own: a stored value from an older stop list
      // must fall back to the default, not poison the whole object.
      minPremium: PREMIUM_STOPS.some((s) => s.value === j.minPremium)
        ? (j.minPremium as number) : DEFAULTS.minPremium,
      maxDte: DTE_STOPS.some((s) => s.value === (j.maxDte ?? null))
        ? (j.maxDte ?? null) : DEFAULTS.maxDte,
      sort: j.sort === 'time' || j.sort === 'premium' ? j.sort : DEFAULTS.sort,
      rows: ROW_STOPS.includes(j.rows as (typeof ROW_STOPS)[number]) ? (j.rows as number) : DEFAULTS.rows,
    }
  } catch {
    return DEFAULTS
  }
}

export interface TopFlowRow {
  id: string
  /** Epoch ms. */
  ts: number
  osi: string | null
  underlying: string | null
  type: 'C' | 'P' | null
  strike: number | null
  expiry: string | null
  dte: number | null
  size: number | null
  price: number | null
  premium: number
  spot: number | null
  side: string | null
}

interface TopFlowResponse {
  rows: TopFlowRow[]
  count: number
  matched: number
  sessionDate: string | null
  asOf: string | null
  newestTs: number | null
  baseMinPremium: number
  refreshMs: number
  error: string | null
}

/** Matches the server's cache window — polling faster only re-serves the cache. */
const POLL_MS = 20_000

const fmtNum = (n: number | null) => (n === null ? '—' : n.toLocaleString())
const fmtPrice = (n: number | null) => (n === null ? '—' : n.toFixed(2))
const fmtStrike = (n: number | null) =>
  n === null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '')
/** "Sep 19" — the year is noise on a tape where everything is inside a year. */
const fmtExpiry = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function Cog({ s, onPatch }: { s: Settings; onPatch: (p: Partial<Settings>) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Top Flow settings"
        title="Sort, minimum premium, expiry window and row count"
        className={[
          'flex items-center rounded-sm border px-1.5 py-0.5 leading-none transition-colors',
          open ? 'border-accent bg-raised text-fg' : 'border-line text-muted opacity-60 hover:opacity-100',
        ].join(' ')}
      >
        <svg
          aria-hidden
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
      </button>
      <Popover open={open} onClose={() => setOpen(false)}>
        <div className="flex w-56 flex-col gap-2">
          <PanelSection title="Sort">
            <SegGroup<SortKey>
              title="What the list is ranked by"
              options={[
                { label: 'BIGGEST', value: 'premium', title: 'The session’s largest prints by dollar premium — a leaderboard, so rows move as bigger trades land' },
                { label: 'NEWEST', value: 'time', title: 'Most recent first — a tape, newest at the top' },
              ]}
              value={s.sort}
              onChange={(v) => onPatch({ sort: v })}
            />
          </PanelSection>
          <PanelSection title="Min premium">
            <SegGroup<string>
              title="Hide prints below this dollar premium"
              options={PREMIUM_STOPS.map((p) => ({ label: p.label, value: String(p.value) }))}
              value={String(s.minPremium)}
              onChange={(v) => onPatch({ minPremium: Number(v) })}
            />
            <span className="text-3xs leading-snug text-faint opacity-70">
              $50K is the floor the server sweeps at — nothing smaller is collected, so no
              lower setting exists.
            </span>
          </PanelSection>
          <PanelSection title="Max DTE">
            <SegGroup<string>
              title="Only contracts expiring within this many days"
              options={DTE_STOPS.map((d) => ({
                label: d.label,
                value: String(d.value),
                title: d.title,
              }))}
              value={String(s.maxDte)}
              onChange={(v) => onPatch({ maxDte: v === 'null' ? null : Number(v) })}
            />
          </PanelSection>
          <PanelSection title="Rows">
            <SegGroup<string>
              title="How many prints to list"
              options={ROW_STOPS.map((n) => ({ label: String(n), value: String(n) }))}
              value={String(s.rows)}
              onChange={(v) => onPatch({ rows: Number(v) })}
            />
          </PanelSection>
        </div>
      </Popover>
    </div>
  )
}

export function TopFlowCard({ instanceId = 'top-flow' }: { instanceId?: string } = {}) {
  const [s, setS] = useState<Settings>(() => loadSettings(instanceId))
  const patch = (p: Partial<Settings>) => setS((prev) => ({ ...prev, ...p }))

  useEffect(() => {
    try {
      localStorage.setItem(settingsKey(instanceId), JSON.stringify(s))
    } catch {
      /* best-effort — the in-memory choice still drives this session */
    }
  }, [instanceId, s])

  const url = useMemo(() => {
    const sp = new URLSearchParams({
      min_premium: String(s.minPremium),
      sort: s.sort,
      limit: String(s.rows),
    })
    if (s.maxDte !== null) sp.set('max_dte', String(s.maxDte))
    return `/api/lse/top-flow?${sp.toString()}`
  }, [s])

  const q = useQuery<TopFlowResponse>(url, { staleMs: 10_000, pollMs: POLL_MS })
  const rows = q.data?.rows ?? []

  // The age of the newest print has to keep counting once the data stops
  // arriving — that is the whole point of showing it. Nothing else re-renders
  // this card when a feed goes quiet.
  const tick = useTick()
  const ageSec = useMemo(
    () => {
      const ts = q.data?.newestTs
      return ts ? Math.max(0, (Date.now() - ts) / 1000) : null
    },
    // `tick` is the trigger, not an input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q.data?.newestTs, tick],
  )
  // Staleness only MEANS anything while the vault's session is today's. Outside
  // market hours the newest print is hours old by definition, and colouring
  // that warn every evening would train the eye to ignore the one signal on the
  // card that matters during the day.
  const todayEt = useMemo(
    () =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date()),
    // Recomputed on the slow clock so the card rolls over at midnight ET
    // without a remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick],
  )
  const liveSession = Boolean(q.data?.sessionDate) && q.data?.sessionDate === todayEt
  const stale = liveSession && ageSec !== null && ageSec >= STALE_AFTER_SEC
  const failed = Boolean(q.error) || Boolean(q.data?.error)

  const totalPrem = useMemo(() => rows.reduce((sum, r) => sum + r.premium, 0), [rows])

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2"
      // For the caption under a CopyShot. See shell/snapshot.ts.
      data-capture-meta={`whole market · ${s.sort === 'premium' ? 'biggest' : 'newest'} · ≥${fmtPremium(s.minPremium)}${s.maxDte === null ? '' : ` · ≤${s.maxDte} DTE`}`}
    >
      <CardToolbar>
        <span
          title={
            failed
              ? `The last sweep failed — showing the last data that arrived. ${q.data?.error ?? q.error?.message ?? ''}`
              : 'When the server last swept the vault'
          }
          className={[
            'tabular w-[54px] rounded-sm bg-raised px-2 py-0.5 text-center text-3xs',
            failed ? 'text-warn' : q.data ? 'text-accent' : 'text-down',
          ].join(' ')}
        >
          {failed ? 'ERROR' : q.data ? 'VAULT' : 'WAITING'}
        </span>
        <Cog s={s} onPatch={patch} />
      </CardToolbar>

      <div className="flex flex-wrap items-baseline gap-4 px-1 text-xs text-muted">
        <span className="font-bold uppercase tracking-[0.08em] text-fg">
          {s.sort === 'premium' ? 'Biggest' : 'Newest'}
        </span>
        <span>
          <strong className="tabular text-fg">{rows.length.toLocaleString()}</strong>
          {q.data && q.data.matched > rows.length ? (
            <span className="text-faint"> of {q.data.matched.toLocaleString()}</span>
          ) : null}{' '}
          prints
        </span>
        <span>
          Total <strong className="tabular text-fg">{fmtPremium(totalPrem)}</strong>
        </span>
        <span className="text-faint">
          ≥{fmtPremium(s.minPremium)}
          {s.maxDte === null ? '' : ` · ≤${s.maxDte} DTE`}
        </span>
        {/* Two facts, no verdict — see the header note. */}
        {q.data?.newestTs ? (
          <span
            className={['tabular ml-auto', stale ? 'text-warn' : 'text-faint'].join(' ')}
            title="The newest print in the vault's session, and how long ago it was. This is the feed's live edge, not this card's refresh"
          >
            {liveSession
              ? `newest ${fmtTime(q.data.newestTs)} · ${fmtAgo(ageSec)} ago`
              : `session ${q.data.sessionDate} · closed`}
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-2xs">
          <thead className="sticky top-0 z-[1] bg-bg">
            <tr className="text-3xs uppercase tracking-[0.08em] text-faint">
              <th className="px-1.5 py-1 text-left font-bold">Time</th>
              <th className="px-1.5 py-1 text-left font-bold">Ticker</th>
              <th className="px-1.5 py-1 text-left font-bold">Contract</th>
              <th className="px-1.5 py-1 text-right font-bold">DTE</th>
              <th className="px-1.5 py-1 text-right font-bold">Size</th>
              <th className="px-1.5 py-1 text-right font-bold">Price</th>
              <th className="px-1.5 py-1 text-right font-bold">Premium</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line hover:bg-raised">
                <td className="tabular px-1.5 py-1 text-faint">{fmtTime(r.ts)}</td>
                <td className="px-1.5 py-1 font-semibold text-fg">{r.underlying ?? '—'}</td>
                <td className="tabular px-1.5 py-1 text-muted">
                  <span className="text-fg">{fmtStrike(r.strike)}</span>
                  <span className={r.type === 'P' ? 'text-down' : 'text-up'}> {r.type ?? '?'}</span>
                  <span className="text-faint"> {fmtExpiry(r.expiry)}</span>
                </td>
                <td className="tabular px-1.5 py-1 text-right text-muted">
                  {r.dte === null ? '—' : r.dte}
                </td>
                <td className="tabular px-1.5 py-1 text-right text-muted">{fmtNum(r.size)}</td>
                <td className="tabular px-1.5 py-1 text-right text-muted">{fmtPrice(r.price)}</td>
                <td
                  className={[
                    'tabular px-1.5 py-1 text-right font-semibold',
                    r.type === 'P' ? 'text-down' : 'text-up',
                  ].join(' ')}
                >
                  {fmtPremium(r.premium)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* An empty list has three causes and they are not the same problem. */}
        {rows.length === 0 && (
          <div className="px-1.5 py-3 text-xs text-faint">
            {failed
              ? 'The vault sweep failed — nothing to show yet.'
              : q.loading || !q.data
                ? 'Loading…'
                : 'No prints match these filters yet.'}
          </div>
        )}
      </div>
    </div>
  )
}
