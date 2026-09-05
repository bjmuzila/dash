// ─────────────────────────────────────────────────────────────────────────────
// The chart itself — lightweight-charts, mounted imperatively, plus the bubble
// canvas laid over it.
//
// Loaded through a DYNAMIC import so the library lands in its own route chunk
// and the entry bundle every other card pays for on first paint never sees it.
//
// Colours are read out of tokens.css at mount time with getComputedStyle. The
// "no colour literals in src/" rule applies here as much as anywhere; it is
// just enforced at runtime instead of by Tailwind, because a charting library
// takes colour STRINGS, not classNames. cssVar() carries NO literal fallback —
// tokens.css is the only palette, and a second one written inline here is the
// drift the rule exists to stop. See the note on cssVar below.
//
// NO BASIS CONVERSION. Every symbol v3 charts is charted against its own
// strikes, so a GEX bubble is drawn at the strike price directly. The whole
// /proxy/es-spx-basis path existed for one symbol — ES, whose price axis was
// futures while its strikes were SPX cash — and went with it when the futures
// were dropped.
// ─────────────────────────────────────────────────────────────────────────────

import type { Coordinate, IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts'
import { etDateKey, etMinutesOfDay, RTH_OPEN_MIN, type Bar } from './candles'
import { drawBubbles, type BubbleSnapshot, type BubblePalette } from './bubbles'
import { BUBBLES } from './settings'

/**
 * Read one design token off the mounted element.
 *
 * NO LITERAL FALLBACK, deliberately. Every token read here is declared on
 * `:root` in src/design/tokens.css, so a hex second argument could only ever
 * fire if the stylesheet failed to load — at which point the whole app is
 * unstyled and a correct GEX-bubble blue is not the problem. What the fallbacks
 * DID do is duplicate the palette in a second place that nothing keeps in sync:
 * a theme edit moved the token and left thirteen stale hexes behind it, which is
 * exactly the drift Non-negotiable #1 exists to prevent (cbedge-v3/AGENTS.md).
 *
 * An empty return is therefore a real bug, not a supported mode, so it warns.
 * Canvas ignores an invalid `fillStyle`/`strokeStyle` assignment and
 * lightweight-charts falls back to its own default, so nothing throws while the
 * warning is on screen. `hexToRgb` below keeps its numeric fallback because the
 * bubble layer needs three numbers to build a per-mark alpha with and cannot use
 * an empty string at all — an [r,g,b] triple is not a colour literal, it is the
 * arithmetic the canvas API takes.
 */
function cssVar(el: HTMLElement, name: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  if (!v) console.warn(`[gexCandles] design token ${name} resolved empty — declare it in src/design/tokens.css`)
  return v
}

/** '#rrggbb' → [r,g,b]. Canvas needs a per-mark alpha, which a token cannot carry. */
function hexToRgb(hex: string, fallback: [number, number, number]): [number, number, number] {
  const digits = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1]
  if (!digits) return fallback
  const n = parseInt(digits, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * The three named levels, ON the price pane.
 *
 * Prices in the CHART's own space — the caller shifts them through the ES−SPX
 * basis first when the tape is futures, exactly as it does for the bubbles, so
 * this layer never has to know which tape it is drawing over.
 *
 * null for a level the ladder does not currently have one of (no strike above
 * spot with positive gamma, an empty history). A missing level draws nothing;
 * it never draws at 0.
 */
export interface ChartLevels {
  /** Core — the biggest |GEX| strike on the ladder. Tagged CORE. */
  cb: number | null
  /** Call wall — biggest +GEX above spot, core excluded. */
  cw: number | null
  /** Put wall — most −GEX below spot, core excluded. */
  pw: number | null
}

export interface ChartDrawOpts {
  /** Master on/off for the bubble layer. */
  on: boolean
  /**
   * Pin the bubble bucket to a rung, in minutes, or null to follow the BAR
   * INTERVAL (the default — see reportBucket).
   *
   * The chart owns this rather than the model because the model does not know
   * the interval and cannot measure the pane. A pin overrides the bucket only;
   * it does NOT override the stride, and it additionally loosens the stride's
   * spacing target to BUBBLES.pinnedPxPerDot — which is the "I asked for the
   * detail and I accept the crowding" bargain, and is why it must stay tied to
   * an explicit pin rather than applying to the interval-driven default.
   */
  bucketMin: 1 | 5 | null
  /**
   * The Bubble size slider — a straight multiplier on every mark's radius
   * budget. 1 is the tuned default and is inert; see sizeFor() in bubbles.ts
   * for where it lands and why it scales the spacing share too.
   */
  bubbleScale: number
}

/**
 * Called once per animation frame with the chart's CURRENT price mapping, so a
 * DOM layer beside the chart can sit on the same prices the candles do.
 *
 * This is how the GEX rail lines up: it does not guess a pixel-per-point from
 * the visible range, it asks the same `priceToCoordinate` the bubble layer
 * draws with, in the same frame. Pan, zoom, autoscale and resize all move that
 * mapping, and a rail that recomputed on any subset of those events would sit a
 * few pixels off its strikes exactly when the user was looking hardest.
 *
 * A sink positions DOM nodes imperatively. It must NOT set React state — this
 * runs 60 times a second, and AGENTS.md rule 4 is that a tick never travels
 * through React on its way to a chart.
 */
export type RailSink = (yOfPrice: (price: number) => number | null, height: number) => void

export interface EsChartHandle {
  /**
   * `reframe` re-fits the time scale AND re-enables price autoscale. Pass it
   * whenever the series changes to data on a different scale — a symbol
   * switch above all. Without it lightweight-charts keeps whatever price
   * window was showing, so going from SPX at ~6,800 to SPY at ~645 leaves the
   * candles a mile off the top of the pane looking like an empty chart.
   * Autoscale has to be turned back ON explicitly, because any manual price
   * drag turns it off for good.
   */
  setBars: (bars: Bar[], reframe?: boolean) => void
  /**
   * Push a live trade price into the bar that is still forming. This is what
   * makes the price move between candle refreshes — the REST feed only ever
   * hands over closed bars.
   *
   * It extends the last bar, and when that bar's window has elapsed it opens
   * the NEXT one — stepping a single interval from the last bar's own open, so
   * the new bar stays on whatever grid the feed is anchored to (09:30 ET for
   * 15m and coarser) instead of guessing an absolute boundary. Strictly one bar
   * ahead: past that there is a gap in the data and the poll owns it.
   */
  setLivePrice: (price: number) => void
  /**
   * Bar width in ms. Needed to know when the last bar has stopped forming —
   * and, since 2026-08-31, it is also what picks the bubble BUCKET: one bubble
   * per bar, so the interval picker moves the bubbles the moment it is clicked.
   */
  setIntervalMs: (ms: number) => void
  setSnapshots: (snaps: BubbleSnapshot[]) => void
  setDrawOpts: (opts: ChartDrawOpts) => void
  /**
   * The CORE / CW / PW tags on the pane. `null` clears the layer.
   *
   * Drawn ABOVE the bubble early-return, so it survives the bubbles being
   * switched off — the levels are a different question from the ladder's
   * history, and a card with bubbles off is exactly the card that still wants
   * to know where the walls are.
   */
  setLevels: (levels: ChartLevels | null) => void
  /** Register (or clear, with null) the per-frame price mapping for the rail. */
  setRailSink: (sink: RailSink | null) => void
  /** Re-frame on the newest bar, keeping the user's zoom. */
  scrollToNow: () => void
  destroy: () => void
}

export interface MountOpts {
  /** Fired whenever the newest bar moves on or off screen. */
  onLatestOffscreen: (off: boolean) => void
  /**
   * Fired when the bubble BUCKET moves onto a different rung of
   * BUBBLES.bucketRungsMin. The model needs the value; the model does not know
   * the bar interval, and the chart does.
   *
   * The bucket follows the BAR INTERVAL now, not the zoom — see reportBucket —
   * so this fires when the interval picker (or the manual 1m/5m override)
   * changes, not on wheel ticks. Still de-duped to the value itself.
   */
  onBucketMs?: (ms: number) => void
  /**
   * Fired when the bubble layer starts, or stops, having anything to draw in
   * the visible window — zoomed or panned off the end of the GEX history.
   * Called ONLY on a change, so it is safe to hold in React state; the draw
   * loop itself never sets state (AGENTS.md rule 4).
   */
  onBubblesOutOfRange: (out: boolean) => void
}

export async function mountEsChart(container: HTMLElement, mountOpts: MountOpts): Promise<EsChartHandle> {
  const { createChart, CandlestickSeries, ColorType, CrosshairMode } = await import('lightweight-charts')

  const line = cssVar(container, '--color-line')
  const muted = cssVar(container, '--color-muted')
  const up = cssVar(container, '--color-candle-up')
  const down = cssVar(container, '--color-candle-down')
  // `pos` / `neg` are the SATURATED sign colours: the PEERS' fill, and the
  // leader's ring and glow. `lead` / `leadHi` are the GOLD the bucket's leader
  // fills with — the same hue as the CB tag and the GEX bars, because gold
  // means "the wall" on this card. See BubblePalette in bubbles.ts.
  const palette: BubblePalette = {
    pos: hexToRgb(cssVar(container, '--color-gex-pos'), [41, 182, 246]),
    neg: hexToRgb(cssVar(container, '--color-gex-neg'), [255, 71, 87]),
    lead: hexToRgb(cssVar(container, '--color-gex-lead'), [255, 179, 0]),
    leadHi: hexToRgb(cssVar(container, '--color-gex-lead-hi'), [255, 215, 106]),
    // The gradient's innermost stop. Read from a token rather than written as a
    // literal white so a light theme moves it with everything else.
    highlight: hexToRgb(cssVar(container, '--color-fg'), [255, 255, 255]),
  }

  // The three level tokens, read once with everything else. The SAME variables
  // the GEX rail's tags and the Multi Greek badges use — a level is one colour
  // across the app or it is a colour scheme nobody can learn.
  const levelInk: Record<keyof ChartLevels, string> = {
    cb: cssVar(container, '--color-level-cb'),
    cw: cssVar(container, '--color-level-cw'),
    pw: cssVar(container, '--color-level-pw'),
  }
  // Ink for the text INSIDE a tag: the page ground, so the tag reads as a
  // filled label rather than as coloured text on a chart.
  const appInk = cssVar(container, '--color-app')

  const chart: IChartApi = createChart(container, {
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: muted,
      fontSize: 11,
      // ── THE ATTRIBUTION LEAVES THE PLOT ──────────────────────────────────
      // lightweight-charts draws its TradingView mark INSIDE the pane, bottom
      // left — over the candles, over the bubble layer, and in every CopyShot
      // of the card. The attribution itself is not the problem; where it sits
      // is. Turned off here and re-rendered in the CARD HEADER instead, by
      // <TvAttribution> (design/primitives/ChartFrame.tsx), which the candles
      // card puts in its toolbar row.
      //
      // It must stay SOMEWHERE and visible — that is the library's licence, not
      // a style choice. Moving it is fine; dropping it is not. Do not delete
      // this line without deleting the header link too, or the chart quietly
      // ends up with no attribution at all.
      attributionLogo: false,
    },
    // No grid. The bubble layer is the thing being read against price, and a
    // ruled background competes with it — a horizontal line through a column of
    // marks reads as a level, which is exactly the signal the bubbles carry.
    // The axis borders stay: they frame the plot, they do not cross it.
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    rightPriceScale: { visible: true, borderColor: line },
    leftPriceScale: { visible: false },
    timeScale: {
      borderColor: line,
      timeVisible: true,
      secondsVisible: false,
      // The axis is ET, because the session boundaries this chart is read
      // against are ET. A browser-local axis would put 09:30 at a different
      // number for every user.
      tickMarkFormatter: (t: unknown, tickMarkType: number) => {
        if (typeof t !== 'number') return ''
        const d = new Date(t * 1000)
        if (tickMarkType <= 2) {
          return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })
        }
        return d.toLocaleTimeString('en-US', {
          timeZone: 'America/New_York',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      },
    },
    crosshair: { mode: CrosshairMode.Normal },
    localization: {
      priceFormatter: (price: number) => price.toFixed(2),
      timeFormatter: (time: unknown) =>
        typeof time === 'number'
          ? new Date(time * 1000).toLocaleTimeString('en-US', {
              timeZone: 'America/New_York',
              hour: '2-digit',
              minute: '2-digit',
            })
          : '',
    },
    autoSize: true,
  })

  const series: ISeriesApi<'Candlestick'> = chart.addSeries(CandlestickSeries, {
    upColor: up,
    downColor: down,
    borderVisible: true,
    borderUpColor: up,
    borderDownColor: down,
    wickUpColor: up,
    wickDownColor: down,
    // The dashed last-price line runs the full width of the plot and would be
    // the one remaining rule across the bubbles. The price is still on the
    // axis label, which is where it is read anyway.
    priceLineVisible: false,
    baseLineVisible: false,
  })

  // A transparent canvas over the chart's own canvas for the bubbles.
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative'
  const overlay = document.createElement('canvas')
  overlay.style.position = 'absolute'
  overlay.style.inset = '0'
  overlay.style.pointerEvents = 'none'
  // Non-negotiable 6: every canvas v3 OWNS carries data-cb-layer. This one is
  // ours — lightweight-charts made the canvas underneath it, we made this.
  //
  // Without the tag scripts/perf-check.mjs skipped it entirely, and because its
  // interaction assertions sum repaints for the `gex-candles` card, they summed
  // over nothing: "panning still redraws (0)" and "zooming still redraws (0)"
  // failed on every run and COULD NOT have passed. A guard that reports zero
  // because it is measuring an untagged canvas is worse than no guard — it is
  // the exact failure the tag exists to prevent, on the one card whose bubbles
  // repaint hardest.
  overlay.dataset.cbLayer = 'bubbles'
  container.appendChild(overlay)

  let snaps: BubbleSnapshot[] = []
  let barCount = 0
  let drawOpts: ChartDrawOpts = { on: true, bucketMin: null, bubbleScale: 1 }
  let railSink: RailSink | null = null
  /** CORE / CW / PW on the pane. null = the layer is off or has nothing yet. */
  let levels: ChartLevels | null = null
  let raf = 0
  // The forming bar, kept here so a live tick can extend it without going back
  // through React.
  // A named type rather than the inline object, because `synth` below needs the
  // SAME one. `typeof live` looked like the obvious way to say that and is not:
  // TypeScript resolved it against the initializer, so `synth` came out as
  // `null` and every field access on it was an error.
  interface FormingBar {
    /** The seconds value the series is keyed by. */
    time: UTCTimestamp
    /** Its wall-clock open, which is what decides whether it is still forming. */
    openMs: number
    open: number
    high: number
    low: number
    close: number
  }
  let live: FormingBar | null = null
  /**
   * The forming bar, when this chart INVENTED it (setLivePrice's roll-forward)
   * rather than receiving it from the feed. Held separately from `live` — which
   * is the same object while it is current — so a poll can hand it back.
   *
   * Without this, every candle refresh dropped the forming bar's accumulated
   * high/low on the floor: `setBars` rebuilds `live` from the newest CLOSED bar
   * the poll returned, which is the one BEFORE the bar being drawn, and the
   * next tick then started the minute over from scratch. Reloading the page did
   * the same thing for the same reason. The bar arrived on time and its OHLC
   * restarted, which is exactly what it looked like.
   */
  let synth: FormingBar | null = null
  let intervalMs = 5 * 60_000

  /**
   * Every bar's open, in ms, ascending — the SAME list the series was given,
   * plus the forming bar.
   *
   * This exists so the bubble layer can be told where a bucket goes instead of
   * having to look for it. See barAt/xOfTime below, and BubbleGeometry.xOfTime
   * in bubbles.ts for what went wrong when it looked.
   *
   * It has to be the real array and cannot be arithmetic off `intervalMs`: 15m
   * and coarser anchor to 09:30 ET rather than to the epoch, the RTH close
   * forces a short bar at 15:30, and any gap in the feed leaves a hole. A
   * computed timestamp under any of those is not a bar, and timeToCoordinate()
   * answers null for it — which is how a whole overlay disappears with no error
   * anywhere.
   */
  let barTimes: number[] = []

  /**
   * The open of the bar CONTAINING an instant, or null when there is no such
   * bar.
   *
   * ── Past the end is not "the last bar" ─────────────────────────────────────
   * The search returns the newest bar at or before `ms`, which for anything
   * after the final candle CLAMPS, silently: every later bucket stacks onto the
   * closing bar and draws as if it were a real print. Two bars of slack, not
   * zero — a GEX minute can legitimately arrive before the candle feed has
   * printed the bar it belongs to, and culling the newest column every time the
   * candles lag is a worse bug than the one this prevents. Further out has no
   * bar and gets no pixel.
   */
  function barAt(ms: number): number | null {
    const n = barTimes.length
    if (!n || ms < barTimes[0]!) return null
    if (ms >= barTimes[n - 1]! + 2 * intervalMs) return null
    let lo = 0
    let hi = n - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (barTimes[mid]! <= ms) lo = mid
      else hi = mid - 1
    }
    return barTimes[lo]!
  }

  /** Keep `barTimes` covering the forming bar `live` is currently drawing. */
  function syncLiveBarTime() {
    if (!live) return
    const n = barTimes.length
    if (n && barTimes[n - 1]! >= live.openMs) return
    barTimes.push(live.openMs)
  }

  const ts = chart.timeScale()

  function checkOffscreen() {
    let off = false
    try {
      const r = ts.getVisibleLogicalRange()
      // 1.5 bars of slack: the logical range edges are fractional, so an exact
      // comparison flickers the button on and off while the last bar forms.
      off = r != null && barCount > 0 && r.to < barCount - 1.5
    } catch {
      off = false
    }
    mountOpts.onLatestOffscreen(off)
  }
  ts.subscribeVisibleLogicalRangeChange(checkOffscreen)

  /**
   * How much of the pane is actually showing DATA, 0..1.
   *
   * The logical range is in bar indices and is free to sit anywhere, including
   * entirely outside `[0, barCount)` — that is what a pan into the whitespace
   * past either end of the series is. This is the overlap between the range and
   * the data, as a fraction of the range's own width, so 1 means the pane is
   * full of candles and 0 means it is empty.
   */
  function visibleDataFraction(): number {
    let r: { from: number; to: number } | null = null
    try {
      r = ts.getVisibleLogicalRange()
    } catch {
      return 1
    }
    if (!r || barCount <= 0) return 1
    const span = r.to - r.from
    if (!(span > 0)) return 1
    const lo = Math.max(r.from, 0)
    const hi = Math.min(r.to, barCount)
    return Math.max(0, hi - lo) / span
  }

  /**
   * Put the newest bar back on screen when the view has been STRANDED — left
   * looking at bar indices the series no longer has.
   *
   * This is the "come back to the tab and there is a huge gap" bug. Whitespace
   * on both sides with the candles squeezed into the middle, or an empty pane
   * with the time axis still labelling it, is not a drawing fault: it is the
   * visible LOGICAL RANGE surviving a `setData` that gave the series a
   * different number of bars. Nothing in lightweight-charts re-anchors it, and
   * `reframe` only fires on a symbol/interval/session change.
   *
   * It takes the bubbles down with it, which is why they went thin at the same
   * time: the layer measures `pxPerDot` off the CURRENT zoom and strides the
   * trail to fit, so a range stretched far past the data reports almost no room
   * per bucket and throws most of the dots away.
   *
   * Deliberately narrow, because `setBars` runs every 30 seconds and yanking a
   * view the user chose would be worse than the bug:
   *
   *   • nothing at all on screen — always. A pane showing no candles is not a
   *     view anyone chose.
   *   • the series SHRANK and most of the pane is now empty. Growth cannot
   *     strand a range; only losing bars out from under it can.
   *
   * A deliberate scroll into the whitespace beside a stable series matches
   * neither, and is left alone.
   */
  function reanchorIfStranded(prevCount: number) {
    if (barCount <= 0) return
    const shown = visibleDataFraction()
    const shrank = barCount < prevCount || prevCount === 0
    if (shown > 0 && !(shrank && shown < 0.3)) return
    anchorToNow()
  }

  /**
   * ── THE PANE IS TODAY'S SESSION, 09:30 TO 16:00 ─────────────────────────────
   *
   * The window is always ONE RTH SESSION WIDE — 390 minutes of bars — and it is
   * positioned so that today's 09:30 sits on the left edge and 16:00 on the
   * right. The day therefore fills the pane at every hour: at 15:30 the candles
   * reach the right-hand side, and earlier in the day the remaining whitespace
   * is the part of the session that has not happened yet, which is the correct
   * amount of room to leave rather than a gap to be closed.
   *
   * ── …and early in the day the live candle is CENTRED ────────────────────────
   * Anchoring the left edge at 09:30 from the first bar of the day would open
   * the chart on one candle jammed against the left with six blank hours beside
   * it. So the left edge is the EARLIER of "today's open" and "half a session
   * back from the newest bar":
   *
   *     from = min(sessionStartIdx, newestIdx - span/2)
   *
   * At 09:35 that second term wins and the live candle sits in the middle of
   * the pane with yesterday's tail behind it for context. As the day fills, the
   * term rises until it passes 09:30 (a little after midday) and the window
   * pins to the session for the rest of the day. It slides continuously — there
   * is no jump at the crossover, because the two expressions are equal there.
   *
   * ── What this replaced ──────────────────────────────────────────────────────
   * `from = barCount - n` — a window measured BACKWARD from the newest bar,
   * with 3% of slack past it. Two problems. It ignored the session, so the
   * pane was always "the last 390 minutes of trading" and on a fresh morning
   * that is most of yesterday afternoon with today squeezed into the last
   * inch — which is what "the chart keeps opening up small" was. And before it,
   * `fitContent()` fitted the whole five-day pull (`HISTORY_DAYS`): ~1,950 bars
   * at 1m in ~900px, half a pixel each, with the bubble layer strided down to
   * nothing because it sizes and strides off the room per bucket.
   *
   * The floor of 30 bars is for the coarse intervals: 390 minutes is six bars
   * at 1h, so a 1h chart opens on several days rather than on six candles.
   */
  function sessionSpanBars(): number {
    return Math.max(30, Math.round(390 / Math.max(1, intervalMs / 60_000)))
  }

  /**
   * Index of the first bar in the NEWEST session present — today's 09:30, or
   * the open of whatever the last bar's ET day is on a weekend or a holiday.
   *
   * Walks back from the end rather than scanning: the answer is always within
   * one session of the newest bar, and `barTimes` can hold five days of them.
   * Returns -1 when there is no such bar (a series that ends before the open).
   */
  function sessionStartIndex(): number {
    const n = barTimes.length
    if (!n) return -1
    const day = etDateKey(barTimes[n - 1]!)
    let idx = -1
    for (let i = n - 1; i >= 0; i--) {
      const t = barTimes[i]!
      if (etDateKey(t) !== day) break
      if (etMinutesOfDay(t) < RTH_OPEN_MIN) break
      idx = i
    }
    return idx
  }

  function frameRecent() {
    if (barCount < 2) {
      try {
        ts.fitContent()
      } catch {
        /* nothing to frame */
      }
      return
    }
    const span = sessionSpanBars()
    const newest = barCount - 1
    const open = sessionStartIndex()
    // No RTH bar for the newest day (pre-open, or an ETH-only stretch): fall
    // back to a session's width ending at the newest bar, which is what this
    // did before and is still right when there is no session to frame.
    const anchor = open >= 0 ? open : Math.max(0, newest - span + 1)
    const from = Math.min(anchor, newest - span / 2)
    try {
      ts.setVisibleLogicalRange({ from, to: from + span })
    } catch {
      try {
        ts.fitContent()
      } catch {
        /* nothing to frame */
      }
    }
  }

  /**
   * ── THE NEWEST BAR MUST SURVIVE A TIMEFRAME CHANGE ──────────────────────────
   *
   * `frameRecent` sets the logical range synchronously, right after `setData`.
   * That is usually enough — but not always. lightweight-charts re-lays the
   * time scale on its own next frame, and when the bar COUNT has just changed
   * by an order of magnitude (1m → 15m is ~1,950 bars → ~130) the range it
   * settles on can be the one it derived from the OLD base index, which lands
   * the pane on candles from earlier in the week with the newest one off the
   * right edge. Switch timeframe, lose the live candle — that was the report.
   *
   * So the frame is CHECKED after the chart has had its frame, and again after
   * a layout pass, and re-applied if it did not take. Idempotent: a view that is
   * already right is left exactly as it is.
   *
   * ── "THE NEWEST BAR IS ON SCREEN" IS NOT ENOUGH ─────────────────────────────
   * That was the whole test, and it passed on the exact view people were
   * complaining about: a card that mounts in a hidden board tab (clientWidth 0)
   * gets its range applied against a scale that has no width, and what comes
   * back once it is shown is a pane of whitespace with the whole session
   * crushed into the last inch on the right. The newest bar IS visible there,
   * so the check was satisfied and the bad frame stayed for the life of the
   * card. It is now also wrong if the pane is mostly empty, or if the zoom is
   * nothing like a session wide.
   *
   * Three checks, not two, and the last is 600ms out: a tab that becomes
   * visible can lay out well after the 150ms one.
   *
   * This runs ONLY from the reframe branch of setBars — a symbol, interval or
   * session change — never on the 30s poll, so it can never fight a zoom the
   * user chose.
   */
  let ensureTimers: Array<ReturnType<typeof setTimeout>> = []
  function ensureLatestVisible() {
    const check = () => {
      if (barCount <= 0) return
      let r: { from: number; to: number } | null = null
      try {
        r = ts.getVisibleLogicalRange()
      } catch {
        return
      }
      if (!r) {
        frameRecent()
        return
      }
      // `barCount - 1` is the newest bar's index; `to` is the right edge.
      const lost = r.to < barCount - 1 || r.from > barCount - 1
      // Far wider than a session, or mostly whitespace: the frame did not take.
      const span = sessionSpanBars()
      const tooWide = r.to - r.from > span * 1.6
      const tooEmpty = visibleDataFraction() < 0.4
      if (lost || tooWide || tooEmpty) frameRecent()
    }
    requestAnimationFrame(check)
    for (const t of ensureTimers) clearTimeout(t)
    ensureTimers = [setTimeout(check, 150), setTimeout(check, 600)]
  }

  /** Newest bar back at the right edge, keeping the user's bar spacing. */
  function anchorToNow() {
    try {
      ts.scrollToRealTime()
    } catch {
      try {
        ts.fitContent()
      } catch {
        /* the chart is gone; nothing to re-frame */
      }
    }
  }

  /**
   * ── THE ACTIVATION PATH ──────────────────────────────────────────────────
   *
   * Same repair, run when the chart comes BACK: the browser tab is shown again,
   * or the card is laid out after having had no size at all (a board page it was
   * not on, a collapsed panel).
   *
   * `reanchorIfStranded` alone was not enough, and the reason is a timing one:
   * it only runs inside `setBars`, so a stranded view stays stranded until the
   * next poll happens to change the bar count in the one way it tests for. Come
   * back to the tab and you are looking at the gap until something else moves.
   * The moment of coming back is exactly when the view should be checked, so it
   * is checked there too.
   *
   * Looser than the setBars rule on purpose. There the guard has to survive
   * running every thirty seconds, so it demands a shrink before it will touch a
   * partly-empty pane. Here it is a deliberate return to a chart — if under 30%
   * of it is candles, that is not a view anyone chose to come back to.
   *
   * Deferred a frame: while the tab was hidden rAF was stopped, and asking the
   * time scale where it is before the browser has re-laid the chart out gets an
   * answer from before the resize.
   */
  function recoverView() {
    if (barCount <= 0) return
    requestAnimationFrame(() => {
      if (barCount > 0 && visibleDataFraction() < 0.3) anchorToNow()
    })
  }

  // A steady rAF loop rather than chasing every event that can move the price
  // axis — pan, zoom, autoscale and resize all qualify, and enumerating them one
  // at a time is how an overlay ends up half a pixel behind its chart.
  //
  // ── But the loop must not WORK every frame ─────────────────────────────────
  // It used to. Sixty times a second it read getBoundingClientRect() and
  // ts.height() (two forced layouts), positioned every rail row, and redrew the
  // whole bubble band — up to 320 segments × six marks, each with its own
  // priceToCoordinate() and stroke(). Chrome logged it as a 52ms rAF handler and
  // a 47ms forced reflow, on a chart that was sitting still.
  //
  // Three changes, in order of what they cost:
  //   1. The size comes from a ResizeObserver, not a per-frame layout read.
  //   2. ts.height() is cached and refreshed with it.
  //   3. Nothing is drawn unless the VIEW ACTUALLY MOVED. viewSignature() probes
  //      the two scales at four fixed reference points — pure scale arithmetic,
  //      no layout — and the frame is skipped when it matches the last one.
  //
  // Two points per axis, not one: a zoom anchored on a point leaves that point
  // where it was, so a single probe cannot see it.
  const yOfPrice = (price: number): number | null => {
    const y = series.priceToCoordinate(price)
    return y == null ? null : (y as number)
  }

  // ── Size, observed rather than measured every frame ─────────────────────────
  let boxW = Math.max(1, Math.round(container.clientWidth))
  let boxH = Math.max(1, Math.round(container.clientHeight))
  let plotH = boxH
  // The plot's WIDTH — the container minus the right price scale. ts.width() is
  // the time scale's own width, which is exactly that, and is cached model state
  // rather than a layout read, so it is safe to ask for per frame. The bubble
  // layer needs it for the same reason the rail needs plotH: the overlay canvas
  // spans the whole card and the plot does not, and coordinateToTime() answers
  // happily for an x that is already underneath the price labels — it is index
  // arithmetic, not a hit test. Without this the newest buckets were stamped over
  // the axis. It is re-read every frame rather than only on resize because the
  // scale widens on its own when the price gains a digit.
  let plotW = boxW
  const readPlotW = (): number => {
    try {
      const v = ts.width()
      return v > 0 ? Math.max(1, Math.min(boxW, Math.round(v))) : boxW
    } catch {
      return boxW
    }
  }
  const measure = () => {
    boxW = Math.max(1, Math.round(container.clientWidth))
    boxH = Math.max(1, Math.round(container.clientHeight))
    try {
      plotH = Math.max(1, boxH - ts.height())
    } catch {
      plotH = boxH
    }
    plotW = readPlotW()
  }
  measure()

  // A card with NO SIZE is a card that is not on screen — a board page you are
  // not looking at, a collapsed panel. Going from that back to a real box is
  // the same "I am looking at this again" moment as un-hiding the tab, and the
  // view can have been stranded the whole time it was away.
  let hadBox = container.clientWidth > 0 && container.clientHeight > 0
  const ro = new ResizeObserver(() => {
    measure()
    const has = container.clientWidth > 0 && container.clientHeight > 0
    if (has && !hadBox) recoverView()
    hadBox = has
  })
  ro.observe(container)

  const onVisible = () => {
    if (document.visibilityState === 'visible') recoverView()
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)

  /**
   * Bumped by every setter, so a DATA change always redraws even when the view
   * has not moved a pixel.
   */
  let version = 0

  /**
   * Two PRICES to probe the vertical scale with. Any two distinct prices work —
   * priceToCoordinate answers for arbitrary values, not just ones in the series
   * — so these are picked from the drawn ladder purely to sit inside the pane,
   * where a scale change moves them the most.
   */
  let probeP0 = 0
  let probeP1 = 0
  function pickProbes() {
    const first = snaps[0]
    if (first) {
      const m0 = first.marks[0]
      const m1 = first.marks[first.marks.length - 1]
      probeP0 = m0?.strike ?? 0
      probeP1 = m1?.strike ?? probeP0
    }
    if (!(probeP0 > 0) && live) {
      probeP0 = live.low
      probeP1 = live.high
    }
  }

  // ── The bucket, reported to the model ─────────────────────────────────────
  // ONE BUBBLE PER BAR. The bucket is the bar interval, clamped to the rungs
  // the ladder actually offers (BUBBLES.bucketRungsMin, capped at 5m), and the
  // manual 1m / 5m tiles override it.
  //
  // It used to be picked from the visible SPAN — pixels per dot — and the zoom
  // was the only thing that could move it. That made the interval picker inert:
  // switching 1m -> 5m left the bubbles exactly where they were, and 5m -> 1m
  // only came back if you zoomed most of the way in, because that is when the
  // span rule finally allowed the finer rung. The cadence question is "how
  // often is a reading taken", which the interval answers; the zoom question is
  // "how many of them fit on screen", and the STRIDE in drawBubbles already
  // answers that and is unchanged.
  //
  // Called from setIntervalMs / setDrawOpts rather than from the draw loop, so
  // the model rebuilds on the click instead of on the next frame that happens
  // to move. Still de-duped to the value, so a no-op click costs nothing.
  let lastBucket = 0
  function reportBucket() {
    const rungs = BUBBLES.bucketRungsMin
    const barMin = Math.max(1, Math.round(intervalMs / 60_000))
    const rung = drawOpts.bucketMin ?? (rungs.find((m) => m >= barMin) ?? rungs[rungs.length - 1]!)
    const ms = rung * 60_000
    if (ms === lastBucket) return
    lastBucket = ms
    mountOpts.onBucketMs?.(ms)
  }

  let lastOutOfRange: boolean | null = null
  function reportOutOfRange(out: boolean) {
    if (out === lastOutOfRange) return
    lastOutOfRange = out
    mountOpts.onBubblesOutOfRange(out)
  }

  let lastSig = ''
  function viewSignature(): string {
    const px = (v: number | null) => (v == null ? 'n' : Math.round(v * 10) / 10)
    let from: number | null = null
    let to: number | null = null
    let y0: number | null = null
    let y1: number | null = null
    try {
      // The TIME axis is probed with the visible LOGICAL RANGE, not with
      // timeToCoordinate() on a pair of timestamps.
      //
      // That was the first attempt and it was silently broken:
      // timeToCoordinate() answers only for times that are IN the series — it
      // does not interpolate — and the probe times came from the per-MINUTE GEX
      // history while the candles are 5m or coarser. Both probes returned null
      // on nearly every load, so the horizontal half of the signature was the
      // constant "n|n" and a pure sideways pan never redrew the layer.
      //
      // The logical range is always defined, is pure scale state (no layout),
      // and moves on both pan and zoom.
      const r = ts.getVisibleLogicalRange()
      if (r) {
        from = Math.round(r.from * 1000) / 1000
        to = Math.round(r.to * 1000) / 1000
      }
      if (probeP0) y0 = series.priceToCoordinate(probeP0) as number | null
      if (probeP1) y1 = series.priceToCoordinate(probeP1) as number | null
    } catch {
      // Mid-teardown. Return a value that will not match, so the frame draws and
      // the next one finds the loop cancelled.
      return `${version}:torn:${Math.random()}`
    }
    return `${version}|${boxW}|${boxH}|${plotW}|${from}|${to}|${px(y0)}|${px(y1)}`
  }

  function draw() {
    raf = requestAnimationFrame(draw)
    // Cheap (cached model state, no layout) and in the signature, so the layer
    // re-clips the frame the price scale changes width on.
    plotW = readPlotW()
    const sig = viewSignature()
    if (sig === lastSig) return
    lastSig = sig

    const dpr = window.devicePixelRatio || 1
    const w = boxW
    const h = boxH

    // BEFORE the bubble early-returns below. The rail is a separate layer with
    // its own on/off switch — it must keep tracking the price scale on a chart
    // whose bubbles are off, or have no history yet.
    //
    // The height handed over is the PLOT's, not the container's: the time axis
    // owns the bottom ~26px and there is no price down there. Passing the
    // container height would let the rail park a strike below the lowest candle,
    // level with the clock — which is exactly the kind of "close enough"
    // alignment the rail exists to not do. The bubble canvas below still uses
    // the full container height, because it is drawing INSIDE the chart's own
    // box and lightweight-charts clips it.
    if (railSink) railSink(yOfPrice, plotH)

    if (overlay.width !== w * dpr || overlay.height !== h * dpr) {
      overlay.width = w * dpr
      overlay.height = h * dpr
      overlay.style.width = `${w}px`
      overlay.style.height = `${h}px`
    }
    const ctx = overlay.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    // ── CORE / CW / PW, on the pane ───────────────────────────────────────────
    // ABOVE the bubble early-return, for the same reason the rail sink is: this
    // is its own layer with its own switch, and the card that has turned the
    // bubbles off is exactly the one that still wants the three levels.
    //
    // A TAG ONLY — no line. Left edge, not right: the price scale is on the
    // right and the rail after it, so a tag over there would sit on the axis
    // labels and beside a rail row saying the same thing.
    //
    // The dashed hairline that used to run with each tag is gone. Three of them
    // across a pane already carrying candles, bubbles and a heatmap was three
    // more horizontals competing with the price action, and none of them said
    // anything the tag does not: the tag sits AT the level, so the height is
    // the line. What the line did carry, and the tag did not, was the number —
    // you could see where the wall was but not what it was without reading it
    // off the axis. So the price rides in the tag now, formatted exactly as the
    // price scale formats it (2dp), and the line is not needed to connect them.
    if (levels) {
      ctx.save()
      ctx.font = '700 9px ui-sans-serif, system-ui, sans-serif'
      ctx.textBaseline = 'middle'
      // The plot only. Below plotH is the time axis, where a level line would
      // be drawing across the clock.
      ctx.beginPath()
      ctx.rect(0, 0, plotW, plotH)
      ctx.clip()
      for (const [key, label] of [
        ['cb', 'CORE'],
        ['cw', 'CW'],
        ['pw', 'PW'],
      ] as Array<[keyof ChartLevels, string]>) {
        const price = levels[key]
        if (price == null || !(price > 0)) continue
        const yRaw = yOfPrice(price)
        if (yRaw == null) continue
        // Half-pixel, so a 1px line is one crisp row rather than two grey ones.
        const y = Math.round(yRaw) + 0.5
        if (y < 0 || y > plotH) continue
        const ink = levelInk[key]

        // `${name} ${price}` in one chip. Same 2dp the price scale uses, so the
        // tag and the axis cannot read as two different numbers.
        const text = `${label} ${price.toFixed(2)}`
        const tw = ctx.measureText(text).width
        ctx.fillStyle = ink
        ctx.fillRect(2, y - 6, tw + 6, 12)
        ctx.fillStyle = appInk
        ctx.fillText(text, 5, y + 0.5)
      }
      ctx.restore()
    }

    if (!drawOpts.on || !snaps.length) {
      // Off, or nothing loaded yet. Neither is "out of range" — the note exists
      // to explain an EMPTY layer that has data, not a layer that is switched
      // off or still loading.
      reportOutOfRange(false)
      return
    }

    // Bar width in pixels at this zoom. Read once per frame — it is cached model
    // state, not a layout read, but it is asked for on every mark otherwise.
    let barSpacing = 6
    try {
      barSpacing = ts.options().barSpacing ?? 6
    } catch {
      /* mid-teardown; the frame is about to be cancelled anyway */
    }

    const geo = {
      // ── A BUCKET SITS ON ITS CANDLE ────────────────────────────────────────
      // Anchor on the bar that CONTAINS the instant, then offset by the sub-bar
      // fraction. timeToCoordinate() returns that bar's CENTRE, so a bucket
      // whose timestamp is a bar's open lands dead on the candle, and a 1m
      // bucket inside a 15m bar lands proportionally across it.
      //
      // ── Do not "simplify" this back to timeToCoordinate(ms) ────────────────
      // It answers only for timestamps that are literally IN the series — it
      // does not interpolate — and the GEX history is per minute while the
      // candles are 5m or coarser, so a bucket almost never lands on a bar and
      // the layer vanished intermittently on nothing more than whether it did.
      // That is what the caller used to work around by binary-searching
      // coordinateToTime(), and that search is what put every mark half a bar
      // off its candle. Both problems are this function's job now.
      xOfTime: (ms: number) => {
        const start = barAt(ms)
        if (start == null) return null
        const c0 = ts.timeToCoordinate(Math.floor(start / 1000) as UTCTimestamp)
        if (c0 == null) return null // off the scale, or a bar the series dropped
        const frac = Math.max(0, Math.min(1, (ms - start) / intervalMs))
        return (c0 as number) + frac * barSpacing
      },
      // NOT the inverse — coordinateToTime() reports the NEAREST bar's time, so
      // it is a step function, constant across a bar. Good enough to pick an
      // anchor near the middle of the pane, which is all the bubble layer asks
      // it for; placing a mark with it is the bug described above.
      timeAtX: (x: number) => {
        const t = ts.coordinateToTime(x as Coordinate)
        return typeof t === 'number' ? t * 1000 : null
      },
      yOfPrice,
      width: w,
      height: h,
      plotWidth: plotW,
      plotHeight: plotH,
    }
    // The bucket is NOT measured here any more — it is the bar interval, set on
    // the click by reportBucket(). The draw loop's only remaining size decision
    // is the stride, which drawBubbles measures for itself.
    //
    // The last argument is the PIN, and it must stay the pin. It loosens the
    // stride to BUBBLES.pinnedPxPerDot (2.5px), and for a few hours this said
    // `true` unconditionally, on the theory that an interval-driven bucket is a
    // chosen cadence too. It is — but the loosened stride is a size decision,
    // not a cadence one: at 2.5px a 1m bucket keeps every minute, the spacing
    // bound (capOfSpacing x pxPerDot) then crushes every mark onto minPx, and on
    // any window past ~2h all four rows of a bucket drew at 1.2px. That is the
    // whole size signal gone. The interval still moves the bubbles either way,
    // because the BUCKET is what changed; the stride only decides how many of
    // them are legible, and 11px is the answer to that.
    const drew = drawBubbles(ctx, snaps, geo, palette, drawOpts.bubbleScale, drawOpts.bucketMin != null)
    reportOutOfRange(!drew)
  }
  raf = requestAnimationFrame(draw)

  return {
    setBars(bars, reframe = false) {
      // ── An empty payload is "no answer", not "no bars" ─────────────────────
      // `parseCandles` returns [] for undefined, and the card holds undefined
      // whenever the query cache has no value for the URL — including right
      // after a failed fetch, because query()'s catch writes `value: undefined`
      // over the good one it was holding. Passing that straight through wiped
      // the series and then repopulated it a moment later with a different bar
      // count, which is precisely how a visible range ends up stranded (see
      // reanchorIfStranded). Keep what is drawn and wait for a real answer.
      // …unless `reframe` is set. That flag means the card's CONTEXT changed —
      // a new symbol, interval or session — and an empty payload there is not a
      // failed poll, it is "the new thing has not answered yet". Holding the old
      // bars through it would draw one ticker's candles under another ticker's
      // heading, which is worse than a blank pane for a few hundred ms.
      if (!bars.length && barCount > 0 && !reframe) return

      // ── A REFRAME MEANS THE PREVIOUS CONTEXT IS GONE ───────────────────────
      // `synth` is a forming bar this chart INVENTED from the live price of the
      // symbol that was on screen a moment ago. It has to die with that symbol.
      //
      // Carried across a switch it gets handed straight back below: the new
      // tape's newest CLOSED bar can easily sit exactly one interval behind the
      // invented one (the ETF route publishes a symbol's bar a beat later than
      // the socket's SPX print), which is precisely the `synth.openMs ===
      // live.openMs + intervalMs` case — so an SPX-priced candle is appended to
      // a SOXL series. The pane then autoscales 0–9000, every real candle
      // flattens onto the floor, and the last-value label reads the OLD
      // symbol's price until the 30s candle poll finally advances `live` past
      // it and clears the invention. "Switch SPX -> SOXL, chart stays on the
      // SPX price for half a minute" was exactly this.
      //
      // Only on `reframe`. A plain poll must still hand the invented bar back —
      // that is the whole reason it is held separately from `live`.
      if (reframe) synth = null

      const prevCount = barCount
      barCount = bars.length
      // The bubble layer positions every bucket against this. It must be the
      // SAME list the series gets, and it must be replaced here rather than
      // merged, so a bar the poll dropped stops being a place a bucket can land.
      barTimes = bars.map((b) => b.t)
      version++
      series.setData(
        bars.map((b) => ({
          time: Math.floor(b.t / 1000) as UTCTimestamp,
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
        })),
      )
      const last = bars[bars.length - 1]
      live = last
        ? { time: Math.floor(last.t / 1000) as UTCTimestamp, openMs: last.t, open: last.o, high: last.h, low: last.l, close: last.c }
        : null

      // ── Hand the invented forming bar back ─────────────────────────────────
      // `setData` above replaced the whole series, so a bar this chart was
      // drawing that the feed has not published yet is now gone from it. If the
      // clock is still inside that bar, put it back with the high and low it
      // had accumulated — dropping them would restart the candle's range on
      // every poll, and the poll runs every 30 seconds.
      //
      // Retired the moment the feed catches up: once a real bar covers that
      // open (or a later one), the published bar is the truth and the invention
      // has nothing left to say.
      if (synth && live && synth.openMs <= live.openMs) synth = null
      if (synth && Date.now() < synth.openMs + intervalMs && live && synth.openMs === live.openMs + intervalMs) {
        live = synth
        barCount++
        series.update({ time: synth.time, open: synth.open, high: synth.high, low: synth.low, close: synth.close })
      } else if (synth) {
        synth = null
      }
      // The re-added forming bar is a bar the bubble layer can place against.
      syncLiveBarTime()
      pickProbes()
      if (reframe && bars.length) {
        try {
          series.priceScale().applyOptions({ autoScale: true })
        } catch {
          /* the scale is gone; frameRecent below still frames the time axis */
        }
        frameRecent()
        ensureLatestVisible()
      } else {
        reanchorIfStranded(prevCount)
      }
      checkOffscreen()
    },
    setLivePrice(price) {
      if (!live || !Number.isFinite(price) || price <= 0) return
      // ── Has the bar this is extending already closed? ──────────────────────
      // It usually HAS. The candle feed hands over CLOSED bars only, so `live`
      // is the last FINISHED bar and `openMs + intervalMs` is already in the
      // past the moment it arrives. The old guard returned here on that, which
      // meant that on a 1m chart every live tick was dropped and the price only
      // ever moved when the 30s poll landed — the whole point of this method,
      // silently inert on the timeframe it matters most on.
      //
      // So OPEN THE NEXT BAR instead of going quiet. Stepping one interval from
      // the last bar's own open keeps the new bar on the feed's grid whatever
      // that grid is anchored to (09:30 ET for 15m and coarser), which is what
      // the original note was right to be careful about — it is guessing an
      // ABSOLUTE boundary that gets 15m/30m/60m wrong, not a relative one.
      //
      // Strictly the NEXT bar, never a later one: if more than one interval has
      // elapsed there is a gap — an overnight, a halt, a tab asleep — and the
      // honest answer is to wait for the poll rather than paint a bar over it.
      const now = Date.now()
      if (now >= live.openMs + intervalMs) {
        const nextOpen = live.openMs + intervalMs
        if (now >= nextOpen + intervalMs) return
        // ── THE OPEN IS THE PREVIOUS CLOSE, not the first tick we happened to
        // see ─────────────────────────────────────────────────────────────────
        // Seeding o=h=l=c from the arriving price makes the bar a function of
        // WHEN THIS TAB STARTED WATCHING: reload the page mid-minute and the
        // forming candle begins again from whatever price was printing at that
        // instant, and two tabs open a few seconds apart disagree about a bar
        // they can both see. That is the refresh symptom.
        //
        // The previous bar's close is a function of the DATA, so every tab
        // reconstructs the same bar from the same closed history however late it
        // arrives. It is also the honest continuation of an intraday series —
        // the true open is the first trade of the minute, which nobody watching
        // from the middle of it can know, and on a continuous session it is the
        // prior close to within a tick. The high and low then take the ticks
        // this tab HAS seen, so a late loader gets a narrower range rather than
        // a wrong one, and the poll replaces the whole bar with the published
        // truth a few seconds after it closes.
        const open = live.close
        live = {
          time: Math.floor(nextOpen / 1000) as UTCTimestamp,
          openMs: nextOpen,
          open,
          high: Math.max(open, price),
          low: Math.min(open, price),
          close: price,
        }
        synth = live
        barCount++
        syncLiveBarTime()
        // A bump HERE only — once an interval, not once a tick. A new bar moves
        // the time axis, and the bubble band is positioned against it.
        version++
        series.update({ time: live.time, open: live.open, high: live.high, low: live.low, close: live.close })
        checkOffscreen()
        return
      }
      if (price === live.close) return
      live.close = price
      if (price > live.high) live.high = price
      if (price < live.low) live.low = price
      // Deliberately NO version bump. The bubble band and the rail are drawn
      // from `snaps` and the price scale — never from the forming bar — so a
      // tick is not a reason to repaint them. If the tick DOES move the scale
      // (a new high autoscales the pane), viewSignature() sees that on its own
      // and the frame draws anyway. Bumping here instead forced a full-band
      // redraw on every quote, several times a second, forever.
      series.update({ time: live.time, open: live.open, high: live.high, low: live.low, close: live.close })
    },
    setIntervalMs(ms) {
      if (ms > 0) intervalMs = ms
      // The interval IS the bubble cadence, so the bucket is re-picked here and
      // not on the next frame — the model rebuild starts on the click.
      reportBucket()
    },
    setSnapshots(next) {
      snaps = next
      version++
      // The probe points come out of the data, so a new ladder needs new ones —
      // otherwise the signature is computed against strikes that are no longer
      // on the chart and can stop changing when the view does.
      pickProbes()
    },
    setDrawOpts(next) {
      drawOpts = next
      version++
      // `bucketMin` is the manual override of the same value.
      reportBucket()
    },
    setRailSink(sink) {
      railSink = sink
      version++
    },
    setLevels(next) {
      levels = next
      // `version` is in the frame signature, so this is what makes the layer
      // repaint on a toggle or a new ladder. Without it the frame is identical
      // to the last one and the draw loop skips it — the tags would appear
      // whenever something ELSE happened to move the chart.
      version++
    },
    scrollToNow() {
      try {
        ts.scrollToRealTime()
      } catch {
        try {
          ts.fitContent()
        } catch {
          /* the chart is gone; nothing to re-frame */
        }
      }
    },
    destroy() {
      for (const t of ensureTimers) clearTimeout(t)
      ensureTimers = []
      railSink = null
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
      ro.disconnect()
      cancelAnimationFrame(raf)
      try {
        ts.unsubscribeVisibleLogicalRangeChange(checkOffscreen)
      } catch {
        /* already torn down */
      }
      overlay.remove()
      chart.remove()
    },
  }
}
