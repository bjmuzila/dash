// Studies that belong BEHIND the candles: the Voltick Path's bubbles
// (2026-10-08, Brandon: "bubbles on path should sit behind the price bars").
// A renderer layer owned
// by a study stacks with that study, in front of the candles by default, so each
// one is sent to the back once, when it first appears on a chart. The object tree
// can still bring it forward afterwards.
//
// RETIRED STUDIES are stripped here too, on the same sweep: the GEX Heatmap
// (2026-10-10, Brandon: it slowed charts down and users should not have it) and
// the GEX Profile (2026-10-10, "gex profile indicator can go"). A
// layout saved with one — the account's synced copy, a preset, a copied chart —
// still opens, and the study is removed the moment the chart is wired or the
// indicator is added. The removal syncs back with the layout, so it goes once.

import type { Vela } from '@luxalgo/vela'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { HEAT_TYPE, PROFILE_TYPE } from '@/pages/vela/studies'
import { PATH_TYPE } from '@/pages/vela/vtPath/vtPathLayer'

const BACK = new Set<string>([PATH_TYPE])
const RETIRED = new Set<string>([HEAT_TYPE, PROFILE_TYPE])

export function bindStudyOrder(ws: VelaWorkspace): () => void {
  const done = new WeakMap<Vela, Set<string>>()
  const sweep = (chart: Vela) => {
    let seen = done.get(chart)
    if (!seen) done.set(chart, (seen = new Set()))
    const toBack = (id: string) => {
      try {
        chart.renderer.set('seriesOrder', { id, to: 'back' })
      } catch {
        /* an older renderer without series ordering: it stays in front */
      }
    }
    for (const h of chart.indicators()) {
      if (h.nativeType && RETIRED.has(h.nativeType)) {
        try {
          h.remove()
        } catch {
          /* already gone */
        }
      }
    }
    const fresh = chart.indicators().filter((h) => !!h.nativeType && BACK.has(h.nativeType) && !seen.has(h.id))
    for (const h of fresh) {
      seen.add(h.id)
      toBack(h.id)
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
