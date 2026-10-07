// ─────────────────────────────────────────────────────────────────────────────
// VELA TELEMETRY (Brandon, 2026-10-07: "need vela tracking on the owner.cbedge.net
// page — how many on and who, what tickers being used, what indicators being
// used, anything and everything possible to track").
//
// One tab = one SESSION (an id kept in sessionStorage, so a reload continues it).
// The page sends to /api/vela/telemetry (server-v2/vela-telemetry.cjs), and
// owner.cbedge.net → Voltick → Vela Usage reads it back.
//
//   HEARTBEAT   every 30 s, and 3 s after anything on the page changes: a
//               snapshot of the whole layout — every chart's symbol, timeframe,
//               session, indicators (and which are hidden), drawings, which
//               chart is active / maximized, the GEX switch, the open panel,
//               replay — plus how long the tab was VISIBLE since the last beat,
//               and how much of that the user was ENGAGED (a key, click, wheel
//               or pointer move in the last 2 minutes). The server turns the
//               visible time into time-on-ticker / timeframe / indicator /
//               layout, per user and per day.
//   EVENTS      what people DO, batched into the next beat: symbol and timeframe
//               switches, indicators added / removed / hidden / re-set, drawings,
//               layout and maximize, replay, every chart load (with how long it
//               took), indicator and page errors, and our own actions (copy
//               indicators, center today, refresh, screenshot, the Indicators
//               dialog, Add all, lists saved, the GEX switch). `track()` is the
//               one call any module makes for its own action.
//   END         the last beat goes out with sendBeacon when the tab is closed,
//               so a session's end time is real.
//
// Nothing here throws into the page: every read is guarded, a failed send is
// dropped (the next beat carries the queue), and the queue is capped.
// ─────────────────────────────────────────────────────────────────────────────

import type { IndicatorHandle } from '@luxalgo/vela'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { gexBasis, onGexBasis } from '@/pages/vela/gexBasis'

const ENDPOINT = '/api/vela/telemetry'
const HEARTBEAT_MS = 30_000
const SOON_MS = 3_000
const ENGAGED_WINDOW_MS = 120_000
const MAX_QUEUE = 300
const MAX_ERRORS = 25
const SID_KEY = 'cb-vela-tel-sid'

type Props = Record<string, string | number | boolean | null | undefined>

interface TelEvent {
  name: string
  ts: number
  props?: Props
}

// ── state shared by track() and the binder ──
const queue: TelEvent[] = []
let errorsSent = 0
let schedule: (() => void) | null = null

function sessionId(): string {
  try {
    const have = sessionStorage.getItem(SID_KEY)
    if (have) return have
  } catch {
    /* storage blocked: a fresh id per load */
  }
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  try {
    sessionStorage.setItem(SID_KEY, id)
  } catch {
    /* fine */
  }
  return id
}

const clip = (v: unknown, n = 120): string => String(v ?? '').slice(0, n)

/** Record something the user did. Safe to call before the page is bound (it waits in the queue). */
export function track(name: string, props?: Props): void {
  try {
    if (queue.length >= MAX_QUEUE) queue.shift()
    queue.push({ name: clip(name, 40), ts: Date.now(), ...(props ? { props } : {}) })
    schedule?.()
  } catch {
    /* never into the page */
  }
}

// ── reading the page ──

/** "Voltick Net GEX · overall net GEX" → "Net GEX"; a script's title as it is. */
export function indicatorName(h: Pick<IndicatorHandle, 'title' | 'nativeType'>): string {
  const t = String(h.title || h.nativeType || 'Indicator')
  const at = t.indexOf(' · ')
  return (at > 0 ? t.slice(0, at) : t).replace(/^(?:Voltick|CB)\s+/, '').slice(0, 60)
}

const bare = (symbol: string | undefined) => String(symbol ?? '').replace(/^[^:]*:/, '').trim().toUpperCase()

interface CellSnap {
  id: string
  symbol: string
  tf: string
  session: string
  active: boolean
  replay: boolean
  drawings: number
  indicators: { name: string; type: string | null; hidden: boolean }[]
}

function snapshot(ws: VelaWorkspace, replaying: Set<string>, phone: boolean) {
  const active = (() => {
    try {
      return ws.active.id
    } catch {
      return null
    }
  })()
  const cells: CellSnap[] = []
  for (const c of ws.cells()) {
    try {
      const m = c.chart.market
      let drawings = 0
      try {
        drawings = c.chart.drawings.all().length
      } catch {
        /* no drawings layer */
      }
      cells.push({
        id: c.id,
        symbol: bare(m.symbol),
        tf: String(m.timeframe ?? ''),
        session: String(m.session ?? 'regular'),
        active: c.id === active,
        replay: replaying.has(c.id),
        drawings,
        indicators: c.chart.indicators().map((h) => ({ name: indicatorName(h), type: h.nativeType ?? null, hidden: !h.visible })),
      })
    } catch {
      /* a cell mid-teardown */
    }
  }
  let panel: string | null = null
  try {
    panel = ws.getState().panels?.open ?? null
  } catch {
    /* fine */
  }
  let layout = ''
  try {
    layout = ws.layout.id
  } catch {
    /* fine */
  }
  let maximized: string | null = null
  try {
    maximized = ws.maximizedCell
  } catch {
    /* fine */
  }
  return {
    layout,
    maximized,
    panel,
    gex: gexBasis(),
    phone,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    cells,
  }
}

/** Start reporting this page. Returns the unbind for the page's cleanup. */
export function bindTelemetry(ws: VelaWorkspace, opts: { phone: boolean }): () => void {
  const sid = sessionId()
  const offs: Array<() => void> = []
  const cellOffs = new Map<string, Array<() => void>>()
  const replaying = new Set<string>()
  /** id → name of every indicator seen, so a removal can be named after it is gone. */
  const names = new Map<string, { name: string; type: string | null }>()
  let stopped = false
  let first = true

  // visible / engaged time since the last beat
  let visibleMs = 0
  let engagedMs = 0
  let lastTick = Date.now()
  let lastInput = Date.now()
  const tick = () => {
    const now = Date.now()
    const dt = Math.min(now - lastTick, HEARTBEAT_MS * 4)
    lastTick = now
    if (document.visibilityState !== 'visible') return
    visibleMs += dt
    if (now - lastInput < ENGAGED_WINDOW_MS) engagedMs += dt
  }

  const send = (end = false) => {
    if (stopped && !end) return
    tick()
    let snap: ReturnType<typeof snapshot> | null = null
    try {
      snap = snapshot(ws, replaying, opts.phone)
    } catch {
      snap = null
    }
    const events = queue.splice(0, queue.length)
    const body = {
      sid,
      first,
      end,
      visible: document.visibilityState === 'visible',
      visibleMs: Math.round(visibleMs),
      engagedMs: Math.round(engagedMs),
      host: location.host,
      path: location.pathname,
      tz: (() => {
        try {
          return Intl.DateTimeFormat().resolvedOptions().timeZone
        } catch {
          return ''
        }
      })(),
      lang: navigator.language,
      screen: `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`,
      snapshot: snap,
      events,
    }
    visibleMs = 0
    engagedMs = 0
    first = false
    const json = JSON.stringify(body)
    if (end && navigator.sendBeacon) {
      try {
        navigator.sendBeacon(ENDPOINT, new Blob([json], { type: 'application/json' }))
        return
      } catch {
        /* fall through to fetch */
      }
    }
    void fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, credentials: 'same-origin', keepalive: end }).catch(() => {
      // put the events back for the next beat (oldest first, still capped)
      const room = MAX_QUEUE - queue.length
      if (room > 0) queue.unshift(...events.slice(-room))
    })
  }

  // ── when to send: every 30 s, and soon after a change ──
  let soon: ReturnType<typeof setTimeout> | null = null
  schedule = () => {
    if (stopped || soon) return
    soon = setTimeout(() => {
      soon = null
      send()
    }, SOON_MS)
  }
  const beat = setInterval(() => send(), HEARTBEAT_MS)
  const ticker = setInterval(tick, 5_000)
  offs.push(() => clearInterval(beat), () => clearInterval(ticker), () => soon && clearTimeout(soon))

  // ── input = engaged ──
  const onInput = () => {
    lastInput = Date.now()
  }
  for (const t of ['pointerdown', 'keydown', 'wheel', 'pointermove'] as const) {
    window.addEventListener(t, onInput, { passive: true, capture: true })
    offs.push(() => window.removeEventListener(t, onInput, { capture: true }))
  }
  const onVis = () => {
    tick()
    track(document.visibilityState === 'visible' ? 'tab_visible' : 'tab_hidden')
  }
  document.addEventListener('visibilitychange', onVis)
  offs.push(() => document.removeEventListener('visibilitychange', onVis))
  const onHide = () => send(true)
  window.addEventListener('pagehide', onHide)
  offs.push(() => window.removeEventListener('pagehide', onHide))

  // ── page errors (capped) ──
  const onError = (e: ErrorEvent) => {
    if (errorsSent++ >= MAX_ERRORS) return
    track('js_error', { msg: clip(e.message, 200), src: clip(e.filename, 120), line: e.lineno || null })
  }
  const onRejection = (e: PromiseRejectionEvent) => {
    if (errorsSent++ >= MAX_ERRORS) return
    const r = e.reason as { message?: unknown } | undefined
    track('js_error', { msg: clip(r?.message ?? e.reason, 200), src: 'promise' })
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  offs.push(() => window.removeEventListener('error', onError), () => window.removeEventListener('unhandledrejection', onRejection))

  // ── each chart's own events ──
  const bindCell = (id: string) => {
    if (cellOffs.has(id)) return
    const cell = ws.cell(id)
    if (!cell) return
    const chart = cell.chart
    const sym = () => bare(chart.market.symbol)
    const tf = () => String(chart.market.timeframe ?? '')
    const remember = () => {
      try {
        for (const h of chart.indicators()) names.set(h.id, { name: indicatorName(h), type: h.nativeType ?? null })
      } catch {
        /* fine */
      }
    }
    remember()
    const loads = new Map<string, number>()
    const on: Array<() => void> = []
    on.push(
      chart.on('market:changed', (p) => {
        const from = bare(p.prev?.symbol)
        const to = bare(p.symbol)
        if (from !== to) track('symbol', { from, to, tf: tf() })
        if (String(p.prev?.timeframe ?? '') !== String(p.timeframe ?? '')) track('timeframe', { from: String(p.prev?.timeframe ?? ''), to: String(p.timeframe ?? ''), symbol: to })
        remember()
      }),
      chart.on('load:start', (p) => {
        loads.set(`${p.symbol}|${p.timeframe}`, performance.now())
      }),
      chart.on('load:end', (p) => {
        const k = `${p.symbol}|${p.timeframe}`
        const t0 = loads.get(k)
        loads.delete(k)
        if (t0 == null) return
        track('load', { symbol: bare(p.symbol), tf: String(p.timeframe), ms: Math.round(performance.now() - t0), bars: p.bars })
      }),
      chart.on('indicator:added', ({ id: hid }) => {
        const h = chart.indicators().find((x) => x.id === hid)
        if (!h) return
        const n = { name: indicatorName(h), type: h.nativeType ?? null }
        names.set(hid, n)
        track('indicator_add', { name: n.name, type: n.type, symbol: sym(), tf: tf() })
      }),
      chart.on('indicator:removed', ({ id: hid }) => {
        const n = names.get(hid)
        track('indicator_remove', { name: n?.name ?? 'Indicator', type: n?.type ?? null, symbol: sym() })
      }),
      chart.on('indicator:inputs', ({ id: hid }) => {
        const n = names.get(hid)
        track('indicator_settings', { name: n?.name ?? 'Indicator', symbol: sym() })
      }),
      chart.on('indicator:visibility', (p) => {
        const n = names.get(p.id)
        track(p.visible ? 'indicator_show' : 'indicator_hide', { name: n?.name ?? 'Indicator' })
      }),
      chart.on('indicator:error', (p) => {
        if (errorsSent++ >= MAX_ERRORS) return
        const n = names.get(p.id)
        track('indicator_error', { name: n?.name ?? 'Indicator', msg: clip(p.error?.message, 200), symbol: sym() })
      }),
      chart.on('drawing:created', ({ id: did }) => {
        let type = ''
        try {
          type = String(chart.drawings.all().find((d) => d.id === did)?.type ?? '')
        } catch {
          /* fine */
        }
        track('drawing_add', { type: clip(type, 30), symbol: sym() })
      }),
      chart.on('drawing:removed', () => track('drawing_remove', { symbol: sym() })),
      chart.on('replay:start', () => {
        replaying.add(id)
        track('replay_start', { symbol: sym(), tf: tf() })
      }),
      chart.on('replay:end', () => {
        replaying.delete(id)
        track('replay_end', { symbol: sym() })
      }),
      chart.on('theme:changed', () => track('theme')),
    )
    cellOffs.set(id, on)
  }
  const unbindCell = (id: string) => {
    for (const off of cellOffs.get(id) ?? []) off()
    cellOffs.delete(id)
    replaying.delete(id)
  }
  for (const c of ws.cells()) bindCell(c.id)

  offs.push(
    ws.on('cell:created', ({ id }) => {
      bindCell(id)
      track('chart_added')
    }),
    ws.on('cell:destroyed', ({ id }) => {
      unbindCell(id)
      track('chart_removed')
    }),
    ws.on('layout:changed', ({ layout }) => track('layout', { to: String(layout) })),
    ws.on('cell:maximized', ({ id }) => track(id ? 'maximize' : 'restore')),
    ws.on('cell:active', () => schedule?.()),
    ws.on('state:changed', () => schedule?.()),
    onGexBasis(() => track('gex_basis', { to: gexBasis() })),
  )

  // the panel open, read off the state (Vela has no event of its own for it)
  let lastPanel: string | null | undefined
  offs.push(
    ws.on('state:changed', () => {
      let p: string | null = null
      try {
        p = ws.getState().panels?.open ?? null
      } catch {
        return
      }
      if (lastPanel !== undefined && p !== lastPanel && p) track('panel', { name: p })
      lastPanel = p
    }),
  )

  track('session_start', { phone: opts.phone, cells: ws.cells().length })
  // the first beat once the charts have had a moment to load
  const firstBeat = setTimeout(() => send(), 4_000)
  offs.push(() => clearTimeout(firstBeat))

  return () => {
    send(true)
    stopped = true
    schedule = null
    for (const id of [...cellOffs.keys()]) unbindCell(id)
    for (const off of offs) {
      try {
        off()
      } catch {
        /* fine */
      }
    }
  }
}
