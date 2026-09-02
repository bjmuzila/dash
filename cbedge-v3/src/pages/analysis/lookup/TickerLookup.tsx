// Parts C–G — Ticker Lookup. Type any optionable ticker → its live GEX ladder,
// walls and gamma regime, on ONE ticker in TWO scopes side by side:
//
//   LEFT   one expiration, picked from the front-of-board pills. Built from
//          /api/chains + accumulateChainGreeks() — the exact same function the
//          Multi Greek card uses, so the per-strike numbers here and up there
//          can never drift apart.
//   RIGHT  THE WHOLE BOARD, MINUS 0DTE. Every listed expiration EXCEPT today's,
//          fetched the way the Options Chain page fetches its columns: the real
//          listing from /api/expirations, then ONE /api/chains call per expiry
//          (&range=all), run through the SAME function and summed per strike.
//
// WHY NOT /proxy/gex-by-strike-multi, WHICH RETURNS EXACTLY THIS LADDER:
// because its numbers did not match the chain. That sweep is ThetaData-sourced.
// For SPX it is fine; for single names it comes back sparse — most near-spot
// strikes carried no OI, so the ladder printed three-figure GEX at the money and
// its Core landed on a far wing strike (NVDA at 218 spot: Core 335, flip 59.77,
// every near-spot bar red, while the Options Chain page's ⅀ Total for the same
// name and session was strongly positive). Two surfaces, same label, different
// answers. This pane reads the same TastyTrade chain the rest of the app prices
// off, so Ticker Lookup and the Options Chain agree by construction.
//
// COST: one request per expiration instead of one per board. EVERY listed expiry
// is swept — no cap, because "All expirations" has to mean all of them; a
// quarterly 300 days out is exactly the kind of strike that parks a wall the
// front weeklies never show. The cost is paid by refreshing slowly and on the ↻
// button instead of by dropping expiries. The header always says how many the
// ladder actually covers, so a chain call that failed shows up as a smaller
// number rather than silently.
//
// WHY EX-0DTE, ALWAYS: same-day gamma dwarfs the rest of the board and decays to
// nothing by the close, so a board that included it printed walls that were
// really just today's pin. This pane is the STRUCTURAL board; the 0DTE view is
// one click away on the left pane's expiry pills.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  FS,
  AnalysisCard,
  CardState,
  Placeholder,
  Row,
  Stat,
  UpdatedStamp,
  Value,
  btn,
  btnSecondary,
  etDateISO,
  fmtBig,
  numOr,
  useLiveData,
  useRefreshButton,
} from '../kit'
import { ReplayDock } from '@/design/primitives/ReplayDock'
import { TickerPicker, cleanSymbol } from '../TickerPicker'
import { accumulateChainGreeks } from '../greeks'
import { TlLadder } from './Ladder'
import {
  TL_LADDER_VIEW_SIDE,
  TL_ROW_H,
  tlAtm,
  tlExpiryChip,
  tlLevelsFrom,
  tlNearestIdx,
  tlWindow,
  type ChainGroup,
  type TlRow,
} from './levels'
import {
  TL_REPLAY_BASE_MS,
  TL_REPLAY_SPEEDS,
  fmtTlReplayClock,
  parseReplayFrames,
  tlReplayRows,
  tlSessionAxis,
  tlTimelineOf,
  type TlReplayFrame,
  type TlReplaySession,
} from './replay'
import { useScannerTickers } from '@/data/useScannerTickers'
import { LEVEL_COLORS, V2, V2W } from '@/design/theme'

const LOOKUP_KEY = 'analytics.tickerLookup.recent'
const QUICK: readonly string[] = ['SPX', 'SPY', 'QQQ', 'NVDA', 'TSLA']

/** The board is one /api/chains call per expiration, so it polls slowly. */
const BOARD_REFRESH_MS = 120_000
/**
 * Parallel chain fetches. The board is uncapped — SPX lists 40+ expirations and
 * every one is fetched — so this is the only throttle: six in flight keeps a
 * full board inside a few seconds without a ticker switch flooding the proxy.
 * (The server-side sweep uses four; this runs from one browser, not the VPS.)
 */
const BOARD_CONCURRENCY = 6

/**
 * How far spot must WALK before the ladder re-anchors, in strikes.
 *
 * Rewound, spot moves a point or two per frame; anchoring on the nearest strike
 * to the live spot meant that every few frames the slice shifted by one rung and
 * the auto-centre scrolled — the whole ladder juddered for the length of the
 * replay. The window carries ±20 rungs and the pane shows ±10, so letting spot
 * drift five strikes off the anchor still leaves it comfortably on screen.
 */
const ANCHOR_SLACK = 5

/** 14 (label) + 24 (value) + 15 + 15 + gaps + padding + border. */
const CHIP_MIN_H = 106
/** Everything in a pane that is NOT the ladder. */
const PANE_CHROME_H = 24 + 20 + 64 + 18 + 40 + CHIP_MIN_H
/** Tall enough for ten rungs a side plus the spot row, with no scroll on open. */
const SPLIT_MIN_H = PANE_CHROME_H + 20 + (TL_LADDER_VIEW_SIDE * 2 + 1) * TL_ROW_H

interface TlChainResp {
  data?: { items?: ChainGroup[]; underlyingPrice?: unknown }
  error?: string
}
interface TlExpResp {
  data?: { items?: Array<{ 'expiration-date'?: unknown }> }
  error?: string
}
interface TlChangeRow {
  strike?: unknown
  netGex?: unknown
  prevNetGex?: unknown
  chg?: unknown
  hadPrev?: unknown
}
interface TlChangeResp {
  ok?: boolean
  symbol?: string
  date?: string | null
  /** The actual previous snapshot date — not calendar yesterday. */
  prevDate?: string | null
  rows?: TlChangeRow[]
  error?: string
}

/**
 * Spot, quantised to a strike that only moves once spot has walked ANCHOR_SLACK
 * rungs away from it.
 *
 * Everything that would make the ladder MOVE — the window slice and the scroll
 * centring — reads this instead of the live spot; the dashed spot line and the
 * level chips keep reading the real one, so the marker still tracks price tick by
 * tick. It is the paper underneath that stops sliding.
 *
 * The ref is settled during render on purpose. The anchor is a pure function of
 * (rows, spot, resetKey) plus its own previous value, and re-running it lands on
 * the same strike — so there is nothing for an effect to schedule, and an effect
 * would only add a paint at the old scroll position before correcting it.
 */
function useTlAnchor(rows: TlRow[], spot: number | null, resetKey: string): number | null {
  const held = useRef<{ key: string; strike: number | null }>({ key: '', strike: null })
  const idxSpot = tlNearestIdx(rows, spot)
  if (idxSpot < 0) return held.current.strike // no rows / no spot — hold the last
  const at = rows[idxSpot]
  if (!at) return held.current.strike
  const cur = held.current
  if (cur.key !== resetKey || cur.strike == null) {
    held.current = { key: resetKey, strike: at.strike }
  } else {
    const idxAnchor = tlNearestIdx(rows, cur.strike)
    if (idxAnchor < 0 || Math.abs(idxSpot - idxAnchor) >= ANCHOR_SLACK) {
      held.current = { key: resetKey, strike: at.strike }
    }
  }
  return held.current.strike
}

/** Transport / speed button in the replay bar. */
function replayBtn(active: boolean): CSSProperties {
  return {
    height: 24,
    padding: '0 8px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: FS.small,
    fontWeight: 800,
    fontFamily: 'inherit',
    lineHeight: 1,
    color: active ? V2.ink : V2.text,
    background: active ? V2.orange : V2W.wash05,
    border: `1px solid ${active ? V2.orange : V2W.border}`,
  }
}

/**
 * The row of level chips. `marginTop: auto` pins it to the BOTTOM of the pane,
 * so the left and right panes' chips line up at the same y no matter how many
 * rungs their ladders have.
 */
const CHIP_ROW: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 8,
  alignItems: 'stretch',
  marginTop: 'auto',
  flexShrink: 0,
}

/** Compact chip for a computed level: name, price, and how far spot is from it. */
function LevelChip({
  name,
  value,
  spot,
  color,
  note,
}: {
  name: string
  value: number | null
  spot: number | null
  color: string
  note: string
}) {
  const dist = value != null && spot != null ? value - spot : null
  // Every row is pinned to a fixed line box and clipped to ONE line, so all
  // three chips are the same height however long the note or the distance
  // string is — and the left pane's row matches the right pane's.
  const oneLine: CSSProperties = {
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0,
  }
  return (
    <div
      style={{
        border: `1px solid ${V2W.border}`,
        borderRadius: 12,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minWidth: 0,
        minHeight: CHIP_MIN_H,
        boxSizing: 'border-box',
      }}
    >
      <span
        style={{
          ...oneLine,
          fontSize: FS.caption,
          lineHeight: '16px',
          fontWeight: 800,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color,
        }}
        title={name}
      >
        {name}
      </span>
      <span style={{ ...oneLine, display: 'block', lineHeight: '30px' }}>
        <Value color={value == null ? V2.muted : color} size={FS.chip}>
          {value == null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: 2 })}
        </Value>
      </span>
      <span
        style={{
          ...oneLine,
          fontSize: FS.row,
          lineHeight: '18px',
          fontFamily: 'var(--font-mono)',
          color: V2.text,
        }}
      >
        {dist == null
          ? '—'
          : dist === 0
            ? 'at price'
            : `${Math.abs(dist).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${dist > 0 ? 'above' : 'below'}`}
      </span>
      <span style={{ ...oneLine, fontSize: FS.row, lineHeight: '18px', color: V2.text }} title={note}>
        {note}
      </span>
    </div>
  )
}

export function TickerLookupCard({
  initialSymbol = 'SPX',
  embedded = false,
  initialReplay = false,
}: {
  initialSymbol?: string
  embedded?: boolean
  initialReplay?: boolean
} = {}) {
  const today = etDateISO()
  const [sym, setSym] = useState(() => cleanSymbol(initialSymbol) || 'SPX')
  const [recent, setRecent] = useState<string[]>([])
  const [expiry, setExpiry] = useState<string | null>(null)

  // Restored in an effect, not a useState initializer, so the first client
  // render agrees with the server's.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LOOKUP_KEY)
      const parsed: unknown = raw ? JSON.parse(raw) : null
      if (Array.isArray(parsed))
        setRecent(parsed.filter((s): s is string => typeof s === 'string').slice(0, 8))
    } catch {
      /* private mode / bad JSON — the quick row is enough */
    }
  }, [])

  const lookup = useCallback((raw: string) => {
    const s = cleanSymbol(raw)
    if (!s) return
    setSym(s)
    setExpiry(null) // a new ticker has a different expiry board
    setRecent((prev) => {
      const next = [s, ...prev.filter((x) => x !== s)].slice(0, 8)
      try {
        window.localStorage.setItem(LOOKUP_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  /** Drop a symbol from the recents the picker offers. The scanner universe is not editable from here. */
  const forget = useCallback((raw: string) => {
    const s = raw.trim().toUpperCase()
    setRecent((prev) => {
      const next = prev.filter((x) => x !== s)
      try {
        window.localStorage.setItem(LOOKUP_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  // ── Replay state ───────────────────────────────────────────────────────────
  const [replayOn, setReplayOn] = useState(initialReplay)
  const [replayDates, setReplayDates] = useState<string[]>([])
  const [replayDate, setReplayDate] = useState('')
  const [replaySession, setReplaySession] = useState<TlReplaySession | null>(null)
  const [replayIdx, setReplayIdx] = useState(0)
  const [replayPlaying, setReplayPlaying] = useState(false)
  const [replaySpeed, setReplaySpeed] = useState<number>(1)
  const [replayLoading, setReplayLoading] = useState(false)
  const [replayErr, setReplayErr] = useState('')

  // Leaving replay, or switching ticker, drops the loaded session so the next
  // entry cannot paint one symbol's frames under another's label.
  useEffect(() => {
    setReplaySession(null)
    setReplayIdx(0)
    setReplayPlaying(false)
    setReplayErr('')
  }, [replayOn, sym])

  // Which sessions are replay-able. Retention is ~5 trading days, so the list is
  // short by design — this is a rewind, not a history browser.
  useEffect(() => {
    if (!replayOn) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/proxy/strike-growth/replay-meta?symbol=${encodeURIComponent(sym)}`,
          { cache: 'no-store' },
        )
        const j = (await res.json().catch(() => null)) as { dates?: unknown } | null
        if (cancelled) return
        const ds: string[] = Array.isArray(j?.dates)
          ? j!.dates.map((d: unknown) => String(d).slice(0, 10))
          : []
        setReplayDates(ds)
        setReplayDate((cur) => (cur && ds.includes(cur) ? cur : (ds[0] ?? '')))
        if (!ds.length) setReplayErr(`No recorded sessions for ${sym}.`)
      } catch {
        if (!cancelled) {
          setReplayDates([])
          setReplayDate('')
          setReplayErr('Could not load recorded sessions.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [replayOn, sym])

  // The frames. ONE request per (symbol, session) — the whole day is pulled up
  // front so scrubbing is instant and never re-hits the network mid-drag.
  useEffect(() => {
    if (!replayOn || !replayDate) return
    let cancelled = false
    setReplaySession(null)
    setReplayIdx(0)
    setReplayLoading(true)
    setReplayErr('')
    setReplayPlaying(false)
    void (async () => {
      try {
        const res = await fetch(
          `/proxy/strike-growth/frames-by-expiry?symbol=${encodeURIComponent(sym)}&date=${encodeURIComponent(replayDate)}`,
          { cache: 'no-store' },
        )
        const j = (await res.json().catch(() => null)) as
          | { ok?: boolean; error?: string; expiries?: unknown; frames?: unknown }
          | null
        if (cancelled) return
        if (!j?.ok || !Array.isArray(j.frames) || !j.frames.length) {
          setReplaySession(null)
          setReplayErr(j?.error ? String(j.error) : `No recorded frames for ${sym} on ${replayDate}.`)
          return
        }
        const session = parseReplayFrames(j)
        if (!session) {
          setReplaySession(null)
          setReplayErr(`No recorded frames for ${sym} on ${replayDate}.`)
          return
        }
        setReplaySession(session)
        // Land on the LAST sweep: coming off a live card, the most recent
        // snapshot is the nearest thing to what was just on screen. Scrub back.
        setReplayIdx(Math.max(0, tlTimelineOf(session.frames).length - 1))
      } catch {
        if (!cancelled) {
          setReplaySession(null)
          setReplayErr('Could not load frames.')
        }
      } finally {
        if (!cancelled) setReplayLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [replayOn, replayDate, sym])

  const replayTimeline = useMemo<number[]>(
    () => (replaySession ? tlTimelineOf(replaySession.frames) : []),
    [replaySession],
  )
  const replayClock = replayTimeline.length
    ? replayTimeline[Math.min(replayIdx, replayTimeline.length - 1)]
    : null

  /** The last sweep AT OR BEFORE the clock — step-hold, never a future reading. */
  const replayFrame = useMemo<TlReplayFrame | null>(() => {
    if (!replaySession || replayClock == null) return null
    const cutoff = replayClock + 59_999
    let pick: TlReplayFrame | null = null
    for (const f of replaySession.frames) {
      if (f.t <= cutoff) pick = f
      else break
    }
    return pick
  }, [replaySession, replayClock])

  // Playback stops at the last step rather than looping — a session that
  // silently restarts reads as the tape jumping backwards.
  useEffect(() => {
    if (!replayPlaying || replayTimeline.length === 0) return
    const id = setInterval(() => {
      setReplayIdx((i) => {
        if (i >= replayTimeline.length - 1) {
          setReplayPlaying(false)
          return i
        }
        return i + 1
      })
    }, TL_REPLAY_BASE_MS / replaySpeed)
    return () => clearInterval(id)
  }, [replayPlaying, replaySpeed, replayTimeline.length])

  // ── Left pane feed ─────────────────────────────────────────────────────────
  const { tickers: scannerTickers } = useScannerTickers()
  const pickerOptions = [...new Set([...scannerTickers, ...QUICK, ...recent, sym])]

  const {
    data,
    loading,
    error,
    lastUpdated,
    reload: reloadChain,
  } = useLiveData<TlChainResp>(`/api/chains?ticker=${encodeURIComponent(sym)}`, 60_000)

  const groups = (data?.data?.items ?? []).filter((g) => typeof g['expiration-date'] === 'string')
  const expiries = groups.map((g) => String(g['expiration-date']))
  const spot = numOr(data?.data?.underlyingPrice)
  // An expiry the previous ticker had may not exist on this one — fall back to
  // the nearest rather than silently rendering an empty ladder.
  const activeExpiry = expiry != null && expiries.includes(expiry) ? expiry : (expiries[0] ?? null)
  const atmGroup = groups.find((g) => String(g['expiration-date']) === activeExpiry)

  const leftRows: TlRow[] = [...accumulateChainGreeks(data, activeExpiry).entries()]
    .map(([strike, g]) => ({ strike, gex: g.gex }))
    .filter((r) => Number.isFinite(r.gex) && r.gex !== 0)
    .sort((a, b) => a.strike - b.strike)

  // ── Right pane feed ────────────────────────────────────────────────────────
  // The symbol's real listing. Slow poll — a listing changes on the day a new
  // weekly is added, not minute to minute.
  const { data: expResp, reload: reloadExps } = useLiveData<TlExpResp>(
    `/api/expirations?ticker=${encodeURIComponent(sym)}`,
    900_000,
  )

  // EVERY listed expiry strictly after today, nearest first — no slice, no cap.
  // ISO dates compare correctly as strings, so `> today` drops both 0DTE and
  // anything stale the listing still carries.
  const boardExpiries = [
    ...new Set(
      (expResp?.data?.items ?? [])
        .map((it) => String(it['expiration-date'] ?? ''))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d > today),
    ),
  ].sort()
  // Joined, not the array — an array identity changes every render and would
  // restart the sweep on a loop.
  const boardKey = boardExpiries.join(',')

  const [board, setBoard] = useState<{ rows: TlRow[]; exps: number; sym: string }>({
    rows: [],
    exps: 0,
    sym: '',
  })
  const [bLoading, setBLoading] = useState(false)
  const [bError, setBError] = useState<string | null>(null)
  // Monotonic token: a ticker switch mid-sweep must not let the old symbol's
  // chains land in the new symbol's ladder.
  const sweepRef = useRef(0)

  const loadBoard = useCallback(async () => {
    const exps = boardKey ? boardKey.split(',') : []
    const mine = ++sweepRef.current
    if (!exps.length) {
      setBoard({ rows: [], exps: 0, sym })
      setBError(null)
      return
    }
    setBLoading(true)
    const acc = new Map<number, number>()
    let ok = 0
    let lastErr: string | null = null
    const queue = [...exps]

    const worker = async () => {
      while (queue.length) {
        const exp = queue.shift()
        if (!exp || sweepRef.current !== mine) return
        try {
          // The same call the Options Chain page makes for each of its columns —
          // range=all so the ladder is not cropped to a near-spot window.
          const res = await fetch(
            `/api/chains?ticker=${encodeURIComponent(sym)}&expiration=${encodeURIComponent(exp)}&range=all`,
            { cache: 'no-store' },
          )
          const json = (await res.json()) as { error?: string }
          if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
          for (const [strike, g] of accumulateChainGreeks(json).entries()) {
            acc.set(strike, (acc.get(strike) ?? 0) + g.gex)
          }
          ok++
        } catch (e) {
          // One dead expiry must not blank the board — count it out and say so
          // in the header rather than throwing the whole sweep away.
          lastErr = String(e)
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(BOARD_CONCURRENCY, exps.length) }, worker))
    } finally {
      if (sweepRef.current === mine) {
        const rows: TlRow[] = [...acc.entries()]
          .map(([strike, gex]) => ({ strike, gex }))
          .filter(
            (r) => Number.isFinite(r.strike) && r.strike > 0 && Number.isFinite(r.gex) && r.gex !== 0,
          )
          .sort((a, b) => a.strike - b.strike)
        setBoard({ rows, exps: ok, sym })
        setBError(ok === 0 ? lastErr : null)
        setBLoading(false)
      }
    }
  }, [sym, boardKey])

  useEffect(() => {
    // The board sweep is one request PER EXPIRATION and uncapped. Rewound, none
    // of it is on screen, so it is paused rather than hammering the proxy for a
    // pane that is showing a recording. The cheap chain/listing polls stay on so
    // leaving replay does not blank the card.
    if (replayOn) return
    void loadBoard()
    const id = setInterval(() => void loadBoard(), BOARD_REFRESH_MS)
    return () => clearInterval(id)
  }, [loadBoard, replayOn])

  // A ladder from a previous ticker is worse than none.
  const boardRows: TlRow[] = board.sym === sym ? board.rows : []

  // ── Right pane Δ column ────────────────────────────────────────────────────
  // One cheap call per ticker. It is a DAILY series — the recorder writes once
  // at 16:05 ET — so it polls on the hour rather than with the board, and the ↻
  // button does not bother refetching it either. The backend has already
  // differenced the two most recent snapshot dates; nothing here does arithmetic
  // on GEX.
  const { data: chgResp } = useLiveData<TlChangeResp>(
    `/api/eod-strike-gex-change?symbol=${encodeURIComponent(sym)}`,
    3_600_000,
  )
  // Gate on the symbol the payload came back FOR. A ticker switch leaves the
  // previous name's Δ in state for a beat, and a stale Δ hung off a fresh ladder
  // is worse than no Δ at all — the strikes overlap often enough (SPY 600 /
  // QQQ 600) that it would silently render as real.
  const chgOk =
    chgResp?.ok === true &&
    String(chgResp.symbol ?? '').toUpperCase() === sym &&
    (chgResp.rows?.length ?? 0) > 0
  const chgMap: Map<number, number> | null = chgOk
    ? new Map(
        (chgResp?.rows ?? []).flatMap((r) => {
          const k = Number(r.strike)
          const v = Number(r.chg)
          return Number.isFinite(k) && k > 0 && Number.isFinite(v) ? [[k, v] as [number, number]] : []
        }),
      )
    : null
  // Null until a SECOND session lands. With one snapshot every chg is 0 by
  // construction, and a column of zeros reads as "the board didn't move" rather
  // than "we don't know yet" — so the column stays off until it can say
  // something true.
  const chgBaseline = chgOk ? (chgResp?.prevDate ?? null) : null
  const rightChanges = chgBaseline ? chgMap : null

  // Fallback: the front expirations the base /api/chains payload already gave
  // us, today's dropped so the fallback obeys the same ex-0DTE rule. Summed per
  // strike ACROSS those expiries — accumulateChainGreeks takes one expiry at a
  // time, so the maps are merged here rather than growing a second formula.
  const boardIsFull = boardRows.length > 0
  const frontExpiries = expiries.filter((e) => e !== today)
  const frontAcc = new Map<number, number>()
  for (const e of frontExpiries) {
    for (const [strike, g] of accumulateChainGreeks(data, e).entries()) {
      frontAcc.set(strike, (frontAcc.get(strike) ?? 0) + g.gex)
    }
  }
  const frontRows: TlRow[] = [...frontAcc.entries()]
    .map(([strike, gex]) => ({ strike, gex }))
    .filter((r) => Number.isFinite(r.gex) && r.gex !== 0)
    .sort((a, b) => a.strike - b.strike)
  const rightRows = boardIsFull ? boardRows : frontRows

  // ── Live vs rewound: ONE swap, here ────────────────────────────────────────
  // Everything below this block — levels, walls, the drawn window, the chips,
  // the plain-language read — is computed from viewLeftRows / viewRightRows /
  // viewSpot and does not know which mode produced them. That is the whole of
  // replay: the SOURCE of the two ladders changes, nothing downstream does.

  // The session's 0DTE expiry: the one expiring ON the replayed date. A root
  // with no same-day listing that session falls back to its front recorded
  // expiry, so the right pane's ex-0DTE rule means the same thing either way.
  const replayZeroDte = replaySession
    ? replaySession.expiries.includes(replayDate)
      ? replayDate
      : (replaySession.expiries[0] ?? '')
    : ''
  const viewExpiries = replayOn && replaySession ? replaySession.expiries : expiries
  const viewActiveExpiry =
    replayOn && replaySession
      ? expiry != null && replaySession.expiries.includes(expiry)
        ? expiry
        : (replaySession.expiries[0] ?? null)
      : activeExpiry

  const replayBoardExps = useMemo(
    () => (replaySession ? replaySession.expiries.filter((e) => e !== replayZeroDte) : []),
    [replaySession, replayZeroDte],
  )

  // The fixed ladder axes, memoised on the SESSION — not rebuilt per frame.
  // Walking every frame's cells is cheap once and wasteful sixty times a minute
  // at 8× playback. Keyed by joined strings because the expiry arrays are
  // rebuilt each render and their identity would defeat the memo.
  const leftAxisKey = viewActiveExpiry ?? ''
  const leftAxis = useMemo(
    () => (replaySession && leftAxisKey ? tlSessionAxis(replaySession.frames, [leftAxisKey]) : []),
    [replaySession, leftAxisKey],
  )
  const boardAxisKey = replayBoardExps.join(',')
  const rightAxis = useMemo(
    () =>
      replaySession && boardAxisKey ? tlSessionAxis(replaySession.frames, boardAxisKey.split(',')) : [],
    [replaySession, boardAxisKey],
  )

  const replayLeft =
    replayOn && replayFrame && leftAxisKey && leftAxis.length
      ? tlReplayRows(replayFrame, leftAxis, [leftAxisKey])
      : null
  const replayRight =
    replayOn && replayFrame && replayBoardExps.length && rightAxis.length
      ? tlReplayRows(replayFrame, rightAxis, replayBoardExps)
      : null

  // Rewound, this is the spot RECORDED at that sweep — the live quote would put
  // today's price on a past session's ladder.
  const viewSpot = replayOn ? (replayFrame && replayFrame.spot > 0 ? replayFrame.spot : null) : spot
  const viewLeftRows = replayOn ? (replayLeft?.rows ?? []) : leftRows
  const viewRightRows = replayOn ? (replayRight?.rows ?? []) : rightRows

  const leftLevels = tlLevelsFrom(viewLeftRows, viewSpot)
  // Both panes compute their levels the same way, off ladders built by the same
  // function — no second opinion from a second data source to reconcile.
  const rightLevels = tlLevelsFrom(viewRightRows, viewSpot)
  // ± Move and ATM IV are priced off live marks; nothing in the recording can
  // reconstruct them, so they read "—" while rewound instead of putting today's
  // premium on a three-day-old ladder.
  const atm = replayOn ? { move: null, iv: null } : tlAtm(atmGroup, spot ?? 0)
  const positiveGamma = rightLevels.net >= 0

  const leftAnchor = useTlAnchor(
    viewLeftRows,
    viewSpot,
    `${sym}|L|${leftAxisKey}|${replayOn ? 'r' : 'l'}`,
  )
  const rightAnchor = useTlAnchor(
    viewRightRows,
    viewSpot,
    `${sym}|R|${boardAxisKey}|${replayOn ? 'r' : 'l'}`,
  )

  const leftLadder = tlWindow(viewLeftRows, leftAnchor ?? viewSpot)
  const rightLadder = tlWindow(viewRightRows, rightAnchor ?? viewSpot)
  const hasAny = leftLadder.length > 0 || rightLadder.length > 0

  // Rewound, the live chain's loading/error state is irrelevant — the replay bar
  // reports its own, and blocking on a live fetch would hide a session that
  // loaded fine.
  const gateLoading = replayOn ? replayLoading : loading
  const gateError = replayOn ? replayErr || null : (error ?? data?.error ?? null)
  const gateEmpty = replayOn
    ? `No recorded ladder for ${sym}${replayDate ? ` on ${replayDate}` : ''}.`
    : `No live option chain for ${sym}.`

  // What the right pane ACTUALLY covers — the count of expiries whose chain came
  // back, not the count requested. Nothing is capped, so a number below the
  // listing means a chain call failed, and the header says which rather than
  // implying a complete sweep.
  //
  // Rewound, the same rule: the count is the expiries IN THE PROFILE ON SCREEN,
  // not the session's recorded expiry list. Those differ whenever a sweep skipped
  // an expiry the session recorded elsewhere, and the session count would then
  // describe the recording rather than the ladder beside it.
  const replayBoardUsed = replayRight?.used.length ?? 0
  const boardLabel = replayOn
    ? replayBoardUsed
      ? `${replayBoardUsed} expiration${replayBoardUsed === 1 ? '' : 's'} · excl. 0DTE${replayZeroDte ? ` (${replayZeroDte})` : ''} · recorded walls only`
      : replayBoardExps.length
        ? `no expirations past 0DTE in this sweep · ${replayBoardExps.length} recorded this session`
        : 'no recorded expirations past 0DTE this session'
    : boardIsFull
      ? [
          `${board.exps} expiration${board.exps === 1 ? '' : 's'} · excl. 0DTE`,
          boardExpiries.length > board.exps
            ? `of ${boardExpiries.length} listed — ${boardExpiries.length - board.exps} chain call(s) failed`
            : 'whole board',
        ].join(' · ')
      : bLoading
        ? 'sweeping the board…'
        : `${frontExpiries.length} front expirations · excl. 0DTE · full board unavailable`

  // One button, whole card: the base chain, the listing, and the board sweep.
  const refresh = useRefreshButton(
    useCallback(async () => {
      await Promise.all([reloadChain(), reloadExps(), loadBoard()])
    }, [reloadChain, reloadExps, loadBoard]),
  )

  const replayBase = replayOn && replayDate ? replayDate : today

  return (
    <AnalysisCard span={!embedded} height="auto">
      {/* Controls: ticker menu, one refresh for the whole card, the replay
          toggle, and the mark. The identity line that used to sit up here moved
          DOWN to rest directly on top of the ladders — see below. */}
      <Row style={{ flexWrap: 'wrap', justifyContent: 'flex-end', rowGap: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ minWidth: 132 }}>
            <TickerPicker
              value={sym}
              options={pickerOptions}
              custom={recent}
              onSelect={lookup}
              onAdd={lookup}
              onRemove={forget}
            />
          </div>
          <button
            onClick={() => void refresh.trigger()}
            style={refresh.style}
            title="Re-fetch the chain, the listing and the whole-board sweep"
          >
            {refresh.label}
          </button>
          <button
            onClick={() => setReplayOn((v) => !v)}
            title="Replay — scrub both ladders back through a recorded session (recorded walls only, ~5 trading days)"
            style={{
              ...(replayOn ? btn : btnSecondary),
              ...(replayOn
                ? { background: V2.orange, borderColor: V2.orange, color: V2.ink }
                : { color: V2.orange }),
              fontWeight: 800,
            }}
          >
            ⏱ Replay
          </button>
          {/* crossOrigin so html2canvas exports bake the logo in rather than
              tainting the canvas — the same handling the footer uses. */}
          <img
            src="/cb-edge-logo.png"
            alt="CB Edge"
            crossOrigin="anonymous"
            style={{ height: 28, width: 'auto', display: 'block', flexShrink: 0, opacity: 0.95, marginLeft: 2 }}
          />
        </span>
      </Row>

      {/* Quick row + whatever was looked up last. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[...QUICK, ...recent.filter((r) => !QUICK.includes(r))].map((s) => (
          <button key={s} onClick={() => lookup(s)} style={s === sym ? btn : btnSecondary}>
            {s}
          </button>
        ))}
      </div>

      {/* The replay transport DOCKS to the bottom of the page — v2's ES Candles
          shape, applied to every replay surface in v3. It renders here in the
          React tree (this card owns the state it drives) and lands there in the
          DOM; a portal moves one and not the other.

          The dock is in FLOW, so it shrinks the page rather than covering the
          bottom of these ladders. That matters here specifically: the ladders
          look exactly like the live ones, so "recorded walls only" has to be
          readable or an em-dashed rung reads as a broken card. */}
      {replayOn && (
        <ReplayDock>
        <div
          style={{
            // No plate of its own. The transport lives in the page's REPLAY
            // DOCK now (design/primitives/ReplayDock.tsx) — bottom of the page,
            // in flow, orange, the shape v2's ES Candles transport takes — and
            // the dock is what draws the orange.
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            flex: 1,
            minWidth: 0,
            fontSize: FS.small,
            color: V2.text,
          }}
        >
          <span
            style={{
              fontWeight: 900,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: V2.orange,
              flexShrink: 0,
            }}
          >
            Replay
          </span>

          <select
            value={replayDate}
            onChange={(e) => {
              setReplayPlaying(false)
              setReplayDate(e.target.value)
            }}
            disabled={!replayDates.length}
            style={{
              padding: '3px 6px',
              fontSize: FS.small,
              fontWeight: 800,
              fontFamily: 'var(--font-mono)',
              background: V2W.panelBgStrong,
              color: V2.cyan,
              border: `1px solid ${V2W.border}`,
              borderRadius: 6,
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            {replayDates.length === 0 && <option value="">—</option>}
            {replayDates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          <button
            onClick={() => {
              setReplayPlaying(false)
              setReplayIdx((i) => Math.max(0, i - 1))
            }}
            disabled={replayIdx <= 0}
            title="Previous minute"
            style={{ ...replayBtn(false), opacity: replayIdx > 0 ? 1 : 0.4 }}
          >
            ◀
          </button>
          <button
            onClick={() => {
              // Playing from the end shows one step and stops, which reads as
              // broken — rewind to the start first.
              if (replayIdx >= replayTimeline.length - 1) setReplayIdx(0)
              setReplayPlaying((p) => !p)
            }}
            disabled={replayTimeline.length < 2}
            title="Play / pause"
            style={{
              ...replayBtn(replayPlaying),
              padding: '0 12px',
              opacity: replayTimeline.length > 1 ? 1 : 0.4,
            }}
          >
            {replayPlaying ? '❚❚' : '▶'}
          </button>
          <button
            onClick={() => {
              setReplayPlaying(false)
              setReplayIdx((i) => Math.min(replayTimeline.length - 1, i + 1))
            }}
            disabled={replayIdx >= replayTimeline.length - 1}
            title="Next minute"
            style={{ ...replayBtn(false), opacity: replayIdx < replayTimeline.length - 1 ? 1 : 0.4 }}
          >
            ▶
          </button>

          <input
            type="range"
            min={0}
            max={Math.max(0, replayTimeline.length - 1)}
            value={Math.min(replayIdx, Math.max(0, replayTimeline.length - 1))}
            disabled={replayTimeline.length < 2}
            onChange={(e) => {
              setReplayPlaying(false)
              setReplayIdx(Number(e.target.value))
            }}
            style={{ flex: 1, minWidth: 180, height: 3, accentColor: V2.orange }}
          />

          <span style={{ fontSize: FS.micro, fontWeight: 700, opacity: 0.6 }}>Speed</span>
          {TL_REPLAY_SPEEDS.map((sp) => (
            <button
              key={sp}
              onClick={() => setReplaySpeed(sp)}
              style={{ ...replayBtn(replaySpeed === sp), height: 22, padding: '0 7px', fontSize: FS.micro }}
            >
              {sp}×
            </button>
          ))}

          <span style={{ color: V2W.border }}>|</span>

          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 900 }}>
            {replayClock != null ? `${fmtTlReplayClock(replayClock)} ET` : '--:--'}
          </span>
          <span style={{ opacity: 0.55 }}>
            {replayTimeline.length
              ? `${Math.min(replayIdx, replayTimeline.length - 1) + 1} / ${replayTimeline.length}`
              : ''}
          </span>

          {replayLoading && <span style={{ color: V2.cyan, fontWeight: 700 }}>loading…</span>}
          {!!replayErr && <span style={{ color: V2.red, fontWeight: 700 }}>{replayErr}</span>}
          {!replayLoading && !replayErr && replayTimeline.length > 0 && (
            <span style={{ opacity: 0.55 }}>
              · recorded walls only · sweeps held to the minute · ± Move, ATM IV and Δ 1D off while
              rewound
            </span>
          )}
        </div>
        </ReplayDock>
      )}

      {gateLoading || gateError || !hasAny ? (
        <CardState loading={gateLoading} error={gateError} empty={gateEmpty} />
      ) : (
        <>
          {/* ── The identity line ────────────────────────────────────────────
              Everything that says WHAT is on screen: the card name, the symbol,
              spot, the gamma regime, ticker + expiry + DTE, the session date and
              the replay clock. Nothing else.

              It sits HERE — below the replay transport, directly on top of the
              ladders — and not in the card header, because this is the line a
              screen capture has to contain. Cropping to the ladders now picks it
              up; in the header it was one scroll or one crop away from being
              left out. It also reads in the right order: the controls change
              what is drawn, this states what got drawn. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
              paddingBottom: 10,
              borderBottom: `1px solid ${V2W.border}`,
            }}
          >
            <span
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 10,
                flexWrap: 'wrap',
                minWidth: 0,
              }}
            >
              <span
                style={{
                  fontSize: FS.label,
                  fontWeight: 800,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: V2.cyan,
                }}
              >
                Ticker Lookup
              </span>
              <span style={{ fontSize: FS.lead, fontWeight: 800, color: V2.text }}>${sym}</span>
              <span
                style={{ fontSize: FS.caption, fontFamily: 'var(--font-mono)', color: V2.text, opacity: 0.6 }}
              >
                GEX levels
              </span>

              <Value color={V2.text} size={FS.lead}>
                {viewSpot == null
                  ? '—'
                  : viewSpot.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </Value>

              {/* Driven by the RIGHT pane — the whole board is the regime that
                  actually governs how dealers hedge. */}
              <span
                style={{
                  fontSize: FS.small,
                  fontWeight: 800,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: positiveGamma ? V2.pos : V2.red,
                  border: `1px solid ${positiveGamma ? V2.pos : V2.red}`,
                  borderRadius: 999,
                  padding: '3px 10px',
                }}
              >
                {positiveGamma ? 'Positive gamma' : 'Negative gamma'}
              </span>

              {/* DTE counts from the REPLAYED date while rewound, same rule as
                  the expiry pills — off today it would label the wrong one. */}
              <span
                style={{
                  fontSize: FS.small,
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: V2.text,
                  opacity: 0.78,
                }}
              >
                {[
                  sym,
                  viewActiveExpiry ? tlExpiryChip(viewActiveExpiry, replayBase) : null,
                  replayOn ? replayDate || null : today,
                  replayOn && replayClock != null ? `${fmtTlReplayClock(replayClock)} ET` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
          </div>

          {/* The split: picked expiry | whole board.
              FIXED HEIGHT, deliberately. The chip row under each ladder is the
              thing being read at a glance, and it used to slide down the page
              every time the ladder above it gained a rung — a different number
              of strikes on the left than the right, and the two panes' chips did
              not even line up with each other. The pane height is now fixed, the
              LADDER scrolls inside it, and the chips are pinned to the bottom.
              Ladder length no longer moves anything.

              minmax(0,1fr) + minHeight:0 on each pane is what actually hands the
              overflow to the ladder scrollers. A grid item's automatic minimum
              size is its CONTENT — without it the panes ignore the fixed height,
              grow to the full ladder, and paint straight over "The read". */}
          <div
            className="tl-split"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gridTemplateRows: 'minmax(0, 1fr)',
              gap: 14,
              alignItems: 'stretch',
              height: `clamp(${SPLIT_MIN_H}px, 86vh, 1500px)`,
            }}
          >
            {/* LEFT — one expiration */}
            <div
              style={{
                border: `1px solid ${V2W.border}`,
                borderRadius: 14,
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                minWidth: 0,
                minHeight: 0,
              }}
            >
              <Row style={{ flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: FS.caption,
                    fontWeight: 800,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: V2.cyan,
                  }}
                >
                  By expiration
                </span>
                <Stat
                  label="Net GEX"
                  value={fmtBig(leftLevels.net)}
                  color={leftLevels.net >= 0 ? V2.pos : V2.red}
                  size={FS.compact}
                />
              </Row>

              {/* Rewound, the pills are the expiries the SESSION recorded and
                  their DTE counts from the replayed date — labelling them off
                  today would mark the wrong pill "0DTE". */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {viewExpiries.map((e) => (
                  <button
                    key={e}
                    onClick={() => setExpiry(e)}
                    style={viewActiveExpiry === e ? btn : btnSecondary}
                  >
                    {tlExpiryChip(e, replayBase)}
                  </button>
                ))}
              </div>

              {/* ATM premium for the PICKED expiry, which is what this pane is. */}
              <span
                style={{ fontSize: FS.small, fontFamily: 'var(--font-mono)', color: V2.text, opacity: 0.6 }}
              >
                {`± Move ${atm.move == null ? '—' : `±${atm.move.toFixed(2)}`} · ATM IV ${atm.iv == null ? '—' : `${(atm.iv * 100).toFixed(1)}%`}`}
              </span>

              {/* The ONLY thing that scrolls in this pane. minHeight:0 is what
                  lets it actually shrink inside the flex column instead of
                  pushing the chips out the bottom. */}
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
                {leftLadder.length === 0 ? (
                  <Placeholder>
                    {replayOn
                      ? 'Nothing recorded on this expiry in this session.'
                      : 'No populated strikes on this expiry.'}
                  </Placeholder>
                ) : (
                  <TlLadder
                    rows={leftLadder}
                    spot={viewSpot}
                    anchor={leftAnchor}
                    levels={leftLevels}
                    missing={replayLeft?.missing ?? null}
                  />
                )}
              </div>

              <div style={CHIP_ROW}>
                <LevelChip
                  name="Core (CB)"
                  value={leftLevels.core}
                  spot={viewSpot}
                  color={LEVEL_COLORS.cb}
                  note="biggest magnet"
                />
                <LevelChip
                  name="Call wall"
                  value={leftLevels.callWall}
                  spot={viewSpot}
                  color={LEVEL_COLORS.cw}
                  note="ceiling"
                />
                <LevelChip
                  name="Put wall"
                  value={leftLevels.putWall}
                  spot={viewSpot}
                  color={LEVEL_COLORS.pw}
                  note="floor"
                />
              </div>
            </div>

            {/* RIGHT — every listed expiration except today's (never 0DTE) */}
            <div
              style={{
                border: `1px solid ${V2W.border}`,
                borderRadius: 14,
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                minWidth: 0,
                minHeight: 0,
              }}
            >
              <Row style={{ flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: FS.caption,
                    fontWeight: 800,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: V2.cyan,
                  }}
                >
                  All expirations · ex-0DTE
                </span>
                <Stat
                  label="Net GEX"
                  value={fmtBig(rightLevels.net)}
                  color={rightLevels.net >= 0 ? V2.pos : V2.red}
                  size={FS.compact}
                />
              </Row>

              {/* What this ladder actually covers. It belongs here, beside the
                  ladder it captions — not on the identity line. Orange while the
                  pane is on the FALLBACK, because a fallback must never read as
                  the whole board. */}
              <span
                style={{
                  fontSize: FS.small,
                  fontFamily: 'var(--font-mono)',
                  color: replayOn || boardIsFull ? V2.text : V2.orange,
                  opacity: replayOn || boardIsFull ? 0.6 : 0.85,
                }}
              >
                {boardLabel}
              </span>

              {/* What the Δ column is measured against, said out loud. The
                  baseline is the previous SNAPSHOT date, which after a holiday or
                  a missed run is not calendar yesterday — printing it is the
                  difference between a trustworthy column and a mystery one.

                  Both the column and this caption are off while rewound: the Δ
                  is an end-of-day series and has nothing to say about an
                  intraday clock. */}
              {!replayOn && (
                <span
                  style={{
                    fontSize: FS.small,
                    fontFamily: 'var(--font-mono)',
                    color: V2.text,
                    opacity: 0.6,
                  }}
                >
                  {chgBaseline
                    ? `Δ 1D vs close ${chgBaseline}`
                    : chgOk
                      ? 'Δ 1D — first snapshot recorded, baseline lands next session'
                      : 'Δ 1D — no end-of-day history yet'}
                </span>
              )}

              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
                {rightLadder.length === 0 ? (
                  <CardState
                    loading={replayOn ? replayLoading : bLoading}
                    error={replayOn ? replayErr || null : bError}
                    empty={
                      replayOn
                        ? 'Nothing recorded past 0DTE in this session.'
                        : 'No board-wide ladder yet (nothing listed past 0DTE).'
                    }
                  />
                ) : (
                  <TlLadder
                    rows={rightLadder}
                    spot={viewSpot}
                    anchor={rightAnchor}
                    levels={rightLevels}
                    changes={replayOn ? null : rightChanges}
                    missing={replayRight?.missing ?? null}
                  />
                )}
              </div>

              <div style={CHIP_ROW}>
                <LevelChip
                  name="Core (CB)"
                  value={rightLevels.core}
                  spot={viewSpot}
                  color={LEVEL_COLORS.cb}
                  note="biggest magnet"
                />
                <LevelChip
                  name="Call wall"
                  value={rightLevels.callWall}
                  spot={viewSpot}
                  color={LEVEL_COLORS.cw}
                  note="ceiling"
                />
                <LevelChip
                  name="Put wall"
                  value={rightLevels.putWall}
                  spot={viewSpot}
                  color={LEVEL_COLORS.pw}
                  note="floor"
                />
              </div>
            </div>
          </div>

          {/* Plain-language read — the WHOLE BOARD, which is the regime that
              actually governs how dealers hedge. */}
          <div
            style={{
              border: `1px solid ${V2W.border}`,
              borderRadius: 10,
              padding: '10px 12px',
              background: V2W.wash03,
              fontSize: FS.body,
              lineHeight: 1.6,
              color: V2.text,
            }}
          >
            <span style={{ fontWeight: 800, color: V2.cyan }}>The read: </span>
            {positiveGamma
              ? 'Net positive gamma across the board — dealers sell rallies and buy dips, so price tends to pin and mean-revert. '
              : 'Net negative gamma across the board — dealers chase in both directions, so moves extend and volatility feeds itself. '}
            {rightLevels.core != null && `Core magnet ${rightLevels.core.toLocaleString()}. `}
            {rightLevels.callWall != null && `Call wall ${rightLevels.callWall.toLocaleString()}. `}
            {rightLevels.putWall != null && `Put wall ${rightLevels.putWall.toLocaleString()}. `}
            {/* The flip is NOT a chip — it lives only here. */}
            {rightLevels.flip != null &&
              `Gamma flip ${rightLevels.flip.toLocaleString('en-US', { maximumFractionDigits: 2 })} — pinning above, trending below.`}
          </div>

          <span
            style={{
              fontSize: FS.small,
              color: V2.text,
              opacity: 0.45,
              fontFamily: 'var(--font-mono)',
            }}
          >
            {replayOn
              ? `OI+Vol basis · recorded strike_growth sweeps${replayDate ? ` for ${replayDate}` : ''} · walls only, not the whole ladder · educational only, not investment advice`
              : "OI+Vol basis · left pane shares Multi Greek's formula · right pane is the server full-board sweep · educational only, not investment advice"}
          </span>
        </>
      )}

      {/* The live fetch stamp says nothing about a rewound card — the replay
          bar's own clock is the timestamp that matters there. */}
      {!replayOn && <UpdatedStamp at={lastUpdated} />}
    </AnalysisCard>
  )
}
