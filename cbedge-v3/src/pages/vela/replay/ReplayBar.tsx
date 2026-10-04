// ─────────────────────────────────────────────────────────────────────────────
// THE VELA REPLAY DOCK: the transport for bar replay on /vela. It sits in the
// same bottom bar as every other v3 replay (design/primitives/ReplayDock), with
// the same keys in the same order. The page is Voltick's chart, so the dock wears
// Voltick's replay language: Volt Blue rim and wash (--color-replay), Accent Text
// for the words, the active key filled Volt Blue, every number in mono, captions
// in Paper Quiet (never a dimmed Paper), and green / red on the P&L figures and
// the ▲ ▼ marks only, never on a button face.
//
//   REPLAY  Fri Oct 2 · 13:51 ET  · 120 bars left
//   ◀  ▶/❚❚  ▶    ━━━━●━━━━━━━━   Speed 0.5× 1× 2× 4× 8×   Ticks   Lock axis   Jump   Live
//
//   ◀ / ▶      one bar back / forward. Back re-cuts the history one bar
//              earlier; Vela cannot un-reveal a bar.
//   ▶ / ❚❚     play / pause. 1× is 700 ms a bar, the house pace.
//   Scrubber   jump anywhere in the loaded history (on release).
//   Ticks      on by default. Each candle builds from the finer bars inside it
//              (ticks.ts), so a 5m bar forms over five 1-minute updates the way
//              it did live. Needs a one-chart layout (Vela's rule); with
//              several charts the bars land whole.
//   Lock axis  freezes the price axis so it stops rescaling while you step.
//   Jump       reopens the start picker.
//   Live       leaves replay: the full history comes back and live updates resume.
//
// With ticks on, a bar takes 700 ms × √(ticks) at 1×: a 5m candle about 1.6 s,
// a 30m about 3.8 s. That keeps a 30-update candle readable without dragging.
//
// THE START PICKER (no replay running yet, or Jump): click a bar on any chart.
// That bar becomes the newest one shown. Or use the quick picks: the last
// session's 9:30 open, the session before, the week's first open. Or type a
// date and an ET time, which becomes the first bar revealed. Esc cancels.
//
// KEYS while replaying (Vela's own Shift+arrows are pans, overridden only here):
//   Shift+→ next bar · Shift+← previous bar · Shift+↓ play / pause
//   Shift+B buy · Shift+S sell · Shift+F flat (paper trading)
//
// PAPER TRADING (paper.ts): Buy / Sell / Flat with a quantity, filled at the
// replay price. The dock shows the position, its open P&L and the realized P&L.
// "Trades" opens the log above the dock: every round trip, win rate, profit
// factor, max drawdown, Copy CSV and Reset.
//
// Studies that only know today (Key Levels, GEX Profile) blank themselves while
// replaying, and the dock names them, so nobody reads today's walls on last
// Tuesday's candles.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { timeframeToMs } from '@luxalgo/vela'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { ReplayDock } from '@/design/primitives/ReplayDock'
import { T } from '@/design/theme'
import { etDateKey, etWallMs } from '@/pages/vela/studies/common'
import { LIVE_ONLY } from '@/pages/vela/studies'
import { replayClock } from './clock'
import { closePicker, openPicker, repaint, replayFrom, replayQuote, replayStore } from './replay'
import { paperCsv, paperFlatten, paperOpen, paperOrder, paperReset, paperStats, paperStore, pointValue, type PaperTrade } from './paper'
import { dropTape, nominalTicks, tickSourceFor } from './ticks'

/** ms per BAR at 1×, the same pace as every other v3 transport. */
const BASE_MS = 700
const SPEEDS = [0.5, 1, 2, 4, 8] as const
const OPEN_MIN = 9 * 60 + 30
const DAY_MS = 86_400_000

const QTY_KEY = 'cb-vela-paper-qty'
const SPEED_KEY = 'cb-vela-replay-speed'
const TICKS_KEY = 'cb-vela-replay-ticks'

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writePref(key: string, v: string): void {
  try {
    localStorage.setItem(key, v)
  } catch {
    /* private mode: the choice lasts this visit */
  }
}

const ET_DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' })
const ET_TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false })
const ET_WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' })

/** The weekday before `date` (YYYY-MM-DD). */
function prevWeekday(date: string): string {
  let t = Date.parse(`${date}T12:00:00Z`) - DAY_MS
  while ([0, 6].includes(new Date(t).getUTCDay())) t -= DAY_MS
  return new Date(t).toISOString().slice(0, 10)
}

/** The Monday of `date`'s week. */
function weekStart(date: string): string {
  const t = Date.parse(`${date}T12:00:00Z`)
  const wd = new Date(t).getUTCDay()
  return new Date(t - ((wd + 6) % 7) * DAY_MS).toISOString().slice(0, 10)
}

/** The newest session whose 9:30 open is inside the loaded history. */
function lastSession(last: number): string {
  let d = etDateKey(last)
  if ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay()) || etWallMs(d, OPEN_MIN) > last) d = prevWeekday(d)
  while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = prevWeekday(d)
  return d
}

function TransportButton({
  label,
  title,
  on = false,
  disabled = false,
  onClick,
}: {
  label: string
  title: string
  on?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={on}
      disabled={disabled}
      className="cb-vt-key tabular shrink-0 rounded-sm border px-2 py-1 font-mono text-2xs font-extrabold leading-none"
    >
      {label}
    </button>
  )
}

// The look (Voltick's wash, lit active state, hovers) is vela.css's .cb-vt-* so
// the shared stylesheet does not grow for one lazy dock.
const chip = 'cb-vt-key shrink-0 rounded-sm border px-2 py-1 text-2xs font-semibold'
const field =
  'tabular shrink-0 rounded-sm border border-line bg-bg px-1.5 py-0.5 font-mono text-2xs font-extrabold text-fg outline-none hover:border-accent focus:border-accent'
const replayInk = { color: T.replayText }
/** Voltick's uppercase label: mono, 600, tracked. */
const caps = 'shrink-0 font-mono font-semibold uppercase tracking-[0.08em]'

export default function ReplayBar({ ws }: { ws: VelaWorkspace }) {
  const s = useSyncExternalStore(replayStore.subscribe, replayStore.get)
  const on = s.phase === 'on'
  const st = ws.replay.state
  const bounds = ws.replay.bounds
  const tfMs = timeframeToMs(ws.chart.market.timeframe ?? '5') || 5 * 60_000

  const [speed, setSpeedState] = useState<number>(() => {
    const v = Number(readPref(SPEED_KEY))
    return (SPEEDS as readonly number[]).includes(v) ? v : 1
  })
  const [ticksPref, setTicksPref] = useState<boolean>(() => readPref(TICKS_KEY) !== '0')
  const [lock, setLock] = useState(false)
  const [cells, setCells] = useState(() => ws.cells().length)
  const [scrub, setScrub] = useState<number | null>(null)
  const solo = cells === 1
  const ticks = ticksPref && solo

  // ── how many charts: tick replay is a one-chart feature ──
  useEffect(() => {
    const upd = () => setCells(ws.cells().length)
    const offs = [ws.on('cell:created', upd), ws.on('cell:destroyed', upd), ws.on('layout:changed', upd)]
    return () => {
      for (const off of offs) off()
    }
  }, [ws])

  // ── the tick source, on the one chart ──
  useEffect(() => {
    if (!on) return
    const list = ws.cells()
    if (ticks && list.length === 1) list[0]!.chart.replay.setTicks(tickSourceFor(list[0]!.chart))
    else for (const c of list) c.chart.replay.setTicks(null)
    return () => {
      for (const c of ws.cells()) c.chart.replay.setTicks(null)
    }
  }, [ws, on, ticks, cells])

  useEffect(() => () => dropTape(), [])

  // ── pace ──
  // Vela's interval is per UPDATE: a bar with ticks, a tick without. The tick count
  // is only known once a bar's ticks land, so the pace is re-set when it changes.
  const count = useRef(nominalTicks(tfMs))
  const intervalFor = useCallback(
    (n: number) => {
      if (!ticks) return BASE_MS / speed
      const k = Math.max(1, n)
      return Math.max(16, (BASE_MS * Math.sqrt(k)) / speed / k)
    },
    [ticks, speed],
  )
  useEffect(() => {
    count.current = nominalTicks(tfMs)
  }, [tfMs])
  useEffect(() => {
    if (ws.replay.state.playing) ws.replay.play(intervalFor(count.current))
  }, [ws, intervalFor])
  useEffect(
    () =>
      ws.replay.on('replay:tick', ({ index, count: n }) => {
        if (index !== 0 || n === count.current) return
        count.current = n
        if (ws.replay.state.playing) ws.replay.play(intervalFor(n))
      }),
    [ws, intervalFor],
  )

  // ── the price axis lock ──
  useEffect(() => {
    if (!on || !lock) return
    const touched = ws.cells().map((c) => {
      const was = c.chart.renderer.get('autoScale') !== false
      if (was) c.chart.renderer.set('autoScale', false)
      return { chart: c.chart, was }
    })
    return () => {
      for (const t of touched) if (t.was) t.chart.renderer.set('autoScale', true)
    }
  }, [ws, on, lock, cells])
  useEffect(() => {
    if (!on) setLock(false)
  }, [on])

  // ── the keys ──
  const togglePlay = useCallback(() => {
    if (ws.replay.state.playing) ws.replay.pause()
    else ws.replay.play(intervalFor(count.current))
  }, [ws, intervalFor])
  const stepFwd = useCallback(() => {
    if (ws.replay.state.playing) ws.replay.pause()
    ws.replay.step()
  }, [ws])
  const stepBack = useCallback(() => {
    const ct = ws.replay.state.cursorTime
    const b = ws.replay.bounds
    if (ct == null || (b && ct <= b.first)) return
    void replayFrom(ct - 1)
  }, [ws])
  // ── paper trading ──
  useSyncExternalStore(paperStore.subscribe, paperStore.version)
  const paper = paperStore.get()
  const [qty, setQtyState] = useState<number>(() => Math.max(1, Math.min(999, Math.round(Number(readPref(QTY_KEY)) || 1))))
  const [showLog, setShowLog] = useState(false)
  const setQty = (v: number) => {
    const q = Math.max(1, Math.min(999, Math.round(v) || 1))
    setQtyState(q)
    writePref(QTY_KEY, String(q))
  }
  const order = useCallback(
    (side: 1 | -1) => {
      const q = replayQuote()
      if (!q) return
      paperOrder(q.sym, side * qty, q.price, q.t)
      repaint()
    },
    [qty],
  )
  const buy = useCallback(() => order(1), [order])
  const sell = useCallback(() => order(-1), [order])
  const flat = useCallback(() => {
    const q = replayQuote()
    if (!q) return
    paperFlatten(q.price, q.t)
    repaint()
  }, [])
  const keys = useRef({ togglePlay, stepFwd, stepBack, buy, sell, flat })
  keys.current = { togglePlay, stepFwd, stepBack, buy, sell, flat }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      const snap = replayStore.get()
      if (e.key === 'Escape' && snap.picking) {
        e.preventDefault()
        closePicker()
        return
      }
      if (snap.phase !== 'on' || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
      const k = keys.current
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      const run =
        key === 'ArrowRight' ? k.stepFwd : key === 'ArrowLeft' ? k.stepBack : key === 'ArrowDown' ? k.togglePlay : key === 'b' ? k.buy : key === 's' ? k.sell : key === 'f' ? k.flat : null
      if (!run) return
      e.preventDefault()
      e.stopPropagation()
      run()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  // ── the scrubber commits on a pause in the drag ──
  const scrubTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (scrubTimer.current) clearTimeout(scrubTimer.current)
  }, [])
  const onScrub = (v: number) => {
    setScrub(v)
    if (scrubTimer.current) clearTimeout(scrubTimer.current)
    scrubTimer.current = setTimeout(() => {
      scrubTimer.current = null
      const b = ws.replay.bounds
      const at = b ? Math.min(v, b.last - tfMs) : v
      void replayFrom(at).finally(() => setScrub(null))
    }, 250)
  }

  const setSpeed = (v: number) => {
    setSpeedState(v)
    writePref(SPEED_KEY, String(v))
  }
  const toggleTicks = () => {
    const next = !ticksPref
    setTicksPref(next)
    writePref(TICKS_KEY, next ? '1' : '0')
  }

  // ── the start picker's quick picks (the 9:30 opens in the loaded history) ──
  const last = bounds?.last ?? Date.now()
  const day0 = lastSession(last)
  const day1 = prevWeekday(day0)
  const dayW = weekStart(day0)
  const [date, setDate] = useState(day0)
  const [time, setTime] = useState('09:30')
  const openOf = (d: string) => etWallMs(d, OPEN_MIN)
  const quick = [
    { label: `Last open · ${ET_WEEKDAY.format(new Date(openOf(day0)))} 9:30`, day: day0 },
    { label: `Prior open · ${ET_WEEKDAY.format(new Date(openOf(day1)))} 9:30`, day: day1 },
    ...(dayW !== day0 && dayW !== day1 ? [{ label: `Week open · ${ET_WEEKDAY.format(new Date(openOf(dayW)))} 9:30`, day: dayW }] : []),
  ]
  // the open becomes the first bar revealed: keep everything before it
  const fromOpen = (d: string) => void replayFrom(openOf(d) - 1)
  const fromTyped = () => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(time)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !m) return
    void replayFrom(etWallMs(date, Number(m[1]) * 60 + Number(m[2])) - 1)
  }

  const clock = replayClock()
  const at = Number.isFinite(clock) ? clock : st.cursorTime != null ? st.cursorTime + tfMs : null
  const hidden = on
    ? [...new Set(ws.cells().flatMap((c) => c.chart.indicators().map((h) => (h.nativeType ? LIVE_ONLY[h.nativeType] : undefined))))].filter(
        (x): x is string => !!x,
      )
    : []

  const label = (
    <span className={`${caps} text-2xs`} style={{ color: T.replayText }}>
      Replay
    </span>
  )

  if (s.picking) {
    return (
      <ReplayDock>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs">
          {label}
          <span className="shrink-0 font-semibold text-fg">Click a bar on the chart to replay from it</span>
          <span className="shrink-0 text-2xs text-faint">or</span>
          <span className="flex shrink-0 flex-wrap items-center gap-1">
            {quick.map((q) => (
              <button key={q.label} type="button" className={chip} onClick={() => fromOpen(q.day)} title="Start at that session's 9:30 ET open">
                {q.label}
              </button>
            ))}
          </span>
          <span className="flex shrink-0 items-center gap-1" title="The first bar to reveal, ET">
            <input type="date" className={field} value={date} max={etDateKey(last)} onChange={(e) => setDate(e.target.value)} aria-label="Replay date" />
            <input type="time" className={field} value={time} onChange={(e) => setTime(e.target.value)} aria-label="Replay time, ET" />
            <span className="font-mono text-2xs text-faint">ET</span>
            <TransportButton label="Go" title="Start the replay at that date and time" onClick={fromTyped} />
          </span>
          {s.note && (
            <span className="shrink-0 text-2xs font-semibold" style={replayInk}>
              {s.note}
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <span className="hidden text-2xs text-faint sm:inline">Esc to cancel</span>
            <button type="button" className={chip} onClick={closePicker} title={on ? 'Back to the replay' : 'Close the picker'}>
              {on ? 'Back' : 'Cancel'}
            </button>
          </span>
        </div>
      </ReplayDock>
    )
  }

  if (!on) return null

  const first = bounds?.first ?? 0
  const lastBar = bounds?.last ?? 0
  const pos = scrub ?? st.cursorTime ?? lastBar

  return (
    <ReplayDock>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs">
        {label}
        {/* The clock: the one place the cursor is stated as a time. */}
        <span className="tabular shrink-0 font-mono font-extrabold text-fg" title="How far the replay has got, ET">
          {at != null ? `${ET_DAY.format(new Date(at))} · ${ET_TIME.format(new Date(at))} ET` : '--:--'}
        </span>
        <span className="tabular shrink-0 font-mono text-2xs text-faint">
          {st.remaining === 1 ? '1 bar left' : `${st.remaining.toLocaleString()} bars left`}
        </span>

        <span className="flex shrink-0 items-center gap-1">
          <TransportButton label="◀" title="Previous bar (Shift+←)" disabled={st.cursorTime == null || st.cursorTime <= first} onClick={stepBack} />
          <TransportButton label={st.playing ? '❚❚' : '▶'} title="Play / pause (Shift+↓)" on={st.playing} disabled={st.remaining === 0} onClick={togglePlay} />
          <TransportButton label="▶" title="Next bar (Shift+→)" disabled={st.remaining === 0} onClick={stepFwd} />
        </span>

        <input
          type="range"
          min={first}
          max={lastBar}
          step={tfMs}
          value={Math.max(first, Math.min(lastBar, pos))}
          disabled={!bounds || lastBar <= first}
          onChange={(e) => onScrub(Number(e.target.value))}
          className="h-1 min-w-[140px] flex-1 cursor-pointer"
          style={{ accentColor: T.replay }}
          aria-label="Replay position"
          title="Drag to jump anywhere in the loaded history"
        />

        <span className="flex shrink-0 items-center gap-1">
          <span className={`${caps} text-3xs text-faint`}>Speed</span>
          {SPEEDS.map((v) => (
            <TransportButton key={v} label={`${v}×`} title={`Play at ${v}×`} on={speed === v} onClick={() => setSpeed(v)} />
          ))}
        </span>

        <TransportButton
          label="Ticks"
          title={
            solo
              ? ticks
                ? 'Candles build tick by tick from the finer bars inside them. Click to reveal whole bars.'
                : 'Build each candle tick by tick from the finer bars inside it'
              : 'Tick-by-tick needs a one-chart layout. With several charts, bars are revealed whole.'
          }
          on={ticks}
          disabled={!solo}
          onClick={toggleTicks}
        />

        <TransportButton
          label="Lock axis"
          on={lock}
          onClick={() => setLock((v) => !v)}
          title={
            lock
              ? 'Price axis locked. Only the candles change as you step. Click to let it autoscale again.'
              : 'Lock the price axis so it stops rescaling as bars are revealed'
          }
        />

        <PaperKeys
          qty={qty}
          setQty={setQty}
          onBuy={buy}
          onSell={sell}
          onFlat={flat}
          showLog={showLog}
          toggleLog={() => setShowLog((v) => !v)}
          pos={paper.pos}
          avg={paper.avg}
          sym={paper.sym}
          trades={paper.trades}
        />
        {showLog && <PaperLog trades={paper.trades} onClose={() => setShowLog(false)} />}

        {hidden.length > 0 && (
          <span className="shrink-0 text-2xs text-faint" title="These studies read today's numbers only, so they blank while you replay">
            {hidden.join(' · ')} hidden (live only)
          </span>
        )}
        {s.note && (
          <span className="shrink-0 text-2xs font-semibold" style={replayInk}>
            {s.note}
          </span>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-2">
          <button type="button" className={chip} onClick={openPicker} title="Pick another start: click a bar, a session open, or a date and time">
            Jump
          </button>
          <button type="button" className={chip} onClick={() => ws.replay.stop()} title="Leave replay and return to the live chart">
            Live
          </button>
        </span>
      </div>
    </ReplayDock>
  )
}

// ── Paper trading ────────────────────────────────────────────────────────────

const usd = (v: number) => {
  const a = Math.abs(v)
  const d = a < 100 && a > 0 ? 2 : 0
  return `${v < 0 ? '−' : v > 0 ? '+' : ''}$${a.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
}
const signed = (v: number) => `${v < 0 ? '−' : v > 0 ? '+' : ''}${Math.abs(v).toFixed(2)}`
const tone = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-fg')

function PaperKeys(p: {
  qty: number
  setQty: (v: number) => void
  onBuy: () => void
  onSell: () => void
  onFlat: () => void
  showLog: boolean
  toggleLog: () => void
  pos: number
  avg: number
  sym: string | null
  trades: readonly PaperTrade[]
}) {
  const q = replayQuote()
  const open = q ? paperOpen(q.price) : { pts: 0, usd: 0 }
  const realized = p.trades.reduce((t, x) => t + x.usd, 0)
  // Voltick's Chip: the body and the word stay Paper, the direction rides on the
  // mark alone (▲ green, ▼ red). Green / red are data on this page, never a face.
  const key = 'cb-vt-key tabular inline-flex shrink-0 items-center gap-1 rounded-sm border px-2 py-1 font-mono text-2xs font-extrabold leading-none'
  return (
    <span className="flex shrink-0 items-center gap-1" title="Paper trading: market orders fill at the replay price">
      <button type="button" className={key} onClick={p.onBuy} disabled={!q} title="Buy at the replay price (Shift+B)">
        <span className="text-up">▲</span>Buy
      </button>
      <button type="button" className={key} onClick={p.onSell} disabled={!q} title="Sell at the replay price (Shift+S)">
        <span className="text-down">▼</span>Sell
      </button>
      <button type="button" className={key} onClick={p.onFlat} disabled={!p.pos} title="Close the position (Shift+F)">
        Flat
      </button>
      <input
        type="number"
        min={1}
        max={999}
        value={p.qty}
        onChange={(e) => p.setQty(Number(e.target.value))}
        aria-label="Order quantity"
        title="Order quantity"
        className="tabular w-12 shrink-0 rounded-sm border border-line bg-raised px-1 py-0.5 font-mono text-2xs font-extrabold text-fg outline-none focus:border-accent"
      />
      <span className="tabular shrink-0 font-mono text-2xs">
        {p.pos ? (
          <>
            <span className={p.pos > 0 ? 'text-up' : 'text-down'}>{p.pos > 0 ? '▲' : '▼'}</span>
            <span className="text-fg">
              {' '}
              {p.pos > 0 ? 'Long' : 'Short'} {Math.abs(p.pos)}
            </span>
            <span className="text-faint"> @ {p.avg.toFixed(2)} </span>
            <span className={tone(open.pts)} title={`${signed(open.pts)} points × $${pointValue(p.sym ?? '')}`}>
              {usd(open.usd)}
            </span>
          </>
        ) : (
          <span className="text-faint">Flat</span>
        )}
        <span className="text-faint"> · Day </span>
        <span className={tone(realized)}>{usd(realized)}</span>
      </span>
      <button
        type="button"
        onClick={p.toggleLog}
        aria-pressed={p.showLog}
        className={chip}
        title="The paper trade log"
      >
        Trades{p.trades.length ? ` (${p.trades.length})` : ''}
      </button>
    </span>
  )
}

/** One figure in the log's header: a Paper Quiet caption, the number in mono. */
function Stat({ label, cls = 'text-fg', children }: { label: string; cls?: string; children: React.ReactNode }) {
  return (
    <span className="flex items-baseline gap-1 text-2xs">
      <span className="text-faint">{label}</span>
      <span className={`tabular font-mono font-extrabold ${cls}`}>{children}</span>
    </span>
  )
}

const LOG_TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

function PaperLog({ trades, onClose }: { trades: readonly PaperTrade[]; onClose: () => void }) {
  const [sure, setSure] = useState(false)
  const [copied, setCopied] = useState(false)
  const st = paperStats(trades)
  const rows = trades.slice().reverse()
  const copy = () => {
    void navigator.clipboard?.writeText(paperCsv(trades)).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => {},
    )
  }
  return (
    <div
      className="cb-paper-log cb-vt-pop absolute bottom-full right-4 z-50 mb-2 flex max-h-[340px] w-[min(560px,calc(100vw-32px))] flex-col rounded-lg border border-line text-xs"
      role="dialog"
      aria-label="Paper trades"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2">
        <span className={`${caps} text-2xs`} style={{ color: T.replayText }}>
          Paper trades
        </span>
        <Stat label="Trades">{st.n}</Stat>
        <Stat label="Win">{st.n ? Math.round((st.wins / st.n) * 100) : 0}%</Stat>
        <Stat label="Net" cls={tone(st.net)}>
          {usd(st.net)}
        </Stat>
        <Stat label="PF">{Number.isFinite(st.pf) ? st.pf.toFixed(2) : '∞'}</Stat>
        <Stat label="Max DD">{usd(-st.maxDd)}</Stat>
        <Stat label="Avg">
          {usd(st.avgWin)} / {usd(-st.avgLoss)}
        </Stat>
        <button type="button" onClick={onClose} className="cb-vt-x ml-auto cursor-pointer text-fg" aria-label="Close">
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="px-3 py-4 text-2xs text-faint">No paper trades yet. Buy or Sell while the replay runs.</div>
        ) : (
          <table className="tabular w-full font-mono text-2xs">
            <tbody>
              {rows.map((t, k) => (
                <tr key={`${t.exitT}-${k}`} className="border-b border-line/50">
                  <td className="px-3 py-1 text-faint">{LOG_TIME.format(new Date(t.entryT))}</td>
                  <td className="py-1 text-fg">
                    <span className={t.dir > 0 ? 'text-up' : 'text-down'}>{t.dir > 0 ? '▲' : '▼'}</span> {t.dir > 0 ? 'Long' : 'Short'} {t.qty} {t.sym}
                  </td>
                  <td className="py-1 text-fg">
                    {t.entry.toFixed(2)} → {t.exit.toFixed(2)}
                  </td>
                  <td className={`py-1 text-right ${tone(t.pts)}`}>{signed(t.pts)}</td>
                  <td className={`px-3 py-1 text-right font-extrabold ${tone(t.usd)}`}>{usd(t.usd)}</td>
                  <td className="pr-3 py-1 text-faint">{t.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2">
        <button type="button" onClick={copy} disabled={!trades.length} className={chip}>
          {copied ? 'Copied' : 'Copy CSV'}
        </button>
        <button
          type="button"
          onClick={() => {
            if (!sure) {
              setSure(true)
              setTimeout(() => setSure(false), 2500)
              return
            }
            paperReset()
            repaint()
            setSure(false)
          }}
          className={chip}
          title="Clear the log, the realized P&L and any open position"
        >
          {sure ? 'Click again to reset' : 'Reset'}
        </button>
        <span className="ml-auto text-2xs text-faint">Kept in this browser</span>
      </div>
    </div>
  )
}
