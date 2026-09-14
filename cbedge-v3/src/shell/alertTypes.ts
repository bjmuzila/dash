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
// NO DATA YET (2026-09-14). Nothing in this file talks to a server; `SAMPLE` in
// AlertsPanel.tsx is placeholder copy so the UI can be seen. When the feed is
// wired, the ids below are what the endpoint should key on.
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
  },
  {
    id: 'gexA',
    short: 'GEX A',
    name: 'GEX A — cross / reclaim',
    hint: 'touch, cross up, cross down on the A level',
    tag: 'GEX A',
    color: LEVEL_COLORS.cw,
    group: 'primary',
  },
  {
    id: 'gexB',
    short: 'GEX B',
    name: 'GEX B — cross / reject',
    hint: 'touch, rejection, break on the B level',
    tag: 'GEX B',
    color: LEVEL_COLORS.pw,
    group: 'primary',
  },
  {
    id: 'ibFormed',
    short: 'IB',
    name: 'Initial Balance Formed',
    hint: 'info only, 10:30 ET',
    tag: 'IB',
    color: LIGHT_BLUE,
    group: 'primary',
  },
  {
    id: 'ibBreak',
    short: 'IB Brk',
    name: 'Initial Balance Break',
    hint: 'extension above or below the IB',
    tag: 'IB BRK',
    color: T.orange,
    group: 'primary',
  },
  {
    id: 'whale',
    short: 'Whales',
    name: 'Whale Option Prints',
    hint: 'large premium, swept',
    tag: 'WHALE',
    color: LEVEL_COLORS.cb,
    group: 'primary',
  },
  {
    id: 'divergence',
    short: 'Div',
    name: 'Flow / GEX Divergence',
    hint: 'premium and net GEX pulling apart',
    tag: 'DIV',
    color: T.purple,
    group: 'primary',
  },
  {
    id: 'bzila',
    short: 'Bzila',
    name: 'Bzila Confluence — MASTER',
    hint: 'all setups below',
    tag: 'BZILA',
    color: T.green,
    group: 'bzila',
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
