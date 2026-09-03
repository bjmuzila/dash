import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChartFrame, type ChartHandle } from '@/design/primitives/ChartFrame'
import { CardToolbar } from '@/design/primitives/Card'
import { ReplayDock } from '@/design/primitives/ReplayDock'
import { T } from '@/design/theme'
import { useIsPhone } from '@/design/useIsPhone'
import { useQuery } from '@/data/api'
import { usePageSymbol } from '@/data/symbol'
import { useAuth } from '@/data/auth'
import { watchFrame } from '@/data/hooks'
import type { SpotFrame } from '@/contract/frames'
import { SegGroup, Chip, Popover, PanelSection, Dropdown, Slider } from './controls'
import { chainTicker, symbolDef } from './symbols'

/** What `spxOnly` pins the card to. The one root with both a cash tape and a future. */
const SPX_ONLY_SYMBOL = 'SPX'
import {
  BUBBLE_LADDER_REQUEST,
  BUBBLE_SCALE_MAX,
  BUBBLE_SCALE_MIN,
  BUBBLE_SCALE_STEP,
  BUBBLES,
  GEX_HISTORY_MINUTES,
  INTERVALS,
  INTERVAL_LABEL,
  isAutoBucket,
  loadSettings,
  saveSettings,
  type ChartSettings,
  type Interval,
} from './settings'
import {
  candlesUrl,
  esCandlesUrl,
  etMinutesOfDay,
  filterSession,
  fmtCountdown,
  parseCandles,
  parseEsCandles,
  rollup,
  RTH_CLOSE_MIN,
  RTH_OPEN_MIN,
  type Bar,
} from './candles'
import { etDay, gexHistoryUrl, latestSession, parseGexHistory } from './gexHistory'
import { BASIS_URL, isPlausibleBasis, NO_BASIS, parseBasis, shiftColumns } from './basis'
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
// What deliberately did NOT: the gamma HEATMAP, EMAs, Bollinger, RSI, volume,
// the profile/TPO overlays, the multi-chart dock and the screenshot pipeline.
// v2's EsChartCard is ~376KB of source; this card's whole route chunk has an
// 80kb brotli ceiling in budgets.json. "Only GEX bubbles" is what makes the two
// facts compatible.
//
// ── REPLAY (2026-09-03) ──────────────────────────────────────────────────────
// OPT-IN, via the `replay` prop, and the board does not pass it. `<GexCandles
// Card />` on the board is byte-for-byte the live card it has always been: no
// transport, no toolbar change, no extra request, and every replay hook sits
// inert behind one `replayOn` flag. `<GexCandlesCard replay />` — the Replay
// hub's "GEX candles" tab — mounts already rewound to the session's open.
//
// It costs NOTHING to fetch, which is the reason it could be added at all. This
// card already holds a whole session of candles AND a whole session of per-
// minute GEX ladders in memory — that is what the bubbles ARE. So the replay is
// not a second data path: it is ONE cursor timestamp, and both series are
// clipped to it. `bars.filter(t <= cursor)` and `columns.filter(slotTs <=
// cursor)`, upstream of the bubble model and the rail, so the candles, the
// bubbles and the rail can never disagree about what time it is.
//
// THE CURSOR IS A TIMESTAMP, NOT A BAR INDEX. Switching 1m -> 5m rebuilds the
// timeline with a fifth of the entries; an index would land somewhere unrelated
// while a time stays the same time.
//
// Rewound, the live feeds are OFF — the socket's spot / esCandles frames paint
// the forming bar, and pushing a live print onto a rewound chart would put a
// 15:59 candle on a 10:04 tape. The forming-bar countdown goes with them: there
// is no bar forming in a session that already closed.
//
// ── The data path ────────────────────────────────────────────────────────────
//   candles   /api/snapshots/etf-candles — every symbol on the board
//             …or, with the SPX/ES switch on ES (2026-09-02):
//             /api/snapshots/candles?lite=1 on the same 30s poll, and the
//             socket's esCandles / es1mCandles frame for the forming bar
//   basis     /proxy/es-spx-basis — ES only; see ./basis.ts
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
// Every SYMBOL here charts against its own strikes, so a bubble goes at the
// strike price and there is no basis fetch — except on ES. ES is v2's original
// pairing brought back as a switch on the SPX card rather than as a symbol
// (see symbols.ts): futures candles, SPX gamma, and every strike shifted by the
// ES−SPX basis before it is drawn. When the basis route has nothing usable the
// layer draws UNSHIFTED and the status line says so, because a level quietly
// drawn one basis low is worse than a chart that admits it.
// ─────────────────────────────────────────────────────────────────────────────

const CARD_ID = 'gex-candles'

// ── Replay transport ─────────────────────────────────────────────────────────
// The same numbers and the same key layout as every other v3 transport —
// mgReplay.ts's MG_REPLAY_BASE_MS / MG_REPLAY_SPEEDS and the Ticker Lookup bar.
// Not imported from either: those constants belong to modules this card has no
// other reason to pull in, and the two values are the whole of the shared
// decision. Same reasoning as CB_WASH's twin in the Multi Greek ladder.
/** ms per BAR at 1×. */
const REPLAY_BASE_MS = 700
const REPLAY_SPEEDS = [0.5, 1, 2, 4, 8] as const

/** `HH:MM` in New York — what the transport's clock reads. */
const ET_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

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

/**
 * The close of the newest bar in an `esCandles` / `es1mCandles` frame. The
 * payload is the candle array itself, or `{ candles: [...] }` on older
 * emitters; a delta frame carries only the bars that changed, so "newest" is
 * by timestamp, not by position.
 */
/**
 * One transport key. Local rather than a `Chip`: the dock draws the orange
 * plate, so these have to sit ON it — a Chip's own surface reads as a second
 * plate inside the bar, which is the thing the dock's header note asks bars not
 * to do.
 */
function TransportButton({
  label,
  title,
  on = false,
  disabled = false,
  onClick,
}: {
  label: string
  title: string
  on?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={on}
      disabled={disabled}
      className={[
        'tabular shrink-0 rounded-sm border px-2 py-0.5 font-mono text-2xs font-extrabold leading-none',
        on ? 'border-transparent text-bg' : 'border-line text-fg hover:bg-raised',
        // Dimmed rather than hidden, the way the other transports do it: a key
        // that disappears at the end of the tape moves every key beside it.
        disabled ? 'cursor-default opacity-40' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={on ? { background: T.orange } : undefined}
    >
      {label}
    </button>
  )
}

function newestClose(data: unknown): number {
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { candles?: unknown } | undefined)?.candles)
      ? (data as { candles: unknown[] }).candles
      : []
  let bestT = 0
  let close = 0
  for (const item of list as Array<Record<string, unknown>>) {
    const t = Number(item?.timestamp)
    const c = Number(item?.close)
    if (Number.isFinite(t) && t > bestT && Number.isFinite(c) && c > 0) {
      bestT = t
      close = c
    }
  }
  return close
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

export function GexCandlesCard({
  /**
   * Offer the replay transport, and open already rewound to the session's open.
   *
   * The board never passes it — see the REPLAY note in the header. Only the
   * Replay hub's "GEX candles" tab does.
   */
  replay = false,
  /**
   * SPX AND ES ONLY, and the session follows the tape.
   *
   * For the phone build (/v3/m/spx). Two things, and they are the same thing:
   *
   *   · The card stops following the board's ticker and charts SPX. The SPX/ES
   *     switch is `esCapable`, which is true only on SPX, so pinning the symbol
   *     is what makes that switch the ONLY symbol control on the screen — which
   *     is what was asked for, and it is also the only pair the phone has a
   *     live feed for.
   *   · SESSION STOPS BEING A SETTING. ES trades nearly around the clock, so it
   *     is ETH; SPX cash does not exist outside 09:30–16:00 ET, so RTH on it is
   *     not a filter, it is the whole tape — an SPX chart on "ETH" and the same
   *     chart on "RTH" are the same picture, and a button that changes nothing
   *     is a button that teaches you it does nothing. Tying it to the tape
   *     removes the one setting on this card that could only ever be wrong.
   *
   * The stored `session` is left alone, like `railOn`: the same browser profile
   * opens this card on a desktop and must find it as it left it.
   */
  spxOnly = false,
}: { replay?: boolean; spxOnly?: boolean } = {}) {
  // ── Phone layout ───────────────────────────────────────────────────────────
  // One card, three differences, all of them about the hand rather than the
  // screen size:
  //
  //   · The toolbar becomes ONE button and everything moves into a bottom
  //     sheet. The desktop toolbar is five controls at 10px; on a 390px card it
  //     wraps to three rows of ~18px targets, eats a third of the chart's
  //     height to do it, and still cannot be hit reliably.
  //   · The GEX rail is off. It is a fixed-width column beside the chart —
  //     affordable at 900px, a quarter of the plot at 390.
  //   · The overlays move in off the rail's old gutter and grow to a real tap
  //     target.
  //
  // Everything else — the chart, the data path, the settings and their storage
  // key — is the same card. This is deliberately not a second component: a
  // phone fork of a 700-line chart card is a second thing to fix every time.
  const phone = useIsPhone()
  const [settings, setSettings] = useState<ChartSettings>(() => loadSettings(CARD_ID))
  // The rail is a saved setting, and a phone must not REWRITE it — the same
  // browser profile opens this card on a desktop. Suppressed for the render,
  // the stored value untouched.
  // It is what the REST of the card reads, including the history fetch, so a
  // phone does not pull the heaviest request on the card for a ladder it will
  // never draw.
  const railOn = settings.railOn && !phone
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [latestOffscreen, setLatestOffscreen] = useState(false)
  // The bubble layer has data but none of it falls in the visible window. Set
  // from the draw loop, but only when it CHANGES — see onBubblesOutOfRange.
  const [bubblesOutOfRange, setBubblesOutOfRange] = useState(false)
  // One bubble per bucket, and the bucket is the BAR INTERVAL clamped to the
  // ladder — the chart owns that mapping and reports it on the click (see
  // reportBucket), de-duped to the value, so this changes when the interval or
  // the manual override does and not on wheel ticks.
  // Seeded at the coarsest rung the ladder has, so the first frame — drawn
  // before setIntervalMs has reached the chart — errs toward too few dots rather
  // than a 1m firehose that is replaced a frame later.
  const [bucketMs, setBucketMs] = useState(
    BUBBLES.bucketRungsMin[BUBBLES.bucketRungsMin.length - 1]! * 60_000,
  )
  const countdownRef = useRef<HTMLSpanElement | null>(null)
  const barsRef = useRef<Bar[]>([])

  // ── Replay state ───────────────────────────────────────────────────────────
  // All four are inert unless `replay` was passed: `replayOn` seeds false, and
  // nothing below it can turn true without the toggle, which is not rendered.
  // Declared unconditionally because hooks are — the cost of an unused piece of
  // state is nothing, and the alternative is a second component.
  const [replayOn, setReplayOn] = useState(replay)
  /** The cursor, as a TIMESTAMP. 0 = not seeded yet. See the header. */
  const [replayMs, setReplayMs] = useState(0)
  const [replayPlaying, setReplayPlaying] = useState(false)
  const [replaySpeed, setReplaySpeed] = useState(1)

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
  const { symbol: boardSymbol } = usePageSymbol()
  const symbol = spxOnly ? SPX_ONLY_SYMBOL : boardSymbol
  const def = useMemo(() => symbolDef(symbol), [symbol])

  // ── THE OWNER'S CHART KEEPS RUNNING IN A BACKGROUND TAB ────────────────────
  // useQuery stops polling while the tab is hidden, which is right for every
  // customer: a chart nobody is looking at is egress for nothing. It is wrong
  // for the owner, whose chart is the SESSION'S RECORD — a bubble that did not
  // form because another tab was up for ten minutes is a ten-minute hole in
  // it, and the catch-up poll on return does not fill a hole, it only draws
  // the newest column. So for the owner both polls run hidden. The browser
  // throttles hidden timers to about once a minute, which is the recorder's
  // own cadence, so nothing is lost to the throttle either.
  const { isOwner } = useAuth()

  // ── SPX or ES candles ──────────────────────────────────────────────────────
  // The switch only exists on SPX: the gamma is `$SPX` either way, and only
  // SPX has a futures tape to swap in. On any other symbol the stored flag is
  // simply not read, so a board that was on ES and moves to AMZN draws AMZN's
  // own candles, and comes back to ES when it returns to SPX.
  const esCapable = def.gexSymbol === '$SPX'
  const useEs = esCapable && settings.esCandles
  /**
   * The session the chart actually filters on. Normally the stored setting;
   * derived from the tape when `spxOnly` — ES has an overnight, SPX cash does
   * not. See the prop.
   */
  const session = spxOnly ? (useEs ? 'eth' : 'rth') : settings.session

  // ── Fetches ────────────────────────────────────────────────────────────────
  // `pollMs`, not just `staleMs`. staleMs is a cache TTL and never causes a
  // refetch on its own, so without a poll this card would sit on the bars it
  // loaded with for as long as it stayed mounted.
  // ONE candle query, two URLs. The switch picks the route; the poll, the
  // cache window and the parse contract are the same either way, so the chart
  // below cannot tell which tape it is on — which is the point.
  //
  // Not `useEsCandles` (src/data/esCandles.ts), deliberately. That hook is
  // built for the relative-volume panels: it re-renders its consumer on EVERY
  // `esCandles` frame, and a chart that re-ingested ~7,000 1m bars per socket
  // message would be the exact React-in-the-tick-path AGENTS.md rule 4 bans.
  // Here the forming bar reaches the chart imperatively (see "The live
  // price"), and the closed bars arrive on the poll, as they do for SPX.
  const candlesQ = useQuery<unknown>(
    useEs ? esCandlesUrl(settings.interval) : candlesUrl(def, settings.interval),
    { staleMs: 25_000, pollMs: 30_000, background: isOwner },
  )
  // The basis, ES only. useQuery(null) neither fetches nor polls, so the
  // request exists only while there is a futures chart to shift.
  const basisQ = useQuery<unknown>(useEs ? BASIS_URL : null, { staleMs: 300_000, pollMs: 1_800_000 })
  const routeBasis = useMemo(() => (useEs ? parseBasis(basisQ.data) : NO_BASIS), [useEs, basisQ.data])
  const routeUsable = isPlausibleBasis(routeBasis.basis) || routeBasis.days.size > 0

  // ── The LIVE basis, as the fallback ────────────────────────────────────────
  // v2's first tier: the newest ES bar's close minus the live SPX spot, both
  // off the socket, sampled together. The proxy route is still preferred — it
  // is roll-correct by construction and immune to the broker-spot problem
  // frames.ts describes — but when it answers `{ basis: null }` (no 16:00 ES
  // bar yet on a fresh table, Yahoo refusing, no DATABASE_URL on a dev box)
  // this is what keeps the layer on the right price. The plausibility gate is
  // the safety: a collapsed or negative live difference is REJECTED, and the
  // card stays unshifted and says so, rather than bending every level by a
  // number that is wrong.
  //
  // Refs plus a once-a-minute sample, not state per tick: the shift re-buckets
  // the whole history, and the basis moves about a point a DAY.
  const esCloseRef = useRef(0)
  const spotRef = useRef(0)
  const [liveBasis, setLiveBasis] = useState(0)
  useEffect(() => {
    if (!useEs || routeUsable) return
    const unsub = watchFrame<SpotFrame>('spot', (f) => {
      const px = f?.data.spot
      if (typeof px === 'number' && px > 0) spotRef.current = px
    })
    const sample = () => {
      // CASH OPEN ONLY. `spot` freezes at 16:00 while ES keeps trading, so
      // overnight the difference is not a basis — it is the overnight move.
      // Hold whatever the last open-hours sample was instead.
      const m = etMinutesOfDay(Date.now())
      const wd = new Date().getUTCDay()
      if (m < RTH_OPEN_MIN || m >= RTH_CLOSE_MIN || wd === 0 || wd === 6) return
      const b = esCloseRef.current - spotRef.current
      const next = esCloseRef.current > 0 && spotRef.current > 0 && isPlausibleBasis(b) ? Math.round(b * 4) / 4 : 0
      setLiveBasis((prev) => (Math.abs(prev - next) >= 0.5 ? next : prev))
    }
    // First sample once the frames have had a moment to land, then a minute.
    const t0 = setTimeout(sample, 1500)
    const id = setInterval(sample, 60_000)
    return () => {
      unsub()
      clearTimeout(t0)
      clearInterval(id)
    }
  }, [useEs, routeUsable])

  const basis = useMemo(
    () => (routeUsable ? routeBasis : liveBasis > 0 ? { basis: liveBasis, days: new Map<string, number>() } : NO_BASIS),
    [routeUsable, routeBasis, liveBasis],
  )
  // Only once the route has ANSWERED (or failed): the moment before the first
  // response would otherwise flash the warning on every switch to ES.
  const basisMissing =
    useEs &&
    (basisQ.error != null || basisQ.data !== undefined) &&
    !routeUsable &&
    !(liveBasis > 0)
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

  // ── DON'T WAIT ON /api/expirations TO ASK FOR THE HISTORY ──────────────────
  // The bubble history is keyed by expiry, so it used to sit behind the
  // expirations request: switch ticker, wait a round trip for the list, THEN
  // start the request that actually draws the layer. Two serial hops, and the
  // card was blank for both of them — which is what "switching tickers doesn't
  // load the bubbles" was.
  //
  // On a trading day the answer is already known without asking anyone: 0DTE is
  // today's ET date, and today is the first entry the list comes back with. So
  // guess it and fire immediately. The moment the real list lands, `expiries[0]`
  // takes over — and on a trading day it IS this date, so the URL does not
  // change, nothing refetches, and the guess cost nothing.
  //
  // Only while the list is genuinely unknown, and never on a weekend (that has
  // its own answer, above). On a holiday the guess is wrong once: the route
  // answers with no rows and the real list corrects it a moment later, which is
  // the same blank the card would have shown anyway while waiting.
  const provisionalExpiry =
    !expiries.length && !weekendExpiry ? ET_DATE.format(new Date()) : ''

  const expiry = settings.expiry && expiries.includes(settings.expiry)
    ? settings.expiry
    : weekendExpiry || expiries[0] || provisionalExpiry
  // Either layer keeps this alive: the rail reads the newest column of the same
  // history the bubbles are drawn from, so turning the bubbles off with the
  // rail on must not take the request — and its data — away with them.
  //
  // The REACH of the request: ONE session. This used to be a 48h testing reach
  // behind the `Prev day` chip, with a Sun/Mon/Both picker deciding which of
  // the two days that came back actually drew. Both are gone — the card follows
  // the selected expiration, so a second session in the payload was four times
  // the columns to parse for rows that were then filtered straight back out.
  //
  // ON A WEEKEND THE REACH STILL HAS TO CLEAR THE WEEKEND. 12h back from a
  // Sunday evening lands nowhere near Friday's session, so on Sat/Sun ask for
  // the distance to that Friday's pre-open plus an hour instead of a constant
  // that cannot know what day it is. The route clamps at 5760, comfortably
  // above a Sunday.
  const historyMinutes = useMemo(() => {
    if (!weekendExpiry) return GEX_HISTORY_MINUTES
    const preOpen = Date.parse(`${weekendExpiry}T08:00:00Z`) // 04:00 ET, before any session column
    const back = Math.ceil((Date.now() - preOpen) / 60_000) + 60
    return Math.min(5760, Math.max(GEX_HISTORY_MINUTES, back))
  }, [weekendExpiry])
  // Held in a variable rather than inlined, because the NULL case has to be
  // readable downstream — see `allColumns`.
  const gexUrl =
    (settings.bubblesOn || railOn) && expiry
      ? gexHistoryUrl(def.gexSymbol, expiry, historyMinutes, BUBBLE_LADDER_REQUEST)
      : null
  const gexQ = useQuery<unknown>(
    gexUrl,
    // The recorder writes a column a minute, so asking more often than that
    // returns the same ladder twice — and it is the heaviest request the card
    // makes.
    { staleMs: 30_000, pollMs: 60_000, background: isOwner },
  )

  // ── Derived ────────────────────────────────────────────────────────────────
  // The WHOLE tape the card holds. `bars` below is this, clipped to the replay
  // cursor; live, the two are the same array.
  const allBars = useMemo(() => {
    const raw = useEs ? parseEsCandles(candlesQ.data) : parseCandles(candlesQ.data)
    return filterSession(rollup(raw, settings.interval), session)
  }, [useEs, candlesQ.data, settings.interval, session])

  // ── The replay cursor ──────────────────────────────────────────────────────
  // The timeline is the BARS, not the GEX columns: the candles are always there
  // and the ladder may be switched off, and a transport whose scrubber empties
  // when you turn off a layer is a broken transport.
  const replayTimeline = useMemo(() => allBars.map((b) => b.t), [allBars])
  const replayLast = replayTimeline.length - 1

  // Index is DERIVED from the timestamp, never stored. See the header: an index
  // does not survive a 1m -> 5m switch and a time does.
  const replayIdx = useMemo(() => {
    if (!replayTimeline.length) return 0
    if (!replayMs) return 0
    const after = replayTimeline.findIndex((t) => t > replayMs)
    return after === -1 ? replayTimeline.length - 1 : Math.max(0, after - 1)
  }, [replayTimeline, replayMs])

  const cursor = replayOn ? (replayTimeline[replayIdx] ?? 0) : 0

  // Seed at the session's OPEN, once bars exist. Landing on the last bar would
  // be a rewound chart that looks exactly like the live one, which is the worst
  // possible opening state for a replay tab.
  useEffect(() => {
    if (!replayOn || replayMs) return
    const first = replayTimeline[0]
    if (first) setReplayMs(first)
  }, [replayOn, replayMs, replayTimeline])

  // Stop at the right edge rather than looping. A poll that adds a bar while
  // paused at the end leaves the cursor where it was — it does not chase the
  // live edge, because "I stopped here" is a position, not a follow.
  useEffect(() => {
    if (!replayPlaying || replayTimeline.length === 0) return
    const id = setInterval(() => {
      setReplayMs((ms) => {
        const i = ms ? replayTimeline.findIndex((t) => t > ms) : 0
        const next = i === -1 ? null : replayTimeline[i]
        if (next == null) {
          setReplayPlaying(false)
          return ms
        }
        return next
      })
    }, REPLAY_BASE_MS / replaySpeed)
    return () => clearInterval(id)
  }, [replayPlaying, replaySpeed, replayTimeline])

  const bars = useMemo(
    () => (cursor ? allBars.filter((b) => b.t <= cursor) : allBars),
    [allBars, cursor],
  )

  barsRef.current = bars

  // ── Which session draws ────────────────────────────────────────────────────
  // ONE session, always: the newest one the history came back holding. There is
  // no user choice here any more — the Sun/Mon/Both picker that used to sit
  // beside the expiry dropdown is gone, along with the 48h reach that was the
  // only reason two sessions were ever in the payload together.
  //
  // `latestSession` rather than "today" for two reasons. On a weekend the
  // newest session is Friday's, and anything anchored to the wall clock draws
  // an empty layer. And on a Monday the recorder's weekend republish — the last
  // cash book, re-emitted once a minute all weekend — is still inside the
  // reach; taking only the newest ET day drops it, where 'both' used to draw it
  // as a flat rail running across Saturday and Sunday.
  //
  // The weekend branch stays explicit: on Sat/Sun the expiry has been pinned to
  // that Friday, so the columns are pinned to the same date rather than to
  // whatever the newest row happens to be.
  // ── NOT THE PREVIOUS TICKER'S LADDER ───────────────────────────────────────
  // `useQuery(null)` cannot fetch, so it returns the last value its ref happened
  // to be holding — and on a symbol switch the URL IS null for a moment, because
  // it needs the new ticker's expiry and /api/expirations has not answered yet.
  // Without this gate the card kept drawing the OLD symbol's bubbles through
  // that window: real columns, at the old symbol's strikes, over the new
  // symbol's candles. On SPX -> AMZN the strikes are off-scale and it reads as
  // "the bubbles did not load"; between two similarly-priced tickers it would
  // read as something much worse, which is a live chart showing another
  // instrument's gamma without saying so.
  const allColumns = useMemo(() => (gexUrl ? parseGexHistory(gexQ.data) : []), [gexUrl, gexQ.data])
  // ── INTO ES PRICE SPACE, when the candles are ES ───────────────────────────
  // Done once here, upstream of BOTH consumers — the bubble model and the rail
  // read the same shifted columns, so they cannot disagree about where a strike
  // sits. Per-column, by that session's basis (see basis.ts), not one number
  // over the whole window.
  //
  // The replay clip lands HERE, upstream of both consumers, for the same
  // reason: the bubbles and the rail read one array, so a rewound chart cannot
  // show 10:04 gamma under a 10:04 tape beside a 16:00 rail.
  const columns = useMemo(() => {
    const picked = weekendExpiry
      ? allColumns.filter((c) => etDay(c.slotTs) === weekendExpiry)
      : latestSession(allColumns)
    const shifted = useEs ? shiftColumns(picked, basis) : picked
    return cursor ? shifted.filter((c) => c.slotTs <= cursor) : shifted
  }, [allColumns, weekendExpiry, useEs, basis, cursor])

  // No bars in these deps: a candle POLL is not a reason to re-bucket the GEX
  // history. `bucketMs` is how the interval gets in — the chart maps interval ->
  // rung and reports it — so a timeframe change rebuilds the model exactly once,
  // through the one value that actually changed.
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
  // ES is in the key: the futures sit a basis above cash, and while that is
  // inside SPX's window a switch still deserves the reframe — the tape's
  // overnight range is not the index's.
  // `replayOn` is in the key so entering or leaving replay reframes ONCE. It is
  // the only replay state that belongs here: the cursor moving is not a scale
  // change, and reframing on every scrub tick would fight the pan and the zoom.
  const viewKey = `${symbol}|${useEs ? 'ES' : 'IDX'}|${settings.interval}|${session}|${replayOn ? 'R' : 'L'}`
  const framedRef = useRef('')

  // BEFORE the setBars effect below, deliberately. The interval is what the
  // chart re-frames against (frameRecent sizes the window in bars) and what it
  // picks the bubble bucket from, so handing it over after the reframe would
  // spend one frame on the previous timeframe's numbers. Effects run in source
  // order, so this ordering is the mechanism, not a comment about one.
  useEffect(() => apply((h) => h.setIntervalMs(settings.interval * 60_000)), [settings.interval, apply])

  useEffect(() => {
    const reframe = viewKey !== framedRef.current
    apply((h) => h.setBars(bars, reframe))
    if (bars.length) framedRef.current = viewKey
  }, [bars, viewKey, apply])

  useEffect(() => apply((h) => h.setSnapshots(snapshots)), [snapshots, apply])

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
  //
  // NOT `spot` on ES. That is the cash index, one basis below the futures, and
  // painting it onto an ES forming bar would step the last candle down 50
  // points on every tick. The futures have their own frame — `esCandles` (5m)
  // / `es1mCandles` (1m), the same stream v2's chart rode — whose newest bar's
  // close is the live print. Reading it here is also what puts that type into
  // the socket's derived topic scope while the card is on ES, and takes it out
  // again when it is not.
  // `&& !replayOn`: a live print pushed onto a rewound chart would paint 15:59's
  // price onto the 10:04 candle the cursor is sitting on. Gating it here rather
  // than inside the callback also drops the subscription, which takes `spot` /
  // `esCandles` back OUT of the socket's derived topic scope while rewound.
  const livePrice = esCapable && !useEs && !replayOn
  useEffect(() => {
    if (!livePrice) return
    return watchFrame<SpotFrame>('spot', (f) => {
      const px = f?.data.spot
      if (typeof px === 'number') apply((h) => h.setLivePrice(px))
    })
  }, [livePrice, apply])
  useEffect(() => {
    if (!useEs || replayOn) return
    const type = settings.interval === 1 ? 'es1mCandles' : 'esCandles'
    return watchFrame<{ data?: unknown }>(type, (f) => {
      const px = newestClose(f?.data)
      if (px > 0) {
        esCloseRef.current = px
        apply((h) => h.setLivePrice(px))
      }
    })
  }, [useEs, replayOn, settings.interval, apply])

  useEffect(
    () =>
      apply((h) =>
        h.setDrawOpts({
          on: settings.bubblesOn,
          bucketMin: isAutoBucket(settings.bubbleBucket) ? null : settings.bubbleBucket,
          bubbleScale: settings.bubbleScale,
        }),
      ),
    [settings.bubblesOn, settings.bubbleBucket, settings.bubbleScale, apply],
  )

  // ── Countdown ──────────────────────────────────────────────────────────────
  // Written straight to the DOM node on a 1s interval, deliberately NOT through
  // React state: a once-a-second re-render of this card would re-run every memo
  // above it and hand the chart a new bar array sixty times a minute.
  useEffect(() => {
    const el = countdownRef.current
    if (!el) return
    // Off while rewound: there is no bar forming in a session that has already
    // closed, and `Date.now() - last` against a rewound cursor counts the wrong
    // thing anyway.
    if (!settings.countdown || replayOn) {
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
  }, [settings.countdown, replayOn, settings.interval])

  const error = candlesQ.error
  // `allBars`, not `bars`: rewound to the open, `bars` is legitimately one
  // candle long and on the very first frame it can be zero. That is a cursor at
  // the start of the session, not a card with no candles, and saying "No
  // candles recorded" over a chart that is about to play is a lie.
  const empty = !error && allBars.length === 0
  const tapeLabel = useEs ? 'ES' : def.label

  const ctlSize = phone ? ('touch' as const) : ('sm' as const)

  // Built once and placed by the branch below: the desktop spreads them across
  // the header, the phone stacks the same elements in the sheet. One instance
  // each, so there is no chance of the two rows drifting apart.
  const expiryPicker = (
    <Dropdown
      title="Which expiry the GEX bubbles are drawn from. Defaults to the nearest; pinning one keeps it until the symbol changes"
      value={expiry}
      options={expiryOptions}
      onChange={(v) => patch({ expiry: v })}
      empty="expiry"
    />
  )
  const intervalPicker = (
    <SegGroup
      size={ctlSize}
      title="Bar interval"
      options={INTERVALS.map((i) => ({ label: INTERVAL_LABEL[i], value: String(i) }))}
      value={String(settings.interval)}
      onChange={(v) => patch({ interval: Number(v) as Interval })}
    />
  )
  // SPX-only — see esCapable. Null (not hidden) elsewhere so the header row
  // does not keep an empty slot on AMZN.
  const tapePicker = esCapable ? (
    <SegGroup
      size={ctlSize}
      title="Which tape the candles come from. SPX is the cash index (09:30–16:00 ET only). ES is the front-month future — it trades nearly around the clock, so this is the one that has an overnight — with the same SPX gamma drawn over it, every strike shifted by the ES−SPX basis"
      options={[
        { label: 'SPX', value: 'spx' },
        { label: 'ES', value: 'es' },
      ]}
      value={useEs ? 'es' : 'spx'}
      onChange={(v) => patch({ esCandles: v === 'es' })}
    />
  ) : null
  const sessionPicker = (
    <SegGroup
      size={ctlSize}
      title="Session — RTH is the New York cash session (9:30am–4:00pm ET); ETH adds the overnight"
      options={[
        { label: 'RTH', value: 'rth' },
        { label: 'ETH', value: 'eth' },
      ]}
      value={session}
      onChange={(v) => patch({ session: v })}
    />
  )

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col gap-1"
      // Everything the toolbar above carries, for the caption under a CopyShot —
      // the shot drops this card's header, so what is not published here is not
      // in the picture. See shell/snapshot.ts (META_ATTR).
      data-capture-meta={[
        useEs ? 'ES' : symbol,
        expiry,
        `${settings.interval}m`,
        session.toUpperCase(),
        // A shot of a rewound chart that does not say so is a shot of a lie.
        replayOn && cursor ? `REPLAY ${ET_CLOCK.format(new Date(cursor))} ET` : '',
      ]
        .filter(Boolean)
        .join(' · ')}
    >
      {/* ── Toolbar ──
          Portalled into the Card's header. This card used to draw its own row
          right under that header, so the board showed two bars stacked and the
          chart lost the height of both. */}
      <CardToolbar>
        {/* Only where replay was offered — the board never passes the prop, so
            this button does not exist there and the toolbar is unchanged. */}
        {replay && (
          <Chip
            size={ctlSize}
            label="⏱ Replay"
            on={replayOn}
            onClick={() => {
              setReplayPlaying(false)
              setReplayOn((v) => !v)
            }}
            title="Scrub the session on screen — the candles, the GEX bubbles and the rail all clip to one cursor. Off = live."
          />
        )}
        {/* THE TAPE SWITCH STAYS IN THE HEADER ON A PHONE TOO (2026-09-03).
            Everything else folds into the sheet below, but SPX-vs-ES is the one
            control you reach for mid-session — it is the difference between a
            chart that stops at 16:00 ET and one that has the overnight — and
            burying it behind ⚙ made the phone build's candle screen answer a
            different question from the board's. Two segments, and it is the
            width of the word "ES". */}
        {tapePicker}
        {!phone && expiryPicker}
        {!phone && intervalPicker}
        {!phone && !spxOnly && sessionPicker}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            title="Chart layers and bubble settings"
            className={[
              'rounded-sm border border-line font-semibold tracking-wide text-muted hover:bg-raised hover:text-fg',
              phone ? 'min-h-[34px] px-3 py-1.5 text-sm' : 'px-2 py-0.5 text-2xs',
            ].join(' ')}
          >
            {/* On a phone this button IS the toolbar, so it has to say what the
                chart is currently set to — otherwise the two settings you
                change most are invisible until you open the sheet. */}
            {phone
              ? `${INTERVAL_LABEL[settings.interval]} · ${session.toUpperCase()} ⚙`
              : '⚙ Layers'}
          </button>
          <Popover open={settingsOpen} onClose={() => setSettingsOpen(false)} sheet={phone}>
            <div className={phone ? 'flex w-full flex-col gap-3' : 'flex w-64 flex-col gap-2'}>
              {/* The controls the desktop keeps in the header. Same elements,
                  same handlers — only the placement differs. */}
              {/* No "Candles" section here any more — the tape switch lives in
                  the header on every width. See the note on CardToolbar. */}
              {phone && <PanelSection title="Expiry">{expiryPicker}</PanelSection>}
              {phone && <PanelSection title="Interval">{intervalPicker}</PanelSection>}
              {/* No Session section when the tape decides it — see spxOnly. */}
              {phone && !spxOnly && <PanelSection title="Session">{sessionPicker}</PanelSection>}

              <PanelSection title="Layer">
                <div className="flex flex-wrap gap-1">
                  <Chip
                    size={ctlSize}
                    label="Bubbles"
                    on={settings.bubblesOn}
                    onClick={() => patch({ bubblesOn: !settings.bubblesOn })}
                    title="Draw the GEX ladder over the candles"
                  />
                  {/* Off the phone sheet entirely: the rail is suppressed on a
                      phone (see railOn), and a toggle that changes nothing you
                      can see is worse than no toggle. */}
                  {!phone && (
                    <Chip
                      size={ctlSize}
                      label="GEX rail"
                      on={settings.railOn}
                      onClick={() => patch({ railOn: !settings.railOn })}
                      title="The strike ladder down the right-hand side. Every row sits at the same height as its strike on the chart — it reads the chart's own price scale, so it stays level through a pan, a zoom and an autoscale"
                    />
                  )}
                  <Chip
                    size={ctlSize}
                    label="Countdown"
                    on={settings.countdown}
                    onClick={() => patch({ countdown: !settings.countdown })}
                    title="Time left in the forming bar"
                  />
                </div>
              </PanelSection>

              {/* Outside the bubble gate: the RAIL reads this too, so hiding it
                  with the bubbles would leave the rail's basis unreachable. */}
              <PanelSection title="GEX basis">
                <SegGroup
                  size={ctlSize}
                  title="Vol+OI is open interest plus today's volume; Vol drops the open interest term"
                  options={[
                    { label: 'Vol+OI', value: 'voloi' },
                    { label: 'Vol', value: 'vol' },
                  ]}
                  value={settings.gexMetric}
                  onChange={(v) => patch({ gexMetric: v })}
                />
              </PanelSection>

              {/* Auto = one bubble per BAR, so the interval picker in the header
                  is the control most people want and this one is the override:
                  read 1m gamma under 15m candles, or hold a 5m cadence on 1m
                  candles. Six sliders came out of this panel and this is what
                  replaced them. */}
              <PanelSection title="Bubble bucket">
                <SegGroup
                  size={ctlSize}
                  title="How much time one bubble covers. Auto follows the bar interval — one bubble per candle, capped at 5m — so switching 1m/5m up in the header moves the bubbles with it. 1m and 5m pin the bucket instead, which is for reading sub-bar detail under coarser candles. Either way the zoom only thins what is drawn: at a wide zoom a 1m bucket still draws every Nth"
                  options={[
                    { label: 'Auto', value: 'auto' },
                    { label: '1m', value: '1' },
                    { label: '5m', value: '5' },
                  ]}
                  value={isAutoBucket(settings.bubbleBucket) ? 'auto' : String(settings.bubbleBucket)}
                  onChange={(v) => patch({ bubbleBucket: v === 'auto' ? 'auto' : v === '1' ? 1 : 5 })}
                />
              </PanelSection>

              {/* One dial over the whole size system — see ChartSettings.
                  Disabled rather than hidden with the layer off: the value it
                  holds is the value that comes back when you turn it on. */}
              <PanelSection title="Bubble size">
                <Slider
                  label="Size"
                  title="Scales every mark together — cap, floor, the top mark's boost and its ring — against the room the zoom leaves them. 1.0 is the tuned default. Above it the marks can start to touch at a wide zoom, which is the same trade the manual 1m/5m bucket offers: you asked for detail and accepted the crowding to get it"
                  value={settings.bubbleScale}
                  min={BUBBLE_SCALE_MIN}
                  max={BUBBLE_SCALE_MAX}
                  step={BUBBLE_SCALE_STEP}
                  format={(v) => `${v.toFixed(1)}x`}
                  disabled={!settings.bubblesOn}
                  onChange={(v) => patch({ bubbleScale: v })}
                />
              </PanelSection>

            </div>
          </Popover>
        </div>
      </CardToolbar>

      {/* ── The replay transport ──
          Rendered here, in this card's own tree, because this card owns the
          state it drives; ReplayDock portals the DOM to the bottom of the page
          column, in flow, so it shrinks the chart rather than covering the last
          inch of it. See design/primitives/ReplayDock.tsx. */}
      {replayOn && (
        <ReplayDock>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs">
            <span
              className="shrink-0 font-black uppercase tracking-[0.1em]"
              style={{ color: T.orange }}
            >
              Replay
            </span>

            {/* The clock is the whole point of the bar: it is the one place the
                cursor is stated as a TIME rather than as a slider position. */}
            <span className="tabular shrink-0 font-mono font-extrabold text-fg">
              {cursor ? `${ET_CLOCK.format(new Date(cursor))} ET` : '--:--'}
            </span>
            <span className="shrink-0 text-2xs text-muted opacity-70">
              {replayTimeline.length ? `bar ${replayIdx + 1}/${replayTimeline.length}` : 'no bars'}
            </span>

            {/* ◀ · play/pause · ▶ — the same three keys, in the same order, as
                the Ticker Lookup and Multi Greek bars. */}
            <span className="flex shrink-0 items-center gap-1">
              <TransportButton
                label="◀"
                title="Previous bar"
                disabled={replayIdx <= 0}
                onClick={() => {
                  setReplayPlaying(false)
                  const prev = replayTimeline[replayIdx - 1]
                  if (prev) setReplayMs(prev)
                }}
              />
              <TransportButton
                label={replayPlaying ? '❚❚' : '▶'}
                title="Play / pause"
                on={replayPlaying}
                disabled={replayTimeline.length < 2}
                onClick={() => {
                  // Playing from the end shows one step and stops, which reads
                  // as broken — rewind to the open first.
                  if (replayIdx >= replayLast) {
                    const first = replayTimeline[0]
                    if (first) setReplayMs(first)
                  }
                  setReplayPlaying((p) => !p)
                }}
              />
              <TransportButton
                label="▶"
                title="Next bar"
                disabled={replayIdx >= replayLast}
                onClick={() => {
                  setReplayPlaying(false)
                  const next = replayTimeline[replayIdx + 1]
                  if (next) setReplayMs(next)
                }}
              />
            </span>

            {/* One scrubber over the bar index. `value` is the DERIVED index, so
                a 1m -> 5m switch moves the handle to wherever that same instant
                now sits instead of leaving it pointing at a different time. */}
            <input
              type="range"
              min={0}
              max={Math.max(0, replayLast)}
              step={1}
              value={replayIdx}
              disabled={replayTimeline.length === 0}
              onChange={(e) => {
                setReplayPlaying(false)
                const next = replayTimeline[Number(e.target.value)]
                if (next) setReplayMs(next)
              }}
              // The dock's own orange (T.orange = --color-warn), not v2's, so
              // the handle matches the plate it sits on.
              className="h-1 min-w-[140px] flex-1 cursor-pointer accent-[var(--color-warn)]"
              aria-label="Replay position"
            />

            <span className="flex shrink-0 items-center gap-1">
              <span className="text-2xs font-bold text-muted opacity-60">Speed</span>
              {REPLAY_SPEEDS.map((s) => (
                <TransportButton
                  key={s}
                  label={`${s}×`}
                  title={`Play at ${s}×`}
                  on={replaySpeed === s}
                  onClick={() => setReplaySpeed(s)}
                />
              ))}
            </span>

            <button
              type="button"
              onClick={() => {
                setReplayPlaying(false)
                setReplayOn(false)
              }}
              title="Leave replay and return to the live chart"
              className="shrink-0 rounded-sm border border-line px-2 py-0.5 text-2xs font-semibold tracking-wide text-muted hover:bg-raised hover:text-fg"
            >
              Live
            </button>
          </div>
        </ReplayDock>
      )}

      {/* ── Status line ── */}
      {error && <span className="shrink-0 text-xs text-down">{error.message}</span>}
      {empty && (
        <span className="shrink-0 text-xs text-muted opacity-70">
          {candlesQ.loading ? 'Loading…' : `No candles recorded for ${tapeLabel} yet.`}
        </span>
      )}
      {/* An unshifted ES layer looks exactly like a shifted one until you
          notice every wall is 50 points under where price is reacting. Say it. */}
      {basisMissing && settings.bubblesOn && (
        <span className="shrink-0 text-xs text-warn opacity-80">
          ES−SPX basis unavailable ({basisQ.error ? basisQ.error.message : 'route has no usable basis, no live pair yet'}) — GEX levels are drawn at SPX cash strikes.
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

          {/* `right-16` is the gutter the price axis and the rail leave behind.
              With the rail off on a phone there is no such gutter, and the
              countdown sat out over the axis labels. */}
          <span
            ref={countdownRef}
            className={[
              'tabular pointer-events-none absolute top-1.5 z-10 font-mono font-extrabold text-accent opacity-90',
              phone ? 'right-2 text-sm' : 'right-16 text-xs',
            ].join(' ')}
          />

          {/* An empty bubble layer that HAS data is indistinguishable from a
              broken one, and that ambiguity cost real debugging time. Say it. */}
          {bubblesOutOfRange && settings.bubblesOn && (
            <span className="pointer-events-none absolute left-2 top-1.5 z-10 text-2xs text-muted opacity-55">
              no GEX history in view
            </span>
          )}

          {latestOffscreen && bars.length > 0 && (
            <button
              type="button"
              onClick={() => apply((h) => h.scrollToNow())}
              title="Jump to the current candle — keeps your zoom"
              aria-label="Scroll to the latest candle"
              className={[
                'absolute z-20 flex items-center justify-center rounded-full border border-line bg-surface text-accent shadow-lg transition-colors hover:bg-raised hover:text-fg',
                // 28px is a mouse target. After a pan on a phone this button is
                // the way back to the live edge, and it has to be hittable
                // without looking — 36px, clear of the axis, up off the bottom
                // where a swipe-up gesture starts.
                phone ? 'bottom-6 right-3 h-9 w-9' : 'bottom-8 right-16 h-7 w-7',
              ].join(' ')}
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

        {railOn && <GexRail model={railModel} applyChart={apply} />}
      </div>
    </div>
  )
}
