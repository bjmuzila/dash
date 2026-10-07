// ─────────────────────────────────────────────────────────────────────────────
// LOAD WATCHDOG: a D / W / M chart never just spins (2026-10-07 audit: "the 1D
// spinner should time out to an error message instead of hanging").
//
// The provider bounds the load itself (cbedgeProvider.ts): each long-history
// source gets LONG_SOURCE_TIMEOUT_MS before the chart draws the tape's own bars
// instead, and the whole coarse load fails with LoadTimeoutError past
// COARSE_LOAD_TIMEOUT_MS. Vela ends its loading state on a failed load but says
// nothing, so this puts the reason on screen as a workspace toast:
//
//   · a coarse load that ENDS with no bars → "Couldn't load SPX daily bars…"
//   · a coarse load still running a few seconds past the provider's own limit
//     (something below the provider hung) → the same message, once
//
// One message per chart per load. Minute timeframes are left alone: their load
// is one tape read and is not where the hang was.
// ─────────────────────────────────────────────────────────────────────────────

import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { COARSE_LOAD_TIMEOUT_MS } from './cbedgeProvider'

const COARSE_RE = /^\d*[DWM]$/i
const GRACE_MS = 3_000

const bare = (s: string | undefined) => String(s ?? '').replace(/^[^:]*:/, '').toUpperCase()
const tfName = (tf: string) => {
  const u = tf.toUpperCase()
  return u.endsWith('W') ? 'weekly' : u.endsWith('M') ? 'monthly' : 'daily'
}

export function bindLoadWatchdog(ws: VelaWorkspace): () => void {
  const cellOffs = new Map<string, Array<() => void>>()
  const say = (sym: string, tf: string, why: string) =>
    ws.toast(`Couldn't load ${sym} ${tfName(tf)} bars: ${why}. Pick the timeframe again to retry.`, 'error', 8_000)

  const bindCell = (id: string) => {
    if (cellOffs.has(id)) return
    const cell = ws.cell(id)
    if (!cell) return
    const chart = cell.chart
    let timer: ReturnType<typeof setTimeout> | null = null
    let told = false
    const clear = () => {
      if (timer) clearTimeout(timer)
      timer = null
    }
    const offs = [
      chart.on('load:start', (p) => {
        clear()
        told = false
        const tf = String(p.timeframe ?? '')
        if (!COARSE_RE.test(tf)) return
        timer = setTimeout(() => {
          timer = null
          told = true
          say(bare(p.symbol), tf, 'the request timed out')
        }, COARSE_LOAD_TIMEOUT_MS + GRACE_MS)
      }),
      chart.on('load:end', (p) => {
        clear()
        const tf = String(p.timeframe ?? '')
        if (told || !COARSE_RE.test(tf) || p.bars > 0) return
        told = true
        say(bare(p.symbol), tf, 'no bars came back')
      }),
      clear,
    ]
    cellOffs.set(id, offs)
  }
  const unbindCell = (id: string) => {
    for (const off of cellOffs.get(id) ?? []) off()
    cellOffs.delete(id)
  }

  for (const c of ws.cells()) bindCell(c.id)
  const offs = [ws.on('cell:created', ({ id }) => bindCell(id)), ws.on('cell:destroyed', ({ id }) => unbindCell(id))]
  return () => {
    for (const off of offs) off()
    for (const id of [...cellOffs.keys()]) unbindCell(id)
  }
}
