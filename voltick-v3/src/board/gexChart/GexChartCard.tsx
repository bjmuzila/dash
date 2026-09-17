import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChartFrame, type ChartHandle } from '@/design/primitives/ChartFrame'
import { CardToolbar } from '@/design/primitives/Card'
import { Chip, SegGroup, SegMenu } from '@/design/primitives/Controls'
import { useQuery } from '@/data/api'
import { watchFrame } from '@/data/hooks'
import { SOCKET_SYMBOL, isSocketSymbol, usePageSymbol } from '@/data/symbol'
import type { GexData, GexFrame, GexRow, SpotFrame } from '@/contract/frames'
import { chainGexUrl, chainToGex, EMPTY_CHAIN_GEX } from '../chainGex'
import { EMPTY_MODEL, mountGexChart, type GexChartHandle, type GexChartModel } from './gexChartRender'
import { BASIS_LABEL, SERIES_LABEL, flowSupported, fmtGexShort, totalDex, totalNet } from './values'
import {
  loadSettings,
  metricOfSeries,
  saveSettings,
  scopeOfSeries,
  type GexBasis,
  type GexChartSettings,
  type GexSeries,
} from './settings'
import { DeltaStatCards, StatCards } from './StatCards'
import type { GexLevelsRow, GexMultiLadder } from '@/pages/scanner/gexLevels'
import { GEX_MULTI_POLL_MS, multiDeltaAllZero, scopeNoteEx0dte } from '@/pages/scanner/gexLevels'
import { loadGexByStrikeMulti } from '@/pages/scanner/gexLevelsData'

// ─────────────────────────────────────────────────────────────────────────────
// GEX Chart — v2's home-page chart, as a board card.
//
// v2 drives its chart entirely through PROPS from the home page's own toolbar:
// `mode`, `dataMode`, `showDex`, the expiry label and the row of stat cards all
// live on the page, not in the chart. v3 has no home page to hang them on, so
// the card owns them — the toolbar, the cog, the ten tiles and the settings
// blob that remembers all of it are here.
//
// The chart itself — pan, zoom, y-scale, recentre, the bar gradients, the DEX
// line, the core badge — is gexChartRender.ts, which owns its canvas and its
// listeners. A pan is sixty pointer events a second; none of them reach React.
//
// ── The controls ─────────────────────────────────────────────────────────────
//   SERIES  which LADDER the bars are — γ or Δ, today's expiry or the book
//   BASIS   OI+VOL · VOL · FLOW — which contracts the bars are priced on
//   SPLIT   NET · C/P          — one net bar, or the call and put legs
//   DEX     the net-delta overlay line, on its own normalised scale
//   CARDS   the stat row above the chart — all ten, or none
//
// ── The three added series ───────────────────────────────────────────────────
// γ EX-0DTE, Δ 0DTE and Δ EX-0DTE are the scanner's GEX Levels cards 8, 10 and
// 11, drawn through THIS renderer rather than their own small SVGs. Same rows —
// the ex-0DTE pair reads /proxy/gex-by-strike-multi through
// pages/scanner/gexLevelsData, the same loader and the same 60s cadence the
// scanner tab uses — so the board and the tab cannot disagree about the book.
//
// SPX ONLY, and disabled rather than hidden off it: the multi-expiry sweep is
// server-side per symbol and the delta legs only exist on the socket feed and
// that endpoint. See GexSeries in settings.ts. The stat row follows: a delta
// ladder gets DeltaStatCards, because seven of the gamma row's ten tiles are
// gamma facts with no delta equivalent.
//
// All four are chips because each is one click and each changes what the BARS
// are. CARDS used to be a cog holding ten individual switches; the row shares
// its width evenly, so hiding one tile only made the other nine wider, and a
// stored subset meant no two boards showed the same row. It is one chip now.
//
// ── The four LEVEL tiles now match Key Levels ────────────────────────────────
// Call Wall / Put Wall / Flip / CB come out of data/levels.ts — the same
// derivation the Key Levels card draws — read on the basis this card is on.
// They used to be derived here on volume alone while Key Levels used OI+VOL, so
// one board printed two different CALL WALLs under one name. See values.ts.
//
// ── Two sources, one shape ───────────────────────────────────────────────────
// SPX comes off the socket. Any other page symbol comes from /api/chains
// through board/chainGex.ts, which produces the identical row shape. Spot
// follows the same split: the `spot` frame for SPX (the live print, which the
// gex frame does not carry), the chain's own underlyingPrice otherwise. The
// EXPIRY follows it too — the socket publishes which one it is streaming, and
// the chain path reports the front expiry it picked.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One settings blob for the card type, not per placed instance.
 *
 * Two GEX Charts on one board therefore share a basis. That is the same choice
 * GEX Candles made, and for the same reason: the id a board item carries is a
 * catalog id, and there is no per-instance key to hang a second blob on without
 * inventing one.
 */
const CARD_ID = 'gex-chart'

/**
 * ONE empty array, not a fresh one per call.
 *
 * `view` bails out of a re-render by reference-comparing its rows, and a new
 * `[]` on every empty push would defeat that on exactly the path where it
 * matters most — a symbol with no data yet, being polled.
 */
const EMPTY_ROWS: GexRow[] = []

/**
 * How often a SPOT tick is allowed to refresh the stat tiles.
 *
 * The tiles are React and the chart is a canvas, so a spot frame always
 * repaints the chart and only sometimes re-renders the row. One second: fast
 * enough that a wall which price has just traded through moves while you are
 * looking at it, slow enough that a 10Hz topic costs one render a second rather
 * than ten. See the block on `view` below.
 */
const TILE_SPOT_MS = 1000

/**
 * The slim ladder, widened to the row shape the chart and the tiles read.
 *
 * /proxy/gex-by-strike-multi ships five fields per strike — everything a NET
 * ladder needs — and the rest of `GexRow` is filled with zeros. That is not a
 * loss: the split, the flow basis and the CB badge all test the rows for the
 * legs they need and refuse rather than drawing zeros (see `sideLegsSupported`
 * and `flowSupported` in values.ts), so a zero here can never be mistaken for a
 * measurement.
 */
function widenMultiRows(rows: GexLevelsRow[]): GexRow[] {
  return rows.map((r) => ({
    strike: r.strike,
    netGEX: r.netGEX,
    netVolGEX: r.netVolGEX,
    callGEX: r.callGEX,
    putGEX: r.putGEX,
    callOI: r.callOI,
    putOI: r.putOI,
    callVolume: 0,
    putVolume: 0,
    callGamma: 0,
    putGamma: 0,
    dte: 0,
    netDEX: r.netDEX,
    volNetDEX: r.volNetDEX ?? 0,
  }))
}

/** What the card keeps of /proxy/gex-by-strike-multi — the ex-0DTE half of it. */
interface MultiState {
  ladder: GexMultiLadder | null
  /** The sweep's own spot. Used only until a live tick arrives. */
  spot: number
  /** Every listed expiration INCLUDING 0DTE — `scopeNoteEx0dte` subtracts one. */
  expiryCount: number
  loading: boolean
  err: string | null
}

const EMPTY_MULTI: MultiState = { ladder: null, spot: 0, expiryCount: 0, loading: false, err: null }

/** What each series answers, for the switch's tooltips. */
const SERIES_TITLE: Record<GexSeries, string> = {
  'gamma-0dte': 'Dealer gamma at each strike on the expiry the feed is streaming — the live pin',
  'gamma-ex0dte':
    'Dealer gamma summed across every listed expiration EXCEPT 0DTE — the standing book behind today’s pin. Its own flip and its own walls, which are not meant to match the 0DTE ones',
  'delta-0dte': 'Dealer DELTA at each strike on today’s chain — which way delta leans, and where it turns',
  'delta-ex0dte': 'Dealer DELTA across the standing book, 0DTE excluded',
}

export interface GexChartCardProps {
  /**
   * The stripped-down card: SPX only, OI+VOL / VOL only, one net bar, no DEX
   * line and no stat row. For the phone build (/v3/m/gex).
   *
   * WHY EACH ONE GOES.
   *   FLOW    is a third basis whose answer is a different question, and the
   *           two that are left are the two anyone switches between.
   *   C/P     doubles the bar count in a plot ~380px wide. The split is a
   *           desktop read.
   *   DEX     is a second series on a second scale over that same plot.
   *   CARDS   is ten tiles sharing the width of a phone — three characters
   *           each, and the chart loses the height they take.
   *
   * The stored settings are NOT rewritten. The same browser profile opens this
   * card on a desktop and must find its basis, split, DEX and cards exactly as
   * it left them; this only changes what is DRAWN, the way `railOn` already
   * does on the candles card.
   */
  simple?: boolean
}

export function GexChartCard({ simple = false }: GexChartCardProps = {}) {
  const { symbol: pageSymbol } = usePageSymbol()
  // Pinned, not defaulted: SPX is the only symbol the socket streams, and the
  // phone screen is meant to be the live one rather than a 15s chain poll.
  const symbol = simple ? SOCKET_SYMBOL : pageSymbol
  const onSocket = isSocketSymbol(symbol)

  const [stored, setSettings] = useState<GexChartSettings>(() => loadSettings(CARD_ID))
  // What this render actually uses. `patch` still writes `stored`.
  const settings: GexChartSettings = simple
    ? {
        ...stored,
        // A stored FLOW does not survive here — there is no third button to
        // show it on, and a selected value with no control is the thing the
        // card's own comment calls a control that lies.
        basis: stored.basis === 'flow' ? 'oi-vol' : stored.basis,
        // Same rule for the series switch: the phone card is the live 0DTE
        // gamma ladder, and the other three each need either a board sweep or
        // a second stat row on a 390px screen.
        series: 'gamma-0dte',
        split: 'net',
        showDex: false,
        cardsOn: false,
      }
    : stored

  /**
   * WHAT IS ACTUALLY DRAWN, which is not always what is stored.
   *
   * The three added series are SPX-only (see GexSeries). Off the socket symbol
   * the stored choice is kept — it comes back intact the moment the board is
   * back on SPX — but the card draws the live gamma ladder and the switch says
   * why, which is the same treatment FLOW gets on a chain-derived ticker.
   */
  const seriesOff = !onSocket
  const series: GexSeries = seriesOff ? 'gamma-0dte' : settings.series
  const metric = metricOfSeries(series)
  const scope = scopeOfSeries(series)
  const wantMulti = scope === 'ex0dte'
  const barsAreDex = metric === 'dex'
  /** Neither a delta ladder nor a server-summed one has per-side legs to draw. */
  const splitOff = barsAreDex || wantMulti

  const patch = useCallback((p: Partial<GexChartSettings>) => {
    setSettings((prev: GexChartSettings) => {
      const next = { ...prev, ...p }
      saveSettings(CARD_ID, next)
      return next
    })
  }, [])

  /**
   * ── What React IS allowed to re-render on ──────────────────────────────────
   * The rows themselves never go through state — they are a ref the renderer
   * reads. But the ten tiles are React, and they need the ladder. So the card
   * keeps ONE piece of state for them: the current rows and spot, set from the
   * same push() the chart is fed from.
   *
   * That is a re-render per LADDER, which is once every few seconds — never per
   * spot tick. `spot` is a 10Hz topic; if a tick refreshed the tiles, ten
   * strike-comparisons × ten tiles would run sixty times for every one time the
   * numbers actually changed. So the spot watcher repaints the CHART (which is
   * imperative and cheap) and mostly leaves this state alone.
   *
   * MOSTLY, not entirely — and that word is a fix, not a hedge. The claim this
   * block used to make was that a gex frame is "the only cadence at which a
   * wall can actually move", and it is not: BOTH walls are defined strictly
   * above and strictly below SPOT, so price crossing a strike relocates one of
   * them with no new ladder involved at all. server-v2 dedupes the `gex` frame
   * — an unchanged chain broadcasts nothing — so on a quiet ladder the tiles
   * could sit for minutes with a call wall that price had already traded
   * through, which is the "not updating" this card was reported for.
   *
   * So a spot tick DOES sync the tiles, at most once every TILE_SPOT_MS. That
   * is one re-render a second against sixty, and it is bounded by wall clock
   * rather than by how chatty the feed happens to be.
   */
  const [view, setView] = useState<{ rows: GexRow[]; spot: number; expiry: string }>({
    rows: EMPTY_ROWS,
    spot: 0,
    expiry: '',
  })

  // ── The whole-board ladder, for the two ex-0DTE series ─────────────────────
  // Its own request, at the endpoint's own cadence: /proxy/gex-by-strike-multi
  // is one upstream fetch PER EXPIRATION and the server caches the body ~60s,
  // so it does not ride the socket and it does not ride the 15s chain poll.
  //
  // Fetched ONLY while an ex-0DTE series is selected. A board sweep every
  // minute for a series nobody has picked is the cost this gate exists for; the
  // effect fires immediately on the way in, so picking the series is not a
  // 60-second wait.
  const [multi, setMulti] = useState<MultiState>(EMPTY_MULTI)
  const multiFlip = multi.ladder?.gexFlip ?? null
  /**
   * Memoised on the LADDER, not on `multi` — a poll that returns an unchanged
   * body still produces a new state object, and `push` bails out of a re-render
   * by reference-comparing the rows it is handed.
   */
  const multiRows = useMemo<GexRow[]>(
    () => (multi.ladder?.rows.length ? widenMultiRows(multi.ladder.rows) : EMPTY_ROWS),
    [multi.ladder],
  )

  useEffect(() => {
    if (!wantMulti || !onSocket) {
      // Deliberately NOT cleared: coming back to the series should show the
      // last good book under the refreshing state rather than an empty pane,
      // and a stale minute on a standing book is not a stale minute on a tick.
      return
    }
    let alive = true
    const run = () => {
      setMulti((prev) => ({ ...prev, loading: true }))
      loadGexByStrikeMulti(SOCKET_SYMBOL)
        .then((payload) => {
          if (!alive) return
          setMulti({
            ladder: payload.ex0dte,
            spot: payload.spot,
            expiryCount: payload.expiryCount,
            loading: false,
            err: null,
          })
        })
        .catch((e: unknown) => {
          if (!alive) return
          setMulti((prev) => ({
            ...prev,
            loading: false,
            err: e instanceof Error ? e.message : String(e),
          }))
        })
    }
    run()
    const id = setInterval(() => {
      // Same rule useQuery's pollMs follows: a hidden tab does not sweep.
      if (document.visibilityState !== 'hidden') run()
    }, GEX_MULTI_POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') run()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [wantMulti, onSocket])

  const handleRef = useRef<GexChartHandle | null>(null)
  const modelRef = useRef<GexChartModel>(EMPTY_MODEL)
  /**
   * Which source the pushes should be coming from, readable from inside the
   * socket watchers without making them re-subscribe on a series change.
   *
   * A ref rather than a dependency because the `spot` watcher must NOT tear
   * down and re-subscribe every time the series switch moves — resubscribing a
   * 10Hz topic to change which array it reads is work for nothing.
   */
  const wantMultiRef = useRef(wantMulti)
  wantMultiRef.current = wantMulti
  const multiRowsRef = useRef<GexRow[]>(EMPTY_ROWS)
  multiRowsRef.current = multiRows

  // ── Offscreen cards do not paint ────────────────────────────────────────────
  // `spot` is a 10Hz topic and every tick re-pushes the ladder, so an unguarded
  // copy of this card repaints its canvas ten times a second for as long as it
  // is on the board — including while it is scrolled a thousand pixels below
  // the fold. The model is kept up to date either way (it is a ref assignment);
  // only the PAINT is deferred, and only the last one is owed, because setModel
  // redraws the whole chart from the current model.
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

  // The settings the renderer needs, in one object so `push` takes a stable
  // dependency rather than three.
  const drawOpts = useMemo(
    () => ({
      basis: settings.basis,
      split: settings.split,
      showDex: settings.showDex,
      series,
      // Gamma ex-0DTE is the one ladder that arrives WITH a flip; see the note
      // on `flip` in GexChartModel for why it is not derived here.
      flip: wantMulti && !barsAreDex ? multiFlip : null,
    }),
    [settings.basis, settings.split, settings.showDex, series, wantMulti, barsAreDex, multiFlip],
  )
  const drawOptsRef = useRef(drawOpts)
  drawOptsRef.current = drawOpts

  const push = useCallback(
    (rows: GexRow[] | null, spot: number, sym: string, expiry: string, syncTiles = true) => {
      const o = drawOptsRef.current
      const safe = rows?.length ? rows : EMPTY_ROWS
      modelRef.current = { rows: safe, spot, symbol: sym, expiry, ...o }
      paint()
      if (!syncTiles) return
      // Ungated by visibility on purpose: the tiles must be right the instant
      // the card is scrolled back into view, and React bails out on an
      // unchanged value anyway.
      setView((prev) =>
        prev.rows === safe && prev.spot === spot && prev.expiry === expiry
          ? prev
          : { rows: safe, spot, expiry },
      )
    },
    [paint],
  )

  // A settings change does not bring new rows — it changes how the ones already
  // in the model are drawn. Re-model and repaint without touching the sources.
  useEffect(() => {
    modelRef.current = { ...modelRef.current, ...drawOpts }
    paint()
  }, [drawOpts, paint])

  const onMount = useCallback((frame: ChartHandle): (() => void) => {
    const created = mountGexChart(frame.el)
    handleRef.current = created
    visibleRef.current = frame.visible()
    // Replay whatever arrived before the frame mounted, so the first paint is
    // never an empty chart that fills in a beat later.
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

  // ── SPX: the socket ────────────────────────────────────────────────────────
  // Returning early when off-socket is what UNSUBSCRIBES, which is also what
  // narrows the socket's derived topic scope — the card stops asking for `gex`
  // the moment it stops reading it.
  const spotRef = useRef(0)
  const socketRef = useRef<{ rows: GexRow[]; expiry: string }>({ rows: [], expiry: '' })
  useEffect(() => {
    if (!onSocket) return
    return watchFrame<GexFrame>('gex', (frame) => {
      const d: GexData | undefined = frame?.data
      if (!d) return
      socketRef.current = { rows: d.gexRows ?? [], expiry: d.expiry ?? '' }
      // The SUBSCRIPTION stays live on an ex-0DTE series — only the push is
      // skipped. Unsubscribing would narrow the socket's derived scope, and
      // switching back would then sit on an empty chart until the next ladder
      // CHANGE, which on a quiet book can be minutes: server-v2 dedupes the
      // `gex` frame, so "no news" is silence, not a repeat.
      if (wantMultiRef.current) return
      push(socketRef.current.rows, spotRef.current, symbol, socketRef.current.expiry)
    })
  }, [onSocket, push, symbol])

  // Last wall-clock time a spot tick was allowed through to the tiles. A ref,
  // not state — reading it must not itself be a render.
  const tileSyncRef = useRef(0)
  useEffect(() => {
    if (!onSocket) return
    return watchFrame<SpotFrame>('spot', (frame) => {
      const px = frame?.data.spot
      if (typeof px !== 'number' || !(px > 0)) return
      spotRef.current = px
      // Whichever ladder is on screen gets the live tick. The ex-0DTE sweep
      // carries a spot of its own, but it is up to a minute old — the spot LINE
      // has to be the live print either way.
      const rows = wantMultiRef.current ? multiRowsRef.current : socketRef.current.rows
      if (!rows.length) return
      // Chart every tick, tiles at most once a second. See TILE_SPOT_MS.
      const now = Date.now()
      const syncTiles = now - tileSyncRef.current >= TILE_SPOT_MS
      if (syncTiles) tileSyncRef.current = now
      push(rows, px, symbol, wantMultiRef.current ? '' : socketRef.current.expiry, syncTiles)
    })
  }, [onSocket, push, symbol])

  // ── Everything else: the chain ─────────────────────────────────────────────
  const chainQ = useQuery<unknown>(onSocket ? null : chainGexUrl(symbol), { staleMs: 15_000, pollMs: 15_000 })
  const chain = useMemo(() => (onSocket ? EMPTY_CHAIN_GEX : chainToGex(chainQ.data)), [onSocket, chainQ.data])

  useEffect(() => {
    if (onSocket) return
    push(chain.rows, chain.spot, symbol, chain.expiry)
  }, [onSocket, chain, push, symbol])

  // ── The ex-0DTE ladder reaching the chart ─────────────────────────────────
  // Also the SERIES-CHANGE handler for both directions: switching to an
  // ex-0DTE series repaints from `multi` here, and switching back repaints from
  // the socket's last frame rather than waiting for the next one.
  useEffect(() => {
    if (!wantMulti) {
      if (onSocket) push(socketRef.current.rows, spotRef.current, symbol, socketRef.current.expiry)
      return
    }
    push(multiRows, spotRef.current > 0 ? spotRef.current : multi.spot, symbol, '')
  }, [wantMulti, multiRows, multi.spot, onSocket, push, symbol])

  // A symbol change must not leave the previous ticker's ladder on screen while
  // the next source warms up.
  useEffect(() => {
    spotRef.current = 0
    socketRef.current = { rows: [], expiry: '' }
    push(null, 0, symbol, '')
  }, [symbol, push])

  // ── Can these rows do FLOW at all? ─────────────────────────────────────────
  //
  // Gated on `view.rows.length` on purpose. `flowSupported([])` is false, and
  // an empty ladder is the state this card is in for the first second of every
  // load — so testing without the length check would report "no flow" before
  // any data existed, grey the button out on arrival, and un-grey it a beat
  // later. Until a ladder has actually arrived the answer is not "no", it is
  // "not yet", and the control stays live.
  const flowKnown = view.rows.length > 0
  const flowHasData = useMemo(() => flowSupported(view.rows), [view.rows])
  const flowOff = flowKnown && !flowHasData

  // ── Header numbers ─────────────────────────────────────────────────────────
  // Resolved once, here, and handed to the tiles: FLOW is only really flow when
  // the rows carry the tape-derived leg, and the chart, the header total and
  // the ten cards all have to agree about that or the basis half-applies.
  // FLOW is a gamma basis: it prices bars against the dealer's classified tape
  // inventory, and there is no flowDEX. So on a delta ladder it never applies.
  const flowActive = !barsAreDex && settings.basis === 'flow' && flowHasData
  const total = useMemo(
    () =>
      !view.rows.length
        ? null
        : barsAreDex
          ? totalDex(view.rows, settings.basis)
          : totalNet(view.rows, settings.basis, flowActive),
    [view.rows, settings.basis, flowActive, barsAreDex],
  )

  /** "11 expirations, 0DTE excluded" — the scanner's own wording. */
  const scopeNote = wantMulti ? scopeNoteEx0dte(multi.expiryCount) : view.expiry
  /**
   * A server-v2 predating the slimRows delta change ships the ex-0DTE rows with
   * both delta legs zeroed, and a flat line pinned to the axis reads as
   * "delta is perfectly balanced" rather than "there is no delta here".
   */
  const multiDeltaMissing = wantMulti && barsAreDex && multiDeltaAllZero(multi.ladder)

  const seriesOptions: Array<{ label: string; value: GexSeries; title?: string; disabled?: boolean }> = (
    ['gamma-0dte', 'gamma-ex0dte', 'delta-0dte', 'delta-ex0dte'] as const
  ).map((v) => ({
    label: SERIES_LABEL[v],
    value: v,
    disabled: seriesOff && v !== 'gamma-0dte',
    title: seriesOff
      ? `${SERIES_LABEL[v]} is ${SOCKET_SYMBOL}-only — the board sweep and the delta legs exist for the symbol the socket streams, not for ${symbol}`
      : SERIES_TITLE[v],
  }))

  /**
   * The basis buttons. Built here rather than inline because the FLOW entry is
   * CONDITIONAL — the simple card has no third basis — and a conditional spread
   * inside a JSX array widens the option type to `string`, which loses
   * `GexBasis` on the way into onChange.
   */
  const basisOptions: Array<{ label: string; value: GexBasis; title?: string; disabled?: boolean }> = [
    {
      label: 'OI+VOL',
      value: 'oi-vol',
      title: 'Open interest plus today’s volume — what the rest of the board means by GEX',
    },
    { label: 'VOL', value: 'vol-only', title: 'Today’s volume alone, without the standing book behind it' },
  ]
  if (!simple && !barsAreDex) {
    basisOptions.push({
      label: 'FLOW',
      value: 'flow',
      // Not selectable when this ladder carries no `flowGEX` leg — there is no
      // tape for anything but the socket symbol, so on a chain-derived ticker
      // the button would only ever have picked a basis that immediately falls
      // back to OI+VOL.
      //
      // A stored FLOW choice is NOT rewritten when that happens: it stays
      // selected (dimmed, and the pane says why it is drawing OI+VOL) so it
      // comes back intact on the next symbol that has a tape. The other two
      // options are still one click away.
      disabled: flowOff,
      title: flowOff
        ? `No classified options tape for ${symbol} — flow GEX only exists for the symbol the socket streams`
        : 'Gamma against the dealer’s own signed inventory, built from the classified tape',
    })
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-1.5"
      // The expiry and the basis, for the caption under a CopyShot — the shot
      // drops this card's header, and those two are the whole difference between
      // one ladder and another that looks identical. See shell/snapshot.ts.
      data-capture-meta={[symbol, SERIES_LABEL[series], scopeNote, BASIS_LABEL[settings.basis]]
        .filter(Boolean)
        .join(' · ')}
    >
      <CardToolbar>
        {/* WHICH EXPIRY THESE BARS ARE. The rows look identical whichever one
            they came from, so without this the chart is a ladder with no date
            on it — and on SPX, where the socket can be streaming 0DTE or the
            next session, that is the difference between two very different
            pictures. Blank until a source has said. */}
        <span
          title={
            wantMulti
              ? 'Every listed expiration except the 0DTE one, summed per strike — there is no single expiry to name'
              : onSocket
                ? 'The expiry the WebSocket is streaming'
                : `The front expiry of ${symbol}'s option chain — the one this ladder is built from`
          }
          className="tabular shrink-0 rounded-sm border border-line px-1.5 py-0.5 font-mono text-2xs font-bold text-muted"
        >
          {scopeNote || '—'}
        </span>

        {!simple && (
          <SegMenu
            title="Which ladder the bars are — gamma or delta, today’s expiry or the standing book"
            options={seriesOptions}
            value={series}
            onChange={(v) => patch({ series: v })}
          />
        )}

        <SegGroup
          title="Which contracts the bars are priced on"
          options={basisOptions}
          value={settings.basis}
          onChange={(v) => patch({ basis: v })}
        />

        {/* Both of these are GAMMA controls, and both are dimmed rather than
            dropped on a delta ladder — a toolbar whose buttons come and go is a
            toolbar you cannot learn. The split has no per-side delta field to
            draw (netDEX is already net of both), and the DEX overlay would be
            the bars a second time on a second scale. */}
        {!simple && (
          <SegGroup
            title={
              barsAreDex
                ? 'The call/put split is gamma only — netDEX is already net of both sides, and there is no per-side delta on the wire'
                : wantMulti
                  ? 'The board sweep ships one net figure per strike — there are no call/put legs on it to split'
                  : 'One net bar per strike, or the call leg up and the put leg down'
            }
            options={[
              { label: 'NET', value: 'net', disabled: splitOff },
              { label: 'C/P', value: 'call-put', disabled: splitOff },
            ]}
            value={settings.split}
            onChange={(v) => patch({ split: v })}
          />
        )}

        {!simple && !barsAreDex && (
          <Chip
            label="DEX"
            on={settings.showDex}
            onClick={() => patch({ showDex: !settings.showDex })}
            title="Net dealer DELTA exposure as a line across the bars, on its own normalised scale — it answers which way delta leans and where it turns, not how many dollars"
          />
        )}

        {!simple && (
          <Chip
            label="CARDS"
            on={settings.cardsOn}
            onClick={() => patch({ cardsOn: !settings.cardsOn })}
            title="The stat row above the chart — all ten tiles, or none"
          />
        )}

        {/* WHERE the rows came from — shown only when it is not the obvious
            answer. The basis is already on the segmented control beside this,
            so printing it again here would be the same word twice; what the
            toolbar cannot otherwise say is that these bars are a polled chain
            rather than the live socket. */}
        {!onSocket && (
          <span
            title={`Derived from ${symbol}'s option chain, polled every 15s. The socket only streams SPX`}
            className="shrink-0 text-2xs uppercase tracking-[0.1em] text-muted opacity-60"
          >
            chain
          </span>
        )}
        <span
          title={`Every strike on the ladder summed, on the ${BASIS_LABEL[flowActive ? 'flow' : settings.basis]} basis${
            barsAreDex ? ' — net DELTA dollars, summed here because the payload carries no delta total' : ''
          }`}
          className={[
            'tabular shrink-0 font-mono text-xs font-extrabold',
            total == null ? 'text-muted opacity-50' : total >= 0 ? 'text-gexbar-pos' : 'text-gexbar-neg',
          ].join(' ')}
        >
          {total == null ? '—' : fmtGexShort(total)}
        </span>
      </CardToolbar>

      {settings.cardsOn &&
        (barsAreDex ? (
          <DeltaStatCards rows={view.rows} spot={view.spot} basis={settings.basis} scopeNote={scopeNote} />
        ) : (
          <StatCards rows={view.rows} spot={view.spot} symbol={symbol} basis={settings.basis} flowActive={flowActive} />
        ))}

      <div className="relative min-h-0 flex-1">
        <ChartFrame onMount={onMount} onResize={onResize} onVisibility={onVisibility} className="absolute inset-0" />
        {/* One line, top-left, for whichever of the four "there is nothing to
            draw" states applies. The sweep's error wins over "loading" — a
            failed request that goes on saying "sweeping the board" is the
            state worth naming out loud. */}
        {multi.err && wantMulti ? (
          <span className="pointer-events-none absolute left-1 right-1 top-1 truncate text-2xs text-down opacity-80">
            Board sweep failed — {multi.err}
          </span>
        ) : multiDeltaMissing ? (
          <span className="pointer-events-none absolute left-1 right-1 top-1 truncate text-2xs text-down opacity-80">
            Net delta is zero at every strike — server-v2 predates the netDEX legs on this endpoint
          </span>
        ) : total == null ? (
          <span className="pointer-events-none absolute left-1 top-1 text-2xs text-muted opacity-50">
            {wantMulti
              ? 'Sweeping the board…'
              : onSocket
                ? 'Waiting for the feed…'
                : `Loading ${symbol}'s chain…`}
          </span>
        ) : null}
      </div>
    </div>
  )
}
