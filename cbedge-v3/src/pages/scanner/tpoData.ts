// ─────────────────────────────────────────────────────────────────────────────
// THE TPO TAB'S DATA LAYER — candles in, forecast in, nothing else.
//
// Transcribed 1:1 from v2's `lib/snapdb.ts:353–469` (the four candle queries,
// the lite-payload decoder and the numeric coercion), `hooks/useEsCandles.ts`
// (the load shape) and `components/scanner/TpoForecastCard.tsx:25–41` (the
// forecast fetch), against the checklist in docs/parity/scanner.md Part F,
// rows F4–F13, F123–F131 and F191–F201.
//
// Five pieces of behaviour here are not obvious from the screen:
//
//   1. THE CANDLE ROWS ARRIVE AS STRINGS. Postgres BIGINT and REAL columns
//      deserialize through the route as quoted strings. Without `normalizeCandle`
//      `new Date('1782187200000')` is Invalid Date, every RTH filter drops every
//      bar, and the tab shows "Waiting on RTH candles." forever with no error.
//      The coercion runs on BOTH payload encodings so the two cannot drift.
//   2. THE `lite=1` PAYLOAD IS COLUMNAR. `{lite:1, cols:[…], rows:[[…]]}` —
//      tuples zipped back into records by `cols`. It falls through to the legacy
//      `rows:[{…}]` object shape when the server does not answer lite, so a
//      client deployed ahead of the backend still works. All four candle URLs
//      send `lite=1`.
//   3. THE ES QUERIES SEND `interval`, THE NQ QUERIES DO NOT. `es_candles` holds
//      1m AND 5m rows on the same slotKey space, so an unfiltered read
//      interleaves two aggregations; the NQ pair was never given the filter.
//      Copied as written — see the note on `nqCandlesHistoryUrl`.
//   4. THE HISTORY LIMITS DIFFER BY SYMBOL: ES 20000, NQ 10000. Not a typo in
//      the port; v2's ES comment explains the 20000 (five sessions of 1m ES bars
//      is ~9.7k rows, close enough to a 10k ceiling that a busy week would
//      silently truncate). NQ never got the same raise.
//   5. `daysBack <= 0` DROPS THE FILTER ENTIRELY and raises the limit to 50000 —
//      "every candle we have". This tab never reaches it: it always passes
//      14 / 22 / 46 from `historyDaysFor`. Ported because the branch is part of
//      the URL contract, not because anything here calls it.
//
// ── THE ONE DELIBERATE DEPARTURE FROM v2 ─────────────────────────────────────
// TWO REQUEST-DEDUPE LAYERS BECOME ONE. v2 stacks `useEsCandles.sharedLoad`
// (3000 ms TTL, keyed `` `${interval}|${days}` ``) directly on top of
// `snapdb._dedupeCandles` (5000 ms TTL, keyed on the full URL) — two TTL caches
// with different windows and different key spaces on one request path, so
// which one answers depends on which mounted first. `query()` from `@/data/api`
// is keyed on the URL and dedupes in-flight promises, which is what BOTH layers
// were built to do; the stale windows below replace the two TTLs. Spec F191.
//
// Second departure, same spirit: v2's NQ load runs its two legs under
// `Promise.all`, so one rejected leg takes the other down and the tab shows
// "Waiting on RTH candles." with nothing logged (F10). `loadTpoCandles` uses
// `allSettled` with a per-leg warning for BOTH instruments — the shape
// `useEsCandles` already fixed and `useNqCandles` never received. Spec F8/F10.
//
// Third: `loadTpoCandles` takes the instrument and the window as ARGUMENTS and
// fires both legs in parallel, so a route can start it at entry. v2 derived
// `historyDays` from `nSessions` inside the component, which re-fires the whole
// SQLite load on a 5D→30D click AFTER the first load has already landed
// (v3 non-negotiable 4, spec "Do not port" 18). `historyDaysFor` is exported so
// a route can fire the widest window it may need up front and let the day
// selector be a pure client-side slice.
//
// ── REMOVED IN v2, DO NOT RE-ADD ─────────────────────────────────────────────
// • `useNqCandles`'s RAW WEBSOCKET. It constructs
//   `new WebSocket(`${proto}//${host}/ws/gex`)` with its own fixed 2500 ms
//   reconnect — a SECOND connection to the same broadcast `useEsCandles`
//   already reaches through `lib/gexSocket`. v3 non-negotiable 2 forbids
//   page-level socket access outright: live candle updates are read with
//   `useFrame` / `watchFrame` from `@/data/hooks` in step 3, and this module
//   owns only the REST legs. Spec F11, "Do not port" 10.
// • `useNqCandles.ingest`'s UNCOALESCED PUBLISH. Every frame fires
//   `setTodayRows` + `setSessionTick`; `useEsCandles` learned the 250 ms
//   trailing publish (a 4 Hz render ceiling, refs written every frame so no data
//   is dropped) and NQ never got it. Whatever step 3 subscribes to must carry
//   the coalescing. Spec F9, "Do not port" 11.
// • ALL OF IndexedDB. `snapdb.ts`'s header says it plainly: every store moved to
//   server-side SQLite behind API routes and the module only "mirrors the old
//   IndexedDB API so callers need minimal changes". There are no object stores,
//   no `idb` handles and no client-side persistence of candles anywhere in this
//   path — the only cache was `_candleCache`, replaced above. Spec F.14b.
// • `saveEsCandleSnapshot` and the rest of `snapdb.ts`. Not reachable from this
//   tab.
// • The forecast's `setInterval` + `alive` flag with NO `AbortController`
//   (F123). `query()` + a `pollMs` read in step 3 is the same cadence without
//   the dropped-response-that-still-downloaded.
//
// Spec: docs/parity/scanner.md Part F, rows F4–F13, F123–F131, F191–F201.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '@/data/api'

// ── WIRE SHAPES ──────────────────────────────────────────────────────────────

/** One candle row exactly as `/api/snapshots/candles` returns it. */
export interface EsCandleRecord {
  id?: number
  timestamp: number
  date: string
  slotKey: string
  time?: string
  symbol?: string
  intervalMinutes?: number
  source?: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  avgVolume?: number
}

/**
 * A candle as the rest of the tab sees it. `avg5`/`avg14` are the per-slot
 * volume baselines `useEsCandles` attaches; NOTHING in Part F reads them, but
 * they are on the objects that flow through here, so the type carries them.
 */
export interface EsCandle extends EsCandleRecord {
  avg5?: number
  avg14?: number
}

/** The `lite=1` columnar envelope, and the legacy object envelope it falls back to. */
interface CandlePayload {
  lite?: number
  cols?: string[]
  rows?: unknown[]
}

/** ESU = 1-pt bins, NQU = 5-pt bins. The tab's only instrument axis. */
export type TpoInstrument = 'ESU' | 'NQU'

/** The three day-count choices, in strip order. Labels are `${n}D`. */
export const TPO_SESSION_CHOICES = [5, 10, 30] as const
export type TpoSessionChoice = (typeof TPO_SESSION_CHOICES)[number]

/** Default instrument (F1) and default window (F2). Neither is persisted in v2 — no
 *  localStorage, no URL param; remounting the tab returns to ESU / 5D. */
export const TPO_DEFAULT_INSTRUMENT: TpoInstrument = 'ESU'
export const TPO_DEFAULT_SESSIONS: TpoSessionChoice = 5

/**
 * CALENDAR days to pull vs RTH SESSIONS to draw — not the same number (F4).
 * Thirty sessions needs ~45 calendar days once weekends and holidays are gone;
 * asking for 30 quietly hands back ~21 profiles. Scaled with the selector so the
 * 5-day view does not drag a month of bars out of the database for nothing.
 */
export function historyDaysFor(nSessions: number): number {
  return nSessions <= 5 ? 14 : nSessions <= 10 ? 22 : 46
}

/** The widest window the day selector can ask for. */
export const TPO_MAX_SESSIONS: TpoSessionChoice = 30

/**
 * ADDED IN STEP 3 — the ONE window the tab loads.
 *
 * v2 derives `historyDays` from `nSessions` inside the component, so a 5D→30D
 * click re-fires the whole candle load AFTER the first one has already landed
 * (spec "Do not port" 18, v3 non-negotiable 4). The departure note at the top of
 * this file exports `historyDaysFor` so a caller can fire the widest window it
 * may need up front and let the day selector be a pure client-side slice; this
 * is that width, named once so the tab does not pick it.
 *
 * THE VISIBLE CONSEQUENCE, stated plainly: `ageSessions` is measured from the
 * LAST LOADED session, so with one fixed window the structure stats no longer
 * move when the day selector moves. In v2 they do — 5D loads 14 calendar days
 * and every age, age bucket and base rate is computed inside that shorter
 * window. The stats this tab shows are the 46-day window's, always, and the
 * selector only changes how many profiles are DRAWN.
 */
export const TPO_HISTORY_DAYS = historyDaysFor(TPO_MAX_SESSIONS)

// ── ET DATE ──────────────────────────────────────────────────────────────────

/**
 * One module-level formatter, reused. Constructing an `Intl.DateTimeFormat` per
 * call is the documented cause of this tab freezing the whole dashboard — see
 * the same note on `ET_FMT` in tpoStructures.ts.
 */
const ET_DATE_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Today's ET calendar date as `YYYY-MM-DD`. This is the `date=` the today legs send. */
export function etDateStr(d = new Date()): string {
  const m: Record<string, string> = {}
  for (const p of ET_DATE_FMT.formatToParts(d)) {
    if (p.type !== 'literal') m[p.type] = p.value
  }
  return `${m.year}-${m.month}-${m.day}`
}

// ── PAYLOAD DECODE ───────────────────────────────────────────────────────────

/**
 * The single place numeric types are guaranteed. See header note 1 — without
 * this the RTH filter silently drops every bar and the failure looks like
 * "no data yet".
 */
function normalizeCandle(r: EsCandleRecord): EsCandleRecord {
  return {
    ...r,
    timestamp: Number(r.timestamp),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
  }
}

/**
 * Expand `{lite:1, cols, rows:[[…]]}` back into records, or pass the legacy
 * object rows through. `normalizeCandle` stays in BOTH paths on purpose (F193,
 * F194): lite already emits real numbers, but running it here too means the two
 * encodings cannot drift apart.
 */
function expandCandles(json: CandlePayload | null | undefined): EsCandleRecord[] {
  const rows = json?.rows
  if (!Array.isArray(rows) || !rows.length) return []
  const cols = json?.cols
  if (json?.lite !== 1 || !Array.isArray(cols)) {
    return (rows as EsCandleRecord[]).map(normalizeCandle)
  }
  const out = (rows as unknown[][]).map((tuple) => {
    const rec: Record<string, unknown> = {}
    for (let i = 0; i < cols.length; i++) {
      const key = cols[i]
      if (key != null) rec[key] = tuple[i]
    }
    return normalizeCandle(rec as unknown as EsCandleRecord)
  })
  // A non-empty body that decodes to nothing means the payload shape and the
  // decoder disagree. Silent zero rows here is what starves the profile, so make
  // the mismatch say so instead of looking like "no data yet" (F195).
  if (!out.length) {
    console.warn('[candles] decoded 0 rows from a non-empty response', {
      lite: json?.lite,
      cols,
      sample: rows[0],
    })
  }
  return out
}

// ── URLS ─────────────────────────────────────────────────────────────────────

/** All four candle reads hit one route; `symbol=/NQ` selects the `nq_candles` table. */
const CANDLES_ROUTE = '/api/snapshots/candles'

/** Bar aggregation. This tab only ever asks for 5. */
export type CandleInterval = 1 | 5

/**
 * `interval` defaults to 5 because `es_candles` holds 1m AND 5m rows keyed on
 * the same slotKey space — an unfiltered read returns them interleaved.
 * v2: `lib/snapdb.ts:441–444`.
 */
export function esCandlesTodayUrl(interval: CandleInterval = 5, date = etDateStr()): string {
  return `${CANDLES_ROUTE}?date=${date}&interval=${interval}&limit=2000&lite=1`
}

/**
 * `daysBack <= 0` means "no cutoff": the route drops the `daysBack` filter and
 * falls back to `ORDER BY timestamp DESC`, so the bigger limit keeps the most
 * recent bars rather than truncating them off the tail. v2: `snapdb.ts:451–458`.
 */
export function esCandlesHistoryUrl(daysBack = 20, interval: CandleInterval = 5): string {
  const qs = daysBack > 0 ? `daysBack=${daysBack}&limit=20000` : `limit=50000`
  return `${CANDLES_ROUTE}?${qs}&interval=${interval}&lite=1`
}

/**
 * NOTE the missing `interval`. v2 sends it on both ES legs and on NEITHER NQ leg
 * (`snapdb.ts:461–469`), so if `nq_candles` ever holds 1m rows alongside 5m the
 * NQU tab silently interleaves two aggregations — the exact failure the ES
 * comment says the filter exists to prevent. Copied as written; it is an open
 * question for the owner, not a thing to fix in a transcription.
 */
export function nqCandlesTodayUrl(date = etDateStr()): string {
  return `${CANDLES_ROUTE}?symbol=/NQ&date=${date}&limit=2000&lite=1`
}

/** History limit is 10000 here against the ES leg's 20000 — see header note 4. */
export function nqCandlesHistoryUrl(daysBack = 20): string {
  const qs = daysBack > 0 ? `symbol=/NQ&daysBack=${daysBack}&limit=10000` : `symbol=/NQ&limit=50000`
  return `${CANDLES_ROUTE}?${qs}&lite=1`
}

/**
 * Today's bars change as they print, so the window is only long enough to
 * collapse a mount storm (and a StrictMode double-invoke) — v2's `sharedLoad`
 * used 3000 ms for exactly this and it is the tighter of the two TTLs the
 * departure note collapses.
 */
export const CANDLES_TODAY_STALE_MS = 3_000
/**
 * History is closed sessions: it cannot change until tomorrow. v2 re-read it on
 * every `historyDays` change through a 5000 ms URL cache; a minute is the same
 * behaviour with fewer round trips on a 5D↔10D↔30D toggle.
 */
export const CANDLES_HISTORY_STALE_MS = 60_000

// ── LOADERS ──────────────────────────────────────────────────────────────────

async function loadCandleUrl(url: string, staleMs: number): Promise<EsCandleRecord[]> {
  const json = await query<CandlePayload | null>(url, { staleMs })
  return expandCandles(json)
}

export function loadEsCandlesToday(interval: CandleInterval = 5): Promise<EsCandleRecord[]> {
  return loadCandleUrl(esCandlesTodayUrl(interval), CANDLES_TODAY_STALE_MS)
}

export function loadEsCandlesHistorical(
  daysBack = 20,
  interval: CandleInterval = 5,
): Promise<EsCandleRecord[]> {
  return loadCandleUrl(esCandlesHistoryUrl(daysBack, interval), CANDLES_HISTORY_STALE_MS)
}

export function loadNqCandlesToday(): Promise<EsCandleRecord[]> {
  return loadCandleUrl(nqCandlesTodayUrl(), CANDLES_TODAY_STALE_MS)
}

export function loadNqCandlesHistorical(daysBack = 20): Promise<EsCandleRecord[]> {
  return loadCandleUrl(nqCandlesHistoryUrl(daysBack), CANDLES_HISTORY_STALE_MS)
}

export interface TpoCandleLoad {
  /** Today's bars. `[]` when that leg failed — the other leg still renders. */
  today: EsCandleRecord[]
  /** The history window's bars. `[]` when that leg failed. */
  historical: EsCandleRecord[]
  /** Which legs rejected, so a caller can say so rather than showing an empty chart. */
  failed: ('today' | 'historical')[]
}

/**
 * Both legs, in parallel, for one instrument. `allSettled` on BOTH instruments —
 * see the departure note; v2 only gave ES that treatment.
 *
 * The per-leg warnings are v2's own strings from `useEsCandles.loadFromDb`, kept
 * so a console trace reads the same in both versions.
 */
export async function loadTpoCandles(
  instrument: TpoInstrument,
  historyDays: number,
  interval: CandleInterval = 5,
): Promise<TpoCandleLoad> {
  const [todayRes, histRes] = await Promise.allSettled(
    instrument === 'NQU'
      ? [loadNqCandlesToday(), loadNqCandlesHistorical(historyDays)]
      : [loadEsCandlesToday(interval), loadEsCandlesHistorical(historyDays, interval)],
  )
  const failed: ('today' | 'historical')[] = []
  if (todayRes.status === 'rejected') {
    failed.push('today')
    console.warn('[es-candles] today load failed:', todayRes.reason)
  }
  if (histRes.status === 'rejected') {
    failed.push('historical')
    console.warn('[es-candles] history load failed:', histRes.reason)
  }
  return {
    today: todayRes.status === 'fulfilled' ? todayRes.value : [],
    historical: histRes.status === 'fulfilled' ? histRes.value : [],
    failed,
  }
}

// ── THE LIVE LEG ─────────────────────────────────────────────────────────────
//
// ADDED IN STEP 3. Step 2 owns only the REST legs and says so; the live half was
// left open because v2 reaches it through two page-level socket subscriptions
// (`useEsCandles`'s `subscribeGex` and `useNqCandles`'s OWN raw `WebSocket`),
// which v3 non-negotiable 2 forbids outright. The replacement is
// `useFrame` / `watchFrame` from `@/data/hooks` reading the frame types below —
// no socket import anywhere on the page, and the reconnect, the topic scope and
// the last-value-wins snapshot all belong to the data layer instead.

/**
 * The frame type carrying live candle rows, per instrument. These are v2's own
 * topic names (`subscribeGex({topics: ["esCandles", "es1mCandles"]})` and
 * `nqCandles`), so the socket layer's scope does not have to learn a new word.
 *
 * NOTE only the 5-minute topic is named. v2 subscribes to `es1mCandles` as well
 * and this tab never reads a 1-minute bar — every profile, every structure and
 * `spot` itself are built from the 5m aggregation (`interval=5` on both ES REST
 * legs). Subscribing to a stream the tab discards is the bandwidth v3's topic
 * derivation exists to stop.
 */
export function candleFrameType(instrument: TpoInstrument): string {
  return instrument === 'NQU' ? 'nqCandles' : 'esCandles'
}

/**
 * v2's `COALESCE_MS`. `useEsCandles` publishes on a 250 ms TRAILING timer — a
 * 4 Hz render ceiling — while writing its refs on every frame, so no bar is
 * dropped and the profile does not re-render at tick rate. `useNqCandles` never
 * got it (spec F9, "Do not port" 11); the tab applies it to BOTH instruments.
 */
export const CANDLE_COALESCE_MS = 250

/**
 * Coerce a live candle frame into records.
 *
 * Runs the same `normalizeCandle` the two REST decoders run — see header note 1.
 * The socket's rows have already been through a JSON round trip and a BIGINT
 * that arrived quoted is exactly as fatal here as it is there: an unparseable
 * `timestamp` fails every RTH comparison silently and the bar simply never
 * appears. Rows without a `slotKey` are dropped rather than merged, because
 * `unionCandles` keys the whole merge on it and `undefined` would collapse every
 * such row onto one entry.
 */
export function liveCandleRows(frame: unknown): EsCandleRecord[] {
  if (!Array.isArray(frame)) return []
  return (frame as unknown[])
    .filter((r): r is EsCandleRecord => {
      if (typeof r !== 'object' || r === null) return false
      const slot = (r as { slotKey?: unknown }).slotKey
      return typeof slot === 'string' && slot.length > 0
    })
    .map(normalizeCandle)
}

/**
 * ADDED IN STEP 3 — what a failed candle leg says on screen.
 *
 * v2 says NOTHING: `snapdb` throws on a non-2xx (F192), the ES path logs per leg
 * and the NQ path `.catch(() => {})`s it away, and the tab renders "Waiting on
 * RTH candles." either way — the same sentence it shows at 04:00 on a Sunday
 * when there genuinely are no bars. `loadTpoCandles` already returns `failed`
 * for exactly this; returns null when both legs landed.
 */
export function candleLoadFailureLine(failed: readonly ('today' | 'historical')[]): string | null {
  if (!failed.length) return null
  return `Candle load failed: ${failed.join(' + ')} leg${failed.length === 1 ? '' : 's'}.`
}

/**
 * The candle union the whole tab is computed from (F12, F13).
 *
 * History first, live bars overwrite on the same `slotKey`, ascending by ms.
 * Then the instrument filter — a SUBSTRING match on `symbol` that FALLS BACK to
 * the unfiltered array when it empties. That fallback is why a feed labelling
 * bars `/ES` rather than `ESU25` still draws: it passes everything through
 * rather than showing nothing. It also means an NQU tab fed only ES bars would
 * silently draw ES. Copied as written.
 */
export function unionCandles(
  historical: readonly EsCandleRecord[],
  live: readonly EsCandleRecord[],
  instrument: TpoInstrument,
): EsCandle[] {
  const map = new Map<string, EsCandle>()
  for (const c of historical) map.set(c.slotKey, c as EsCandle)
  for (const c of live) map.set(c.slotKey, c as EsCandle)
  const all = [...map.values()].sort((a, b) => a.timestamp - b.timestamp)
  const filtered = all.filter((c) => (c.symbol ?? '').toUpperCase().includes(instrument))
  return filtered.length ? filtered : all
}

/**
 * The structure scan's memo key (F14): bar COUNT plus the last bar's date, and
 * deliberately NOT the candle contents. Recomputing a full multi-day profile
 * scan on every intrabar tick is what froze this tab; keyed this way an
 * intrabar close moves `spot` without re-running the walk.
 */
export function barCountKey(candles: readonly EsCandle[]): string {
  const last = candles[candles.length - 1]
  return `${candles.length}:${last?.date ?? ''}`
}

/**
 * Spot is the LAST BAR'S CLOSE, not a live quote (F17) — so it lags by up to one
 * 5-minute bar. Every "live" comparison on this tab (signal liveness, the spot
 * dashed line, the open-location subtitle) inherits that lag.
 */
export function spotFromCandles(candles: readonly EsCandle[]): number | null {
  return candles[candles.length - 1]?.close ?? null
}

// ── /api/tpo-forecast ────────────────────────────────────────────────────────

/**
 * The k-NN forecast response. `lib/tpo-forecast-compute.ts:191–201` sends more
 * than this — `date`, `nHistory`, `ibMid`, `ibHigh`, `ibLow`, `prices`, and two
 * full 201-point normalised density curves `predicted[]` / `realized[]`. The v2
 * card's own type omits every one of them (F131) and renders none of it. They
 * are typed here as optional because the payload carries them and a step-3
 * chart is the obvious use; nothing in Part F reads them.
 */
export interface TpoForecastOk {
  ok: true
  /**
   * The server's NORMALISED symbol — `"ESU"` / `"NQU"`, NOT the `"ES"` / `"NQ"`
   * the request sent (F130). The subtitle prints this verbatim.
   */
  symbol: string
  /**
   * The neighbour count. It is the CONSTANT `K = 25`, so the card's
   * "Similar opens (n=…)" line always reads `(n=25)`. It is not a sample size
   * that varies with history, and a reader will assume it is (F129).
   */
  k: number
  /** INTEGER 0–100 (F199). The card prints it raw, with no `%` (F130). */
  confidence: number
  /** The SERVER's last today-bar close, not the client's `spot`. */
  spot: number | null
  predicted_poc: number
  /** In the type, rendered nowhere (F131). */
  realized_poc: number
  predicted_va: [number, number]
  /** In the type, rendered nowhere (F131). */
  realized_va: [number, number]
  date?: string
  nHistory?: number
  ibMid?: number
  ibHigh?: number | null
  ibLow?: number | null
  prices?: number[]
  predicted?: number[]
  realized?: number[]
}

export interface TpoForecastPending {
  ok: false
  status: 'accumulating' | 'pre_ib'
  nHistory: number
  need?: number
  /** The server's own wording. The v2 card composes its own and never shows this. */
  note: string
}

export type TpoForecast = TpoForecastOk | TpoForecastPending

/** The route's 500 body from its outer catch. The v2 card never checks `res.ok`. */
export interface TpoForecastError {
  error: string
}

/**
 * `symbol.toUpperCase() === "NQ" ? "NQU" : "ESU"` server-side — ANY other value,
 * a missing param included, falls through to ESU.
 */
export function tpoForecastUrl(instrument: TpoInstrument): string {
  return `/api/tpo-forecast?symbol=${instrument === 'NQU' ? 'NQ' : 'ES'}`
}

/** v2 refetches on a 60 000 ms `setInterval`. */
export const TPO_FORECAST_POLL_MS = 60_000
/** v2 sends `{cache:"no-store"}`; the equivalent through `query()` is a zero window. */
export const TPO_FORECAST_STALE_MS = 0

/**
 * The server ALWAYS sends `need: LIVE_MIN` = 40, so the card's `?? 40` fallback
 * never fires. Kept because the field is optional in the response type.
 */
export const TPO_FORECAST_NEED_FALLBACK = 40

export async function loadTpoForecast(
  instrument: TpoInstrument,
): Promise<TpoForecast | TpoForecastError> {
  return query<TpoForecast | TpoForecastError>(tpoForecastUrl(instrument), {
    staleMs: TPO_FORECAST_STALE_MS,
  })
}

/** Every string the Forecast card can print. */
export const TPO_FORECAST_COPY = {
  title: 'Forecast',
  loading: 'Loading…',
  /** Prefix; the thrown/served message is appended. Apostrophe is U+2019 in v2's `&apos;`. */
  errorPrefix: "Couldn't load: ",
  accumulatingSubtitle: 'open → day base rate',
  /**
   * BUG (v2): the pre-IB copy misdescribes its own gate. The card renders
   * "Waiting on today's open to print." with the subtitle "lights up at open",
   * but the server condition is `!todaySess || !ibDone` where
   * `ibDone = etNowMin() >= 630 (10:30 ET) && ibHigh != null && ibLow != null`.
   * It is waiting on the INITIAL BALANCE TO COMPLETE at 10:30 ET, not on the
   * 09:30 open — the server's own `note` says exactly that. The v2 strings are
   * kept below as `preIbBody` / `preIbSubtitle` because step 2 does not fix v2
   * bugs; `preIbBodyCorrected` / `preIbSubtitleCorrected` are the wording the
   * gate actually implies, for step 3 to choose. Spec F128, "Do not port" 19.
   */
  preIbBody: "Waiting on today's open to print.",
  preIbSubtitle: 'lights up at open',
  preIbBodyCorrected: 'Waiting on the Initial Balance (first two 30-min periods) to complete.',
  preIbSubtitleCorrected: 'lights up after 10:30 ET',
  resultLead: 'Similar opens (n=',
  resultMid: ') settled value ',
  resultPocSep: ' · POC ',
  resultSpotSep: ' · spot ',
} as const

/** `Accumulating history — 12/40 sessions.` */
export function accumulatingLine(fc: TpoForecastPending): string {
  return `Accumulating history — ${fc.nHistory}/${fc.need ?? TPO_FORECAST_NEED_FALLBACK} sessions.`
}

/**
 * `ESU · open → day · conf 73`.
 *
 * `confidence` is printed RAW — no rounding, no `%` — which is v2's behaviour
 * and reads as a bare number a user will not know is a percent (F130). The
 * value IS an integer 0–100 (F199).
 */
export function forecastSubtitle(fc: TpoForecastOk): string {
  return `${fc.symbol} · open → day · conf ${fc.confidence}`
}

/** VA bounds at 0 dp, POC and spot at 2 dp (F129). */
export function forecastValueBand(fc: TpoForecastOk): string {
  return `${fc.predicted_va[0].toFixed(0)}–${fc.predicted_va[1].toFixed(0)}`
}

/**
 * TWO SERVER BRANCHES PRODUCE `accumulating` AND THE CARD CANNOT TELL THEM
 * APART (F127): `hist.length < 40` reports the real count, and the `catch`
 * around the `tpo_profiles` query — the recorder table does not exist —
 * reports `nHistory: 0`. Both render as "…0/40 sessions." on a fresh install.
 * The only thing that separates them is the server's `note`, which the card
 * throws away. Returns the note so step 3 can surface it if it wants to.
 */
export function accumulatingDetail(fc: TpoForecastPending): string {
  return fc.note
}

export function isForecastError(v: unknown): v is TpoForecastError {
  return typeof v === 'object' && v !== null && typeof (v as TpoForecastError).error === 'string'
}

/**
 * ── WHAT `/api/tpo-forecast` ACTUALLY COMPUTES ───────────────────────────────
 *
 * Transcribed from `lib/tpo-forecast-compute.ts:1–205` (which is itself the
 * route extracted verbatim for the in-process API router). NOT reimplemented
 * here — the client only reads the response — but written down because the card
 * prints three numbers off it and none of them means what a reader assumes, and
 * because the whole thing is one k-NN whose inputs are invisible from the UI.
 *
 * THE QUESTION IT ANSWERS: "on the past days whose Initial Balance looked most
 * like today's, where did value end up settling?" It is a soft base rate, not a
 * level to trade — which is why v2 gives it one line and not a panel.
 *
 * 1. HISTORY. `SELECT date, poc, vah, val, ib_high, ib_low, ib_mid, ib_range,
 *    day_open, day_close, day_high, day_low, profile_json FROM tpo_profiles
 *    WHERE symbol = ? AND date < ? ORDER BY date ASC`, bound `[symbol, today]`.
 *    `date < today` is a STRICT no-lookahead cut. The rows come from a nightly
 *    recorder, not from this tab.
 *
 * 2. TODAY. `getEsCandles(today, undefined, 2000)` → `rthBarsForDate` →
 *    `buildTpoSession(bars, today, BIN)`, and it needs `bars.length >= 3` to
 *    build at all. `ibDone = etNowMin() >= IB_CLOSE_MIN && ibHigh != null &&
 *    ibLow != null` — 10:30 ET AND a complete IB. See the `pre_ib` copy bug.
 *
 * 3. THE FEATURE VECTOR — five dimensions, in this order, per session:
 *      [0] ibRange / trailIb
 *      [1] (day_open − ibMid) / ibRange          (0 when day_open is null)
 *      [2] gap / trailIb        where gap = day_open − prev.day_close
 *      [3] prevPocOff / trailIb where prevPocOff = prev.poc − ibMid
 *      [4] prevRng / trailRng   where prevRng = prev.day_high − prev.day_low
 *    Every missing `prev` field contributes 0, so the first row of history is
 *    scored as if the previous day were flat and gapless.
 *
 * 4. THE TRAILING SCALES. `trailIb` and `trailRng` are TRAILING 20-SESSION
 *    MEDIANS over `hist.slice(i-20, i)` — strictly before the row, so no row
 *    scales itself. UPPER median (`s[Math.floor(len / 2)]`). Each falls back to
 *    the row's own value, then to 1, when the window is empty. Today's pair is
 *    taken over `hist.slice(-20)`.
 *
 * 5. STANDARDISATION. Mean and sd are computed over the HISTORY's own feature
 *    matrix (`sd || 1` guards a constant dimension), and today's vector is
 *    normalised with the same mu/sd. So "similar" is similar RELATIVE TO THIS
 *    SYMBOL'S OWN HISTORY, not to an absolute scale.
 *
 * 6. k-NN. Euclidean distance in the five standardised dimensions, sorted
 *    ascending, `nn = dist.slice(0, K)` with `K = 25`. Weights are
 *    INVERSE-DISTANCE, normalised: `w_i = (1 / (d_i + 1e-6)) / Σ(1 / (d + 1e-6))`.
 *    The `1e-6` is what stops an exact match dividing by zero and taking the
 *    entire weight.
 *
 * 7. THE GRID. Each neighbour's `profile_json` becomes a 201-point density on an
 *    OFFSET grid versus that day's own `ib_mid`: `GRID_LO = -100`,
 *    `GRID_HI = +100`, `BIN = 1`, `GRID_N = 201`. `idx = round((price − anchor −
 *    GRID_LO) / BIN)`; offsets outside ±100 pts are DROPPED, and the survivors
 *    are normalised to sum 1 — so a day that ranged more than 200 points
 *    contributes a truncated, then re-normalised, shape. `pred[g] = Σ dens_i[g]
 *    · w_i`. Today's `realized` is the same transform on today's own bins.
 *
 * 8. BACK TO PRICES. `prices[g] = GRID_LO + g · BIN + ibMid`, so `predicted_va`
 *    and `predicted_poc` come back as ABSOLUTE PRICES, re-centred on TODAY's IB
 *    mid. `predicted_poc` is `prices[argmax(pred)]`; `predicted_va` is
 *    `vaBand(pred, 0.7)` — the same POC-outward walk with the same `above >=
 *    below` tie rule as `valueAreaWalk` in tpoStructures.ts, run on a density
 *    instead of on counts. That is the THIRD copy of the walk; the other two are
 *    collapsed into one in this port, and this one is server-side.
 *
 * 9. CONFIDENCE.
 *      `confidence = clamp(round(100 · (1 − meanK / medAll)), 0, 100)`
 *    where `meanK` is the mean distance of the 25 neighbours and `medAll` the
 *    MEDIAN distance across every history row (`|| 1`). An INTEGER 0–100:
 *    higher means the 25 neighbours are tight relative to the overall spread. It
 *    is a measure of how well-matched the analogues are, NOT a probability that
 *    the forecast is right — and the card prints it as a bare number with no
 *    unit, which is worth fixing in step 3.
 */
export const TPO_FORECAST_ENGINE = {
  /** Neighbour count. Constant, which is why `(n=25)` never moves. */
  K: 25,
  /** History rows required before the forecast lights up. */
  LIVE_MIN: 40,
  /** 10:30 ET, in minutes since midnight — the IB-complete gate. */
  IB_CLOSE_MIN: 630,
  GRID_LO: -100,
  GRID_HI: 100,
  GRID_N: 201,
  /** The value-area fraction the predicted band is taken at. */
  VA_PCT: 0.7,
  /** Trailing window for the IB and range medians. */
  TRAIL: 20,
  /** Inverse-distance epsilon. */
  EPS: 1e-6,
} as const

/**
 * THE FORECAST BINS NQU AT 1 POINT. `lib/tpo-forecast-compute.ts:21` hardcodes
 * `BIN = 1` and passes it to `buildTpoSession` at line 122, while this tab draws
 * and scans NQU on 5-point bins (`binSizeFor` in tpoStructures.ts). The k-NN is
 * internally consistent — the nightly recorder writes `tpo_profiles` on the same
 * grid — but `predicted_poc` and `predicted_va` therefore land on a DIFFERENT
 * bin grid from every other NQU number on the page: the profile's POC, the VA
 * band, the open levels, the AMT tiles. On ESU the two grids coincide and
 * nothing shows. Recorded, not fixed: the route would have to take `binSize`
 * from the symbol, which changes what the recorder must write. Spec F196,
 * open question 8.
 */
export const FORECAST_BIN_SIZE = 1
