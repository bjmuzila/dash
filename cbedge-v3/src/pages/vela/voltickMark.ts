// ─────────────────────────────────────────────────────────────────────────────
// THE VOLTICK MARK: the wordmark in each chart's bottom-right corner (Brandon,
// 2026-10-04: "water mark will be voltick in the bottom right like the chart on
// voltick has"; mockup generated/2026-10-04-vela-bottom-r2.html).
//
// It is Voltick's own corner watermark (Voltick web/src/HeatChart.jsx, class
// Watermark, Calm → Watermark: Corner): "Vol" in paper and "tick" in Volt Blue,
// 800-weight Inter at 13px, faint, right-aligned 12px in from the price scale and
// just above the Events lane along the bottom of the price pane (studies/events.ts).
// Like Voltick's, it is ground, not an overlay: it sits under the candles, and on
// a chart smaller than 240 × 120 it is left off.
//
// It replaces Vela's big "SPX · 5m" symbol watermark (the `watermark: false` shell
// option in Vela.tsx); the legend card already names the symbol and timeframe.
// Vela's own V mark stays at the bottom-left of every chart (its NOTICE).
//
// Every chart, the phone's too. The mark is a DOM element, the FIRST child of the
// box Vela draws its canvases in, so the (transparent) canvases paint over it:
// under the candles, over the chart's background. That box is also what a GEX
// rail pulls in from its side (studies/rail.ts), so the mark follows the price
// scale with no help. It is placed off the gutters Vela publishes on the cell
// (`--vela-scale-gutter`, `--vela-price-pane-bottom`). `data-vela-screenshot="under"`
// puts it in the copied PNG too, under the candles as on screen.
// ─────────────────────────────────────────────────────────────────────────────

import type { ChartCell, VelaWorkspace } from '@luxalgo/vela/workspace'

/** Voltick's floor: below this the corner is all candles. */
const MIN_W = 240
const MIN_H = 120

function build(doc: Document): HTMLElement {
  const m = doc.createElement('div')
  m.className = 'cb-vtm'
  m.dataset.velaScreenshot = 'under'
  m.setAttribute('aria-hidden', 'true')
  const a = doc.createElement('span')
  a.className = 'cb-vtm-a'
  a.textContent = 'Vol'
  const b = doc.createElement('span')
  b.className = 'cb-vtm-b'
  b.textContent = 'tick'
  m.append(a, b)
  return m
}

class Mark {
  readonly el: HTMLElement
  private readonly ro: ResizeObserver | null

  constructor(private readonly cell: ChartCell) {
    this.el = build(cell.host.ownerDocument)
    this.ro =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            this.el.hidden = cell.host.clientWidth < MIN_W || cell.host.clientHeight < MIN_H
          })
        : null
    this.ro?.observe(cell.host)
    this.mount()
  }

  /** First into the canvases' box (see the header), so it paints before them. */
  mount(): void {
    const box = this.cell.host.querySelector('canvas')?.parentElement
    if (!box || (this.el.parentElement === box && box.firstChild === this.el)) return
    box.prepend(this.el)
  }

  destroy(): void {
    this.ro?.disconnect()
    this.el.remove()
  }
}

export function bindVoltickMarks(ws: VelaWorkspace): () => void {
  const marks = new Map<string, Mark>()
  const add = (id: string) => {
    const cell = ws.cell(id)
    if (!cell) return
    const m = marks.get(id)
    if (m) m.mount()
    else marks.set(id, new Mark(cell))
  }
  const drop = (id: string) => {
    marks.get(id)?.destroy()
    marks.delete(id)
  }
  const all = () => {
    for (const c of ws.cells()) add(c.id)
  }
  all()
  const offs = [
    ws.on('cell:created', ({ id }) => add(id)),
    ws.on('cell:destroyed', ({ id }) => drop(id)),
    // a layout switch or a rebuilt chart: put back any mark that came loose
    ws.on('layout:changed', all),
    ws.on('state:changed', all),
  ]
  return () => {
    for (const off of offs) off()
    for (const id of [...marks.keys()]) drop(id)
  }
}
