// ─────────────────────────────────────────────────────────────────────────────
// The session clock itself (sessionClock.ts has the why). Loaded once the chart
// is up. Two pieces, both following the ACTIVE chart:
//
//   · the chip     Vela renders our pinned "Session" action as a plain button;
//                  this dresses it as quiet text,  ● RTH  closes in 2:14:47,  and
//                  re-dresses it if Vela ever rebuilds it. A click opens Chart
//                  settings on its Symbol tab, where Vela keeps the TIME ZONE and
//                  the trading session (Brandon, 2026-10-05: "the time zone can be
//                  in the settings. no need to be so pronounced on the chart", so
//                  the clock and the zone menu that were here are gone). Vela's
//                  time-axis menu (right-click the time scale) has every zone too.
//   · RTH / ETH    Vela's timeframe button reads "5m · RTH", and its menu gets a
//                  SESSION row at the foot with the two buttons. Both are added to
//                  Vela's own button and menu (it offers no seam for either) and
//                  put back whenever Vela redraws them. The switch is the active
//                  chart's, as the bottom strip's was. A symbol with one session
//                  shows no tag and greys the row out. With starred timeframes Vela
//                  shows them as chips and the button is only a ▾; the tag then
//                  sits in it on its own ("[30m] ETH ▾").
//
// THE SESSION. From the provider's own calendar (cbedgeProvider sessionWindows,
// the one behind the chart's session shading), in the chart's time zone:
//
//   index    RTH · closes in   Pre-market · opens in    Closed · opens …
//   stock    RTH · closes in   Pre-market · opens in    After hours · ends in   Overnight · opens in   Closed · opens …
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

const ET_HM = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' })
/** 20:00–04:00 ET: the cash names' overnight session. */
function isOvernight(t: number): boolean {
  const p = ET_HM.formatToParts(t)
  const m = Number(p.find((x) => x.type === 'hour')?.value ?? 0) * 60 + Number(p.find((x) => x.type === 'minute')?.value ?? 0)
  return m >= 20 * 60 || m < 4 * 60
}
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
    // the cash names' window starts at 20:00 the evening before (the overnight
    // session); an index keeps its pre-market from 04:00, as before
    const night = isOvernight(now)
    if (rthAhead && night && kind !== 'index') return { phase: 'pre', label: 'Overnight', verb: 'opens', at: nextR }
    if (rthAhead && !night) return { phase: 'pre', label: 'Pre-market', verb: 'opens', at: nextR }
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

/** Mon 09:30 */
function dayTime(ms: number, tz: string): string {
  const p = partsOf(
    fmt(`d|${tz}`, () => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })),
    ms,
  )
  return `${p.weekday} ${p.hour}:${p.minute}`
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
    if (b.classList.contains('cb-clk') || b.textContent?.trim() === 'Session') return b
  }
  return null
}

/** The chip's click: Chart settings on the Symbol tab, scrolled to its time zone (the
 *  trading session is the group under it). */
export function openSessionSettings(): void {
  const ws = current
  if (!ws) return
  ws.active.chart.renderer.openSettings('Symbol')
  requestAnimationFrame(() => {
    for (const d of ws.root.ownerDocument.querySelectorAll<HTMLElement>('.vela-dialog')) {
      if (!d.getClientRects().length) continue
      for (const e of d.querySelectorAll<HTMLElement>('*')) {
        if (e.children.length === 0 && e.textContent?.trim().toLowerCase() === 'time zone') {
          e.scrollIntoView({ block: 'start' })
          return
        }
      }
    }
  })
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
  let parts: { ses: HTMLElement; lab: HTMLElement; verb: HTMLElement; val: HTMLElement } | null = null
  const dress = (b: HTMLButtonElement) => {
    const ses = el(doc, 'span', 'cb-clk-ses')
    const lab = el(doc, 'b', 'cb-clk-lab')
    const verb = el(doc, 'span', 'cb-clk-verb')
    const val = el(doc, 'span', 'cb-clk-val')
    ses.append(el(doc, 'i', 'cb-clk-dot'), lab, verb, val)
    b.classList.add('cb-clk')
    b.setAttribute('aria-haspopup', 'dialog')
    b.replaceChildren(ses)
    parts = { ses, lab, verb, val }
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
    const state = `${r.label}${parts.verb.textContent ? `, ${parts.verb.textContent} ${parts.val.textContent}` : ''}`
    const tip = `${state}. Session and time zone: Chart settings`
    if (chip.title !== tip) chip.title = tip
    chip.setAttribute('aria-label', `Session: ${r.label}. Open the session and time-zone settings`)
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
      if (b) tfMo.observe(b, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded', 'data-solo'] })
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
      // "5m · RTH ▾" on the lone button; beside starred chips the button is only ▾, so "RTH ▾"
      setText(s, b.dataset.solo === '1' ? `· ${want}` : want)
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
    repaint = () => {}
    if (current === ws) current = null
  }
}
