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
// ── THE BASIS ────────────────────────────────────────────────────────────────
// On an ES chart the strikes are SPX and the price axis is ES futures. They sit
// ~40-60 points apart, so a bubble drawn at priceToCoordinate(strike) lands
// nowhere near the level it describes — usually clean off the bottom of the
// pane, which is exactly the "the bubbles don't show up" symptom.
//
//     ES price = SPX strike + basis          (basis = ES − SPX, always > 0)
//
// The basis comes from /proxy/es-spx-basis. It is deliberately NOT read off the
// socket: the 'spot'/'aux' frame's `basis` is esFut − spot, which
// server-v2/es-spx-basis.js documents as poisoned — the broker's "SPX" quote
// really tracks ES, so that basis collapses toward zero and then freezes on the
// expired contract across a quarterly roll. v2's EsChartCard demotes the socket
// value to a fourth-choice last resort for the same reason.
//
// A missing basis draws NO bubbles. Falling back to zero would bend every level
// by a whole basis silently, which is strictly worse than a visibly absent
// overlay — the same rule es-spx-basis.js states for its own null return.
// ─────────────────────────────────────────────────────────────────────────────

import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts'
import type { Bar } from './candles'
import { drawBubbles, type BubbleFrame, type BubblePalette } from './bubbles'

function cssVar(el: HTMLElement, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  return v || fallback
}

/** '#rrggbb' → [r,g,b]. Canvas needs a per-mark alpha, which a token cannot carry. */
function hexToRgb(hex: string, fallback: [number, number, number]): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return fallback
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export interface ChartDrawOpts {
  size: number
  curve: number
  intensity: number
  on: boolean
}

export interface EsChartHandle {
  setBars: (bars: Bar[]) => void
  setFrames: (frames: BubbleFrame[]) => void
  /** Strike step of the GEX ladder, for the bubble row-pitch cap. */
  setStrikeStep: (step: number) => void
  /** ES−SPX. null hides the bubble layer entirely; 0 is valid for a cash chart. */
  setBasis: (basis: number | null) => void
  setDrawOpts: (opts: ChartDrawOpts) => void
  /** Re-frame on the newest bar, keeping the user's zoom. */
  scrollToNow: () => void
  destroy: () => void
}

export interface MountOpts {
  /** Fired whenever the newest bar moves on or off screen. */
  onLatestOffscreen: (off: boolean) => void
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
    grid: { vertLines: { color: line }, horzLines: { color: line } },
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
  })

  // A transparent canvas over the chart's own canvas for the bubbles.
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative'
  const overlay = document.createElement('canvas')
  overlay.style.position = 'absolute'
  overlay.style.inset = '0'
  overlay.style.pointerEvents = 'none'
  container.appendChild(overlay)

  let frames: BubbleFrame[] = []
  let basis: number | null = null
  let step = 0
  let barCount = 0
  let drawOpts: ChartDrawOpts = { size: 1, curve: 1, intensity: 1, on: true }
  let raf = 0

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

  // A steady rAF redraw rather than chasing every event that can move the price
  // axis — pan, zoom, autoscale and resize all qualify, and enumerating them
  // one at a time is how an overlay ends up half a pixel behind its chart.
  function draw() {
    raf = requestAnimationFrame(draw)
    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(rect.width))
    const h = Math.max(1, Math.round(rect.height))
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
    if (!drawOpts.on || basis == null || !frames.length) return

    let range: { from: number; to: number } | null = null
    let plotW = w
    try {
      range = ts.getVisibleLogicalRange()
      plotW = ts.width() || w
    } catch {
      range = null
    }
    const span = range ? range.to - range.from : 0
    const barPitch = span > 0 ? plotW / span : 0
    if (barPitch <= 0) return

    // Row pitch is measured, not assumed: it is the pixel gap between two
    // adjacent strikes AT THE CURRENT ZOOM, so the same code caps a 5-wide SPX
    // ladder and a 1-wide SPY ladder correctly.
    let rowPitch = 0
    if (step > 0) {
      const probe = frames[0]?.marks[0]?.strike
      if (probe != null) {
        const a = series.priceToCoordinate(probe + basis)
        const b = series.priceToCoordinate(probe + step + basis)
        if (a != null && b != null) rowPitch = Math.abs(a - b)
      }
    }

    drawBubbles(
      ctx,
      frames,
      {
        xOfBar: (barT) => {
          const x = ts.timeToCoordinate((Math.floor(barT / 1000) as UTCTimestamp))
          return x == null ? null : (x as number)
        },
        yOfPrice: (price) => {
          const y = series.priceToCoordinate(price)
          return y == null ? null : (y as number)
        },
        barPitch,
        rowPitch,
        width: w,
        height: h,
      },
      { size: drawOpts.size, curve: drawOpts.curve, intensity: drawOpts.intensity, basis },
      palette,
    )
  }
  raf = requestAnimationFrame(draw)

  return {
    setBars(bars) {
      barCount = bars.length
      series.setData(
        bars.map((b) => ({
          time: Math.floor(b.t / 1000) as UTCTimestamp,
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
        })),
      )
      checkOffscreen()
    },
    setFrames(next) {
      frames = next
    },
    setStrikeStep(next) {
      step = next
    },
    setBasis(next) {
      basis = next
    },
    setDrawOpts(next) {
      drawOpts = next
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
