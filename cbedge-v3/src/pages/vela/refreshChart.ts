// ─────────────────────────────────────────────────────────────────────────────
// ↻ REFRESH CANDLES, in Vela's top bar beside the camera.
//
// 2026-10-06, Brandon: "i just want the candlesticks to refresh. not the whole
// chart / i dont want to reload all the charts".
//
// One click re-reads the CANDLES of the chart in focus, and nothing else:
//
//   1. the cached candle history is dropped (only the candle URLs:
//      /api/snapshots/candles for ES / NQ, /api/snapshots/etf-candles for the
//      rest), so the next read goes to the server instead of a copy up to 20 s old
//   2. that chart re-fetches from its newest bar to now and replays it through
//      its own reconciler (Vela's gap heal, the same path it runs when a hidden
//      tab comes back), so a stale forming candle or missing newer candles are
//      corrected in place
//
// The other charts in the layout are not touched. Studies, the socket and every
// other cached response stay as they are, and pan, zoom, drawings and the
// layout stay put. Nothing blanks. The page is never reloaded.
//
// Step 2 reaches a method Vela keeps internal (`healGap` on the chart's
// orchestrator). It is called only when it exists, so a Vela upgrade that
// renames it makes the button a no-op, never an error.
// ─────────────────────────────────────────────────────────────────────────────

import { registerWidgetAction, type WidgetContext } from '@luxalgo/vela'
import { registerIcon, svg16 } from '@luxalgo/vela/ui'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { forgetQueries } from '@/data/api'

export const REFRESH_ACTION_ID = 'cb-refresh'

/** Ignore repeat clicks this long. */
const COOLDOWN_MS = 1500

/** The candle-history routes cbedgeProvider reads (board/gexCandles/candles.ts). */
const CANDLE_URL = /^\/api\/snapshots\/(?:etf-)?candles\?/

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
}

/** One chart's candles, from its newest bar on. */
async function refreshCandles(chart: unknown): Promise<boolean> {
  const o = (chart as { orchestrator?: Orchestrator } | null)?.orchestrator
  const last = o?.rawBars?.[o.rawBars.length - 1]
  if (!o || !last || typeof o.healGap !== 'function') return false
  try {
    await o.healGap.call(o, last.time)
    return true
  } catch {
    return false
  }
}

function refresh(ctx: WidgetContext): void {
  const now = Date.now()
  if (now - lastAt < COOLDOWN_MS) return
  lastAt = now
  forgetQueries((url) => CANDLE_URL.test(url))
  void refreshCandles(ctx.chart).then((ok) => {
    ctx.toast(ok ? 'Candles refreshed' : 'Candles could not be refreshed', ok ? 'success' : 'info')
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
    label: 'Refresh candles',
    icon: REFRESH_ACTION_ID,
    iconOnly: true,
    run: refresh,
  })
}
