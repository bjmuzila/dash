import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChartFrame, type ChartHandle } from '@/design/primitives/ChartFrame'
import { useQuery } from '@/data/api'
import { SegGroup, Chip, Slider, Popover, PanelSection, SymbolPicker } from './controls'
import { symbolDef } from './symbols'
import {
  BUBBLE_CURVE_RANGE,
  BUBBLE_INTENSITY_RANGE,
  BUBBLE_LADDER_REQUEST,
  BUBBLE_LEVELS_RANGE,
  BUBBLE_SIZE_RANGE,
  GEX_HISTORY_MINUTES,
  INTERVALS,
  INTERVAL_LABEL,
  loadSettings,
  saveSettings,
  type ChartSettings,
  type Interval,
} from './settings'
import { candlesUrl, filterSession, fmtCountdown, parseCandles, rollup, type Bar } from './candles'
import { gexHistoryUrl, parseGexHistory, strikeStep } from './gexHistory'
import { buildBubbleModel } from './bubbles'
import { mountEsChart, type EsChartHandle } from './chart'

// ─────────────────────────────────────────────────────────────────────────────
// ES Candles — v2's chart rebuilt for v3, scoped to GEX BUBBLES ONLY.
//
// What came across: the candle colours (the same two hex values, now tokens),
// the RTH/ETH switch, the interval picker, the searchable watchlist dropdown
// with favourites, the full bubble settings panel, the forming-bar countdown
// top-right and the jump-to-current-candle button bottom-right.
//
// What deliberately did NOT: the gamma HEATMAP, the replay transport, EMAs,
// Bollinger, RSI, volume, the profile/TPO overlays, the multi-chart dock and
// the screenshot/Discord pipeline. v2's EsChartCard is ~376KB of source; this
// card's whole route chunk has an 80kb brotli ceiling in budgets.json. "Only
// GEX bubbles" is what makes the two facts compatible.
//
// ── The data path, all fired in parallel at mount ────────────────────────────
//   candles   /api/snapshots/candles (ES/NQ) or /api/snapshots/etf-candles
//   expiry    /api/expirations — needed only to satisfy the history route's
//             required `expiry` param, which is then overridden by anyExpiry=1
//   bubbles   /api/snapshots/option-strike-gex-history?mode=heatmap
//   basis     /proxy/es-spx-basis — ES only
//
// The bubble request depends on the expiry, which is the one genuine
// dependency in the set and therefore the one place a second round trip is
// unavoidable. It is a small cached call fired from this card's own effect —
// not a child fetching after a parent resolved, which is the waterfall shape
// AGENTS.md bans.
// ─────────────────────────────────────────────────────────────────────────────

const CARD_ID = 'es-candles'

/**
 * The bucket control's values are strings because a segmented control's values
 * are strings; the SETTING is `1 | 5 | 'bar'` because a bucket is a duration.
 * The two conversions live here rather than inline so the union stays typed at
 * both ends instead of collapsing to `string` at the widget boundary.
 */
type BucketOpt = 'bar' | '1' | '5'

/** Wires an EsChartHandle to a <ChartFrame>, buffering setters until it mounts. */
function useEsChart(onLatestOffscreen: (off: boolean) => void) {
  const handleRef = useRef<EsChartHandle | null>(null)
  const pending = useRef<Array<(h: EsChartHandle) => void>>([])
  const offRef = useRef(onLatestOffscreen)
  offRef.current = onLatestOffscreen

  const apply = useCallback((fn: (h: EsChartHandle) => void) => {
    const h = handleRef.current
    if (h) fn(h)
    else pending.current.push(fn)
  }, [])

  const onMount = useCallback((frame: ChartHandle): (() => void) => {
    let cancelled = false
    void mountEsChart(frame.el, { onLatestOffscreen: (off) => offRef.current(off) }).then((created) => {
      if (cancelled) {
        created.destroy()
        return
      }
      handleRef.current = created
      // Replay whatever the card asked for while the dynamic import was in
      // flight, so the first paint is never a blank chart that fills in later.
      for (const fn of pending.current) fn(created)
      pending.current = []
    })
    return () => {
      cancelled = true
      handleRef.current?.destroy()
      handleRef.current = null
      pending.current = []
    }
  }, [])

  return { onMount, apply }
}

interface ExpirationsResponse {
  data?: { items?: Array<{ 'expiration-date'?: string }> }
}
interface BasisResponse {
  basis?: number | null
}

/** ES carries a POSITIVE carry basis to SPX. Mirrors server-v2/es-spx-basis.js. */
function isPlausibleBasis(b: unknown): b is number {
  return typeof b === 'number' && Number.isFinite(b) && b > 0 && b < 250
}

export function EsCandlesCard() {
  const [settings, setSettings] = useState<ChartSettings>(() => loadSettings(CARD_ID))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [latestOffscreen, setLatestOffscreen] = useState(false)
  const countdownRef = useRef<HTMLSpanElement | null>(null)
  const barsRef = useRef<Bar[]>([])

  const patch = useCallback((p: Partial<ChartSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...p }
      saveSettings(CARD_ID, next)
      return next
    })
  }, [])

  const def = useMemo(() => symbolDef(settings.symbol), [settings.symbol])
  const chainTicker = def.gexSymbol.replace(/^\$/, '')

  // ── Fetches ────────────────────────────────────────────────────────────────
  const candlesQ = useQuery<unknown>(candlesUrl(def, settings.interval), { staleMs: 25_000 })
  const expiryQ = useQuery<ExpirationsResponse>(`/api/expirations?ticker=${encodeURIComponent(chainTicker)}`, {
    staleMs: 300_000,
  })
  // The true basis moves about a point a day, so a five-minute cache is
  // generous. Only ES needs it: SPX charts cash against cash, and every other
  // symbol charts itself against its own strikes — basis 0 by construction.
  const basisQ = useQuery<BasisResponse>(def.needsBasis ? '/proxy/es-spx-basis' : null, { staleMs: 300_000 })

  const expiry = expiryQ.data?.data?.items?.[0]?.['expiration-date'] ?? ''
  const gexQ = useQuery<unknown>(
    settings.bubblesOn && expiry
      ? gexHistoryUrl(def.gexSymbol, expiry, GEX_HISTORY_MINUTES, BUBBLE_LADDER_REQUEST)
      : null,
    { staleMs: 30_000 },
  )

  // ── Derived ────────────────────────────────────────────────────────────────
  const bars = useMemo(() => {
    const raw = parseCandles(def.candleSource, candlesQ.data)
    return filterSession(rollup(raw, settings.interval), settings.session)
  }, [candlesQ.data, def.candleSource, settings.interval, settings.session])

  barsRef.current = bars

  const columns = useMemo(() => parseGexHistory(gexQ.data), [gexQ.data])
  const step = useMemo(() => strikeStep(columns), [columns])

  const frames = useMemo(
    () =>
      buildBubbleModel(columns, {
        bucket: settings.bubbleBucket,
        metric: settings.gexMetric,
        levels: settings.bubbleLevels,
        barTimes: bars.map((b) => b.t),
        intervalMs: settings.interval * 60_000,
      }),
    [columns, bars, settings.bubbleBucket, settings.gexMetric, settings.bubbleLevels, settings.interval],
  )

  const basis = def.needsBasis ? (isPlausibleBasis(basisQ.data?.basis) ? basisQ.data!.basis! : null) : 0
  const basisMissing = def.needsBasis && basis == null && !basisQ.loading

  // ── Chart ──────────────────────────────────────────────────────────────────
  const { onMount, apply } = useEsChart(setLatestOffscreen)

  useEffect(() => apply((h) => h.setBars(bars)), [bars, apply])
  useEffect(() => apply((h) => h.setFrames(frames)), [frames, apply])
  useEffect(() => apply((h) => h.setStrikeStep(step)), [step, apply])
  useEffect(() => apply((h) => h.setBasis(basis)), [basis, apply])
  useEffect(
    () =>
      apply((h) =>
        h.setDrawOpts({
          on: settings.bubblesOn,
          size: settings.bubbleSize,
          curve: settings.bubbleCurve,
          intensity: settings.bubbleIntensity,
        }),
      ),
    [settings.bubblesOn, settings.bubbleSize, settings.bubbleCurve, settings.bubbleIntensity, apply],
  )

  // ── Countdown ──────────────────────────────────────────────────────────────
  // Written straight to the DOM node on a 1s interval, deliberately NOT through
  // React state: a once-a-second re-render of this card would re-run every memo
  // above it and hand the chart a new bar array sixty times a minute.
  useEffect(() => {
    const el = countdownRef.current
    if (!el) return
    if (!settings.countdown) {
      el.textContent = ''
      return
    }
    const ms = settings.interval * 60_000
    const tick = () => {
      const node = countdownRef.current
      if (!node) return
      const list = barsRef.current
      const last = list.length ? list[list.length - 1].t : 0
      if (!last) {
        node.textContent = ''
        return
      }
      const elapsed = Date.now() - last
      node.textContent = elapsed < 0 ? '' : fmtCountdown(ms - (elapsed % ms))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [settings.countdown, settings.interval])

  const error = candlesQ.error
  const empty = !error && bars.length === 0
  const bucketValue: BucketOpt =
    settings.bubbleBucket === 'bar' ? 'bar' : settings.bubbleBucket === 1 ? '1' : '5'

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-1">
      {/* ── Toolbar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <SymbolPicker active={settings.symbol} onSelect={(s) => patch({ symbol: s })} />
        <SegGroup
          title="Bar interval"
          options={INTERVALS.map((i) => ({ label: INTERVAL_LABEL[i], value: String(i) }))}
          value={String(settings.interval)}
          onChange={(v) => patch({ interval: Number(v) as Interval })}
        />
        <SegGroup
          title="Session — RTH is the New York cash session (9:30am–4:00pm ET); ETH adds the overnight"
          options={[
            { label: 'RTH', value: 'rth' },
            { label: 'ETH', value: 'eth' },
          ]}
          value={settings.session}
          onChange={(v) => patch({ session: v })}
        />
        <div className="relative ml-auto shrink-0">
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            title="Bubble settings"
            className="rounded-sm border border-line px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted hover:bg-raised hover:text-fg"
          >
            ⚙ Bubbles
          </button>
          <Popover open={settingsOpen} onClose={() => setSettingsOpen(false)}>
            <div className="flex w-64 flex-col gap-2">
              <PanelSection title="Layer">
                <div className="flex flex-wrap gap-1">
                  <Chip
                    label="Bubbles"
                    on={settings.bubblesOn}
                    onClick={() => patch({ bubblesOn: !settings.bubblesOn })}
                    title="Draw the GEX ladder over the candles"
                  />
                  <Chip
                    label="Countdown"
                    on={settings.countdown}
                    onClick={() => patch({ countdown: !settings.countdown })}
                    title="Time left in the forming bar"
                  />
                </div>
              </PanelSection>

              {settings.bubblesOn && (
                <>
                  <PanelSection title="Bubbles">
                    <Slider
                      label="levels"
                      value={settings.bubbleLevels}
                      min={BUBBLE_LEVELS_RANGE.min}
                      max={BUBBLE_LEVELS_RANGE.max}
                      step={1}
                      format={(v) => v.toFixed(0)}
                      onChange={(v) => patch({ bubbleLevels: Math.round(v) })}
                      title="How many strikes draw per column, ranked by their peak |GEX| across the whole session — so a level keeps its trail even after it drops out of the current top N"
                    />
                    <Slider
                      label="size"
                      value={settings.bubbleSize}
                      min={BUBBLE_SIZE_RANGE.min}
                      max={BUBBLE_SIZE_RANGE.max}
                      step={0.05}
                      format={(v) => `${v.toFixed(2)}×`}
                      onChange={(v) => patch({ bubbleSize: v })}
                      title="Scales the whole ladder at once — the ratio between the wall and the smallest strike is identical at every setting. At or below 1.00× marks never touch; above it they may overlap, which is the trade for bigger marks on a tight chart"
                    />
                    <Slider
                      label="top"
                      value={settings.bubbleCurve}
                      min={BUBBLE_CURVE_RANGE.min}
                      max={BUBBLE_CURVE_RANGE.max}
                      step={0.05}
                      format={(v) => (v <= 1.001 ? 'flat' : v.toFixed(2))}
                      onChange={(v) => patch({ bubbleCurve: v })}
                      title="How hard the biggest levels pull away from the rest. At 'flat' the radius is straight proportional to |net GEX|"
                    />
                    <Slider
                      label="intensity"
                      value={settings.bubbleIntensity}
                      min={BUBBLE_INTENSITY_RANGE.min}
                      max={BUBBLE_INTENSITY_RANGE.max}
                      step={0.05}
                      format={(v) => `${Math.round(v * 100)}%`}
                      onChange={(v) => patch({ bubbleIntensity: v })}
                      title="Overall opacity of the bubble layer. The magnitude gradient runs underneath it"
                    />
                  </PanelSection>

                  <PanelSection title="Bucket">
                    <SegGroup<BucketOpt>
                      title="How much clock time one column of bubbles covers"
                      options={[
                        { label: 'Bar', value: 'bar' },
                        { label: '1m', value: '1' },
                        { label: '5m', value: '5' },
                      ]}
                      value={bucketValue}
                      onChange={(v) => patch({ bubbleBucket: v === 'bar' ? 'bar' : v === '1' ? 1 : 5 })}
                    />
                  </PanelSection>

                  <PanelSection title="GEX basis">
                    <SegGroup
                      title="Vol+OI is open interest plus today's volume; Vol drops the open interest term"
                      options={[
                        { label: 'Vol+OI', value: 'voloi' },
                        { label: 'Vol', value: 'vol' },
                      ]}
                      value={settings.gexMetric}
                      onChange={(v) => patch({ gexMetric: v })}
                    />
                  </PanelSection>
                </>
              )}
            </div>
          </Popover>
        </div>
      </div>

      {/* ── Status line ── */}
      {error && <span className="shrink-0 text-xs text-down">{error.message}</span>}
      {empty && (
        <span className="shrink-0 text-xs text-muted opacity-70">
          {candlesQ.loading ? 'Loading…' : 'No candles for this symbol yet.'}
        </span>
      )}
      {settings.bubblesOn && basisMissing && (
        <span className="shrink-0 text-[10px] text-warn">
          GEX bubbles hidden — no ES/SPX basis available. Drawing them at strike price would put every level a whole
          basis out.
        </span>
      )}

      {/* ── Chart ── */}
      <div className="relative min-h-0 flex-1">
        <ChartFrame onMount={onMount} className="absolute inset-0" />

        <span
          ref={countdownRef}
          className="tabular pointer-events-none absolute right-16 top-1.5 z-10 font-mono text-[11px] font-extrabold text-accent opacity-90"
        />

        {latestOffscreen && bars.length > 0 && (
          <button
            type="button"
            onClick={() => apply((h) => h.scrollToNow())}
            title="Jump to the current candle — keeps your zoom"
            aria-label="Scroll to the latest candle"
            className="absolute bottom-8 right-16 z-20 flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface text-accent shadow-lg transition-colors hover:bg-raised hover:text-fg"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden focusable="false">
              <path
                d="M4 3.5 8.5 8 4 12.5"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M12 3.5v9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
