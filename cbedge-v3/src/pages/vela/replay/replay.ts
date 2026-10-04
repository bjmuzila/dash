// ─────────────────────────────────────────────────────────────────────────────
// BAR REPLAY: the toolbar button, the start picker, and the state the replay
// dock reads.
//
// Vela ships the replay engine (`workspace.replay`) but no controls for it:
// rewind to a bar, reveal the bars after it one at a time or tick by tick, keep
// every chart in a layout on one clock, and pause live updates while doing so.
// This file adds what the user touches:
//
//   ▸ Replay       a toolbar button (left cluster, after Indicators; on the
//                  phone, a stop on the bottom bar). It opens the START PICKER.
//   ▸ The picker   an orange line follows the pointer over the chart and shades
//                  the bars that will be hidden. Click a bar to rewind to it. A
//                  drag still pans, so you can scroll back to the day you want.
//                  The dock also offers session-open quick picks and a date/time.
//   ▸ The dock     ReplayBar.tsx, the same orange bottom bar every v3 replay
//                  uses (design/primitives/ReplayDock.tsx). It loads lazily
//                  through ReplayHost.tsx, so this page's chunk carries only
//                  this file.
//
// Clicking the button again cancels the picker, and while replaying it opens
// the picker again to jump somewhere else.
//
// The replay clock (clock.ts) moves on every reveal, so the CB studies can tell
// what had already happened.
// ─────────────────────────────────────────────────────────────────────────────

import { registerWidgetAction, timeframeToMs, type OHLCV, type WidgetContext } from '@luxalgo/vela'
import { registerRendererLayer, type RendererLayerArgs, type RendererLayerInstance } from '@luxalgo/vela/plugin'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { tokenRgb, type RGB } from '@/design/theme'
import { clearTickEnds, setReplayClock, tickEnd } from './clock'

export type ReplayPhase = 'off' | 'on'

export interface ReplaySnap {
  phase: ReplayPhase
  /** The start picker is open (before a replay, or to jump during one). */
  picking: boolean
  /** One line for the dock: why a pick did nothing, or how the last replay ended. */
  note: string
  /** Bumped on every replay event so the dock re-reads `workspace.replay.state`. */
  v: number
}

let snap: ReplaySnap = { phase: 'off', picking: false, note: '', v: 0 }
const subs = new Set<() => void>()

function set(p: Partial<ReplaySnap>): void {
  snap = { ...snap, ...p, v: snap.v + 1 }
  for (const fn of subs) fn()
}

/** For useSyncExternalStore. */
export const replayStore = {
  get: (): ReplaySnap => snap,
  subscribe(fn: () => void): () => void {
    subs.add(fn)
    return () => {
      subs.delete(fn)
    }
  },
}

let ws: VelaWorkspace | null = null
let lastCtx: WidgetContext | null = null

const tfMsOf = (w: VelaWorkspace): number => timeframeToMs(w.chart.market.timeframe ?? '5') || 60_000

/** Follow the workspace's replay. Call once per workspace, from the page. */
export function bindReplay(w: VelaWorkspace): () => void {
  ws = w
  const r = w.replay
  const offs = [
    r.on('replay:start', ({ cursorTime }) => {
      setReplayClock(true, cursorTime + tfMsOf(w))
      set({ phase: 'on', picking: false, note: '' })
    }),
    r.on('replay:step', ({ cursorTime }) => {
      setReplayClock(true, cursorTime + tfMsOf(w))
      set({})
    }),
    r.on('replay:tick', ({ cursorTime, index, count }) => {
      setReplayClock(true, tickEnd(cursorTime, index) ?? cursorTime + (tfMsOf(w) * (index + 1)) / Math.max(1, count))
      set({})
    }),
    r.on('replay:play', () => set({})),
    r.on('replay:pause', () => set({})),
    r.on('replay:end', ({ reason }) => {
      setReplayClock(false, Infinity)
      clearTickEnds()
      set({ phase: 'off', picking: false, note: '' })
      if (reason === 'finished') lastCtx?.toast('Replay reached the newest bar. The chart is live again.', 'info')
      else if (reason === 'market') lastCtx?.toast('Replay ended: a symbol change brought new bars.', 'info')
    }),
  ]
  return () => {
    for (const off of offs) off()
    if (ws === w) ws = null
    setReplayClock(false, Infinity)
    clearTickEnds()
    set({ phase: 'off', picking: false, note: '' })
  }
}

export function openPicker(): void {
  if (!ws) return
  set({ picking: true, note: '' })
  ws.resize() // repaint, so the picker line shows without waiting for the pointer
}

export function closePicker(): void {
  set({ picking: false, note: '' })
  ws?.resize() // and wipe it off the chart now
}

export function setReplayNote(note: string): void {
  set({ note })
}

/** Rewind to `from`: the chart keeps every bar that opened at or before it. */
export async function replayFrom(from: number, cellId?: string): Promise<void> {
  const w = ws
  if (!w || !Number.isFinite(from)) return
  set({ picking: false, note: '' })
  try {
    await w.replay.start(cellId ? { from, cell: cellId } : { from })
  } catch {
    set({ note: 'That replay could not start. Try another bar.' })
    return
  }
  // a start that changed nothing: no bar opens after it
  if (!w.replay.state.active) set({ note: 'Nothing comes after that bar. Pick an earlier one.', picking: true })
}

// ── The toolbar button ───────────────────────────────────────────────────────

let registered = false

export function registerReplay(): void {
  if (registered) return
  registered = true
  registerWidgetAction({
    id: 'cb-replay',
    target: 'topbar',
    label: 'Replay',
    icon: 'replay',
    align: 'left',
    order: 20,
    mobile: 'bar',
    run: (ctx) => {
      lastCtx = ctx
      if (snap.picking) closePicker()
      else openPicker()
    },
  })
  registerRendererLayer({ id: 'cb-replay-pick', placement: 'above-data', repaintOnCursor: true, create: () => new PickLayer() })
}

// ── The start picker, painted on every chart ─────────────────────────────────

const hb = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
const hexA = (c: RGB, a: number) => `#${hb(c[0])}${hb(c[1])}${hb(c[2])}${hb(Math.max(0, Math.min(1, a)) * 255)}`

const PICK_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** A press that moved less than this, and let go this soon, is a pick, not a pan. */
const CLICK_PX = 6
const CLICK_MS = 700

class PickLayer implements RendererLayerInstance {
  private canvas: HTMLCanvasElement | null = null
  private bars: readonly OHLCV[] = []
  private coords: RendererLayerArgs['coords'] | null = null
  private off: (() => void) | null = null

  mount(canvas: HTMLCanvasElement): void {
    this.canvas = canvas
    const host = canvas.parentElement
    if (!host) return
    let down: { x: number; y: number; t: number } | null = null
    const onDown = (e: PointerEvent) => {
      down = snap.picking && e.button === 0 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null
    }
    const onUp = (e: PointerEvent) => {
      const d = down
      down = null
      if (!d || !snap.picking) return
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_PX || performance.now() - d.t > CLICK_MS) return
      this.pickAt(e.clientX, e.clientY)
    }
    // capture: seen before the chart's own handlers, which are left to run (a drag still pans)
    host.addEventListener('pointerdown', onDown, true)
    host.addEventListener('pointerup', onUp, true)
    this.off = () => {
      host.removeEventListener('pointerdown', onDown, true)
      host.removeEventListener('pointerup', onUp, true)
    }
  }

  private pickAt(clientX: number, clientY: number): void {
    const c = this.coords
    const bars = this.bars
    const canvas = this.canvas
    if (!c || !canvas || !bars.length) return
    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    if (x < 0 || x > c.width || y < 0 || y > c.height) return
    const i = Math.max(0, Math.min(bars.length - 1, Math.round(c.xToLogical(x))))
    if (i >= bars.length - 1) {
      setReplayNote('That is the newest bar. Pick an earlier one.')
      return
    }
    const cell = ws?.cells().find((k) => k.host.contains(canvas))
    void replayFrom(bars[i]!.time, cell?.id)
  }

  render(args: RendererLayerArgs): void {
    this.bars = args.bars
    this.coords = args.coords
    const canvas = this.canvas
    const g = canvas?.getContext('2d')
    if (!canvas || !g) return
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, canvas.width, canvas.height)
    const cur = args.cursor
    const bars = args.bars
    if (!snap.picking || !cur || !bars.length) return
    const c = args.coords
    const dpr = c.dpr || 1
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const i = Math.max(0, Math.min(bars.length - 1, Math.round(c.xToLogical(cur.x))))
    // everything right of the picked bar's right edge is what the replay hides
    const edge = Math.round(c.logicalToX(i + 0.5)) + 0.5
    const h = c.height
    const warn = tokenRgb('--color-warn')
    g.fillStyle = hexA(tokenRgb('--color-bg'), 0.62)
    g.fillRect(edge, 0, Math.max(0, c.width - edge), h)
    g.strokeStyle = hexA(warn, 1)
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(edge, 0)
    g.lineTo(edge, h)
    g.stroke()
    // the pill: where the replay would start
    const text = `Replay from ${PICK_FMT.format(new Date(bars[i]!.time))}`
    g.font = `700 10px ${fontOf(canvas)}`
    const w = g.measureText(text).width + 12
    let px = edge + 6
    if (px + w > c.width - 4) px = edge - 6 - w
    g.fillStyle = hexA(warn, 1)
    g.beginPath()
    g.roundRect(px, 6, w, 18, 4)
    g.fill()
    g.fillStyle = hexA(tokenRgb('--color-bg'), 1)
    g.textAlign = 'left'
    g.textBaseline = 'middle'
    g.fillText(text, px + 6, 15.5)
  }

  destroy(): void {
    this.off?.()
    this.off = null
    this.canvas = null
  }
}

let fontMemo = ''
function fontOf(canvas: HTMLCanvasElement): string {
  if (fontMemo) return fontMemo
  try {
    fontMemo = getComputedStyle(canvas).fontFamily || 'system-ui, sans-serif'
  } catch {
    fontMemo = 'system-ui, sans-serif'
  }
  return fontMemo
}
