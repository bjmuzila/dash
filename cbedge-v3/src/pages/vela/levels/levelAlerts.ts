// ─────────────────────────────────────────────────────────────────────────────
// LEVEL ALERTS: "tell me when price crosses the Volt". The levels the chart
// already draws, each with a bell, in Voltick's names (the page is Voltick's
// chart; data/voltickLevels.ts):
//
//   Voltick   ★ Volt                       CORE, the walls recorder's newest slot
//             ◆ Coil                       the wall on CORE's side of price
//             ↘ Reversal                   the wall on the other side
//                                          (the levels the walls study draws; on
//                                          ES / NQ shifted by the day's basis)
//             ⚡︎ Flip                       the front chain's zero-gamma strike
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
// ─────────────────────────────────────────────────────────────────────────────

import type { OHLCV, Vela } from '@luxalgo/vela'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { query } from '@/data/api'
import { chainGexUrl, chainToGex } from '@/board/chainGex'
import { CbEdgeProvider, resolveSym } from '@/pages/vela/cbedgeProvider'
import { loadBasis, wallSeriesFor } from '@/pages/vela/wallsIndicator'
import { vtFromWalls } from '@/pages/levelLog/wallData'
import { etDateKey, etMinutesOfDay } from '@/pages/vela/studies/common'
import { replayActive } from '@/pages/vela/replay/clock'
import { deliverAlert, enableNotify, notifyWanted, tfLabel } from '@/pages/vela/script/alerts'
import { ARMED_KEY } from './levelAlertsEntry'

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
const VT_LEVEL: Record<'volt' | 'coil' | 'reversal' | 'flip', { name: string; mark: string; tone: string }> = {
  volt: { name: 'Volt', mark: '★', tone: 'var(--color-vt-volt)' },
  coil: { name: 'Coil', mark: '◆', tone: 'var(--color-vt-coil)' },
  reversal: { name: 'Reversal', mark: '↘', tone: 'var(--color-vt-reversal)' },
  flip: { name: 'Flip', mark: FLIP_MARK, tone: 'var(--color-vt-flip)' },
}
const vtLevel = (key: keyof typeof VT_LEVEL, price: number | null): Level => ({ key, group: 'Voltick', price, ...VT_LEVEL[key] })

/** A level's name inside a sentence: Voltick names and IB keep their capital. */
const inSentence = (n: string) => (/^(Volt|Coil|Reversal|Flip|IB)\b/.test(n) ? n : n.charAt(0).toLowerCase() + n.slice(1))

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
const reads = new Map<string, { at: number; p: Promise<LevelRead> }>()

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
  // the walls, renamed: today's bars only, so the read covers one session
  try {
    const w = await wallSeriesFor(sym, todays.length ? todays : bars.slice(-80), '5', true)
    const fin = (v: number) => Number.isFinite(v)
    const vt = vtFromWalls(last(w.core, fin), last(w.callWall, fin), last(w.putWall, fin), price)
    out.push(vtLevel('volt', vt.volt), vtLevel('coil', vt.coil), vtLevel('reversal', vt.reversal))
  } catch {
    out.push(vtLevel('volt', null), vtLevel('coil', null), vtLevel('reversal', null))
  }
  // gamma flip off the front chain
  try {
    const ticker = r.fut === 'NQ' ? 'NDX' : r.fut === 'ES' ? 'SPX' : r.key
    const g = chainToGex(await query<unknown>(chainGexUrl(ticker), { staleMs: 60_000 }))
    let shift = 0
    if (r.fut) {
      const b = await loadBasis(r.fut)
      shift = b.basis > 0 && b.basis < b.max ? b.basis : NaN
    }
    out.push(vtLevel('flip', g.flip != null && Number.isFinite(shift) ? g.flip + shift : null))
  } catch {
    out.push(vtLevel('flip', null))
  }
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

/** The levels for a symbol, shared for 50 s. */
export function levelsFor(sym: string, fresh = false): Promise<LevelRead> {
  const hit = reads.get(sym)
  if (hit && Date.now() - hit.at < (fresh ? 20_000 : 50_000)) return hit.p
  const p = readLevels(sym).catch(() => ({ at: Date.now(), levels: [], price: null }))
  reads.set(sym, { at: Date.now(), p })
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

export function mountLevelPanel(chartOf: () => Vela, body: HTMLElement): { onChart: () => void; destroy: () => void } {
  const root = el('div', 'cb-lv')
  body.replaceChildren(root)
  let sym = bare(chartOf().market.symbol)
  let read: LevelRead | null = null
  let alive = true

  const draw = () => {
    if (!alive) return
    root.replaceChildren()
    const head = el('div', 'cb-lv-head')
    head.append(el('span', 'cb-lv-sym', sym), el('span', 'cb-lv-px', read?.price != null ? fmt(read.price) : ''))
    root.append(head)
    root.append(el('p', 'cb-lv-hint', 'Ring a bell to be told when price crosses that level. A Volt, Coil or Reversal alert follows that level as it moves. Each fires once.'))
    if (!read) {
      root.append(el('p', 'cb-lv-hint', 'Reading the levels…'))
    } else {
      for (const group of ['Voltick', 'Session', 'Prior'] as Group[]) {
        const rows = read.levels.filter((l) => l.group === group)
        if (!rows.length) continue
        root.append(el('div', 'cb-lv-group', GROUP_LABEL[group]))
        for (const lv of rows) {
          const row = el('div', 'cb-lv-row')
          const on = isArmed(sym, lv.key)
          row.dataset.on = String(on)
          const dist = read.price != null && lv.price != null ? lv.price - read.price : null
          const name = el('span', 'cb-lv-name')
          if (lv.mark) {
            // Voltick's Chip: the mark carries the colour, the word stays Paper
            const mk = el('span', 'cb-lv-mark', lv.mark)
            if (lv.tone) mk.style.color = lv.tone
            name.append(mk)
          }
          name.append(document.createTextNode(lv.name))
          const val = el('span', 'cb-lv-val', fmt(lv.price))
          const d = el('span', 'cb-lv-dist', dist == null ? '' : `${dist >= 0 ? '+' : '−'}${Math.abs(dist).toFixed(2)}`)
          if (dist != null) d.dataset.tone = dist >= 0 ? 'up' : 'down'
          const bell = el('button', 'cb-lv-bell')
          bell.append(bellIcon(!on))
          bell.type = 'button'
          bell.title = lv.price == null ? 'Not available yet' : on ? 'Armed: click to disarm' : `Alert when ${sym} crosses the ${inSentence(lv.name)}`
          bell.disabled = lv.price == null && !on
          bell.setAttribute('aria-pressed', String(on))
          bell.addEventListener('click', () => {
            toggleArmed(sym, lv)
            draw()
          })
          row.append(name, val, d, bell)
          root.append(row)
        }
      }
    }
    // armed anywhere else
    const others = armed.filter((a) => a.sym !== sym)
    if (others.length) {
      root.append(el('div', 'cb-lv-group', 'Armed on other symbols'))
      for (const a of others) {
        const row = el('div', 'cb-lv-row')
        row.dataset.on = 'true'
        const x = el('button', 'cb-lv-bell', '✕')
        x.type = 'button'
        x.title = 'Disarm'
        x.addEventListener('click', () => {
          disarm(a.id)
          draw()
        })
        row.append(el('span', 'cb-lv-name', `${a.sym} · ${a.name}`), el('span', 'cb-lv-val', ''), el('span', 'cb-lv-dist', ''), x)
        root.append(row)
      }
    }
    const foot = el('label', 'cb-lv-foot')
    const box = el('input', '')
    box.type = 'checkbox'
    box.checked = notifyWanted()
    box.addEventListener('change', () => {
      void enableNotify(box.checked).then((ok) => {
        if (box.checked && !ok) box.checked = false
      })
    })
    foot.append(box, document.createTextNode(' Desktop notifications'))
    root.append(foot)
    root.append(el('p', 'cb-lv-hint', `Fired alerts land in the toolbar's Alerts feed and the Script Alerts log (${tfLabel(chartOf().market.timeframe ?? '5')} chart).`))
  }

  const load = (fresh: boolean) => {
    const want = sym
    void levelsFor(want, fresh).then((r) => {
      if (!alive || want !== sym) return
      read = r
      draw()
    })
  }
  draw()
  load(true)
  const timer = setInterval(() => !document.hidden && load(false), 30_000)
  armSubs.add(draw)
  return {
    onChart: () => {
      const next = bare(chartOf().market.symbol)
      if (next === sym) return
      sym = next
      read = null
      draw()
      load(true)
    },
    destroy: () => {
      alive = false
      clearInterval(timer)
      armSubs.delete(draw)
    },
  }
}
