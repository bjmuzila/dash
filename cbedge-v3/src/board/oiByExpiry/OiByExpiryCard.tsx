import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChartHandle } from '@/design/primitives/ChartFrame'
import { ChartFrame } from '@/design/primitives/ChartFrame'
import { SegGroup } from '@/design/primitives/Controls'
import { CardToolbar } from '@/design/primitives/Card'
import { useQuery } from '@/data/api'
import { SOCKET_SYMBOL } from '@/data/symbol'
import type { GexLevelsSnapshot, OiByExpiryRow } from '@/pages/scanner/gexLevels'
import { todayEtDate } from '@/pages/scanner/gexLevels'
import { gexUrl, loadOiByExpiration } from '@/pages/scanner/gexLevelsData'
import {
  EMPTY_OI_MODEL,
  fmtOiFull,
  mountOiByExpiry,
  type OiByExpiryHandle,
  type OiByExpiryModel,
  type OiMode,
} from './oiByExpiryRender'

// ─────────────────────────────────────────────────────────────────────────────
// OPEN INTEREST BY EXPIRATION — a board card.
//
// The scanner's GEX Levels card 5, with its two side-by-side mini charts folded
// into one: call and put share a COLUMN per date and a scale, because "at this
// date, how does call OI compare to put OI" is the only question anyone opens
// this card for and two charts a chart's width apart is not how you answer it.
// The drawing lives in oiByExpiryRender.ts, in the GEX Chart's language.
//
// ── One sweep, shared with the scanner ───────────────────────────────────────
// `loadOiByExpiration` from pages/scanner/gexLevelsData — the same loader, the
// same per-symbol per-ET-day localStorage cache, the same "only fulfilled legs
// are kept" rule. OPRA open interest is posted once, around 06:30 ET, and
// reflects the prior close, so this does NOT poll: the cache answers for the
// rest of the session and the toolbar's ↻ is the way past it. A card that
// re-swept twelve full chains every minute would be spending real upstream
// budget to redraw the same twelve bars.
//
// ── SPX only, and it takes no props ──────────────────────────────────────────
// Same reasoning the Net Vol GEX Flow card carries: the expiration list comes
// from /proxy/gex, which is the shared index feed, and this card is about the
// index book. A ticker control here would be a control that changes nothing.
//
// ── The two hops ─────────────────────────────────────────────────────────────
// /proxy/gex first, for `expirations`, then all twelve /api/chains AT ONCE.
// The second hop genuinely cannot be named without the first — it is the one
// loader on the scanner tab with that shape, and the same is true here.
//
// Non-negotiable 3 is about a route fanning out serially when it could fan out
// in parallel; the twelve chains do go together, and the one request in front
// of them is a small cached JSON the board's other consumers share through
// `useQuery`'s dedupe whenever anything else on screen has asked for it. It is
// still a hop, and it is why the card says "Waiting for the expiration list…"
// rather than pretending to be loading bars it does not yet know the names of.
// ─────────────────────────────────────────────────────────────────────────────

/** The mode switch, persisted per browser. One blob, tiny, same shape as the rest. */
const MODE_KEY = 'cb-v3-oi-by-expiry-mode'

function loadMode(): OiMode {
  try {
    const raw = localStorage.getItem(MODE_KEY)
    return raw === 'stacked' || raw === 'net' || raw === 'grouped' ? raw : 'grouped'
  } catch {
    return 'grouped'
  }
}

function saveMode(m: OiMode): void {
  try {
    localStorage.setItem(MODE_KEY, m)
  } catch {
    /* best-effort — the in-memory choice still drives this session */
  }
}

/** ONE empty array, not a fresh one per render — see the note in GexChartCard. */
const EMPTY_OI_ROWS: OiByExpiryRow[] = []

interface OiState {
  rows: OiByExpiryRow[]
  loading: boolean
  err: string | null
  /** ms, or null before the first answer. Stamped whether it came from cache or the wire. */
  loadedAt: number | null
  /** True when today's ET cache answered and no request was made at all. */
  fromCache: boolean
  /** Expiries whose leg rejected. The loader keeps the rest; this says how many went missing. */
  rejected: string[]
}

const EMPTY_OI_STATE: OiState = {
  rows: EMPTY_OI_ROWS,
  loading: false,
  err: null,
  loadedAt: null,
  fromCache: false,
  rejected: [],
}

export function OiByExpiryCard() {
  const [mode, setMode] = useState<OiMode>(() => loadMode())
  const [oi, setOi] = useState<OiState>(EMPTY_OI_STATE)

  const pickMode = useCallback((m: OiMode) => {
    setMode(m)
    saveMode(m)
  }, [])

  // ── Hop 1: the expiration list ─────────────────────────────────────────────
  // Long stale window and no poll: the listed expirations for an index change
  // once a day, when one rolls off.
  const snapQ = useQuery<GexLevelsSnapshot>(gexUrl(), { staleMs: 60_000 })
  const expirations = useMemo(() => {
    const list = snapQ.data?.expirations
    return Array.isArray(list) ? list.filter((e): e is string => typeof e === 'string' && !!e) : []
  }, [snapQ.data])
  // The dependency key, so an identical-but-new array does not re-sweep.
  const expiryKey = expirations.join(',')

  // ── Hop 2: the twelve chains ───────────────────────────────────────────────
  const runRef = useRef(0)
  const sweep = useCallback(
    (force: boolean) => {
      if (!expirations.length) return
      const run = ++runRef.current
      setOi((prev) => ({ ...prev, loading: true, err: null }))
      loadOiByExpiration(SOCKET_SYMBOL, expirations, force)
        .then((load) => {
          // A stale sweep must not overwrite a newer one — twelve parallel
          // chain fetches take long enough that a ↻ can land mid-flight.
          if (run !== runRef.current) return
          // `skipped` is the loader's own bail (no symbol, no expirations). It
          // touches nothing, exactly as v2 does, so the card keeps saying
          // "waiting" rather than flashing an empty chart.
          if (load.skipped) {
            setOi((prev) => ({ ...prev, loading: false }))
            return
          }
          setOi({
            rows: load.rows,
            loading: false,
            err: null,
            loadedAt: load.loadedAt,
            fromCache: load.fromCache,
            rejected: load.rejected,
          })
        })
        .catch((e: unknown) => {
          if (run !== runRef.current) return
          setOi((prev) => ({
            ...prev,
            loading: false,
            err: e instanceof Error ? e.message : String(e),
          }))
        })
    },
    [expirations],
  )

  useEffect(() => {
    sweep(false)
    // `expiryKey` rather than `sweep`: the callback is rebuilt on every render
    // that produces a new `expirations` array, and depending on it would re-run
    // a twelve-request sweep for a list that had not changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiryKey])

  // ── The canvas ─────────────────────────────────────────────────────────────
  const handleRef = useRef<OiByExpiryHandle | null>(null)
  const modelRef = useRef<OiByExpiryModel>(EMPTY_OI_MODEL)
  const visibleRef = useRef(true)
  const missedRef = useRef(false)

  const paint = useCallback(() => {
    const handle = handleRef.current
    if (!handle) return
    if (!visibleRef.current) {
      missedRef.current = true
      return
    }
    missedRef.current = false
    handle.setModel(modelRef.current)
  }, [])

  // OI moves once a day and the mode switch is a click, so there is no tick
  // path here at all — the model is rebuilt from state and painted.
  useEffect(() => {
    modelRef.current = { rows: oi.rows, mode, todayEt: todayEtDate(), symbol: SOCKET_SYMBOL }
    paint()
  }, [oi.rows, mode, paint])

  const onMount = useCallback((frame: ChartHandle): (() => void) => {
    const created = mountOiByExpiry(frame.el)
    handleRef.current = created
    visibleRef.current = frame.visible()
    // Replay whatever arrived before the frame mounted.
    created.setModel(modelRef.current)
    return () => {
      created.destroy()
      handleRef.current = null
    }
  }, [])

  const onResize = useCallback(() => {
    if (!visibleRef.current) {
      missedRef.current = true
      return
    }
    handleRef.current?.redraw()
  }, [])

  const onVisibility = useCallback(
    (visible: boolean) => {
      visibleRef.current = visible
      if (visible && missedRef.current) paint()
    },
    [paint],
  )

  // ── Header numbers ─────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let call = 0
    let put = 0
    for (const r of oi.rows) {
      call += r.callOI
      put += r.putOI
    }
    return { call, put, pc: call > 0 ? put / call : null }
  }, [oi.rows])

  const stamp = oi.loadedAt
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(oi.loadedAt))
    : null

  const empty = !oi.rows.length

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-1.5"
      data-capture-meta={[SOCKET_SYMBOL, 'OI by expiration', stamp ? `${stamp} ET` : '']
        .filter(Boolean)
        .join(' · ')}
    >
      <CardToolbar>
        <SegGroup
          title="Call and put side by side in one column, stacked into one bar, or the signed difference"
          options={[
            { label: 'GROUPED', value: 'grouped', title: 'Both legs side by side in the date’s column, on one scale' },
            { label: 'STACKED', value: 'stacked', title: 'One bar per date, puts under calls — total OI at a glance' },
            {
              label: 'NET C−P',
              value: 'net',
              title: 'Call OI minus put OI. Above the line the calls outweigh the puts at that date',
            },
          ]}
          value={mode}
          onChange={pickMode}
        />

        <span
          title="Total call open interest across the expirations shown"
          className="tabular shrink-0 font-mono text-xs font-extrabold"
          style={{ color: 'var(--color-gexbar-pos)' }}
        >
          {empty ? '—' : fmtOiFull(totals.call)}
        </span>
        <span
          title="Total put open interest across the expirations shown"
          className="tabular shrink-0 font-mono text-xs font-extrabold"
          style={{ color: 'var(--color-gexbar-neg)' }}
        >
          {empty ? '—' : fmtOiFull(totals.put)}
        </span>
        <span
          title="Put/call open interest ratio across the expirations shown"
          className="tabular shrink-0 font-mono text-2xs font-bold text-muted"
        >
          P/C {totals.pc == null ? '—' : totals.pc.toFixed(2)}
        </span>

        <span
          title="OPRA open interest is published once a day, around 06:30 ET, and reflects the prior close — so this is fetched once per trading day and cached in this browser. Refresh forces a re-pull"
          className="ml-auto shrink-0 truncate text-2xs uppercase tracking-[0.1em] text-muted opacity-60"
        >
          {oi.loading ? 'Sweeping…' : stamp ? `${stamp} ET${oi.fromCache ? ' · cached' : ''}` : 'OPRA OI'}
        </span>
        <button
          type="button"
          onClick={() => sweep(true)}
          title="Force a re-pull, skipping today's cache"
          className="shrink-0 rounded-sm border border-line px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-accent"
        >
          Refresh
        </button>
      </CardToolbar>

      <div className="relative min-h-0 flex-1">
        <ChartFrame onMount={onMount} onResize={onResize} onVisibility={onVisibility} className="absolute inset-0" />
        {oi.err ? (
          <span className="pointer-events-none absolute left-1 right-1 top-1 truncate text-2xs text-down opacity-80">
            Open-interest sweep failed — {oi.err}
          </span>
        ) : empty ? (
          <span className="pointer-events-none absolute left-1 top-1 text-2xs text-muted opacity-50">
            {oi.loading
              ? `Summing open interest across ${SOCKET_SYMBOL}'s nearest expirations…`
              : expirations.length
                ? 'No expirations resolved'
                : 'Waiting for the expiration list…'}
          </span>
        ) : oi.rejected.length ? (
          // The loader drops a rejected leg and keeps the rest, which would
          // otherwise turn twelve bars into nine with nothing saying so.
          <span className="pointer-events-none absolute left-1 right-1 top-1 truncate text-2xs text-muted opacity-60">
            {oi.rejected.length} expiration{oi.rejected.length === 1 ? '' : 's'} did not answer
          </span>
        ) : null}
      </div>
    </div>
  )
}
