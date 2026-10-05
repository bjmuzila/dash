// ─────────────────────────────────────────────────────────────────────────────
// The session clock itself (sessionClock.ts has the why). Loaded once the chart
// is up. Three pieces, all following the ACTIVE chart:
//
//   · the chip     Vela renders our pinned "Time zone" action as a plain button;
//                  this dresses it as  ● RTH  closes in 2:14:47 │ 13:45:13 ET
//                  and re-dresses it if Vela ever rebuilds it. A click opens the
//                  time-zone menu (below).
//   · RTH / ETH    Vela's timeframe button reads "5m · RTH", and its menu gets a
//                  SESSION row at the foot with the two buttons. Both are added to
//                  Vela's own button and menu (it offers no seam for either) and
//                  put back whenever Vela redraws them. The switch is the active
//                  chart's, as the bottom strip's was. A symbol with one session
//                  shows no tag and greys the row out.
//   · the zones    New York, Chicago, London, Frankfurt, Tokyo, and this computer's
//                  own zone when it is none of those. A pick goes through Vela's
//                  setTimezone, so every chart's time axis and this clock move
//                  together, and the choice is saved with the layout. Vela's
//                  time-axis menu still has every zone.
//
// THE SESSION. From the provider's own calendar (cbedgeProvider sessionWindows,
// the one behind the chart's session shading), in the chart's time zone:
//
//   index    RTH · closes in   Pre-market · opens in    Closed · opens …
//   stock    RTH · closes in   Pre-market · opens in    After hours · ends in   Closed · opens …
//   future   RTH · closes in   Globex · RTH opens in    Globex · closes in      Closed · opens …
//
// "Closed" counts down when the open is under 12 hours away, and names the day
// and time when it is further ("opens Mon 09:30"). Like the calendar, this knows
// weekends but not exchange holidays.
// ─────────────────────────────────────────────────────────────────────────────

import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { resolveSym, sessionWindows, type SymKind } from '@/pages/vela/cbedgeProvider'
import { normTicker } from '@/pages/vela/watchlist/store'

const DAY_MS = 86_400_000
/** "Closed" counts down below this; above it, it names the day and time. */
const COUNTDOWN_MS = 12 * 3_600_000

// ── The session ──────────────────────────────────────────────────────────────

export type Phase = 'rth' | 'pre' | 'post' | 'globex' | 'closed'

export interface SessionRead {
  phase: Phase
  label: string
  /** What happens at `at`: "closes", "opens", "RTH opens", "ends". */
  verb: string
  at: number | null
}

type Windows = ReadonlyArray<readonly [number, number]>

let cache: { kind: SymKind; from: number; rth: Windows; ext: Windows } | null = null

function windowsFor(kind: SymKind, now: number): { rth: Windows; ext: Windows } {
  if (!cache || cache.kind !== kind || now < cache.from || now - cache.from > DAY_MS) {
    const from = now - 2 * DAY_MS
    const to = now + 10 * DAY_MS
    cache = {
      kind,
      from,
      rth: sessionWindows(kind, from, to, 'regular'),
      // An index has no extended tape; its pre-market is the cash names' (04:00 on).
      ext: sessionWindows(kind === 'index' ? 'stock' : kind, from, to, 'extended'),
    }
  }
  return cache
}

const inside = (w: Windows, t: number) => w.find(([s, e]) => t >= s && t < e)
const nextStart = (w: Windows, t: number) => w.find(([s]) => s > t)?.[0] ?? null

/** Where `kind`'s session stands at `now`. */
export function readSession(kind: SymKind, now: number): SessionRead {
  const { rth, ext } = windowsFor(kind, now)
  const r = inside(rth, now)
  if (r) return { phase: 'rth', label: 'RTH', verb: 'closes', at: r[1] }
  const nextR = nextStart(rth, now)
  const e = inside(ext, now)
  if (e) {
    const rthAhead = nextR != null && nextR < e[1]
    if (kind === 'futures') {
      return rthAhead
        ? { phase: 'globex', label: 'Globex', verb: 'RTH opens', at: nextR }
        : { phase: 'globex', label: 'Globex', verb: 'closes', at: e[1] }
    }
    if (rthAhead) return { phase: 'pre', label: 'Pre-market', verb: 'opens', at: nextR }
    // an index has no after hours: the cash names' evening is "closed" for it
    if (kind !== 'index') return { phase: 'post', label: 'After hours', verb: 'ends', at: e[1] }
  }
  // A future reopens with Globex (18:00 ET); everything else at the cash open.
  return { phase: 'closed', label: 'Closed', verb: 'opens', at: kind === 'futures' ? nextStart(ext, now) : nextR }
}

// ── Time, in the charts' zone ────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0')

/** 2:14:47 */
export function hms(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
}

const fmts = new Map<string, Intl.DateTimeFormat>()
function fmt(key: string, make: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
  let f = fmts.get(key)
  if (!f) {
    f = make()
    fmts.set(key, f)
  }
  return f
}

function partsOf(f: Intl.DateTimeFormat, ms: number): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of f.formatToParts(ms)) out[p.type] = p.value
  return out
}

/** 13:45:13 */
function clockTime(ms: number, tz: string): string {
  const p = partsOf(
    fmt(`t|${tz}`, () => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })),
    ms,
  )
  return `${p.hour}:${p.minute}:${p.second}`
}

/** Mon 09:30 */
function dayTime(ms: number, tz: string): string {
  const p = partsOf(
    fmt(`d|${tz}`, () => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })),
    ms,
  )
  return `${p.weekday} ${p.hour}:${p.minute}`
}

const ZONES: ReadonlyArray<{ zone: string; city: string; tag: string }> = [
  { zone: 'America/New_York', city: 'New York', tag: 'ET' },
  { zone: 'America/Chicago', city: 'Chicago', tag: 'CT' },
  { zone: 'Europe/London', city: 'London', tag: 'UK' },
  { zone: 'Europe/Berlin', city: 'Frankfurt', tag: 'CET' },
  { zone: 'Asia/Tokyo', city: 'Tokyo', tag: 'JST' },
]

/** ET, CT, UK… or what the browser calls the zone (GMT+2). */
function zoneTag(tz: string): string {
  const z = ZONES.find((x) => x.zone === tz)
  if (z) return z.tag
  if (tz === 'UTC' || tz === 'Etc/UTC') return 'UTC'
  try {
    return partsOf(fmt(`z|${tz}`, () => new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })), Date.now()).timeZoneName ?? tz
  } catch {
    return tz
  }
}

function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

// ── The page's workspace ─────────────────────────────────────────────────────

let current: VelaWorkspace | null = null
/** Repaint the chip and the timeframe tag now (after a pick), not on the next second. */
let repaint: () => void = () => {}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag)
  e.className = cls
  if (text != null) e.textContent = text
  return e
}

const setText = (e: HTMLElement, v: string) => {
  if (e.textContent !== v) e.textContent = v
}

/** The chip: our pinned action on the right of the bar, dressed already or Vela's fresh button. */
function chipOf(ws: VelaWorkspace): HTMLButtonElement | null {
  for (const b of ws.root.querySelectorAll<HTMLButtonElement>('.vela-topbar-right button')) {
    if (b.classList.contains('cb-clk') || b.textContent?.trim() === 'Time zone') return b
  }
  return null
}

const sessionTag = (ws: VelaWorkspace) => {
  const c = ws.active
  return c.sessionAvailable ? (c.session === 'extended' ? 'ETH' : 'RTH') : ''
}

export function bindSessionClock(ws: VelaWorkspace): () => void {
  current = ws
  const doc = ws.root.ownerDocument

  // ── the chip ──
  let chip: HTMLButtonElement | null = null
  let parts: { ses: HTMLElement; lab: HTMLElement; verb: HTMLElement; val: HTMLElement; t: HTMLElement; z: HTMLElement } | null = null
  const dress = (b: HTMLButtonElement) => {
    const ses = el(doc, 'span', 'cb-clk-ses')
    const lab = el(doc, 'b', 'cb-clk-lab')
    const verb = el(doc, 'span', 'cb-clk-verb')
    const val = el(doc, 'span', 'cb-clk-val')
    ses.append(el(doc, 'i', 'cb-clk-dot'), lab, verb, val)
    const t = el(doc, 'span', 'cb-clk-t')
    const z = el(doc, 'span', 'cb-clk-z')
    b.classList.add('cb-clk')
    b.setAttribute('aria-haspopup', 'menu')
    b.setAttribute('aria-expanded', 'false')
    b.replaceChildren(ses, el(doc, 'span', 'cb-clk-sep'), t, z)
    parts = { ses, lab, verb, val, t, z }
  }

  const paintChip = () => {
    if (!chip || !chip.isConnected || !chip.querySelector('.cb-clk-ses')) {
      chip = chipOf(ws)
      parts = null
      if (chip) dress(chip)
    }
    if (!chip || !parts) return
    const now = Date.now()
    const cell = ws.active
    const tz = cell.displayTimezone
    const r = readSession(resolveSym(normTicker(cell.symbol) ?? '').kind, now)
    parts.ses.dataset.phase = r.phase
    setText(parts.lab, r.label)
    const left = r.at == null ? null : r.at - now
    if (left == null) {
      setText(parts.verb, '')
      setText(parts.val, '')
    } else if (r.phase === 'closed' && left > COUNTDOWN_MS) {
      setText(parts.verb, r.verb)
      setText(parts.val, dayTime(r.at!, tz))
    } else {
      setText(parts.verb, `${r.verb} in`)
      setText(parts.val, hms(left))
    }
    setText(parts.t, clockTime(now, tz))
    const tag = zoneTag(tz)
    setText(parts.z, tag)
    const aria = `Time zone ${tag}. ${r.label}${parts.verb.textContent ? `, ${parts.verb.textContent} ${parts.val.textContent}` : ''}`
    if (chip.title !== aria) chip.title = aria
    chip.setAttribute('aria-label', `Time zone, ${tag}`)
  }

  // ── RTH / ETH on Vela's timeframe button and in its menu ──
  let tfBtn: HTMLElement | null = null
  let menuEl: HTMLElement | null = null
  const tfMo = new MutationObserver(() => paintTf())
  const menuMo = new MutationObserver(() => paintMenu())

  const paintMenu = () => {
    const id = tfBtn?.getAttribute('aria-controls')
    const ul = id ? doc.getElementById(id) : null
    if (ul !== menuEl) {
      menuMo.disconnect()
      menuEl = ul
      if (ul) menuMo.observe(ul, { childList: true, attributes: true, attributeFilter: ['data-state'] })
    }
    if (!ul || ul.dataset.state !== 'open') return
    let sec = ul.querySelector<HTMLElement>(':scope > .cb-tf-sec')
    if (!sec) {
      const sep = el(doc, 'li', 'cb-tf-sep')
      sep.setAttribute('role', 'separator')
      sec = el(doc, 'li', 'cb-tf-sec')
      sec.setAttribute('role', 'none')
      const seg = el(doc, 'div', 'cb-tf-seg')
      seg.setAttribute('role', 'group')
      seg.setAttribute('aria-label', 'Session')
      const opt = (s: 'regular' | 'extended', text: string, title: string) => {
        const b = el(doc, 'button', 'cb-tf-opt', text)
        b.type = 'button'
        b.dataset.s = s
        b.title = title
        // out of the tab order: Vela's menu would focus the first one on open (the
        // keyboard path to the session is chart settings → Symbol → Session)
        b.tabIndex = -1
        return b
      }
      seg.append(
        opt('regular', 'RTH', 'Regular hours only, 09:30 to 16:00 ET'),
        opt('extended', 'ETH', 'Every session: pre-market, after hours and, on futures, Globex'),
      )
      // inside Vela's menu: keep the press to ourselves, or the menu reads it as its own
      for (const t of ['pointerdown', 'pointerup', 'mousedown'] as const) seg.addEventListener(t, (e) => e.stopPropagation())
      seg.addEventListener('click', (e) => {
        e.stopPropagation()
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.cb-tf-opt')
        if (!b || b.disabled) return
        const s = b.dataset.s === 'extended' ? 'extended' : 'regular'
        if (ws.active.session !== s) ws.active.setSession(s)
        repaint()
      })
      sec.append(el(doc, 'div', 'cb-tf-h', 'Session'), seg, el(doc, 'div', 'cb-tf-note', 'One session for this symbol'))
      ul.append(sep, sec)
    }
    const c = ws.active
    sec.dataset.off = c.sessionAvailable ? '' : '1'
    for (const b of sec.querySelectorAll<HTMLButtonElement>('.cb-tf-opt')) {
      b.disabled = !c.sessionAvailable
      b.setAttribute('aria-pressed', String(c.sessionAvailable && b.dataset.s === c.session))
    }
  }

  const paintTf = () => {
    const b = ws.root.querySelector<HTMLElement>('.vela-widget-topbar .vela-widget-tf-caret')
    if (b !== tfBtn) {
      tfMo.disconnect()
      tfBtn = b
      if (b) tfMo.observe(b, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'] })
    }
    if (!b) return
    const want = sessionTag(ws)
    let s = b.querySelector<HTMLElement>('.cb-tf-ses')
    if (!want) s?.remove()
    else {
      if (!s) {
        s = el(doc, 'span', 'cb-tf-ses')
        b.insertBefore(s, b.querySelector(':scope > .vela-icon'))
      }
      setText(s, `· ${want}`)
    }
    if (b.getAttribute('aria-expanded') === 'true') {
      paintMenu()
      // the menu's content can render a frame after the button flips
      requestAnimationFrame(paintMenu)
    }
  }

  repaint = () => {
    paintChip()
    paintTf()
    if (menuEl?.dataset.state === 'open') paintMenu()
  }

  // once a second, on the second: the clock, the countdown, and anything Vela redrew
  let timer = 0
  const loop = () => {
    repaint()
    timer = window.setTimeout(loop, 1000 - (Date.now() % 1000) + 8)
  }
  loop()
  // a chart switching symbol, session or focus: now, not on the next second
  const offs = [ws.on('cell:active', () => repaint()), ws.on('state:changed', () => repaint())]

  return () => {
    clearTimeout(timer)
    for (const off of offs) off()
    tfMo.disconnect()
    menuMo.disconnect()
    closeZoneMenu?.()
    repaint = () => {}
    if (current === ws) current = null
  }
}

// ── The time-zone menu (the chip's click) ────────────────────────────────────

let closeZoneMenu: (() => void) | null = null

export function toggleZoneMenu(): void {
  if (closeZoneMenu) {
    closeZoneMenu()
    return
  }
  const ws = current
  if (!ws) return
  const doc = ws.root.ownerDocument
  const chip = chipOf(ws)
  const anchor = chip?.offsetParent ? chip : null

  const menu = el(doc, 'div', 'cb-wsm cb-zm')
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', 'Time zone')
  menu.style.cssText = 'position:fixed;z-index:80'
  const group = el(doc, 'div', 'cb-wsm-group')
  group.append(el(doc, 'div', 'cb-wsm-h', 'Time zone'))
  const here = localZone()
  const list = ZONES.some((z) => z.zone === here) ? ZONES : [...ZONES, { zone: here, city: 'This computer', tag: zoneTag(here) }]
  const on = ws.active.displayTimezone
  const rows: HTMLButtonElement[] = []
  for (const z of list) {
    const b = el(doc, 'button', 'cb-wsm-row')
    b.type = 'button'
    b.setAttribute('role', 'menuitemradio')
    b.setAttribute('aria-checked', String(z.zone === on))
    if (z.zone === on) b.dataset.on = '1'
    const right = el(doc, 'span', 'cb-wsm-right')
    right.append(el(doc, 'span', 'cb-zm-tag', z.tag), el(doc, 'span', 'cb-wsm-check', z.zone === on ? '✓' : ''))
    b.append(el(doc, 'span', 'cb-wsm-label', z.city), right)
    b.addEventListener('click', () => {
      close()
      if (z.zone !== ws.active.displayTimezone) ws.setTimezone(z.zone)
      repaint()
    })
    rows.push(b)
    group.append(b)
  }
  group.append(el(doc, 'div', 'cb-zm-note', 'Every zone: right-click the time axis'))
  menu.append(group)
  doc.body.appendChild(menu)
  anchor?.setAttribute('aria-expanded', 'true')
  anchor?.setAttribute('data-open', '1')

  const place = () => {
    const r = anchor?.getBoundingClientRect()
    const w = menu.offsetWidth
    const left = r ? Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) : Math.max(8, (window.innerWidth - w) / 2)
    menu.style.left = `${left}px`
    menu.style.top = `${r ? r.bottom + 6 : 60}px`
  }

  menu.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      anchor?.focus()
      return
    }
    const i = rows.indexOf(doc.activeElement as HTMLButtonElement)
    const n = rows.length
    const to = e.key === 'ArrowDown' ? (i + 1) % n : e.key === 'ArrowUp' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
    if (to >= 0) {
      e.preventDefault()
      rows[to]?.focus()
    }
  })
  for (const t of ['keyup', 'keypress'] as const) menu.addEventListener(t, (e) => e.stopPropagation())

  const outside = (e: PointerEvent) => {
    const t = e.target as Node
    if (!menu.contains(t) && !anchor?.contains(t)) close()
  }
  const esc = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !menu.contains(e.target as Node)) close()
  }
  const close = () => {
    menu.remove()
    anchor?.setAttribute('aria-expanded', 'false')
    anchor?.removeAttribute('data-open')
    doc.removeEventListener('pointerdown', outside, true)
    doc.removeEventListener('keydown', esc, true)
    window.removeEventListener('resize', place)
    closeZoneMenu = null
  }
  doc.addEventListener('pointerdown', outside, true)
  doc.addEventListener('keydown', esc, true)
  window.addEventListener('resize', place)
  closeZoneMenu = close

  place()
  ;(rows.find((b) => b.dataset.on) ?? rows[0])?.focus({ preventScroll: true })
}
