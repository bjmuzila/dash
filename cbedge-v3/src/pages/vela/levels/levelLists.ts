// ─────────────────────────────────────────────────────────────────────────────
// LEVEL LISTS: the Lists tab of the Level Alerts panel (levelAlerts.ts).
//
// Brandon, 2026-10-10: "if i click volt - i can add tickers to it. so i dont
// have to go to each ticker to add the volt." One list per level (★ Volt,
// ↘ Reversal, … Prior close); every ticker on a list is watched by the SERVER
// (server-v2/vela-alert-lists.cjs) every minute, with or without a Vela tab
// open. A list alert STAYS ARMED: after it rings it can ring again once the
// account's cooldown has passed (the panel's own alerts still fire once).
//
// Where a ring goes:
//   · Vela's bell (the server writes vela_alerts; the bell re-reads it)
//   · this tab: a 30 s poll picks up new rings and delivers them like a panel
//     alert (toast, the Alerts feed, a desktop notification when switched on)
//   · Discord, when the account has saved a webhook here
//
// The GEX book and the Coil switch are the page's (gexBasis.ts). The server
// reads levels on the book it was last told, so this tab tells it whenever it
// loads and whenever the book or the Coil switch changes.
//
// THE VIEW IS PERSISTENT. The panel redraws everything every 30 s; the Lists
// view is one element that survives those redraws (levelAlerts.ts draw() keeps
// it in place), and inside it the inputs are built once, so a ticker half typed
// is never wiped by a redraw.
// ─────────────────────────────────────────────────────────────────────────────

import { gexBasis, onGexBasis, vtCoilOn } from '@/pages/vela/gexBasis'
import { deliverAlert } from '@/pages/vela/script/alerts'
import { isMarkKey, markSvg } from '@/pages/vela/levelMarks'
import { etDateKey } from '@/pages/vela/studies/common'

const URL_ = '/api/vela/alert-lists'
const SEL_KEY = 'cb-vela-list-level'
const POLL_MS = 30_000
/** With nothing on any list, look far less often. */
const IDLE_POLL_MS = 120_000

export interface ListLevel {
  key: string
  name: string
  group: 'Voltick' | 'Session' | 'Prior'
}
export interface ListRow {
  symbol: string
  price: number | null
  level: number | null
  checkedAt: number | null
  firedAt: number | null
  fired: number
}
export interface ListPrefs {
  cooldownMin: number
  gexBasis: 'oi' | 'oivol' | 'vol'
  coil: boolean
  webhook: string | null
  hasWebhook: boolean
  paused: boolean
}
interface Payload {
  prefs: ListPrefs
  lists: Record<string, ListRow[]>
  levels: ListLevel[]
  fires?: { key: string; symbol: string; title: string; text: string; at: number }[]
  added?: string[]
  skipped?: string[]
  error?: string
}

const FALLBACK_LEVELS: ListLevel[] = [
  { key: 'volt', name: 'Volt', group: 'Voltick' },
  { key: 'reversal', name: 'Reversal', group: 'Voltick' },
  { key: 'surge', name: 'Surge', group: 'Voltick' },
  { key: 'coil', name: 'Coil', group: 'Voltick' },
  { key: 'flip', name: 'Flip', group: 'Voltick' },
  { key: 'ibh', name: 'IB high', group: 'Session' },
  { key: 'ibl', name: 'IB low', group: 'Session' },
  { key: 'onh', name: 'Overnight high', group: 'Session' },
  { key: 'onl', name: 'Overnight low', group: 'Session' },
  { key: 'open', name: 'Open', group: 'Session' },
  { key: 'pdh', name: 'Prior day high', group: 'Prior' },
  { key: 'pdl', name: 'Prior day low', group: 'Prior' },
  { key: 'pdc', name: 'Prior close', group: 'Prior' },
]

const COOLDOWNS: Array<[number, string]> = [
  [5, 'Ring again after 5 min'],
  [15, 'Ring again after 15 min'],
  [30, 'Ring again after 30 min'],
  [60, 'Ring again after 1 hour'],
  [120, 'Ring again after 2 hours'],
  [240, 'Ring again after 4 hours'],
  [1440, 'Once a day'],
]

// ── state, shared by every panel in the tab ──────────────────────────────────

let data: Payload | null = null
let status: 'idle' | 'loading' | 'ready' | 'signed-out' | 'error' = 'idle'
let errorText = ''
let cursor = Date.now()
const subs = new Set<() => void>()
const notify = () => {
  for (const fn of subs) fn()
}

function readSel(): string {
  try {
    return localStorage.getItem(SEL_KEY) || 'volt'
  } catch {
    return 'volt'
  }
}
let sel = readSel()
function setSel(k: string): void {
  sel = k
  try {
    localStorage.setItem(SEL_KEY, k)
  } catch {
    /* private mode */
  }
  notify()
}

/** Every ticker on every list: the Lists tab's count. */
export function listCount(): number {
  if (!data) return 0
  return Object.values(data.lists).reduce((n, l) => n + l.length, 0)
}

async function api(method: 'GET' | 'POST', body?: unknown, since?: number): Promise<Payload | null> {
  const url = since != null ? `${URL_}?since=${since}` : URL_
  const r = await fetch(url, {
    method,
    credentials: 'include',
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (r.status === 401 || r.status === 403) {
    status = 'signed-out'
    notify()
    return null
  }
  const j = (await r.json().catch(() => ({}))) as Payload
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
  return j
}

/** The server reads levels on the book it was last told: keep it told. */
async function syncBook(): Promise<void> {
  if (!data) return
  const b = gexBasis()
  const c = vtCoilOn()
  if (data.prefs.gexBasis === b && data.prefs.coil === c) return
  try {
    const j = await api('POST', { action: 'prefs', gexBasis: b, coil: c })
    if (j) data = { ...data, ...j }
  } catch {
    /* the next load tries again */
  }
}

async function load(withFires: boolean): Promise<void> {
  if (status === 'idle') status = 'loading'
  try {
    const since = withFires ? cursor : undefined
    const j = await api('GET', undefined, since)
    if (!j) return
    if (withFires && j.fires?.length) {
      for (const f of j.fires) {
        cursor = Math.max(cursor, f.at)
        // the bell keys a ring `levels|SYM|title|barTime`; the server wrote the same
        // key, so delivering it here records nothing twice
        deliverAlert({ libId: 'levels', script: 'Level list', symbol: f.symbol, timeframe: '1', title: f.title, text: f.text, barTime: f.at })
      }
    }
    data = j
    status = 'ready'
    errorText = ''
    void syncBook()
  } catch (e) {
    status = 'error'
    errorText = e instanceof Error ? e.message : String(e)
  }
  notify()
}

let polling: ReturnType<typeof setTimeout> | null = null
let offBook: (() => void) | null = null
/** Start the 30 s poll for this page (idempotent). levelAlerts.ts startWatch calls it. */
export function startListsPoll(): () => void {
  if (polling) return stopListsPoll
  cursor = Date.now()
  const loop = async () => {
    if (!document.hidden && status !== 'signed-out') await load(true)
    polling = setTimeout(loop, listCount() > 0 ? POLL_MS : IDLE_POLL_MS)
  }
  polling = setTimeout(loop, 0)
  offBook = onGexBasis(() => void syncBook())
  return stopListsPoll
}
function stopListsPoll(): void {
  if (polling) clearTimeout(polling)
  polling = null
  offBook?.()
  offBook = null
}

async function act(body: Record<string, unknown>): Promise<Payload | null> {
  try {
    const j = await api('POST', body)
    if (j) {
      data = { ...(data ?? j), ...j }
      status = 'ready'
      errorText = ''
    }
    notify()
    return j
  } catch (e) {
    errorText = e instanceof Error ? e.message : String(e)
    notify()
    return null
  }
}

// ── the view ─────────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = cls
  if (text != null) e.textContent = text
  return e
}
const fmt = (v: number | null) =>
  v == null || !Number.isFinite(v) ? '·' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const etClock = (t: number) =>
  new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const inSentence = (n: string) => (/^(Volt|Coil|Reversal|Surge|Flip|IB)\b/.test(n) ? n : n.charAt(0).toLowerCase() + n.slice(1))

function markOf(key: string): HTMLElement | null {
  if (!isMarkKey(key)) return null
  const mk = el('span', 'cb-lv-mark')
  mk.innerHTML = markSvg(key)
  return mk
}

/** "NVDA, amd tsla" → ['NVDA','AMD','TSLA'] */
const splitTickers = (s: string) =>
  [...new Set(s.split(/[\s,;]+/).map((t) => t.trim().toUpperCase()).filter(Boolean))]

export interface ListsView {
  el: HTMLElement
  /** Point the view at the chart's symbol (the "+ NQ" shortcut) and refresh what changed. */
  render: (sym: string) => void
  destroy: () => void
}

export function createListsView(onChange: () => void): ListsView {
  const root = el('div', 'cb-ll')
  let sym = ''

  // ── built once: the level chips, the add row, the settings ──
  const chips = el('div', 'cb-ll-chips')
  const head = el('div', 'cb-ll-head')
  const addRow = el('form', 'cb-ll-add')
  const input = el('input', 'cb-ll-in')
  input.type = 'text'
  input.placeholder = 'Add tickers: NVDA, AMD, TSLA'
  input.autocomplete = 'off'
  input.spellcheck = false
  input.setAttribute('aria-label', 'Tickers to add')
  const addBtn = el('button', 'cb-ll-go', 'Add')
  addBtn.type = 'submit'
  const mine = el('button', 'cb-lv-btn cb-ll-mine')
  mine.type = 'button'
  addRow.append(input, addBtn)
  const note = el('p', 'cb-ll-note')
  const rows = el('div', 'cb-ll-rows')
  const acts = el('div', 'cb-lv-acts')
  const clear = el('button', 'cb-lv-btn', 'Clear this list')
  clear.type = 'button'
  acts.append(clear)

  const setG = el('div', 'cb-lv-group', 'List settings')
  const cool = el('select', 'cb-ll-sel')
  cool.setAttribute('aria-label', 'After a list alert rings')
  for (const [m, l] of COOLDOWNS) {
    const o = el('option', '', l)
    o.value = String(m)
    cool.append(o)
  }
  const coolRow = el('label', 'cb-ll-row')
  coolRow.append(el('span', '', 'After it rings'), cool)
  const hook = el('input', 'cb-ll-in')
  hook.type = 'url'
  hook.placeholder = 'Discord webhook URL'
  hook.autocomplete = 'off'
  hook.setAttribute('aria-label', 'Discord webhook URL')
  const hookSave = el('button', 'cb-lv-btn', 'Save')
  hookSave.type = 'button'
  const hookTest = el('button', 'cb-lv-btn', 'Test')
  hookTest.type = 'button'
  const hookOff = el('button', 'cb-lv-btn', 'Remove')
  hookOff.type = 'button'
  const hookRow = el('div', 'cb-ll-hook')
  hookRow.append(hook, hookSave, hookTest, hookOff)
  const hookLabel = el('div', 'cb-ll-sub', 'Discord: the one place a list alert reaches you with Vela closed.')
  const pause = el('button', 'cb-lv-tog cb-ll-pause')
  pause.type = 'button'
  pause.append(el('span', '', 'Pause every list'), el('i', ''))
  const msg = el('p', 'cb-ll-msg')
  const foot = el('p', 'cb-lv-hint')

  root.append(chips, head, addRow, mine, note, rows, acts, setG, coolRow, hookLabel, hookRow, pause, msg, foot)

  const say = (t: string) => {
    msg.textContent = t
    msg.hidden = !t
  }
  say('')

  const levels = () => data?.levels?.length ? data.levels : FALLBACK_LEVELS
  const levelName = (k: string) => levels().find((l) => l.key === k)?.name ?? k

  // ── events ──
  addRow.addEventListener('submit', (e) => {
    e.preventDefault()
    const syms = splitTickers(input.value)
    if (!syms.length) return
    addBtn.disabled = true
    void act({ action: 'add', level: sel, symbols: syms }).then((j) => {
      addBtn.disabled = false
      if (!j) return
      input.value = ''
      const skipped = j.skipped?.length ? ` · not added (list full): ${j.skipped.join(', ')}` : ''
      const bad = syms.filter((s) => !(j.added ?? []).includes(s) && !(j.skipped ?? []).includes(s))
      say(`${j.added?.length ? `Added ${j.added.join(', ')}` : 'Nothing new to add'}${skipped}${bad.length ? ` · already on it or not a ticker: ${bad.join(', ')}` : ''}`)
    })
  })
  mine.addEventListener('click', () => {
    if (!sym) return
    void act({ action: 'add', level: sel, symbols: [sym] }).then((j) => j && say(`Added ${sym}`))
  })
  clear.addEventListener('click', () => {
    if (clear.dataset.armed !== 'true') {
      clear.dataset.armed = 'true'
      clear.textContent = 'Clear it? Tap again'
      setTimeout(() => {
        clear.dataset.armed = 'false'
        clear.textContent = 'Clear this list'
      }, 3000)
      return
    }
    clear.dataset.armed = 'false'
    clear.textContent = 'Clear this list'
    void act({ action: 'clear', level: sel }).then((j) => j && say(`Cleared the ${inSentence(levelName(sel))} list`))
  })
  cool.addEventListener('change', () => {
    void act({ action: 'prefs', cooldownMin: Number(cool.value) }).then((j) => j && say(`Saved: ${cool.selectedOptions[0]?.textContent ?? ''}`))
  })
  hookSave.addEventListener('click', () => {
    const v = hook.value.trim()
    if (!v) return
    void act({ action: 'prefs', webhook: v }).then((j) => {
      if (!j) return
      hook.value = ''
      say('Discord webhook saved. Press Test to check it.')
    })
  })
  hookTest.addEventListener('click', () => {
    void act({ action: 'test' }).then((j) => j && say('Test message sent to Discord.'))
  })
  hookOff.addEventListener('click', () => {
    void act({ action: 'prefs', webhook: '' }).then((j) => j && say('Discord webhook removed.'))
  })
  pause.addEventListener('click', () => {
    const next = !(data?.prefs.paused ?? false)
    void act({ action: 'prefs', paused: next }).then((j) => j && say(next ? 'Every list is paused.' : 'Lists are watching again.'))
  })

  // ── the parts that change ──
  const paint = () => {
    const lists = data?.lists ?? {}
    // chips
    chips.replaceChildren()
    for (const lv of levels()) {
      const b = el('button', 'cb-ll-chip')
      b.type = 'button'
      b.setAttribute('aria-pressed', String(lv.key === sel))
      const mk = markOf(lv.key)
      if (mk) b.append(mk)
      b.append(el('span', 'cb-lv-nmt', lv.name))
      const c = lists[lv.key]?.length ?? 0
      if (c) b.append(el('span', 'cb-lv-n', String(c)))
      b.title = `The ${inSentence(lv.name)} list${c ? ` · ${c} ticker${c > 1 ? 's' : ''}` : ''}`
      b.addEventListener('click', () => setSel(lv.key))
      chips.append(b)
    }

    const name = levelName(sel)
    const list = lists[sel] ?? []
    head.replaceChildren()
    const ht = el('b', '')
    const mk = markOf(sel)
    if (mk) ht.append(mk)
    ht.append(el('span', '', `${name} list`))
    head.append(ht, el('span', 'cb-ll-count', list.length ? `${list.length} ticker${list.length > 1 ? 's' : ''}` : 'empty'))

    const can = !!sym && !list.some((r) => r.symbol === sym)
    mine.hidden = !can
    mine.textContent = `+ ${sym} (this chart)`

    note.textContent = data?.prefs.paused
      ? 'Paused · nothing on any list is being watched.'
      : `Tell me when any of these crosses its ${inSentence(name)}. Watched every minute, with or without Vela open, and it stays armed.`

    rows.replaceChildren()
    if (status === 'loading' && !data) rows.append(el('p', 'cb-lv-empty', 'Reading your lists…'))
    else if (status === 'signed-out') rows.append(el('p', 'cb-lv-empty', 'Sign in to keep lists. They are saved to your account.'))
    else if (!list.length) rows.append(el('p', 'cb-lv-empty', `No tickers on the ${inSentence(name)} list yet.`))
    const today = etDateKey(Date.now())
    for (const r of list) {
      const row = el('div', 'cb-lv-ar')
      const who = el('span', 'cb-lv-who')
      const b = el('b', '')
      b.append(el('span', 'cb-lv-tk', r.symbol))
      const bits: string[] = []
      if (r.level != null) bits.push(`${name} ${fmt(r.level)}`)
      else bits.push(r.checkedAt ? 'no value yet' : 'first read within a minute')
      if (r.firedAt && etDateKey(r.firedAt) === today) bits.push(`rang ${etClock(r.firedAt)}`)
      who.append(b, el('span', '', bits.join(' · ')))
      const dist = r.level != null && r.price != null ? r.level - r.price : null
      const st = el('span', 'cb-lv-st', dist == null ? '' : `${dist >= 0 ? '↑' : '↓'} ${Math.abs(dist).toFixed(2)}`)
      st.title = dist == null ? '' : `${r.symbol} ${fmt(r.price)} · the ${inSentence(name)} is ${dist >= 0 ? 'above' : 'below'} price`
      const x = el('button', 'cb-lv-x', '✕')
      x.type = 'button'
      x.title = `Take ${r.symbol} off the ${inSentence(name)} list`
      x.addEventListener('click', () => void act({ action: 'remove', level: sel, symbol: r.symbol }))
      row.append(who, st, x)
      rows.append(row)
    }
    clear.hidden = list.length === 0

    // settings
    const p = data?.prefs
    const cd = String(p?.cooldownMin ?? 30)
    if (![...cool.options].some((o) => o.value === cd)) {
      const o = el('option', '', `Ring again after ${cd} min`)
      o.value = cd
      cool.append(o)
    }
    if (document.activeElement !== cool) cool.value = cd
    hook.placeholder = p?.hasWebhook ? `Saved · ${p.webhook ?? ''}` : 'Discord webhook URL'
    hookTest.hidden = !p?.hasWebhook
    hookOff.hidden = !p?.hasWebhook
    pause.setAttribute('aria-pressed', String(!!p?.paused))
    const book = p?.gexBasis === 'oi' ? 'OI' : p?.gexBasis === 'oivol' ? 'OI + Vol' : 'Vol'
    foot.textContent = `Server watched, every minute. Voltick levels on your GEX book (${book}), Coil ${p?.coil === false ? 'off' : 'on'}. Rings show on the bell, here, and in Discord if saved.`
    if (status === 'error' && errorText) say(errorText)
  }

  const onData = () => {
    paint()
    onChange()
  }
  subs.add(onData)
  paint()
  if (!data && status !== 'loading') void load(false)

  return {
    el: root,
    render: (s: string) => {
      sym = s
      paint()
    },
    destroy: () => {
      subs.delete(onData)
    },
  }
}
