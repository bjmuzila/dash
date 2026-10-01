// ─────────────────────────────────────────────────────────────────────────────
// LEVEL LOG › BACKTEST — do prices bounce off the recorded CORE?
//
// The second tab of /v3/level-log (?tab=backtest). Same symbol as the rest of
// the page — the app toolbar's, with SPX / SPY / QQQ one click away — and the
// same recorder: one /api/walls-range read of up to 260 sessions, then every
// touch of the CORE found, resolved and rolled up in the browser. The rules
// live in levelLog/bounceEngine.ts and are stated on the page, because a hit
// rate whose definition you cannot see is not a number you can use.
//
// Every control re-runs the backtest locally except the four that change WHAT
// is read (symbol, end date, sessions, variant), which re-fetch. Settings are
// remembered per browser; the end date is not, so the page opens on today.
//
// Clicking a touch's date opens that session on the Log tab, where the CORE and
// price it was scored from are drawn.
//
// Its own chunk, loaded only when the tab is opened.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react'
import { Card, CardToolbar } from '@/design/primitives/Card'
import { SegGroup } from '@/design/primitives/Controls'
import { DatePicker } from '@/design/primitives/DatePicker'
import { Stat } from '@/design/primitives/Stat'
import { type Column, Table } from '@/design/primitives/Table'
import { LEVEL_COLORS, T, alpha } from '@/design/theme'
import { usePageSymbol } from '@/data/symbol'
import {
  type Approach,
  type BtEvent,
  type BtParams,
  type BtSummary,
  type Bucket,
  type TouchMode,
  byAge,
  bySide,
  byTime,
  byTouchNo,
  fetchBacktestDays,
  filterEvents,
  hhmm,
  runBacktest,
  summarize,
  sweepTargets,
} from '@/pages/levelLog/bounceEngine'
import { type DaySlice, type ExpScope, type GexBasis, todayETStr, variantTag, wallNum, wallStrike } from '@/pages/levelLog/wallData'

// ── controls ────────────────────────────────────────────────────────────────

type SessionsKey = '21' | '63' | '126' | '260'
type HoldKey = '30' | '60' | '120' | 'close'

const SESSIONS_OPTIONS: Array<{ label: string; value: SessionsKey; title: string }> = [
  { label: '1M', value: '21', title: 'The last 21 recorded sessions' },
  { label: '3M', value: '63', title: 'The last 63 recorded sessions' },
  { label: '6M', value: '126', title: 'The last 126 recorded sessions' },
  { label: 'All', value: '260', title: 'Every recorded session, up to 260' },
]

const ZONE_OPTIONS = ['0.02', '0.03', '0.05', '0.08'] as const
const TARGET_OPTIONS = ['0.10', '0.15', '0.20', '0.25', '0.30', '0.40'] as const
const STOP_OPTIONS = ['0.10', '0.15', '0.20', '0.25', '0.30', '0.40'] as const
type ZoneKey = (typeof ZONE_OPTIONS)[number]
type TargetKey = (typeof TARGET_OPTIONS)[number]
type StopKey = (typeof STOP_OPTIONS)[number]

const HOLD_OPTIONS: Array<{ label: string; value: HoldKey; title: string }> = [
  { label: '30m', value: '30', title: 'Resolve within 30 minutes or it is OPEN' },
  { label: '1h', value: '60', title: 'Resolve within an hour or it is OPEN' },
  { label: '2h', value: '120', title: 'Resolve within two hours or it is OPEN' },
  { label: 'Close', value: 'close', title: 'Wait until the session ends' },
]

const APPROACH_OPTIONS: Array<{ label: string; value: Approach; title: string }> = [
  { label: 'Both', value: 'both', title: 'Every touch, from either side' },
  { label: '▲ Support', value: 'support', title: 'Price came DOWN to the CORE — does it hold as support?' },
  { label: '▼ Resistance', value: 'resistance', title: 'Price came UP to the CORE — does it hold as resistance?' },
]

const TOUCH_OPTIONS: Array<{ label: string; value: TouchMode; title: string }> = [
  { label: 'Every', value: 'every', title: 'Every touch, re-armed after price leaves the zone by 2× its width' },
  { label: '1st only', value: 'first', title: 'Only the first touch of each CORE strike in a session' },
]

const SCOPE_OPTIONS: Array<{ label: string; value: ExpScope; title: string }> = [
  { label: '0DTE', value: '0dte', title: 'CORE from the nearest listed contract only' },
  { label: 'Non-0DTE', value: 'agg', title: 'CORE from every other listed expiration, summed per strike' },
]

const BASIS_OPTIONS: Array<{ label: string; value: GexBasis; title: string }> = [
  { label: 'OI + Vol', value: 'oivol', title: 'netGEX + netVolGEX' },
  { label: 'Vol only', value: 'vol', title: 'netVolGEX alone' },
]

const QUICK = ['SPX', 'SPY', 'QQQ'] as const

const pctOpts = <K extends string>(keys: readonly K[], what: string) =>
  keys.map((k) => ({ label: `${Number(k).toFixed(2)}%`, value: k, title: `${what} ${Number(k).toFixed(2)}% of the CORE` }))

// ── saved settings ──────────────────────────────────────────────────────────

const SETTINGS_KEY = 'cb-v3-level-log:backtest'

interface Saved {
  sessions: SessionsKey
  scope: ExpScope
  basis: GexBasis
  zone: ZoneKey
  target: TargetKey
  stop: StopKey
  hold: HoldKey
  approach: Approach
  touches: TouchMode
}

const DEFAULTS: Saved = {
  sessions: '63',
  scope: '0dte',
  basis: 'oivol',
  zone: '0.03',
  target: '0.15',
  stop: '0.15',
  hold: '60',
  approach: 'both',
  touches: 'every',
}

/** Each field validated on its own, so one retired option cannot wipe the rest. */
function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULTS
    const j = JSON.parse(raw) as Partial<Saved>
    const pick = <V extends string>(v: unknown, ok: readonly V[], d: V): V => (ok.includes(v as V) ? (v as V) : d)
    return {
      sessions: pick(j.sessions, ['21', '63', '126', '260'], DEFAULTS.sessions),
      scope: pick(j.scope, ['0dte', 'agg'], DEFAULTS.scope),
      basis: pick(j.basis, ['oivol', 'vol'], DEFAULTS.basis),
      zone: pick(j.zone, ZONE_OPTIONS, DEFAULTS.zone),
      target: pick(j.target, TARGET_OPTIONS, DEFAULTS.target),
      stop: pick(j.stop, STOP_OPTIONS, DEFAULTS.stop),
      hold: pick(j.hold, ['30', '60', '120', 'close'], DEFAULTS.hold),
      approach: pick(j.approach, ['both', 'support', 'resistance'], DEFAULTS.approach),
      touches: pick(j.touches, ['every', 'first'], DEFAULTS.touches),
    }
  } catch {
    return DEFAULTS
  }
}

// ── formatting ──────────────────────────────────────────────────────────────

const pct0 = (v: number | null) => (v == null ? '—' : `${Math.round(v)}%`)
const signed = (v: number | null, dp = 2) => (v == null ? '—' : `${v > 0 ? '+' : ''}${wallNum(v, dp)}`)
const tone = (v: number | null) => (v == null || v === 0 ? 'text-fg' : v > 0 ? 'text-up' : 'text-down')

/** The label in front of a control group — the row is too dense to go unlabelled. */
function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-3xs font-extrabold uppercase tracking-widest text-muted">{label}</span>
      {children}
    </span>
  )
}

// ── the page ────────────────────────────────────────────────────────────────

export default function CoreBacktest({ onOpenSession }: { onOpenSession: (date: string) => void }) {
  const { symbol, setSymbol } = usePageSymbol()
  const [saved] = useState<Saved>(loadSaved)
  const [sessions, setSessions] = useState(saved.sessions)
  const [scope, setScope] = useState(saved.scope)
  const [basis, setBasis] = useState(saved.basis)
  const [zone, setZone] = useState(saved.zone)
  const [target, setTarget] = useState(saved.target)
  const [stop, setStop] = useState(saved.stop)
  const [hold, setHold] = useState(saved.hold)
  const [approach, setApproach] = useState(saved.approach)
  const [touches, setTouches] = useState(saved.touches)
  const [end, setEnd] = useState(todayETStr())
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ sessions, scope, basis, zone, target, stop, hold, approach, touches } satisfies Saved),
      )
    } catch {
      /* best-effort */
    }
  }, [sessions, scope, basis, zone, target, stop, hold, approach, touches])

  // ── the one read ────────────────────────────────────────────────────────
  const [data, setData] = useState<{ days: DaySlice[]; loading: boolean; error: string | null }>({
    days: [],
    loading: true,
    error: null,
  })
  useEffect(() => {
    const ctl = new AbortController()
    setData((d) => ({ ...d, loading: true, error: null }))
    fetchBacktestDays(symbol, end, Number(sessions), scope, basis, ctl.signal)
      .then((days) => setData({ days, loading: false, error: null }))
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return
        setData({ days: [], loading: false, error: e instanceof Error ? e.message : String(e) })
      })
    return () => ctl.abort()
  }, [symbol, end, sessions, scope, basis, nonce])

  // ── the backtest ────────────────────────────────────────────────────────
  const params = useMemo<BtParams>(
    () => ({
      zonePct: Number(zone),
      targetPct: Number(target),
      stopPct: Number(stop),
      holdMin: hold === 'close' ? null : Number(hold),
    }),
    [zone, target, stop, hold],
  )
  const days = data.days
  const all = useMemo(() => runBacktest(days, params), [days, params])
  const events = useMemo(() => filterEvents(all, approach, touches), [all, approach, touches])
  const sum = useMemo(() => summarize(events), [events])
  const sweep = useMemo(() => sweepTargets(days, params, approach, touches), [days, params, approach, touches])
  const groups = useMemo(
    () => [
      { title: 'By approach', rows: bySide(events) },
      { title: 'By time of day', rows: byTime(events) },
      { title: 'By touch number', rows: byTouchNo(events) },
      { title: 'By CORE age', rows: byAge(events) },
    ],
    [events],
  )

  /** A recent price, to say what each % means in points of THIS symbol. */
  const refPx = useMemo(() => {
    for (let i = days.length - 1; i >= 0; i--) {
      const p = days[i]?.price
      const last = p?.[p.length - 1]
      if (last) return last.px
    }
    return null
  }, [days])
  const ptsOf = (pctStr: string) => (refPx ? `≈ ${wallNum((refPx * Number(pctStr)) / 100)} pts` : '')

  const range = days.length ? `${days[0]!.date} → ${days[days.length - 1]!.date}` : ''

  return (
    // shrink-0: the page column scrolls; without it the flex column squeezes
    // every card to fit the viewport and clips the tables inside them.
    <div className="flex shrink-0 flex-col gap-3">
      <Card
        title="Core bounce backtest"
        expandId="level-log-core-backtest"
        actions={
          <button
            type="button"
            onClick={() => setNonce((n) => n + 1)}
            title="Re-read the recorder"
            className="rounded-sm px-1 text-xs text-faint transition-colors hover:bg-raised hover:text-fg"
          >
            <span aria-hidden>↻</span>
          </button>
        }
      >
        <CardToolbar>
          <span
            title="The ticker under test — set on the app toolbar, or with the quick picks beside it"
            className="tabular shrink-0 rounded-sm border border-line bg-surface2 px-1.5 py-0.5 font-mono text-2xs font-semibold uppercase tracking-wide text-fg"
          >
            {symbol}
          </span>
          <SegGroup
            options={QUICK.map((q) => ({ label: q, value: q, title: `Backtest ${q}` }))}
            value={(QUICK as readonly string[]).includes(symbol) ? (symbol as (typeof QUICK)[number]) : ('' as (typeof QUICK)[number])}
            onChange={(v) => setSymbol(v)}
            title="Quick pick"
          />
          <DatePicker size="sm" value={end} max={todayETStr()} onChange={(v) => setEnd(v || todayETStr())} title="Last session in the test, ET" label={(v) => `to ${v}`} className="shrink-0" />
          <SegGroup options={SESSIONS_OPTIONS} value={sessions} onChange={setSessions} title="How many recorded sessions" />
          <SegGroup options={SCOPE_OPTIONS} value={scope} onChange={setScope} title="Which contracts the CORE is from" />
          <SegGroup options={BASIS_OPTIONS} value={basis} onChange={setBasis} title="Which GEX the CORE is from" />
        </CardToolbar>

        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <Labeled label="Zone">
            <SegGroup options={pctOpts(ZONE_OPTIONS, 'A touch is spot within')} value={zone} onChange={setZone} title="Touch zone" />
          </Labeled>
          <Labeled label="Bounce">
            <SegGroup options={pctOpts(TARGET_OPTIONS, 'A bounce is price getting')} value={target} onChange={setTarget} title="Bounce target" />
          </Labeled>
          <Labeled label="Break">
            <SegGroup options={pctOpts(STOP_OPTIONS, 'A break is price getting through by')} value={stop} onChange={setStop} title="Break stop" />
          </Labeled>
          <Labeled label="Hold">
            <SegGroup options={HOLD_OPTIONS} value={hold} onChange={setHold} title="How long a touch has to resolve" />
          </Labeled>
          <Labeled label="Approach">
            <SegGroup options={APPROACH_OPTIONS} value={approach} onChange={setApproach} title="Which side price came from" />
          </Labeled>
          <Labeled label="Touches">
            <SegGroup options={TOUCH_OPTIONS} value={touches} onChange={setTouches} title="Every touch, or the first per CORE strike" />
          </Labeled>
        </div>

        <p className="mb-3 text-2xs leading-relaxed text-muted">
          A <b className="text-fg">touch</b> is 5-minute spot within {Number(zone).toFixed(2)}% of the CORE ({ptsOf(zone)}) or stepping
          straight through it, after coming from one side. <b className="text-up">Bounce</b> = {Number(target).toFixed(2)}% back
          the way it came ({ptsOf(target)}); <b className="text-down">break</b> = {Number(stop).toFixed(2)}% through ({ptsOf(stop)});
          neither within {hold === 'close' ? 'the session' : HOLD_OPTIONS.find((h) => h.value === hold)?.label} = open. The CORE is
          the {variantTag(scope, basis)} level as recorded at the time — no look-ahead. 5-minute samples, not highs and lows: a wick
          between samples is not seen.
        </p>

        {data.error ? (
          <div className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-sm text-warn">
            Could not read the recorder — {data.error}.
          </div>
        ) : data.loading && !days.length ? (
          <div className="py-8 text-center text-sm text-muted">Reading {sessions} sessions of {symbol}…</div>
        ) : !days.length ? (
          <div className="py-8 text-center text-sm text-muted">
            No recorded sessions for {symbol} on {variantTag(scope, basis)} up to {end}.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 xl:grid-cols-8">
            <Stat label="Touches" value={sum.n.toLocaleString()} sub={`${sum.sessions} of ${days.length} sessions · ${range}`} />
            <Stat label="Bounced" value={pct0(sum.bouncePct)} sub={`${sum.bounce} touches`} direction="up" />
            <Stat label="Broke" value={pct0(sum.breakPct)} sub={`${sum.brk} touches`} direction="down" />
            <Stat label="Open" value={pct0(sum.openPct)} sub={`${sum.open} unresolved`} />
            <Stat label="Bounce of resolved" value={pct0(sum.winOfResolved)} sub="share of the ones that resolved" />
            <Stat label="Avg MFE / MAE" value={`${wallNum(sum.avgMfe)} / ${wallNum(sum.avgMae)}`} sub="points from the CORE" />
            <Stat
              label="Time to bounce"
              value={sum.medBounceMin == null ? '—' : `${Math.round(sum.medBounceMin)}m`}
              sub="median"
            />
            <Stat
              label="Points per touch"
              value={signed(sum.ptsPerTouch)}
              sub={`${signed(sum.rPerTouch)} R`}
              direction={sum.ptsPerTouch == null || sum.ptsPerTouch === 0 ? undefined : sum.ptsPerTouch > 0 ? 'up' : 'down'}
            />
          </div>
        )}
      </Card>

      {days.length && !data.error ? (
        <>
          <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
            <Card title="Cumulative points" expandId="level-log-core-backtest-curve">
              <p className="mb-2 text-2xs text-muted">
                Every touch in order: +{Number(target).toFixed(2)}% on a bounce, −{Number(stop).toFixed(2)}% on a break, where it
                stood on an open one. In points of {symbol}.
              </p>
              <CumulativeCurve events={events} />
            </Card>
            <Card title="Breakdown" expandId="level-log-core-backtest-breakdown">
              <div className="flex flex-col gap-3">
                {groups.map((g) => (
                  <div key={g.title}>
                    <div className="mb-1 text-2xs font-extrabold uppercase tracking-widest text-muted">{g.title}</div>
                    <Table columns={BUCKET_COLUMNS} rows={g.rows} rowKey={(r) => r.key} empty="No touches." />
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card title="Target sweep" expandId="level-log-core-backtest-sweep">
            <p className="mb-2 text-2xs text-muted">
              The same touches resolved at each bounce target, with the break at {Number(stop).toFixed(2)}% and everything else held.
              The highlighted row is the target set above.
            </p>
            <Table
              columns={sweepColumns(refPx)}
              rows={sweep}
              rowKey={(r) => String(r.targetPct)}
              rowClassName={(r) => (Math.abs(r.targetPct - Number(target)) < 1e-9 ? 'bg-surface2' : undefined)}
              empty="No targets above the touch zone."
            />
          </Card>

          <Card title={`Every touch · ${events.length.toLocaleString()}`} expandId="level-log-core-backtest-touches">
            <div className="max-h-[560px] min-h-0 overflow-auto">
              <Table
                columns={eventColumns(onOpenSession)}
                rows={events.slice().reverse().slice(0, EVENT_CAP)}
                rowKey={(r) => r.id}
                empty="No touches with these settings."
              />
            </div>
            {events.length > EVENT_CAP ? (
              <p className="mt-1.5 text-2xs text-muted">
                Newest {EVENT_CAP} of {events.length.toLocaleString()} shown — every one is in the numbers above.
              </p>
            ) : null}
          </Card>
        </>
      ) : null}
    </div>
  )
}

/** Rows the touch table renders. The stats always use all of them. */
const EVENT_CAP = 400

// ── tables ──────────────────────────────────────────────────────────────────

const BUCKET_COLUMNS: Column<Bucket>[] = [
  { key: 'label', header: '', cell: (r) => r.label },
  { key: 'n', header: 'Touches', numeric: true, width: '70px', cell: (r) => r.summary.n.toLocaleString() },
  { key: 'b', header: 'Bounce', numeric: true, width: '64px', cell: (r) => <span className="text-up">{pct0(r.summary.bouncePct)}</span> },
  { key: 'k', header: 'Break', numeric: true, width: '64px', cell: (r) => <span className="text-down">{pct0(r.summary.breakPct)}</span> },
  { key: 'o', header: 'Open', numeric: true, width: '56px', cell: (r) => pct0(r.summary.openPct) },
  { key: 'mfe', header: 'MFE', numeric: true, width: '64px', cell: (r) => wallNum(r.summary.avgMfe) },
  { key: 'mae', header: 'MAE', numeric: true, width: '64px', cell: (r) => wallNum(r.summary.avgMae) },
  {
    key: 'pts',
    header: 'Pts / touch',
    numeric: true,
    width: '84px',
    cell: (r) => <span className={tone(r.summary.ptsPerTouch)}>{signed(r.summary.ptsPerTouch)}</span>,
  },
]

function sweepColumns(refPx: number | null): Column<{ targetPct: number; summary: BtSummary }>[] {
  return [
    {
      key: 't',
      header: 'Bounce target',
      cell: (r) => (
        <span className="tabular">
          {r.targetPct.toFixed(2)}%
          {refPx ? <span className="text-muted"> · ≈ {wallNum((refPx * r.targetPct) / 100)} pts</span> : null}
        </span>
      ),
    },
    { key: 'n', header: 'Touches', numeric: true, cell: (r) => r.summary.n.toLocaleString() },
    { key: 'b', header: 'Bounce', numeric: true, cell: (r) => <span className="text-up">{pct0(r.summary.bouncePct)}</span> },
    { key: 'k', header: 'Break', numeric: true, cell: (r) => <span className="text-down">{pct0(r.summary.breakPct)}</span> },
    { key: 'o', header: 'Open', numeric: true, cell: (r) => pct0(r.summary.openPct) },
    { key: 'w', header: 'Bounce of resolved', numeric: true, cell: (r) => pct0(r.summary.winOfResolved) },
    {
      key: 'p',
      header: 'Pts / touch',
      numeric: true,
      cell: (r) => <span className={tone(r.summary.ptsPerTouch)}>{signed(r.summary.ptsPerTouch)}</span>,
    },
    {
      key: 'r',
      header: 'R / touch',
      numeric: true,
      cell: (r) => <span className={tone(r.summary.rPerTouch)}>{signed(r.summary.rPerTouch)}</span>,
    },
  ]
}

const RESULT_LABEL = { bounce: 'BOUNCE', break: 'BREAK', open: 'OPEN' } as const
const RESULT_CLASS = { bounce: 'text-up', break: 'text-down', open: 'text-muted' } as const

function eventColumns(onOpenSession: (date: string) => void): Column<BtEvent>[] {
  return [
    {
      key: 'date',
      header: 'Session',
      cell: (e) => (
        <button
          type="button"
          onClick={() => onOpenSession(e.date)}
          title="Open this session on the Log tab"
          className="tabular font-mono text-xs text-fg underline decoration-line underline-offset-2 hover:decoration-fg"
        >
          {e.date}
        </button>
      ),
    },
    { key: 'time', header: 'Time', cell: (e) => <span className="tabular font-mono text-xs">{hhmm(e.mins)}</span> },
    { key: 'core', header: 'CORE', numeric: true, cell: (e) => wallStrike(e.core) },
    {
      key: 'side',
      header: 'Approach',
      cell: (e) => (e.side === 'support' ? '▲ support' : '▼ resistance'),
    },
    { key: 'spot', header: 'Spot', numeric: true, cell: (e) => wallNum(e.spot) },
    {
      key: 'res',
      header: 'Result',
      cell: (e) => (
        <span className={`text-xs font-extrabold tracking-wide ${RESULT_CLASS[e.result]}`}>
          {RESULT_LABEL[e.result]}
          {e.gapped ? <span className="font-normal text-muted" title="Price stepped over the level between two 5-minute samples"> · gap</span> : null}
        </span>
      ),
    },
    { key: 'mfe', header: 'MFE', numeric: true, cell: (e) => wallNum(e.mfe) },
    { key: 'mae', header: 'MAE', numeric: true, cell: (e) => wallNum(e.mae) },
    { key: 'pts', header: 'Pts', numeric: true, cell: (e) => <span className={tone(e.exit)}>{signed(e.exit)}</span> },
    { key: 'min', header: 'Min', numeric: true, cell: (e) => (e.resolveMin == null ? '—' : String(Math.round(e.resolveMin))) },
    { key: 'n', header: 'Touch', numeric: true, cell: (e) => `#${e.touchNo}` },
    { key: 'age', header: 'CORE age', numeric: true, cell: (e) => `${Math.round(e.heldMin)}m` },
    {
      key: 'roll',
      header: 'Rolled',
      align: 'center',
      cell: (e) => (e.rolled ? <span title="The CORE moved to another strike while this touch was open">↻</span> : ''),
    },
  ]
}

// ── the curve ───────────────────────────────────────────────────────────────

const CURVE_H = 220

/**
 * Cumulative points, touch by touch. SVG drawn once per model change, words in
 * HTML so the squash never stretches them — the migration chart's paint rules.
 */
function CumulativeCurve({ events }: { events: BtEvent[] }) {
  const model = useMemo(() => {
    if (events.length < 2) return null
    let acc = 0
    const ys = [0]
    for (const e of events) {
      acc += e.exit
      ys.push(acc)
    }
    let lo = Math.min(...ys)
    let hi = Math.max(...ys)
    if (!(hi > lo)) {
      lo -= 1
      hi += 1
    }
    const pad = (hi - lo) * 0.08
    lo -= pad
    hi += pad
    const y = (v: number) => (1 - (v - lo) / (hi - lo)) * CURVE_H
    const x = (i: number) => (i / (ys.length - 1)) * 100
    const pts = ys.map((v, i) => `${x(i)},${y(v)}`).join(' ')
    return { pts, y0: y(0), yEnd: y(acc), end: acc, lo, hi, y }
  }, [events])

  if (!model) return <div className="py-6 text-center text-sm text-muted">Not enough touches to draw.</div>
  const first = events[0]!
  const last = events[events.length - 1]!
  const lineColor = model.end >= 0 ? T.green : T.red

  return (
    <div className="flex flex-col">
      <div className="relative" style={{ paddingRight: 64 }}>
        <svg viewBox={`0 0 100 ${CURVE_H}`} height={CURVE_H} preserveAspectRatio="none" style={{ width: '100%', display: 'block' }}>
          <line x1={0} x2={100} y1={model.y0} y2={model.y0} stroke={alpha(T.text, 0.35)} strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <polyline points={`0,${model.y0} ${model.pts} 100,${model.y0}`} fill={alpha(lineColor, 0.08)} stroke="none" />
          <polyline points={model.pts} fill="none" stroke={lineColor} strokeWidth={1.8} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        <div className="pointer-events-none absolute inset-y-0 right-0" style={{ width: 64 }} aria-hidden>
          <span className="tabular absolute font-mono text-2xs text-muted" style={{ left: 8, top: `${(model.y0 / CURVE_H) * 100}%`, transform: 'translateY(-50%)' }}>
            0
          </span>
          <span
            className={`tabular absolute font-mono text-2xs font-extrabold ${model.end >= 0 ? 'text-up' : 'text-down'}`}
            style={{ left: 8, top: `${(model.yEnd / CURVE_H) * 100}%`, transform: 'translateY(-50%)' }}
          >
            {signed(model.end)}
          </span>
        </div>
      </div>
      <div className="tabular mt-1 flex justify-between font-mono text-2xs text-muted" style={{ paddingRight: 64 }}>
        <span>{first.date}</span>
        <span style={{ color: LEVEL_COLORS.cb }}>{events.length.toLocaleString()} touches</span>
        <span>{last.date}</span>
      </div>
    </div>
  )
}
