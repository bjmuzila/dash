// ─────────────────────────────────────────────────────────────────────────────
// THE WORKSPACE MENU: the right side of the desktop top bar (Brandon,
// 2026-10-04, the Vela top-bar cleanup; mockup generated/2026-10-04-vela-topbar-r2.html).
//
// Twelve same-weight icons became three: Vela's alerts bell, this menu and the
// camera. Everything else the bar carried is a named row in here, in four
// groups, with an Alt shortcut on the ones used most:
//
//   PANELS   Watchlist  Alt+W · Data window  Alt+D · Object tree  Alt+O
//            Session stats strip (a switch)
//   SCRIPTS  Script editor  Alt+E · Strategy Tester  Alt+B
//   ALERTS   Level alerts  Alt+A · Script alerts
//   LAYOUT   Setups · Copy indicators to all charts · Center today on all charts
//            Alt+C · Chart settings
//
// Copy indicators makes every chart an exact copy of the one you are on
// (copyIndicators.ts); Center today frames every chart on its newest session,
// today's bars in the middle (centerToday.ts).
//
// Chart settings came here from the bottom strip's ⚙ when the strip went
// (2026-10-04, sessionClock.ts): it opens the ACTIVE chart's settings dialog.
//
// How the bar loses the rest: Vela's `topbar` composition (Vela.tsx,
// DESKTOP_TOPBAR) lists the right side as the session clock, alerts, this
// action, screenshot. The panel group and the right-hand `actions` flow are not
// listed, so Vela never renders them. The panels and the actions behind Setups / Session stats / Copy
// indicators are untouched: they open from here, from their context-menu rows,
// and from ⋮ on a phone (the phone keeps Vela's default composition).
//
// Why Setups and Copy indicators sit HERE and not in the ⊞ Layout menu: Layout
// is one of Vela's "composite" slots (as are the bell and the symbol button),
// and its API refuses an override, so nothing can be added to it.
//
// Why Alt: any plain letter on the chart opens the ticker search
// (symbolPicker.ts), and Alt+H / L / P / R / T / V are Vela's own drawing keys.
// The shortcuts go on the workspace keymap, so Vela's ? help lists them and
// they fire only while the chart has focus (never inside a field or a dialog).
//
// The page chunk carries only this registration and the keys; the menu itself
// (workspaceMenuView.ts) loads on the first open.
// ─────────────────────────────────────────────────────────────────────────────

import { registerWidgetAction, type WidgetContext } from '@luxalgo/vela'
import { registerIcon, svg16 } from '@luxalgo/vela/ui'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { centerTodayAll } from '@/pages/vela/centerToday'
import { copyToAll } from '@/pages/vela/copyIndicators'
import { LEVELS_PANEL_ID } from '@/pages/vela/levels/levelAlertsEntry'
import { onPhoneRoute } from '@/pages/vela/nav'
import { ALERTS_PANEL_ID, TESTER_PANEL_ID } from '@/pages/vela/script/testerPanels'
import { setStripShown, stripShown } from '@/pages/vela/setups/setups'
import { WATCHLIST_PANEL_ID } from '@/pages/vela/watchlist/panel'

export const WORKSPACE_ACTION_ID = 'cb-workspace'
/** The Scripts editor panel (script/panel.ts keeps its id private; testerPanels.ts names it the same way). */
const SCRIPTS_PANEL_ID = 'cbedge-scripts'

export type WsItem =
  | { kind: 'panel'; id: string; label: string; icon: string; panel: string; keys?: string }
  | { kind: 'strip'; id: string; label: string; icon: string }
  | { kind: 'setups'; id: string; label: string; icon: string }
  | { kind: 'copy'; id: string; label: string; icon: string }
  | { kind: 'center'; id: string; label: string; icon: string; keys?: string }
  | { kind: 'settings'; id: string; label: string; icon: string }

export interface WsGroup {
  title: string
  items: WsItem[]
}

/** The menu, in display order (a 2 × 2 grid of groups). Icons are the ones the old buttons wore. */
export const WS_GROUPS: readonly WsGroup[] = [
  {
    title: 'Panels',
    items: [
      { kind: 'panel', id: 'watchlist', label: 'Watchlist', icon: 'cb-watchlist', panel: WATCHLIST_PANEL_ID, keys: 'alt+w' },
      { kind: 'panel', id: 'data-window', label: 'Data window', icon: 'datawindow', panel: 'dataWindow', keys: 'alt+d' },
      { kind: 'panel', id: 'object-tree', label: 'Object tree', icon: 'objects', panel: 'objects', keys: 'alt+o' },
      { kind: 'strip', id: 'session-stats', label: 'Session stats strip', icon: 'cb-stats' },
    ],
  },
  {
    title: 'Scripts',
    items: [
      { kind: 'panel', id: 'scripts', label: 'Script editor', icon: 'cb-script', panel: SCRIPTS_PANEL_ID, keys: 'alt+e' },
      { kind: 'panel', id: 'strategy-tester', label: 'Strategy Tester', icon: 'cb-strategy', panel: TESTER_PANEL_ID, keys: 'alt+b' },
    ],
  },
  {
    title: 'Alerts',
    items: [
      { kind: 'panel', id: 'level-alerts', label: 'Level alerts', icon: 'cb-level-bell', panel: LEVELS_PANEL_ID, keys: 'alt+a' },
      { kind: 'panel', id: 'script-alerts', label: 'Script alerts', icon: 'cb-zap', panel: ALERTS_PANEL_ID },
    ],
  },
  {
    title: 'Layout',
    items: [
      { kind: 'setups', id: 'setups', label: 'Setups', icon: 'cb-setups' },
      { kind: 'copy', id: 'copy-indicators', label: 'Copy indicators to all charts', icon: 'cb-copy-ind' },
      { kind: 'center', id: 'center-today', label: 'Center today on all charts', icon: 'cb-center', keys: 'alt+c' },
      { kind: 'settings', id: 'chart-settings', label: 'Chart settings…', icon: 'gear' },
    ],
  },
]

const keyId = (item: WsItem) => `cb.workspace.${item.id}`
/** A row's Alt shortcut, when it has one. */
const keysOf = (item: WsItem): string | undefined => (item.kind === 'panel' || item.kind === 'center' ? item.keys : undefined)

let current: VelaWorkspace | null = null
let registered = false

/** The docked panel that is open, if any (one read of the workspace state per menu draw). */
export function openPanelOf(ws: VelaWorkspace | null): string | undefined {
  return ws?.getState().panels?.open
}

/** Is this row's thing on right now? A panel: docked open. The strip: shown. */
export function itemOn(item: WsItem, openPanel: string | undefined): boolean {
  if (item.kind === 'strip') return stripShown(false)
  return item.kind === 'panel' && openPanel === item.panel
}

/** The shortcut as this platform writes it (`Alt+W`, `⌥W`), from Vela's keymap. */
export function keyLabel(item: WsItem, ws: VelaWorkspace | null): string | null {
  if (!keysOf(item) || !ws) return null
  return ws.keymap.bindings().find((b) => b.id === keyId(item))?.display[0] ?? null
}

/** Do what a row says. `anchor` is where Setups opens its own menu. */
export function runItem(item: WsItem, ctx: WidgetContext, anchor: HTMLElement | null): void {
  switch (item.kind) {
    case 'panel':
      ctx.togglePanel(item.panel)
      return
    case 'strip':
      setStripShown(!stripShown(false))
      return
    case 'setups':
      void import('./setups/setupsMenu').then((m) => m.openSetups(ctx, anchor))
      return
    case 'copy':
      copyToAll(ctx)
      return
    case 'center':
      centerTodayAll(ctx, current)
      return
    case 'settings':
      current?.active.chart.renderer.openSettings()
      return
  }
}

/** The Workspace button, for anchoring the menu under it. Null in the phone-width ⋮ menu. */
function anchorOf(ctx: WidgetContext): HTMLElement | null {
  for (const b of ctx.host.querySelectorAll<HTMLElement>('.vela-topbar-right button')) {
    if (b.textContent?.trim() === 'Workspace') return b
  }
  return null
}

export function registerWorkspaceMenu(): void {
  if (registered) return
  registered = true
  // four tiles
  // a candle between two brackets
  registerIcon('cb-center', svg16('<path d="M3.5 3H2v10h1.5M12.5 3H14v10h-1.5"/><rect x="6.5" y="5" width="3" height="6" rx=".5"/><path d="M8 3v2M8 11v2"/>'))
  registerIcon('cb-workspace', svg16('<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>'))
  registerWidgetAction({
    id: WORKSPACE_ACTION_ID,
    target: 'topbar',
    label: 'Workspace',
    icon: 'cb-workspace',
    mobile: 'menu',
    // The phone keeps Vela's default bar and its ⋮ rows, one per panel and action.
    when: () => !onPhoneRoute(),
    run: (ctx) => {
      const anchor = anchorOf(ctx)
      void import('./workspaceMenuView').then((m) => m.toggleWorkspaceMenu(ctx, current, anchor))
    },
  })
}

/** The desktop page's workspace: the menu reads its open panel, and the Alt keys go on its keymap. */
export function bindWorkspaceMenu(ws: VelaWorkspace): () => void {
  current = ws
  const offs: Array<() => void> = []
  for (const g of WS_GROUPS) {
    for (const item of g.items) {
      const keys = keysOf(item)
      if (!keys) continue
      offs.push(
        ws.keymap.register({
          id: keyId(item),
          keys,
          label: item.label,
          category: 'Workspace',
          run: () => runItem(item, ws.context(), null),
        }),
      )
    }
  }
  return () => {
    for (const off of offs) off()
    if (current === ws) current = null
  }
}
