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
// WHETHER A KIND FIRES IS NOT DECIDED HERE. `serverKey` below is the row's key
// in the signals engine's ALERT_CATALOG (server-v2/signals-engine.js), flipped
// from owner.cbedge.net → Admin → Signal Alerts and read by the dashboard from
// GET /proxy/signal-alerts. That switch is owner-only at the server, so the
// toolbar has no switches of its own — only the filter chips, which hide a type
// from the list in THIS browser (`alerts:shown`) and change nothing else.
//
// The feed ROWS are still placeholder (`SAMPLE` in AlertsPanel.tsx); only the
// master state is live. Wiring the feed means replacing `useAlertsFeed`.
// ─────────────────────────────────────────────────────────────────────────────

export type AlertKind =
  | 'flip'
  | 'coreChange'
  | 'coreTouch'
  | 'ibFormed'
  | 'ibBreak'
  | 'whale'
  | 'gexChangeTop'

export interface AlertType {
  id: AlertKind
  /**
   * The chip label. Kept TIGHT on purpose — all eight chips plus "All" have to
   * sit on one row of a 28rem panel without the last one being clipped, so this
   * is the field to shorten if a ninth type is ever added.
   */
  short: string
  /** The settings row's name. */
  name: string
  /** One line under the name in settings. */
  hint: string
  /** The tag drawn beside a feed row. */
  tag: string
  /** A token reference from design/theme.ts. Never a literal. */
  color: string
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
    serverKey: 'flip_cross',
  },
  // ── THE CORE LEVEL ─────────────────────────────────────────────────────────
  // The CB / MVC scored SPX strike. Two rows because they are two different
  // events — the level MOVED, and price is AT it — and a trader wants one
  // without necessarily wanting the other. Both share the core's own gold so
  // the pair reads as one subject in the feed; the tag separates them.
  {
    id: 'coreChange',
    short: 'Core ±',
    name: 'Core level change',
    hint: 'the scored SPX strike moved',
    tag: 'CORE ±',
    color: T.cyan,
    serverKey: 'core_change',
  },
  {
    id: 'coreTouch',
    short: 'Core',
    name: 'Core level touch',
    hint: 'price reached the core — one alert per visit',
    tag: 'CORE',
    color: LEVEL_COLORS.cb,
    serverKey: 'core_touch',
  },
  {
    id: 'ibFormed',
    short: 'IB',
    name: 'Initial Balance Formed',
    hint: 'info only, 10:30 ET',
    tag: 'IB',
    color: LIGHT_BLUE,
    serverKey: 'ib_formed',
  },
  {
    id: 'ibBreak',
    short: 'IB Brk',
    name: 'Initial Balance Break',
    hint: 'extension above or below the IB',
    tag: 'IB BRK',
    color: T.orange,
    serverKey: 'ib_break',
  },
  {
    id: 'whale',
    short: 'Whale',
    name: 'Whale Option Prints',
    // The /v3/whales page is not just the definition, it is the SOURCE: the
    // engine reads that page's own endpoint with these filters in the query
    // string, so an alert can always be found on that page.
    hint: '≥ $1M premium, OTM, under 90 DTE',
    tag: 'WHALE',
    color: LEVEL_COLORS.pw,
    serverKey: 'whale_print',
  },
  {
    id: 'gexChangeTop',
    short: 'GEX',
    name: 'Top GEX Change',
    hint: "every pick the scanner's Top GEX Change board files",
    tag: 'GEX CHG',
    color: T.green,
    serverKey: 'gex_change_top',
  },
]

export const TYPE_BY_ID: Record<AlertKind, AlertType> = Object.fromEntries(
  ALERT_TYPES.map((t) => [t.id, t]),
) as Record<AlertKind, AlertType>

/** One alert as the feed draws it. */
export interface AlertItem {
  id: number
  kind: AlertKind
  /**
   * THE SYMBOL, AND IT LEADS. "QQQ", "SPY", or "SPX" for the index detectors
   * (flip, core, IB), which do not carry an underlying of their own because
   * they are all about the same one. First thing in the row and first thing in
   * the pill: scanning a feed is asking "what is this about", and the answer is
   * always a ticker.
   */
  ticker: string
  /**
   * The row's TITLE — the biggest text in the row, and the only line drawn in
   * the type's colour. The ticker is NOT in it: `toItem` strips the symbol out
   * so "QQQ · Put buy — 690P $1.0M" never reads "QQQ · Whale put buy — QQQ
   * 690P". Neither is the type's tag — every detector's `setup` already names
   * itself, and "WHALE · WHALE PUT BUY" was the same word twice.
   */
  title: string
  /** The sentence under the title — the detector's own `reason`. */
  text: string
  /**
   * The PILL's headline — ticker first, then the title. Short enough for a
   * toolbar: "SPY Put buy — 747P $5.9M". The panel never shows it and the pill
   * never shows `text` — a toolbar that has to truncate a sentence is a toolbar
   * that is too long.
   */
  short: string
  /** The small monospaced line under it. Optional. */
  meta?: string
  /**
   * WHICH WAY THE PRINT LEANS — 'bullish' for a call buy, 'bearish' for a put
   * buy, and undefined for every detector that has no side to take (the flip,
   * the core, the IB). Read off the engine's own `direction` column rather than
   * re-derived from the sentence, so the arrow can never disagree with the row.
   * The feed draws it as a coloured arrow in front of the ticker.
   */
  bias?: 'bullish' | 'bearish'
  /** ISO-ish clock string for now; a timestamp once this is wired. */
  at: string
}

// ── Per-browser state ───────────────────────────────────────────────────────
// One key: which types the chips are SHOWING. There is no "armed" set any more
// — arming is the owner's switchboard, not a browser preference. (`alerts:armed`
// may still be sitting in older browsers; it is simply never read.)

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
