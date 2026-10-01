// ─────────────────────────────────────────────────────────────────────────────
// LEVEL LOG › BACKTEST › FORWARD TEST — the card under the backtest.
//
// Lock the backtest's rules; from that minute on, every fill the engine finds
// on SPX is logged here, priced in MES and in dollars, and set against what the
// backtest promised when the rules were locked. Nothing before the lock counts
// and the rules cannot be changed under a running test — changing them is a new
// test (Reset, then lock again). The record and its reader are in
// forwardStore.ts; this file draws it.
//
// THE ORDER TICKET. While a session is live, the card also says what to have
// resting on MES right now, under the locked rules: the side (a CORE above
// price is a SELL limit — price can only reach it from below; a CORE below is a
// BUY), the MES entry, target and stop (SPX + the ES−SPX basis from
// /proxy/es-spx-basis, to the tick), and the dollars at stake. Or why there is no order: price sitting
// on the CORE, the level not re-armed since its last fill, no wall to bounce
// to, a side or a repeat touch the rules skip, or a trade already on.
//
// Its own chunk, loaded with the Backtest tab.
// ─────────────────────────────────────────────────────────────────────────────

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardToolbar } from '@/design/primitives/Card'
import { SegGroup } from '@/design/primitives/Controls'
import { Stat } from '@/design/primitives/Stat'
import { type Column, Table } from '@/design/primitives/Table'
import { LEVEL_COLORS, T, alpha } from '@/design/theme'
import { fracLabel, hhmm, levelsAt, targetWall } from '@/pages/levelLog/bounceEngine'
import {
  type FwdBaseline,
  type FwdLock,
  type FwdMes,
  type FwdRules,
  type FwdToday,
  type FwdTrade,
  MES_PER_PT,
  MES_TICK,
  etNow,
  inSessionET,
  readForward,
  toTick,
  tradeDollars,
  useForwardDoc,
} from '@/pages/levelLog/forwardStore'
import { useMinuteTick, variantTag, wallNum, wallStrike } from '@/pages/levelLog/wallData'

export interface ForwardTestProps {
  /** The backtest's settings right now — what a lock would capture. */
  current: FwdRules
  /** The backtest's result right now, kept with the lock as the bar to beat. */
  baseline: FwdBaseline | null
  /** Put the backtest above back on the locked rules. */
  onApplyRules: (r: FwdRules) => void
  onOpenSession: (date: string) => void
}

// ── formatting ──────────────────────────────────────────────────────────────

const pct0 = (v: number | null) => (v == null ? '—' : `${Math.round(v)}%`)
const signed = (v: number | null, dp = 2) => (v == null ? '—' : `${v > 0 ? '+' : ''}${wallNum(v, dp)}`)
const tone = (v: number | null) => (v == null || v === 0 ? 'text-fg' : v > 0 ? 'text-up' : 'text-down')
const dirOf = (v: number | null) => (v == null || v === 0 ? undefined : v > 0 ? ('up' as const) : ('down' as const))
const usd = (v: number | null, dp = 0) =>
  v == null
    ? '—'
    : `${v > 0 ? '+' : v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`
const mesOf = (spx: number, basis: number | null) => (basis == null ? null : toTick(spx + basis))
const mesNum = (v: number | null) => (v == null ? '—' : wallNum(v))
const sameRules = (a: FwdRules, b: FwdRules) =>
  a.symbol === b.symbol &&
  a.scope === b.scope &&
  a.basis === b.basis &&
  a.entry === b.entry &&
  a.frac === b.frac &&
  a.stop === b.stop &&
  a.hold === b.hold &&
  a.approach === b.approach &&
  a.touches === b.touches

/** The rules in a trader's words, one chip each. */
function ruleWords(r: FwdRules): string[] {
  const p = r.params
  return [
    r.symbol,
    variantTag(r.scope, r.basis),
    p.entryPts === 0 ? 'entry on the CORE' : `entry ${wallNum(p.entryPts, p.entryPts % 1 ? 1 : 0)} pts before`,
    p.wallFrac >= 1 ? 'target the wall' : `target ${fracLabel(p.wallFrac)} way`,
    `break ${p.stopStrikes} strike${p.stopStrikes === 1 ? '' : 's'} (${wallNum(p.stopStrikes * p.strike, 0)} pts)`,
    p.holdMin == null ? 'hold to the close' : `hold ${p.holdMin < 60 ? `${p.holdMin}m` : `${p.holdMin / 60}h`}`,
    r.approach === 'both' ? 'both sides' : r.approach === 'support' ? 'CORE below only (long)' : 'CORE above only (short)',
    r.touches === 'every' ? 'every hit' : '1st hit only',
  ]
}

function Chips({ words }: { words: string[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {words.map((w) => (
        <span key={w} className="rounded-sm border border-line bg-surface2 px-1.5 py-0.5 text-2xs text-fg">
          {w}
        </span>
      ))}
    </span>
  )
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-3xs font-extrabold uppercase tracking-widest text-muted">{label}</span>
      {children}
    </span>
  )
}

/** A number box that only commits a valid value — typing through "" or "1." never resets it. */
function NumField({
  value,
  onCommit,
  min,
  max,
  step,
  width,
  title,
}: {
  value: number
  onCommit: (v: number) => void
  min: number
  max: number
  step: number
  width: number
  title: string
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <input
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={text}
      title={title}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= min && n <= max) onCommit(n)
      }}
      onBlur={() => setText(String(value))}
      className="tabular rounded-sm border border-line bg-surface2 px-1.5 py-0.5 text-xs text-fg"
      style={{ width }}
    />
  )
}

// ── the card ────────────────────────────────────────────────────────────────

type ReadState = { live: FwdTrade[]; today: FwdToday | null; loading: boolean; error: string | null; at: number | null }

export default function ForwardTest({ current, baseline, onApplyRules, onOpenSession }: ForwardTestProps) {
  const { doc, update, account } = useForwardDoc()
  const lock = doc.lock
  const mes = doc.mes
  const tick = useMinuteTick(lock != null)
  const [nonce, setNonce] = useState(0)
  const [read, setRead] = useState<ReadState>({ live: [], today: null, loading: false, error: null, at: null })

  // The reader sees the record through a ref, so freezing a session does not
  // re-run it — it runs on the lock, the minute and the ↻ button only.
  const frozenRef = useRef(doc.frozen)
  frozenRef.current = doc.frozen
  const lastTick = useRef(-1)
  const lockAt = lock?.at ?? null

  useEffect(() => {
    if (!lock) return
    // Outside the session the minute tick has nothing new to read.
    const byTick = tick !== lastTick.current
    lastTick.current = tick
    if (byTick && tick > 0 && !inSessionET()) return
    const ctl = new AbortController()
    setRead((r) => ({ ...r, loading: true, error: null }))
    readForward(lock, frozenRef.current, ctl.signal)
      .then((res) => {
        if (ctl.signal.aborted) return
        if (Object.keys(res.fresh).length) {
          update((d) => (d.lock?.at === lock.at ? { ...d, frozen: { ...d.frozen, ...res.fresh } } : d))
        }
        setRead({ live: res.live, today: res.today, loading: false, error: null, at: Date.now() })
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return
        setRead((r) => ({ ...r, loading: false, error: e instanceof Error ? e.message : String(e) }))
      })
    return () => ctl.abort()
    // `lock` is identified by its timestamp; the object itself is re-created on every save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockAt, tick, nonce, update])

  // ── the record, in order ──────────────────────────────────────────────────
  const trades = useMemo<FwdTrade[]>(() => {
    if (!lock) return []
    const past = Object.keys(doc.frozen)
      .filter((d) => d >= lock.date)
      .sort()
      .flatMap((d) => doc.frozen[d] ?? [])
    return [...past, ...read.live.filter((t) => !doc.frozen[t.date])]
  }, [lock, doc.frozen, read.live])

  const sessions = useMemo(() => {
    if (!lock) return 0
    const n = Object.keys(doc.frozen).filter((d) => d >= lock.date).length
    return n + (read.today && !doc.frozen[read.today.day.date] ? 1 : 0)
  }, [lock, doc.frozen, read.today])

  const stats = useMemo(() => summarizeFwd(trades, mes, doc.taken), [trades, mes, doc.taken])
  const expect = useMemo(() => (lock?.baseline ? expectedDollars(lock.baseline, mes) : null), [lock, mes])
  // LIVE = still running: today, in the session, open through the newest bar.
  const liveIds = useMemo(() => {
    const last = read.today?.last
    if (!last || !inSessionET() || read.today?.day.date !== etNow().date) return new Set<string>()
    return new Set(read.live.filter((t) => t.result === 'open' && t.exitMins >= last.mins).map((t) => t.id))
  }, [read.live, read.today])

  const [confirmReset, setConfirmReset] = useState(false)
  useEffect(() => {
    if (!confirmReset) return
    const id = window.setTimeout(() => setConfirmReset(false), 4000)
    return () => window.clearTimeout(id)
  }, [confirmReset])

  const setMes = (patch: Partial<FwdMes>) => update((d) => ({ ...d, mes: { ...d.mes, ...patch } }))
  const toggleTaken = (id: string) =>
    update((d) => {
      const taken = { ...d.taken }
      if (taken[id]) delete taken[id]
      else taken[id] = true
      return { ...d, taken }
    })
  const lockNow = () => {
    const n = etNow()
    update((d) => ({ ...d, lock: { at: Date.now(), date: n.date, mins: n.mins, rules: current, baseline }, frozen: {}, taken: {} }))
    setRead({ live: [], today: null, loading: false, error: null, at: null })
  }
  const reset = () => {
    update((d) => ({ ...d, lock: null, frozen: {}, taken: {} }))
    setRead({ live: [], today: null, loading: false, error: null, at: null })
    setConfirmReset(false)
  }

  const canLock = current.symbol === 'SPX' && baseline != null

  return (
    <Card
      title={lock ? `Forward test · SPX → MES · since ${lock.date} ${hhmm(lock.mins)} ET` : 'Forward test · SPX → MES'}
      expandId="level-log-core-forward"
      actions={
        lock ? (
          <button
            type="button"
            onClick={() => setNonce((n) => n + 1)}
            title="Re-read today's session"
            className="rounded-sm px-1 text-xs text-faint transition-colors hover:bg-raised hover:text-fg"
          >
            <span aria-hidden>↻</span>
          </button>
        ) : null
      }
    >
      {!lock ? (
        <div className="flex flex-col gap-2.5">
          <p className="text-2xs leading-relaxed text-muted">
            A backtest says what <i>would</i> have worked; a forward test says what <i>is</i> working. Lock the rules set above
            and every SPX fill from this minute on is logged here under exactly those rules — nothing before the lock, no
            re-tuning after it — priced in MES (SPX + the session's ES−SPX basis, to the tick) and in dollars, and set
            against what the backtest says now. While the market is open the card also shows the MES order to have resting.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-3xs font-extrabold uppercase tracking-widest text-muted">Rules to lock</span>
            <Chips words={ruleWords(current)} />
          </div>
          {baseline ? (
            <p className="text-2xs text-muted">
              Backtest now: <b className="text-fg">{baseline.n}</b> fills over {baseline.sessions} sessions ({baseline.from} →{' '}
              {baseline.to}, {baseline.bars} bars) · <span className={tone(baseline.ptsPerFill)}>{signed(baseline.ptsPerFill)} pts / fill</span> ·{' '}
              {pct0(baseline.winOfResolved)} bounce of resolved.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!canLock}
              onClick={lockNow}
              title={canLock ? 'Start logging every fill under these rules from now' : current.symbol !== 'SPX' ? 'The forward test runs on SPX (traded as MES) — pick SPX above' : 'Waiting for the backtest to finish'}
              className="rounded-sm border px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40"
              style={{ borderColor: alpha(LEVEL_COLORS.cb, 0.6), color: LEVEL_COLORS.cb }}
            >
              🔒 Lock these rules · start the forward test
            </button>
            {current.symbol !== 'SPX' ? (
              <span className="text-2xs text-warn">SPX only — it is traded as MES. Switch the backtest to SPX.</span>
            ) : !baseline ? (
              <span className="text-2xs text-muted">Waiting for the backtest above to finish…</span>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <CardToolbar>
            {confirmReset ? (
              <button
                type="button"
                onClick={reset}
                title="Ends this forward test and clears its record"
                className="rounded-sm border border-down/60 px-2 py-0.5 text-2xs font-semibold text-down transition-colors hover:bg-raised"
              >
                Click again to end it
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                title="End this forward test — new rules are a new test"
                className="rounded-sm border border-line px-2 py-0.5 text-2xs font-semibold text-muted transition-colors hover:bg-raised hover:text-fg"
              >
                Reset
              </button>
            )}
          </CardToolbar>

          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-3xs font-extrabold uppercase tracking-widest text-muted">Locked</span>
            <Chips words={ruleWords(lock.rules)} />
            {sameRules(lock.rules, current) ? (
              <span className="text-2xs text-faint">· the backtest above is on these rules</span>
            ) : (
              <button
                type="button"
                onClick={() => onApplyRules(lock.rules)}
                title="Set the backtest above to the locked rules"
                className="text-2xs text-faint underline decoration-line underline-offset-2 hover:text-fg"
              >
                · the backtest above is on other settings — show the locked ones
              </button>
            )}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <Labeled label="MES">
              <NumField
                value={mes.contracts}
                min={1}
                max={100}
                step={1}
                width={56}
                title="Contracts per trade"
                onCommit={(v) => setMes({ contracts: Math.round(v) })}
              />
              <span className="text-2xs text-muted">contracts · ${MES_PER_PT}/pt each</span>
            </Labeled>
            <Labeled label="Fees">
              <span className="text-2xs text-muted">$</span>
              <NumField
                value={mes.fees}
                min={0}
                max={50}
                step={0.05}
                width={64}
                title="All-in commission + exchange fees per contract, round trip — set to your broker's"
                onCommit={(v) => setMes({ fees: Math.round(v * 100) / 100 })}
              />
              <span className="text-2xs text-muted">/ contract round trip</span>
            </Labeled>
            <Labeled label="Slip">
              <SegGroup
                options={(['0', '1', '2', '3'] as const).map((k) => ({
                  label: k === '0' ? 'None' : `${k} tick${k === '1' ? '' : 's'}`,
                  value: k,
                  title: `${k} × ${MES_TICK} pt given up on a market exit — a break (stop) or an open trade closed at the hold. Limit entries and targets fill at their price.`,
                }))}
                value={String(mes.slip) as '0' | '1' | '2' | '3'}
                onChange={(v) => setMes({ slip: Number(v) })}
                title="Slippage on market exits"
              />
            </Labeled>
            <span className="text-2xs text-faint">{account ? 'Saved to your account' : 'Saved in this browser'}</span>
          </div>

          <Ticket lock={lock} today={read.today} live={read.live} mes={mes} />

          {read.error ? (
            <div className="mb-3 rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-sm text-warn">
              Could not read the recorder — {read.error}.
            </div>
          ) : null}

          <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            <Stat
              label="Trades"
              value={stats.n.toLocaleString()}
              sub={`${sessions} session${sessions === 1 ? '' : 's'} · ${stats.bounce} bounce · ${stats.brk} break · ${stats.open} open`}
            />
            <Stat
              label="Bounce of resolved"
              value={pct0(stats.winOfResolved)}
              sub={`backtest ${pct0(lock.baseline?.winOfResolved ?? null)}`}
            />
            <Stat
              label="Points per fill"
              value={signed(stats.ptsPerFill)}
              direction={dirOf(stats.ptsPerFill)}
              sub={`backtest ${signed(lock.baseline?.ptsPerFill ?? null)}`}
            />
            <Stat label="Net" value={usd(stats.net)} direction={dirOf(stats.net)} sub={`${mes.contracts} MES · after fees and slip`} />
            <Stat
              label="Per trade"
              value={usd(stats.perTrade, 2)}
              direction={dirOf(stats.perTrade)}
              sub={`backtest ≈ ${usd(expect, 2)}`}
            />
            <Stat label="Max drawdown" value={stats.maxDd > 0 ? usd(-stats.maxDd) : '$0'} sub="peak to trough, closed trades in order" />
            <Stat
              label="Taken"
              value={`${stats.takenN} of ${stats.n}`}
              direction={dirOf(stats.takenN ? stats.takenNet : null)}
              sub={stats.takenN ? `${usd(stats.takenNet)} on those` : 'tick a row when you take it'}
            />
          </div>

          {trades.length >= 2 ? (
            <div className="mb-3">
              <DollarCurve trades={trades} mes={mes} />
            </div>
          ) : null}

          <div className="max-h-[420px] min-h-0 overflow-auto">
            <Table
              columns={columns(mes, doc.taken, liveIds, toggleTaken, onOpenSession)}
              rows={trades.slice().reverse()}
              rowKey={(t) => t.id}
              empty={
                read.loading && !read.at
                  ? 'Reading the recorder…'
                  : `No fills yet. Every SPX fill after ${lock.date} ${hhmm(lock.mins)} ET under the locked rules lands here.`
              }
            />
          </div>
          <p className="mt-1.5 text-2xs leading-relaxed text-muted">
            Prices are MES — SPX plus the session's ES−SPX basis (our ES 16:00 close − the SPX close; today, the last close
            before it), rounded to the {MES_TICK} tick; hover a price for the SPX level. Points are scored on SPX 1-minute bars
            by the same engine as the backtest (conservative inside a bar), so MES-vs-SPX drift inside a trade is not in them. Completed sessions are frozen into the record the next time
            this page is opened; a session first read after its 1-minute bars aged out (about 30 days) is scored on 5-minute
            samples and marked 5m.
          </p>
        </>
      )}
    </Card>
  )
}

// ── the numbers ─────────────────────────────────────────────────────────────

function summarizeFwd(trades: FwdTrade[], mes: FwdMes, taken: Record<string, true>) {
  let bounce = 0
  let brk = 0
  let open = 0
  let pts = 0
  let net = 0
  let peak = 0
  let maxDd = 0
  let takenN = 0
  let takenNet = 0
  for (const t of trades) {
    if (t.result === 'bounce') bounce++
    else if (t.result === 'break') brk++
    else open++
    pts += t.exit
    const d = tradeDollars(t, mes)
    net += d
    peak = Math.max(peak, net)
    maxDd = Math.max(maxDd, peak - net)
    if (taken[t.id]) {
      takenN++
      takenNet += d
    }
  }
  const n = trades.length
  return {
    n,
    bounce,
    brk,
    open,
    winOfResolved: bounce + brk ? (bounce / (bounce + brk)) * 100 : null,
    ptsPerFill: n ? pts / n : null,
    net: n ? net : null,
    perTrade: n ? net / n : null,
    maxDd,
    takenN,
    takenNet,
  }
}

/** The backtest's points per fill as MES dollars at these settings; slip charged on the share that did not bounce. */
function expectedDollars(b: FwdBaseline, mes: FwdMes): number | null {
  if (b.ptsPerFill == null) return null
  const nonBounce = b.bouncePct == null ? 1 : 1 - b.bouncePct / 100
  return ((b.ptsPerFill - nonBounce * mes.slip * MES_TICK) * MES_PER_PT - mes.fees) * mes.contracts
}

// ── the order ticket ────────────────────────────────────────────────────────

function Ticket({ lock, today, live, mes }: { lock: FwdLock; today: FwdToday | null; live: FwdTrade[]; mes: FwdMes }) {
  const body = useMemo(() => ticketOf(lock, today, live, mes), [lock, today, live, mes])
  if (!body) return null
  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border px-3 py-2"
      style={{ borderColor: alpha(body.color, 0.45), background: alpha(body.color, 0.06) }}
    >
      <span
        className="tabular rounded-sm px-1.5 py-0.5 font-mono text-xs font-extrabold tracking-wide"
        style={{ background: body.color, color: T.bg }}
      >
        {body.badge}
      </span>
      {body.main ? <span className="tabular font-mono text-sm font-semibold text-fg">{body.main}</span> : null}
      {body.detail ? <span className="tabular font-mono text-2xs text-muted">{body.detail}</span> : null}
      <span className="tabular ml-auto font-mono text-2xs text-faint">{body.context}</span>
    </div>
  )
}

type TicketBody = { badge: string; color: string; main: string | null; detail: string | null; context: string }

function ticketOf(lock: FwdLock, today: FwdToday | null, live: FwdTrade[], mes: FwdMes): TicketBody | null {
  const now = etNow()
  if (!today) {
    return inSessionET()
      ? { badge: 'WAITING', color: T.text, main: null, detail: 'No CORE recorded for SPX yet today.', context: `${hhmm(now.mins)} ET` }
      : null
  }
  const { day, all, last } = today
  if (!last) return { badge: 'WAITING', color: T.text, main: null, detail: 'No SPX 1-minute bars yet today.', context: day.date }
  const p = lock.rules.params
  const lv = levelsAt(day, last.mins)
  const basis = today.basis?.basis ?? null
  const context =
    `${hhmm(last.mins)} ET · SPX ${wallNum(last.c)}` +
    (today.basis ? ` · MES ≈ ${wallNum(toTick(last.c + today.basis.basis))} · basis ${signed(today.basis.basis)} (${today.basis.date} close)` : ' · no basis — SPX prices')
  const closed = last.mins >= 16 * 60 - 1 || day.date !== now.date || !inSessionET()
  if (lv.core == null) return { badge: 'NO CORE', color: T.text, main: null, detail: 'Nothing recorded at this slot.', context }

  const core = lv.core
  const stopPts = p.stopStrikes * p.strike
  const px = (spx: number) => (basis == null ? `${wallNum(spx)} SPX` : wallNum(toTick(spx + basis)))

  // A trade on under the locked rules — or, once the session is over, the one
  // the close marked out.
  const on = live.find((t) => t.result === 'open' && t.exitMins >= last.mins)
  if (closed) {
    if (!on) return { badge: 'CLOSED', color: T.text, main: null, detail: 'Session over — nothing resting.', context }
    const d = tradeDollars(on, mes)
    return {
      badge: 'CLOSED',
      color: T.text,
      main: null,
      detail: `Session over — the ${on.side === 'support' ? 'LONG' : 'SHORT'} from ${px(on.entryPx)} was marked out at the ${hhmm(on.exitMins)} close, ${usd(d)}.`,
      context,
    }
  }
  if (on) {
    const up = on.side === 'support'
    const now$ = tradeDollars({ exit: up ? last.c - on.entryPx : on.entryPx - last.c, result: 'open' }, mes)
    return {
      badge: `IN ${up ? 'LONG' : 'SHORT'}`,
      color: up ? T.green : T.red,
      main: `${mes.contracts} MES from ${px(on.entryPx)}`,
      detail: `TP ${px(on.target)} · SL ${px(on.stopPx)} · open ${usd(now$)} at market`,
      context,
    }
  }

  // The engine still walking a fill the rules skip — it takes no new one until that resolves.
  const busy = all.find((e) => e.exitMins >= last.mins && e.result === 'open')
  if (busy) {
    return {
      badge: 'SKIP',
      color: T.text,
      main: null,
      detail: `A ${busy.side === 'support' ? 'CORE-below' : 'CORE-above'} hit at ${hhmm(busy.mins)} the locked rules skip is still running — no new order until it resolves.`,
      context,
    }
  }

  const zone = p.entryPts
  const dir: 1 | -1 | 0 = last.c > core + zone ? 1 : last.c < core - zone ? -1 : 0
  const where = `CORE ${wallStrike(core)} ${dir > 0 ? 'below' : dir < 0 ? 'above' : 'at'} price`
  if (dir === 0) {
    return { badge: 'AT CORE', color: LEVEL_COLORS.cb, main: where, detail: 'Price is inside the entry — no order until it leaves and comes back.', context }
  }
  const side = dir > 0 ? 'support' : 'resistance'
  if (lock.rules.approach !== 'both' && lock.rules.approach !== side) {
    return {
      badge: 'NO TRADE',
      color: T.text,
      main: where,
      detail: `The locked rules take ${lock.rules.approach === 'support' ? 'CORE-below (long)' : 'CORE-above (short)'} hits only.`,
      context,
    }
  }
  if (lock.rules.touches === 'first' && all.some((e) => e.core === core)) {
    return { badge: 'NO TRADE', color: T.text, main: where, detail: 'Already hit today — the locked rules take the 1st hit only.', context }
  }
  // Re-arm: after a fill, price has to CLOSE a strike (or 2× the entry) away first.
  const prev = all.filter((e) => e.core === core).pop()
  if (prev) {
    const rearm = Math.max(2 * p.entryPts, p.strike)
    const bars = day.bars ?? []
    const armed = bars.some((b) => b.mins > prev.exitMins && Math.abs(b.c - core) >= rearm)
    if (!armed) {
      return {
        badge: 'RE-ARMING',
        color: T.text,
        main: where,
        detail: `Filled at ${hhmm(prev.mins)}; the next order needs a close ${wallNum(rearm, 0)} pts away from the CORE first.`,
        context,
      }
    }
  }
  const wall = targetWall(core, dir, lv.cw, lv.pw, p)
  if (!wall) {
    return { badge: 'NO TRADE', color: T.text, main: where, detail: `No ${dir > 0 ? 'call wall above' : 'put wall below'} far enough to bounce to.`, context }
  }
  const entry = core + dir * p.entryPts
  const target = core + dir * Math.abs(wall.v - core) * p.wallFrac
  const stop = core - dir * stopPts
  const reward$ = tradeDollars({ exit: Math.abs(target - entry), result: 'bounce' }, mes)
  const risk$ = tradeDollars({ exit: -(stopPts + p.entryPts), result: 'break' }, mes)
  return {
    badge: dir > 0 ? 'BUY LIMIT' : 'SELL LIMIT',
    color: dir > 0 ? T.green : T.red,
    main: `${mes.contracts} MES @ ${px(entry)}`,
    detail:
      `TP ${px(target)} (${fracLabel(p.wallFrac)} to ${wall.kind === 'call' ? 'CW' : 'PW'} ${wallStrike(wall.v)}) · SL ${px(stop)} · ` +
      `${usd(reward$)} / ${usd(risk$)}${p.holdMin != null ? ` · out at market ${p.holdMin < 60 ? `${p.holdMin}m` : `${p.holdMin / 60}h`} after the fill` : ''} · ${where}`,
    context,
  }
}

// ── the log ─────────────────────────────────────────────────────────────────

const RESULT_LABEL = { bounce: 'BOUNCE', break: 'BREAK', open: 'OPEN' } as const
const RESULT_CLASS = { bounce: 'text-up', break: 'text-down', open: 'text-muted' } as const

function columns(
  mes: FwdMes,
  taken: Record<string, true>,
  liveIds: Set<string>,
  onToggle: (id: string) => void,
  onOpenSession: (date: string) => void,
): Column<FwdTrade>[] {
  const price = (spx: number, t: FwdTrade) => {
    const m = mesOf(spx, t.basis)
    return (
      <span title={`SPX ${wallNum(spx)}${t.basis != null ? ` · basis ${signed(t.basis)}` : ' · no basis for this session'}`}>
        {m == null ? <span className="text-muted">{wallNum(spx)}*</span> : mesNum(m)}
      </span>
    )
  }
  return [
    {
      key: 'date',
      header: 'Session',
      cell: (t) => (
        <button
          type="button"
          onClick={() => onOpenSession(t.date)}
          title="Open this session on the Log tab"
          className="tabular font-mono text-xs text-fg underline decoration-line underline-offset-2 hover:decoration-fg"
        >
          {t.date}
        </button>
      ),
    },
    { key: 'time', header: 'Time', cell: (t) => <span className="tabular font-mono text-xs">{hhmm(t.mins)}</span> },
    {
      key: 'side',
      header: 'Side',
      cell: (t) =>
        t.side === 'support' ? (
          <span className="text-xs font-extrabold text-up" title="CORE below price, touched from above">
            LONG ▲
          </span>
        ) : (
          <span className="text-xs font-extrabold text-down" title="CORE above price, touched from below">
            SHORT ▼
          </span>
        ),
    },
    { key: 'core', header: 'CORE', numeric: true, cell: (t) => wallStrike(t.core) },
    { key: 'in', header: 'Entry · MES', numeric: true, cell: (t) => price(t.entryPx, t) },
    { key: 'tgt', header: 'Target · MES', numeric: true, cell: (t) => price(t.target, t) },
    { key: 'sl', header: 'Stop · MES', numeric: true, cell: (t) => price(t.stopPx, t) },
    {
      key: 'res',
      header: 'Result',
      cell: (t) => (
        <span className={`text-xs font-extrabold tracking-wide ${liveIds.has(t.id) ? 'text-warn' : RESULT_CLASS[t.result]}`}>
          {liveIds.has(t.id) ? 'LIVE' : RESULT_LABEL[t.result]}
          {t.result !== 'open' && t.resolveMin != null ? <span className="font-normal text-muted"> · {Math.round(t.resolveMin)}m</span> : null}
          {t.bars === '5m' ? (
            <span className="font-normal text-muted" title="Scored on 5-minute samples — the 1-minute bars had aged out when this session was read">
              {' '}
              · 5m
            </span>
          ) : null}
        </span>
      ),
    },
    { key: 'pts', header: 'Pts', numeric: true, cell: (t) => <span className={tone(t.exit)}>{signed(t.exit)}</span> },
    {
      key: 'usd',
      header: `$ · ${mes.contracts} MES`,
      numeric: true,
      cell: (t) => {
        const d = tradeDollars(t, mes)
        return <span className={tone(d)}>{usd(d, 2)}</span>
      },
    },
    {
      key: 'took',
      header: 'Took it',
      align: 'center',
      width: '64px',
      cell: (t) => {
        const on = !!taken[t.id]
        return (
          <button
            type="button"
            onClick={() => onToggle(t.id)}
            aria-pressed={on}
            title={on ? 'You took this one — click to unmark' : 'Mark as a trade you actually took'}
            className={`rounded-sm border px-1.5 text-2xs font-semibold transition-colors ${on ? 'border-accent text-accent' : 'border-line text-faint hover:text-fg'}`}
          >
            {on ? '✓' : '—'}
          </button>
        )
      },
    },
  ]
}

// ── the curve ───────────────────────────────────────────────────────────────

const CURVE_H = 160

/** Net dollars trade by trade — the migration chart's paint rules: SVG squashed, words in HTML. */
function DollarCurve({ trades, mes }: { trades: FwdTrade[]; mes: FwdMes }) {
  const model = useMemo(() => {
    let acc = 0
    const ys = [0]
    for (const t of trades) {
      acc += tradeDollars(t, mes)
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
    return { pts: ys.map((v, i) => `${x(i)},${y(v)}`).join(' '), y0: y(0), yEnd: y(acc), end: acc }
  }, [trades, mes])
  const color = model.end >= 0 ? T.green : T.red
  return (
    <div className="flex flex-col">
      <div className="relative" style={{ paddingRight: 72 }}>
        <svg viewBox={`0 0 100 ${CURVE_H}`} height={CURVE_H} preserveAspectRatio="none" style={{ width: '100%', display: 'block' }}>
          <line x1={0} x2={100} y1={model.y0} y2={model.y0} stroke={alpha(T.text, 0.35)} strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <polyline points={`0,${model.y0} ${model.pts} 100,${model.y0}`} fill={alpha(color, 0.08)} stroke="none" />
          <polyline points={model.pts} fill="none" stroke={color} strokeWidth={1.8} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        <div className="pointer-events-none absolute inset-y-0 right-0" style={{ width: 72 }} aria-hidden>
          <span className="tabular absolute font-mono text-2xs text-muted" style={{ left: 8, top: `${(model.y0 / CURVE_H) * 100}%`, transform: 'translateY(-50%)' }}>
            $0
          </span>
          <span
            className={`tabular absolute font-mono text-2xs font-extrabold ${model.end >= 0 ? 'text-up' : 'text-down'}`}
            style={{ left: 8, top: `${(model.yEnd / CURVE_H) * 100}%`, transform: 'translateY(-50%)' }}
          >
            {usd(model.end)}
          </span>
        </div>
      </div>
      <div className="tabular mt-1 flex justify-between font-mono text-2xs text-muted" style={{ paddingRight: 72 }}>
        <span>{trades[0]!.date}</span>
        <span style={{ color: LEVEL_COLORS.cb }}>
          {trades.length} trades · {mes.contracts} MES
        </span>
        <span>{trades[trades.length - 1]!.date}</span>
      </div>
    </div>
  )
}
