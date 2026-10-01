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
// THE TRADE IT SCORES (2026-10-01, Brandon's definition): price comes within a
// strike of the CORE — 5 points on SPX / ES, it does not have to tag it — and
// the bounce is HALF WAY TO THE OTHER WALL. Zone and break are counted in
// strikes and the target in fractions of the way to the wall, so the same
// settings read the same on SPX, SPY and QQQ.
//
// Every control re-runs the backtest locally except the four that change WHAT
// is read (symbol, end date, sessions, variant), which re-fetch. Settings are
// remembered per browser; the end date is not, so the page opens on today.
//
// THE SESSION CHART (2026-10-01): the wall migration chart for one session,
// drawn from the same 5-minute series the backtest scored, with every hit's
// ENTRY (▲ support / ▼ resistance, where price was) and EXIT (● bounce at the
// target, ✕ break at the break level, ○ open where the hold ran out) and the
// target / break levels dashed across each hit's window. Prev / next step
// through the sessions that had hits; clicking a hit's date in the table loads
// its session here. ↗ beside it still opens that session on the Log tab.
//
// The target sweep and the hit table are folded by default — the page leads
// with the numbers and the picture.
//
// Its own chunk, loaded only when the tab is opened.
// ─────────────────────────────────────────────────────────────────────────────

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
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
  byWallDistance,
  fetchBacktestDays,
  filterEvents,
  fracLabel,
  hhmm,
  runBacktest,
  strikeWidth,
  summarize,
  sweepFractions,
} from '@/pages/levelLog/bounceEngine'
import { type MigMark, type MigSpan, WallMigrationChart } from '@/pages/levelLog/WallMigrationChart'
import { type DaySlice, type ExpScope, type GexBasis, VOLTICK_UI, todayETStr, variantTag, wallNum, wallStrike } from '@/pages/levelLog/wallData'

// ── controls ────────────────────────────────────────────────────────────────

type SessionsKey = '21' | '63' | '126' | '260'
type HoldKey = '30' | '60' | '120' | 'close'
type ZoneKey = '0.5' | '1' | '2'
type FracKey = '0.333' | '0.5' | '0.75' | '1'
type StopKey = '1' | '2' | '3' | '4'

const SESSIONS_OPTIONS: Array<{ label: string; value: SessionsKey; title: string }> = [
  { label: '1M', value: '21', title: 'The last 21 recorded sessions' },
  { label: '3M', value: '63', title: 'The last 63 recorded sessions' },
  { label: '6M', value: '126', title: 'The last 126 recorded sessions' },
  { label: 'All', value: '260', title: 'Every recorded session, up to 260' },
]

const ZONE_KEYS: readonly ZoneKey[] = ['0.5', '1', '2']
const FRAC_KEYS: readonly FracKey[] = ['0.333', '0.5', '0.75', '1']
const STOP_KEYS: readonly StopKey[] = ['1', '2', '3', '4']

const strikesLabel = (k: string) => (k === '0.5' ? '½ strike' : k === '1' ? '1 strike' : `${k} strikes`)

const HOLD_OPTIONS: Array<{ label: string; value: HoldKey; title: string }> = [
  { label: '30m', value: '30', title: 'Resolve within 30 minutes or it is OPEN' },
  { label: '1h', value: '60', title: 'Resolve within an hour or it is OPEN' },
  { label: '2h', value: '120', title: 'Resolve within two hours or it is OPEN' },
  { label: 'Close', value: 'close', title: 'Wait until the session ends' },
]

const APPROACH_OPTIONS: Array<{ label: string; value: Approach; title: string }> = [
  { label: 'Both', value: 'both', title: 'Every touch, from either side' },
  { label: '▲ Support', value: 'support', title: 'Price came DOWN to the CORE — does it bounce back up toward the wall above?' },
  { label: '▼ Resistance', value: 'resistance', title: 'Price came UP to the CORE — does it turn back down toward the wall below?' },
]

const TOUCH_OPTIONS: Array<{ label: string; value: TouchMode; title: string }> = [
  { label: 'Every', value: 'every', title: 'Every touch, re-armed after price leaves the zone by 2× its width' },
  { label: '1st only', value: 'first', title: 'Only the first touch of each CORE strike in a session' },
]

const SCOPE_OPTIONS: Array<{ label: string; value: ExpScope; title: string }> = [
  { label: '0DTE', value: '0dte', title: 'Levels from the nearest listed contract only' },
  { label: 'Non-0DTE', value: 'agg', title: 'Levels from every other listed expiration, summed per strike' },
]

const BASIS_OPTIONS: Array<{ label: string; value: GexBasis; title: string }> = [
  { label: 'OI + Vol', value: 'oivol', title: 'netGEX + netVolGEX' },
  { label: 'Vol only', value: 'vol', title: 'netVolGEX alone' },
]

const QUICK = ['SPX', 'SPY', 'QQQ'] as const

// ── saved settings ──────────────────────────────────────────────────────────

/** v2: the units changed from % of the CORE to strikes and wall fractions. */
const SETTINGS_KEY = 'cb-v3-level-log:backtest:v2'

interface Saved {
  sessions: SessionsKey
  scope: ExpScope
  basis: GexBasis
  zone: ZoneKey
  frac: FracKey
  stop: StopKey
  hold: HoldKey
  approach: Approach
  touches: TouchMode
}

const DEFAULTS: Saved = {
  sessions: '63',
  scope: '0dte',
  basis: 'oivol',
  zone: '1',
  frac: '0.5',
  stop: '2',
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
      zone: pick(j.zone, ZONE_KEYS, DEFAULTS.zone),
      frac: pick(j.frac, FRAC_KEYS, DEFAULTS.frac),
      stop: pick(j.stop, STOP_KEYS, DEFAULTS.stop),
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
const pts = (v: number) => (Number.isInteger(v) ? String(v) : wallNum(v))

/** The label in front of a control group — the row is too dense to go unlabelled. */
function Labeled({ label, children }: { label: string; children: ReactNode }) {
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
  const [frac, setFrac] = useState(saved.frac)
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
        JSON.stringify({ sessions, scope, basis, zone, frac, stop, hold, approach, touches } satisfies Saved),
      )
    } catch {
      /* best-effort */
    }
  }, [sessions, scope, basis, zone, frac, stop, hold, approach, touches])

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
  const days = data.days
  const strike = useMemo(() => strikeWidth(symbol, days), [symbol, days])
  const params = useMemo<BtParams>(
    () => ({
      strike,
      zoneStrikes: Number(zone),
      wallFrac: frac === '0.333' ? 1 / 3 : Number(frac),
      stopStrikes: Number(stop),
      holdMin: hold === 'close' ? null : Number(hold),
    }),
    [strike, zone, frac, stop, hold],
  )
  const run = useMemo(() => runBacktest(days, params), [days, params])
  const events = useMemo(() => filterEvents(run.events, approach, touches), [run, approach, touches])
  const sum = useMemo(() => summarize(events), [events])
  const sweep = useMemo(() => sweepFractions(days, params, approach, touches), [days, params, approach, touches])
  const groups = useMemo(
    () => [
      { title: 'By approach', rows: bySide(events) },
      { title: 'By time of day', rows: byTime(events) },
      { title: 'By distance to the wall', rows: byWallDistance(events, strike) },
      { title: 'By touch number', rows: byTouchNo(events) },
      { title: 'By CORE age', rows: byAge(events) },
    ],
    [events, strike],
  )

  const zonePts = Number(zone) * strike
  const stopPts = Number(stop) * strike
  const fracText = fracLabel(params.wallFrac)
  const range = days.length ? `${days[0]!.date} → ${days[days.length - 1]!.date}` : ''

  // ── the session chart ───────────────────────────────────────────────────
  /** Sessions that had at least one hit under the current filters, oldest first. */
  const hitDates = useMemo(() => [...new Set(events.map((e) => e.date))].sort(), [events])
  const [pickedDate, setPickedDate] = useState<string | null>(null)
  // The pick survives a settings change only while it still has hits; otherwise
  // the newest session that does.
  const chartDate = pickedDate && hitDates.includes(pickedDate) ? pickedDate : (hitDates[hitDates.length - 1] ?? null)
  const chartDay = useMemo(() => days.find((d) => d.date === chartDate) ?? null, [days, chartDate])
  const chartEvents = useMemo(() => events.filter((e) => e.date === chartDate), [events, chartDate])
  const chartIdx = chartDate ? hitDates.indexOf(chartDate) : -1
  const chartRef = useRef<HTMLDivElement | null>(null)
  const pickSession = (date: string) => {
    setPickedDate(date)
    chartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const { marks, spans } = useMemo(() => annotate(chartEvents), [chartEvents])
  const [sweepOpen, setSweepOpen] = useState(false)
  const [hitsOpen, setHitsOpen] = useState(false)

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
            {symbol} · 1 strike = {pts(strike)} pts
          </span>
          <SegGroup
            options={QUICK.map((q) => ({ label: q, value: q, title: `Backtest ${q}` }))}
            value={(QUICK as readonly string[]).includes(symbol) ? (symbol as (typeof QUICK)[number]) : ('' as (typeof QUICK)[number])}
            onChange={(v) => setSymbol(v)}
            title="Quick pick"
          />
          <DatePicker size="sm" value={end} max={todayETStr()} onChange={(v) => setEnd(v || todayETStr())} title="Last session in the test, ET" label={(v) => `to ${v}`} className="shrink-0" />
          <SegGroup options={SESSIONS_OPTIONS} value={sessions} onChange={setSessions} title="How many recorded sessions" />
          <SegGroup options={SCOPE_OPTIONS} value={scope} onChange={setScope} title="Which contracts the levels are from" />
          <SegGroup options={BASIS_OPTIONS} value={basis} onChange={setBasis} title="Which GEX the levels are from" />
        </CardToolbar>

        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <Labeled label="Hit within">
            <SegGroup
              options={ZONE_KEYS.map((k) => ({ label: strikesLabel(k), value: k, title: `A hit is price within ${pts(Number(k) * strike)} pts of the CORE` }))}
              value={zone}
              onChange={setZone}
              title="How close counts as a hit"
            />
          </Labeled>
          <Labeled label="Bounce to">
            <SegGroup
              options={FRAC_KEYS.map((k) => {
                const f = k === '0.333' ? 1 / 3 : Number(k)
                return { label: f === 1 ? 'The wall' : `${fracLabel(f)} way`, value: k, title: `A bounce is price getting ${fracLabel(f)} of the way from the CORE to the next wall` }
              })}
              value={frac}
              onChange={setFrac}
              title="How far toward the next wall a bounce has to get"
            />
          </Labeled>
          <Labeled label="Break">
            <SegGroup
              options={STOP_KEYS.map((k) => ({ label: strikesLabel(k), value: k, title: `A break is price ${pts(Number(k) * strike)} pts through the CORE` }))}
              value={stop}
              onChange={setStop}
              title="How far through the CORE counts as a break"
            />
          </Labeled>
          <Labeled label="Hold">
            <SegGroup options={HOLD_OPTIONS} value={hold} onChange={setHold} title="How long a hit has to resolve" />
          </Labeled>
          <Labeled label="Approach">
            <SegGroup options={APPROACH_OPTIONS} value={approach} onChange={setApproach} title="Which side price came from" />
          </Labeled>
          <Labeled label="Hits">
            <SegGroup options={TOUCH_OPTIONS} value={touches} onChange={setTouches} title="Every hit, or the first per CORE strike" />
          </Labeled>
        </div>

        <p className="mb-3 text-2xs leading-relaxed text-muted">
          A <b className="text-fg">hit</b> is 5-minute spot within {strikesLabel(zone)} of the CORE ({pts(zonePts)} pts — it does not
          have to tag it), after coming from one side. <b className="text-up">Bounce</b> = price gets {fracText === 'All the way' ? 'all the way' : `${fracText} of the way`} from
          the CORE to the next wall on the side it came from (the call wall above on a support hit, the put wall below on a
          resistance hit), as the walls stood at the hit. <b className="text-down">Break</b> = {strikesLabel(stop)} through the CORE ({pts(stopPts)} pts).
          Neither within {hold === 'close' ? 'the session' : HOLD_OPTIONS.find((h) => h.value === hold)?.label} = open. Levels are
          the {variantTag(scope, basis)} recorder as of the hit — no look-ahead. 5-minute samples, not highs and lows: a wick
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
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
            <Stat
              label="Hits"
              value={sum.n.toLocaleString()}
              sub={`${sum.sessions} of ${days.length} sessions · ${range}${run.noWall ? ` · ${run.noWall} with no wall to bounce to, not scored` : ''}`}
            />
            <Stat label="Bounced" value={pct0(sum.bouncePct)} sub={`${sum.bounce} hits`} direction="up" />
            <Stat label="Broke" value={pct0(sum.breakPct)} sub={`${sum.brk} hits`} direction="down" />
            <Stat label="Open" value={pct0(sum.openPct)} sub={`${sum.open} unresolved`} />
            <Stat label="Bounce of resolved" value={pct0(sum.winOfResolved)} sub="share of the ones that resolved" />
            <Stat label="Avg target" value={sum.avgTarget == null ? '—' : `${wallNum(sum.avgTarget)}`} sub={`pts from the CORE · break ${pts(stopPts)}`} />
            <Stat label="Avg MFE / MAE" value={`${wallNum(sum.avgMfe)} / ${wallNum(sum.avgMae)}`} sub="points from the CORE" />
            <Stat label="Time to bounce" value={sum.medBounceMin == null ? '—' : `${Math.round(sum.medBounceMin)}m`} sub="median" />
            <Stat
              label="Points per hit"
              value={signed(sum.ptsPerTouch)}
              sub={`${signed(sum.rPerTouch)} R`}
              direction={sum.ptsPerTouch == null || sum.ptsPerTouch === 0 ? undefined : sum.ptsPerTouch > 0 ? 'up' : 'down'}
            />
          </div>
        )}
      </Card>

      {days.length && !data.error ? (
        <>
          <div ref={chartRef} className="scroll-mt-3">
            <Card
              title={chartDate ? `Session · ${chartDate} · ${chartEvents.length} hit${chartEvents.length === 1 ? '' : 's'}` : 'Session'}
              expandId="level-log-core-backtest-session"
              actions={
                chartDate ? (
                  <button
                    type="button"
                    onClick={() => onOpenSession(chartDate)}
                    title="Open this session on the Log tab (1-minute tape)"
                    className="rounded-sm px-1 text-xs text-faint transition-colors hover:bg-raised hover:text-fg"
                  >
                    <span aria-hidden>↗</span>
                  </button>
                ) : null
              }
            >
              <CardToolbar>
                <button
                  type="button"
                  disabled={chartIdx <= 0}
                  onClick={() => setPickedDate(hitDates[chartIdx - 1] ?? null)}
                  title="Previous session with a hit"
                  className="rounded-sm border border-line px-2 py-0.5 text-2xs font-semibold text-fg transition-colors hover:bg-raised disabled:opacity-30"
                >
                  ◀ Prev
                </button>
                <span className="tabular font-mono text-2xs text-muted">
                  {chartIdx >= 0 ? `${chartIdx + 1} / ${hitDates.length}` : '—'}
                </span>
                <button
                  type="button"
                  disabled={chartIdx < 0 || chartIdx >= hitDates.length - 1}
                  onClick={() => setPickedDate(hitDates[chartIdx + 1] ?? null)}
                  title="Next session with a hit"
                  className="rounded-sm border border-line px-2 py-0.5 text-2xs font-semibold text-fg transition-colors hover:bg-raised disabled:opacity-30"
                >
                  Next ▶
                </button>
              </CardToolbar>
              <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted">
                <span>
                  <span style={{ color: T.cyan }}>▲ ▼</span> entry — support / resistance hit, at the price it printed
                </span>
                <span>
                  <span style={{ color: T.green }}>●</span> bounce, at the target
                </span>
                <span>
                  <span style={{ color: T.red }}>✕</span> break, at the break level
                </span>
                <span>
                  <span style={{ color: T.faint }}>○</span> open, where the hold ran out
                </span>
                <span>
                  dashed <span style={{ color: T.green }}>target</span> / <span style={{ color: T.red }}>break</span> over each hit&apos;s window
                </span>
              </div>
              {chartDay ? (
                <WallMigrationChart days={[chartDay]} view={VOLTICK_UI ? 'voltick' : 'all'} height={300} marks={marks} spans={spans} />
              ) : (
                <div className="py-8 text-center text-sm text-muted">No hits with these settings, so no session to draw.</div>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
            <Card title="Cumulative points" expandId="level-log-core-backtest-curve">
              <p className="mb-2 text-2xs text-muted">
                Every hit in order: + the target on a bounce, −{pts(stopPts)} on a break, where it stood on an open one. In points
                of {symbol}.
              </p>
              <CumulativeCurve events={events} />
            </Card>
            <Card title="Breakdown" expandId="level-log-core-backtest-breakdown">
              <div className="flex flex-col gap-3">
                {groups.map((g) => (
                  <div key={g.title}>
                    <div className="mb-1 text-2xs font-extrabold uppercase tracking-widest text-muted">{g.title}</div>
                    <Table columns={BUCKET_COLUMNS} rows={g.rows} rowKey={(r) => r.key} empty="No hits." />
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Fold title="Target sweep" open={sweepOpen} onToggle={() => setSweepOpen((o) => !o)} expandId="level-log-core-backtest-sweep">
            <p className="mb-2 text-2xs text-muted">
              The same sessions re-scored with the bounce at each fraction of the way to the wall — break at {pts(stopPts)} pts,
              everything else held. The highlighted row is the target set above.
            </p>
            <Table
              columns={SWEEP_COLUMNS}
              rows={sweep}
              rowKey={(r) => String(r.frac)}
              rowClassName={(r) => (Math.abs(r.frac - params.wallFrac) < 1e-6 ? 'bg-surface2' : undefined)}
              empty="Nothing to sweep."
            />
          </Fold>

          <Fold
            title={`Every hit · ${events.length.toLocaleString()}`}
            open={hitsOpen}
            onToggle={() => setHitsOpen((o) => !o)}
            expandId="level-log-core-backtest-touches"
          >
            <div className="max-h-[560px] min-h-0 overflow-auto">
              <Table
                columns={eventColumns(pickSession, onOpenSession)}
                rows={events.slice().reverse().slice(0, EVENT_CAP)}
                rowKey={(r) => r.id}
                empty="No hits with these settings."
              />
            </div>
            {events.length > EVENT_CAP ? (
              <p className="mt-1.5 text-2xs text-muted">
                Newest {EVENT_CAP} of {events.length.toLocaleString()} shown — every one is in the numbers above.
              </p>
            ) : null}
          </Fold>
        </>
      ) : null}
    </div>
  )
}

/** Rows the hit table renders. The stats always use all of them. */
const EVENT_CAP = 400

/**
 * A card that folds to its header. The header is the switch; folded, the body
 * renders nothing and the card is one row. Folded cards cannot be expanded —
 * there is nothing in them to fill the page with.
 */
function Fold({
  title,
  open,
  onToggle,
  expandId,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  expandId: string
  children: ReactNode
}) {
  return (
    <Card
      title={
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          title={open ? `Fold ${title}` : `Show ${title}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-fg"
        >
          <span aria-hidden className="text-2xs">
            {open ? '▾' : '▸'}
          </span>
          {title}
        </button>
      }
      expandId={expandId}
      expandable={open}
      flush={!open}
    >
      {open ? children : null}
    </Card>
  )
}

/** One session's hits as chart annotations — the legend above the chart says what each glyph is. */
function annotate(evs: BtEvent[]): { marks: MigMark[]; spans: MigSpan[] } {
  const marks: MigMark[] = []
  const spans: MigSpan[] = []
  for (const e of evs) {
    const what = e.side === 'support' ? 'support' : 'resistance'
    spans.push({ key: `tgt-${e.id}`, date: e.date, fromMins: e.mins, toMins: e.exitMins, price: e.target, color: T.green })
    spans.push({ key: `stp-${e.id}`, date: e.date, fromMins: e.mins, toMins: e.exitMins, price: e.stopPx, color: T.red })
    marks.push({
      key: `in-${e.id}`,
      date: e.date,
      mins: e.mins,
      price: e.spot,
      glyph: e.side === 'support' ? '▲' : '▼',
      color: T.cyan,
      title: `${hhmm(e.mins)} ${what} hit · CORE ${wallStrike(e.core)} · spot ${wallNum(e.spot)} · target ${wallNum(e.target)} (${fracLabel(e.targetPts / Math.max(1e-9, Math.abs(e.wall - e.core)))} to ${e.wallKind === 'call' ? 'CW' : 'PW'} ${wallStrike(e.wall)}) · break ${wallNum(e.stopPx)}`,
    })
    marks.push({
      key: `out-${e.id}`,
      date: e.date,
      mins: e.exitMins,
      price: e.exitPx,
      glyph: e.result === 'bounce' ? '●' : e.result === 'break' ? '✕' : '○',
      color: e.result === 'bounce' ? T.green : e.result === 'break' ? T.red : T.faint,
      title: `${hhmm(e.exitMins)} ${e.result.toUpperCase()} · ${signed(e.exit)} pts${e.resolveMin != null ? ` after ${Math.round(e.resolveMin)}m` : ''}`,
    })
  }
  return { marks, spans }
}

// ── tables ──────────────────────────────────────────────────────────────────

const BUCKET_COLUMNS: Column<Bucket>[] = [
  { key: 'label', header: '', cell: (r) => r.label },
  { key: 'n', header: 'Hits', numeric: true, width: '56px', cell: (r) => r.summary.n.toLocaleString() },
  { key: 'b', header: 'Bounce', numeric: true, width: '60px', cell: (r) => <span className="text-up">{pct0(r.summary.bouncePct)}</span> },
  { key: 'k', header: 'Break', numeric: true, width: '56px', cell: (r) => <span className="text-down">{pct0(r.summary.breakPct)}</span> },
  { key: 'o', header: 'Open', numeric: true, width: '52px', cell: (r) => pct0(r.summary.openPct) },
  { key: 't', header: 'Target', numeric: true, width: '60px', cell: (r) => wallNum(r.summary.avgTarget) },
  { key: 'mfe', header: 'MFE', numeric: true, width: '56px', cell: (r) => wallNum(r.summary.avgMfe) },
  { key: 'mae', header: 'MAE', numeric: true, width: '56px', cell: (r) => wallNum(r.summary.avgMae) },
  {
    key: 'pts',
    header: 'Pts / hit',
    numeric: true,
    width: '72px',
    cell: (r) => <span className={tone(r.summary.ptsPerTouch)}>{signed(r.summary.ptsPerTouch)}</span>,
  },
]

const SWEEP_COLUMNS: Column<{ frac: number; summary: BtSummary }>[] = [
  { key: 'f', header: 'Bounce to', cell: (r) => (r.frac === 1 ? 'The wall' : `${fracLabel(r.frac)} of the way`) },
  { key: 'n', header: 'Hits', numeric: true, cell: (r) => r.summary.n.toLocaleString() },
  { key: 't', header: 'Avg target', numeric: true, cell: (r) => wallNum(r.summary.avgTarget) },
  { key: 'b', header: 'Bounce', numeric: true, cell: (r) => <span className="text-up">{pct0(r.summary.bouncePct)}</span> },
  { key: 'k', header: 'Break', numeric: true, cell: (r) => <span className="text-down">{pct0(r.summary.breakPct)}</span> },
  { key: 'o', header: 'Open', numeric: true, cell: (r) => pct0(r.summary.openPct) },
  { key: 'w', header: 'Bounce of resolved', numeric: true, cell: (r) => pct0(r.summary.winOfResolved) },
  { key: 'm', header: 'Time to bounce', numeric: true, cell: (r) => (r.summary.medBounceMin == null ? '—' : `${Math.round(r.summary.medBounceMin)}m`) },
  {
    key: 'p',
    header: 'Pts / hit',
    numeric: true,
    cell: (r) => <span className={tone(r.summary.ptsPerTouch)}>{signed(r.summary.ptsPerTouch)}</span>,
  },
  {
    key: 'r',
    header: 'R / hit',
    numeric: true,
    cell: (r) => <span className={tone(r.summary.rPerTouch)}>{signed(r.summary.rPerTouch)}</span>,
  },
]

const RESULT_LABEL = { bounce: 'BOUNCE', break: 'BREAK', open: 'OPEN' } as const
const RESULT_CLASS = { bounce: 'text-up', break: 'text-down', open: 'text-muted' } as const

function eventColumns(onPick: (date: string) => void, onOpenSession: (date: string) => void): Column<BtEvent>[] {
  return [
    {
      key: 'date',
      header: 'Session',
      cell: (e) => (
        <span className="inline-flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onPick(e.date)}
            title="Draw this session on the chart above, with its entries and exits"
            className="tabular font-mono text-xs text-fg underline decoration-line underline-offset-2 hover:decoration-fg"
          >
            {e.date}
          </button>
          <button
            type="button"
            onClick={() => onOpenSession(e.date)}
            title="Open this session on the Log tab"
            className="text-2xs text-faint hover:text-fg"
          >
            <span aria-hidden>↗</span>
          </button>
        </span>
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
      key: 'wall',
      header: 'Wall',
      numeric: true,
      cell: (e) => (
        <span title={e.wallKind === 'call' ? 'Call wall' : 'Put wall'} style={{ color: e.wallKind === 'call' ? T.green : T.red }}>
          {e.wallKind === 'call' ? 'CW' : 'PW'} {wallStrike(e.wall)}
        </span>
      ),
    },
    { key: 'tgt', header: 'Target', numeric: true, cell: (e) => wallNum(e.target) },
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
    { key: 'n', header: 'Hit', numeric: true, cell: (e) => `#${e.touchNo}` },
    { key: 'age', header: 'CORE age', numeric: true, cell: (e) => `${Math.round(e.heldMin)}m` },
    {
      key: 'roll',
      header: 'Rolled',
      align: 'center',
      cell: (e) => (e.rolled ? <span title="The CORE moved to another strike while this hit was open">↻</span> : ''),
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
