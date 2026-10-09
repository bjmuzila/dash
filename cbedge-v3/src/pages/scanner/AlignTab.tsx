// ─────────────────────────────────────────────────────────────────────────────
// ALIGN — the render layer for /scanner?tab=align.
//
// Which tickers have the walls of their nearest expirations stacked on ONE
// strike, away from spot — and has 0DTE joined them yet. The model, the states
// and every threshold are in `align.ts`; this file fetches, filters and paints.
//
// FOUR THINGS THAT ARE NOT OBVIOUS
//
//   1. ONE REQUEST FOR THE WHOLE ROSTER. /proxy/strike-growth/align returns
//      every scanner ticker's current walls plus each wall's history as
//      run-length segments, cached ~45s server-side. Only the wall MODE is in
//      the URL; tolerance, distance, dominance, hold and the 0DTE rule are all
//      client-side, so changing them never refetches.
//   2. TWO VIEWS OF THE SAME ROWS. Board (a table) and Stacks (mini ladders +
//      the alignment tape) are one `rows` memo painted twice.
//   3. A TICKER CLICK IS A URL. It pushes `?sym=AMZN&d=2026-10-07`, which mounts
//      the replay (`AlignReplay`). Pushed, not replaced, so Back returns to the
//      board, and the drill-in is a link you can paste.
//   4. NO CANVAS HERE. The board and stacks are plain DOM; the one chart lives
//      in AlignReplay behind ChartFrame (non-negotiables 4–6 apply there).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card } from '@/design/primitives/Card'
import { SegGroup, Select } from '@/design/primitives/Controls'
import { T, V2, V2W, alpha } from '@/design/theme'
import { readableError, useQuery } from '@/data/api'
import { EM_DASH, fmtB } from '@/pages/scanner/format'
import {
  ALIGN_DATES_URL,
  ALIGN_POLL_MS,
  DEFAULT_SETTINGS,
  STATE_LABEL,
  alignUrl,
  buildRow,
  etToday,
  pastDate,
  fmtEt,
  fmtExpiry,
  fmtHeld,
  fmtStrike,
  sortRows,
  type AlignEvent,
  type AlignMode,
  type AlignResponse,
  type AlignRow,
  type AlignSettings,
  type AlignState,
  type AlignSymbolRaw,
  type AlignUniverse,
} from '@/pages/scanner/align'
import { DIM, EVENT_COLOR, LABEL, STATE_COLOR, pillStyle } from '@/pages/scanner/alignStyle'
import AlignReplay from '@/pages/scanner/AlignReplay'
import { SCANNER_MAIN } from '@/data/scannerTickers'

/** Fallback universe for Align · Main when the server sends no `hot` flag. */
const MAIN_SET = new Set(SCANNER_MAIN)

// ── Settings (remembered per browser) ────────────────────────────────────────

const STORE_KEY = 'cb-v3-scanner-align'
/**
 * v2 (2026-10-08): the wall definitions moved onto Wall Migration's (call wall
 * ABOVE spot, put wall BELOW, Core either side) and Hold started steadying the
 * walls themselves. A v1 save is carried over except for those two fields,
 * which take the new defaults — v1's |GEX| + 3m was the setting that jittered.
 */
/**
 * v3 (2026-10-08): Core became the default Wall. A v2 save keeps everything
 * (Hold included) except `mode`, which re-opens on Core once; after that the
 * choice is remembered again.
 */
const STORE_VERSION = 3

function loadSettings(): AlignSettings {
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const p = JSON.parse(raw) as Partial<AlignSettings> & { v?: number }
    const current = p.v === STORE_VERSION || p.v === 2
    const modeKept = p.v === STORE_VERSION && (p.mode === 'abs' || p.mode === 'pos' || p.mode === 'neg')
    return {
      mode: modeKept ? (p.mode as AlignMode) : DEFAULT_SETTINGS.mode,
      tol: p.tol === 1 ? 1 : 0,
      minDist: typeof p.minDist === 'number' ? p.minDist : DEFAULT_SETTINGS.minDist,
      minDom: typeof p.minDom === 'number' ? p.minDom : DEFAULT_SETTINGS.minDom,
      holdMin: current && typeof p.holdMin === 'number' ? p.holdMin : DEFAULT_SETTINGS.holdMin,
      zeroTrigger: p.zeroTrigger !== false,
      requireAll: p.requireAll === true,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function saveSettings(s: AlignSettings): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify({ ...s, v: STORE_VERSION }))
  } catch {
    /* private window / blocked storage — the tab still works, it just forgets */
  }
}

export function useAlignSettings(): [AlignSettings, (patch: Partial<AlignSettings>) => void] {
  const [s, setS] = useState<AlignSettings>(loadSettings)
  const update = useCallback((patch: Partial<AlignSettings>) => {
    setS((prev) => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
  }, [])
  return [s, update]
}

// ── Filters ──────────────────────────────────────────────────────────────────

type Filter = 'active' | AlignState | 'all'
type View = 'board' | 'stacks'

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'active', label: 'Active' },
  { id: 'LOCKED', label: 'Locked' },
  { id: 'PENDING', label: '0DTE pending' },
  { id: 'FORMING', label: 'Forming' },
  { id: 'all', label: 'All' },
]

function matches(r: AlignRow, f: Filter): boolean {
  if (f === 'all') return true
  if (f === 'active') return r.verdict.state !== 'SCATTERED'
  return r.verdict.state === f
}

type DistOpt = '0' | '1' | '2' | '3' | '4' | '5'
const DIST_OPTIONS: Array<{ value: DistOpt; label: string; title?: string }> = [
  { value: '0', label: 'Any', title: 'Include walls at the money' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
  { value: '5', label: '5', title: 'Shared wall at least 5 strikes from spot' },
]

const MAX_STACKS = 24
const MAX_TAPE = 40

const TH = 'whitespace-nowrap border-b border-line px-2 py-1.5 text-xs font-bold uppercase tracking-wide'
const TD = 'border-b border-line/50 px-2 py-1.5 tabular'

// ── The tab ──────────────────────────────────────────────────────────────────

export default function AlignTab({ universe = 'all' }: { universe?: AlignUniverse } = {}) {
  const [params, setParams] = useSearchParams()
  const sym = params.get('sym')
  const symDate = params.get('d')
  const [settings, update] = useAlignSettings()

  const open = useCallback(
    (symbol: string, date: string | undefined) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('sym', symbol)
        if (date) next.set('d', date)
        else next.delete('d')
        return next
      })
    },
    [setParams],
  )
  // Back keeps the session date, so a replay opened from a past day returns to that day's board.
  const back = useCallback(() => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('sym')
      return next
    })
  }, [setParams])
  // The board's session lives in the URL (?d=), so a past day is a link you can paste.
  const pickDate = useCallback(
    (d: string | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (d) next.set('d', d)
          else next.delete('d')
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  if (sym) return <AlignReplay symbol={sym} date={symDate} settings={settings} onBack={back} />
  return (
    <AlignBoard
      settings={settings}
      update={update}
      onOpen={open}
      universe={universe}
      day={pastDate(symDate)}
      onPickDay={pickDate}
    />
  )
}

function AlignBoard({
  settings,
  update,
  onOpen,
  universe,
  day,
  onPickDay,
}: {
  settings: AlignSettings
  update: (p: Partial<AlignSettings>) => void
  onOpen: (symbol: string, date: string | undefined) => void
  universe: AlignUniverse
  /** A past session, or null for today (live). */
  day: string | null
  onPickDay: (d: string | null) => void
}) {
  const main = universe === 'main'
  const { data: fresh, error, loading } = useQuery<AlignResponse>(alignUrl(settings.mode, day), {
    // A saved day never changes — no poll.
    pollMs: day ? undefined : ALIGN_POLL_MS,
    staleMs: 30_000,
  })
  // A failed or still-warming poll must not blank the board: keep painting the
  // last good answer for this mode and say how old it is.
  const lastGood = useRef<{ key: string; data: AlignResponse } | null>(null)
  const goodKey = `${settings.mode}|${day ?? ''}`
  const freshOk = !!fresh && fresh.ok !== false && !fresh.warming
  if (freshOk) lastGood.current = { key: goodKey, data: fresh }
  const held = lastGood.current?.key === goodKey ? lastGood.current.data : undefined
  const { data: datesResp } = useQuery<{ dates?: string[] }>(ALIGN_DATES_URL, { staleMs: 5 * 60_000 })
  const data = freshOk ? fresh : (held ?? fresh)
  const showingOld = !freshOk && !!held
  const warming = !!fresh?.warming && !held
  // Main is fourteen names: show them all by default rather than only the active ones.
  const [filter, setFilter] = useState<Filter>(main ? 'all' : 'active')
  const [view, setView] = useState<View>('board')

  // A ticking "held for" without a re-fetch: one render a minute.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const date = data?.date
  const now = data?.stale
    ? Math.max(0, ...(data?.symbols ?? []).map((s) => s.t))
    : Math.max(Date.now(), data?.asOf ?? 0)

  const symbols = useMemo(() => {
    const all = data?.symbols ?? []
    if (!main) return all
    // The server flags MAIN from the live roster. An older server sends no flag
    // at all — fall back to the static list rather than an empty tab.
    const flagged = all.some((s) => s.hot !== undefined)
    const mine = flagged ? all.filter((s) => s.hot) : all.filter((s) => MAIN_SET.has(s.symbol))
    // Every MAIN name gets a row, data or not — a ticker with nothing recorded
    // yet (or a failed load) shows as an empty row rather than disappearing.
    const have = new Set(mine.map((s) => s.symbol))
    const want = flagged && mine.length ? [] : SCANNER_MAIN
    const stubs: AlignSymbolRaw[] = want
      .filter((sym) => !have.has(sym))
      .map((sym) => ({ symbol: sym, hot: true, t: 0, spot: 0, step: 0, expiries: [], walls: [], all: null }))
    return [...mine, ...stubs]
  }, [data, main])

  const allRows = useMemo(
    () => sortRows(symbols.map((s) => buildRow(s, settings, date, now))),
    // `now` moves every render; the minute tick above is what refreshes "held".
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symbols, settings, date, Math.floor(now / 60_000)],
  )
  // On Main nothing is hidden: a ticker that fails distance / dominance stays on
  // the board, dimmed, because with fourteen names a missing row reads as a bug.
  const qualified = useMemo(() => (main ? allRows : allRows.filter((r) => r.passes)), [allRows, main])
  const hidden = main ? allRows.filter((r) => !r.passes).length : allRows.length - qualified.length
  const matched = useMemo(() => qualified.filter((r) => matches(r, filter)), [qualified, filter])
  // Nothing in this filter → still show the tickers (all of them, the ones that
  // fail distance / dominance dimmed) under a line saying so, never a blank card.
  const fallback = matched.length === 0 && allRows.length > 0
  const rows = fallback ? (qualified.length ? qualified : allRows) : matched

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { active: 0, LOCKED: 0, PENDING: 0, FORMING: 0, SCATTERED: 0, all: qualified.length }
    for (const r of qualified) {
      c[r.verdict.state]++
      if (r.verdict.state !== 'SCATTERED') c.active++
    }
    return c
  }, [qualified])

  const nCols = Math.min(6, Math.max(0, ...qualified.map((r) => r.walls.length)))
  const zeroDteFront = qualified.some((r) => r.frontIsZeroDte)

  const tape = useMemo(() => {
    const ev: AlignEvent[] = []
    for (const r of qualified) ev.push(...r.events)
    return ev.sort((a, b) => b.t - a.t).slice(0, MAX_TAPE)
  }, [qualified])

  const subtitle = [
    date ? `session ${date}${data?.stale ? ' (last recorded)' : ''}` : null,
    `${allRows.length} tickers`,
    hidden > 0 ? `${hidden} ${main ? 'dimmed' : 'hidden'} by your filters` : null,
    loading ? 'loading…' : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Card title={main ? 'Wall Alignment · Main' : 'Wall Alignment'}>
      <div className="mb-3 text-xs text-muted" style={{ color: DIM }}>
        The biggest GEX strike in each of the nearest expirations, per ticker. When the later expirations agree on one
        strike, the ticker is PENDING; when 0DTE joins them it is LOCKED. {subtitle}
      </div>

      <Toolbar
        settings={settings}
        update={update}
        view={view}
        setView={setView}
        day={day}
        onPickDay={onPickDay}
        dates={datesResp?.dates ?? []}
      />

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => {
          const on = filter === f.id
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={on}
              className={[
                'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                on ? 'border-line bg-raised text-fg' : 'border-line text-muted hover:bg-raised',
              ].join(' ')}
              style={on && f.id !== 'active' && f.id !== 'all' ? { borderColor: STATE_COLOR[f.id] } : undefined}
            >
              {f.label} <span className="tabular opacity-70">{counts[f.id]}</span>
            </button>
          )
        })}
        <span className="ml-auto text-xs" style={{ color: DIM }}>
          click a ticker for its replay
        </span>
      </div>

      {(error || fresh?.ok === false) && (
        <div className="mb-3 text-xs" style={{ color: V2.red }}>
          {error ? readableError(error, 'Could not load wall alignment.') : (fresh?.error ?? 'Could not load wall alignment.')}
          {showingOld && data?.asOf ? ` — showing the board from ${fmtEt(data.asOf)}` : ''}
        </div>
      )}
      {warming && (
        <div className="mb-3 text-xs" style={{ color: STATE_COLOR.PENDING }}>
          Building today&rsquo;s wall history on the server — the first load after a restart takes up to a minute. This
          refreshes on its own.
        </div>
      )}
      {fallback && !warming && (
        <div className="mb-3 text-xs" style={{ color: DIM }}>
          No tickers are {FILTERS.find((f) => f.id === filter)?.label.toLowerCase() ?? filter} right now — showing all{' '}
          {rows.length}.
        </div>
      )}

      {view === 'board' ? (
        <BoardTable rows={rows} nCols={nCols} zeroDteFront={zeroDteFront} settings={settings} now={now} date={date} onOpen={onOpen} />
      ) : (
        <Stacks rows={rows} nCols={nCols} zeroDteFront={zeroDteFront} now={now} date={date} onOpen={onOpen} />
      )}

      <Tape events={tape} date={date} onOpen={onOpen} />
    </Card>
  )
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide" style={{ color: LABEL }}>
        {label}
      </span>
      {children}
    </div>
  )
}

function Toolbar({
  settings,
  update,
  view,
  setView,
  day,
  onPickDay,
  dates,
}: {
  settings: AlignSettings
  update: (p: Partial<AlignSettings>) => void
  view: View
  setView: (v: View) => void
  day: string | null
  onPickDay: (d: string | null) => void
  dates: string[]
}) {
  const today = etToday()
  const options = [
    { value: 'live', label: 'Today (live)' },
    ...dates.filter((d) => d < today).map((d) => ({ value: d, label: fmtExpiry(d) + ` '${d.slice(2, 4)}` })),
  ]
  if (day && !options.some((o) => o.value === day)) options.push({ value: day, label: day })
  return (
    <div className="mb-3 flex flex-wrap items-end gap-3">
      <Field label="Session">
        <Select<string>
          ariaLabel="Session"
          value={day ?? 'live'}
          options={options}
          onChange={(v) => onPickDay(v === 'live' ? null : v)}
          menuWidth="w-44"
        />
      </Field>
      <Field label="View">
        <SegGroup<View>
          options={[
            { value: 'board', label: 'Board' },
            { value: 'stacks', label: 'Stacks' },
          ]}
          value={view}
          onChange={setView}
        />
      </Field>
      <Field label="Wall">
        <SegGroup<AlignMode>
          options={[
            {
              value: 'abs',
              label: 'Core',
              title:
                'Biggest |GEX| strike on either side (the CB). Jumps between the call and put side when the two are close in size',
            },
            {
              value: 'pos',
              label: 'Call wall',
              title: 'Biggest + GEX strike ABOVE spot — the same call wall Wall Migration draws',
              activeColor: V2.up,
            },
            {
              value: 'neg',
              label: 'Put wall',
              title: 'Most − GEX strike BELOW spot — the same put wall Wall Migration draws',
              activeColor: V2.red,
            },
          ]}
          value={settings.mode}
          onChange={(mode) => update({ mode })}
        />
      </Field>
      <Field label="Tolerance">
        <SegGroup<'0' | '1'>
          options={[
            { value: '0', label: 'Exact' },
            { value: '1', label: '±1 strike' },
          ]}
          value={settings.tol === 1 ? '1' : '0'}
          onChange={(v) => update({ tol: v === '1' ? 1 : 0 })}
        />
      </Field>
      <Field label="Min distance">
        <SegGroup<DistOpt>
          options={DIST_OPTIONS}
          value={String(Math.max(0, Math.min(5, Math.round(settings.minDist)))) as DistOpt}
          onChange={(v) => update({ minDist: Number(v) })}
        />
      </Field>
      <Field label="Dominance">
        <SegGroup<'1' | '1.3' | '2'>
          options={[
            { value: '1', label: 'Any' },
            { value: '1.3', label: '1.3×', title: 'Each aligned wall ≥ 1.3× the next-biggest strike in its expiry' },
            { value: '2', label: '2×', title: 'Each aligned wall ≥ 2× the next-biggest strike in its expiry' },
          ]}
          value={settings.minDom >= 2 ? '2' : settings.minDom > 1 ? '1.3' : '1'}
          onChange={(v) => update({ minDom: Number(v) })}
        />
      </Field>
      <Field label="Hold">
        <SegGroup<'1' | '5' | '15'>
          title="A wall move counts only once the new strike has held this long. Wall Migration samples every 15m."
          options={[
            { value: '1', label: '1m', title: 'Every 1-minute sweep — the raw, jumpy read' },
            { value: '5', label: '5m' },
            { value: '15', label: '15m', title: 'Reads like Wall Migration' },
          ]}
          value={settings.holdMin >= 15 ? '15' : settings.holdMin >= 5 ? '5' : '1'}
          onChange={(v) => update({ holdMin: Number(v) })}
        />
      </Field>
      <Field label="0DTE">
        <SegGroup<'trigger' | 'vote'>
          options={[
            { value: 'trigger', label: 'Trigger', title: '0DTE joining the later expiries is the lock' },
            { value: 'vote', label: 'Votes', title: '0DTE counts like every other expiry' },
          ]}
          value={settings.zeroTrigger ? 'trigger' : 'vote'}
          onChange={(v) => update({ zeroTrigger: v === 'trigger' })}
        />
      </Field>
      <Field label="ALL ex-0D">
        <SegGroup<'show' | 'require'>
          options={[
            { value: 'show', label: 'Show', title: 'Show the all-expirations (minus 0DTE) wall beside the per-expiry walls' },
            {
              value: 'require',
              label: 'Require',
              title: 'Only tickers whose all-expirations (minus 0DTE) wall is ALSO on the shared wall',
            },
          ]}
          value={settings.requireAll ? 'require' : 'show'}
          onChange={(v) => update({ requireAll: v === 'require' })}
        />
      </Field>
    </div>
  )
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function StateBadge({ state }: { state: AlignState }) {
  return (
    <span
      className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-bold tracking-wide"
      style={pillStyle(STATE_COLOR[state])}
    >
      {STATE_LABEL[state]}
    </span>
  )
}

function distText(r: AlignRow): string {
  if (r.distStrikes == null && r.distPct == null) return EM_DASH
  const s = r.distStrikes == null ? '' : `${r.distStrikes > 0 ? '+' : ''}${r.distStrikes} str`
  const p = r.distPct == null ? '' : `${r.distPct >= 0 ? '+' : ''}${(r.distPct * 100).toFixed(1)}%`
  return [s, p].filter(Boolean).join(' · ')
}

function distColor(r: AlignRow): string {
  if (r.distPct == null) return DIM
  return r.distPct >= 0 ? V2.green : V2.red
}

/** The column headers' expiry: the one most rows have in that slot. */
function slotLabel(rows: AlignRow[], i: number): string {
  const seen = new Map<string, number>()
  for (const r of rows) {
    const e = r.sym.expiries[i]
    if (e) seen.set(e, (seen.get(e) ?? 0) + 1)
  }
  let best = ''
  let n = 0
  for (const [e, c] of seen) if (c > n) [best, n] = [e, c]
  return best ? fmtExpiry(best) : ''
}

function cellStyle(r: AlignRow, i: number): CSSProperties {
  const on = r.verdict.on[i]
  const st = r.verdict.state
  if (on && st === 'LOCKED') return { background: alpha(V2.up, 0.16), border: `1px solid ${V2.up}`, color: T.text }
  if (on) return { background: alpha(V2.cyan, 0.22), border: `1px solid ${V2.cyan}`, color: T.text }
  if (i === 0 && st === 'PENDING') return { border: `1px dashed ${STATE_COLOR.PENDING}`, color: STATE_COLOR.PENDING }
  return { border: `1px solid ${V2W.border}`, color: DIM }
}

// ── Board ────────────────────────────────────────────────────────────────────

function BoardTable({
  rows,
  nCols,
  zeroDteFront,
  settings,
  now,
  date,
  onOpen,
}: {
  rows: AlignRow[]
  nCols: number
  zeroDteFront: boolean
  settings: AlignSettings
  now: number
  date: string | undefined
  onOpen: (s: string, d: string | undefined) => void
}) {
  const cols = Array.from({ length: nCols }, (_, i) => i)
  return (
    <div className="mb-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr style={{ color: LABEL }}>
            <th className={`${TH} text-left`}>Ticker</th>
            <th className={`${TH} text-right`}>Spot</th>
            <th className={`${TH} text-center`}>Wall</th>
            <th className={`${TH} text-left`}>Dist</th>
            {cols.map((i) => (
              <th key={i} className={`${TH} text-center`} style={i === 0 ? { color: STATE_COLOR.PENDING } : undefined}>
                {i === 0 ? (zeroDteFront ? '0DTE' : 'Front') : `+${i}`}
                <div className="text-2xs font-normal normal-case" style={{ color: DIM }}>
                  {slotLabel(rows, i)}
                </div>
              </th>
            ))}
            <th className={`${TH} text-center`} title="The wall across every listed expiration except 0DTE, from the full chain">
              ALL ex-0D
              <div className="text-2xs font-normal normal-case" style={{ color: DIM }}>
                every expiry but 0DTE
              </div>
            </th>
            <th className={`${TH} text-center`}>Align</th>
            <th className={`${TH} text-left`}>State</th>
            <th className={`${TH} text-right`}>Held</th>
            <th className={`${TH} text-right`} title="Σ net GEX of the expiries on the wall">
              Wall $GEX
            </th>
            <th className={`${TH} text-right`} title="Smallest wall ÷ runner-up among the aligned expiries">
              Dom
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={10 + nCols} className="px-2 py-6 text-center text-xs" style={{ color: DIM }}>
                No tickers loaded yet.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr
              key={r.symbol}
              onClick={() => onOpen(r.symbol, date)}
              className="cursor-pointer transition-colors hover:bg-raised"
              style={{
                ...(r.verdict.state === 'PENDING' ? { background: alpha(STATE_COLOR.PENDING, 0.035) } : null),
                ...(r.passes ? null : { opacity: 0.45 }),
              }}
            >
              <td className={`${TD} text-left`}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpen(r.symbol, date)
                  }}
                  className="font-bold text-fg hover:underline"
                >
                  {r.symbol}
                </button>
              </td>
              <td className={`${TD} text-right`}>{r.spot > 0 ? r.spot.toFixed(2) : EM_DASH}</td>
              <td className={`${TD} text-center font-bold text-fg`}>
                {r.verdict.k != null ? fmtStrike(r.verdict.k) : EM_DASH}
              </td>
              <td className={`${TD} text-left whitespace-nowrap`} style={{ color: distColor(r) }}>
                {distText(r)}
              </td>
              {cols.map((i) => {
                const w = r.walls[i]
                const exp = r.sym.expiries[i]
                const pendingFront = i === 0 && r.verdict.state === 'PENDING' && !r.verdict.on[0]
                return (
                  <td key={i} className="border-b border-line/50 px-1 py-1 text-center tabular">
                    {w === undefined ? null : (
                      <span
                        className="inline-block min-w-16 rounded-sm px-1.5 py-1 font-semibold"
                        style={cellStyle(r, i)}
                        title={exp ? `${exp} · wall ${w == null ? 'none' : fmtStrike(w)}` : undefined}
                      >
                        {w == null ? EM_DASH : `${fmtStrike(w)}${pendingFront ? ' →' : ''}`}
                      </span>
                    )}
                  </td>
                )
              })}
              <td className="border-b border-line/50 px-1 py-1 text-center tabular">
                <AllCell row={r} />
              </td>
              <td className={`${TD} text-center`}>
                <Pips row={r} />
              </td>
              <td className={`${TD} text-left`}>
                <StateBadge state={r.verdict.state} />
              </td>
              <td className={`${TD} text-right`}>
                {r.verdict.state === 'SCATTERED' ? EM_DASH : fmtHeld(now - r.since)}
              </td>
              <td className={`${TD} text-right`} style={{ color: r.wallGex >= 0 ? V2.up : V2.red }}>
                {r.verdict.k != null ? fmtB(r.wallGex) : EM_DASH}
              </td>
              <td className={`${TD} text-right`}>{r.dom != null ? `${r.dom.toFixed(1)}×` : EM_DASH}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Legend tol={settings.tol} />
    </div>
  )
}

function allTitle(r: AlignRow): string {
  const a = r.all
  if (!a) return 'No all-expirations reading for this ticker today'
  if (a.state === 'queued') return 'Waiting on the first all-expirations reading'
  if (a.state === 'error') return `All-expirations reading failed: ${a.err ?? 'unknown error'}`
  const parts = [`next ${a.n ?? '?'} expirations, 0DTE excluded`]
  if (a.net != null) parts.push(`net ${fmtB(a.net)}`)
  if (a.next && a.net != null) parts.push(`${(Math.abs(a.net) / a.next).toFixed(1)}× next`)
  if (a.at) parts.push(`as of ${fmtEt(a.at)}`)
  return parts.join(' · ')
}

function allStyle(r: AlignRow): CSSProperties {
  if (r.allOn && r.verdict.state === 'LOCKED') return { background: alpha(V2.up, 0.16), border: `1px solid ${V2.up}`, color: T.text }
  if (r.allOn) return { background: alpha(V2.cyan, 0.22), border: `1px solid ${V2.cyan}`, color: T.text }
  if (r.all?.state === 'ok') return { border: `1px solid ${V2W.border}`, color: T.text }
  return { border: `1px dashed ${V2W.border}`, color: DIM }
}

function allText(r: AlignRow): string {
  const a = r.all
  if (!a) return EM_DASH
  if (a.state === 'queued') return '…'
  if (a.state === 'error') return '×'
  return a.strike != null ? fmtStrike(a.strike) : EM_DASH
}

function AllCell({ row }: { row: AlignRow }) {
  return (
    <span className="inline-block min-w-16 rounded-sm px-1.5 py-1 font-semibold" style={allStyle(row)} title={allTitle(row)}>
      {allText(row)}
      {row.allOn ? ' ✓' : ''}
    </span>
  )
}

function Pips({ row }: { row: AlignRow }) {
  return (
    <span className="inline-flex gap-0.5 align-middle" aria-label={`${row.verdict.total} of ${row.walls.length} on the wall`}>
      {row.walls.map((_, i) => {
        const on = row.verdict.on[i]
        const c = on
          ? row.verdict.state === 'LOCKED'
            ? V2.up
            : V2.cyan
          : i === 0
            ? alpha(STATE_COLOR.PENDING, 0.35)
            : V2W.border
        return <span key={i} className="inline-block h-4 w-2 rounded-sm" style={{ background: c }} />
      })}
    </span>
  )
}

function Legend({ tol }: { tol: 0 | 1 }) {
  const sw = 'inline-block h-3.5 w-6 rounded-sm'
  return (
    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs" style={{ color: DIM }}>
      <span className="flex items-center gap-1.5">
        <span className={sw} style={{ background: alpha(V2.cyan, 0.22), border: `1px solid ${V2.cyan}` }} />
        on the wall{tol === 1 ? ' (±1 strike)' : ''}
      </span>
      <span className="flex items-center gap-1.5">
        <span className={sw} style={{ border: `1px dashed ${STATE_COLOR.PENDING}` }} />
        0DTE elsewhere — its move is the trigger
      </span>
      <span className="flex items-center gap-1.5">
        <span className={sw} style={{ border: `1px solid ${V2W.border}` }} />
        off the wall
      </span>
      <span>
        ALL ex-0D = the same wall across the next expirations minus 0DTE — Wall Migration’s “All expirations
        minus 0DTE” scope, updated every ~5 min
      </span>
      <span>Dist = strikes and % from spot · Dom = wall ÷ next-biggest strike in that expiry</span>
    </div>
  )
}

// ── Stacks ───────────────────────────────────────────────────────────────────

const LADDER_MAX_SPAN = 10

function ladder(r: AlignRow): number[] {
  const set = new Set<number>()
  for (const w of r.walls) if (w != null) set.add(w)
  if (r.verdict.k != null) set.add(r.verdict.k)
  if (r.all?.state === 'ok' && r.all.strike != null) set.add(r.all.strike)
  const atm = r.step > 0 && r.spot > 0 ? Math.round(r.spot / r.step) * r.step : null
  if (atm != null) set.add(Math.round(atm * 100) / 100)
  const vals = [...set].sort((a, b) => b - a)
  const hi = vals[0]
  const lo = vals[vals.length - 1]
  if (hi == null || lo == null) return []
  if (r.step > 0 && (hi - lo) / r.step <= LADDER_MAX_SPAN) {
    const out: number[] = []
    for (let s = hi + r.step; s >= lo - r.step - 1e-9; s -= r.step) out.push(Math.round(s * 100) / 100)
    return out
  }
  return vals
}

function Stacks({
  rows,
  nCols,
  zeroDteFront,
  now,
  date,
  onOpen,
}: {
  rows: AlignRow[]
  nCols: number
  zeroDteFront: boolean
  now: number
  date: string | undefined
  onOpen: (s: string, d: string | undefined) => void
}) {
  const shown = rows.slice(0, MAX_STACKS)
  if (shown.length === 0)
    return (
      <div className="mb-4 py-6 text-center text-xs" style={{ color: DIM }}>
        No tickers loaded yet.
      </div>
    )
  return (
    <div className="mb-4">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {shown.map((r) => (
          <StackCard key={r.symbol} row={r} nCols={nCols} zeroDteFront={zeroDteFront} now={now} onOpen={() => onOpen(r.symbol, date)} />
        ))}
      </div>
      {rows.length > shown.length && (
        <div className="mt-2 text-xs" style={{ color: DIM }}>
          {rows.length - shown.length} more — narrow the filter or use the Board view.
        </div>
      )}
    </div>
  )
}

function StackCard({
  row: r,
  nCols,
  zeroDteFront,
  now,
  onOpen,
}: {
  row: AlignRow
  nCols: number
  zeroDteFront: boolean
  now: number
  onOpen: () => void
}) {
  const strikes = ladder(r)
  const st = r.verdict.state
  const locked = st === 'LOCKED'
  const kColor = locked ? V2.up : V2.cyan
  const atm = r.step > 0 && r.spot > 0 ? Math.round((Math.round(r.spot / r.step) * r.step) * 100) / 100 : null
  // One column per recorded expiry, then ALL ex-0DTE.
  const grid = { display: 'grid', gridTemplateColumns: `56px repeat(${Math.max(1, nCols) + 1}, minmax(0, 1fr))` }
  const allStrike = r.all?.state === 'ok' ? (r.all.strike ?? null) : null
  const edge = locked ? alpha(V2.up, 0.45) : st === 'PENDING' ? alpha(STATE_COLOR.PENDING, 0.4) : V2W.border

  let note = ''
  if (st === 'PENDING') {
    const f = r.walls[0]
    note = `${r.frontIsZeroDte ? '0DTE' : 'Front'} wall at ${f != null ? fmtStrike(f) : EM_DASH} — waiting on it to join ${r.verdict.k != null ? fmtStrike(r.verdict.k) : ''}`
  } else if (locked) note = `${r.verdict.total} of ${r.walls.length} on ${r.verdict.k != null ? fmtStrike(r.verdict.k) : ''}`
  else if (st === 'FORMING') note = `${r.verdict.total} of ${r.walls.length} walls agree`
  if (note && r.all?.state === 'ok' && r.verdict.k != null)
    note += r.allOn ? ' · ALL ex-0D agrees' : ` · ALL ex-0D at ${allStrike != null ? fmtStrike(allStrike) : EM_DASH}`

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col gap-2.5 rounded-md p-3 text-left transition-colors hover:bg-raised"
      style={{ border: `1px solid ${edge}`, background: V2W.wash03, opacity: r.passes ? 1 : 0.45 }}
    >
      <div className="flex w-full items-center gap-2">
        <span className="text-base font-bold text-fg">{r.symbol}</span>
        <span className="tabular text-xs" style={{ color: DIM }}>
          {r.spot > 0 ? r.spot.toFixed(2) : ''}
        </span>
        <span className="ml-auto">
          <StateBadge state={st} />
        </span>
      </div>

      <div className="w-full">
        <div className="tabular text-2xs" style={{ ...grid, color: DIM }}>
          <span />
          {Array.from({ length: nCols }, (_, i) => (
            <span key={i} className="text-center font-bold" style={i === 0 ? { color: STATE_COLOR.PENDING } : undefined}>
              {i === 0 ? (zeroDteFront ? '0D' : 'F') : `+${i}`}
            </span>
          ))}
          <span className="text-center font-bold" style={{ color: LABEL }} title={allTitle(r)}>
            ALL
          </span>
        </div>
        <div className="flex flex-col gap-px">
          {strikes.map((s) => {
            const isK = r.verdict.k != null && Math.abs(s - r.verdict.k) < 1e-9
            const isAtm = atm != null && Math.abs(s - atm) < 1e-9
            return (
              <div
                key={s}
                className="items-center rounded-sm"
                style={{
                  ...grid,
                  height: 22,
                  background: isK ? alpha(kColor, 0.12) : undefined,
                  border: `1px solid ${isK ? alpha(kColor, 0.45) : 'transparent'}`,
                }}
              >
                <span
                  className="tabular pl-1.5 text-2xs"
                  style={{ color: isK ? T.text : isAtm ? V2.green : DIM, fontWeight: isK || isAtm ? 700 : 400 }}
                >
                  {isAtm ? `ATM ${fmtStrike(s)}` : fmtStrike(s)}
                </span>
                {Array.from({ length: nCols }, (_, i) => {
                  const w = r.walls[i]
                  const dot = w != null && Math.abs(w - s) < 1e-9
                  const onK = r.verdict.on[i]
                  const c = !dot ? null : onK ? kColor : i === 0 ? STATE_COLOR.PENDING : null
                  return (
                    <span key={i} className="flex items-center justify-center">
                      {dot &&
                        (c ? (
                          <span
                            className="inline-block h-3 w-3 rounded-full"
                            style={{ background: c, boxShadow: `0 0 0 3px ${alpha(c, 0.25)}` }}
                          />
                        ) : (
                          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ border: `2px solid ${DIM}` }} />
                        ))}
                    </span>
                  )
                })}
                <span className="flex items-center justify-center">
                  {allStrike != null && Math.abs(allStrike - s) < 1e-9 && (
                    <span
                      className="inline-block h-3 w-3 rotate-45 rounded-sm"
                      style={
                        r.allOn
                          ? { background: kColor, boxShadow: `0 0 0 3px ${alpha(kColor, 0.25)}` }
                          : { border: `2px solid ${T.text}` }
                      }
                    />
                  )}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid w-full grid-cols-3 gap-2 border-t border-line pt-2 tabular">
        <Mini label="Wall" value={r.verdict.k != null ? fmtStrike(r.verdict.k) : EM_DASH} />
        <Mini label="Dist" value={r.distStrikes != null ? `${r.distStrikes > 0 ? '+' : ''}${r.distStrikes} str` : EM_DASH} />
        <Mini label="Held" value={st === 'SCATTERED' ? EM_DASH : fmtHeld(now - r.since)} />
      </div>
      {note && (
        <div className="text-xs" style={{ color: STATE_COLOR[st] }}>
          {note}
        </div>
      )}
    </button>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-2xs uppercase tracking-wide" style={{ color: LABEL }}>
        {label}
      </span>
      <span className="text-sm font-bold text-fg">{value}</span>
    </div>
  )
}

// ── Tape ─────────────────────────────────────────────────────────────────────

function Tape({
  events,
  date,
  onOpen,
}: {
  events: AlignEvent[]
  date: string | undefined
  onOpen: (s: string, d: string | undefined) => void
}) {
  return (
    <div className="rounded-md border border-line p-3" style={{ background: V2W.wash03 }}>
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-bold uppercase tracking-wide" style={{ color: LABEL }}>
          Alignment tape
        </span>
        <span className="text-xs" style={{ color: DIM }}>
          every state change today, newest first
        </span>
      </div>
      {events.length === 0 && (
        <div className="py-3 text-xs" style={{ color: DIM }}>
          No alignment changes yet this session.
        </div>
      )}
      <div className="flex flex-col">
        {events.map((e, i) => (
          <button
            key={`${e.symbol}-${e.t}-${i}`}
            type="button"
            onClick={() => onOpen(e.symbol, date)}
            className="grid items-center gap-3 border-t border-line/50 py-1.5 text-left text-xs transition-colors hover:bg-raised"
            style={{ gridTemplateColumns: '52px 64px 76px minmax(0, 1fr)' }}
          >
            <span className="tabular" style={{ color: DIM }}>
              {fmtEt(e.t)}
            </span>
            <span className="font-bold text-fg">{e.symbol}</span>
            <span
              className="justify-self-start rounded-full px-2 py-0.5 text-2xs font-bold tracking-wide"
              style={pillStyle(EVENT_COLOR[e.kind])}
            >
              {e.kind}
            </span>
            <span className="truncate text-fg">{e.text}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

