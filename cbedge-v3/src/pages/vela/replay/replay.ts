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
//   ▸ The picker   a Volt Blue line follows the pointer over the chart and shades
//                  the bars that will be hidden. Click a bar to rewind to it. A
//                  drag still pans, so you can scroll back to the day you want.
//                  The dock also offers session-open quick picks and a date/time.
//   ▸ The dock     ReplayBar.tsx, the same bottom bar every v3 replay
//                  uses (design/primitives/ReplayDock.tsx). It loads lazily
//                  through ReplayHost.tsx, so this page's chunk carries only
//                  this file.
//
// Clicking the button again cancels the picker, and while replaying it opens
// the picker again to jump somewhere else.
//
// PAPER TRADING (paper.ts): the dock's Buy / Sell / Flat fill at the replay
// price, the newest revealed close on the active chart, which this file tracks.
// The fills (▲ bought, ▼ sold) and the open position's line are painted on the
// same layer as the picker, while a replay runs.
//
// The replay clock (clock.ts) moves on every reveal, so the CB studies can tell
// what had already happened.
// ─────────────────────────────────────────────────────────────────────────────

import { registerWidgetAction, timeframeToMs, type OHLCV, type WidgetContext } from '@luxalgo/vela'
import { registerRendererLayer, type RendererLayerArgs, type RendererLayerInstance } from '@luxalgo/vela/plugin'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { tokenRgb, type RGB } from '@/design/theme'
import { clearTickEnds, replayClock, setReplayClock, tickEnd } from './clock'
import { paperFlatten, paperStore } from './paper'

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

// ── SEVERAL CHARTS, ONE CLOCK (2026-10-06, Brandon: "on replay mode when I hit
// prior open, it goes to midnight prior open no matter what — futures or stocks
// should be 9:30 AM Eastern"). The phone opens three charts stacked, and a pick
// was read on the ACTIVE one. With a daily (or any coarse) chart active, its bars
// open at ET midnight, so a 9:30 start cut at that midnight bar, and the clock
// was the active chart's cursor + its own timeframe — midnight again. Now a start
// is read on the chart with the FINEST timeframe (its close is the 9:30 exactly),
// every other chart keeps the bars closed by then, and the clock is the newest
// bar close on any chart: the moment the replay has truly reached. ──

/** The chart with the finest timeframe (the active one wins a tie). */
export function finestCellId(w: VelaWorkspace): string {
  let best = w.active.id
  let bestMs = timeframeToMs(w.active.chart.market.timeframe ?? '5') || Infinity
  for (const c of w.cells()) {
    const ms = timeframeToMs(c.chart.market.timeframe ?? '5') || Infinity
    if (ms < bestMs) {
      best = c.id
      bestMs = ms
    }
  }
  return best
}

/** The newest bar close on any replaying chart, or null when none is replaying. */
function sharedClock(w: VelaWorkspace): number | null {
  let at: number | null = null
  for (const c of w.cells()) {
    const t = c.chart.replay.state.cursorTime
    if (t == null) continue
    const end = t + (timeframeToMs(c.chart.market.timeframe ?? '5') || 60_000)
    if (at == null || end > at) at = end
  }
  return at
}

/** Follow the workspace's replay. Call once per workspace, from the page. */
export function bindReplay(w: VelaWorkspace): () => void {
  ws = w
  const r = w.replay
  const offs = [
    r.on('replay:start', ({ cursorTime }) => {
      setReplayClock(true, sharedClock(w) ?? cursorTime + tfMsOf(w))
      set({ phase: 'on', picking: false, note: '' })
    }),
    r.on('replay:step', ({ cursorTime }) => {
      setReplayClock(true, sharedClock(w) ?? cursorTime + tfMsOf(w))
      set({})
    }),
    r.on('replay:tick', ({ cursorTime, index, count }) => {
      setReplayClock(true, tickEnd(cursorTime, index) ?? cursorTime + (tfMsOf(w) * (index + 1)) / Math.max(1, count))
      set({})
    }),
    r.on('replay:play', () => set({})),
    r.on('replay:pause', () => set({})),
    r.on('replay:end', ({ reason }) => {
      // a paper position nobody can see any more: closed at the last replay price
      const q = lastQuote
      if (q && paperStore.get().pos) paperFlatten(q.price, q.t, 'replay ended')
      setReplayClock(false, Infinity)
      clearTickEnds()
      set({ phase: 'off', picking: false, note: '' })
      if (reason === 'finished') lastCtx?.toast('Replay reached the newest bar. The chart is live again.', 'info')
      else if (reason === 'market') lastCtx?.toast('Replay ended: a symbol change brought new bars.', 'info')
    }),
  ]
  // each revealed bar or tick, as it lands (before the replay event that re-renders the dock)
  const barOffs = new Map<string, () => void>()
  const wireBars = (id: string) => {
    const cell = w.cell(id)
    if (!cell || barOffs.has(id)) return
    barOffs.set(
      id,
      cell.chart.on('bar', (b) => {
        if (snap.phase === 'on') lastBarByCell.set(id, b)
      }),
    )
  }
  for (const c of w.cells()) wireBars(c.id)
  offs.push(
    w.on('cell:created', ({ id }) => wireBars(id)),
    w.on('cell:destroyed', ({ id }) => {
      barOffs.get(id)?.()
      barOffs.delete(id)
      lastBarByCell.delete(id)
    }),
  )
  return () => {
    for (const off of offs) off()
    for (const off of barOffs.values()) off()
    barOffs.clear()
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

/** Repaint the charts now (after a paper order: no new bar has come to do it). */
export function repaint(): void {
  ws?.resize()
}

// ── The replay price: the newest revealed close on each chart ──
interface Quote {
  price: number
  /** The moment it stands for: the replay clock. */
  t: number
  sym: string
}
const lastBarByCell = new Map<string, OHLCV>()
let lastQuote: Quote | null = null

const bare = (symbol: string | undefined) => (symbol ?? '').replace(/^[^:]*:/, '').trim().toUpperCase()

/** What a paper order fills at: the active chart's newest revealed close. */
export function replayQuote(): Quote | null {
  const w = ws
  if (!w) return null
  const bar = lastBarByCell.get(w.active.id)
  if (!bar) return null
  const clock = replayClock()
  const t = Number.isFinite(clock) ? Math.max(bar.time, clock) : bar.time
  return { price: bar.close, t, sym: bare(w.chart.market.symbol) }
}

/**
 * Rewind to `from`: the chart it is read on keeps every bar that opened at or
 * before it — `cellId` (a clicked bar's chart), else the finest-timeframe chart.
 */
export async function replayFrom(from: number, cellId?: string): Promise<void> {
  const w = ws
  if (!w || !Number.isFinite(from)) return
  set({ picking: false, note: '' })
  try {
    await w.replay.start({ from, cell: cellId ?? finestCellId(w) })
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
  private cellId: string | null = null

  /** The workspace cell this layer's chart is (found once, by DOM). */
  private cell(): { id: string; symbol: string } | null {
    const w = ws
    const canvas = this.canvas
    if (!w || !canvas) return null
    let cell = this.cellId ? w.cell(this.cellId) : undefined
    if (!cell || !cell.host.contains(canvas)) {
      cell = w.cells().find((k) => k.host.contains(canvas))
      this.cellId = cell?.id ?? null
    }
    return cell ? { id: cell.id, symbol: bare(cell.chart.market.symbol) } : null
  }

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
    const bars = args.bars
    const cell = snap.phase === 'on' || snap.picking ? this.cell() : null
    if (cell && snap.phase === 'on' && bars.length) {
      const last = bars[bars.length - 1]!
      lastBarByCell.set(cell.id, last)
      if (ws?.active.id === cell.id) lastQuote = { price: last.close, t: last.time, sym: cell.symbol }
      const dpr0 = args.coords.dpr || 1
      g.setTransform(dpr0, 0, 0, dpr0, 0, 0)
      drawPaper(g, args, cell.symbol)
      g.setTransform(1, 0, 0, 1, 0, 0)
    }
    const cur = args.cursor
    if (!snap.picking || !cur || !bars.length) return
    const c = args.coords
    const dpr = c.dpr || 1
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const i = Math.max(0, Math.min(bars.length - 1, Math.round(c.xToLogical(cur.x))))
    // everything right of the picked bar's right edge is what the replay hides
    const edge = Math.round(c.logicalToX(i + 0.5)) + 0.5
    const h = c.height
    // Volt Blue, Voltick's replay colour (--color-replay); amber is the Volt's
    const tint = tokenRgb('--color-replay')
    g.fillStyle = hexA(tokenRgb('--color-bg'), 0.62)
    g.fillRect(edge, 0, Math.max(0, c.width - edge), h)
    g.strokeStyle = hexA(tint, 1)
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(edge, 0)
    g.lineTo(edge, h)
    g.stroke()
    // the pill: where the replay would start
    const text = `Replay from ${PICK_FMT.format(new Date(bars[i]!.time))}`
    g.font = `700 10px ${monoOf(canvas)}`
    const w = g.measureText(text).width + 12
    let px = edge + 6
    if (px + w > c.width - 4) px = edge - 6 - w
    g.fillStyle = hexA(tint, 1)
    g.beginPath()
    g.roundRect(px, 6, w, 18, 6)
    g.fill()
    g.fillStyle = hexA(tokenRgb('--color-vt-paper'), 1)
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

/** x of a moment inside its candle (open at the left edge, close at the right). */
function timeX(t: number, bars: readonly OHLCV[], tf: number, coords: RendererLayerArgs['coords']): number | null {
  const n = bars.length
  if (!n || t < bars[0]!.time) return null
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (bars[mid]!.time <= t) lo = mid
    else hi = mid - 1
  }
  const frac = Math.max(0, Math.min(1, (t - bars[lo]!.time) / (tf || 1)))
  return coords.logicalToX(lo - 0.5 + frac)
}

/** The paper fills on this chart (▲ bought, ▼ sold) and the open position's line. */
function drawPaper(g: CanvasRenderingContext2D, args: RendererLayerArgs, sym: string): void {
  const p = paperStore.get()
  const { coords, scale, bounds, bars } = args
  const fills = p.fills.filter((f) => f.sym === sym)
  if (!fills.length && !(p.pos && p.sym === sym)) return
  const tf = coords.barInterval || (bars.length > 1 ? bars[1]!.time - bars[0]!.time : 60_000)
  const up = tokenRgb('--color-up')
  const down = tokenRgb('--color-down')
  const bg = tokenRgb('--color-bg')
  const monoFont = monoOf(g.canvas)
  g.save()
  g.beginPath()
  g.rect(0, bounds.top, coords.width, bounds.height)
  g.clip()
  for (const f of fills) {
    const x = timeX(f.t, bars, tf, coords)
    if (x == null || x < -10 || x > coords.width + 10) continue
    const y = coords.priceToY(f.price, scale, bounds)
    if (!Number.isFinite(y)) continue
    const buy = f.qty > 0
    const s = 6
    g.beginPath()
    if (buy) {
      g.moveTo(x, y + 3)
      g.lineTo(x + s, y + 3 + s * 1.6)
      g.lineTo(x - s, y + 3 + s * 1.6)
    } else {
      g.moveTo(x, y - 3)
      g.lineTo(x + s, y - 3 - s * 1.6)
      g.lineTo(x - s, y - 3 - s * 1.6)
    }
    g.closePath()
    g.fillStyle = hexA(buy ? up : down, 1)
    g.fill()
    g.lineWidth = 1
    g.strokeStyle = hexA(bg, 0.9)
    g.stroke()
  }
  if (p.pos && p.sym === sym) {
    const y = Math.round(coords.priceToY(p.avg, scale, bounds)) + 0.5
    const last = bars[bars.length - 1]
    const openPts = last ? (last.close - p.avg) * p.pos : 0
    const c = p.pos > 0 ? up : down
    g.setLineDash([6, 4])
    g.strokeStyle = hexA(c, 0.85)
    g.lineWidth = 1.25
    g.beginPath()
    g.moveTo(0, y)
    g.lineTo(coords.width, y)
    g.stroke()
    g.setLineDash([])
    const text = `${p.pos > 0 ? 'Long' : 'Short'} ${Math.abs(p.pos)} @ ${p.avg.toFixed(2)} · ${openPts >= 0 ? '+' : '−'}${Math.abs(openPts).toFixed(2)} pts`
    g.font = `700 10px ${monoFont}`
    const w = g.measureText(text).width + 10
    g.fillStyle = hexA(c, 1)
    g.beginPath()
    g.roundRect(6, y - 9, w, 18, 6)
    g.fill()
    g.fillStyle = hexA(bg, 1)
    g.textAlign = 'left'
    g.textBaseline = 'middle'
    g.fillText(text, 11, y + 0.5)
  }
  g.restore()
}

/** Voltick's mono stack (every number on the chart is mono), read once. */
let monoMemo = ''
function monoOf(canvas: HTMLCanvasElement): string {
  if (monoMemo) return monoMemo
  try {
    monoMemo = getComputedStyle(canvas).getPropertyValue('--font-mono').trim() || 'ui-monospace, monospace'
  } catch {
    monoMemo = 'ui-monospace, monospace'
  }
  return monoMemo
}
