// ─────────────────────────────────────────────────────────────────────────────
// THE VELA REPLAY DOCK: the transport for bar replay on /vela. It sits in the
// same orange bottom bar as every other v3 replay (design/primitives/ReplayDock),
// with the same keys in the same order:
//
//   REPLAY  Fri Oct 2 · 13:51 ET  · 120 bars left
//   ◀  ▶/❚❚  ▶    ━━━━●━━━━━━━━   Speed 0.5× 1× 2× 4× 8×   Ticks   🔒 Axis   Jump   Live
//
//   ◀ / ▶      one bar back / forward. Back re-cuts the history one bar
//              earlier; Vela cannot un-reveal a bar.
//   ▶ / ❚❚     play / pause. 1× is 700 ms a bar, the house pace.
//   Scrubber   jump anywhere in the loaded history (on release).
//   Ticks      on by default. Each candle builds from the finer bars inside it
//              (ticks.ts), so a 5m bar forms over five 1-minute updates the way
//              it did live. Needs a one-chart layout (Vela's rule); with
//              several charts the bars land whole.
//   🔒 Axis    freezes the price axis so it stops rescaling while you step.
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
//
// Studies that only know today (Key Levels, GEX Profile) blank themselves while
// replaying, and the dock names them, so nobody reads today's walls on last
// Tuesday's candles.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { timeframeToMs } from '@luxalgo/vela'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { ReplayDock, ReplayLock } from '@/design/primitives/ReplayDock'
import { T } from '@/design/theme'
import { etDateKey, etWallMs } from '@/pages/vela/studies/common'
import { LIVE_ONLY } from '@/pages/vela/studies'
import { replayClock } from './clock'
import { closePicker, openPicker, replayFrom, replayStore } from './replay'
import { dropTape, nominalTicks, tickSourceFor } from './ticks'

/** ms per BAR at 1×, the same pace as every other v3 transport. */
const BASE_MS = 700
const SPEEDS = [0.5, 1, 2, 4, 8] as const
const OPEN_MIN = 9 * 60 + 30
const DAY_MS = 86_400_000

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
      className={[
        'tabular shrink-0 rounded-sm border px-2 py-0.5 font-mono text-2xs font-extrabold leading-none',
        on ? 'border-transparent text-bg' : 'border-line text-fg hover:bg-raised',
        disabled ? 'cursor-default opacity-40' : 'cursor-pointer',
      ].join(' ')}
      style={on ? { background: T.orange } : undefined}
    >
      {label}
    </button>
  )
}

const chip =
  'shrink-0 cursor-pointer rounded-sm border border-line px-2 py-0.5 text-2xs font-semibold tracking-wide text-muted hover:bg-raised hover:text-fg'
const field =
  'tabular shrink-0 rounded-sm border border-line bg-raised px-1.5 py-0.5 font-mono text-2xs font-extrabold text-fg outline-none hover:border-accent focus:border-accent'

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
  const keys = useRef({ togglePlay, stepFwd, stepBack })
  keys.current = { togglePlay, stepFwd, stepBack }
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
      const run = e.key === 'ArrowRight' ? k.stepFwd : e.key === 'ArrowLeft' ? k.stepBack : e.key === 'ArrowDown' ? k.togglePlay : null
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
    <span className="shrink-0 font-black uppercase tracking-[0.1em]" style={{ color: T.orange }}>
      Replay
    </span>
  )

  if (s.picking) {
    return (
      <ReplayDock>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs">
          {label}
          <span className="shrink-0 font-semibold text-fg">Click a bar on the chart to replay from it</span>
          <span className="shrink-0 text-2xs text-muted opacity-70">or</span>
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
            <span className="text-2xs text-muted opacity-70">ET</span>
            <TransportButton label="Go" title="Start the replay at that date and time" onClick={fromTyped} />
          </span>
          {s.note && <span className="shrink-0 text-2xs font-semibold text-warn">{s.note}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <span className="hidden text-2xs text-muted opacity-60 sm:inline">Esc to cancel</span>
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
        <span className="shrink-0 text-2xs text-muted opacity-70">
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
          className="h-1 min-w-[140px] flex-1 cursor-pointer accent-[var(--color-warn)]"
          aria-label="Replay position"
          title="Drag to jump anywhere in the loaded history"
        />

        <span className="flex shrink-0 items-center gap-1">
          <span className="text-2xs font-bold text-muted opacity-60">Speed</span>
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

        <ReplayLock
          on={lock}
          onClick={() => setLock((v) => !v)}
          title={
            lock
              ? 'Price axis locked. Only the candles change as you step. Click to let it autoscale again.'
              : 'Lock the price axis so it stops rescaling as bars are revealed'
          }
        />

        {hidden.length > 0 && (
          <span className="shrink-0 text-2xs text-muted opacity-70" title="These studies read today's numbers only, so they blank while you replay">
            {hidden.join(' · ')} hidden (live only)
          </span>
        )}
        {s.note && <span className="shrink-0 text-2xs font-semibold text-warn">{s.note}</span>}

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
