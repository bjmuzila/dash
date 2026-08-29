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
// takes colour STRINGS, not classNames. Fallbacks in cssVar() exist only for
// the case where the stylesheet has not applied yet — they are not a second
// palette and must never diverge from tokens.css.
//
// NO BASIS CONVERSION. Every symbol v3 charts is charted against its own
// strikes, so a GEX bubble is drawn at the strike price directly. The whole
// /proxy/es-spx-basis path existed for one symbol — ES, whose price axis was
// futures while its strikes were SPX cash — and went with it when the futures
// were dropped.
// ─────────────────────────────────────────────────────────────────────────────

import type { Coordinate, IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts'
import type { Bar } from './candles'
import { drawBubbles, type BubbleSnapshot, type BubblePalette } from './bubbles'

function cssVar(el: HTMLElement, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  return v || fallback
}

/** '#rrggbb' → [r,g,b]. Canvas needs a per-mark alpha, which a token cannot carry. */
function hexToRgb(hex: string, fallback: [number, number, number]): [number, number, number] {
  const digits = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1]
  if (!digits) return fallback
  const n = parseInt(digits, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export interface ChartDrawOpts {
  /** The only bubble setting there is. Everything else is BUBBLES in settings. */
  on: boolean
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
   * It EXTENDS the last bar, and never invents a new one. Bars above 5m are
   * anchored to 09:30 ET, so guessing the next boundary here would put a bar in
   * the wrong place on exactly the intervals where that is most visible; once
   * the last bar's window has elapsed this goes quiet and waits for the poll to
   * bring the real next bar.
   */
  setLivePrice: (price: number) => void
  /** Bar width in ms — needed to know when the last bar has stopped forming. */
  setIntervalMs: (ms: number) => void
  setSnapshots: (snaps: BubbleSnapshot[]) => void
  setDrawOpts: (opts: ChartDrawOpts) => void
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
   * Fired when the bubble layer starts, or stops, having anything to draw in
   * the visible window — zoomed or panned off the end of the GEX history.
   * Called ONLY on a change, so it is safe to hold in React state; the draw
   * loop itself never sets state (AGENTS.md rule 4).
   */
  onBubblesOutOfRange: (out: boolean) => void
}

export async function mountEsChart(container: HTMLElement, mountOpts: MountOpts): Promise<EsChartHandle> {
  const { createChart, CandlestickSeries, ColorType, CrosshairMode } = await import('lightweight-charts')

  const line = cssVar(container, '--color-line', '#23272e')
  const muted = cssVar(container, '--color-muted', '#ffffff')
  const up = cssVar(container, '--color-candle-up', '#30d158')
  const down = cssVar(container, '--color-candle-down', '#ff5b5b')
  const palette: BubblePalette = {
    pos: hexToRgb(cssVar(container, '--color-gex-pos', '#29b6f6'), [41, 182, 246]),
    posHot: hexToRgb(cssVar(container, '--color-gex-pos-hot', '#c8f5ff'), [200, 245, 255]),
    neg: hexToRgb(cssVar(container, '--color-gex-neg', '#ff4757'), [255, 71, 87]),
    negHot: hexToRgb(cssVar(container, '--color-gex-neg-hot', '#ffcdd2'), [255, 205, 210]),
  }

  const chart: IChartApi = createChart(container, {
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: muted,
      fontSize: 11,
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
  container.appendChild(overlay)

  let snaps: BubbleSnapshot[] = []
  let barCount = 0
  let drawOpts: ChartDrawOpts = { on: true }
  let railSink: RailSink | null = null
  let raf = 0
  // The forming bar, kept here so a live tick can extend it without going back
  // through React. `openMs` is its wall-clock open, which is what decides
  // whether it is still forming; `time` is the seconds value the series is
  // keyed by.
  let live: { time: UTCTimestamp; openMs: number; open: number; high: number; low: number; close: number } | null = null
  let intervalMs = 5 * 60_000

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
  const measure = () => {
    boxW = Math.max(1, Math.round(container.clientWidth))
    boxH = Math.max(1, Math.round(container.clientHeight))
    try {
      plotH = Math.max(1, boxH - ts.height())
    } catch {
      plotH = boxH
    }
  }
  measure()
  const ro = new ResizeObserver(measure)
  ro.observe(container)

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
    return `${version}|${boxW}|${boxH}|${from}|${to}|${px(y0)}|${px(y1)}`
  }

  function draw() {
    raf = requestAnimationFrame(draw)
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
    if (!drawOpts.on || !snaps.length) {
      // Off, or nothing loaded yet. Neither is "out of range" — the note exists
      // to explain an EMPTY layer that has data, not a layer that is switched
      // off or still loading.
      reportOutOfRange(false)
      return
    }

    const drew = drawBubbles(
      ctx,
      snaps,
      {
        xOfTime: (ms) => {
          const x = ts.timeToCoordinate(Math.floor(ms / 1000) as UTCTimestamp)
          return x == null ? null : (x as number)
        },
        // The inverse. This is what lets the layer step in PIXELS and then ask
        // "what was the gamma here", instead of walking bars — the one change
        // that makes the band look the same on 1m and 5m.
        timeAtX: (x) => {
          const t = ts.coordinateToTime(x as Coordinate)
          return typeof t === 'number' ? t * 1000 : null
        },
        yOfPrice,
        width: w,
        height: h,
      },
      palette,
    )
    reportOutOfRange(!drew)
  }
  raf = requestAnimationFrame(draw)

  return {
    setBars(bars, reframe = false) {
      barCount = bars.length
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
      pickProbes()
      if (reframe && bars.length) {
        try {
          series.priceScale().applyOptions({ autoScale: true })
        } catch {
          /* the scale is gone; fitContent below still frames the time axis */
        }
        try {
          ts.fitContent()
        } catch {
          /* nothing to frame */
        }
      }
      checkOffscreen()
    },
    setLivePrice(price) {
      if (!live || !Number.isFinite(price) || price <= 0) return
      // Only while the bar is genuinely still open. Past that, a REST poll owns
      // the next bar — see the note on this method in EsChartHandle.
      if (Date.now() >= live.openMs + intervalMs) return
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
    },
    setRailSink(sink) {
      railSink = sink
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
      railSink = null
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
