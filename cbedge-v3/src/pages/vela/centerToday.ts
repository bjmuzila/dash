// ─────────────────────────────────────────────────────────────────────────────
// CENTER TODAY ON ALL CHARTS (Brandon, 2026-10-07: "need a all adjust to middle
// so todays price action is in the middle of the chart for all of them").
//
// One press frames every chart in the layout on its latest session: today's bars
// sit in the middle half of the chart, with the session before on the left and
// room on the right for the bars still to come.
//
//   intraday   today's bars (the newest session: 18:00 ET for ES / NQ, the ET
//              day otherwise) fill the middle half, so the window is twice their
//              width, centred on them, and never under MIN_BARS bars — at 9:35
//              that is the open in the middle, the prior session to its left
//   D / W / M  the newest bar in the middle, the zoom kept
//
// From Workspace ▾ → Layout → Center today on all charts, or Alt+C on the chart
// (workspaceMenu.ts). Each chart's own pan and zoom carry on from there.
//
// The bars come from the chart's orchestrator (`rawBars`, the same internal read
// the ↻ refresh uses). A chart with none yet is skipped.
// ─────────────────────────────────────────────────────────────────────────────

import type { WidgetContext } from '@luxalgo/vela'
import { timeframeToMs } from '@luxalgo/vela'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { resolveSym } from '@/pages/vela/cbedgeProvider'
import { DAY_MS, sessionKey } from '@/pages/vela/studies/common'
import { track } from '@/pages/vela/telemetry'

/** The narrowest window, in bars, so the open of a young session still has context. */
const MIN_BARS = 60

type Chart = ReturnType<VelaWorkspace['cells']>[number]['chart']

function barsOf(chart: Chart): ReadonlyArray<{ time: number }> {
  const o = (chart as unknown as { orchestrator?: { rawBars?: ReadonlyArray<{ time: number }> } }).orchestrator
  return o?.rawBars ?? []
}

/** Bar `i`'s time — between bars by interpolation, past either end by the bar size. */
function timeAt(times: ReadonlyArray<{ time: number }>, i: number, tfMs: number): number {
  const last = times.length - 1
  if (i <= 0) return times[0]!.time + i * tfMs
  if (i >= last) return times[last]!.time + (i - last) * tfMs
  const lo = Math.floor(i)
  const a = times[lo]!.time
  return a + (times[lo + 1]!.time - a) * (i - lo)
}

/** Index of the first bar at or after `t` (bars.length when none). */
function indexAt(times: ReadonlyArray<{ time: number }>, t: number): number {
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid]!.time < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * The window (bar indexes, fractional) that centres the newest session. Exported
 * for the test. `visible` is the chart's visible bar count now (kept on D / W / M).
 */
export function todayWindow(
  times: ReadonlyArray<{ time: number }>,
  tfMs: number,
  fut: boolean,
  visible: number,
): { from: number; to: number } | null {
  const last = times.length - 1
  if (last < 0) return null
  if (tfMs >= DAY_MS) {
    const w = Math.max(10, visible)
    return { from: last - w / 2, to: last + w / 2 }
  }
  const key = sessionKey(times[last]!.time, fut)
  let open = last
  while (open > 0 && sessionKey(times[open - 1]!.time, fut) === key) open--
  const n = last - open + 1
  const w = Math.max(MIN_BARS, 2 * n)
  const mid = (open + last) / 2
  return { from: mid - w / 2, to: mid + w / 2 }
}

/** Frame one chart on its newest session. False when it has no bars yet. */
function centerChart(chart: Chart): boolean {
  const times = barsOf(chart)
  if (!times.length) return false
  const tfMs = timeframeToMs(chart.market.timeframe ?? '5')
  const sym = resolveSym((chart.market.symbol ?? '').replace(/^[^:]*:/, '').trim().toUpperCase())
  const vis = chart.getVisibleRange()
  const visible = vis ? Math.max(1, indexAt(times, vis.to) - indexAt(times, vis.from)) : 60
  const w = todayWindow(times, tfMs, !!sym.fut, visible)
  if (!w) return false
  chart.setVisibleRange({ from: timeAt(times, w.from, tfMs), to: timeAt(times, w.to, tfMs) })
  return true
}

/** Every chart in the layout, framed on today. */
export function centerTodayAll(ctx: WidgetContext, ws: VelaWorkspace | null): void {
  if (!ws) return
  let n = 0
  for (const cell of ws.cells()) {
    try {
      if (centerChart(cell.chart)) n++
    } catch {
      /* one chart failing never stops the rest */
    }
  }
  track('center_today', { charts: n })
  ctx.toast(n ? `Today centred on ${n} chart${n === 1 ? '' : 's'}` : 'No chart has bars yet', n ? 'success' : 'info')
}
