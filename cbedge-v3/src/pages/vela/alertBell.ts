// ─────────────────────────────────────────────────────────────────────────────
// THE ALERTS BELL: today's alerts, in the toolbar, kept in Postgres for the day.
//
// Brandon, 2026-10-08: "old alerts needs to go on the bell in the toolbar.
// historical. save for the day only. in postgresql".
//
// Vela's own bell only knew the alerts its charts raised since the page opened:
// a reload emptied it, and the alerts this page raises itself (Level alerts and
// CB Script, pages/vela/script/alerts.ts) never reached it at all. This bell
// takes its slot in the top bar (Vela.tsx DESKTOP_TOPBAR) and holds all three:
//
//   Level    a Level alert crossing (★ Volt crossed up …)      levels/levelAlerts.ts
//   Script   a CB Script alertcondition() / alert()            script/alerts.ts
//   Chart    one of Vela's own chart alerts                     chart 'alert' events
//
// Every ring is written to /api/vela/alerts (server-v2/vela-alerts.cjs) under the
// signed-in account and read back when the page opens, so the bell shows the
// whole day: after a reload, on a second tab, on the phone. TODAY ONLY: the
// server keeps the New York day's rows and deletes older ones; here a row from
// another day is dropped the moment the date turns.
//
// The button carries the count of alerts not yet looked at (this browser);
// opening the list marks them seen. Clear empties today's list everywhere.
// Signed out, or the server unreachable, the bell still works for this tab.
// ─────────────────────────────────────────────────────────────────────────────

import { registerWidgetAction, type WidgetContext } from '@luxalgo/vela'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { onScriptAlertFired, tfLabel, type FiredAlert } from '@/pages/vela/script/alerts'
import { LEVELS_PANEL_ID } from '@/pages/vela/levels/levelAlertsEntry'
import { etDateKey } from '@/pages/vela/studies/common'

export const ALERT_BELL_ID = 'cb-alerts'

type Kind = 'level' | 'script' | 'chart'

interface BellAlert {
  key: string
  kind: Kind
  symbol: string
  title: string
  text: string
  meta: string
  at: number
}

const URL_ = '/api/vela/alerts'
const SEEN_KEY = 'cb-vela-alerts-seen'
const KIND_LABEL: Record<Kind, string> = { level: 'Level', script: 'Script', chart: 'Chart' }

let items: BellAlert[] = []
let loaded = false
let current: VelaWorkspace | null = null
let registered = false
const listeners = new Set<() => void>()
const changed = () => {
  for (const fn of listeners) fn()
}

const today = () => etDateKey(Date.now())
/** Drop anything from before today (the list outlives midnight on an open page). */
function keepToday(): void {
  const d = today()
  const n = items.length
  items = items.filter((a) => etDateKey(a.at) === d)
  if (items.length !== n) changed()
}

function readSeen(): number {
  try {
    const v = Number(localStorage.getItem(SEEN_KEY))
    return Number.isFinite(v) ? v : 0
  } catch {
    return 0
  }
}
function writeSeen(ts: number): void {
  try {
    localStorage.setItem(SEEN_KEY, String(ts))
  } catch {
    /* private mode */
  }
}
const unseen = () => {
  const s = readSeen()
  return items.filter((a) => a.at > s).length
}

async function load(): Promise<void> {
  try {
    const r = await fetch(URL_, { credentials: 'include', cache: 'no-store' })
    if (!r.ok) return
    const j = (await r.json()) as { alerts?: BellAlert[] }
    const server = Array.isArray(j.alerts) ? j.alerts : []
    // merge: the server's rows, plus anything this tab rang that has not landed yet
    const byKey = new Map<string, BellAlert>()
    for (const a of server) if (a && a.key) byKey.set(a.key, { ...a, symbol: a.symbol ?? '', title: a.title ?? '', text: a.text ?? '', meta: a.meta ?? '' })
    for (const a of items) if (!byKey.has(a.key)) byKey.set(a.key, a)
    items = [...byKey.values()].sort((a, b) => b.at - a.at)
    keepToday()
    changed()
  } catch {
    /* offline or signed out: this tab's own rings still show */
  } finally {
    loaded = true
  }
}

/** One ring: into the list now, and to the server for the rest of the day. */
function record(a: BellAlert): void {
  if (items.some((x) => x.key === a.key)) return
  items = [a, ...items].slice(0, 500)
  keepToday()
  changed()
  void fetch(URL_, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(a),
  }).catch(() => {})
}

function fromScript(f: FiredAlert): BellAlert {
  const level = f.libId === 'levels'
  return {
    key: `${f.libId}|${f.symbol}|${f.title}|${f.barTime}`,
    kind: level ? 'level' : 'script',
    symbol: f.symbol,
    title: f.title,
    text: f.text,
    meta: `${f.script} · ${tfLabel(f.timeframe)}`,
    at: f.at,
  }
}

// ── the button's count ──
function buttonOf(root: ParentNode | null): HTMLButtonElement | null {
  if (!root) return null
  for (const b of root.querySelectorAll<HTMLButtonElement>('.vela-topbar-right button')) {
    if (b.getAttribute('aria-label') === 'Alerts' || b.dataset.cbAlb === '1') return b
  }
  return null
}
function paintBadge(): void {
  const b = buttonOf(current?.root ?? null)
  if (!b) return
  b.dataset.cbAlb = '1'
  b.classList.add('cb-alb-btn')
  let badge = b.querySelector<HTMLElement>(':scope > .cb-alb-badge')
  const n = unseen()
  if (!n) {
    badge?.remove()
    return
  }
  if (!badge) {
    badge = document.createElement('span')
    badge.className = 'cb-alb-badge'
    badge.setAttribute('aria-hidden', 'true')
    b.appendChild(badge)
  }
  const t = n > 99 ? '99+' : String(n)
  if (badge.textContent !== t) badge.textContent = t
  b.setAttribute('aria-label', 'Alerts')
  b.title = `Alerts · ${n} new today`
}

// ── the list ──
let open: { close: () => void } | null = null

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = cls
  if (text != null) e.textContent = text
  return e
}

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'America/New_York' })

function toggleList(ctx: WidgetContext): void {
  if (open) {
    open.close()
    return
  }
  const anchor = buttonOf(ctx.host)
  const menu = el('div', 'cb-alb')
  menu.setAttribute('role', 'dialog')
  menu.setAttribute('aria-label', "Today's alerts")
  menu.style.cssText = 'position:fixed;z-index:80'
  document.body.appendChild(menu)
  anchor?.setAttribute('aria-expanded', 'true')
  const seenBefore = readSeen()

  const place = () => {
    const r = anchor?.getBoundingClientRect()
    const w = Math.min(380, window.innerWidth - 16)
    menu.style.width = `${w}px`
    const left = r ? Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) : Math.max(8, (window.innerWidth - w) / 2)
    menu.style.left = `${left}px`
    menu.style.top = `${r ? r.bottom + 6 : 60}px`
    menu.style.maxHeight = `${Math.max(200, window.innerHeight - (r ? r.bottom + 6 : 60) - 12)}px`
  }

  const draw = () => {
    keepToday()
    menu.replaceChildren()
    const head = el('div', 'cb-alb-head')
    head.append(el('span', 'cb-alb-title', 'Alerts'), el('span', 'cb-alb-count', items.length ? `${items.length} today` : 'today'))
    if (items.length) {
      const clear = el('button', 'cb-alb-clear', 'Clear')
      clear.type = 'button'
      clear.title = "Clear today's alerts (every tab and device)"
      clear.addEventListener('click', () => {
        items = []
        changed()
        void fetch(URL_, { method: 'DELETE', credentials: 'include' }).catch(() => {})
      })
      head.append(clear)
    }
    menu.append(head)
    const list = el('div', 'cb-alb-list')
    if (!items.length) {
      list.append(el('div', 'cb-alb-empty', loaded ? 'No alerts yet today. Level and script alerts land here and stay until midnight ET.' : 'Loading…'))
    }
    for (const a of items) {
      const row = el('button', 'cb-alb-row')
      row.type = 'button'
      if (a.at > seenBefore) row.dataset.new = '1'
      const top = el('span', 'cb-alb-top')
      const chip = el('span', 'cb-alb-kind', KIND_LABEL[a.kind] ?? a.kind)
      chip.dataset.k = a.kind
      top.append(chip, el('span', 'cb-alb-sym', a.symbol), el('span', 'cb-alb-name', a.title), el('span', 'cb-alb-at', clock(a.at)))
      row.append(top)
      if (a.text) row.append(el('span', 'cb-alb-text', a.text))
      if (a.meta) row.append(el('span', 'cb-alb-meta', a.meta))
      row.title = 'Show this symbol'
      // a chart already on that symbol becomes the active one
      row.addEventListener('click', () => {
        const ws = current
        if (!ws) return
        const want = a.symbol.toUpperCase()
        for (const c of ws.cells()) {
          const cell = ws.cell(c.id)
          const sym = String(cell?.chart.market.symbol ?? '').replace(/^[^:]*:/, '').toUpperCase()
          if (cell && sym === want) {
            ws.setActiveCell(c.id)
            break
          }
        }
        close()
      })
      list.append(row)
    }
    menu.append(list)
    // the Level Alerts panel, where level alerts are armed (2026-10-10): the bell is
    // the list of what rang; this opens the panel that sets them
    const acts = el('div', 'cb-alb-acts')
    for (const [label, id, title] of [['Level alerts', LEVELS_PANEL_ID, 'Open the Level Alerts panel (Alt+A)']] as const) {
      const b = el('button', 'cb-alb-open', `${label} ›`)
      b.type = 'button'
      b.title = title
      b.addEventListener('click', () => {
        close()
        ctx.togglePanel(id, true)
      })
      acts.append(b)
    }
    menu.append(acts)
    menu.append(el('div', 'cb-alb-foot', 'Kept for today only · clears at midnight ET'))
  }

  const outside = (e: PointerEvent) => {
    const t = e.target as Node
    if (!menu.contains(t) && t !== anchor && !anchor?.contains(t)) close()
  }
  const esc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
    }
  }
  const off = (() => {
    listeners.add(draw)
    return () => listeners.delete(draw)
  })()
  const close = () => {
    off()
    menu.remove()
    anchor?.setAttribute('aria-expanded', 'false')
    document.removeEventListener('pointerdown', outside, true)
    document.removeEventListener('keydown', esc, true)
    window.removeEventListener('resize', place)
    open = null
    paintBadge()
  }
  draw()
  place()
  // looked at: everything now in the list is seen
  writeSeen(Math.max(readSeen(), items[0]?.at ?? 0, Date.now()))
  paintBadge()
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', esc, true)
  }, 0)
  window.addEventListener('resize', place)
  open = { close }
  if (!loaded) void load()
}

export function registerAlertBell(): void {
  if (registered) return
  registered = true
  registerWidgetAction({
    id: ALERT_BELL_ID,
    target: 'topbar',
    label: 'Alerts',
    icon: 'bell',
    iconOnly: true,
    mobile: 'menu',
    run: (ctx) => toggleList(ctx),
  })
}

/** Load today's alerts, listen for new ones (all three kinds), keep the count painted. */
export function bindAlertBell(ws: VelaWorkspace): () => void {
  current = ws
  const offs: Array<() => void> = []
  void load().then(paintBadge)
  offs.push(onScriptAlertFired((f) => record(fromScript(f))))
  // Vela's own chart alerts, from every chart, including ones added later
  const wired = new Set<string>()
  const wire = (id: string) => {
    if (wired.has(id)) return
    const cell = ws.cell(id)
    if (!cell) return
    wired.add(id)
    offs.push(
      cell.chart.on('alert', (a) => {
        const sym = String(cell.chart.market.symbol ?? '').replace(/^[^:]*:/, '')
        const tf = String(cell.chart.market.timeframe ?? '')
        record({
          key: `chart|${sym}|${a.indicator ?? ''}|${a.title ?? ''}|${a.time}`,
          kind: 'chart',
          symbol: sym,
          title: a.title ?? 'Alert',
          text: a.message ?? '',
          meta: [a.indicator, tf && tfLabel(tf)].filter(Boolean).join(' · '),
          at: Date.now(),
        })
      }),
    )
  }
  for (const c of ws.cells()) wire(c.id)
  offs.push(ws.on('cell:created', ({ id }) => wire(id)))
  const repaint = () => paintBadge()
  listeners.add(repaint)
  // the top bar can be rebuilt (layout, theme): keep the badge on the button
  const tick = setInterval(() => {
    keepToday()
    paintBadge()
  }, 15_000)
  // another tab or device may have rung: re-read now and then
  const poll = setInterval(() => {
    if (!document.hidden) void load()
  }, 120_000)
  return () => {
    listeners.delete(repaint)
    clearInterval(tick)
    clearInterval(poll)
    for (const off of offs) off()
    open?.close()
    if (current === ws) current = null
  }
}
