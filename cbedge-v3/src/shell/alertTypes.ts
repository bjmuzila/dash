import { LEVEL_COLORS, LIGHT_BLUE, T, VIOLET } from '@/design/theme'

// ─────────────────────────────────────────────────────────────────────────────
// THE SIGNAL CATALOGUE — one row per alert type, shared by the toolbar pill,
// the feed and the settings tab.
//
// This is the SAME set the background signals engine → Discord switchboard
// arms, plus GEX A and GEX B, so a trader who turned something off on the
// owner console recognises the row here by name.
//
// COLOUR IS THE CATALOGUE'S JOB, and it is borrowed rather than invented:
// GEX A takes the call-wall blue and GEX B the put-wall red, so an alert in the
// feed is the same colour as the line on the chart that fired it. Everything
// here is a token via design/theme.ts — no literal, and re-theming still means
// editing tokens.css.
//
// TWO LAYERS OF ON/OFF, and they are not the same question:
//
//   MASTER   `serverKey` below is the row's key in the signals engine's
//            ALERT_CATALOG (server-v2/signals-engine.js), flipped from
//            owner.cbedge.net → Admin → Signal Alerts and served by
//            GET /proxy/signal-alerts. Off there and the kind never fires for
//            anyone — the toolbar draws its row locked and says so.
//   LOCAL    the switches in the toolbar's Settings tab, saved in THIS browser
//            (`alerts:armed`). A customer silencing whale prints for an
//            afternoon is a preference, not a change to what the engine runs.
//
// The feed ROWS are still placeholder (`SAMPLE` in AlertsPanel.tsx); only the
// switchboard is live. Wiring the feed means replacing `useAlertsFeed`.
// ─────────────────────────────────────────────────────────────────────────────

export type AlertKind =
  | 'flip'
  | 'gexA'
  | 'gexB'
  | 'ibFormed'
  | 'ibBreak'
  | 'whale'
  | 'divergence'
  | 'bzila'

export interface AlertType {
  id: AlertKind
  /** The chip label — short enough for the filter row. */
  short: string
  /** The settings row's name. */
  name: string
  /** One line under the name in settings. */
  hint: string
  /** The tag drawn beside a feed row. */
  tag: string
  /** A token reference from design/theme.ts. Never a literal. */
  color: string
  /** Which band it sits under in settings. */
  group: 'primary' | 'bzila'
  /** The key this type has in the engine's ALERT_CATALOG — the master switch. */
  serverKey: string
}

export const ALERT_TYPES: AlertType[] = [
  {
    id: 'flip',
    short: 'Flip',
    name: 'GEX Flip Cross',
    hint: 'price crosses the gamma flip',
    tag: 'FLIP',
    color: VIOLET,
    group: 'primary',
    serverKey: 'flip_cross',
  },
  {
    id: 'gexA',
    short: 'GEX A',
    name: 'GEX A — cross / reclaim',
    hint: 'touch, cross up, cross down on the A level',
    tag: 'GEX A',
    color: LEVEL_COLORS.cw,
    group: 'primary',
    serverKey: 'gex_a',
  },
  {
    id: 'gexB',
    short: 'GEX B',
    name: 'GEX B — cross / reject',
    hint: 'touch, rejection, break on the B level',
    tag: 'GEX B',
    color: LEVEL_COLORS.pw,
    group: 'primary',
    serverKey: 'gex_b',
  },
  {
    id: 'ibFormed',
    short: 'IB',
    name: 'Initial Balance Formed',
    hint: 'info only, 10:30 ET',
    tag: 'IB',
    color: LIGHT_BLUE,
    group: 'primary',
    serverKey: 'ib_formed',
  },
  {
    id: 'ibBreak',
    short: 'IB Brk',
    name: 'Initial Balance Break',
    hint: 'extension above or below the IB',
    tag: 'IB BRK',
    color: T.orange,
    group: 'primary',
    serverKey: 'ib_break',
  },
  {
    id: 'whale',
    short: 'Whales',
    name: 'Whale Option Prints',
    hint: 'large premium, swept',
    tag: 'WHALE',
    color: LEVEL_COLORS.cb,
    group: 'primary',
    serverKey: 'whale_print',
  },
  {
    id: 'divergence',
    short: 'Div',
    name: 'Flow / GEX Divergence',
    hint: 'premium and net GEX pulling apart',
    tag: 'DIV',
    color: T.purple,
    group: 'primary',
    serverKey: 'flow_divergence',
  },
  {
    id: 'bzila',
    short: 'Bzila',
    name: 'Bzila Confluence — MASTER',
    hint: 'all setups below',
    tag: 'BZILA',
    color: T.green,
    group: 'bzila',
    serverKey: 'bzila_confluence',
  },
]

export const TYPE_BY_ID: Record<AlertKind, AlertType> = Object.fromEntries(
  ALERT_TYPES.map((t) => [t.id, t]),
) as Record<AlertKind, AlertType>

/** One alert as the feed draws it. No server shape is implied yet. */
export interface AlertItem {
  id: number
  kind: AlertKind
  /** "Cross up", "Rejection" — the variant, appended to the type name. */
  variant?: string
  /** The one-line headline the pill and the row show. */
  text: string
  /** The small monospaced line under it. Optional. */
  meta?: string
  /** ISO-ish clock string for now; a timestamp once this is wired. */
  at: string
}

// ── Per-browser state ───────────────────────────────────────────────────────
// Which types are ARMED (the settings tab) and which are SHOWN (the filter
// chips) are two different questions and are stored separately: muting the feed
// for an afternoon should not disarm a signal you want back tomorrow.

const ARMED_KEY = 'alerts:armed'
const SHOWN_KEY = 'alerts:shown'

function readSet(key: string): AlertKind[] | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return null
    return v.filter((k): k is AlertKind => typeof k === 'string' && k in TYPE_BY_ID)
  } catch {
    return null
  }
}

function writeSet(key: string, ids: AlertKind[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(ids))
  } catch {
    /* private mode — the choice just does not survive the session */
  }
}

const ALL_IDS = ALERT_TYPES.map((t) => t.id)

export const readArmed = (): AlertKind[] => readSet(ARMED_KEY) ?? ALL_IDS
export const writeArmed = (ids: AlertKind[]) => writeSet(ARMED_KEY, ids)
export const readShown = (): AlertKind[] => readSet(SHOWN_KEY) ?? ALL_IDS
export const writeShown = (ids: AlertKind[]) => writeSet(SHOWN_KEY, ids)

// ── The master switchboard ──────────────────────────────────────────────────
// GET /proxy/signal-alerts → { alerts: [{ key, label, group, enabled }] }.
// Readable by any paid account (proxy-auth gates the surface to subscribers and
// the owner); the matching POST is owner-only, which is why nothing in the
// dashboard ever writes to it. A kind missing from the response is treated as
// ARMED, so a server that has not learned about a new key yet does not silently
// hide its row.

export async function fetchMasterEnabled(): Promise<Record<string, boolean> | null> {
  try {
    const r = await fetch('/proxy/signal-alerts', { cache: 'no-store', credentials: 'same-origin' })
    if (!r.ok) return null
    const j = (await r.json()) as { alerts?: { key?: unknown; enabled?: unknown }[] }
    if (!Array.isArray(j?.alerts)) return null
    const out: Record<string, boolean> = {}
    for (const row of j.alerts) {
      if (typeof row?.key === 'string') out[row.key] = row.enabled !== false
    }
    return out
  } catch {
    // Offline, or a free account the gate refuses. Nothing is locked on a
    // failure to ask — see the `?? true` at every call site.
    return null
  }
}
