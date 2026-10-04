// ─────────────────────────────────────────────────────────────────────────────
// THE DRAWING RAIL: five tools and a drawer (Brandon, 2026-10-04, the Vela
// cleanup's fourth section, option D1; mockup generated/2026-10-04-vela-draw-r1.html).
//
//   ↖  cursor
//   ─  your pinned tools (default: trend line, horizontal line, rectangle, text,
//      long/short position), each one click
//   ⊞  every drawing tool: a searchable drawer, where ★ pins a tool to the rail
//   ─
//   ∪  magnet (on at the last strength; the strength is in ⋯)
//   ⋯  measure, eraser, stay in drawing mode, sync drawings on all charts, magnet
//      strength, lock / hide / remove this chart's drawings
//
// It replaced Vela's shared drawing toolbar: fifteen buttons (the cursor, seven
// tool-group flyouts holding about seventy tools, six utilities) on the left of
// every chart all day. Same drawing engine, same tools, same shortcuts (Alt+T
// trend line, Alt+H / Alt+V lines at the cursor); only where the buttons live.
//
// ── How it sits in Vela ──────────────────────────────────────────────────────
// Vela keeps its toolbar column (.vela-ws-toolbar, left of the grid, hidden in
// its phone-width chrome) and its own bar inside it; `cb-dr-on` on the workspace
// root hides that bar (vela.css) and this rail takes its place in the column, so
// the grid does not move. Every button drives the ACTIVE chart's public drawings
// API (setTool / setMode / setSnapMode / setStayMode, lock / show / remove) and
// the workspace's drawings sync (`ws.sync`). Magnet and stay-in-mode are applied
// to every chart, as Vela's bar did; an armed tool follows the active chart.
//
// Pins and the magnet's strength are kept in this browser. The desktop page
// loads this lazily after the workspace is up; the phone keeps Vela's own
// drawing chrome.
//
// The other option on the table was D4 (no rail: a ✎ Draw button in the top bar
// opening a palette, plus a small strip while a tool is armed). Brandon kept it
// in reserve; the mockup has it.
// ─────────────────────────────────────────────────────────────────────────────

import { defaultToolbar, type Vela } from '@luxalgo/vela'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'

type Snap = 'off' | 'weak' | 'strong'
type Mode = 'measure' | 'eraser' | null

interface Tool {
  type: string
  label: string
  icon: string
  section: string
}

const PREFS_KEY = 'cb-v3-vela-draw'
const DEFAULT_PINS = ['trendline', 'hline', 'box', 'text', 'position']
const PINS_MAX = 8
/** Vela's shortcuts, by tool (its keymap ids: drawings.trendline, drawings.hline-cursor…). */
const KEY_IDS: Record<string, string> = { trendline: 'drawings.trendline', hline: 'drawings.hline-cursor', vline: 'drawings.vline-cursor' }

// ── The catalogue: Vela's own tools, labels, icons and sections ──────────────

const TOOLS: Tool[] = []
for (const g of defaultToolbar().groups) {
  const sections = g.sections?.length ? g.sections : [{ label: g.label, tools: g.tools }]
  for (const s of sections) for (const t of s.tools) TOOLS.push({ type: t.type, label: t.label, icon: t.icon, section: s.label })
}
const byType = new Map(TOOLS.map((t) => [t.type, t]))

// ── Icons (16px; the tools carry Vela's own) ─────────────────────────────────

const svg = (body: string) =>
  `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
const ICON = {
  cursor: svg('<path d="M4 2.5 12.5 9 8.7 9.6l2.1 4-1.7.9-2.1-4.1L4 13Z" fill="currentColor" stroke="none"/>'),
  all: svg('<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><path d="M11.5 9v5M9 11.5h5"/>'),
  magnet: svg('<path d="M3.5 3v5a4.5 4.5 0 0 0 9 0V3h-3v5a1.5 1.5 0 0 1-3 0V3Z"/><path d="M3.5 5.5h3M9.5 5.5h3"/>'),
  more: svg('<circle cx="3.5" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1.2" fill="currentColor" stroke="none"/>'),
  measure: svg('<path d="M2.5 10.5 10.5 2.5l3 3-8 8Z"/><path d="m5 8 1.5 1.5M7 6l1 1M9 4l1.5 1.5"/>'),
  eraser: svg('<path d="M6 13.5h8M2.5 10 9 3.5l4 4-6 6H6Z"/>'),
  stay: svg('<path d="M12.5 6.5A5 5 0 1 0 13 9"/><path d="M13 3v3.5H9.5"/>'),
  sync: svg('<path d="M6.5 9.5 9.5 6.5M7 4.5l1.5-1.5a2.8 2.8 0 0 1 4 4L11 8.5M9 11.5 7.5 13a2.8 2.8 0 0 1-4-4L5 7.5"/>'),
  lock: svg('<rect x="3.5" y="7" width="9" height="6.5" rx="1.2"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>'),
  hide: svg('<path d="M2 8s2.3-4.5 6-4.5S14 8 14 8s-2.3 4.5-6 4.5S2 8 2 8Z"/><path d="M2.5 2.5l11 11"/>'),
  trash: svg('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9"/>'),
  search: svg('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>'),
  star: svg('<path d="M8 1.8 9.9 5.7l4.2.6-3 3 .7 4.2L8 11.5l-3.8 2 .7-4.2-3-3 4.2-.6Z"/>'),
  starOn: svg('<path d="M8 1.8 9.9 5.7l4.2.6-3 3 .7 4.2L8 11.5l-3.8 2 .7-4.2-3-3 4.2-.6Z" fill="currentColor"/>'),
}

// ── Prefs (this browser) ─────────────────────────────────────────────────────

interface Prefs {
  pins: string[]
  /** The magnet's strength when it is switched on. */
  snap: 'weak' | 'strong'
}
function readPrefs(): Prefs {
  try {
    const j = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>
    const pins = Array.isArray(j.pins) ? j.pins.filter((t): t is string => typeof t === 'string' && byType.has(t)).slice(0, PINS_MAX) : DEFAULT_PINS
    return { pins, snap: j.snap === 'strong' ? 'strong' : 'weak' }
  } catch {
    return { pins: DEFAULT_PINS.slice(), snap: 'weak' }
  }
}
const prefs = readPrefs()
function savePrefs(): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* private mode: this visit only */
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag)
  e.className = cls
  if (text != null) e.textContent = text
  return e
}

function button(doc: Document, cls: string, label: string, icon: string): HTMLButtonElement {
  const b = el(doc, 'button', cls)
  b.type = 'button'
  b.setAttribute('aria-label', label)
  b.dataset.tip = label
  b.innerHTML = icon
  return b
}

/** Keep a portalled box on screen beside `anchor`'s right edge. */
function placeBeside(box: HTMLElement, anchor: DOMRect, top: number): void {
  const doc = box.ownerDocument
  const vw = doc.documentElement.clientWidth
  const vh = doc.documentElement.clientHeight
  box.style.left = `${Math.min(anchor.right + 8, vw - box.offsetWidth - 8)}px`
  box.style.top = `${Math.max(8, Math.min(top, vh - box.offsetHeight - 8))}px`
}

// ── The rail ─────────────────────────────────────────────────────────────────

/** Mount the rail in Vela's toolbar column. Desktop only. Returns the teardown. */
export function bindDrawRail(ws: VelaWorkspace): () => void {
  const doc = ws.root.ownerDocument
  const column = ws.root.querySelector<HTMLElement>('.vela-ws-toolbar')
  if (!column) return () => {}

  const rail = el(doc, 'div', 'cb-dr')
  rail.setAttribute('role', 'toolbar')
  rail.setAttribute('aria-label', 'Drawing tools')
  rail.setAttribute('aria-orientation', 'vertical')
  const tip = el(doc, 'div', 'cb-dr-tip')
  tip.setAttribute('role', 'tooltip')
  doc.body.append(tip)

  let chart: Vela = ws.chart
  let offChart: Array<() => void> = []
  let drawer: { el: HTMLElement; close: () => void } | null = null
  let menu: { el: HTMLElement; close: () => void } | null = null
  let allBtn: HTMLButtonElement | null = null
  let moreBtn: HTMLButtonElement | null = null

  const keyOf = (type: string): string => {
    const id = KEY_IDS[type]
    return id ? (ws.keymap.bindings().find((b) => b.id === id)?.display[0] ?? '') : ''
  }
  const tool = (): string | null => chart.drawings.getTool()
  const mode = (): Mode => chart.drawings.getMode()
  const snap = (): Snap => chart.drawings.getSnapMode()

  // every chart shares the magnet and stay-in-mode, as Vela's bar did
  const everyChart = (fn: (c: Vela) => void) => {
    for (const c of ws.cells()) {
      try {
        fn(c.chart)
      } catch {
        /* a chart mid-rebuild: it picks the setting up from the next change */
      }
    }
  }
  const setSnap = (m: Snap) => everyChart((c) => c.drawings.setSnapMode(m))
  const setStay = (on: boolean) => everyChart((c) => c.drawings.setStayMode(on))
  const arm = (type: string | null) => {
    if (type) chart.drawings.setMode(null)
    chart.drawings.setTool(type as Parameters<Vela['drawings']['setTool']>[0])
    chart.renderer.focus()
  }
  const setMode = (m: Mode) => {
    chart.drawings.setMode(m)
    chart.renderer.focus()
  }

  // ── the tooltip ──
  let tipFor: HTMLElement | null = null
  const showTip = (b: HTMLElement) => {
    const label = b.dataset.tip
    if (!label || drawer || menu) return
    tipFor = b
    tip.replaceChildren(doc.createTextNode(label))
    const k = b.dataset.key
    if (k) tip.append(el(doc, 'kbd', '', k))
    tip.dataset.on = '1'
    const r = b.getBoundingClientRect()
    tip.style.left = `${r.right + 10}px`
    tip.style.top = `${r.top + r.height / 2 - tip.offsetHeight / 2}px`
  }
  const hideTip = () => {
    tipFor = null
    delete tip.dataset.on
  }
  rail.addEventListener('pointerover', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]')
    if (b && b !== tipFor) showTip(b)
  })
  rail.addEventListener('pointerleave', hideTip)
  rail.addEventListener('focusin', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]')
    if (b && (e.target as HTMLElement).matches(':focus-visible')) showTip(b)
  })
  rail.addEventListener('focusout', hideTip)

  // ── paint ──
  const paint = () => {
    const t = tool()
    const m = mode()
    const s = snap()
    rail.replaceChildren()
    const cursor = button(doc, 'cb-dr-btn', 'Cursor', ICON.cursor)
    cursor.setAttribute('aria-pressed', String(!t && !m))
    cursor.addEventListener('click', () => {
      arm(null)
      setMode(null)
    })
    rail.append(cursor, el(doc, 'div', 'cb-dr-sep'))
    for (const type of prefs.pins) {
      const def = byType.get(type)
      if (!def) continue
      const b = button(doc, 'cb-dr-btn cb-dr-tool', def.label, def.icon)
      const k = keyOf(type)
      if (k) b.dataset.key = k
      b.setAttribute('aria-pressed', String(t === type))
      b.addEventListener('click', () => arm(t === type ? null : type))
      rail.append(b)
    }
    // an armed tool that is not pinned shows on the drawer's button
    const loose = t && !prefs.pins.includes(t) ? byType.get(t) : undefined
    allBtn = button(doc, 'cb-dr-btn cb-dr-tool', loose ? `${loose.label} (every drawing tool)` : 'Every drawing tool', loose ? loose.icon : ICON.all)
    allBtn.setAttribute('aria-haspopup', 'dialog')
    allBtn.setAttribute('aria-expanded', String(!!drawer))
    allBtn.setAttribute('aria-pressed', String(!!loose || !!drawer))
    allBtn.addEventListener('click', () => (drawer ? closeDrawer() : openDrawer()))
    rail.append(allBtn, el(doc, 'div', 'cb-dr-sep'))
    const mag = button(doc, 'cb-dr-btn', s === 'off' ? 'Magnet: off' : `Magnet: ${s}`, ICON.magnet)
    mag.setAttribute('aria-pressed', String(s !== 'off'))
    mag.addEventListener('click', () => setSnap(snap() === 'off' ? prefs.snap : 'off'))
    moreBtn = button(doc, 'cb-dr-btn', 'Measure, eraser, magnet strength, sync, lock, hide…', ICON.more)
    moreBtn.setAttribute('aria-haspopup', 'menu')
    moreBtn.setAttribute('aria-expanded', String(!!menu))
    // measure / eraser live in ⋯: the button says when one is on
    if (m) moreBtn.dataset.lit = '1'
    moreBtn.addEventListener('click', () => (menu ? closeMenu() : openMenu()))
    rail.append(mag, moreBtn)
  }

  // ── the drawer: every tool, searchable, ★ to pin ──
  const closeDrawer = () => drawer?.close()
  const openDrawer = () => {
    closeMenu()
    hideTip()
    const box = el(doc, 'div', 'cb-dr-drawer')
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-label', 'Every drawing tool')
    const search = el(doc, 'label', 'cb-dr-search')
    search.innerHTML = ICON.search
    const input = el(doc, 'input', 'cb-dr-input')
    input.type = 'search'
    input.placeholder = `Search ${TOOLS.length} tools`
    input.setAttribute('aria-label', 'Search the drawing tools')
    input.autocomplete = 'off'
    input.spellcheck = false
    search.append(input)
    const list = el(doc, 'div', 'cb-dr-list')
    list.setAttribute('role', 'listbox')
    const foot = el(doc, 'div', 'cb-dr-foot', '★ pins a tool to the rail · ↑↓ Enter · Esc closes')
    box.append(search, list, foot)
    let rows: Array<{ row: HTMLElement; type: string }> = []
    let active = 0
    const setActive = (i: number) => {
      if (!rows.length) return
      active = (i + rows.length) % rows.length
      rows.forEach((r, j) => r.row.toggleAttribute('data-active', j === active))
      rows[active]?.row.scrollIntoView({ block: 'nearest' })
    }
    const choose = (type: string) => {
      closeDrawer()
      arm(type)
    }
    const draw = () => {
      const q = input.value.trim().toLowerCase()
      list.replaceChildren()
      rows = []
      let section = ''
      for (const t of TOOLS) {
        if (q && !t.label.toLowerCase().includes(q) && !t.section.toLowerCase().includes(q)) continue
        if (t.section !== section) {
          section = t.section
          list.append(el(doc, 'div', 'cb-dr-gh', section.toUpperCase()))
        }
        const row = el(doc, 'div', 'cb-dr-row')
        row.setAttribute('role', 'option')
        const ic = el(doc, 'span', 'cb-dr-ric')
        ic.innerHTML = t.icon
        const pinned = prefs.pins.includes(t.type)
        const star = el(doc, 'button', 'cb-dr-star')
        star.type = 'button'
        star.setAttribute('aria-pressed', String(pinned))
        star.setAttribute('aria-label', `${pinned ? 'Unpin' : 'Pin'} ${t.label} ${pinned ? 'from' : 'to'} the rail`)
        star.title = pinned ? 'Unpin from the rail' : prefs.pins.length >= PINS_MAX ? `The rail holds ${PINS_MAX}: unpin one first` : 'Pin to the rail'
        star.innerHTML = pinned ? ICON.starOn : ICON.star
        star.disabled = !pinned && prefs.pins.length >= PINS_MAX
        star.addEventListener('click', (e) => {
          e.stopPropagation()
          prefs.pins = pinned ? prefs.pins.filter((x) => x !== t.type) : [...prefs.pins, t.type]
          savePrefs()
          const keep = list.scrollTop
          draw()
          list.scrollTop = keep
          paint()
          // the star was redrawn: typing and Enter carry on in the search box
          input.focus({ preventScroll: true })
        })
        row.append(ic, el(doc, 'span', 'cb-dr-rl', t.label), el(doc, 'kbd', 'cb-dr-rk', keyOf(t.type)), star)
        if (tool() === t.type) row.dataset.current = '1'
        const i = rows.length
        row.addEventListener('pointermove', () => {
          if (active !== i) setActive(i)
        })
        row.addEventListener('click', () => choose(t.type))
        list.append(row)
        rows.push({ row, type: t.type })
      }
      if (!rows.length) list.append(el(doc, 'div', 'cb-dr-empty', `No tool matches "${input.value.trim()}"`))
      setActive(0)
    }
    input.addEventListener('input', draw)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setActive(active + (e.key === 'ArrowDown' ? 1 : -1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const r = rows[active]
        if (r) choose(r.type)
      }
    })
    draw()
    doc.body.append(box)
    const rr = rail.getBoundingClientRect()
    box.style.height = `${Math.min(560, doc.documentElement.clientHeight - rr.top - 12)}px`
    placeBeside(box, rr, rr.top)
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!box.contains(t) && !(allBtn?.contains(t) ?? false)) closeDrawer()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      closeDrawer()
      allBtn?.focus()
    }
    doc.addEventListener('pointerdown', onDown, true)
    doc.addEventListener('keydown', onKey, true)
    drawer = {
      el: box,
      close: () => {
        doc.removeEventListener('pointerdown', onDown, true)
        doc.removeEventListener('keydown', onKey, true)
        box.remove()
        drawer = null
        paint()
      },
    }
    paint()
    input.focus()
  }

  // ── ⋯: the utilities ──
  const closeMenu = () => menu?.close()
  const openMenu = () => {
    closeDrawer()
    hideTip()
    const box = el(doc, 'div', 'cb-dr-menu')
    box.setAttribute('role', 'menu')
    box.setAttribute('aria-label', 'Drawing options')
    const draw = () => {
      box.replaceChildren()
      const m = mode()
      const head = (t: string) => box.append(el(doc, 'div', 'cb-dr-mh', t))
      const item = (icon: string, label: string, on: boolean | null, run: () => void, hint = '') => {
        const b = el(doc, 'button', 'cb-dr-mi')
        b.type = 'button'
        b.setAttribute('role', on == null ? 'menuitem' : 'menuitemcheckbox')
        if (on != null) b.setAttribute('aria-checked', String(on))
        const ic = el(doc, 'span', 'cb-dr-mic')
        ic.innerHTML = icon
        b.append(ic, el(doc, 'span', 'cb-dr-ml', label))
        if (on != null) b.append(el(doc, 'span', 'cb-dr-sw'))
        else b.append(el(doc, 'kbd', '', hint))
        b.addEventListener('click', () => {
          run()
          draw()
        })
        box.append(b)
      }
      head('DRAWING')
      item(ICON.measure, 'Measure', m === 'measure', () => setMode(mode() === 'measure' ? null : 'measure'))
      item(ICON.eraser, 'Eraser', m === 'eraser', () => setMode(mode() === 'eraser' ? null : 'eraser'))
      item(ICON.stay, 'Stay in drawing mode', chart.drawings.getStayMode(), () => setStay(!chart.drawings.getStayMode()))
      const synced = !!ws.sync.get('drawings')
      item(ICON.sync, 'Sync drawings on all charts', synced, () => ws.sync.set('drawings', synced ? false : true))
      box.append(el(doc, 'div', 'cb-dr-msep'))
      head('MAGNET')
      const seg = el(doc, 'div', 'cb-dr-seg')
      seg.setAttribute('role', 'radiogroup')
      seg.setAttribute('aria-label', 'Magnet strength')
      for (const s of ['off', 'weak', 'strong'] as const) {
        const b = el(doc, 'button', '', s.charAt(0).toUpperCase() + s.slice(1))
        b.type = 'button'
        b.setAttribute('role', 'radio')
        b.setAttribute('aria-checked', String(snap() === s))
        b.addEventListener('click', () => {
          if (s !== 'off') {
            prefs.snap = s
            savePrefs()
          }
          setSnap(s)
          draw()
        })
        seg.append(b)
      }
      box.append(seg, el(doc, 'div', 'cb-dr-msep'))
      head('THIS CHART')
      const all = chart.drawings.all()
      const n = all.length
      const locked = n > 0 && all.every((d) => d.locked)
      const hidden = n > 0 && all.every((d) => !d.visible)
      const many = (patch: { locked?: boolean; visible?: boolean }) => chart.drawings.updateMany(all.map((d) => ({ id: d.id, patch })))
      item(ICON.lock, locked ? 'Unlock all drawings' : 'Lock all drawings', null, () => n && many({ locked: !locked }), n ? String(n) : '')
      item(ICON.hide, hidden ? 'Show all drawings' : 'Hide all drawings', null, () => n && many({ visible: hidden }), n ? String(n) : '')
      item(ICON.trash, 'Remove all drawings', null, () => n && chart.drawings.removeMany(all.map((d) => d.id)), n ? 'Ctrl+Z undoes' : '')
      for (const b of box.querySelectorAll<HTMLButtonElement>('.cb-dr-mi')) {
        if (!n && /all drawings/.test(b.textContent ?? '')) b.disabled = true
      }
    }
    draw()
    doc.body.append(box)
    const r = moreBtn?.getBoundingClientRect() ?? rail.getBoundingClientRect()
    placeBeside(box, rail.getBoundingClientRect(), r.top - 6)
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!box.contains(t) && !(moreBtn?.contains(t) ?? false)) closeMenu()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      closeMenu()
      moreBtn?.focus()
    }
    doc.addEventListener('pointerdown', onDown, true)
    doc.addEventListener('keydown', onKey, true)
    menu = {
      el: box,
      close: () => {
        doc.removeEventListener('pointerdown', onDown, true)
        doc.removeEventListener('keydown', onKey, true)
        box.remove()
        menu = null
        paint()
      },
    }
    paint()
    box.querySelector<HTMLButtonElement>('button')?.focus()
  }

  // ── follow the active chart ──
  const wire = () => {
    for (const off of offChart) off()
    const prev = chart
    const armed = prev.drawings.getTool()
    chart = ws.chart
    // an armed tool follows the active chart
    if (prev !== chart && armed && !chart.drawings.getTool()) {
      try {
        prev.drawings.setTool(null)
      } catch {
        /* the previous chart is gone */
      }
      chart.drawings.setTool(armed)
    }
    offChart = (['drawing:tool', 'drawing:mode', 'drawing:snap', 'drawing:stay'] as const).map((ev) => chart.on(ev, () => paint()))
    paint()
  }
  const offs = [
    ws.on('cell:active', wire),
    ws.on('layout:changed', wire),
    // a chart a layout change mints takes the shared magnet and stay-in-mode
    ws.on('cell:created', ({ id }) => {
      const c = ws.cell(id)?.chart
      if (!c) return
      try {
        c.drawings.setSnapMode(snap())
        c.drawings.setStayMode(chart.drawings.getStayMode())
      } catch {
        /* not ready: its own default until the next change */
      }
    }),
  ]

  column.append(rail)
  ws.root.classList.add('cb-dr-on')
  wire()

  return () => {
    closeDrawer()
    closeMenu()
    for (const off of offChart) off()
    for (const off of offs) off()
    ws.root.classList.remove('cb-dr-on')
    rail.remove()
    tip.remove()
  }
}
