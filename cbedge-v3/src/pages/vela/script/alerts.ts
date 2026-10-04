// ─────────────────────────────────────────────────────────────────────────────
// CB SCRIPT — alerts: when a script's alertcondition() / alert() fires LIVE.
//
// The runtime records every bar a condition was true and every alert() call
// (RunResult.alerts). The engine hands each run's record here (scan), and this
// decides what is NEW: only bars that appear after the script was put on the
// chart (or after its alerts were switched on) can fire, once per bar per
// alert — a re-run of the forming bar never fires the same alert twice, and the
// history a script loads with never fires at all.
//
// Off until switched on, per library script, in the Script Alerts panel
// (testerPanels.ts — TradingView's model: a script's alert conditions do
// nothing until an alert is made from them). A fired alert goes to:
//   · the toolbar's Alerts feed, as a "Script" row (shell/scriptAlerts.ts)
//   · a toast in the corner of the page
//   · the Script Alerts panel's log (onScriptAlertFired)
//   · a desktop notification, when the browser has granted it
// ─────────────────────────────────────────────────────────────────────────────

import { pushScriptAlert } from '@/shell/scriptAlerts'
import type { RunResult } from './runtime'

const ARMED_KEY = 'cb-v3-vela-script-alerts'
const NOTIFY_KEY = 'cb-v3-vela-script-notify'

export interface FiredAlert {
  at: number
  libId: string
  script: string
  symbol: string
  timeframe: string
  title: string
  text: string
  barTime: number
}

/** `5m`, `1h`, `4h`, `1D` — a Vela timeframe as the chart's own button writes it. */
export function tfLabel(tf: string): string {
  if (/^\d+$/.test(tf)) {
    const m = Number(tf)
    return m % 60 === 0 ? `${m / 60}h` : `${m}m`
  }
  return /^\d*[DWM]$/.test(tf) ? (/^\d/.test(tf) ? tf : `1${tf}`) : tf
}
// ── Switched on / off, per library script ──
function readArmed(): Record<string, boolean> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(ARMED_KEY) ?? '{}')
    return raw && typeof raw === 'object' ? (raw as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}
let armed = readArmed()
export function alertsArmed(libId: string): boolean {
  return armed[libId] === true
}
export function setAlertsArmed(libId: string, on: boolean): void {
  armed = { ...armed, [libId]: on }
  if (!on) delete armed[libId]
  try {
    localStorage.setItem(ARMED_KEY, JSON.stringify(armed))
  } catch {
    /* private mode — on for this page's life */
  }
}

export function notifyWanted(): boolean {
  try {
    return localStorage.getItem(NOTIFY_KEY) === '1'
  } catch {
    return false
  }
}
/** Ask the browser for desktop notifications (from a click). Resolves whether they are on. */
export async function enableNotify(on: boolean): Promise<boolean> {
  try {
    localStorage.setItem(NOTIFY_KEY, on ? '1' : '0')
  } catch {
    /* private mode */
  }
  if (!on || typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  return (await Notification.requestPermission()) === 'granted'
}

// ── The log + listeners ──
const log: FiredAlert[] = []
const listeners = new Set<(a: FiredAlert) => void>()
export function onScriptAlertFired(fn: (a: FiredAlert) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export function firedAlerts(): readonly FiredAlert[] {
  return log
}

let toastHost: HTMLDivElement | null = null
function toast(a: FiredAlert): void {
  if (typeof document === 'undefined') return
  if (!toastHost || !toastHost.isConnected) {
    toastHost = document.createElement('div')
    toastHost.className = 'cb-scr-toasts'
    toastHost.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:60;pointer-events:none'
    document.body.appendChild(toastHost)
  }
  const t = document.createElement('div')
  t.className = 'cb-scr-toast'
  t.setAttribute('role', 'status')
  const head = document.createElement('div')
  head.className = 'cb-scr-toast-head'
  head.textContent = `${a.symbol} · ${a.title}`
  const body = document.createElement('div')
  body.textContent = a.text
  const foot = document.createElement('div')
  foot.className = 'cb-scr-toast-foot'
  foot.textContent = `${a.script} · ${tfLabel(a.timeframe)}`
  t.append(head, body, foot)
  toastHost.prepend(t)
  while (toastHost.children.length > 4) toastHost.lastElementChild?.remove()
  setTimeout(() => t.remove(), 9000)
  t.addEventListener('click', () => t.remove())
}

function deliver(a: FiredAlert): void {
  log.unshift(a)
  if (log.length > 100) log.length = 100
  pushScriptAlert({ ticker: a.symbol, title: a.title, text: a.text, meta: `${a.script} · ${tfLabel(a.timeframe)}`, ts: a.at })
  toast(a)
  if (notifyWanted() && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(`${a.symbol} · ${a.title}`, { body: a.text, tag: `${a.libId}|${a.title}|${a.barTime}` })
    } catch {
      /* some browsers only allow notifications from a service worker */
    }
  }
  for (const fn of listeners) fn(a)
}

// ── What is new since the last run ──
interface Cursor {
  /** Per alert key: the newest bar time already accounted for. */
  last: Map<string, number>
  ready: boolean
  /** The newest bar's time at the previous scan — a jump means a reload, not a live bar. */
  newest: number
}
const cursors = new Map<string, Cursor>()

/** Forget an instance (its chart / script went away, or its inputs changed: start over). */
export function dropAlertCursor(instanceId: string): void {
  for (const k of [...cursors.keys()]) if (k.startsWith(`${instanceId}|`)) cursors.delete(k)
}

/**
 * One run of a script on a chart. The first run (and every run while the script's
 * alerts are off) only moves the marks: nothing older than "now" ever fires.
 */
export function scanAlerts(
  instanceId: string,
  libId: string,
  script: string,
  res: RunResult,
  bars: readonly { time: number }[],
  symbol: string,
  timeframe: string,
): void {
  const n = bars.length
  if (!n) return
  // a symbol / timeframe switch is a different chart: its history never fires
  const key = `${instanceId}|${symbol}|${timeframe}`
  let cur = cursors.get(key)
  if (!cur) cursors.set(key, (cur = { last: new Map(), ready: false, newest: 0 }))
  // live bars arrive one at a time: the newest bar of the last scan is still the newest,
  // or the one before it. Anything else (a session switch, a reload after the tab slept,
  // history swapped under the chart) put bars here that are history too — they move the
  // marks only. Counted in BARS, so the 09:30 bar after an overnight gap still fires.
  const newest = bars[n - 1]!.time
  const prevAt = cur.newest === newest ? n - 1 : n > 1 && bars[n - 2]!.time === cur.newest ? n - 2 : -1
  const jumped = cur.ready && prevAt < 0
  cur.newest = newest
  const on = cur.ready && !jumped && alertsArmed(libId)
  const timeOf = (i: number) => bars[i]?.time ?? 0
  const visit = (key: string, i: number, title: string, text: string) => {
    const t = timeOf(i)
    const prev = cur.last.get(key) ?? -Infinity
    if (t <= prev) return
    cur.last.set(key, t)
    if (on) deliver({ at: Date.now(), libId, script, symbol, timeframe, title, text, barTime: t })
  }
  for (const c of res.alerts.conditions) {
    const last = c.fired[c.fired.length - 1]
    // the forming bar or the one that just closed — a condition true further back is history
    if (last && last.i >= n - 2) visit(`c|${c.title}`, last.i, c.title, last.text)
  }
  for (const a of res.alerts.calls) {
    if (a.i < n - 2) continue
    if (a.freq === 'once_per_bar_close' && a.i === n - 1) continue
    // once per bar per alert() CALL — its message can change every tick
    visit(`a|${a.site}`, a.i, 'alert()', a.message)
  }
  if (!cur.ready) {
    // The first run: everything already on the chart is history.
    for (const c of res.alerts.conditions) cur.last.set(`c|${c.title}`, Math.max(cur.last.get(`c|${c.title}`) ?? -Infinity, timeOf(n - 1)))
    cur.ready = true
  }
}
