// ─────────────────────────────────────────────────────────────────────────────
// TIMELINE MARKS — events on every Vela chart's time axis.
//
// Vela's marks lane (chart.marks): a small glyph under the bar an event belongs
// to, clustering when they crowd, a popup on click, and a checkbox per group in
// the chart's settings (Events tab). Three groups, re-supplied whenever a chart
// switches symbol (marks are data, the chart never keeps them):
//
//   Economic   the econ calendar the board's card shows (/api/calendar — the
//              week's US releases): High / Medium / Low as sub-groups, coloured
//              by impact; the popup has forecast / previous / actual.
//   Signals    the toolbar Alerts feed's engine signals (/proxy/signals — flip
//              crosses, CORE changes and touches, IB formed / broken, whale
//              prints, Top GEX Change picks) for the chart's symbol (SPX's on
//              ES charts, NDX's on NQ).
//   Script     your own scripts' alerts as they fire (script/alerts.ts).
//
// Refreshed while the tab is visible: the calendar every 30 minutes, the
// signals every minute.
// ─────────────────────────────────────────────────────────────────────────────

import type { MarkGroup, TimelineMark } from '@luxalgo/vela'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { tokenHex } from '@/design/theme'
import { query } from '@/data/api'
import { etWallMs } from '@/pages/vela/studies/common'
import { onScriptAlertFired, type FiredAlert } from '@/pages/vela/script/alerts'

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

const GROUPS: MarkGroup[] = [
  { id: 'econ', label: 'Economic events' },
  { id: 'econ-high', label: 'High impact', parent: 'econ' },
  { id: 'econ-med', label: 'Medium impact', parent: 'econ' },
  { id: 'econ-low', label: 'Low impact', parent: 'econ', visible: false },
  // Voltick never says "signal": the engine's events are alerts (the id stays)
  { id: 'signals', label: 'Engine alerts' },
  { id: 'script', label: 'Your script alerts' },
]

// Voltick's vocabulary: the flip wears the flip's violet and CORE is the Volt
// (amber); everything else stays off the reserved hues (slate for the IB, a
// measurement; Accent Text and Paper for the rest).
const SIGNAL_LOOK: Record<string, { letter: string; token: string; name: string }> = {
  flip_cross: { letter: 'F', token: '--color-vt-flip', name: 'Flip cross' },
  core_change: { letter: 'V', token: '--color-vt-volt', name: 'Volt change' },
  core_touch: { letter: 'T', token: '--color-vt-volt', name: 'Volt touch' },
  ib_formed: { letter: 'I', token: '--color-vt-slate', name: 'IB formed' },
  ib_break: { letter: 'B', token: '--color-vt-slate', name: 'IB break' },
  whale_print: { letter: 'W', token: '--color-vt-accent-text', name: 'Whale print' },
  gex_change_top: { letter: 'G', token: '--color-vt-paper', name: 'Top GEX change' },
}

const bare = (s: string | undefined) => (s ?? '').replace(/^[^:]*:/, '').trim().toUpperCase()
/** The symbol whose signals a chart shows. */
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

function econMarks(events: CalEvent[]): TimelineMark[] {
  const out: TimelineMark[] = []
  // high is danger (Bad); medium keeps off the Volt's amber
  const high = tokenHex('--color-vt-bad')
  const med = tokenHex('--color-vt-accent-text')
  const low = tokenHex('--color-vt-quiet')
  for (const e of events) {
    const country = (e.country ?? 'USD').toUpperCase()
    if (country !== 'USD' && country !== 'US') continue
    if (!e.date || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !e.title) continue
    const m = /^(\d{1,2}):(\d{2})$/.exec(e.time ?? '')
    const minute = m ? Number(m[1]) * 60 + Number(m[2]) : 9 * 60 + 30
    const time = etWallMs(e.date, minute)
    const imp = (e.impact ?? '').toLowerCase()
    const level = imp.startsWith('high') ? 'high' : imp.startsWith('med') ? 'med' : 'low'
    const bits = [e.actual ? `Actual ${e.actual}` : '', e.forecast ? `Forecast ${e.forecast}` : '', e.previous ? `Previous ${e.previous}` : ''].filter(Boolean)
    out.push({
      id: `econ:${e.date}:${e.time ?? ''}:${e.title}`,
      time,
      title: e.title,
      tooltip: `${e.time_formatted ?? e.time ?? 'All day'} ET · ${e.title}`,
      group: `econ-${level}`,
      glyph: { color: level === 'high' ? high : level === 'med' ? med : low, letter: 'E', shape: 'circle' },
      content: { text: `${e.date} ${e.time_formatted ?? e.time ?? 'All day'} ET · ${e.impact ?? ''} impact${bits.length ? `\n${bits.join(' · ')}` : ''}` },
    })
  }
  return out
}

function signalMarks(rows: SignalRow[], ticker: string): TimelineMark[] {
  const want = signalTicker(ticker)
  const out: TimelineMark[] = []
  for (const r of rows) {
    const look = SIGNAL_LOOK[String(r.kind ?? '')]
    if (!look) continue
    const m = metaOf(r)
    const sym = r.kind === 'whale_print' ? String(m.ticker ?? '').toUpperCase() : r.kind === 'gex_change_top' ? String(m.symbol ?? '').toUpperCase() : 'SPX'
    if (sym !== want) continue
    const tsN = Number(r.ts)
    const time = Number.isFinite(tsN) && tsN > 0 ? (tsN < 1e12 ? tsN * 1000 : tsN) : Date.parse(String(r.ts ?? ''))
    if (!Number.isFinite(time)) continue
    const head = (r.setup ?? look.name).replace(/\s+/g, ' ').trim()
    out.push({
      id: `sig:${r.id ?? time}:${r.kind}`,
      time,
      title: head,
      tooltip: `${look.name} · ${head}`,
      group: 'signals',
      glyph: { color: tokenHex(look.token), letter: look.letter, shape: 'diamond' },
      content: { text: [r.reason ?? '', r.level_name ? `Level ${r.level_name}${r.level_spx ? ` ${r.level_spx}` : ''}` : ''].filter(Boolean).join('\n') || head },
    })
  }
  return out
}

/**
 * Keep every chart in the workspace supplied with the marks for its symbol.
 * Returns the unbind (Vela.tsx calls it on unmount).
 */
export function bindTimelineMarks(ws: VelaWorkspace): () => void {
  let econ: TimelineMark[] = []
  let signals: SignalRow[] = []
  const fired: FiredAlert[] = []
  const offs = new Map<string, () => void>()
  let stopped = false

  const apply = (cellId: string) => {
    const cell = ws.cell(cellId)
    if (!cell) return
    const chart = cell.chart
    const t = bare(chart.market.symbol)
    for (const g of GROUPS) chart.marks.defineGroup(g)
    const script: TimelineMark[] = fired
      .filter((a) => bare(a.symbol) === t)
      .map((a) => ({
        id: `script:${a.libId}:${a.title}:${a.barTime}`,
        time: a.barTime,
        title: `${a.script} · ${a.title}`,
        tooltip: `${a.title} · ${a.text}`,
        group: 'script',
        glyph: { color: tokenHex('--color-accent'), letter: 'S', shape: 'square' as const },
        content: { text: a.text },
      }))
    chart.marks.set([...econ, ...signalMarks(signals, t), ...script])
  }
  const applyAll = () => {
    for (const c of ws.cells()) apply(c.id)
  }
  const watch = (cellId: string) => {
    const cell = ws.cell(cellId)
    if (!cell || offs.has(cellId)) return
    offs.set(cellId, cell.chart.on('market:changed', () => apply(cellId)))
    apply(cellId)
  }

  const loadEcon = async () => {
    try {
      const j = await query<{ events?: CalEvent[]; source?: string }>('/api/calendar', { staleMs: ECON_MS })
      if (stopped || !Array.isArray(j?.events)) return
      econ = econMarks(j.events)
      applyAll()
    } catch {
      /* no calendar — the lane simply has no econ glyphs */
    }
  }
  const loadSignals = async () => {
    try {
      const r = await fetch('/proxy/signals?limit=200', { cache: 'no-store', credentials: 'same-origin' })
      if (!r.ok) return
      const j = (await r.json()) as { rows?: SignalRow[] }
      if (stopped || !Array.isArray(j.rows)) return
      signals = j.rows
      applyAll()
    } catch {
      /* signed out / offline: no signal glyphs */
    }
  }

  for (const c of ws.cells()) watch(c.id)
  const offCreated = ws.on('cell:created', ({ id }) => watch(id))
  const offDestroyed = ws.on('cell:destroyed', ({ id }) => {
    offs.get(id)?.()
    offs.delete(id)
  })
  const offFired = onScriptAlertFired((a) => {
    fired.unshift(a)
    if (fired.length > 200) fired.length = 200
    applyAll()
  })
  void loadEcon()
  void loadSignals()
  const econTimer = setInterval(() => {
    if (!document.hidden) void loadEcon()
  }, ECON_MS)
  const sigTimer = setInterval(() => {
    if (!document.hidden) void loadSignals()
  }, SIGNAL_MS)

  return () => {
    stopped = true
    clearInterval(econTimer)
    clearInterval(sigTimer)
    offCreated()
    offDestroyed()
    offFired()
    for (const off of offs.values()) off()
    offs.clear()
  }
}
