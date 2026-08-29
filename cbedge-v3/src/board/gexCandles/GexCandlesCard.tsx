import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChartFrame, type ChartHandle } from '@/design/primitives/ChartFrame'
import { CardToolbar } from '@/design/primitives/Card'
import { useQuery } from '@/data/api'
import { usePageSymbol } from '@/data/symbol'
import { watchFrame } from '@/data/hooks'
import type { SpotFrame } from '@/contract/frames'
import { SegGroup, Chip, Popover, PanelSection, Dropdown } from './controls'
import { chainTicker, symbolDef } from './symbols'
import {
  BUBBLE_LADDER_REQUEST,
  BUBBLES,
  GEX_HISTORY_MINUTES,
  GEX_HISTORY_MINUTES_PREV_DAY,
  INTERVALS,
  INTERVAL_LABEL,
  loadSettings,
  saveSettings,
  type ChartSettings,
  type Interval,
} from './settings'
import { candlesUrl, filterSession, fmtCountdown, parseCandles, rollup, type Bar } from './candles'
import {
  etDay,
  etDayLong,
  etDayShort,
  filterByDay,
  gexHistoryUrl,
  parseGexHistory,
  sessionDays,
  type GexDay,
} from './gexHistory'
import { buildBubbleModel } from './bubbles'
import { buildRail, GexRail } from './GexRail'
import { mountEsChart, type EsChartHandle } from './chart'

// ─────────────────────────────────────────────────────────────────────────────
// GEX Candles — v2's ES chart rebuilt for v3, scoped to GEX BUBBLES ONLY.
//
// What came across: the candle colours (the same two values, now tokens), the
// RTH/ETH switch, the interval picker, the full bubble settings panel, the
// forming-bar countdown top-right and the jump-to-current-candle button
// bottom-right.
//
// NOT the watchlist dropdown. The board has ONE ticker and the toolbar search
// sets it — see src/data/symbol.tsx. A per-card picker is a second place to
// change the same thing and a way to end up reading two symbols side by side
// without noticing.
//
// What deliberately did NOT: the gamma HEATMAP, replay, EMAs, Bollinger, RSI,
// volume, the profile/TPO overlays, the multi-chart dock and the screenshot
// pipeline. v2's EsChartCard is ~376KB of source; this card's whole route chunk
// has an 80kb brotli ceiling in budgets.json. "Only GEX bubbles" is what makes
// the two facts compatible.
//
// ── The data path ────────────────────────────────────────────────────────────
//   candles   /api/snapshots/etf-candles — one route now that ES/NQ are gone
//   expiry    /api/expirations — the dropdown's list, and the default
//   bubbles   /api/snapshots/option-strike-gex-history?mode=heatmap
//
// The bubble request depends on the expiry, which is the one genuine dependency
// in the set and therefore the one place a second round trip is unavoidable —
// the expiry IS the parameter. Both are fired from this card's own effect, not
// by a child mounting after a parent resolved, which is the waterfall shape
// AGENTS.md bans.
//
// ── WHAT MAKES THE BUBBLES SLOW, IF THEY ARE ────────────────────────────────
// The history route returns ONE COLUMN PER MINUTE of the window, so the cost is
// linear in `minutes` and there is no server-side sampling to ask for. Two
// levers, in the order they matter:
//
//   1. `Prev day` (48h vs the session's 12h) — 4× the columns, 4× the payload
//      and 4× the parse. It is a testing-phase switch; turning it off is the
//      first thing to try.
//   2. The expiry. This card used to pass `anyExpiry=1`, which merged EVERY
//      recorded expiry's ladder into each column and made the server walk all
//      of them for the whole window on every poll. It now asks for the one
//      expiry the dropdown names.
//
// There is no basis fetch: every symbol here charts against its own strikes, so
// a bubble goes at the strike price. See the note at the top of symbols.ts.
// ─────────────────────────────────────────────────────────────────────────────

const CARD_ID = 'gex-candles'

const ET_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** `0DTE` / `3DTE` for a YYYY-MM-DD expiry, counted from today ET. */
function dteLabel(expiry: string): string {
  const a = Date.parse(`${ET_DATE.format(new Date())}T12:00:00Z`)
  const b = Date.parse(`${expiry}T12:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return expiry
  return `${Math.max(0, Math.round((b - a) / 86_400_000))}DTE`
}

/**
 * ── THE WEEKEND ─────────────────────────────────────────────────────────────
 *
 * `/api/expirations` lists what is TRADEABLE, so on a Saturday its first entry
 * is Monday. Ask the history route for Monday's expiry and it answers honestly
 * with nothing — Monday has not happened — and the card draws an empty layer all
 * weekend, which is exactly when there is most time to look at it.
 *
 * What you want to see on a Saturday is FRIDAY: the last session that traded,
 * and the expiry its gamma was recorded against. So on a weekend the expiry
 * defaults to the previous Friday's date rather than to the top of the list.
 *
 * That date is not in the expirations list — it has expired — and it does not
 * need to be: the history route takes `expiry` as a plain parameter and the rows
 * are still in the table. This is only a DEFAULT; the dropdown still pins
 * anything the user picks.
 *
 * Weekday behaviour is untouched: the nearest expiry is today's or the next
 * one, and that is what the card should follow.
 */
const ET_WEEKDAY_IDX = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' })
function etWeekendSessionDay(now = new Date()): string {
  const wd = ET_WEEKDAY_IDX.format(now)
  const back = wd === 'Sat' ? 1 : wd === 'Sun' ? 2 : 0
  if (!back) return ''
  // Step back whole ET days from noon UTC, which neither the ET offset nor a DST
  // edge can move onto the wrong date.
  const today = ET_DATE.format(now)
  const t = Date.parse(`${today}T12:00:00Z`) - back * 86_400_000
  return ET_DATE.format(new Date(t))
}

/** Wires an EsChartHandle to a <ChartFrame>, buffering setters until it mounts. */
function useEsChart(
  onLatestOffscreen: (off: boolean) => void,
  onOutOfRange: (out: boolean) => void,
  onBucketMs: (ms: number) => void,
) {
  const handleRef = useRef<EsChartHandle | null>(null)
  const pending = useRef<Array<(h: EsChartHandle) => void>>([])
  const offRef = useRef(onLatestOffscreen)
  offRef.current = onLatestOffscreen
  const oorRef = useRef(onOutOfRange)
  oorRef.current = onOutOfRange
  // Through a ref like the other two: the chart is mounted once and the
  // callbacks it closes over must never be a reason to re-mount it.
  const bucketRef = useRef(onBucketMs)
  bucketRef.current = onBucketMs

  const apply = useCallback((fn: (h: EsChartHandle) => void) => {
    const h = handleRef.current
    if (h) fn(h)
    else pending.current.push(fn)
  }, [])

  const onMount = useCallback((frame: ChartHandle): (() => void) => {
    let cancelled = false
    void mountEsChart(frame.el, {
      onLatestOffscreen: (off) => offRef.current(off),
      onBubblesOutOfRange: (out) => oorRef.current(out),
      onBucketMs: (ms) => bucketRef.current(ms),
    }).then((created) => {
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

export function GexCandlesCard() {
  const [settings, setSettings] = useState<ChartSettings>(() => loadSettings(CARD_ID))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [latestOffscreen, setLatestOffscreen] = useState(false)
  // The bubble layer has data but none of it falls in the visible window. Set
  // from the draw loop, but only when it CHANGES — see onBubblesOutOfRange.
  const [bubblesOutOfRange, setBubblesOutOfRange] = useState(false)
  // One bubble per bucket, and the bucket comes from how wide the visible window
  // is — the chart reports it, debounced to the value itself, so this changes
  // twice a session rather than on every wheel tick.
  const [bucketMs, setBucketMs] = useState(BUBBLES.bucketCoarseMs)
  const countdownRef = useRef<HTMLSpanElement | null>(null)
  const barsRef = useRef<Bar[]>([])

  const patch = useCallback((p: Partial<ChartSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...p }
      saveSettings(CARD_ID, next)
      return next
    })
  }, [])

  // THE PAGE SYMBOL, not a per-card one. The searchable dropdown that used to
  // live in this toolbar is gone: the board has one ticker and the toolbar
  // search is where it is set. `settings.symbol` stays in the stored blob so an
  // older saved setting is not destroyed, but nothing reads it any more.
  const { symbol } = usePageSymbol()
  const def = useMemo(() => symbolDef(symbol), [symbol])

  // ── Fetches ────────────────────────────────────────────────────────────────
  // `pollMs`, not just `staleMs`. staleMs is a cache TTL and never causes a
  // refetch on its own, so without a poll this card would sit on the bars it
  // loaded with for as long as it stayed mounted.
  const candlesQ = useQuery<unknown>(candlesUrl(def, settings.interval), { staleMs: 25_000, pollMs: 30_000 })
  const expiryQ = useQuery<ExpirationsResponse>(
    `/api/expirations?ticker=${encodeURIComponent(chainTicker(def))}`,
    { staleMs: 300_000 },
  )

  // ── Which expiry the bubbles draw ──────────────────────────────────────────
  // A stored expiry only applies if the CURRENT symbol actually lists it —
  // otherwise every symbol change would pin the chart to a date that symbol
  // does not trade. Falling back to the nearest is both the safe answer and the
  // default.
  const expiries = useMemo(
    () =>
      (expiryQ.data?.data?.items ?? [])
        .map((i) => i['expiration-date'] ?? '')
        .filter((e): e is string => Boolean(e)),
    [expiryQ.data],
  )
  // A pinned expiry wins, then the weekend's last traded session, then the
  // nearest tradeable one. `expiries.includes` still guards the pin, so a symbol
  // change cannot leave the card on a date that symbol does not trade.
  const weekendExpiry = useMemo(() => etWeekendSessionDay(), [])
  const expiry = settings.expiry && expiries.includes(settings.expiry)
    ? settings.expiry
    : weekendExpiry || expiries[0] || ''
  // Either layer keeps this alive: the rail reads the newest column of the same
  // history the bubbles are drawn from, so turning the bubbles off with the
  // rail on must not take the request — and its data — away with them.
  // TESTING PHASE: 48h instead of the session's 12, so the layer carries
  // yesterday's ladder too. See GEX_HISTORY_MINUTES_PREV_DAY for what has to go
  // when this is retired.
  // The REACH of the request. Which of the days that come back is drawn is the
  // toolbar day picker's decision, downstream of this and free.
  // ON A WEEKEND THE REACH HAS TO CLEAR THE WEEKEND.
  // 48h is enough on a Saturday and not on a Sunday evening — 48h back from
  // Sunday 20:00 lands at Friday 20:00, four hours after the close, so the card
  // would reach past the whole session it is trying to show and come back with
  // nothing but the frozen post-close book. Ask for the distance to that
  // Friday's pre-open plus an hour, instead of a constant that cannot know what
  // day it is. The route clamps at 5760, which is comfortably above a Sunday.
  const historyMinutes = useMemo(() => {
    if (!weekendExpiry) return settings.prevDay ? GEX_HISTORY_MINUTES_PREV_DAY : GEX_HISTORY_MINUTES
    const preOpen = Date.parse(`${weekendExpiry}T08:00:00Z`) // 04:00 ET, before any session column
    const back = Math.ceil((Date.now() - preOpen) / 60_000) + 60
    return Math.min(5760, Math.max(GEX_HISTORY_MINUTES_PREV_DAY, back))
  }, [weekendExpiry, settings.prevDay])
  const gexQ = useQuery<unknown>(
    (settings.bubblesOn || settings.railOn) && expiry
      ? gexHistoryUrl(def.gexSymbol, expiry, historyMinutes, BUBBLE_LADDER_REQUEST)
      : null,
    // The recorder writes a column a minute, so asking more often than that
    // returns the same ladder twice — and it is the heaviest request the card
    // makes.
    { staleMs: 30_000, pollMs: 60_000 },
  )

  // ── Derived ────────────────────────────────────────────────────────────────
  const bars = useMemo(() => {
    const raw = parseCandles(candlesQ.data)
    return filterSession(rollup(raw, settings.interval), settings.session)
  }, [candlesQ.data, settings.interval, settings.session])

  barsRef.current = bars

  // ── Which session day draws ────────────────────────────────────────────────
  // TESTING PHASE. With `Prev day` on the history spans two sessions and the
  // layer used to draw both with nothing saying so. `days` is what the request
  // actually came back holding, and the toolbar picker names them.
  //
  // The picker filters what is DRAWN; `prevDay` still decides what is FETCHED.
  // Deliberately not folded into one control: narrowing the request to 12h to
  // mean "latest" returns nothing at all on a Saturday, when the newest session
  // is Friday's — which is exactly the weekend this is being tested over.
  const allColumns = useMemo(() => parseGexHistory(gexQ.data), [gexQ.data])
  const days = useMemo(() => sessionDays(allColumns), [allColumns])
  // On a weekend, draw THAT session and nothing else. The recorder republishes
  // the last cash book once a minute all weekend, so without this the trail runs
  // flat across Saturday and Sunday to the right of the close — real rows, and a
  // picture of nothing happening, drawn wider than the day that did happen.
  const weekendColumns = useMemo(
    () => (weekendExpiry ? allColumns.filter((c) => etDay(c.slotTs) === weekendExpiry) : null),
    [allColumns, weekendExpiry],
  )
  const columns = useMemo(
    () => weekendColumns ?? filterByDay(allColumns, settings.bubbleDay, days),
    [weekendColumns, allColumns, settings.bubbleDay, days],
  )

  // Only when there is a choice to make. One session in the data — the finished
  // card's permanent state — and this is empty, so the picker does not render.
  const dayOptions = useMemo(() => {
    if (days.length < 2) return []
    const latest = days[days.length - 1]!
    const prev = days[days.length - 2]!
    return [
      { label: etDayShort(prev), value: 'prev' as GexDay },
      { label: etDayShort(latest), value: 'latest' as GexDay },
      { label: 'Both', value: 'both' as GexDay },
    ]
  }, [days])

  const dayTitle =
    days.length < 2
      ? ''
      : `Which session's GEX the bubbles and the rail draw — the history reaches back ${
          settings.prevDay ? '48h' : '12h'
        } and came back holding ${days.map(etDayLong).join(' and ')}. TESTING PHASE: the finished card draws the current session only`

  // No bars, no interval, no bucket in these deps: the bubble model is a pure
  // function of the GEX history now, so a candle poll or a timeframe change no
  // longer rebuilds it.
  const snapshots = useMemo(
    () =>
      buildBubbleModel(columns, { metric: settings.gexMetric, bucketMs }),
    [columns, settings.gexMetric, bucketMs],
  )

  // Same history, second view: the bubbles say how the ladder got here across
  // the session, the rail says where it stands right now. No extra request.
  const railModel = useMemo(() => buildRail(columns, settings.gexMetric), [columns, settings.gexMetric])

  // On a weekend the default is a date the list does not carry, so it is added
  // at the top — a dropdown whose current value is not one of its own options
  // renders as empty, which reads as broken.
  const expiryOptions = useMemo(() => {
    const opts = expiries.map((e) => ({ value: e, label: dteLabel(e), sub: e.slice(5) }))
    if (weekendExpiry && !expiries.includes(weekendExpiry)) {
      opts.unshift({ value: weekendExpiry, label: 'Fri', sub: weekendExpiry.slice(5) })
    }
    return opts
  }, [expiries, weekendExpiry])

  // ── Chart ──────────────────────────────────────────────────────────────────
  const { onMount, apply } = useEsChart(setLatestOffscreen, setBubblesOutOfRange, setBucketMs)

  // Anything in this key changes the SCALE of the series, so the view has to be
  // re-framed when it does — a symbol switch above all, since SPX at ~6,800 and
  // SPY at ~645 share no price window at all and the old one would leave the
  // new candles off the pane entirely.
  //
  // The key is latched only once real bars arrive. On a symbol change the query
  // cache misses and `bars` is briefly empty; latching on that empty set would
  // spend the reframe on nothing and leave the actual data unframed.
  const viewKey = `${symbol}|${settings.interval}|${settings.session}`
  const framedRef = useRef('')

  useEffect(() => {
    const reframe = viewKey !== framedRef.current
    apply((h) => h.setBars(bars, reframe))
    if (bars.length) framedRef.current = viewKey
  }, [bars, viewKey, apply])

  useEffect(() => apply((h) => h.setSnapshots(snapshots)), [snapshots, apply])
  useEffect(() => apply((h) => h.setIntervalMs(settings.interval * 60_000)), [settings.interval, apply])

  // ── The live price ─────────────────────────────────────────────────────────
  // The candle feed only ever hands over CLOSED bars, so between polls the last
  // candle would sit still. The socket's `spot` frame is the live print, and
  // pushing it into the forming bar is what makes the chart tick.
  //
  // SPX ONLY, deliberately: the socket carries one underlying, and quietly
  // painting SPX's price onto an NVDA chart would be worse than a chart that
  // steps on its poll. Subscribing here is also what puts `spot` into the
  // socket's derived topic scope while this card is mounted.
  //
  // watchFrame, not useField: a price tick must reach the chart's imperative
  // API without re-rendering this component. Rule 4 in AGENTS.md.
  const livePrice = def.gexSymbol === '$SPX'
  useEffect(() => {
    if (!livePrice) return
    return watchFrame<SpotFrame>('spot', (f) => {
      const px = f?.data.spot
      if (typeof px === 'number') apply((h) => h.setLivePrice(px))
    })
  }, [livePrice, apply])

  useEffect(
    () =>
      apply((h) =>
        h.setDrawOpts({ on: settings.bubblesOn }),
      ),
    [settings.bubblesOn, apply],
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
      const last = list[list.length - 1]?.t ?? 0
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

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-1">
      {/* ── Toolbar ──
          Portalled into the Card's header. This card used to draw its own row
          right under that header, so the board showed two bars stacked and the
          chart lost the height of both. */}
      <CardToolbar>
        <Dropdown
          title="Which expiry the GEX bubbles are drawn from. Defaults to the nearest; pinning one keeps it until the symbol changes"
          value={expiry}
          options={expiryOptions}
          onChange={(v) => patch({ expiry: v })}
          empty="expiry"
        />
        {/* TESTING PHASE — see the `days` memo. Renders only while the history
            holds more than one session, which is only ever true with the
            `Prev day` reach on. */}
        {dayOptions.length > 0 && (
          <SegGroup title={dayTitle} options={dayOptions} value={settings.bubbleDay} onChange={(v) => patch({ bubbleDay: v })} />
        )}
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
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            title="Chart layers and bubble settings"
            className="rounded-sm border border-line px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted hover:bg-raised hover:text-fg"
          >
            ⚙ Layers
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
                    label="GEX rail"
                    on={settings.railOn}
                    onClick={() => patch({ railOn: !settings.railOn })}
                    title="The strike ladder down the right-hand side. Every row sits at the same height as its strike on the chart — it reads the chart's own price scale, so it stays level through a pan, a zoom and an autoscale"
                  />
                  <Chip
                    label="Countdown"
                    on={settings.countdown}
                    onClick={() => patch({ countdown: !settings.countdown })}
                    title="Time left in the forming bar"
                  />
                  <Chip
                    label="Prev day"
                    on={settings.prevDay}
                    onClick={() => patch({ prevDay: !settings.prevDay })}
                    title="TESTING PHASE — reach 48h back so yesterday's GEX ladder is available alongside today's. This is the REACH; the day picker in the toolbar chooses which of the two actually draws. The finished card shows the current session on the closest expiration only; this chip, that picker and the constant behind them come out then"
                  />
                </div>
              </PanelSection>

              {/* Outside the bubble gate: the RAIL reads this too, so hiding it
                  with the bubbles would leave the rail's basis unreachable. */}
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

            </div>
          </Popover>
        </div>
      </CardToolbar>

      {/* ── Status line ── */}
      {error && <span className="shrink-0 text-xs text-down">{error.message}</span>}
      {empty && (
        <span className="shrink-0 text-xs text-muted opacity-70">
          {candlesQ.loading ? 'Loading…' : `No candles recorded for ${def.label} yet.`}
        </span>
      )}

      {/* ── Chart + rail ──
          One flex row so the rail is a SIBLING of the chart with the same top
          and the same height. That is what makes the rail's absolute rows and
          the chart's priceToCoordinate share an origin — a rail nested inside
          the chart's own box would be under the crosshair and the pan handler,
          and one offset a padding change away from lying about every strike. */}
      <div className="flex min-h-0 flex-1 gap-1">
        <div className="relative min-h-0 flex-1">
          <ChartFrame onMount={onMount} className="absolute inset-0" />

          <span
            ref={countdownRef}
            className="tabular pointer-events-none absolute right-16 top-1.5 z-10 font-mono text-[11px] font-extrabold text-accent opacity-90"
          />

          {/* An empty bubble layer that HAS data is indistinguishable from a
              broken one, and that ambiguity cost real debugging time. Say it. */}
          {bubblesOutOfRange && settings.bubblesOn && (
            <span className="pointer-events-none absolute left-2 top-1.5 z-10 text-[10px] text-muted opacity-55">
              no GEX history in view
            </span>
          )}

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

        {settings.railOn && <GexRail model={railModel} applyChart={apply} />}
      </div>
    </div>
  )
}
