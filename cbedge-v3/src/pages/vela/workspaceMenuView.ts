// ─────────────────────────────────────────────────────────────────────────────
// The Workspace menu itself (workspaceMenu.ts has the why). Loaded on the first
// open. Portalled to <body> like the Setups menu, under the Workspace button.
//
// TABS, ONE GROUP AT A TIME (Brandon, 2026-10-08: W4 of
// generated/2026-10-08-vela-workspace-r1.html, replacing the 500px 2 × 2 grid):
//
//   [ Panels • | Scripts | Alerts | Layout ]
//   Watchlist        Alt+W ✓
//   Data window      Alt+D
//   Object tree      Alt+O
//   Volt watch           ◉
//   Volt watch order  NEAREST
//   Open now: Watchlist · Volt watch
//   ← → switch tabs                     ? all shortcuts
//
// Layout ends with Journal (journal.cbedge.net in a new tab) for the owner only;
// everyone else never sees the row (itemShown).
//
// The switch shows one group's rows; the menu keeps the height of the longest
// group, so it never jumps as the tab changes. It reopens on the tab used last
// (this browser). A dot on a tab: something in it is on. "Open now" names every
// panel or switch that is on, whichever tab is showing.
//
// A row does its thing and the menu closes; a switch or the order flips in
// place. ✓ marks the panel that is docked open. Keys: ← → change tab, ↑ ↓ move,
// Enter or Space runs, Esc closes.
// ─────────────────────────────────────────────────────────────────────────────

import type { WidgetContext } from '@luxalgo/vela'
import { iconEl } from '@luxalgo/vela/ui'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { itemOn, itemShown, keyLabel, openPanelOf, runItem, sortValue, WS_GROUPS, type WsItem } from './workspaceMenu'

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
    const w = Math.min(300, window.innerWidth - 16)
    menu.style.width = `${w}px`
    const left = r ? Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) : Math.max(8, (window.innerWidth - w) / 2)
    menu.style.left = `${left}px`
    menu.style.top = `${r ? r.bottom + 6 : 60}px`
  }

  const rows: HTMLButtonElement[] = []
  const tabs: HTMLButtonElement[] = []
  let tab = readTab()
  /** Rows of the longest group: the list keeps that height on every tab. */
  const tallest = Math.max(...WS_GROUPS.map((g) => g.items.filter(itemShown).length))

  const draw = (focus: 'row' | 'tab' | null = null) => {
    const had = rows.indexOf(document.activeElement as HTMLButtonElement)
    rows.length = 0
    tabs.length = 0
    menu.replaceChildren()
    const openPanel = openPanelOf(ws)

    const seg = el('div', 'cb-wsm-seg')
    seg.setAttribute('role', 'tablist')
    seg.setAttribute('aria-label', 'Workspace groups')
    WS_GROUPS.forEach((g, i) => {
      const t = el('button', 'cb-wsm-tab', g.title)
      t.type = 'button'
      t.setAttribute('role', 'tab')
      t.setAttribute('aria-selected', i === tab ? 'true' : 'false')
      t.tabIndex = i === tab ? 0 : -1
      if (i === tab) t.dataset.active = '1'
      if (g.items.some((it) => itemOn(it, openPanel))) {
        const dot = el('i', 'cb-wsm-dot')
        dot.setAttribute('aria-hidden', 'true')
        t.append(dot)
        t.title = `${g.title}: something here is on`
      }
      t.addEventListener('click', () => {
        tab = i
        writeTab(tab)
        draw('tab')
      })
      tabs.push(t)
      seg.append(t)
    })

    const list = el('div', 'cb-wsm-list')
    list.setAttribute('role', 'tabpanel')
    // + the list's own 4px bottom padding (border-box)
    list.style.minHeight = `calc(${tallest} * var(--cb-wsm-row) + 4px)`
    for (const item of WS_GROUPS[tab]?.items ?? []) if (itemShown(item)) list.append(row(item, openPanel))

    const on = WS_GROUPS.flatMap((g) => g.items).filter((it) => it.kind !== 'sort' && itemOn(it, openPanel))
    const now = el('div', 'cb-wsm-now')
    now.append(el('b', '', 'Open now:'), document.createTextNode(on.length ? ` ${on.map((it) => it.label).join(' · ')}` : ' nothing'))

    const foot = el('div', 'cb-wsm-foot')
    const help = el('span', 'cb-wsm-help')
    help.append(el('kbd', 'cb-wsm-kbd', '?'), document.createTextNode('all shortcuts'))
    foot.append(el('span', '', '← → switch tabs'), help)
    menu.append(seg, list, now, foot)

    if (focus === 'tab') tabs[tab]?.focus()
    else if (focus === 'row') rows[0]?.focus()
    else if (had >= 0) rows[Math.min(had, rows.length - 1)]?.focus()
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
    else if (item.kind === 'sort') {
      right.append(el('span', 'cb-wsm-value', sortValue()))
      b.title = 'Click to switch: nearest Volt first, or A–Z'
    } else if (item.kind === 'journal') {
      right.append(el('span', 'cb-wsm-value', '↗'))
      b.title = 'Opens journal.cbedge.net in a new tab'
    } else if (on) right.append(el('span', 'cb-wsm-check', '✓'))
    b.append(right)
    b.addEventListener('click', () => {
      // a switch or the order flips in place: the menu stays open
      if (item.kind === 'strip' || item.kind === 'sort') {
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

  const step = (from: number, key: string): number => {
    const n = rows.length
    if (!n) return -1
    if (key === 'Home') return 0
    if (key === 'End') return n - 1
    if (key === 'ArrowDown') return from < 0 ? 0 : (from + 1) % n
    return from < 0 ? n - 1 : (from - 1 + n) % n
  }

  menu.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      anchor?.focus()
      return
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // another tab; focus stays where it was (on the tabs, or the new tab's first row)
      e.preventDefault()
      const onTabs = tabs.includes(document.activeElement as HTMLButtonElement)
      const n = WS_GROUPS.length
      tab = (tab + (e.key === 'ArrowRight' ? 1 : n - 1)) % n
      writeTab(tab)
      draw(onTabs ? 'tab' : 'row')
      return
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault()
      rows[step(rows.indexOf(document.activeElement as HTMLButtonElement), e.key)]?.focus()
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

/** The tab the menu opens on: the one used last, in this browser. */
const TAB_KEY = 'cb-v3-vela-wsm-tab'
function readTab(): number {
  try {
    const n = Number(localStorage.getItem(TAB_KEY))
    return Number.isInteger(n) && n >= 0 && n < WS_GROUPS.length ? n : 0
  } catch {
    return 0
  }
}
function writeTab(n: number): void {
  try {
    localStorage.setItem(TAB_KEY, String(n))
  } catch {
    /* private mode: the menu opens on Panels */
  }
}
