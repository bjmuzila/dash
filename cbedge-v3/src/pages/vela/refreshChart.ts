// ─────────────────────────────────────────────────────────────────────────────
// ↻ REFRESH, in Vela's top bar beside the camera (2026-10-06, Brandon: "a
// refresh button that helps refresh price candles and any slowed down issues").
//
// The board's ↻ (shell/RefreshButton.tsx) for the chart page, plus the candles:
//
//   THE SOCKET   reconnectSocket(): the live feed (ES / NQ minutes, the frames
//                the studies read) drops and reopens at once, instead of
//                waiting out a quiet death mid-backoff.
//   THE REST     refreshAll(): every cached response is dropped and every
//                mounted reader refetches, so the provider's history and each
//                study's data come back fresh on their next read.
//   THE CANDLES  each chart re-fetches from its newest bar to now and replays
//                that through its own reconciler (Vela's gap heal, the same
//                path it runs when a hidden tab comes back), so a stale or
//                missing live candle is corrected in place. Then the chart's
//                studies restart on the fresh data.
//
// Nothing blanks and nothing moves: pan, zoom, drawings and the layout stay
// as they are. Shift+click is the hard version, a full page reload.
//
// The candles and studies steps reach two methods Vela keeps internal
// (`healGap`, `restartNativeIndicators` on the chart's orchestrator). Each is
// called only when it exists, so a Vela upgrade that renames them degrades to
// the socket + REST refresh, never an error.
// ─────────────────────────────────────────────────────────────────────────────

import { registerWidgetAction, type WidgetContext } from '@luxalgo/vela'
import { registerIcon, svg16 } from '@luxalgo/vela/ui'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { refreshAll } from '@/data/api'
import { reconnectSocket } from '@/data/socket'

export const REFRESH_ACTION_ID = 'cb-refresh'

/** Ignore repeat clicks this long: reconnectSocket resets the backoff. */
const COOLDOWN_MS = 1500

let current: VelaWorkspace | null = null
let lastAt = 0

/** Point the button at the page's workspace. Returns the unbind for the page's cleanup. */
export function bindRefreshWorkspace(ws: VelaWorkspace): () => void {
  current = ws
  return () => {
    if (current === ws) current = null
  }
}

interface Orchestrator {
  rawBars?: ReadonlyArray<{ time: number }>
  healGap?: (fromMs: number) => Promise<void>
  restartNativeIndicators?: () => void
}

/** One chart: its candles from the newest bar on, then its studies. */
async function refreshChart(chart: unknown): Promise<void> {
  const o = (chart as { orchestrator?: Orchestrator }).orchestrator
  if (!o) return
  const last = o.rawBars?.[o.rawBars.length - 1]
  if (last && typeof o.healGap === 'function') {
    try {
      await o.healGap.call(o, last.time)
    } catch {
      /* the next live tick heals it the usual way */
    }
  }
  if (typeof o.restartNativeIndicators === 'function') o.restartNativeIndicators.call(o)
}

function refresh(ctx: WidgetContext): void {
  const now = Date.now()
  if (now - lastAt < COOLDOWN_MS) return
  lastAt = now
  // Shift+click: the hard refresh
  const ev = typeof window !== 'undefined' ? (window.event as MouseEvent | undefined) : undefined
  if (ev?.shiftKey) {
    window.location.reload()
    return
  }
  reconnectSocket()
  refreshAll()
  const charts = current ? current.cells().map((c) => c.chart) : [ctx.chart]
  ctx.toast('Refreshing candles and data…', 'info')
  void Promise.all(charts.map((c) => refreshChart(c))).then(() => {
    current?.resize()
    ctx.toast('Charts refreshed', 'success')
  })
}

let registered = false

/** The ↻ topbar button. Idempotent; must run before a workspace is built. */
export function registerRefreshChart(): void {
  if (registered) return
  registered = true
  registerIcon(REFRESH_ACTION_ID, svg16('<path d="M12.3 5.6A5 5 0 1 0 13 9"/><path d="M12.8 2.8v3h-3"/>'))
  registerWidgetAction({
    id: REFRESH_ACTION_ID,
    target: 'topbar',
    label: 'Refresh candles and data (Shift+click: reload the page)',
    icon: REFRESH_ACTION_ID,
    iconOnly: true,
    run: refresh,
  })
}
