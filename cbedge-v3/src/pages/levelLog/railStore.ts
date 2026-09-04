// ─────────────────────────────────────────────────────────────────────────────
// LEVEL LOG — THE TICKER CARD RAIL: which cards, and where the list is kept.
//
// v2's Part E was a TABLE — six columns, one row per ticker in the whole
// scanner universe, 620px of scroller. This is the same information as a strip
// of small cards above the log, for the reason the parity doc's E14 records
// about the table: it had no hover affordance and no sort UI, so the only thing
// anyone ever did with those hundred-odd rows was find their four or five
// symbols and click one. A rail you CHOOSE is that act, done once.
//
// THREE ARE PINNED. SPX, SPY and QQQ are the board's reference set — the index,
// its ETF and the tech proxy — and every level on this page is read relative to
// them, so they carry no × and `normalizeRail` puts them back at the front of
// any list that arrives without them. Everything else is the user's.
//
// WHERE THE LIST LIVES — two tiers, and they are not the same tier:
//   · PER BROWSER, for everyone: localStorage. It is a view preference, it is
//     tiny, and it must survive a reload without a round trip or a session.
//   · PER ACCOUNT, for the OWNER: /api/level-log-tickers, Postgres behind it.
//     The owner reads this page off three machines; a rail that only exists in
//     one browser profile is a rail he rebuilds twice.
//
// localStorage is written on EVERY edit regardless, so the server copy is a
// mirror, never the source of truth for a page that has already painted: the
// rail is on screen from the first frame with the local list, and the server's
// answer only replaces it if a row actually exists (`stored: true`). A 401, a
// dead DB or a signed-out session all leave the local rail exactly as it was.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'
import { useIsOwner } from '@/data/auth'
import type { ExpScope, GexBasis, WallLevel } from '@/pages/levelLog/wallData'

/** Always on the rail, never removable. Order is deliberate: index, ETF, tech. */
export const RAIL_PINNED: readonly string[] = ['SPX', 'SPY', 'QQQ']

/**
 * The rail a browser that has never been here gets. The three pinned, then the
 * mega-caps the recorder sweeps every slot anyway — so a first visit shows a
 * full rail of real numbers rather than nine empty cards inviting a search.
 */
export const RAIL_DEFAULT: readonly string[] = [
  'SPX',
  'SPY',
  'QQQ',
  'AAPL',
  'AMZN',
  'GOOGL',
  'META',
  'MSFT',
  'NVDA',
  'TSLA',
]

/**
 * Ceiling on the rail. Not a storage limit — it is the point past which a
 * horizontal strip stops being scannable and becomes a second table, which is
 * the thing this replaced.
 */
export const RAIL_MAX = 24

const RAIL_KEY = 'cb-v3-level-log-rail'

/** Same shape the app toolbar accepts — letters, optionally dotted (BRK.B). */
export const RAIL_TICKER_RE = /^[A-Z][A-Z.]{0,5}$/

export const isRailPinned = (sym: string): boolean =>
  RAIL_PINNED.includes(String(sym ?? '').toUpperCase())

/**
 * Anything that arrives from storage, the server or a hand-typed symbol, turned
 * into the rail's own invariant: the three pinned first, then distinct valid
 * symbols in the order given, capped.
 *
 * Deliberately total — it never throws and never returns an empty list, so a
 * corrupted localStorage value degrades to "the three pinned" rather than to a
 * page that will not render.
 */
export function normalizeRail(list: unknown): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of RAIL_PINNED) {
    seen.add(p)
    out.push(p)
  }
  if (Array.isArray(list)) {
    for (const raw of list) {
      const s = String(raw ?? '')
        .trim()
        .toUpperCase()
      if (!RAIL_TICKER_RE.test(s) || seen.has(s)) continue
      seen.add(s)
      out.push(s)
      if (out.length >= RAIL_MAX) break
    }
  }
  return out
}

function readLocalRail(): string[] {
  if (typeof window === 'undefined') return normalizeRail(RAIL_DEFAULT)
  try {
    const raw = window.localStorage.getItem(RAIL_KEY)
    // No key at all is a first visit — the defaults. An EMPTY stored list is a
    // deliberate act (everything but the pinned removed) and is honoured.
    if (raw == null) return normalizeRail(RAIL_DEFAULT)
    return normalizeRail(JSON.parse(raw))
  } catch {
    return normalizeRail(RAIL_DEFAULT)
  }
}

function writeLocalRail(list: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RAIL_KEY, JSON.stringify(list))
  } catch {
    /* best-effort — the in-memory rail still drives this session */
  }
}

/** The owner's second copy. See the header note; nobody else calls it. */
const RAIL_ENDPOINT = '/api/level-log-tickers'

/**
 * Debounce on the save. Removing four cards is four clicks in about a second
 * and one row worth writing, not four.
 */
const SAVE_DEBOUNCE_MS = 400

export interface RailStore {
  tickers: string[]
  add: (sym: string) => void
  remove: (sym: string) => void
  reset: () => void
  /** true once the account copy has been read — or ruled out. Chrome only. */
  synced: boolean
}

export function useRailTickers(): RailStore {
  const { isOwner, loaded } = useIsOwner()
  const [tickers, setTickers] = useState<string[]>(readLocalRail)
  const [synced, setSynced] = useState(false)

  /**
   * The list as last PERSISTED, serialized. The save effect compares against
   * it, which is what stops the mount — and the adoption of the server's own
   * list — from writing straight back out. A ref rather than state because
   * changing it must not re-render.
   */
  const lastSaved = useRef<string>(JSON.stringify(tickers))

  // The account copy, owner only. Runs once /api/auth/me has answered, so a
  // signed-in owner never has this decided off `isOwner === false` while the
  // claim is still in flight.
  useEffect(() => {
    if (!loaded) return
    if (!isOwner) {
      setSynced(true)
      return
    }
    let alive = true
    fetch(RAIL_ENDPOINT, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { stored?: boolean; tickers?: unknown } | null) => {
        if (!alive) return
        if (d?.stored) {
          const server = normalizeRail(d.tickers)
          lastSaved.current = JSON.stringify(server)
          setTickers(server)
          writeLocalRail(server)
        }
        setSynced(true)
      })
      .catch(() => {
        // Offline, 401, no DB — the local rail is already on screen and stays.
        if (alive) setSynced(true)
      })
    return () => {
      alive = false
    }
  }, [isOwner, loaded])

  // Persist every genuine edit: localStorage always, the account copy for the
  // owner. Never fires for a list that is already what was last written.
  useEffect(() => {
    const json = JSON.stringify(tickers)
    if (json === lastSaved.current) return
    lastSaved.current = json
    writeLocalRail(tickers)
    if (!isOwner) return
    const id = window.setTimeout(() => {
      fetch(RAIL_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers }),
      }).catch(() => {
        /* the local copy is authoritative for this browser either way */
      })
    }, SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [tickers, isOwner])

  const add = useCallback((sym: string) => {
    const s = String(sym ?? '')
      .trim()
      .toUpperCase()
    if (!RAIL_TICKER_RE.test(s)) return
    setTickers((prev) => (prev.includes(s) || prev.length >= RAIL_MAX ? prev : [...prev, s]))
  }, [])

  const remove = useCallback((sym: string) => {
    const s = String(sym ?? '')
      .trim()
      .toUpperCase()
    if (isRailPinned(s)) return
    setTickers((prev) => (prev.includes(s) ? prev.filter((t) => t !== s) : prev))
  }, [])

  const reset = useCallback(() => setTickers(normalizeRail(RAIL_DEFAULT)), [])

  return { tickers, add, remove, reset, synced }
}

// ── The numbers on the cards ─────────────────────────────────────────────────

/**
 * One row of `/proxy/walls?date=…` — the DAY SUMMARY, one entry per ticker the
 * recorder wrote today. `open` is the 09:29 baseline per level, which is what
 * makes the session delta a subtraction rather than a second request.
 */
export interface WallTickerRow {
  symbol: string
  spot: number | null
  call_wall: number | null
  put_wall: number | null
  cb: number | null
  open: Partial<Record<WallLevel, number>>
  changes: number
  hits: number
}

export interface WallUniverse {
  /** Keyed by symbol — the rail looks up ten of a few hundred. */
  rows: Map<string, WallTickerRow>
  loading: boolean
  /** true once a response has landed, so "no row" reads apart from "not yet". */
  loaded: boolean
}

const NO_UNIVERSE: WallUniverse = { rows: new Map(), loading: false, loaded: false }

function toRow(raw: unknown): WallTickerRow | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const symbol = String(r.symbol ?? '')
    .trim()
    .toUpperCase()
  if (!symbol) return null
  const num = (v: unknown): number | null => {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const openRaw = (r.open ?? {}) as Record<string, unknown>
  const open: Partial<Record<WallLevel, number>> = {}
  for (const lt of ['call_wall', 'put_wall', 'cb'] as WallLevel[]) {
    const n = num(openRaw[lt])
    if (n != null) open[lt] = n
  }
  return {
    symbol,
    spot: num(r.spot),
    call_wall: num(r.call_wall),
    put_wall: num(r.put_wall),
    cb: num(r.cb),
    open,
    changes: Number(r.changes) || 0,
    hits: Number(r.hits) || 0,
  }
}

/**
 * THE DAY SUMMARY, once per (date, variant). One request feeds every card on
 * the rail — the alternative, a read per card, is ten requests for a strip that
 * is one row of one endpoint.
 *
 * Same `no-store` + nonce contract as `useWallDays`, and fired from the same
 * render, so the rail and the chart go out together rather than in sequence
 * (non-negotiable 3).
 */
export function useWallUniverse(
  date: string,
  nonce: number,
  scope: ExpScope,
  basis: GexBasis,
): WallUniverse {
  const [state, setState] = useState<WallUniverse>(NO_UNIVERSE)

  useEffect(() => {
    if (!date) {
      setState(NO_UNIVERSE)
      return
    }
    let alive = true
    setState((prev) => ({ rows: prev.rows, loading: true, loaded: prev.loaded }))
    ;(async () => {
      try {
        const r = await fetch(
          `/proxy/walls?date=${encodeURIComponent(date)}&scope=${scope}&basis=${basis}`,
          { cache: 'no-store', credentials: 'same-origin' },
        )
        const j = await r.json()
        if (!alive) return
        const rows = new Map<string, WallTickerRow>()
        if (j?.ok && Array.isArray(j.tickers)) {
          for (const raw of j.tickers) {
            const row = toRow(raw)
            if (row) rows.set(row.symbol, row)
          }
        }
        setState({ rows, loading: false, loaded: true })
      } catch {
        // A dead read leaves the cards on their dashes, same as a quiet
        // session. The chart under them says what actually failed.
        if (alive) setState({ rows: new Map(), loading: false, loaded: true })
      }
    })()
    return () => {
      alive = false
    }
  }, [date, nonce, scope, basis])

  return state
}
