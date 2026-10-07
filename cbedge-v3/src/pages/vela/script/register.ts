// ─────────────────────────────────────────────────────────────────────────────
// CB SCRIPT — what the /vela page registers EAGERLY, and nothing more.
//
// The Scripts editor (panel.ts), the Strategy Tester and the Script Alerts
// panel (testerPanels.ts, with strategies.ts behind it) are UI nobody sees until
// they open one. They used to ride in the page chunk; since the 2026-10-07
// audit they load on the panel's FIRST OPEN. What has to exist before that:
//
//   · the three panel buttons (registerSidePanel), each mounting a lazy shell
//     (lazyPanel below) that imports the real panel the first time it shows
//   · the chart persistence of scripts (registerStatePersistence) — a saved
//     chart re-adds its scripts on load, editor open or not
//   · the levels loader the runtime reads cbedge.call_wall / put_wall / core from
//
// The script ENGINE (engine.ts) stays eager: Vela needs it to run a saved
// chart's scripts. The runtime itself was already a lazy chunk (loadRuntime).
// ─────────────────────────────────────────────────────────────────────────────

import { registerSidePanel, registerStatePersistence, type SidePanelHandle, type Vela, type WidgetContext } from '@luxalgo/vela'
import { registerIcon, svg16 } from '@luxalgo/vela/ui'
import { CBSCRIPT, setLevelsLoader } from './engine'
import { libIdOf, loadLibrary } from './library'
import { wallSeriesFor } from '../wallsIndicator'
import { ALERTS_PANEL_ID, SCRIPTS_PANEL_ID, TESTER_PANEL_ID } from './ids'

const PERSIST_KEY = 'cbedge.scripts'

type Mount = (ctx: WidgetContext, body: HTMLElement) => SidePanelHandle | void

/**
 * A side panel whose code loads the first time it is SHOWN. Vela mounts every
 * panel when the shell builds, open or not, so the import waits for `onOpen` —
 * or for the body to become visible, which also covers a panel the saved
 * layout restores open (that path may not raise onOpen). Chart binds and opens
 * that arrive before the code are replayed onto the real panel.
 */
function lazyPanel(load: () => Promise<Mount>): (ctx: WidgetContext, body: HTMLElement) => SidePanelHandle {
  return (ctx, body) => {
    let real: SidePanelHandle | null = null
    let chart: Vela | null = null
    let opened = false
    let dead = false
    let started = false
    let io: IntersectionObserver | null = null
    const start = () => {
      if (started || dead) return
      started = true
      io?.disconnect()
      io = null
      const note = body.ownerDocument.createElement('div')
      note.className = 'cb-scr-note'
      note.textContent = 'Loading…'
      body.append(note)
      load()
        .then((mount) => {
          if (dead) return
          note.remove()
          real = mount(ctx, body) || null
          if (chart) real?.onChart?.(chart)
          if (opened) real?.onOpen?.()
        })
        .catch(() => {
          started = false
          note.textContent = 'This panel could not load. Close it and open it again to retry.'
        })
    }
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          opened = true
          start()
        }
      })
      io.observe(body)
    }
    return {
      onChart(c) {
        chart = c
        real?.onChart?.(c)
      },
      onOpen() {
        opened = true
        if (real) real.onOpen?.()
        else start()
      },
      destroy() {
        dead = true
        io?.disconnect()
        real?.destroy?.()
      },
    }
  }
}

interface Persisted {
  id: string
  name: string
  script: string
  inputs?: Record<string, number | string | boolean>
  hidden?: boolean
}

let registered = false

export function registerScripts(): void {
  if (registered) return
  registered = true
  // a script that reads cbedge.call_wall / put_wall / core gets the walls recorder, bar by bar
  setLevelsLoader(wallSeriesFor)
  // </> — code
  registerIcon('cb-script', svg16('<path d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4M9 2.5 7 13.5"/>'))
  // a rising line with an arrow — a backtest
  registerIcon('cb-strategy', svg16('<path d="M2 13.5h12M2.5 11l3.5-3.5 2.5 2L13 5"/><path d="M10 5h3v3"/>'))
  // a bolt — a script's trigger (the bell beside it is Vela's own price alerts)
  registerIcon('cb-zap', svg16('<path d="M9.2 1.5 3.5 9h4.3l-1 5.5L12.5 7H8.2l1-5.5Z"/>'))

  const scripts = lazyPanel(() => import('./panel').then((m) => m.mountPanel))
  registerSidePanel({
    id: SCRIPTS_PANEL_ID,
    title: 'Scripts',
    icon: 'cb-script',
    width: 420,
    resizable: true,
    minWidth: 320,
    maxWidth: 760,
    mount: (ctx, body, header) => {
      header.setTitle('CB Script')
      return scripts(ctx, body)
    },
  })
  const tester = lazyPanel(() => import('./testerPanels').then((m) => m.mountTester))
  registerSidePanel({
    id: TESTER_PANEL_ID,
    title: 'Strategy Tester',
    icon: 'cb-strategy',
    order: 101,
    width: 440,
    resizable: true,
    minWidth: 320,
    maxWidth: 820,
    mount: (ctx, body, header) => {
      header.setTitle('Strategy Tester')
      return tester(ctx, body)
    },
  })
  const alerts = lazyPanel(() => import('./testerPanels').then((m) => m.mountAlerts))
  registerSidePanel({
    id: ALERTS_PANEL_ID,
    title: 'Script Alerts',
    icon: 'cb-zap',
    order: 102,
    width: 360,
    resizable: true,
    minWidth: 300,
    maxWidth: 640,
    mount: (ctx, body, header) => {
      header.setTitle('Script Alerts')
      return alerts(ctx, body)
    },
  })

  registerStatePersistence({
    key: PERSIST_KEY,
    scope: 'cell',
    serialize: (ctx) => {
      const out: Persisted[] = []
      for (const h of ctx.chart.indicators()) {
        if (!h.id.startsWith('cbs-') || !h.source) continue
        out.push({ id: h.id, name: h.title, script: h.source, inputs: h.inputValues(), ...(h.visible ? {} : { hidden: true }) })
      }
      return out.length ? out : undefined
    },
    restore: (payload, ctx) => {
      if (!Array.isArray(payload)) return
      const lib = new Map(loadLibrary().map((s) => [s.id, s]))
      const live = new Set(ctx.chart.indicators().map((h) => h.id))
      for (const raw of payload as unknown[]) {
        const p = raw as Partial<Persisted>
        if (!p || typeof p.id !== 'string' || !p.id.startsWith('cbs-') || typeof p.script !== 'string') continue
        if (live.has(p.id)) continue
        const saved = lib.get(libIdOf(p.id) ?? '')
        ctx.addIndicator({
          name: typeof p.name === 'string' ? p.name : saved?.name ?? 'Script',
          script: saved?.source ?? p.script,
          language: CBSCRIPT,
          id: p.id,
          ...(p.inputs && typeof p.inputs === 'object' ? { inputs: p.inputs } : {}),
          ...(p.hidden ? { hidden: true } : {}),
        })
      }
    },
  })
}
