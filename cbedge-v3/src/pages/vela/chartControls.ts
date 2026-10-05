// ─────────────────────────────────────────────────────────────────────────────
// EACH CHART'S OWN CONTROLS (Brandon, 2026-10-04: C1 + R2; mockup
// generated/2026-10-04-vela-controls-r1.html).
//
//   · the buttons (C1)   Vela's hover cluster at the chart's bottom centre stays
//                        where it is (lifted over the Events lane, vela.css). It
//                        is drawn as Voltick's pill in three groups:
//                          ⠿ │ − + │ ⤢ ↺   (⠿ and ⤢ in a grid only)
//                        and each button names itself on hover, with its key
//                        where it has one ("Reset the view · Alt+R"). Vela
//                        rebuilds the cluster when the grid changes, so it is
//                        dressed again each time (a MutationObserver on it).
//   · the right-click (R2)  a right-click on the chart (not its axes: the price and
//                        time scales keep Vela's own menus) opens ours. Vela's menu
//                        component draws it, so it looks like every other menu:
//
//                          Horizontal line at 7,705.25      Alt+H   ┐ where you
//                          Copy price 7,705.25                      │ clicked (the
//                          Text note here…                          ┘ price pane)
//                          ─────
//                          Reset chart view                 Alt+R
//                          Maximize chart / Back to the grid        (a grid only)
//                          ─────
//                          Chart settings…
//                          Level alerts…
//                          ─────
//                          Remove 3 drawings                         (red)
//                          Remove 2 indicators                       (red)
//
// The price is the crosshair's (the same spot Alt+H uses), rounded to the
// symbol's tick. A right-click while a drawing tool is armed is left to Vela,
// which uses it to cancel the tool. "Text note here…" arms Vela's text tool and
// clicks it into place there, which opens Vela's own editor for typing.
// ─────────────────────────────────────────────────────────────────────────────

import { Menu, registerIcon, svg16, type MenuItemDescriptor } from '@luxalgo/vela/ui'
import type { ChartCell, VelaWorkspace } from '@luxalgo/vela/workspace'
import { resolveSym } from '@/pages/vela/cbedgeProvider'
import { LEVELS_PANEL_ID } from '@/pages/vela/levels/levelAlertsEntry'

let iconsDone = false
function registerIcons(): void {
  if (iconsDone) return
  iconsDone = true
  registerIcon('cb-ctx-hline', svg16('<path d="M1.5 8h13"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/>'))
  registerIcon('cb-ctx-copy', svg16('<rect x="5.2" y="5.2" width="8" height="8" rx="1.5"/><path d="M10.8 5.2V3.6a1.2 1.2 0 0 0-1.2-1.2H3.6a1.2 1.2 0 0 0-1.2 1.2v6a1.2 1.2 0 0 0 1.2 1.2h1.6"/>'))
  registerIcon('cb-ctx-note', svg16('<path d="M3.5 3.5h9M8 3.5v9M6 12.5h4"/>'))
  registerIcon('cb-ctx-reset', svg16('<path d="M12.3 5.6A5 5 0 1 0 13 9"/><path d="M12.8 2.8v3h-3"/>'))
  registerIcon('cb-ctx-max', svg16('<path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9"/>'))
  registerIcon('cb-ctx-restore', svg16('<path d="M13.5 2.5 9 7M9 3.5V7h3.5M2.5 13.5 7 9M7 12.5V9H3.5"/>'))
  registerIcon('cb-ctx-rmdraw', svg16('<path d="M2.5 13.5 13.5 2.5"/><circle cx="2.5" cy="13.5" r="1.3"/><circle cx="13.5" cy="2.5" r="1.3"/>'))
  registerIcon('cb-ctx-rmind', svg16('<path d="M1.5 12.5 5 7l2.5 3.5L11 4l3.5 5"/>'))
}

/** A binding's key as this platform writes it, arrows drawn ("Ctrl+↓"). */
function keyOf(ws: VelaWorkspace, id: string): string | undefined {
  const d = ws.keymap.bindings().find((b) => b.id === id)?.display[0]
  return d ? d.replace(/Arrowup/i, '↑').replace(/Arrowdown/i, '↓').replace(/Arrowleft/i, '←').replace(/Arrowright/i, '→') : undefined
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

// ── the buttons (C1) ─────────────────────────────────────────────────────────

/** What each of Vela's buttons is called on hover, by its aria-label; `key` a keymap id. */
const NAMES: Record<string, { tip: string; key?: string; group: number }> = {
  'Drag to move chart': { tip: 'Drag to another slot', group: 0 },
  'Zoom out': { tip: 'Zoom out', key: 'view.zoom-out', group: 1 },
  'Zoom in': { tip: 'Zoom in', key: 'view.zoom-in', group: 1 },
  'Maximize chart': { tip: 'Maximize this chart', group: 2 },
  'Restore layout': { tip: 'Back to the grid', group: 2 },
  'Reset chart': { tip: 'Reset the view', key: 'chart.reset-view', group: 2 },
}

function dressCluster(ws: VelaWorkspace, root: HTMLElement): void {
  root.classList.add('cb-cc')
  let last = -1
  for (const b of root.querySelectorAll<HTMLButtonElement>(':scope > .vela-cc-btn')) {
    const label = b.getAttribute('aria-label') ?? ''
    const n = NAMES[label]
    if (!n) continue
    const key = n.key ? keyOf(ws, n.key) : undefined
    const tip = key ? `${n.tip} · ${key}` : n.tip
    if (b.dataset.cbTip !== tip) b.dataset.cbTip = tip
    // the browser's own slow tooltip would show the old name on top of ours
    if (b.hasAttribute('title')) b.removeAttribute('title')
    if (last >= 0 && n.group !== last) b.dataset.cbGs = '1'
    else delete b.dataset.cbGs
    last = n.group
  }
}

/** The cell's cluster: the one element in it holding Vela's .vela-cc-btn buttons. */
function clusterOf(cell: ChartCell): HTMLElement | null {
  for (const el of cell.host.children) {
    if (el instanceof HTMLElement && el.querySelector(':scope > .vela-cc-btn')) return el
  }
  return null
}

// ── the right-click menu (R2) ────────────────────────────────────────────────

interface Spot {
  cell: ChartCell
  price: number | null
  time: number | null
  x: number
  y: number
  text: string
}

export function bindChartControls(ws: VelaWorkspace): () => void {
  registerIcons()
  const doc = ws.root.ownerDocument
  let spot: Spot | null = null

  const run = (id: string) => {
    const s = spot
    if (!s) return
    const chart = s.cell.chart
    const toast = (m: string, kind?: 'info' | 'success' | 'error') => ws.context().toast(m, kind)
    switch (id) {
      case 'cb-hline':
        if (s.price != null) chart.drawings.add('hline', { anchors: [{ time: s.time ?? Date.now(), price: s.price }] })
        return
      case 'cb-copy':
        if (!navigator.clipboard) {
          toast('This browser will not copy from here', 'error')
          return
        }
        navigator.clipboard.writeText(s.text).then(
          () => toast(`Copied ${s.text}`, 'success'),
          () => toast('Could not copy the price', 'error'),
        )
        return
      case 'cb-note':
        placeNote(s)
        return
      case 'cb-reset':
        s.cell.resetView()
        return
      case 'cb-max':
        ws.maximizeCell(ws.maximizedCell === s.cell.id ? null : s.cell.id)
        return
      case 'cb-settings':
        chart.renderer.openSettings()
        return
      case 'cb-levels':
        ws.context().togglePanel(LEVELS_PANEL_ID, true)
        return
      case 'cb-rm-draw': {
        const ids = chart.drawings.supported ? chart.drawings.all().map((d) => d.id) : []
        if (ids.length) {
          chart.drawings.removeMany(ids)
          toast(`Removed ${plural(ids.length, 'drawing')} · Ctrl+Z undoes it`)
        }
        return
      }
      case 'cb-rm-ind':
        for (const h of chart.indicators()) h.remove()
        return
    }
  }

  /** A text drawing where the right-click was, opened for typing: Vela's own text
   *  tool placed by a click there (that is what opens its editor). If the tool does
   *  not take the click, the note goes on anyway, for a double-click to edit. */
  const placeNote = (s: Spot) => {
    const chart = s.cell.chart
    if (s.price == null) return
    const before = new Set(chart.drawings.all().map((d) => d.id))
    chart.drawings.setTool('text')
    const target = doc.elementFromPoint(s.x, s.y)
    if (target) {
      const init = { bubbles: true, cancelable: true, composed: true, clientX: s.x, clientY: s.y, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }
      target.dispatchEvent(new PointerEvent('pointerdown', init))
      target.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }))
      target.dispatchEvent(new MouseEvent('click', { ...init, buttons: 0 }))
    }
    setTimeout(() => {
      if (chart.drawings.all().some((d) => !before.has(d.id))) return
      if (chart.drawings.getTool() === 'text') chart.drawings.setTool(null)
      chart.drawings.add('text', {
        anchors: [{ time: s.time ?? Date.now(), price: s.price! }],
        text: { value: 'Note', size: 'normal', hAlign: 'left', vAlign: 'bottom' },
      })
      ws.context().toast('Note placed · double-click it to type')
    }, 80)
  }

  const menu = new Menu({ host: ws.root, items: [], placement: 'bottom-start', checkmarks: true, onSelect: run })

  const itemsFor = (s: Spot): MenuItemDescriptor[] => {
    const chart = s.cell.chart
    const items: MenuItemDescriptor[] = []
    if (s.price != null) {
      items.push(
        { id: 'cb-hline', label: `Horizontal line at ${s.text}`, icon: 'cb-ctx-hline', ...hint(keyOf(ws, 'drawings.hline-cursor')) },
        { id: 'cb-copy', label: `Copy price ${s.text}`, icon: 'cb-ctx-copy' },
        { id: 'cb-note', label: 'Text note here…', icon: 'cb-ctx-note' },
      )
    }
    items.push({ id: 'cb-reset', label: 'Reset chart view', icon: 'cb-ctx-reset', separatorBefore: items.length > 0, ...hint(keyOf(ws, 'chart.reset-view')) })
    if (ws.cells().length > 1) {
      const max = ws.maximizedCell === s.cell.id
      items.push({ id: 'cb-max', label: max ? 'Back to the grid' : 'Maximize chart', icon: max ? 'cb-ctx-restore' : 'cb-ctx-max' })
    }
    items.push({ id: 'cb-settings', label: 'Chart settings…', icon: 'gear', separatorBefore: true }, { id: 'cb-levels', label: 'Level alerts…', icon: 'cb-level-bell' })
    const nd = chart.drawings.supported ? chart.drawings.all().length : 0
    const ni = chart.indicators().length
    items.push(
      { id: 'cb-rm-draw', label: nd ? `Remove ${plural(nd, 'drawing')}` : 'No drawings to remove', icon: 'cb-ctx-rmdraw', disabled: !nd, separatorBefore: true },
      { id: 'cb-rm-ind', label: ni ? `Remove ${plural(ni, 'indicator')}` : 'No indicators to remove', icon: 'cb-ctx-rmind', disabled: !ni },
    )
    return items
  }

  // ── per cell: the right-click, and the cluster's dressing ──
  const offs = new Map<string, () => void>()
  const watch = (cell: ChartCell) => {
    if (offs.has(cell.id)) return
    const host = cell.host
    // A right press while a drawing tool is armed cancels the tool, and the tool is
    // already off by the time the menu event comes: so the press is read here.
    let armedAtPress = false
    const onPress = (e: PointerEvent) => {
      if (e.button === 2) armedAtPress = cell.chart.drawings.getTool() != null
    }
    const onMenu = (e: MouseEvent) => {
      const chart = cell.chart
      // that right press was Vela's (it cancelled a placement): no menu
      const armed = armedAtPress || chart.drawings.getTool() != null
      armedAtPress = false
      if (armed) return
      const t = e.target as Element | null
      // Vela's legend rows and status line have menus of their own
      if (t?.closest('.vela-statusline, [data-vela-pane], .vela-cc-btn')) return
      const box = host.querySelector('canvas')?.parentElement
      if (!box) return
      const r = box.getBoundingClientRect()
      const cs = getComputedStyle(host)
      const scale = Number.parseFloat(cs.getPropertyValue('--vela-scale-gutter')) || 64
      const bottom = Number.parseFloat(cs.getPropertyValue('--vela-bottom-gutter')) || 22
      const pane = Number.parseFloat(cs.getPropertyValue('--vela-price-pane-bottom')) || bottom
      // the scales keep Vela's own menus
      if (e.clientX > r.right - scale || e.clientY > r.bottom - bottom) return
      e.preventDefault()
      e.stopImmediatePropagation()
      const inPrice = e.clientY < r.bottom - pane && !t?.closest('.cb-lc')
      const raw = inPrice ? cell.lastCrossPrice : null
      const tick = resolveSym((chart.market.symbol ?? '').replace(/^[^:]*:/, '')).kind === 'futures' ? 0.25 : 0.01
      const price = raw != null && Number.isFinite(raw) ? Math.round(raw / tick) * tick : null
      spot = {
        cell,
        price,
        time: cell.lastCrossTime,
        x: e.clientX,
        y: e.clientY,
        text: price == null ? '' : price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      }
      menu.setItems(itemsFor(spot))
      menu.openAt(e.clientX, e.clientY)
    }
    host.addEventListener('pointerdown', onPress, true)
    host.addEventListener('contextmenu', onMenu, true)
    // the cluster: dressed now and whenever Vela rebuilds it
    let mo: MutationObserver | null = null
    let dressed: HTMLElement | null = null
    const dress = () => {
      const root = clusterOf(cell)
      if (!root) return
      if (root !== dressed) {
        mo?.disconnect()
        dressed = root
        mo = new MutationObserver(() => dressCluster(ws, root))
        mo.observe(root, { childList: true })
      }
      dressCluster(ws, root)
    }
    dress()
    host.addEventListener('pointerenter', dress)
    offs.set(cell.id, () => {
      host.removeEventListener('pointerdown', onPress, true)
      host.removeEventListener('contextmenu', onMenu, true)
      host.removeEventListener('pointerenter', dress)
      mo?.disconnect()
    })
  }
  for (const c of ws.cells()) watch(c)
  const offCreated = ws.on('cell:created', ({ id }) => {
    const c = ws.cell(id)
    if (c) watch(c)
  })
  const offDestroyed = ws.on('cell:destroyed', ({ id }) => {
    offs.get(id)?.()
    offs.delete(id)
  })

  return () => {
    offCreated()
    offDestroyed()
    for (const off of offs.values()) off()
    offs.clear()
    menu.destroy()
  }
}

const hint = (key: string | undefined): { hint?: string } => (key ? { hint: key } : {})
