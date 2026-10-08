// ─────────────────────────────────────────────────────────────────────────────
// The Workspace menu itself (workspaceMenu.ts has the why). Loaded on the first
// open. Portalled to <body> like the Setups menu, under the Workspace button:
//
//   PANELS                 │ SCRIPTS
//   Watchlist     Alt+W ✓  │ Script editor    Alt+E
//   Data window   Alt+D    │ Strategy Tester  Alt+B
//   Object tree   Alt+O    │
//   Tape scroll         ◉  │
//   ───────────────────────┼──────────────────────
//   ALERTS                 │ LAYOUT
//   Level alerts  Alt+A    │ Setups
//   Script alerts          │ Copy indicators to all charts
//   Shortcuts work without opening the menu          ? all shortcuts
//
// A row does its thing and the menu closes; the strip switch flips in place.
// ✓ marks the panel that is docked open. Keys: ↑ ↓ (and ← → across the two
// columns) move, Enter or Space runs, Esc closes.
// ─────────────────────────────────────────────────────────────────────────────

import type { WidgetContext } from '@luxalgo/vela'
import { iconEl } from '@luxalgo/vela/ui'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { itemOn, keyLabel, openPanelOf, runItem, WS_GROUPS, type WsItem } from './workspaceMenu'

let open: { el: HTMLElement; close: () => void } | null = null

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = cls
  if (text != null) e.textContent = text
  return e
}

export function toggleWorkspaceMenu(ctx: WidgetContext, ws: VelaWorkspace | null, anchor: HTMLElement | null): void {
  if (open) {
    open.close()
    return
  }
  const menu = el('div', 'cb-wsm')
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', 'Workspace')
  menu.style.cssText = 'position:fixed;z-index:80'
  document.body.appendChild(menu)
  anchor?.setAttribute('aria-expanded', 'true')
  anchor?.setAttribute('data-open', '1')

  const place = () => {
    const r = anchor?.getBoundingClientRect()
    const w = Math.min(500, window.innerWidth - 16)
    menu.style.width = `${w}px`
    const left = r ? Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) : Math.max(8, (window.innerWidth - w) / 2)
    menu.style.left = `${left}px`
    menu.style.top = `${r ? r.bottom + 6 : 60}px`
  }

  const rows: HTMLButtonElement[] = []
  const draw = () => {
    const had = rows.indexOf(document.activeElement as HTMLButtonElement)
    rows.length = 0
    menu.replaceChildren()
    const grid = el('div', 'cb-wsm-grid')
    const openPanel = openPanelOf(ws)
    for (const g of WS_GROUPS) {
      const col = el('div', 'cb-wsm-group')
      col.append(el('div', 'cb-wsm-h', g.title))
      for (const item of g.items) col.append(row(item, openPanel))
      grid.append(col)
    }
    const foot = el('div', 'cb-wsm-foot')
    const help = el('span', 'cb-wsm-help')
    help.append(el('kbd', 'cb-wsm-kbd', '?'), document.createTextNode('all shortcuts'))
    foot.append(el('span', '', 'Shortcuts work without opening the menu'), help)
    menu.append(grid, foot)
    if (had >= 0) rows[had]?.focus()
  }

  const row = (item: WsItem, openPanel: string | undefined): HTMLButtonElement => {
    const on = itemOn(item, openPanel)
    const b = el('button', 'cb-wsm-row')
    b.type = 'button'
    b.setAttribute('role', item.kind === 'strip' || item.kind === 'panel' ? 'menuitemcheckbox' : 'menuitem')
    if (item.kind === 'strip' || item.kind === 'panel') b.setAttribute('aria-checked', on ? 'true' : 'false')
    if (on) b.dataset.on = '1'
    const icon = iconEl(item.icon)
    icon.classList.add('cb-wsm-icon')
    b.append(icon, el('span', 'cb-wsm-label', item.label))
    const right = el('span', 'cb-wsm-right')
    const keys = keyLabel(item, ws)
    if (keys) right.append(el('kbd', 'cb-wsm-kbd', keys))
    if (item.kind === 'strip') right.append(el('span', 'cb-wsm-switch'))
    else if (on) right.append(el('span', 'cb-wsm-check', '✓'))
    b.append(right)
    b.addEventListener('click', () => {
      if (item.kind === 'strip') {
        runItem(item, ctx, anchor)
        draw()
        return
      }
      close()
      runItem(item, ctx, anchor)
    })
    rows.push(b)
    return b
  }

  const move = (from: number, key: string): number => {
    const n = rows.length
    if (!n) return -1
    if (key === 'Home') return 0
    if (key === 'End') return n - 1
    if (key === 'ArrowDown') return from < 0 ? 0 : (from + 1) % n
    if (key === 'ArrowUp') return from < 0 ? n - 1 : (from - 1 + n) % n
    // ← → jump to the nearest row in the other column of the 2 × 2 grid
    const cur = rows[from]
    if (!cur) return 0
    const r = cur.getBoundingClientRect()
    const goRight = key === 'ArrowRight'
    let best = from
    let bestD = Infinity
    rows.forEach((x, k) => {
      const q = x.getBoundingClientRect()
      if (goRight ? q.left <= r.left + 4 : q.left >= r.left - 4) return
      const d = Math.abs(q.top - r.top)
      if (d < bestD) {
        bestD = d
        best = k
      }
    })
    return best
  }

  menu.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      anchor?.focus()
      return
    }
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault()
      rows[move(rows.indexOf(document.activeElement as HTMLButtonElement), e.key)]?.focus()
    }
  })
  for (const t of ['keyup', 'keypress'] as const) menu.addEventListener(t, (e) => e.stopPropagation())

  const close = () => {
    menu.remove()
    anchor?.setAttribute('aria-expanded', 'false')
    anchor?.removeAttribute('data-open')
    document.removeEventListener('pointerdown', outside, true)
    document.removeEventListener('keydown', esc, true)
    window.removeEventListener('resize', place)
    open = null
  }
  const outside = (e: PointerEvent) => {
    const t = e.target as Node
    if (!menu.contains(t) && t !== anchor && !anchor?.contains(t)) close()
  }
  // Esc while focus is still on the chart (the menu was opened by mouse)
  const esc = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !menu.contains(e.target as Node)) close()
  }
  document.addEventListener('pointerdown', outside, true)
  document.addEventListener('keydown', esc, true)
  window.addEventListener('resize', place)
  open = { el: menu, close }

  draw()
  place()
  rows[0]?.focus({ preventScroll: true })
}
