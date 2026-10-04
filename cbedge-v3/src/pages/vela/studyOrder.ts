// Studies that belong BEHIND the candles: the GEX Heatmap. A renderer layer owned
// by a study stacks with that study, in front of the candles by default, so each
// one is sent to the back once, when it first appears on a chart. The object tree
// can still bring it forward afterwards.

import type { Vela } from '@luxalgo/vela'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { HEAT_TYPE } from '@/pages/vela/studies'

const BACK = new Set<string>([HEAT_TYPE])

export function bindStudyOrder(ws: VelaWorkspace): () => void {
  const done = new WeakMap<Vela, Set<string>>()
  const sweep = (chart: Vela) => {
    let seen = done.get(chart)
    if (!seen) done.set(chart, (seen = new Set()))
    for (const h of chart.indicators()) {
      if (!h.nativeType || !BACK.has(h.nativeType) || seen.has(h.id)) continue
      seen.add(h.id)
      try {
        chart.renderer.set('seriesOrder', { id: h.id, to: 'back' })
      } catch {
        /* an older renderer without series ordering: it stays in front */
      }
    }
  }
  const offs = new Map<string, () => void>()
  const wire = (id: string) => {
    const cell = ws.cell(id)
    if (!cell || offs.has(id)) return
    const chart = cell.chart
    sweep(chart)
    offs.set(id, chart.on('indicator:added', () => setTimeout(() => sweep(chart), 0)))
  }
  for (const c of ws.cells()) wire(c.id)
  const offCreated = ws.on('cell:created', ({ id }) => wire(id))
  const offDestroyed = ws.on('cell:destroyed', ({ id }) => {
    offs.get(id)?.()
    offs.delete(id)
  })
  return () => {
    offCreated()
    offDestroyed()
    for (const off of offs.values()) off()
    offs.clear()
  }
}
