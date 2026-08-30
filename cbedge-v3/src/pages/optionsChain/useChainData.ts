// ─────────────────────────────────────────────────────────────────────────────
// THE CHAIN'S DATA LAYER.
//
// Everything v2's page did in ~40 hooks scattered through a 3,658-line component,
// gathered into one hook so the render layer below it is only render.
//
// Three things carried across deliberately, because each one is a bug someone
// already paid for:
//
//  1. THE COLUMNS ARE FETCHED IN PARALLEL AND PAINTED IN A SINGLE COMMIT. Not
//     column-by-column as each resolves — that was a visible domino fill — and
//     the OLD grid stays on screen until the new data is ready, so there is no
//     flash of empty cells either. This is also v3 non-negotiable #3.
//  2. THE OI SNAPSHOT IS TICKER-GATED. Its map keys are `expiry|strike` with no
//     symbol in them, so without the gate the previous ticker's ΔOI renders
//     under the new ticker's chain for a whole round trip, indistinguishable
//     from real data.
//  3. REPLAY SWAPS `columns` AT THE SOURCE. Everything downstream — the window,
//     the scales, the markers, the totals — is written against ExpColumn[] and
//     has no idea where the numbers came from, so rewinding costs no branch at
//     any of those call sites.
//
// This page opens NO WebSocket: it is REST + polling, exactly as v2 is. There is
// no frame to bind, which is why it reads data/api.ts and not data/hooks.ts.
//
// Spec: docs/parity/options-chain.md — Parts P and Q.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { query } from '@/data/api'
import {
  atMinIntensity,
  buildExpiries,
  buildVisibleStrikes,
  isCurrentWeekExp,
  INTENSITY_MIN,
  nearestStrikeTo,
  oiSideChange,
  parseExpiration,
  pickCenterStrike,
  pickKeyExpirations,
  scaleOf,
  volSideValue,
  type DataMode,
  type ExpColumn,
  type Expiration,
  type GreekCell,
  type Scale,
} from './chainMath'
import { CHAIN_DEFAULT_SKIN, CHAIN_HEAT_SKIN_KEY, HEAT_SKINS, isHeatSkin, type HeatSkin } from './heatSkins'
import { etDateKey, etToday, isSessionLive, isSpxFeedLive, isTradingDay } from './marketSession'

// ── Modes ────────────────────────────────────────────────────────────────────

export const GREEK_MODES = ['gex', 'dex', 'chex', 'vex', 'oi', 'vol'] as const
export type GreekMode = (typeof GREEK_MODES)[number]

export const DATA_MODES = ['oi-vol', 'vol-only', 'flow'] as const
export const DATA_MODE_LABEL: Record<DataMode, string> = {
  'oi-vol': 'OI + Vol',
  'vol-only': 'Vol Only',
  flow: 'Flow GEX',
}

export const DISPLAY_PERCENTS = [5, 10, 15, 20, 25, 30, 50, 100] as const

export const REPLAY_SPEEDS = [0.5, 1, 2, 4, 8] as const
/** Frame interval at 1×. */
export const REPLAY_BASE_MS = 700

export const REPLAY_SCOPES = ['0dte', 'all'] as const
export type ReplayScope = (typeof REPLAY_SCOPES)[number]
export const REPLAY_SCOPE_LABEL: Record<ReplayScope, string> = { '0dte': '0DTE', all: 'All exp' }

/** Expirations shown side-by-side across the matrix in sequential mode. */
export const EXP_COLUMNS = 14
/** Overlapping loads are dropped; non-forced loads are rate-limited to this. */
const LOAD_MIN_INTERVAL_MS = 5000

// ── Replay frame ─────────────────────────────────────────────────────────────

export interface ReplayFrame {
  ts: string
  spot: number
  /** `${expiry}|${strike}` → { net: OI+Vol GEX, vol: volume-only GEX } */
  cells: Map<string, { net: number; vol: number }>
  /** The expiries THIS frame carried — the front one can roll intraday. */
  expiries: string[]
}

export interface OiSnapEntry {
  callOI: number
  putOI: number
  callChg: number
  putChg: number
}

export interface DodRow {
  symbol: string
  strike: number
  expiry: string | null
  net_yest: number
  net_today: number
  net_now: number | null
  delta: number
  now_delta: number | null
}

// ── Small fetch helpers ──────────────────────────────────────────────────────
// query() throws on a non-OK response and caches by URL. Every read below wants
// "give me the value or nothing" rather than an exception, and the live ones
// want to go and ask again, hence staleMs 0.

async function get<T>(url: string, staleMs = 0): Promise<T | null> {
  try {
    return await query<T>(url, { staleMs })
  } catch {
    return null
  }
}

export interface UseChainDataOpts {
  /** The board's symbol, from the app toolbar's picker. The chain FOLLOWS it and
   *  carries no ticker control of its own — that is the whole point of a
   *  board-wide symbol. */
  symbol: string
  expirySelection?: 'sequential' | 'key'
  expiryCount?: number
  initialReplay?: boolean
  initialReplayScope?: ReplayScope
}

export function useChainData(opts: UseChainDataOpts) {
  const { expirySelection = 'sequential', expiryCount, initialReplay = false, initialReplayScope = 'all' } = opts
  const seqColumns = Math.max(1, Math.floor(expiryCount ?? EXP_COLUMNS))

  // ── Identity ───────────────────────────────────────────────────────────────
  const fallbackExpiries = useMemo(() => buildExpiries(), [])
  const [expiries, setExpiries] = useState<Expiration[]>(fallbackExpiries)
  const [activeTicker, setActiveTicker] = useState(opts.symbol.toUpperCase())
  const [selectedExpiry, setSelectedExpiry] = useState(fallbackExpiries[0]?.value ?? '')

  // ── View modes ─────────────────────────────────────────────────────────────
  const [displayPercent, setDisplayPercent] = useState<number>(10)
  const [greekMode, setGreekMode] = useState<GreekMode>('gex')
  const [dataMode, setDataMode] = useState<DataMode>('oi-vol')
  const [heatSkin, setHeatSkin] = useState<HeatSkin>(CHAIN_DEFAULT_SKIN)
  const [intensity, setIntensity] = useState(HEAT_SKINS[CHAIN_DEFAULT_SKIN].intensity.def)

  // Auto strike window per ticker: SPX renders 10% (huge chain), everything else
  // 30%. Re-applies on every ticker change; the % control still overrides it for
  // the ticker on screen.
  useEffect(() => {
    setDisplayPercent(activeTicker.toUpperCase() === 'SPX' ? 10 : 30)
  }, [activeTicker])

  // The first render always uses the page default and any saved skin is applied
  // here, so the markup cannot mismatch on hydration.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const saved = window.localStorage.getItem(CHAIN_HEAT_SKIN_KEY)
      if (isHeatSkin(saved)) {
        setHeatSkin(saved)
        setIntensity(HEAT_SKINS[saved].intensity.def)
      }
    } catch {
      /* ignore */
    }
  }, [])

  const intensityMax = HEAT_SKINS[heatSkin].intensity.max
  const changeHeatSkin = useCallback((v: HeatSkin) => {
    setHeatSkin(v)
    setIntensity(HEAT_SKINS[v].intensity.def)
    try {
      window.localStorage.setItem(CHAIN_HEAT_SKIN_KEY, v)
    } catch {
      /* ignore */
    }
  }, [])

  // The grid colours read this deferred copy, so dragging Intensity stays
  // responsive: React commits the slider urgently and repaints the ~560-cell
  // matrix on a lower-priority pass it can interrupt.
  const deferredIntensity = useDeferredValue(intensity)

  // ── Load state ─────────────────────────────────────────────────────────────
  const [loadProgress, setLoadProgress] = useState(0)
  const [chainError, setChainError] = useState<string | null>(null)
  const [underlyingPrice, setUnderlyingPrice] = useState(0)
  const [refreshSeed, setRefreshSeed] = useState(0)

  const expColumnsRef = useRef<ExpColumn[]>([])
  const loadTokenRef = useRef(0)
  const loadInFlightRef = useRef(false)
  const lastLoadAtRef = useRef(0)
  const pendingGoRef = useRef(false)
  const selectedExpiryRef = useRef('')
  const expiriesRef = useRef<Expiration[]>([])
  const dataModeRef = useRef<DataMode>('oi-vol')

  useEffect(() => {
    dataModeRef.current = dataMode
  }, [dataMode])
  useEffect(() => {
    selectedExpiryRef.current = selectedExpiry
  }, [selectedExpiry])
  useEffect(() => {
    expiriesRef.current = expiries
  }, [expiries])

  // ── The chain load ─────────────────────────────────────────────────────────
  const loadChain = useCallback(
    async (ticker: string, startExp: string, bustCache = false, force = false) => {
      if (loadInFlightRef.current) return
      const now = Date.now()
      if (!force && now - lastLoadAtRef.current < LOAD_MIN_INTERVAL_MS) return
      loadInFlightRef.current = true
      lastLoadAtRef.current = now
      loadTokenRef.current += 1
      const token = loadTokenRef.current
      const bust = bustCache ? '&noCache=1' : ''

      const all = expiriesRef.current.length ? expiriesRef.current : fallbackExpiries
      let targets: Expiration[]
      if (expirySelection === 'key') {
        targets = pickKeyExpirations(all)
      } else {
        const startIdx = Math.max(0, all.findIndex((e) => e.value === startExp))
        targets = all.slice(startIdx, startIdx + seqColumns)
      }
      if (!targets.length) targets.push({ value: startExp, label: startExp })

      try {
        setChainError(null)
        setLoadProgress(8)

        // Flow GEX is only tracked for SPX (the live accumulator has no dealer
        // inventory for other tickers), so it is fetched only there — otherwise
        // other tickers' columns would read SPX's strikes under a different
        // chain. Response shape is { gexRows: [...] }, each row carrying flowGEX.
        let flowGexMap: Map<number, number> = new Map()
        if (dataModeRef.current === 'flow' && ticker.toUpperCase() === 'SPX') {
          const gexJson = await get<{ gexRows?: Array<{ strike: number; flowGEX?: number }> }>(
            `/proxy/gex?basis=flow${bustCache ? '&noCache=1' : ''}`,
          )
          if (Array.isArray(gexJson?.gexRows)) {
            flowGexMap = new Map(gexJson.gexRows.map((r) => [Number(r.strike), Number(r.flowGEX ?? 0)]))
          }
        }

        const results = await Promise.all(
          targets.map(async (t): Promise<ExpColumn> => {
            const json = await get<{ data?: Record<string, unknown> }>(
              `/api/chains?ticker=${encodeURIComponent(ticker)}&expiration=${encodeURIComponent(
                t.value,
              )}&range=all${bust}`,
            )
            const data = json?.data
            const items = (data?.['items'] as unknown[]) ?? []
            const underlying = parseFloat(String(data?.['underlyingPrice'] ?? 0)) || 0
            return {
              expiration: t.value,
              label: t.label,
              underlying,
              cells: parseExpiration(items, t.value, underlying, dataModeRef.current, flowGexMap),
            }
          }),
        )

        if (token !== loadTokenRef.current) return

        const cols = results.filter((c) => c.cells.size > 0)
        if (!cols.length) {
          expColumnsRef.current = []
          setUnderlyingPrice(0)
          setChainError(`No live chain payload returned for ${ticker}.`)
          setLoadProgress(0)
          setRefreshSeed((s) => s + 0.01)
          return
        }

        // Keep every slot — empty ones render blank so the grid holds its width.
        expColumnsRef.current = results
        const spotPx = cols.find((c) => c.underlying > 0)?.underlying ?? 0
        setUnderlyingPrice(spotPx)
        setLoadProgress(100)
        setTimeout(() => setLoadProgress(0), 800)
        setRefreshSeed((s) => s + 0.01)
      } catch {
        expColumnsRef.current = []
        setUnderlyingPrice(0)
        setChainError(`Live chain load failed for ${ticker}.`)
        setLoadProgress(0)
      } finally {
        loadInFlightRef.current = false
      }
    },
    [expirySelection, seqColumns, fallbackExpiries],
  )

  const doRefresh = useCallback(async () => {
    await loadChain(activeTicker, selectedExpiryRef.current, true, true)
    setRefreshSeed((v) => v + 1)
  }, [loadChain, activeTicker])

  // Follow the board's symbol. Same ticker-changed path, triggered by the shell
  // rather than a click.
  useEffect(() => {
    const t = opts.symbol.toUpperCase()
    setActiveTicker((cur) => {
      if (t === cur) return cur
      pendingGoRef.current = true
      return t
    })
  }, [opts.symbol])

  // Re-fetch + re-parse when the basis toggle changes (skip mount).
  const dataModeMountRef = useRef(true)
  useEffect(() => {
    if (dataModeMountRef.current) {
      dataModeMountRef.current = false
      return
    }
    if (activeTicker && selectedExpiryRef.current) {
      void loadChain(activeTicker, selectedExpiryRef.current, false, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataMode])

  // Auto-load on mount.
  useEffect(() => {
    const defaultExpiry = selectedExpiry || expiries[0]?.value
    if (defaultExpiry) void loadChain(activeTicker, defaultExpiry)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Poll every 60s. SPX rides isSpxFeedLive (~24/7 across the trading week);
  // every other ticker rides isSessionLive (RTH only) — after the close their
  // greeks just stay STALE rather than being overwritten, because there is no
  // point re-fetching a frozen book.
  useEffect(() => {
    const id = setInterval(() => {
      const exp = selectedExpiryRef.current
      if (!exp || !activeTicker) return
      const isSpx = activeTicker.toUpperCase() === 'SPX'
      const live = isSpx ? isSpxFeedLive() : isSessionLive()
      // No noCache — the server chain cache absorbs repeats across clients and
      // its TTL still refreshes intraday OI/greek drift.
      if (live) void loadChain(activeTicker, exp, false)
    }, 60_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTicker])

  // The ticker's REAL listed expirations. Replaces the fabricated calendar so
  // the picker never offers a date the symbol does not trade.
  useEffect(() => {
    let cancelled = false
    const ticker = (activeTicker || 'SPX').toUpperCase()
    void (async () => {
      const json = await get<{ data?: { items?: Array<Record<string, unknown>> } }>(
        `/api/expirations?ticker=${encodeURIComponent(ticker)}`,
        30_000,
      )
      const items = json?.data?.items ?? []
      if (cancelled || !items.length) return

      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      const seen = new Set<string>()
      const list: Expiration[] = items
        .map((it) => String(it['expiration-date'] ?? ''))
        .filter((d) => d && !seen.has(d) && (seen.add(d), true))
        .sort()
        .map((value) => {
          const dt = new Date(`${value}T12:00:00`)
          const mm = String(dt.getMonth() + 1).padStart(2, '0')
          const dd = String(dt.getDate()).padStart(2, '0')
          return { value, label: `${dayNames[dt.getDay()]}, ${mm}-${dd}-${dt.getFullYear()}` }
        })
      if (!list.length) return

      setExpiries(list)
      // If the current selection is not a real listing for this ticker, snap to
      // the nearest valid one, preferring today's 0DTE.
      const today = etDateKey(etToday())
      const cur = selectedExpiryRef.current
      const validExpiry = list.some((e) => e.value === cur)
        ? cur
        : (list.find((e) => e.value === today)?.value ?? (list[0] as Expiration).value)
      setSelectedExpiry(validExpiry)

      if (pendingGoRef.current) {
        pendingGoRef.current = false
        void loadChain(ticker, validExpiry, true, true)
      }
    })()
    return () => {
      cancelled = true
    }
    // Ticker change ONLY. loadChain is stable, selectedExpiry is read via ref —
    // listing it here is what caused v2's infinite fetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTicker])

  // ── Replay ─────────────────────────────────────────────────────────────────
  const [replayOn, setReplayOn] = useState(initialReplay)
  const [replayDates, setReplayDates] = useState<string[]>([])
  const [replayDate, setReplayDate] = useState('')
  const [replayFrames, setReplayFrames] = useState<ReplayFrame[]>([])
  const [replayIdx, setReplayIdx] = useState(0)
  const [replayPlaying, setReplayPlaying] = useState(false)
  const [replaySpeed, setReplaySpeed] = useState<number>(1)
  const [replayLoading, setReplayLoading] = useState(false)
  const [replayErr, setReplayErr] = useState('')
  const [replayScope, setReplayScope] = useState<ReplayScope>(initialReplayScope)
  const preReplayModes = useRef<{ greek: GreekMode } | null>(null)

  // GEX is the only greek strike_growth records, so replay takes the greek tab
  // and gives it back on exit. Deliberately NOT a silent disable — the tiles
  // stay visible and inert, with a reason.
  useEffect(() => {
    if (replayOn) {
      if (!preReplayModes.current) preReplayModes.current = { greek: greekMode }
      if (greekMode !== 'gex') setGreekMode('gex')
    } else if (preReplayModes.current) {
      const { greek } = preReplayModes.current
      preReplayModes.current = null
      setGreekMode(greek)
    }
    // greekMode is READ, not tracked — listing it would fight the pin
    // (set → effect → set) on every tab click while replay is on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayOn])

  // Leaving replay (or switching ticker) drops the session so the next entry
  // does not flash the previous symbol's frames under the new ticker.
  useEffect(() => {
    setReplayFrames([])
    setReplayIdx(0)
    setReplayPlaying(false)
    setReplayErr('')
  }, [activeTicker, replayOn])

  useEffect(() => {
    if (!replayOn) return
    let cancelled = false
    void (async () => {
      const j = await get<{ dates?: unknown[] }>(
        `/proxy/strike-growth/replay-meta?symbol=${encodeURIComponent(activeTicker)}`,
      )
      if (cancelled) return
      if (!j) {
        setReplayDates([])
        setReplayDate('')
        setReplayErr('Could not load recorded sessions.')
        return
      }
      const ds: string[] = Array.isArray(j.dates) ? j.dates.map((d) => String(d).slice(0, 10)) : []
      setReplayDates(ds)
      setReplayDate((cur) => (cur && ds.includes(cur) ? cur : (ds[0] ?? '')))
      if (!ds.length) setReplayErr(`No recorded sessions for ${activeTicker}.`)
    })()
    return () => {
      cancelled = true
    }
  }, [replayOn, activeTicker])

  // The frames. One request per (symbol, session) — the whole day is pulled up
  // front so scrubbing is instant and never re-hits the network mid-drag.
  useEffect(() => {
    if (!replayOn || !replayDate) return
    let cancelled = false
    // Drop the previous session immediately: holding it while the new day loads
    // would render one date's grid under another date's label.
    setReplayFrames([])
    setReplayIdx(0)
    setReplayLoading(true)
    setReplayErr('')
    setReplayPlaying(false)
    void (async () => {
      const j = await get<{
        ok?: boolean
        error?: string
        expiries?: unknown[]
        frames?: Array<{ ts: string; spot: number; cells?: Array<[number, number, number, number]> }>
      }>(
        `/proxy/strike-growth/frames-by-expiry?symbol=${encodeURIComponent(
          activeTicker,
        )}&date=${encodeURIComponent(replayDate)}`,
      )
      if (cancelled) return
      if (!j) {
        setReplayFrames([])
        setReplayErr('Could not load frames.')
        setReplayLoading(false)
        return
      }
      if (!j.ok || !Array.isArray(j.frames) || !j.frames.length) {
        setReplayFrames([])
        setReplayErr(j.error ? String(j.error) : `No recorded frames for ${activeTicker} on ${replayDate}.`)
        setReplayLoading(false)
        return
      }
      const expiryList: string[] = Array.isArray(j.expiries) ? j.expiries.map(String) : []
      const frames: ReplayFrame[] = j.frames.map((f) => {
        const cells = new Map<string, { net: number; vol: number }>()
        const seen = new Set<string>()
        for (const c of f.cells ?? []) {
          const exp = expiryList[Number(c[0])]
          if (!exp) continue
          seen.add(exp)
          cells.set(`${exp}|${Number(c[1])}`, { net: Number(c[2]) || 0, vol: Number(c[3]) || 0 })
        }
        return {
          ts: String(f.ts),
          spot: Number(f.spot) || 0,
          cells,
          expiries: expiryList.filter((e) => seen.has(e)),
        }
      })
      setReplayFrames(frames)
      // Land on the LAST frame: entering replay from a live chain, the nearest
      // thing to what was just on screen is the most recent snapshot.
      setReplayIdx(frames.length - 1)
      setReplayLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [replayOn, replayDate, activeTicker])

  // Playback. Stops at the last frame rather than looping — a session that
  // silently restarts reads as live data jumping backwards.
  useEffect(() => {
    if (!replayPlaying || replayFrames.length === 0) return
    const id = setInterval(
      () => {
        setReplayIdx((i) => {
          if (i >= replayFrames.length - 1) {
            setReplayPlaying(false)
            return i
          }
          return i + 1
        })
      },
      REPLAY_BASE_MS / replaySpeed,
    )
    return () => clearInterval(id)
  }, [replayPlaying, replaySpeed, replayFrames.length])

  const replayFrame = replayOn
    ? (replayFrames[Math.min(replayIdx, replayFrames.length - 1)] ?? null)
    : null

  /** Every expiry the session recorded, ascending. */
  const replayAllExpiries = useMemo(() => {
    const set = new Set<string>()
    for (const f of replayFrames) for (const e of f.expiries) set.add(e)
    return [...set].sort()
  }, [replayFrames])

  // The session's 0DTE expiry: the one expiring ON the replayed date. Roots
  // without a same-day listing never have one, so fall back to the earliest
  // expiry recorded — the front contract, which is what "0DTE" means for that
  // root on that day. Surfaced in the bar so a fallback is never mistaken for a
  // true same-day expiry.
  const replayZeroDteExp = replayAllExpiries.includes(replayDate)
    ? replayDate
    : (replayAllExpiries[0] ?? '')
  const replayZeroDteIsExact = !!replayZeroDteExp && replayZeroDteExp === replayDate

  /**
   * The session's FIXED axes — every strike and every in-scope expiry recorded in
   * ANY frame, computed once per session+scope and used for every frame in it.
   *
   * This is the difference between a replay you can read and one that shakes.
   * The recorder stores the top N strikes a side PER SWEEP, so building the axis
   * from the current frame makes rows enter and leave at both ends on every step.
   * A strike this frame did not record simply renders blank in its row.
   */
  const replayAxis = useMemo(() => {
    // Scope first: in "0dte" the axis must cover ONLY that expiry, or every
    // strike that was ever a wall in a LATER expiry survives as a permanently
    // blank row and the one column on screen is lost in whitespace.
    const keep = replayScope === '0dte' && replayZeroDteExp ? new Set([replayZeroDteExp]) : null
    const strikes = new Set<number>()
    const exps = new Set<string>()
    for (const f of replayFrames) {
      for (const e of f.expiries) if (!keep || keep.has(e)) exps.add(e)
      f.cells.forEach((_v, key) => {
        const bar = key.indexOf('|')
        if (keep && !keep.has(key.slice(0, bar))) return
        const strike = Number(key.slice(bar + 1))
        if (Number.isFinite(strike)) strikes.add(strike)
      })
    }
    return { strikes: [...strikes].sort((a, b) => a - b), expiries: [...exps].sort() }
  }, [replayFrames, replayScope, replayZeroDteExp])

  const replayColumns = useMemo<ExpColumn[]>(() => {
    if (!replayFrame) return []
    // Columns come from the SESSION axis, not this frame — per-frame columns made
    // the grid reflow horizontally every time an expiry dropped out of a sweep.
    return replayAxis.expiries.map((exp) => {
      const cells = new Map<number, GreekCell>()
      replayFrame.cells.forEach((v, key) => {
        const bar = key.indexOf('|')
        if (key.slice(0, bar) !== exp) return
        const strike = Number(key.slice(bar + 1))
        if (!Number.isFinite(strike)) return
        cells.set(strike, {
          // "flow" is not recorded, so it reads as OI+Vol rather than silently
          // rendering an empty grid on a tab that looks available.
          gex: dataMode === 'vol-only' ? v.vol : v.net,
          volGex: v.vol,
          // Not recorded. Zero — not a live value — because a live DEX beside a
          // 30-minutes-ago GEX is the exact confusion replay exists to avoid.
          dex: 0,
          chex: 0,
          vex: 0,
          oi: 0,
          callOI: 0,
          putOI: 0,
          callVol: 0,
          putVol: 0,
          callPrem: 0,
          putPrem: 0,
        })
      })
      return { expiration: exp, label: exp, cells, underlying: replayFrame.spot }
    })
  }, [replayFrame, replayAxis, dataMode])

  // ── Columns and the strike axis ────────────────────────────────────────────
  const { columns: liveColumns, spot: liveSpot } = useMemo(() => {
    const cols = expColumnsRef.current
    if (!cols.length) return { columns: [] as ExpColumn[], spot: 0 }
    const atmStrike = underlyingPrice > 0 ? underlyingPrice : (cols.find((c) => c.underlying > 0)?.underlying ?? 0)
    return { columns: cols, spot: atmStrike }
    // refreshSeed is the commit signal for expColumnsRef — see loadChain.
  }, [activeTicker, expiries, refreshSeed, selectedExpiry, underlyingPrice])

  const columns = replayFrame ? replayColumns : liveColumns
  // Centre on the spot AS RECORDED, not live spot — that is the point of a
  // rewind. Falls back to live only if the frame carried no usable price.
  const spot = replayFrame ? (replayFrame.spot > 0 ? replayFrame.spot : liveSpot) : liveSpot

  const allStrikes = useMemo(() => {
    if (replayFrame) return replayAxis.strikes
    const set = new Set<number>()
    columns.forEach((c) => c.cells.forEach((_v, k) => set.add(k)))
    return [...set].sort((a, b) => a - b)
  }, [columns, replayFrame, replayAxis])

  const nearestStrike = useMemo(() => {
    if (!allStrikes.length) return 0
    const ref = spot > 0 ? spot : (allStrikes[Math.floor(allStrikes.length / 2)] as number)
    return allStrikes.reduce((best, s) => (Math.abs(s - ref) < Math.abs(best - ref) ? s : best), allStrikes[0] as number)
  }, [allStrikes, spot])

  // Sticky window centre. Held as STATE with the chain it belongs to baked into
  // the key, not a ref mutated during render: render only READS the anchor and
  // falls back to true ATM when it does not belong to the chain on screen.
  const centerKey = `${activeTicker}|${replayFrame ? `replay:${replayDate}:${replayScope}` : 'live'}`
  const [centerAnchor, setCenterAnchor] = useState<{ key: string; strike: number }>({ key: '', strike: 0 })
  const centerStrike = useMemo(
    () => pickCenterStrike(allStrikes, nearestStrike, centerAnchor, centerKey),
    [allStrikes, nearestStrike, centerAnchor, centerKey],
  )
  useEffect(() => {
    if (!centerStrike) return
    if (centerAnchor.key !== centerKey || centerAnchor.strike !== centerStrike) {
      setCenterAnchor({ key: centerKey, strike: centerStrike })
    }
  }, [centerStrike, centerAnchor, centerKey])

  const totalRows = allStrikes.length
  const autoDisplayPercent = useMemo(() => {
    // Replay's strike universe is ALREADY a filtered set — the recorder stores
    // only the top strikes a side, so taking 10% of it would hide walls the
    // whole feature exists to show.
    if (replayFrame) return 100
    const requestedCount = Math.max(1, Math.round(totalRows * (displayPercent / 100)))
    if (displayPercent === 10 && requestedCount < 10) return 20
    return displayPercent
  }, [displayPercent, totalRows, replayFrame])

  const visibleStrikes = useMemo(
    () => buildVisibleStrikes(allStrikes, centerStrike, autoDisplayPercent),
    [allStrikes, centerStrike, autoDisplayPercent],
  )

  // ── Day-over-day ΔOI (OI tab only) ─────────────────────────────────────────
  const [oiChange, setOiChange] = useState<{
    symbol: string | null
    map: Map<string, OiSnapEntry>
    date: string | null
    prevDate: string | null
  }>({ symbol: null, map: new Map(), date: null, prevDate: null })

  useEffect(() => {
    if (greekMode !== 'oi') return
    let cancelled = false
    void (async () => {
      const j = await get<{ ok?: boolean; rows?: Array<Record<string, unknown>>; date?: string; prevDate?: string }>(
        `/proxy/oi-change?symbol=${encodeURIComponent(activeTicker)}`,
      )
      if (cancelled) return
      if (!j?.ok || !Array.isArray(j.rows)) {
        setOiChange({ symbol: activeTicker, map: new Map(), date: null, prevDate: null })
        return
      }
      const m = new Map<string, OiSnapEntry>()
      for (const r of j.rows) {
        m.set(`${String(r['expiry'] ?? '')}|${Number(r['strike'])}`, {
          callOI: Number(r['callOI']) || 0,
          putOI: Number(r['putOI']) || 0,
          callChg: Number(r['callChg']) || 0,
          putChg: Number(r['putChg']) || 0,
        })
      }
      setOiChange({ symbol: activeTicker, map: m, date: j.date ?? null, prevDate: j.prevDate ?? null })
    })()
    return () => {
      cancelled = true
    }
  }, [greekMode, activeTicker, refreshSeed])

  // The snapshot as the UI is allowed to see it: empty unless it belongs to the
  // ticker on screen. ONE place to gate, so the matrix and the provenance label
  // can never disagree about which ticker they are describing.
  const oiSnapshot = useMemo(
    () =>
      oiChange.symbol === activeTicker
        ? oiChange
        : { symbol: activeTicker, map: new Map<string, OiSnapEntry>(), date: null, prevDate: null },
    [oiChange, activeTicker],
  )

  // ── valueAt — the active-greek lookup every scale and total reads ──────────
  const valueAt = useCallback(
    (col: ExpColumn, strike: number): number | null => {
      if (greekMode === 'oi') {
        const snap = oiSnapshot.map.get(`${col.expiration}|${strike}`)
        if (!snap) return null
        return oiSideChange(snap, strike, nearestStrike)
      }
      const cell = col.cells.get(strike)
      if (!cell) return null
      if (greekMode === 'vol') return volSideValue(cell, strike, nearestStrike)
      return cell[greekMode]
    },
    [greekMode, nearestStrike, oiSnapshot],
  )

  // Per-column max + top-3 over the VISIBLE strikes, so each expiration colours
  // against its own scale.
  const colScales = useMemo<Scale[]>(
    () =>
      columns.map((col) =>
        scaleOf(
          visibleStrikes
            .map((s) => (s == null ? null : valueAt(col, s)))
            .filter((v): v is number => v != null),
        ),
      ),
    [columns, visibleStrikes, valueAt],
  )

  /** MVC per column = the visible strike with the highest ABSOLUTE net GEX.
   *  Always keyed on GEX (that is the MVC definition), whatever tab is active. */
  const mvcByCol = useMemo(
    () => columns.map((col) => peakStrike(col, visibleStrikes, (c) => c.gex)),
    [columns, visibleStrikes],
  )
  /** The pure-volume GEX peak — the ✕ marker on the OI+Vol view. */
  const volMvcByCol = useMemo(
    () => columns.map((col) => peakStrike(col, visibleStrikes, (c) => c.volGex)),
    [columns, visibleStrikes],
  )

  // ── Weekly EM ──────────────────────────────────────────────────────────────
  const [emLevels, setEmLevels] = useState<{ close: number; em: number } | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const row = await get<Record<string, unknown>>(`/api/levels?ticker=${encodeURIComponent(activeTicker)}`)
      if (cancelled) return
      const em = parseFloat(String(row?.['em'] ?? ''))
      const close = parseFloat(String(row?.['close'] ?? ''))
      setEmLevels(
        Number.isFinite(em) && em > 0 && Number.isFinite(close) && close > 0 ? { close, em } : null,
      )
    })()
    return () => {
      cancelled = true
    }
  }, [activeTicker, refreshSeed])

  /** The 4 EM band strikes, snapped to visible strikes. Null with no EM. */
  const emStrikes = useMemo(() => {
    if (!emLevels) return null
    const { close, em } = emLevels
    const vs = visibleStrikes.filter((s): s is number => s != null)
    return {
      close: nearestStrikeTo(close, vs),
      d1: nearestStrikeTo(close - em, vs),
      u1: nearestStrikeTo(close + em, vs),
      d2: nearestStrikeTo(close - 2 * em, vs),
      u2: nearestStrikeTo(close + 2 * em, vs),
    }
  }, [emLevels, visibleStrikes])

  // ── Day-over-day movers (for the hover card) ───────────────────────────────
  const [dodRows, setDodRows] = useState<DodRow[]>([])
  useEffect(() => {
    let cancelled = false
    const t = (activeTicker || 'SPX').toUpperCase()
    void (async () => {
      const j = await get<{ rows?: DodRow[] }>(`/proxy/strike-dod?limit=2000`)
      if (cancelled) return
      const rows = Array.isArray(j?.rows) ? j.rows : []
      setDodRows(rows.filter((d) => String(d.symbol ?? '').toUpperCase() === t))
    })()
    return () => {
      cancelled = true
    }
  }, [activeTicker, refreshSeed])

  // ── Focus selection ────────────────────────────────────────────────────────
  const [selExps, setSelExps] = useState<Set<string>>(() => new Set())
  const [selStrikes, setSelStrikes] = useState<Set<number>>(() => new Set())
  const hasSel = selExps.size > 0 || selStrikes.size > 0
  const clearSel = useCallback(() => {
    setSelExps(new Set())
    setSelStrikes(new Set())
  }, [])
  /** solo = shift-click: replace the selection with just this one. */
  const toggleExpSel = useCallback((exp: string, solo: boolean) => {
    setSelExps((prev) => {
      if (solo) return prev.size === 1 && prev.has(exp) ? new Set() : new Set([exp])
      const next = new Set(prev)
      if (next.has(exp)) next.delete(exp)
      else next.add(exp)
      return next
    })
  }, [])
  const toggleStrikeSel = useCallback((strike: number, solo: boolean) => {
    setSelStrikes((prev) => {
      if (solo) return prev.size === 1 && prev.has(strike) ? new Set() : new Set([strike])
      const next = new Set(prev)
      if (next.has(strike)) next.delete(strike)
      else next.add(strike)
      return next
    })
  }, [])
  // A focus selection is about the columns/strikes on screen — a new ticker, a
  // new expiry window or a jump in/out of replay invalidates it.
  useEffect(() => {
    clearSel()
  }, [activeTicker, selectedExpiry, replayDate, replayScope, clearSel])

  // ── Layout facts the grid needs ────────────────────────────────────────────
  const gridCols = replayFrame
    ? columns.length
    : Math.max(columns.length, expirySelection === 'key' ? 4 : seqColumns)

  // ⅀ Total sums the NON-0DTE expiries. In "0dte" scope that set is empty, so
  // the column is dropped rather than printed as a column of zeros that reads as
  // "no gamma" instead of "not summed".
  const showTotalCol = !(replayFrame && replayScope === '0dte')
  // Size the rewound grid for the session's FULL expiry count in either scope,
  // so switching 0DTE↔All changes which columns are on screen and nothing else.
  // Live passes 0 — its column count is already fixed by seqColumns.
  const layoutExpCols = replayFrame ? replayAllExpiries.length : 0

  const colIsCurrentWeek = useMemo(
    () =>
      Array.from({ length: gridCols }).map((_, i) => {
        const c = columns[i]
        return c ? isCurrentWeekExp(c.expiration) : false
      }),
    [columns, gridCols],
  )
  const anyCurrentWeek = colIsCurrentWeek.some(Boolean)

  const levelsOnly = atMinIntensity(deferredIntensity, INTENSITY_MIN.chain)

  return {
    // identity
    activeTicker,
    expiries,
    selectedExpiry,
    setSelectedExpiry,
    // modes
    displayPercent,
    setDisplayPercent,
    greekMode,
    setGreekMode,
    dataMode,
    setDataMode,
    heatSkin,
    changeHeatSkin,
    intensity,
    setIntensity,
    intensityMax,
    deferredIntensity,
    levelsOnly,
    // load
    loadProgress,
    chainError,
    doRefresh,
    // data
    columns,
    spot,
    allStrikes,
    nearestStrike,
    visibleStrikes,
    gridCols,
    showTotalCol,
    layoutExpCols,
    colScales,
    mvcByCol,
    volMvcByCol,
    valueAt,
    oiSnapshot,
    emLevels,
    emStrikes,
    anyCurrentWeek,
    dodRows,
    // selection
    selExps,
    selStrikes,
    hasSel,
    clearSel,
    toggleExpSel,
    toggleStrikeSel,
    // replay
    replay: {
      on: replayOn,
      setOn: setReplayOn,
      dates: replayDates,
      date: replayDate,
      setDate: setReplayDate,
      frames: replayFrames,
      frame: replayFrame,
      idx: replayIdx,
      setIdx: setReplayIdx,
      playing: replayPlaying,
      setPlaying: setReplayPlaying,
      speed: replaySpeed,
      setSpeed: setReplaySpeed,
      loading: replayLoading,
      err: replayErr,
      scope: replayScope,
      setScope: setReplayScope,
      allExpiries: replayAllExpiries,
      axis: replayAxis,
      zeroDteExp: replayZeroDteExp,
      zeroDteIsExact: replayZeroDteIsExact,
    },
    sessionDate: replayFrame ? replayDate : '',
  }
}

/** The visible strike with the largest |field| in a column. */
function peakStrike(
  col: ExpColumn,
  visibleStrikes: Array<number | null>,
  read: (c: GreekCell) => number | undefined,
): number | null {
  let best: number | null = null
  let bestAbs = 0
  visibleStrikes.forEach((s) => {
    if (s == null) return
    const cell = col.cells.get(s)
    const g = cell ? read(cell) : undefined
    if (g == null) return
    const a = Math.abs(g)
    if (a > bestAbs) {
      bestAbs = a
      best = s
    }
  })
  return best
}

/** Re-exported so the grid can drop non-trading expiry columns. */
export { isTradingDay }
