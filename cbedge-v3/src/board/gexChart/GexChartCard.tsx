import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChartFrame, type ChartHandle } from '@/design/primitives/ChartFrame'
import { CardToolbar } from '@/design/primitives/Card'
import { Chip, SegGroup } from '@/design/primitives/Controls'
import { useQuery } from '@/data/api'
import { watchFrame } from '@/data/hooks'
import { isSocketSymbol, usePageSymbol } from '@/data/symbol'
import type { GexData, GexFrame, GexRow, SpotFrame } from '@/contract/frames'
import { chainGexUrl, chainToGex, EMPTY_CHAIN_GEX } from '../chainGex'
import { EMPTY_MODEL, mountGexChart, type GexChartHandle, type GexChartModel } from './gexChartRender'
import { BASIS_LABEL, flowSupported, fmtGexShort, totalNet } from './values'
import { loadSettings, saveSettings, type GexChartSettings } from './settings'
import { StatCards } from './StatCards'

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
// ── The four controls ────────────────────────────────────────────────────────
//   BASIS   OI+VOL · VOL · FLOW — which contracts the bars are priced on
//   SPLIT   NET · C/P          — one net bar, or the call and put legs
//   DEX     the net-delta overlay line, on its own normalised scale
//   CARDS   the stat row above the chart — all ten, or none
//
// All four sit in the toolbar because each is one click. CARDS used to be a
// cog holding ten individual switches; the row shares its width evenly, so
// hiding one tile only made the other nine wider, and a stored subset meant no
// two boards showed the same row. It is one chip now.
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

export function GexChartCard() {
  const { symbol } = usePageSymbol()
  const onSocket = isSocketSymbol(symbol)

  const [settings, setSettings] = useState<GexChartSettings>(() => loadSettings(CARD_ID))

  const patch = useCallback((p: Partial<GexChartSettings>) => {
    setSettings((prev) => {
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
   * imperative and cheap) and leaves this state alone; the tiles pick the new
   * spot up on the next gex frame, seconds later, which is also the only
   * cadence at which a wall can actually move.
   */
  const [view, setView] = useState<{ rows: GexRow[]; spot: number; expiry: string }>({
    rows: EMPTY_ROWS,
    spot: 0,
    expiry: '',
  })

  const handleRef = useRef<GexChartHandle | null>(null)
  const modelRef = useRef<GexChartModel>(EMPTY_MODEL)

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
    () => ({ basis: settings.basis, split: settings.split, showDex: settings.showDex }),
    [settings.basis, settings.split, settings.showDex],
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
      push(socketRef.current.rows, spotRef.current, symbol, socketRef.current.expiry)
    })
  }, [onSocket, push, symbol])

  useEffect(() => {
    if (!onSocket) return
    return watchFrame<SpotFrame>('spot', (frame) => {
      const px = frame?.data.spot
      if (typeof px !== 'number' || !(px > 0)) return
      spotRef.current = px
      const s = socketRef.current
      if (s.rows.length) push(s.rows, px, symbol, s.expiry, false)
    })
  }, [onSocket, push, symbol])

  // ── Everything else: the chain ─────────────────────────────────────────────
  const chainQ = useQuery<unknown>(onSocket ? null : chainGexUrl(symbol), { staleMs: 15_000, pollMs: 15_000 })
  const chain = useMemo(() => (onSocket ? EMPTY_CHAIN_GEX : chainToGex(chainQ.data)), [onSocket, chainQ.data])

  useEffect(() => {
    if (onSocket) return
    push(chain.rows, chain.spot, symbol, chain.expiry)
  }, [onSocket, chain, push, symbol])

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
  const flowActive = settings.basis === 'flow' && flowHasData
  const total = useMemo(
    () => (view.rows.length ? totalNet(view.rows, settings.basis, flowActive) : null),
    [view.rows, settings.basis, flowActive],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <CardToolbar>
        {/* WHICH EXPIRY THESE BARS ARE. The rows look identical whichever one
            they came from, so without this the chart is a ladder with no date
            on it — and on SPX, where the socket can be streaming 0DTE or the
            next session, that is the difference between two very different
            pictures. Blank until a source has said. */}
        <span
          title={
            onSocket
              ? 'The expiry the WebSocket is streaming'
              : `The front expiry of ${symbol}'s option chain — the one this ladder is built from`
          }
          className="tabular shrink-0 rounded-sm border border-line px-1.5 py-0.5 font-mono text-[10px] font-bold text-muted"
        >
          {view.expiry || '—'}
        </span>

        <SegGroup
          title="Which contracts the bars are priced on"
          options={[
            { label: 'OI+VOL', value: 'oi-vol', title: 'Open interest plus today’s volume — what the rest of the board means by GEX' },
            { label: 'VOL', value: 'vol-only', title: 'Today’s volume alone, without the standing book behind it' },
            {
              label: 'FLOW',
              value: 'flow',
              // Not selectable when this ladder carries no `flowGEX` leg —
              // there is no tape for anything but the socket symbol, so on a
              // chain-derived ticker the button would only ever have picked a
              // basis that immediately falls back to OI+VOL.
              //
              // A stored FLOW choice is NOT rewritten when that happens: it
              // stays selected (dimmed, and the pane says why it is drawing
              // OI+VOL) so it comes back intact on the next symbol that has a
              // tape. The other two options are still one click away.
              disabled: flowOff,
              title: flowOff
                ? `No classified options tape for ${symbol} — flow GEX only exists for the symbol the socket streams`
                : 'Gamma against the dealer’s own signed inventory, built from the classified tape',
            },
          ]}
          value={settings.basis}
          onChange={(v) => patch({ basis: v })}
        />

        <SegGroup
          title="One net bar per strike, or the call leg up and the put leg down"
          options={[
            { label: 'NET', value: 'net' },
            { label: 'C/P', value: 'call-put' },
          ]}
          value={settings.split}
          onChange={(v) => patch({ split: v })}
        />

        <Chip
          label="DEX"
          on={settings.showDex}
          onClick={() => patch({ showDex: !settings.showDex })}
          title="Net dealer DELTA exposure as a line across the bars, on its own normalised scale — it answers which way delta leans and where it turns, not how many dollars"
        />

        <Chip
          label="CARDS"
          on={settings.cardsOn}
          onClick={() => patch({ cardsOn: !settings.cardsOn })}
          title="The stat row above the chart — all ten tiles, or none"
        />

        {/* WHERE the rows came from — shown only when it is not the obvious
            answer. The basis is already on the segmented control beside this,
            so printing it again here would be the same word twice; what the
            toolbar cannot otherwise say is that these bars are a polled chain
            rather than the live socket. */}
        {!onSocket && (
          <span
            title={`Derived from ${symbol}'s option chain, polled every 15s. The socket only streams SPX`}
            className="shrink-0 text-[10px] uppercase tracking-[0.1em] text-muted opacity-60"
          >
            chain
          </span>
        )}
        <span
          title={`Every strike on the ladder summed, on the ${BASIS_LABEL[flowActive ? 'flow' : settings.basis]} basis`}
          className={[
            'tabular shrink-0 font-mono text-[11px] font-extrabold',
            total == null ? 'text-muted opacity-50' : total >= 0 ? 'text-gexbar-pos' : 'text-gexbar-neg',
          ].join(' ')}
        >
          {total == null ? '—' : fmtGexShort(total)}
        </span>
      </CardToolbar>

      {settings.cardsOn && (
        <StatCards rows={view.rows} spot={view.spot} symbol={symbol} basis={settings.basis} flowActive={flowActive} />
      )}

      <div className="relative min-h-0 flex-1">
        <ChartFrame onMount={onMount} onResize={onResize} onVisibility={onVisibility} className="absolute inset-0" />
        {total == null && (
          <span className="pointer-events-none absolute left-1 top-1 text-[10px] text-muted opacity-50">
            {onSocket ? 'Waiting for the feed…' : `Loading ${symbol}'s chain…`}
          </span>
        )}
      </div>
    </div>
  )
}
