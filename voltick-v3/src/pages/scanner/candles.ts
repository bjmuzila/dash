// ─────────────────────────────────────────────────────────────────────────────
// `/api/snapshots/candles` — the ES and NQ candle legs. Nothing else.
//
// EXTRACTED FROM `tpoData.ts` ON 2026-09-03, when the TPO Structures tab was
// dropped from v3. `tpoData.ts` is now a tombstone; the TPO half of it (the
// session choices, `historyDaysFor`, `TPO_HISTORY_DAYS`, and the whole
// `/api/tpo-forecast` section) went with the tab. Only the candle half is here,
// under names that no longer say "TPO":
//
//     TpoInstrument   → CandleInstrument     (same 'ESU' | 'NQU' union)
//     loadTpoCandles  → loadCandles
//     TpoCandleLoad   → CandleLoad
//
// THIS IS THE ONLY CLIENT OF `/api/snapshots/candles` IN v3. When the TPO tab
// existed there were two callers of this code; now there is one, and it is
// `ibStatsData.ts` — `loadIbCandles()` feeds the IB Stats tab's LIVE TAPE, which
// exists because v2 got its candles from two page-level socket hooks
// (`useEsCandles` / `useNqCandles`) that v3 non-negotiable 2 forbids outright.
// It calls `loadCandles(sym === 'NQ' ? 'NQU' : 'ESU', LIVE_FEED_HISTORY_DAYS)`
// and reads `today`, `historical` and `failed`. Everything else exported below
// is part of the same contract and is kept whole rather than trimmed to that one
// call site: the four URL builders and the two stale windows describe the route,
// and the live-leg helpers describe what a socket-fed caller would have to do.
//
// Transcribed 1:1 from v2's `lib/snapdb.ts:353–469` (the four candle queries, the
// lite-payload decoder and the numeric coercion) and `hooks/useEsCandles.ts` (the
// load shape), against docs/parity/scanner.md Part F, rows F4–F13 and F191–F201.
// Those spec rows belong to a tab that no longer exists; they are still the
// provenance of every line here, so the citations stay.
//
// Five pieces of behaviour here are not obvious from the screen:
//
//   1. THE CANDLE ROWS ARRIVE AS STRINGS. Postgres BIGINT and REAL columns
//      deserialize through the route as quoted strings. Without `normalizeCandle`
//      `new Date('1782187200000')` is Invalid Date, every RTH filter drops every
//      bar, and the caller shows "waiting on candles" forever with no error.
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
//      "every candle we have". No caller reaches it: IB Stats always passes
//      `LIVE_FEED_HISTORY_DAYS` = 2. Ported because the branch is part of the URL
//      contract, not because anything here calls it.
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
// `Promise.all`, so one rejected leg takes the other down and the caller shows
// an empty chart with nothing logged (F10). `loadCandles` uses `allSettled` with
// a per-leg warning for BOTH instruments — the shape `useEsCandles` already fixed
// and `useNqCandles` never received. Spec F8/F10.
//
// Third: `loadCandles` takes the instrument and the window as ARGUMENTS and fires
// both legs in parallel, so a route can start it at entry. v2 derived
// `historyDays` from a day selector INSIDE the component, which re-fires the
// whole load after the first one has already landed (v3 non-negotiable 4, spec
// "Do not port" 18). The window is the caller's constant — IB Stats names its own
// (`LIVE_FEED_HISTORY_DAYS`) — so a caller fires the widest window it may need up
// front and any narrower view is a pure client-side slice.
//
// ── REMOVED IN v2, DO NOT RE-ADD ─────────────────────────────────────────────
// • `useNqCandles`'s RAW WEBSOCKET. It constructs
//   `new WebSocket(`${proto}//${host}/ws/gex`)` with its own fixed 2500 ms
//   reconnect — a SECOND connection to the same broadcast `useEsCandles`
//   already reaches through `lib/gexSocket`. v3 non-negotiable 2 forbids
//   page-level socket access outright: this module owns only the REST legs, and
//   a live feed is read with `useFrame` / `watchFrame` from `@/data/hooks`.
//   Spec F11, "Do not port" 10.
// • `useNqCandles.ingest`'s UNCOALESCED PUBLISH. Every frame fires
//   `setTodayRows` + `setSessionTick`; `useEsCandles` learned the 250 ms
//   trailing publish (a 4 Hz render ceiling, refs written every frame so no data
//   is dropped) and NQ never got it. Whatever subscribes to a candle frame must
//   carry the coalescing — see `CANDLE_COALESCE_MS`. Spec F9, "Do not port" 11.
// • ALL OF IndexedDB. `snapdb.ts`'s header says it plainly: every store moved to
//   server-side SQLite behind API routes and the module only "mirrors the old
//   IndexedDB API so callers need minimal changes". There are no object stores,
//   no `idb` handles and no client-side persistence of candles anywhere in this
//   path — the only cache was `_candleCache`, replaced above. Spec F.14b.
// • `saveEsCandleSnapshot` and the rest of `snapdb.ts`. Never reachable from a
//   candle read.
//
// Spec: docs/parity/scanner.md Part F, rows F4–F13, F191–F201.
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
 * A candle as a consumer sees it. `avg5`/`avg14` are the per-slot volume
 * baselines `useEsCandles` attaches; NOTHING in v3 reads them, but they are on
 * the objects that flow through here, so the type carries them.
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

/**
 * The instrument axis of this route: ESU reads `es_candles`, NQU reads
 * `nq_candles` via `symbol=/NQ`.
 *
 * Was `TpoInstrument`, where the two values also carried the TPO tab's bin sizes
 * (ESU = 1-pt bins, NQU = 5-pt bins). Nothing about a bin size was ever in the
 * union itself, and the tab that read it that way is gone.
 */
export type CandleInstrument = 'ESU' | 'NQU'

// ── ET DATE ──────────────────────────────────────────────────────────────────

/**
 * One module-level formatter, reused. Constructing an `Intl.DateTimeFormat` per
 * call is the documented cause of a candle-fed tab freezing the whole dashboard.
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
  // decoder disagree. Silent zero rows here is what starves the caller, so make
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

/** Bar aggregation. Every caller in v3 asks for 5. */
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
 * NQU read silently interleaves two aggregations — the exact failure the ES
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
 * behaviour with fewer round trips when a caller re-asks for the same window.
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

/** Was `TpoCandleLoad`. */
export interface CandleLoad {
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
 * Was `loadTpoCandles`. The per-leg warnings are v2's own strings from
 * `useEsCandles.loadFromDb`, kept so a console trace reads the same in both
 * versions — which is why they still say `[es-candles]` on the NQ path too.
 */
export async function loadCandles(
  instrument: CandleInstrument,
  historyDays: number,
  interval: CandleInterval = 5,
): Promise<CandleLoad> {
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
// v2 reaches live candles through two page-level socket subscriptions
// (`useEsCandles`'s `subscribeGex` and `useNqCandles`'s OWN raw `WebSocket`),
// which v3 non-negotiable 2 forbids outright. The replacement is
// `useFrame` / `watchFrame` from `@/data/hooks` reading the frame types below —
// no socket import anywhere on a page, and the reconnect, the topic scope and
// the last-value-wins snapshot all belong to the data layer instead.
//
// NOTHING IN v3 SUBSCRIBES YET: there is no candle FRAME type in `@/data/store`
// to read, so the REST legs above are the only route that exists today and the
// one consumer (IB Stats) polls them. These three helpers are the contract a
// subscriber would have to satisfy, kept whole so the next one does not have to
// re-derive the coalescing window or the slotKey rule from v2.

/**
 * The frame type carrying live candle rows, per instrument. These are v2's own
 * topic names (`subscribeGex({topics: ["esCandles", "es1mCandles"]})` and
 * `nqCandles`), so the socket layer's scope does not have to learn a new word.
 *
 * NOTE only the 5-minute topic is named. v2 subscribes to `es1mCandles` as well
 * and no v3 consumer reads a 1-minute bar — every read here is the 5m
 * aggregation (`interval=5` on both ES REST legs). Subscribing to a stream the
 * caller discards is the bandwidth v3's topic derivation exists to stop.
 */
export function candleFrameType(instrument: CandleInstrument): string {
  return instrument === 'NQU' ? 'nqCandles' : 'esCandles'
}

/**
 * v2's `COALESCE_MS`. `useEsCandles` publishes on a 250 ms TRAILING timer — a
 * 4 Hz render ceiling — while writing its refs on every frame, so no bar is
 * dropped and the consumer does not re-render at tick rate. `useNqCandles` never
 * got it (spec F9, "Do not port" 11); it applies to BOTH instruments.
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
 * What a failed candle leg says on screen.
 *
 * v2 says NOTHING: `snapdb` throws on a non-2xx (F192), the ES path logs per leg
 * and the NQ path `.catch(() => {})`s it away, and the tab renders "Waiting on
 * RTH candles." either way — the same sentence it shows at 04:00 on a Sunday
 * when there genuinely are no bars. `loadCandles` already returns `failed` for
 * exactly this; returns null when both legs landed.
 */
export function candleLoadFailureLine(failed: readonly ('today' | 'historical')[]): string | null {
  if (!failed.length) return null
  return `Candle load failed: ${failed.join(' + ')} leg${failed.length === 1 ? '' : 's'}.`
}

/**
 * The candle union a consumer computes from (F12, F13).
 *
 * History first, live bars overwrite on the same `slotKey`, ascending by ms.
 * Then the instrument filter — a SUBSTRING match on `symbol` that FALLS BACK to
 * the unfiltered array when it empties. That fallback is why a feed labelling
 * bars `/ES` rather than `ESU25` still draws: it passes everything through
 * rather than showing nothing. It also means an NQU view fed only ES bars would
 * silently draw ES. Copied as written.
 */
export function unionCandles(
  historical: readonly EsCandleRecord[],
  live: readonly EsCandleRecord[],
  instrument: CandleInstrument,
): EsCandle[] {
  const map = new Map<string, EsCandle>()
  for (const c of historical) map.set(c.slotKey, c as EsCandle)
  for (const c of live) map.set(c.slotKey, c as EsCandle)
  const all = [...map.values()].sort((a, b) => a.timestamp - b.timestamp)
  const filtered = all.filter((c) => (c.symbol ?? '').toUpperCase().includes(instrument))
  return filtered.length ? filtered : all
}

/**
 * A memo key over a candle array (F14): bar COUNT plus the last bar's date, and
 * deliberately NOT the candle contents. Recomputing a full multi-day scan on
 * every intrabar tick is what froze the TPO tab; keyed this way an intrabar
 * close moves `spot` without re-running the walk.
 */
export function barCountKey(candles: readonly EsCandle[]): string {
  const last = candles[candles.length - 1]
  return `${candles.length}:${last?.date ?? ''}`
}

/**
 * Spot is the LAST BAR'S CLOSE, not a live quote (F17) — so it lags by up to one
 * 5-minute bar. Every "live" comparison built on this inherits that lag.
 */
export function spotFromCandles(candles: readonly EsCandle[]): number | null {
  return candles[candles.length - 1]?.close ?? null
}
