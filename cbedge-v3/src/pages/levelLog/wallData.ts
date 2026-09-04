// ─────────────────────────────────────────────────────────────────────────────
// LEVEL LOG — the data layer under the wall-migration chart.
//
// Ported from v2's components/pages/LevelLog.tsx against the spec in
// docs/parity/level-log.md (Parts N, O, P). This module is the FIRST slice of
// that port: only what the migration chart reads. The ticker rail, the log
// card, the capture rail, the churn strip, the timeline and buildLogText are
// still to come — see the parity doc, which is the checklist.
//
// NOT api.ts's `query()`: the reads are `cache: 'no-store'` + a nonce. A 30s
// stale window would make the refresh button — and the one-minute live tick
// below — sometimes do nothing, which is worse than an extra request nobody
// asked for.
//
// NO WATERFALL (non-negotiable 3): for the single session the log and the tape
// are fired TOGETHER — the date is known at entry, so there is nothing to wait
// on. The week view keeps v2's two waves on purpose: the candidate logs decide
// WHICH days exist, and a bank holiday must not cost a 1-minute candle fetch.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'

/**
 * THE LIVE CADENCE — one minute, and only where a minute means something.
 *
 * The price line IS `/proxy/candles-intraday` at `interval=1m`, so a minute is
 * the granularity of the underlying data: polling faster asks the proxy for a
 * bar that does not exist yet (it caches ~60s anyway), and polling slower leaves
 * the spot line short of the clock on a page whose whole subject is where price
 * went while the levels held.
 *
 * Gated three ways by `useMinuteTick` and its caller, because v2's page has no
 * poll at all and the reason it gives — "so an open tab never hammers the
 * recorder" — is still right for every case except the live one: the session
 * has to BE today (a past date cannot change), the tab has to be visible, and
 * it is the single-session view only. The week view would cost up to thirteen
 * requests a minute to move one of five slices.
 */
export const LIVE_POLL_MS = 60_000

// ── The wire, as /proxy/walls serves it ──────────────────────────────────────

export type WallLevel = 'call_wall' | 'put_wall' | 'cb'

export type WallLogRow = {
  slot: number
  at: string
  ts: string
  level_type: WallLevel
  strike: number
  prev_strike: number | null
  delta: number | null
  spot: number
  reason: 'open' | 'change'
  level_gex: number | null
}

export type WallEventRow = {
  hit_slot: number
  at: string
  hit_ts: string
  level_type: WallLevel
  strike: number
  spot_at_hit: number
  kind: 'touch' | 'approach'
}

/** One sample of the real tape: ET minutes-since-midnight and the price. */
export type SpotSample = { mins: number; px: number }

/**
 * ONE DAY of the chart's input: the change-only level log, the classified
 * events, and the 1-minute tape if there was one. The chart takes an ARRAY of
 * these — one entry is the inline single-session chart, five entries is the
 * week view — so both are the same drawing code and cannot drift.
 */
export type DaySlice = {
  date: string
  log: WallLogRow[]
  events: WallEventRow[]
  price: SpotSample[]
}

// ── The view switch, and the two variant switches ────────────────────────────
/**
 * WALLS = call wall + put wall. CORE = the CORE (cb) level on its own. ALL =
 * the three of them in one log.
 *
 * ALL is not "no filter" by accident — CORE is frequently ALSO one of the walls
 * (whichever is carrying more gamma), so a tag scored on the call wall and the
 * CORE tag at the same strike are the same event told twice.
 */
export type LogView = 'walls' | 'core' | 'all'

export const VIEW_LEVELS: Record<LogView, WallLevel[]> = {
  walls: ['call_wall', 'put_wall'],
  core: ['cb'],
  all: ['call_wall', 'put_wall', 'cb'],
}

/** Short scope word for headers and captions. */
export const VIEW_SCOPE: Record<LogView, string> = { walls: 'wall', core: 'core', all: 'level' }

export const inView = (v: LogView, lt: WallLevel) => VIEW_LEVELS[v].includes(lt)

/**
 * WHICH CONTRACTS, and WHICH GEX. Both are recorded server-side four ways and
 * pulled through /proxy/walls?scope=&basis=, so switching either one is a
 * re-fetch of an already-recorded log — never a re-computation, and never an
 * interpolation of the variant you are not looking at.
 */
export type ExpScope = '0dte' | 'agg'
export type GexBasis = 'oivol' | 'vol'

/** Compact tag for headers and captions. */
export const variantTag = (scope: ExpScope, basis: GexBasis) =>
  `${scope === 'agg' ? 'non-0DTE' : '0DTE'} · ${basis === 'vol' ? 'vol-only GEX' : 'OI+vol GEX'}`

/** The query both variant switches contribute to every /proxy/walls read. */
const variantQuery = (scope: ExpScope, basis: GexBasis) => `&scope=${scope}&basis=${basis}`

// ── The slot grid ────────────────────────────────────────────────────────────

/** Slot 0 = 09:29 (the open baseline). Slots 1…26 = 09:45, 10:00 … 16:00. */
export const WALL_SLOTS = 27

/** ET minutes-since-midnight of the two anchors the slot grid is built on. */
const OPEN_SLOT_MINS = 9 * 60 + 29
const GRID_START_MINS = 9 * 60 + 45

/** Slot → wall-clock ET. Slot 0 is the 09:29 baseline, then every 15m to 16:00. */
export function slotClock(slot: number): string {
  if (slot <= 0) return '09:29'
  const m = GRID_START_MINS + (slot - 1) * 15
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/**
 * ET minutes → FRACTIONAL slot. The inverse of the recorder's slotMins(), so a
 * 1-minute price sample lands on the same x as the 15-minute level step it
 * happened under. Slot 0 sits 16 minutes before slot 1, not 15, because the
 * open capture is at 09:29 — that first gap is its own scale.
 */
export function slotAtMins(m: number): number {
  if (m <= OPEN_SLOT_MINS) return 0
  if (m <= GRID_START_MINS) return (m - OPEN_SLOT_MINS) / (GRID_START_MINS - OPEN_SLOT_MINS)
  return 1 + (m - GRID_START_MINS) / 15
}

/** Minutes east of UTC for New York at that instant (handles EST/EDT). */
function etOffsetMinutes(d: Date): number {
  const s = d.toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })
  const m = s.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/)
  if (!m) return -300
  const hh = m[1]
  if (!hh) return -300
  const h = parseInt(hh, 10)
  if (!Number.isFinite(h)) return -300
  const mmRaw = m[2]
  const mm = mmRaw ? parseInt(mmRaw, 10) : 0
  return h * 60 + (h < 0 ? -mm : mm)
}

/** Epoch ms for HH:MM ET on a "YYYY-MM-DD" date. */
function etMsOn(date: string, hh: number, mm: number): number {
  const naive = Date.parse(
    `${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`,
  )
  if (!Number.isFinite(naive)) return NaN
  return naive - etOffsetMinutes(new Date(naive)) * 60_000
}

/** Today's ET date as "YYYY-MM-DD". */
export function todayETStr(): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${g('year')}-${g('month')}-${g('day')}`
}

// ── Formatters (parity Part N) ───────────────────────────────────────────────

/** Exactly 2 dp, comma-grouped. "—" when there is no number. */
export const wallNum = (n: number | null | undefined, dp = 2) =>
  n == null || !Number.isFinite(Number(n))
    ? '—'
    : Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })

/** Strikes print without forced decimals — 6890, not 6890.00. */
export const wallStrike = (n: number | null | undefined) =>
  n == null || !Number.isFinite(Number(n))
    ? '—'
    : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })

/**
 * "MONDAY" from "2026-08-24". Parsed at NOON UTC and read back in UTC, so the
 * name never slips a day on a browser west of Greenwich — the date string is a
 * calendar date, not an instant, and midnight-parsing it is how "Monday" turns
 * into "Sunday" for anyone in America.
 */
export function dowName(date: string): string {
  const t = Date.parse(`${date}T12:00:00Z`)
  if (!Number.isFinite(t)) return ''
  return new Date(t).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }).toUpperCase()
}

/** "8/21" from "2026-08-21" — the axis stamp under the weekday, no zero pad. */
export function mdShort(date: string): string {
  const [, mm, dd] = date.split('-')
  return mm && dd ? `${Number(mm)}/${Number(dd)}` : date
}

/**
 * The last `n` weekday dates on or before `end`, newest last.
 *
 * Weekends only — market holidays are not enumerated here on purpose. A holiday
 * simply has no rows, and the fetch below drops empty days, which handles a
 * half-day, an unscheduled close and a ticker that was not in the scanner
 * universe yet with the same rule and no calendar to keep in sync.
 */
function lastWeekdays(end: string, n: number): string[] {
  const out: string[] = []
  const t = Date.parse(`${end}T12:00:00Z`)
  if (!Number.isFinite(t)) return out
  for (let k = 0; out.length < n && k < n * 3 + 10; k++) {
    const d = new Date(t - k * 86_400_000)
    const dow = d.getUTCDay()
    if (dow === 0 || dow === 6) continue
    out.push(d.toISOString().slice(0, 10))
  }
  return out.reverse()
}

// ── The two reads ────────────────────────────────────────────────────────────

type RawDay = { date: string; log: WallLogRow[]; events: WallEventRow[] }

/** One day's change-only level log. Resolves null for a day with no rows. */
async function fetchLog(
  symbol: string,
  date: string,
  scope: ExpScope,
  basis: GexBasis,
): Promise<RawDay | null> {
  try {
    const r = await fetch(
      `/proxy/walls?date=${encodeURIComponent(date)}&symbol=${encodeURIComponent(symbol)}${variantQuery(scope, basis)}`,
      { cache: 'no-store', credentials: 'same-origin' },
    )
    const j = await r.json()
    if (!j?.ok) return null
    const log: WallLogRow[] = Array.isArray(j.log) ? j.log : []
    const events: WallEventRow[] = Array.isArray(j.events) ? j.events : []
    return log.length || events.length ? { date, log, events } : null
  } catch {
    return null
  }
}

/**
 * THE PRICE LINE — the real tape, not the log's own spot column.
 *
 * walls_log is CHANGE-ONLY: a row exists when a level sets or rolls, and spot
 * rides along on it. So the log's spot is a dozen-odd points a day, which drawn
 * as a line reads as price moving in half-hour steps — and the chart's whole
 * job is comparing a level that HOLDS against price that TRAVELS.
 *
 * Best-effort by design: an index dxLink will not serve 1m bars for, a date
 * outside dxFeed's ~7-day 1m window, or a dead request all resolve to [], and
 * the chart falls back to the recorded captures and says so in its caption.
 * Nothing is interpolated to cover a gap.
 *
 * EXPORTED for railStore.ts, which pairs it with each mini card's log exactly as
 * useWallDays does for the big one. One implementation on purpose: the ET window
 * this reads, the `mins` origin it emits and the best-effort empty return are all
 * things the two surfaces have to agree on, and the version that drifts is the
 * one nobody is looking at.
 */
export async function fetchTape(symbol: string, date: string): Promise<SpotSample[]> {
  const from = etMsOn(date, 9, 30)
  const to = etMsOn(date, 16, 0)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return []
  try {
    const r = await fetch(
      `/proxy/candles-intraday?symbol=${encodeURIComponent(symbol)}&interval=1m&fromMs=${Math.round(from)}`,
      { cache: 'no-store', credentials: 'same-origin' },
    )
    const j = await r.json()
    const cs: unknown[] = Array.isArray(j?.candles) ? j.candles : []
    const out: SpotSample[] = []
    for (const c of cs) {
      const row = c as { time?: unknown; close?: unknown }
      const t = Number(row?.time)
      const px = Number(row?.close)
      if (!Number.isFinite(t) || !(px > 0)) continue
      if (t < from || t > to) continue
      // No DST change lands inside a session, so minutes off the open is exact.
      out.push({ mins: 570 + (t - from) / 60_000, px })
    }
    out.sort((a, b) => a.mins - b.mins)
    return out
  } catch {
    return []
  }
}

/**
 * A counter that steps once a minute while `enabled` AND the tab is visible.
 * Feed it into `useWallDays`'s `nonce` to make the page live.
 *
 * Coming BACK to a hidden tab steps it immediately rather than waiting out the
 * remainder of an interval — the first thing someone does on returning is read
 * the number, and a stale one for up to a minute is the whole failure this is
 * meant to fix. Browsers throttle hidden-tab timers anyway, so leaving the
 * interval running would not be a substitute.
 */
export function useMinuteTick(enabled: boolean): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return
    let id: number | undefined
    const stop = () => {
      if (id !== undefined) {
        window.clearInterval(id)
        id = undefined
      }
    }
    const start = () => {
      if (id === undefined) id = window.setInterval(() => setTick((n) => n + 1), LIVE_POLL_MS)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        setTick((n) => n + 1)
        start()
      } else {
        stop()
      }
    }
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled])
  return tick
}

export type WallDays = { days: DaySlice[]; loading: boolean }

const NO_DAYS: WallDays = { days: [], loading: false }

/**
 * THE SESSIONS THE CHART DRAWS.
 *
 * `count === 1` is the inline card: one known date, so the log and the tape go
 * out together and there is no waterfall to hoist.
 *
 * `count > 1` is the week view, and it keeps v2's two waves. The level logs are
 * small and cheap, so it asks for MORE candidate weekdays than it needs
 * (holidays, days before the ticker entered the scanner universe) and keeps the
 * newest `count` that came back with rows. Only THOSE days then get a tape
 * request. The levels are set on screen before the tapes land, because the tape
 * only sharpens the price line — a spinner there would hide a chart that is
 * already readable.
 */
export function useWallDays(
  symbol: string | null,
  endDate: string,
  count: number,
  nonce: number,
  scope: ExpScope,
  basis: GexBasis,
): WallDays {
  const [state, setState] = useState<WallDays>(NO_DAYS)

  useEffect(() => {
    if (!symbol || count < 1) {
      setState(NO_DAYS)
      return
    }
    let alive = true
    setState((prev) => ({ days: prev.days, loading: true }))
    ;(async () => {
      if (count === 1) {
        const [day, tape] = await Promise.all([
          fetchLog(symbol, endDate, scope, basis),
          fetchTape(symbol, endDate),
        ])
        if (!alive) return
        setState({ days: day ? [{ ...day, price: tape }] : [], loading: false })
        return
      }

      const candidates = lastWeekdays(endDate, count + 3)
      const logs = await Promise.all(candidates.map((d) => fetchLog(symbol, d, scope, basis)))
      const kept = logs.filter((d): d is RawDay => d != null).slice(-count)
      if (!alive) return
      if (!kept.length) {
        setState(NO_DAYS)
        return
      }
      setState({ days: kept.map((k) => ({ ...k, price: [] })), loading: true })

      const tapes = await Promise.all(kept.map((k) => fetchTape(symbol, k.date)))
      if (!alive) return
      setState({ days: kept.map((k, i) => ({ ...k, price: tapes[i] ?? [] })), loading: false })
    })()
    return () => {
      alive = false
    }
  }, [symbol, endDate, count, nonce, scope, basis])

  return state
}
