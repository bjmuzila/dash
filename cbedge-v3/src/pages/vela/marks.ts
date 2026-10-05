// ─────────────────────────────────────────────────────────────────────────────
// TIMELINE MARKS: what the Events study (studies/events.ts) draws, as data.
//
// Until 2026-10-04 this file fed Vela's own marks lane (chart.marks): letters in
// dots, a fixed size, and its switches three menus deep in Chart settings →
// Events. Brandon picked E1 (generated/2026-10-04-vela-events-r2.html): the marks
// became our own study with a menu, a size and drawn icons, so this file is now
// only the three sources, read once for every chart on the page:
//
//   releases   the econ calendar the board's card shows (/api/calendar: the
//              week's US releases, high / medium / low impact, forecast /
//              previous / actual). Re-read every 30 minutes.
//   engine     the toolbar Alerts feed's engine alerts (/proxy/signals: flip
//              crosses, Volt changes and touches, IB formed / broken, whale
//              prints, top GEX change) for the chart's symbol (SPX's on ES
//              charts, NDX's on NQ). Re-read every minute.
//   scripts    your own scripts' alerts as they fire (script/alerts.ts).
//
// Each becomes an EventMark: a moment, a kind (one of EV_KINDS, studies/index.ts)
// and what its card says.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '@/data/api'
import { firedAlerts } from '@/pages/vela/script/alerts'
import { etWallMs } from '@/pages/vela/studies/common'
import type { EvKind } from '@/pages/vela/studies/index'

const ECON_MS = 30 * 60_000
const SIGNAL_MS = 60_000

interface CalEvent {
  date?: string
  time?: string
  time_formatted?: string
  title?: string
  country?: string
  impact?: string
  forecast?: string
  previous?: string
  actual?: string
}
interface SignalRow {
  id?: number
  ts?: number | string
  kind?: string
  direction?: string
  setup?: string
  reason?: string | null
  level_name?: string | null
  level_spx?: number | null
  meta?: Record<string, unknown> | string | null
}

export type EventGroup = 'econ' | 'engine' | 'script'

export interface EventMark {
  id: string
  /** The moment, epoch ms. */
  t: number
  kind: EvKind
  group: EventGroup
  title: string
  /** Releases: the numbers. */
  actual?: string
  forecast?: string
  previous?: string
  /** No time given (an all-day release): placed at the open, and its card says so. */
  allDay?: boolean
  /** Alerts: what happened, and the level it happened at. */
  text?: string
  level?: string
}

// ── the engine's alert kinds ──

const SIGNAL_KIND: Record<string, { kind: EvKind; name: string; mark?: string }> = {
  flip_cross: { kind: 'flip', name: 'Flip cross', mark: '⚡' },
  core_change: { kind: 'volt', name: 'Volt change', mark: '★' },
  core_touch: { kind: 'volt', name: 'Volt touch', mark: '★' },
  ib_formed: { kind: 'ib', name: 'IB formed' },
  ib_break: { kind: 'ib', name: 'IB break' },
  whale_print: { kind: 'whale', name: 'Whale print' },
  gex_change_top: { kind: 'gex', name: 'Top GEX change' },
}

const bare = (s: string | undefined) => (s ?? '').replace(/^[^:]*:/, '').trim().toUpperCase()
/** The symbol whose engine alerts a chart shows. */
const signalTicker = (t: string) => (t === 'ES' || t === '/ES' ? 'SPX' : t === 'NQ' || t === '/NQ' ? 'NDX' : t)

function metaOf(r: SignalRow): Record<string, unknown> {
  if (r.meta && typeof r.meta === 'object') return r.meta
  if (typeof r.meta === 'string') {
    try {
      const j = JSON.parse(r.meta)
      return j && typeof j === 'object' ? j : {}
    } catch {
      return {}
    }
  }
  return {}
}

// ── the sources, shared by every chart ──

let econ: EventMark[] = []
let signals: SignalRow[] = []
let econAt = 0
let signalsAt = 0
let econBusy: Promise<void> | null = null
let signalsBusy: Promise<void> | null = null
/** Bumped whenever a source changes, so a study can tell its data moved. */
let version = 0

function econMarks(events: CalEvent[]): EventMark[] {
  const out: EventMark[] = []
  for (const e of events) {
    const country = (e.country ?? 'USD').toUpperCase()
    if (country !== 'USD' && country !== 'US') continue
    if (!e.date || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !e.title) continue
    const m = /^(\d{1,2}):(\d{2})$/.exec(e.time ?? '')
    const minute = m ? Number(m[1]) * 60 + Number(m[2]) : 9 * 60 + 30
    const imp = (e.impact ?? '').toLowerCase()
    out.push({
      id: `econ:${e.date}:${e.time ?? ''}:${e.title}`,
      t: etWallMs(e.date, minute),
      kind: imp.startsWith('high') ? 'high' : imp.startsWith('med') ? 'med' : 'low',
      group: 'econ',
      title: e.title,
      ...(e.actual ? { actual: e.actual } : {}),
      ...(e.forecast ? { forecast: e.forecast } : {}),
      ...(e.previous ? { previous: e.previous } : {}),
      ...(m ? {} : { allDay: true }),
    })
  }
  return out
}

async function readEcon(): Promise<void> {
  try {
    const j = await query<{ events?: CalEvent[] }>('/api/calendar', { staleMs: ECON_MS })
    if (Array.isArray(j?.events)) {
      econ = econMarks(j.events)
      version++
    }
  } catch {
    /* no calendar: no releases on the lane */
  } finally {
    econAt = Date.now()
  }
}

async function readSignals(): Promise<void> {
  try {
    const r = await fetch('/proxy/signals?limit=200', { cache: 'no-store', credentials: 'same-origin' })
    if (r.ok) {
      const j = (await r.json()) as { rows?: SignalRow[] }
      if (Array.isArray(j.rows)) {
        signals = j.rows
        version++
      }
    }
  } catch {
    /* signed out / offline: no engine alerts on the lane */
  } finally {
    signalsAt = Date.now()
  }
}

/** Read whatever is due (both on `fresh`); resolves when done. Shared by every chart. */
export async function refreshEventFeeds(fresh: boolean): Promise<number> {
  const now = Date.now()
  if (fresh || now - econAt >= ECON_MS) econBusy ??= readEcon().finally(() => (econBusy = null))
  if (fresh || now - signalsAt >= SIGNAL_MS) signalsBusy ??= readSignals().finally(() => (signalsBusy = null))
  await Promise.all([econBusy, signalsBusy])
  return version
}

/** Every mark for a chart showing `ticker`, oldest first. */
export function eventMarksFor(ticker: string): EventMark[] {
  const t = bare(ticker)
  const want = signalTicker(t)
  const out: EventMark[] = [...econ]
  for (const r of signals) {
    const look = SIGNAL_KIND[String(r.kind ?? '')]
    if (!look) continue
    const m = metaOf(r)
    const sym = r.kind === 'whale_print' ? String(m.ticker ?? '').toUpperCase() : r.kind === 'gex_change_top' ? String(m.symbol ?? '').toUpperCase() : 'SPX'
    if (sym !== want) continue
    const tsN = Number(r.ts)
    const time = Number.isFinite(tsN) && tsN > 0 ? (tsN < 1e12 ? tsN * 1000 : tsN) : Date.parse(String(r.ts ?? ''))
    if (!Number.isFinite(time)) continue
    const head = (r.setup ?? look.name).replace(/\s+/g, ' ').trim()
    const level = r.level_name ? `${look.mark ? `${look.mark} ` : ''}${r.level_name}${r.level_spx ? ` ${r.level_spx.toLocaleString('en-US')}` : ''}` : ''
    out.push({
      id: `sig:${r.id ?? time}:${r.kind}`,
      t: time,
      kind: look.kind,
      group: 'engine',
      title: head,
      text: (r.reason ?? '').trim() || look.name,
      ...(level ? { level } : {}),
    })
  }
  for (const a of firedAlerts()) {
    if (bare(a.symbol) !== t) continue
    out.push({
      id: `script:${a.libId}:${a.title}:${a.barTime}`,
      t: a.barTime,
      kind: 'script',
      group: 'script',
      title: `${a.script} · ${a.title}`,
      text: a.text,
    })
  }
  return out.sort((a, b) => a.t - b.t)
}
