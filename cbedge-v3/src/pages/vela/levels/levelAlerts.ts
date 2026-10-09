// ─────────────────────────────────────────────────────────────────────────────
// LEVEL ALERTS: "tell me when price crosses the Volt". The levels the chart
// already draws, each with a bell, in Voltick's names (the page is Voltick's
// chart; data/voltickLevels.ts):
//
//   Voltick   ★ Volt                       CORE: the top net GEX
//             ↘ Reversal                   the top net GEX across price from
//                                          the Volt
//             ↯ Surge                      the next top net GEX, not the Volt
//                                          or the Reversal
//             ◆ Coil                       the heaviest other strike ≥ half the
//                                          Volt (the GEX menu's Coil switch)
//             ⚡︎ Flip                       the zero-gamma strike
//                                          (2026-10-09 definition; the sides
//                                          judged at the chart's price moved
//                                          onto the index's strikes; all off
//                                          the front chain's live
//                                          ladder, on the page's GEX switch
//                                          (gexBasis.ts), the definition in
//                                          data/voltickLevels.ts; on ES / NQ the
//                                          index's chain shifted by the day's
//                                          basis. If the chain does not answer,
//                                          the walls recorder's newest slot,
//                                          read the same way.)
//   Session   IB high / low                09:30–10:30 ET, once it has formed
//             Overnight high / low         the pre-open session (futures: from
//                                          18:00; stocks: from 04:00)
//             Open                         today's 09:30 open
//   Prior     Prior day high / low / close the previous regular session
//
// AN ALERT FOLLOWS ITS LEVEL. Armed on the Coil, it fires when price crosses
// whatever strike is the Coil at that moment, not where it was when you
// clicked. Levels are re-read every minute while any alert is armed. Alerts
// armed under the old CB Edge names carry over: CORE is the Volt; a call / put
// wall alert, which has no fixed Voltick name, is dropped.
//
// Crossing means the last price went from one side of the level to the other
// between two ticks of a chart showing that symbol. An alert fires once and
// then disarms; arm it again from the panel. Fired alerts are delivered like
// script alerts (script/alerts.ts): the toolbar's Alerts feed, a toast, the
// Script Alerts log, and a desktop notification when switched on.
//
// Kept in this browser. Held while a bar replay runs: replayed bars are history.
//
// ALL OR NOTHING (2026-10-05, Brandon): a switch at the top of the panel arms
// every level this symbol has a price for, or disarms them all. It reads on when
// every level that can be armed is armed.
//
// THE PANEL FOLLOWS THE CHART'S SYMBOL (2026-10-05: "I'm on an ES chart but it
// brings up CRWV"). Vela only re-binds a side panel when the ACTIVE CELL changes,
// so a symbol switched on the same chart left the panel on the old ticker. It now
// listens to that chart's market:changed too (and checks on its 30 s re-read).
//
// THE PANEL · L3 (2026-10-05, Brandon picked L3 of generated/2026-10-05-vela-
// alerts-r1.html). Three tabs:
//   Levels  the chart symbol's levels as tiles; tap one to arm or disarm it.
//           ↑ / ↓ says which side of price the level is, the number how far.
//   Armed   everything waiting, on every symbol (this one first, nearest
//           first), each with how far price is from it and a ✕; Disarm all.
//   Fired   what rang today (kept in this browser, cleared each ET day), each
//           with Ring again to arm it once more.
// The tab counts are Armed on every symbol and Fired today. The All switch
// sits by the price; Desktop notifications at the foot. The old paragraph is
// the head's tooltip.
// ─────────────────────────────────────────────────────────────────────────────

import type { OHLCV, Vela } from '@luxalgo/vela'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { query } from '@/data/api'
import { chainGexUrl, chainToGex } from '@/board/chainGex'
import { CbEdgeProvider, resolveSym } from '@/pages/vela/cbedgeProvider'
import { loadBasis, wallSeriesFor } from '@/pages/vela/wallsIndicator'
import { chainValue, flipOf, gexBasis, vtCoilOn } from '@/pages/vela/gexBasis'
import { vtTermsFromWalls } from '@/pages/levelLog/wallData'
import { vtFromLadder } from '@/data/voltickLevels'
import { etDateKey, etMinutesOfDay } from '@/pages/vela/studies/common'
import { replayActive } from '@/pages/vela/replay/clock'
import { deliverAlert, enableNotify, notifyWanted } from '@/pages/vela/script/alerts'
import { ARMED_KEY } from './levelAlertsEntry'
import { isMarkKey, markSvg } from '@/pages/vela/levelMarks'

export type Group = 'Voltick' | 'Session' | 'Prior'

const GROUP_LABEL: Record<Group, string> = { Voltick: 'Voltick levels', Session: 'Session', Prior: 'Prior session' }

export interface Level {
  key: string
  name: string
  group: Group
  price: number | null
  /** A Voltick level's mark (★ ◆ ↘ ⚡︎), drawn in its reserved colour. */
  mark?: string
  /** That colour, a `var(--color-vt-…)` string. */
  tone?: string
}

/** Voltick's flip mark: ⚡ + VS15, so it is TEXT in the flip's violet, never the orange emoji. */
const FLIP_MARK = '\u26A1\uFE0E'
const VT_LEVEL: Record<'volt' | 'coil' | 'reversal' | 'surge' | 'flip', { name: string; mark: string; tone: string }> = {
  volt: { name: 'Volt', mark: '★', tone: 'var(--color-vt-volt)' },
  coil: { name: 'Coil', mark: '◆', tone: 'var(--color-vt-coil)' },
  reversal: { name: 'Reversal', mark: '↘', tone: 'var(--color-vt-reversal)' },
  surge: { name: 'Surge', mark: '↯', tone: 'var(--color-vt-surge)' },
  flip: { name: 'Flip', mark: FLIP_MARK, tone: 'var(--color-vt-flip)' },
}
const vtLevel = (key: keyof typeof VT_LEVEL, price: number | null): Level => ({ key, group: 'Voltick', price, ...VT_LEVEL[key] })

/** A level's name inside a sentence: Voltick names and IB keep their capital. */
const inSentence = (n: string) => (/^(Volt|Coil|Reversal|Surge|Flip|IB)\b/.test(n) ? n : n.charAt(0).toLowerCase() + n.slice(1))

export interface Armed {
  id: string
  sym: string
  key: string
  name: string
  armedAt: number
}

const provider = new CbEdgeProvider()
const bare = (s: string | undefined) => (s ?? '').replace(/^[^:]*:/, '').trim().toUpperCase()

// ── The levels ───────────────────────────────────────────────────────────────

const last = <T>(xs: ArrayLike<T>, ok: (v: T) => boolean): T | null => {
  for (let i = xs.length - 1; i >= 0; i--) if (ok(xs[i]!)) return xs[i]!
  return null
}

interface LevelRead {
  at: number
  levels: Level[]
  price: number | null
}
const reads = new Map<string, { at: number; p: Promise<LevelRead>; empty?: boolean }>()
/** A read that came back with none of the GEX levels is re-tried after this, not held for 50 s. */
const EMPTY_RETRY_MS = 5_000
const GEX_KEYS = new Set(['volt', 'coil', 'reversal', 'surge', 'flip'])

async function readLevels(sym: string): Promise<LevelRead> {
  const r = resolveSym(sym)
  const fut = r.kind === 'futures'
  const bars = await provider.getBars(sym, '5', { session: r.kind === 'index' ? 'regular' : 'extended' }).catch(() => [] as OHLCV[])
  const price = bars.length ? bars[bars.length - 1]!.close : null
  const out: Level[] = []
  const today = bars.length ? etDateKey(bars[bars.length - 1]!.time) : etDateKey(Date.now())
  const rth = (b: OHLCV) => {
    const m = etMinutesOfDay(b.time)
    return m >= 570 && m < 960
  }
  const todays = bars.filter((b) => etDateKey(b.time) === today)
  // Voltick's levels by the definition, off the front chain's live ladder, on the
  // page's GEX switch (gexBasis.ts; OI + vol until 2026-10-07)
  const gb = gexBasis()
  let vt: { volt: number | null; coil: number | null; reversal: number | null; surge: number | null } | null = null
  let flip: number | null = null
  try {
    const ticker = r.fut === 'NQ' ? 'NDX' : r.fut === 'ES' ? 'SPX' : r.key
    const g = chainToGex(await query<unknown>(chainGexUrl(ticker), { staleMs: 60_000 }))
    let shift = 0
    if (r.fut) {
      const b = await loadBasis(r.fut)
      shift = b.basis > 0 && b.basis < b.max ? b.basis : NaN
    }
    if (Number.isFinite(shift)) {
      const at = (v: number | null) => (v == null ? null : v + shift)
      // the chain's own CORE and flip are OI + Vol; on another book both come from the rows
      const book = g.rows.map((x) => ({ strike: x.strike, net: chainValue(x.netGEX, x.netVolGEX, gb) }))
      flip = at(gb === 'oivol' ? g.flip : flipOf(book, g.spot))
      if (g.rows.length) {
        // the chart's price moved onto the index's strikes judges the sides (the
        // chain's own spot is stale before the cash open and overnight)
        const spot = price != null && price > 0 ? price - shift : g.spot
        const d = vtFromLadder(book, spot, gb === 'oivol' ? (g.core?.strike ?? null) : null, { coil: vtCoilOn() })
        vt = { volt: at(d.volt), coil: at(d.coil), reversal: at(d.reversal), surge: at(d.surge) }
      }
    }
  } catch {
    /* the recorded walls below */
  }
  // no chain — or a chain that named none of the three (an empty book, a basis
  // that left every level off the futures chart): the walls recorder's newest
  // slot, today's bars only, read the same way. The legend said "No levels" on
  // ES while the CB Walls study was drawing them (2026-10-07 audit).
  if (!vt || (vt.volt == null && vt.coil == null && vt.reversal == null && vt.surge == null)) {
    try {
      const w = await wallSeriesFor(sym, todays.length ? todays : bars.slice(-80), '5', true)
      const fin = (v: number) => Number.isFinite(v)
      vt = vtTermsFromWalls(last(w.core, fin), last(w.callWall, fin), last(w.putWall, fin), price)
    } catch {
      vt = null
    }
  }
  out.push(
    vtLevel('volt', vt?.volt ?? null),
    vtLevel('reversal', vt?.reversal ?? null),
    vtLevel('surge', vt?.surge ?? null),
    vtLevel('coil', vt?.coil ?? null),
    vtLevel('flip', flip),
  )
  // session: IB, overnight, open
  const rthToday = todays.filter(rth)
  const ib = rthToday.filter((b) => etMinutesOfDay(b.time) < 630)
  const ibDone = rthToday.some((b) => etMinutesOfDay(b.time) >= 630)
  out.push({ key: 'ibh', name: 'IB high', group: 'Session', price: ibDone ? Math.max(...ib.map((b) => b.high)) : null })
  out.push({ key: 'ibl', name: 'IB low', group: 'Session', price: ibDone ? Math.min(...ib.map((b) => b.low)) : null })
  const preOpen = bars.filter((b) => {
    const d = etDateKey(b.time)
    const m = etMinutesOfDay(b.time)
    if (fut) return (d === today && m < 570) || (d < today && m >= 18 * 60 && Date.parse(`${today}T12:00:00Z`) - Date.parse(`${d}T12:00:00Z`) <= 3 * 86_400_000)
    return d === today && m < 570
  })
  out.push({ key: 'onh', name: 'Overnight high', group: 'Session', price: preOpen.length ? Math.max(...preOpen.map((b) => b.high)) : null })
  out.push({ key: 'onl', name: 'Overnight low', group: 'Session', price: preOpen.length ? Math.min(...preOpen.map((b) => b.low)) : null })
  out.push({ key: 'open', name: 'Open', group: 'Session', price: rthToday[0]?.open ?? null })
  // prior session
  const prevDay = [...new Set(bars.filter(rth).map((b) => etDateKey(b.time)))].filter((d) => d < today).pop()
  const prev = prevDay ? bars.filter((b) => rth(b) && etDateKey(b.time) === prevDay) : []
  out.push({ key: 'pdh', name: 'Prior day high', group: 'Prior', price: prev.length ? Math.max(...prev.map((b) => b.high)) : null })
  out.push({ key: 'pdl', name: 'Prior day low', group: 'Prior', price: prev.length ? Math.min(...prev.map((b) => b.low)) : null })
  out.push({ key: 'pdc', name: 'Prior close', group: 'Prior', price: prev.length ? prev[prev.length - 1]!.close : null })
  return { at: Date.now(), levels: out, price }
}

/** The levels for a symbol on the page's GEX switch, shared for 50 s. */
export function levelsFor(sym: string, fresh = false): Promise<LevelRead> {
  const key = `${sym}|${gexBasis()}|${vtCoilOn() ? 'coil' : 'nocoil'}`
  const hit = reads.get(key)
  const age = hit ? Date.now() - hit.at : Infinity
  if (hit && age < (fresh ? 20_000 : 50_000) && !(hit.empty && age > EMPTY_RETRY_MS)) return hit.p
  const p = readLevels(sym).catch(() => ({ at: Date.now(), levels: [], price: null }))
  const entry: { at: number; p: Promise<LevelRead>; empty?: boolean } = { at: Date.now(), p }
  reads.set(key, entry)
  void p.then((r) => {
    entry.empty = !r.levels.some((l) => GEX_KEYS.has(l.key) && l.price != null)
  })
  return p
}

// ── Armed alerts ─────────────────────────────────────────────────────────────

function readArmed(): Armed[] {
  try {
    const j: unknown = JSON.parse(localStorage.getItem(ARMED_KEY) ?? '[]')
    if (!Array.isArray(j)) return []
    return (j as Armed[])
      .filter((a) => a && typeof a.sym === 'string' && typeof a.key === 'string' && a.key !== 'cw' && a.key !== 'pw')
      .map((a) => (a.key === 'core' ? { ...a, key: 'volt', name: 'Volt' } : a.key === 'flip' ? { ...a, name: 'Flip' } : a))
  } catch {
    return []
  }
}
let armed: Armed[] = readArmed()
const armSubs = new Set<() => void>()
function saveArmed(next: Armed[]): void {
  armed = next
  try {
    localStorage.setItem(ARMED_KEY, JSON.stringify(armed))
  } catch {
    /* private mode */
  }
  for (const fn of armSubs) fn()
}
export const armedAlerts = (): readonly Armed[] => armed
export function isArmed(sym: string, key: string): boolean {
  return armed.some((a) => a.sym === sym && a.key === key)
}
export function toggleArmed(sym: string, lv: Level): void {
  if (isArmed(sym, lv.key)) saveArmed(armed.filter((a) => !(a.sym === sym && a.key === lv.key)))
  else saveArmed([...armed, { id: `${sym}|${lv.key}|${Date.now()}`, sym, key: lv.key, name: lv.name, armedAt: Date.now() }])
}
export function disarm(id: string): void {
  saveArmed(armed.filter((a) => a.id !== id))
}
/** The levels on `sym` that can be armed: the ones with a price. */
const armable = (levels: readonly Level[]) => levels.filter((l) => l.price != null && Number.isFinite(l.price))
/** Every armable level on `sym` armed (and at least one of them)? */
export function allArmed(sym: string, levels: readonly Level[]): boolean {
  const can = armable(levels)
  return can.length > 0 && can.every((l) => isArmed(sym, l.key))
}
/** All or nothing: arm every armable level on `sym`, or disarm every alert on it. */
export function setAllArmed(sym: string, levels: readonly Level[], on: boolean): void {
  if (!on) {
    saveArmed(armed.filter((a) => a.sym !== sym))
    return
  }
  const now = Date.now()
  const add = armable(levels)
    .filter((l) => !isArmed(sym, l.key))
    .map((l) => ({ id: `${sym}|${l.key}|${now}`, sym, key: l.key, name: l.name, armedAt: now }))
  if (add.length) saveArmed([...armed, ...add])
}
/** Disarm every level alert, on every symbol. */
export function disarmAll(): void {
  if (armed.length) saveArmed([])
}

// ── Fired today ──────────────────────────────────────────────────────────────

const FIRED_KEY = 'cb-vela-level-fired'

export interface Fired {
  id: string
  sym: string
  key: string
  name: string
  dir: 'up' | 'down'
  /** The level when it rang. */
  level: number
  /** The price that crossed it. */
  price: number
  at: number
}

const isToday = (t: number) => etDateKey(t) === etDateKey(Date.now())

function readFired(): Fired[] {
  try {
    const j: unknown = JSON.parse(localStorage.getItem(FIRED_KEY) ?? '[]')
    if (!Array.isArray(j)) return []
    return (j as Fired[]).filter(
      (f) => f && typeof f.sym === 'string' && typeof f.key === 'string' && Number.isFinite(f.at) && Number.isFinite(f.level) && isToday(f.at),
    )
  } catch {
    return []
  }
}
let fired: Fired[] = readFired()
/** Today's rings, newest first. */
export const firedToday = (): Fired[] => fired.filter((f) => isToday(f.at))
function pushFired(f: Fired): void {
  fired = [f, ...firedToday()].slice(0, 100)
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify(fired))
  } catch {
    /* private mode */
  }
  for (const fn of armSubs) fn()
}
/** Ring it again: arm the same level on the same symbol. */
export function rearm(f: Fired): void {
  if (isArmed(f.sym, f.key)) return
  saveArmed([...armed, { id: `${f.sym}|${f.key}|${Date.now()}`, sym: f.sym, key: f.key, name: f.name, armedAt: Date.now() }])
}

// ── The watcher ──────────────────────────────────────────────────────────────

const lastPrice = new Map<string, number>()
let watching: VelaWorkspace | null = null
let offWatch: (() => void) | null = null

function onTick(chart: Vela, bar: OHLCV): void {
  const sym = bare(chart.market.symbol)
  const p = bar.close
  const prev = lastPrice.get(sym)
  lastPrice.set(sym, p)
  if (prev == null || replayActive() || prev === p) return
  const mine = armed.filter((a) => a.sym === sym)
  if (!mine.length) return
  void levelsFor(sym).then((read) => {
    for (const a of mine) {
      const lv = read.levels.find((l) => l.key === a.key)
      const L = lv?.price
      if (L == null || !Number.isFinite(L)) continue
      const crossed = (prev < L && p >= L) || (prev > L && p <= L)
      if (!crossed || !isArmed(sym, a.key)) continue
      const now = Date.now()
      pushFired({ id: `${a.id}|${now}`, sym, key: a.key, name: a.name, dir: p >= L ? 'up' : 'down', level: L, price: p, at: now })
      disarm(a.id)
      deliverAlert({
        libId: 'levels',
        script: 'Level alert',
        symbol: sym,
        timeframe: chart.market.timeframe ?? '5',
        title: `${a.name} ${p >= L ? 'crossed up' : 'crossed down'}`,
        text: `${sym} ${p.toFixed(2)} crossed the ${inSentence(a.name)} at ${L.toFixed(2)}.`,
        barTime: bar.time,
      })
    }
  })
}

/** Watch every chart in the workspace for armed levels. Idempotent. */
export function startWatch(ws: VelaWorkspace): () => void {
  if (watching === ws && offWatch) return offWatch
  offWatch?.()
  watching = ws
  const offs = new Map<string, () => void>()
  const wire = (id: string) => {
    const cell = ws.cell(id)
    if (!cell || offs.has(id)) return
    const chart = cell.chart
    offs.set(id, chart.on('bar', (b) => onTick(chart, b)))
  }
  for (const c of ws.cells()) wire(c.id)
  const offC = ws.on('cell:created', ({ id }) => wire(id))
  const offD = ws.on('cell:destroyed', ({ id }) => {
    offs.get(id)?.()
    offs.delete(id)
  })
  // keep the armed symbols' levels warm
  const timer = setInterval(() => {
    if (document.hidden) return
    for (const sym of new Set(armed.map((a) => a.sym))) void levelsFor(sym)
  }, 60_000)
  offWatch = () => {
    offC()
    offD()
    clearInterval(timer)
    for (const off of offs.values()) off()
    offs.clear()
    watching = null
    offWatch = null
  }
  return offWatch
}

// ── The panel ────────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = cls
  if (text != null) e.textContent = text
  return e
}

const fmt = (v: number | null) => (v == null || !Number.isFinite(v) ? '·' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

/** Voltick's bell (theme.jsx IC.bell), stroked in currentColor: an emoji bell is
 *  painted gold by the system font, and gold is the Volt's. */
function bellIcon(off: boolean): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2.2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const paths = ['M18 9a6 6 0 1 0-12 0c0 4.4-1.5 5.8-1.5 5.8h15S18 13.4 18 9z', 'M13.7 19a2 2 0 0 1-3.4 0']
  if (off) paths.push('M4 4l16 16')
  for (const d of paths) {
    const p = document.createElementNS(NS, 'path')
    p.setAttribute('d', d)
    svg.appendChild(p)
  }
  return svg
}


/** The order levels are listed in when nothing else decides it. */
const LEVEL_ORDER = ['volt', 'reversal', 'surge', 'coil', 'flip', 'ibh', 'ibl', 'onh', 'onl', 'open', 'pdh', 'pdl', 'pdc']
const orderOf = (key: string) => {
  const i = LEVEL_ORDER.indexOf(key)
  return i < 0 ? LEVEL_ORDER.length : i
}

/** A Voltick mark (★ ◆ ↘ ⚡︎), drawn (levelMarks.ts), or nothing for a session level. */
function markOf(key: string): HTMLElement | null {
  if (!isMarkKey(key)) return null
  const mk = el('span', 'cb-lv-mark')
  mk.innerHTML = markSvg(key)
  return mk
}

/** "10:31", Eastern. */
const etClock = (t: number) => new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** A switch: the label, then the track. aria-pressed carries the state. */
function toggle(label: string, on: boolean, title: string): HTMLButtonElement {
  const b = el('button', 'cb-lv-tog')
  b.type = 'button'
  b.title = title
  b.setAttribute('aria-pressed', String(on))
  b.append(el('span', '', label), el('i', ''))
  return b
}

type Tab = 'levels' | 'armed' | 'fired'
const TAB_KEY = 'cb-vela-level-tab'
function readTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY)
    return t === 'armed' || t === 'fired' ? t : 'levels'
  } catch {
    return 'levels'
  }
}
function saveTab(t: Tab): void {
  try {
    localStorage.setItem(TAB_KEY, t)
  } catch {
    /* private mode */
  }
}

const HINT =
  'Tap a level to be told when price crosses it. A Volt, Reversal, Surge, Coil or Flip alert follows that level as it moves. Each fires once, then shows under Fired.'

export function mountLevelPanel(chartOf: () => Vela, body: HTMLElement): { onChart: (chart?: Vela) => void; destroy: () => void } {
  const root = el('div', 'cb-lv')
  body.replaceChildren(root)
  let chart = chartOf()
  let sym = bare(chart.market.symbol)
  let read: LevelRead | null = null
  let alive = true
  let offMarket: (() => void) | null = null
  let tab: Tab = readTab()
  /** The other armed symbols' levels, for "how far away" under Armed. */
  const otherReads = new Map<string, LevelRead>()

  const readOf = (s: string): LevelRead | null => (s === sym ? read : otherReads.get(s) ?? null)

  // ── the head: symbol, price, All ──
  const drawHead = () => {
    const head = el('div', 'cb-lv-head')
    head.title = HINT
    head.append(el('span', 'cb-lv-sym', sym), el('span', 'cb-lv-px', read?.price != null ? fmt(read.price) : ''), el('span', 'cb-lv-sp'))
    const levels = read?.levels ?? []
    const allOn = allArmed(sym, levels)
    const all = toggle('All', allOn, allOn ? `Disarm every ${sym} level alert` : `Arm an alert on every ${sym} level that has a price`)
    all.disabled = armable(levels).length === 0 && !armed.some((a) => a.sym === sym)
    all.addEventListener('click', () => setAllArmed(sym, levels, !allOn))
    head.append(all)
    root.append(head)
  }

  // ── the tabs ──
  const drawTabs = () => {
    const bar = el('div', 'cb-lv-tabs')
    bar.setAttribute('role', 'tablist')
    const counts: Record<Tab, number> = { levels: 0, armed: armed.length, fired: firedToday().length }
    for (const [t, label] of [
      ['levels', 'Levels'],
      ['armed', 'Armed'],
      ['fired', 'Fired'],
    ] as Array<[Tab, string]>) {
      const b = el('button', 'cb-lv-tab', label)
      b.type = 'button'
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-selected', String(tab === t))
      if (counts[t] > 0) b.append(el('span', 'cb-lv-n', String(counts[t])))
      b.addEventListener('click', () => {
        if (tab === t) return
        tab = t
        saveTab(t)
        if (t === 'armed') warmOthers()
        draw()
      })
      bar.append(b)
    }
    root.append(bar)
  }

  // ── Levels: tiles ──
  const drawLevels = () => {
    if (!read) {
      root.append(el('p', 'cb-lv-hint', 'Reading the levels…'))
      return
    }
    const px = read.price
    for (const group of ['Voltick', 'Session', 'Prior'] as Group[]) {
      const levels = read.levels.filter((l) => l.group === group)
      if (!levels.length) continue
      root.append(el('div', 'cb-lv-group', GROUP_LABEL[group]))
      const tiles = el('div', 'cb-lv-tiles')
      for (const lv of levels) {
        const on = isArmed(sym, lv.key)
        const has = lv.price != null && Number.isFinite(lv.price)
        const tile = el('button', 'cb-lv-tile')
        tile.type = 'button'
        tile.dataset.on = String(on)
        tile.setAttribute('aria-pressed', String(on))
        tile.disabled = !has && !on
        tile.title = on ? 'Armed · tap to disarm' : has ? `Alert when ${sym} crosses the ${inSentence(lv.name)}` : 'No value yet'
        const nm = el('span', 'cb-lv-nm')
        const mk = markOf(lv.key)
        if (mk) nm.append(mk)
        nm.append(el('span', 'cb-lv-nmt', lv.name))
        const vv = el('span', 'cb-lv-vv')
        if (has) {
          vv.append(el('b', '', fmt(lv.price)))
          if (px != null) vv.append(el('i', '', `${lv.price! >= px ? '↑' : '↓'} ${Math.abs(lv.price! - px).toFixed(2)}`))
        } else {
          const ib = lv.key === 'ibh' || lv.key === 'ibl'
          vv.append(el('i', '', ib && etMinutesOfDay(Date.now()) < 630 ? 'after 10:30' : 'no value yet'))
        }
        const bell = el('span', 'cb-lv-bell')
        bell.append(bellIcon(!on))
        tile.append(nm, vv, bell)
        tile.addEventListener('click', () => toggleArmed(sym, lv))
        tiles.append(tile)
      }
      root.append(tiles)
    }
  }

  // ── Armed: every symbol ──
  const drawArmed = () => {
    if (!armed.length) {
      root.append(el('p', 'cb-lv-empty', 'Nothing is armed. Tap a level under Levels to arm it.'))
      return
    }
    const rows = armed.map((a) => {
      const r = readOf(a.sym)
      const L = r?.levels.find((l) => l.key === a.key)?.price ?? null
      const P = r?.price ?? null
      const dist = L != null && P != null && Number.isFinite(L) ? Math.abs(L - P) : null
      return { a, L, dist }
    })
    rows.sort((x, y) => {
      const xs = x.a.sym === sym ? 0 : 1
      const ys = y.a.sym === sym ? 0 : 1
      if (xs !== ys) return xs - ys
      if (x.a.sym !== y.a.sym) return x.a.sym < y.a.sym ? -1 : 1
      if (x.dist != null && y.dist != null && x.dist !== y.dist) return x.dist - y.dist
      if ((x.dist == null) !== (y.dist == null)) return x.dist == null ? 1 : -1
      return orderOf(x.a.key) - orderOf(y.a.key)
    })
    for (const { a, L, dist } of rows) {
      const row = el('div', 'cb-lv-ar')
      const who = el('span', 'cb-lv-who')
      const b = el('b', '')
      b.append(el('span', 'cb-lv-tk', a.sym))
      const mk = markOf(a.key)
      if (mk) b.append(mk)
      b.append(el('span', 'cb-lv-nmt', a.name))
      const follows = isMarkKey(a.key) ? ' · follows the level' : ''
      who.append(b, el('span', '', `${L != null ? fmt(L) : 'no value yet'}${follows}`))
      const st = el('span', 'cb-lv-st', dist != null ? `${dist.toFixed(2)} away` : '')
      const x = el('button', 'cb-lv-x', '✕')
      x.type = 'button'
      x.title = `Disarm the ${a.sym} ${inSentence(a.name)} alert`
      x.addEventListener('click', () => disarm(a.id))
      row.append(who, st, x)
      root.append(row)
    }
    const acts = el('div', 'cb-lv-acts')
    const off = el('button', 'cb-lv-btn', 'Disarm all')
    off.type = 'button'
    off.title = 'Disarm every level alert, on every symbol'
    off.addEventListener('click', () => disarmAll())
    acts.append(off)
    root.append(acts)
  }

  // ── Fired: today ──
  const drawFired = () => {
    const today = firedToday()
    if (!today.length) {
      root.append(el('p', 'cb-lv-empty', 'Nothing has fired today.'))
    }
    for (const f of today) {
      const row = el('div', 'cb-lv-ar')
      row.dataset.fired = 'true'
      const who = el('span', 'cb-lv-who')
      const b = el('b', '')
      b.append(el('span', 'cb-lv-tk', f.sym))
      const mk = markOf(f.key)
      if (mk) b.append(mk)
      b.append(el('span', 'cb-lv-nmt', `${f.name} · crossed ${f.dir}`))
      who.append(b, el('span', '', `${etClock(f.at)} · at ${fmt(f.level)}`))
      const again = el('button', 'cb-lv-btn')
      again.type = 'button'
      const on = isArmed(f.sym, f.key)
      again.textContent = on ? 'Armed' : 'Ring again'
      again.disabled = on
      again.title = on ? `The ${f.sym} ${inSentence(f.name)} is armed` : `Arm the ${f.sym} ${inSentence(f.name)} again`
      again.addEventListener('click', () => rearm(f))
      row.append(who, again)
      root.append(row)
    }
    root.append(el('p', 'cb-lv-hint', "Fired alerts also land in the toolbar's Alerts feed and the Script Alerts log."))
  }

  // ── the foot: desktop notifications ──
  const drawFoot = () => {
    const foot = el('div', 'cb-lv-foot')
    const on = notifyWanted()
    const sw = toggle('Desktop notifications', on, on ? 'Stop desktop notifications' : 'Show a desktop notification when an alert fires')
    sw.addEventListener('click', () => {
      void enableNotify(!on).then(() => draw())
    })
    foot.append(sw)
    root.append(foot)
  }

  const draw = () => {
    if (!alive) return
    root.replaceChildren()
    drawHead()
    drawTabs()
    if (tab === 'levels') drawLevels()
    else if (tab === 'armed') drawArmed()
    else drawFired()
    drawFoot()
  }

  /** Read the other armed symbols' levels, for Armed's distances. */
  const warmOthers = () => {
    for (const s of new Set(armed.map((a) => a.sym))) {
      if (s === sym) continue
      void levelsFor(s).then((r) => {
        if (!alive) return
        otherReads.set(s, r)
        if (tab === 'armed') draw()
      })
    }
  }

  const load = (fresh: boolean) => {
    const want = sym
    void levelsFor(want, fresh).then((r) => {
      if (!alive || want !== sym) return
      read = r
      draw()
    })
  }
  /** Onto the chart's current symbol, if it has moved. */
  const syncSym = () => {
    const next = bare(chart.market.symbol)
    if (!alive || next === sym) return
    if (read) otherReads.set(sym, read)
    sym = next
    read = null
    draw()
    load(true)
  }
  /** Follow this chart's symbol switches (Vela re-binds a panel only on a cell change). */
  const follow = () => {
    offMarket?.()
    offMarket = chart.on('market:changed', syncSym)
  }
  follow()
  draw()
  load(true)
  if (tab === 'armed') warmOthers()
  const timer = setInterval(() => {
    if (document.hidden) return
    syncSym()
    load(false)
    if (tab === 'armed') warmOthers()
  }, 30_000)
  armSubs.add(draw)
  return {
    onChart: (next?: Vela) => {
      chart = next ?? chartOf()
      follow()
      syncSym()
    },
    destroy: () => {
      alive = false
      clearInterval(timer)
      offMarket?.()
      offMarket = null
      armSubs.delete(draw)
    },
  }
}
