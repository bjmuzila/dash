// ─────────────────────────────────────────────────────────────────────────────
// WATCH THIS — FAR CB. THE DATA LAYER. Four endpoints, two polls, one mutation.
//
// Transcribed 1:1 from v2's `components/pages/Scanner.tsx:906–2222` — the five
// fetch call sites inside `WatchThisScanner`: `addTicker` :1728–1748,
// `load` :1750–1764, `loadOutcomes` :1766–1774, `loadResults` :1780–1792,
// `openDetail` :1689–1706 — plus the four effects at :1794–1808 that drive
// them, against the checklist in docs/parity/scanner.md Part H, rows
// H17, H20, H195–H206.
//
// The TYPES, the sorting, the day grouping, the probe maths and every
// user-visible string are NOT here — they are in watchThis.ts (and the chart's
// geometry in watchThisChart.ts) and are imported. This file owns the URLs and
// what comes back off them.
//
// SIX pieces of behaviour that are NOT obvious from the screen:
//
//   1. THE FLAG FEED READS THE BODY AS TEXT FIRST, THEN PARSES IT ITSELF. v2
//      never checks `res.status`: it takes `res.text()`, tries `JSON.parse`,
//      and on failure throws `"Server returned ${status} (non-JSON)."`. That
//      string is not cosmetic — it is the ONLY reason a 503 HTML error page
//      reaches the "Recorder hasn't run yet" branch, because
//      `isRecorderNotRunError` matches the SUBSTRING "503" and that substring
//      arrives inside the message the client just composed. See the departure
//      note for why the same sentence still renders through `query()`.
//
//   2. THE TWO POLLS DISAGREE ABOUT HIDDEN TABS, AND ONLY ONE OF THEM MEANT
//      TO. The 60s outcomes poll early-returns on `document.hidden` (v2 :1802,
//      with a comment saying why). The 120s flag poll has no such check and
//      runs at full rate in a background tab. That asymmetry is v2's, it is
//      undefended, and it is what the ONE DELIBERATE DEPARTURE below closes.
//
//   3. THE OUTCOMES FEED SWALLOWS EVERYTHING. `catch {}` — a bare empty catch
//      (v2 :1773) — and `if (j.ok) setOutcomes(...)`, so an `ok:false` body is
//      DROPPED SILENTLY too. The table simply keeps whatever it had, with no
//      error, no empty state and no way to tell a dead endpoint from a genuinely
//      empty result. `loadOutcomes` below returns the failure as a VARIANT so
//      step 3 can decide; it does not itself start rendering one. (H198, H216.)
//
//   4. THE RESULTS VIEW ASKS FOR A DIFFERENT PAGE OF THE SAME ENDPOINT.
//      `status=all&limit=300&quotes=0` — every status, because the per-day
//      counts must be complete; 300, which the v2 comment calls the endpoint's
//      ceiling; and `quotes=0`, because `ResultsByDay` renders only per-day
//      counts and flag fields and never touches a contract price column, so
//      there is no reason to make the server price 300 contracts. It is a
//      DIFFERENT URL from the flat table's, so it is a different cache entry
//      and a different request — not a filter over rows already held.
//
//   5. THE DETAIL REQUEST IS RACE-GUARDED BY A COUNTER, NOT BY AN ABORT.
//      `detailReq = useRef(0)`; `const req = ++detailReq.current`; every
//      `then`/`catch`/`finally` branch bails when `detailReq.current !== req`.
//      Closing a row INCREMENTS the counter, which invalidates whatever is in
//      flight. The request still completes and still downloads; it is only
//      prevented from painting. (H202.)
//
//   6. RE-OPENING A ROW ALWAYS REFETCHES. There is no cache of loaded details
//      anywhere in v2 — `openDetail` clears `detail` and fires again every
//      time. `query()` will now serve a repeat open from cache inside the stale
//      window, which is the one place this port is quieter than v2 by
//      accident; `DETAIL_STALE_MS` is set to 0 so it is not. (H204.)
//
// ── THE ONE DELIBERATE DEPARTURE FROM v2 ─────────────────────────────────────
// THE 120s FLAG POLL NOW STOPS ON A HIDDEN TAB, AND THAT IS A FIX. Both polls
// are expressed here as `pollMs` on `query()`/`useQuery`, whose default is to
// skip a tick while `document.visibilityState === "hidden"` and to fire one
// immediately on the way back. For the 60s outcomes poll that is a faithful
// port: v2 hand-rolled exactly that check (`if (document.hidden) return`). For
// the 120s flag poll it is a BEHAVIOUR CHANGE — v2 kept requesting a 50-row
// scan every two minutes in a window nobody was looking at (H196, and
// "Do not port" H214 asks for precisely this). It is safe because the flag feed
// is a CURRENT-VALUE read: a missed sweep is repaired by the next poll, and the
// recorder — which sweeps every 30 minutes during RTH — is the thing that
// actually accumulates the record. Nothing is lost by not asking. `background:
// true` is therefore NOT set on either poll.
//
// SECOND DEPARTURE — `{cache: "no-store"}` AND FOUR HAND-ROLLED `useState`
// TRIPLES BECOME `staleMs`. All four reads send `{cache: "no-store"}`;
// `staleMs: 0` is the `query()` equivalent, so nothing is ever served from
// cache. What is new is dedupe by URL, which v2 had nowhere — and it matters
// here, because `↻ Refresh` and the 120s tick hit the same URL and v2 let them
// overlap with no `AbortController` and no ordering (H197): the later-resolving
// response won, whichever request it belonged to. Two loads of the same URL now
// share one promise.
//
// THIRD — THE `text()`-THEN-`JSON.parse` DANCE IS GONE, AND THE SENTENCE
// SURVIVES. `query()` throws on a non-2xx BEFORE the body is read, with
// `"${status} ${statusText} — ${url}"`. Check what that does to the flag feed's
// error ladder (watchThis.ts `isRecorderNotRunError`, which matches "no DB" OR
// "503"):
//   • v2, 503 with a JSON body → parses it, throws `j.error` = "no DB" →
//     matches on "no DB" → "Recorder hasn't run yet…".
//   • v2, 503 with an HTML body → parse fails, throws "Server returned 503
//     (non-JSON)." → matches on "503" → the same sentence.
//   • v3, either → `query()` throws "503 Service Unavailable — /proxy/far-cb-watch"
//     → matches on "503" → the same sentence.
// The rendered string is unchanged in all three. The one case that needs help
// is a 200 CARRYING NON-JSON, where `res.json()` throws a `SyntaxError` with no
// status in it; `loadFarCbWatch` maps that back onto `nonJsonError(200)`.
//
// FOURTH — the four loaders take everything as ARGUMENTS and none of them reads
// another's result, so a route fires all of them at entry. v2's mount already
// had no waterfall here (H205) — `load` and `loadOutcomes` are independent
// effects — so this preserves a property rather than creating one. The detail
// fetch is the exception and always was: it needs a row the user clicked.
//
// ── REMOVED IN v2, DO NOT RE-ADD ─────────────────────────────────────────────
// • `captureFlagCard` (v2 :1175–1256) AND ITS OFFSCREEN CANVAS. Not ported at
//   all, and note what it actually is: `document.createElement("canvas")` that
//   is NEVER APPENDED TO THE DOM — it exists only to be `toBlob`'d into a
//   clipboard PNG. Its whole design depends on the cloned SVG carrying RESOLVED
//   colour literals, because a `var()` reference serialises to nothing off-DOM,
//   which is exactly why the `PROBE_*` hardcoded palette existed and exactly
//   what v3 non-negotiable 1 forbids. It also reaches its source by
//   `document.getElementById(chartId)` (H218). No capture, no "⧉ Copy image"
//   button, no clipboard path, no `URL.createObjectURL`. Spec H146–H147,
//   H181–H194, "Do not port" H213/H218.
// • THE FIVE DIRECT `fetch()` CALLS and their hand-rolled `loading`/`err`
//   state (H215). Four are reads and go through `query()`; the fifth is a real
//   mutation and stays a `fetch` — see `addFarCbTicker`.
// • `detailReq = useRef(0)` (H202). The counter is a hand-rolled version of
//   "the response for a URL I am no longer reading must not paint". In step 3
//   `useQuery(detailUrl)` is keyed on that URL and discards the previous one's
//   result for free. `closeDetail` becomes `useQuery(null)`. The loader below
//   is a plain function and carries no guard, because a plain function has
//   nothing to paint into.
// • THE FOUR `setInterval` / `clearInterval` PAIRS. Lifetime is `useQuery`'s.
//
// Spec: docs/parity/scanner.md Part H, rows H17, H20, H195–H206.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '@/data/api'
import { ADD_FAILED_FALLBACK, LOAD_FAILED_FALLBACK, nonJsonError } from '@/pages/scanner/watchThis'
import type { OutcomeDetail, OutcomeRow, OutcomeView, WatchRow } from '@/pages/scanner/watchThis'

// ─────────────────────────────────────────────────────────────────────────────
// § 1 — THE FOUR ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

/** H195 — the flag grid: which watchlist tickers are showing a far-OTM dominant CB level right now. */
export const EP_FAR_CB_WATCH = '/proxy/far-cb-watch'
/** H198, H200 — the tracked-flag scoreboard. One route, two different pages of it. */
export const EP_FAR_CB_OUTCOMES = '/proxy/far-cb-outcomes'
/** H201 — one tracked flag's day-by-day spot and contract series. */
export const EP_FAR_CB_OUTCOME_DETAIL = '/proxy/far-cb-outcome-detail'
/** H17 — the watchlist roster. POST adds a ticker; the tab never GETs it. */
export const EP_FAR_CB_TICKERS = '/api/far-cb-tickers'

// ─────────────────────────────────────────────────────────────────────────────
// § 2 — POLLS, LIMITS AND STALE WINDOWS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * H196 — 120 000 ms. This is the number the toolbar's "Refreshes every 2m"
 * (`REFRESH_NOTE` in watchThis.ts) is describing; the other half of that
 * sentence — "recorder sweeps every 30m during RTH" — is a claim about the
 * server that nothing on the client can verify.
 *
 * v2 ran this poll with NO `document.hidden` check. It has one now; see THE ONE
 * DELIBERATE DEPARTURE.
 */
export const WATCH_POLL_MS = 120_000

/**
 * H199 — 60 000 ms, and v2 DID guard this one on `document.hidden`. The reason
 * is in v2's own comment (:1796–1799) and is worth keeping: the server answers
 * `/far-cb-outcomes` from a quote cache it fills in the BACKGROUND, so the
 * first response can carry blank premium columns for contracts it had not
 * priced yet. The poll exists to pick those up, not to track a moving value —
 * which is why skipping it while hidden costs nothing.
 *
 * The interval is not registered AT ALL while the view is `results`; that view
 * reads a different URL and does not poll.
 */
export const OUTCOMES_POLL_MS = 60_000

/** H195 — `?limit=50`. The flag grid's ceiling. */
export const WATCH_LIMIT = 50

/** H198 — `&limit=100` on the flat table. The server orders by `first_flagged DESC` and applies it. */
export const OUTCOMES_LIMIT = 100

/**
 * H200 — `&limit=300` on the Results view. v2's comment calls 300 "the
 * endpoint's ceiling". Once the tracker holds more than 300 flags the per-day
 * counts silently become partial with nothing on screen saying so — spec open
 * question 5 asks whether v3 should page or disclose it. Transcribed as-is.
 */
export const RESULTS_LIMIT = 300

/**
 * H200 — `&quotes=0`. `ResultsByDay` renders per-day counts and the flag
 * fields only; it never touches `opt_entry` / `opt_high` / `opt_pct_high`, so
 * the server is told not to price 300 contracts for it. Note the consequence
 * spec open question 4 raises: clicking a row in that view opens the SAME
 * detail panel, which fetches its own priced day series anyway.
 */
export const RESULTS_QUOTES = 0

/**
 * All four reads send `{cache: "no-store"}`. A zero window is the `query()`
 * equivalent.
 *
 * Exported because step 3 does not call the loaders below for the three POLLED
 * or VIEW-KEYED reads — `useQuery` takes a URL, not a promise, and the poll
 * (`pollMs`) and the "discard the previous URL's answer" guard both live in it.
 * The render layer therefore passes this window to `useQuery` and reads the
 * envelope back through the § 11 adapters, which are the same rules these
 * loaders apply.
 */
export const NO_STORE_STALE_MS = 0

/**
 * H204 — re-opening a row ALWAYS refetches in v2; there is no detail cache.
 * Zero here so a repeat open is a repeat request, rather than the port being
 * quietly stale where v2 was live.
 */
export const DETAIL_STALE_MS = 0

// ─────────────────────────────────────────────────────────────────────────────
// § 3 — URL BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

/** H195 — `?limit=50`, and nothing else. No status, no symbol, no date. */
export function farCbWatchUrl(limit: number = WATCH_LIMIT): string {
  return `${EP_FAR_CB_WATCH}?limit=${limit}`
}

/**
 * H198 — `?status={view}&limit=100`.
 *
 * `status` is the view selector VERBATIM — `all | open | touched | expired` —
 * so the flat table's filtering is SERVER-side, not a client filter over a
 * cached page. `results` is the fifth view and must never reach here: it is a
 * client-side roll-up that reads `farCbResultsUrl` instead. `OutcomeStatusView`
 * excludes it in the type so the mistake cannot compile.
 */
export type OutcomeStatusView = Exclude<OutcomeView, 'results'>

export function farCbOutcomesUrl(
  status: OutcomeStatusView,
  limit: number = OUTCOMES_LIMIT,
): string {
  return `${EP_FAR_CB_OUTCOMES}?status=${status}&limit=${limit}`
}

/** H200 — the Results view's own page of the same route. Param order is v2's. */
export function farCbResultsUrl(
  limit: number = RESULTS_LIMIT,
  quotes: number = RESULTS_QUOTES,
): string {
  return `${EP_FAR_CB_OUTCOMES}?status=all&limit=${limit}&quotes=${quotes}`
}

/**
 * H201 — the three params that identify one tracked contract. v2 builds them
 * with `new URLSearchParams({symbol, strike: String(strike), expiry})`, so
 * `strike` is stringified and every value is form-encoded; kept identical
 * because the resulting string is the cache key.
 */
export function farCbOutcomeDetailUrl(symbol: string, strike: number, expiry: string): string {
  const qs = new URLSearchParams({ symbol, strike: String(strike), expiry }).toString()
  return `${EP_FAR_CB_OUTCOME_DETAIL}?${qs}`
}

/**
 * H205 — what a route can `preload()` the moment the tab is entered. Both fire
 * together; neither needs anything from the other, in v2 or here. The Results
 * page and the detail are absent on purpose: one is entered by a view switch,
 * the other by a row click.
 */
export function watchThisPreloadUrls(view: OutcomeView = 'all'): string[] {
  return view === 'results'
    ? [farCbWatchUrl(), farCbResultsUrl()]
    : [farCbWatchUrl(), farCbOutcomesUrl(view)]
}

// ─────────────────────────────────────────────────────────────────────────────
// § 4 — WIRE ENVELOPES
// ─────────────────────────────────────────────────────────────────────────────

export interface WatchResponse {
  ok?: boolean
  error?: string
  rows?: WatchRow[]
  /**
   * The OTM percentage a strike must EXCEED to be flagged, supplied by the
   * server. The client neither computes nor validates it — see
   * `FAR_CB_SELECTION_RULE` in watchThis.ts, and note that when this field is
   * ABSENT the footer prints the client fallback ">15%" while the subtitle
   * drops its threshold clause entirely.
   */
  threshold?: number
}

export interface OutcomesResponse {
  ok?: boolean
  error?: string
  rows?: OutcomeRow[]
}

/** The detail route answers the `OutcomeDetail` shape at the top level, not wrapped. */
export type DetailResponse = OutcomeDetail

/** v2's `catch` text throughout this tab: `String(e?.message || e)`. */
export function errText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message
  return String(e)
}

/**
 * The 200-with-non-JSON hole the THIRD departure names. `query()` has already
 * thrown for every non-2xx with the status in the message, so the only body
 * that can still fail to parse arrived with a 200 — which is the status v2's
 * own message would have carried on that path.
 */
const OK_STATUS = 200

export function watchErrText(e: unknown): string {
  return e instanceof SyntaxError ? nonJsonError(OK_STATUS) : errText(e)
}

// ─────────────────────────────────────────────────────────────────────────────
// § 5 — /proxy/far-cb-watch (H195–H197)
// ─────────────────────────────────────────────────────────────────────────────

export interface WatchLoad {
  rows: WatchRow[]
  /** `null` when the endpoint omitted it. NOT defaulted to 15 here — see H44. */
  threshold: number | null
}

/**
 * H195 — the flag grid.
 *
 * `setRows(j.rows || [])` and `setThreshold(j.threshold ?? null)`: an absent
 * `rows` becomes an empty grid, an absent `threshold` becomes null and the
 * subtitle's `· >N% OTM` clause disappears while the footer keeps printing
 * ">15%" from `FAR_CB_FALLBACK_THRESHOLD_PCT`. Both strings are visible at
 * once and they disagree. That is v2, transcribed, not fixed — the fallback
 * belongs to the footer alone and this loader must not apply it, or the
 * disagreement quietly becomes agreement on a number the server never sent.
 *
 * ON FAILURE THE PREVIOUS ROWS STAY ON SCREEN. v2 sets `err` and leaves `rows`
 * untouched, and the error banner renders ABOVE the old grid with no `!loading`
 * guard. This loader throws; `useQuery` keeps the last good value, which is the
 * same screen.
 *
 * Every failure path is normalised so the message still reaches
 * `isRecorderNotRunError` — see the THIRD departure for the three cases.
 */
export async function loadFarCbWatch(limit: number = WATCH_LIMIT): Promise<WatchLoad> {
  let j: WatchResponse | null
  try {
    j = await query<WatchResponse | null>(farCbWatchUrl(limit), { staleMs: NO_STORE_STALE_MS })
  } catch (e) {
    throw new Error(watchErrText(e))
  }
  const load = watchRowsFromQuery(j ?? undefined)
  if (!load) throw new Error(j?.error || LOAD_FAILED_FALLBACK)
  return load
}

// ─────────────────────────────────────────────────────────────────────────────
// § 6 — /proxy/far-cb-outcomes, THE FLAT TABLE (H198–H199)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * v2's three outcomes of this call, kept apart — because two of them are
 * INVISIBLE in v2 and merging them would hide that.
 *
 *   `ok`       — replace the rows.
 *   `rejected` — the body parsed but did not say `ok: true`. v2 does nothing at
 *                all: `if (j.ok) setOutcomes(...)` simply does not fire, so the
 *                table keeps its previous rows and says nothing.
 *   `failed`   — the request threw. v2's `catch {}` is EMPTY (:1773): also
 *                nothing, also silent.
 *
 * H216 ("Do not port") asks v3 for a real error branch here. This layer
 * surfaces the error so that branch is WRITABLE; it does not decide to render
 * one, because deciding that is step 3's and because rendering an error where
 * v2 rendered none is a visible change.
 */
export type OutcomesLoad =
  | { status: 'ok'; rows: OutcomeRow[] }
  | { status: 'rejected'; error: string }
  | { status: 'failed'; error: string }

/**
 * H198 — the flat table's page.
 *
 * `status` is the view VERBATIM. v2 guards the `results` view by BAILING at the
 * top of the callback (`if (outcomeStatus === "results") return`) rather than
 * by never calling; here the type does it, so there is nothing to bail from.
 *
 * Polls at `OUTCOMES_POLL_MS` — the poll exists to pick up premium columns the
 * server had not priced on the first pass, not to track a moving value.
 */
export async function loadFarCbOutcomes(
  status: OutcomeStatusView,
  limit: number = OUTCOMES_LIMIT,
): Promise<OutcomesLoad> {
  try {
    const j = await query<OutcomesResponse | null>(farCbOutcomesUrl(status, limit), {
      staleMs: NO_STORE_STALE_MS,
    })
    const rows = outcomesRowsFromQuery(j ?? undefined)
    if (!rows) return { status: 'rejected', error: j?.error || LOAD_FAILED_FALLBACK }
    return { status: 'ok', rows }
  } catch (e) {
    return { status: 'failed', error: errText(e) }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// § 7 — /proxy/far-cb-outcomes, THE RESULTS PAGE (H200)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * H200 — every tracked flag regardless of status, unpriced, so
 * `groupOutcomesByDay` in watchThis.ts can bucket a COMPLETE set by calendar
 * date. Fired once on entering the view (`useEffect` on `outcomeStatus`), with
 * NO poll — the only one of the three reads that never repeats itself.
 *
 * Unlike `loadFarCbOutcomes`, this one THROWS on both failure paths, because
 * v2 does: `!j.ok → throw j.error || "load failed"` into a `catch` that sets
 * `resultsErr`, which the view renders. Same route, two call sites, two
 * different error postures — that asymmetry is v2's and is worth seeing.
 */
export async function loadFarCbResults(
  limit: number = RESULTS_LIMIT,
  quotes: number = RESULTS_QUOTES,
): Promise<OutcomeRow[]> {
  const j = await query<OutcomesResponse | null>(farCbResultsUrl(limit, quotes), {
    staleMs: NO_STORE_STALE_MS,
  })
  const rows = resultsRowsFromQuery(j ?? undefined)
  if (!rows) throw new Error(j?.error || LOAD_FAILED_FALLBACK)
  return rows
}

// ─────────────────────────────────────────────────────────────────────────────
// § 8 — /proxy/far-cb-outcome-detail (H201–H204)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * H201 — the expanded row's day-by-day series. Fires on a row click only.
 *
 * `!j.ok → throw j.error || "load failed"`, straight into `detailErr`. The
 * whole body IS the `OutcomeDetail`, so nothing is unwrapped or renamed.
 *
 * NO RACE GUARD HERE, on purpose — see the REMOVED note on `detailReq`. v2
 * needed a counter because the fetch and the state write lived in the same
 * closure; a loader that returns a value has nothing to paint into, and step 3
 * keys `useQuery` on this URL, which is the same guarantee expressed as data.
 *
 * ONE ROW AT A TIME AND A SECOND CLICK CLOSES IT (H203) are `openRow` rules and
 * belong to step 3; note only that closing must invalidate, which for
 * `useQuery` means passing `null` as the URL.
 */
export async function loadFarCbOutcomeDetail(
  symbol: string,
  strike: number,
  expiry: string,
): Promise<OutcomeDetail> {
  const j = await query<DetailResponse | null>(farCbOutcomeDetailUrl(symbol, strike, expiry), {
    staleMs: DETAIL_STALE_MS,
  })
  const detail = detailFromQuery(j ?? undefined)
  if (!detail) throw new Error(j?.error || LOAD_FAILED_FALLBACK)
  return detail
}

/** The URL for a row, so a step-3 hook can pass it (or `null`) straight to `useQuery`. */
export function detailUrlFor(o: OutcomeRow): string {
  return farCbOutcomeDetailUrl(o.symbol, o.strike, o.expiry)
}

// ─────────────────────────────────────────────────────────────────────────────
// § 9 — POST /api/far-cb-tickers (H17, H20) — THE ONLY MUTATION
// ─────────────────────────────────────────────────────────────────────────────

/** The request body, exactly as v2's one caller sends it: a symbol, and nothing else. */
export interface AddTickerRequest {
  /** `newTicker.trim().toUpperCase()`. v2 normalises at SUBMIT time, never on keystroke. */
  symbol: string
}

/** The route's 200 body (`api-router.js:4973`). `ticker` is the inserted roster row. */
export interface AddTickerResponse {
  ok?: boolean
  error?: string
  ticker?: unknown
}

/**
 * H17 — add a ticker to the far-CB roster.
 *
 * NOT ON `query()`, AND IT MUST NOT BE. `query()` is a GET with a dedupe cache;
 * a deduped or cached mutation is a mutation that silently does not happen —
 * which here would mean a user adding two tickers in one tick and getting one.
 * This is the only raw `fetch` in either of the two data files, and it is a
 * genuine mutation, which is the only thing that earns one.
 *
 * Transcribed exactly: `method POST`, `Content-Type: application/json`, body
 * `{symbol}`. v2 reads `res.json()` UNCONDITIONALLY and then throws
 * `j.error || "Add failed"` on `!res.ok` — so the server's own sentence wins
 * ("Sign in to add a ticker" on a 401, "Ticker is required" on a 400,
 * `libDb.addFarCbTicker`'s own rejection on a duplicate) and the fallback fires
 * only when the body carries no `error`. Kept, including the unconditional
 * parse, because that is where the good message comes from.
 *
 * ONE ADDITION TO v2'S REQUEST, and it is the only one: `credentials:
 * 'same-origin'`. v2 omitted it and relied on the browser default, which sends
 * cookies same-origin anyway; `query()` sets it explicitly on every read, and a
 * route gated `auth: 'user'` (api-router.js:4959–4960 — signed-in, no paid
 * check) must not be the one call in v3 that leaves its auth to a default.
 *
 * NOTHING REFETCHES ON SUCCESS (H20). v2 does not call `load()`; the added
 * ticker appears only when the 2-minute poll happens to run after the server's
 * next sweep, which is what `addSuccessMessage` is telling the user. Preserved
 * — do not "helpfully" invalidate the flag feed here, because the row will not
 * be there yet and an immediate refetch would look like the add failing.
 *
 * BUG (v2): the `+ Add` button is `disabled` while this is in flight, but the
 * input's Enter handler is not, so Enter can DOUBLE-POST (H15, H220). The guard
 * is `canAddTicker` in watchThis.ts and both call sites in step 3 must go
 * through it. Recorded, not fixed here — this loader has no idea which
 * affordance called it.
 */
export async function addFarCbTicker(body: AddTickerRequest): Promise<AddTickerResponse> {
  const res = await fetch(EP_FAR_CB_TICKERS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  })
  const j = (await res.json().catch(() => ({}))) as AddTickerResponse
  if (!res.ok) throw new Error(j?.error || ADD_FAILED_FALLBACK)
  return j
}

/**
 * @notWiredInV2 — `GET /api/far-cb-tickers` exists and answers `{ok, rows}`
 * with the roster (`api-router.js:4976–4980`, same `auth: 'user'` gate), and
 * the Watch tab NEVER CALLS IT: the tab can add a ticker and cannot list what
 * is on the watchlist. The universe is visible only as whatever the recorder
 * happens to flag, which is why the card subtitle can say "scanner universe"
 * without anything on screen naming it — spec open question 3(c).
 *
 * The PATH is written down here so v3 has exactly one spelling of it if step 3
 * decides the tab should show its own roster. NO loader and NO response type
 * are declared, because the row shape is `libDb.listFarCbTickers()`'s and
 * guessing at it would put a wrong type in the tree.
 */
export const EP_FAR_CB_TICKERS_LIST = EP_FAR_CB_TICKERS

// ─────────────────────────────────────────────────────────────────────────────
// § 10 — ROUTE ENTRY
// ─────────────────────────────────────────────────────────────────────────────

export interface WatchThisEntry {
  /** Rejects like v2's `load` — the banner renders and the old grid stays. */
  flags: PromiseSettledResult<WatchLoad>
  /** Never rejects — `loadFarCbOutcomes` returns its failures as variants, as v2 swallowed them. */
  outcomes: PromiseSettledResult<OutcomesLoad>
}

/**
 * H205 — both feeds at entry, together.
 *
 * v2's mount already fired these in parallel from two independent effects, so
 * this preserves the shape rather than straightening anything. They are settled
 * SEPARATELY because they feed two independent regions of the card: a dead flag
 * feed must not empty the tracked-results table, and vice versa.
 *
 * The Results page is NOT here — it loads on entering that view, once, and
 * `view` selects which of the two outcome URLs the tab is on.
 */
export async function loadWatchThisEntry(
  view: OutcomeStatusView = 'all',
): Promise<WatchThisEntry> {
  const [flags, outcomes] = await Promise.allSettled([
    loadFarCbWatch(),
    loadFarCbOutcomes(view),
  ])
  return { flags, outcomes }
}

// ─────────────────────────────────────────────────────────────────────────────
// § 11 — THE SAME FOUR READS, SHAPED FOR `useQuery`
//
// ADDED IN STEP 3, AND HERE RATHER THAN IN THE COMPONENT ON PURPOSE. `useQuery`
// takes a URL and returns `{data, error}`; it does not call the loaders above.
// Three of the four reads have to go through it rather than through a loader,
// because the two behaviours the port needs from it cannot be hand-rolled in a
// component without re-introducing exactly what "Do not port" H214/H215 removed:
//
//   • `pollMs` — the 120 s and 60 s polls, both now skipping a hidden tab, with
//     an immediate catch-up tick on the way back. Hand-rolling them means
//     `setInterval` again.
//   • URL-keyed invalidation — passing `null` for a closed detail row, which is
//     v2's `detailReq` counter (H202) expressed as data.
//
// So the ENVELOPE RULES — which body counts as rows, which counts as an error,
// and what the error sentence is — are written once, here, and both the loaders
// above and the render layer read them. Every branch below is the same v2 branch
// its loader applies; nothing new is decided.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * H195 — the flag feed's rows, or `null` when this body must not be applied.
 *
 * `null` covers both "nothing back yet" and "a body that did not say `ok`",
 * because v2 leaves the previous rows on screen in both cases (it throws before
 * `setRows`). The caller keeps its own last-good value; that is the screen v2
 * shows, not an empty grid.
 */
export function watchRowsFromQuery(j: WatchResponse | undefined): WatchLoad | null {
  if (!j?.ok) return null
  return { rows: j.rows || [], threshold: j.threshold ?? null }
}

/**
 * H21–H24 — the flag feed's error sentence, or `null`.
 *
 * A THROWN request wins over an `ok:false` body, because in v2 the two cannot
 * coexist: one `load()` produces one or the other. Under `useQuery` they can —
 * `data` holds the LAST GOOD body while `error` holds the newest failure — and
 * the newest failure is the one v2 would be showing.
 *
 * The message is normalised through `watchErrText` so it still reaches
 * `isRecorderNotRunError`; see the THIRD departure in the file header.
 */
export function watchErrorFromQuery(
  j: WatchResponse | undefined,
  e: Error | null,
): string | null {
  if (e) return watchErrText(e)
  if (j && !j.ok) return j.error || LOAD_FAILED_FALLBACK
  return null
}

/**
 * H198 — the flat table's rows, or `null` when this body must not be applied.
 *
 * `null` on an `ok:false` body is v2's `if (j.ok)` not firing, and there is no
 * companion error accessor ON PURPOSE: v2's `catch {}` is empty and its
 * `ok:false` branch is a no-op, so BOTH failures are invisible and the table
 * keeps its previous rows saying nothing. H216 asks v3 for a real error branch
 * there; adding one is a visible change and step 3 is not the place for it.
 */
export function outcomesRowsFromQuery(j: OutcomesResponse | undefined): OutcomeRow[] | null {
  if (!j?.ok) return null
  return j.rows || []
}

/** H200 — the Results page's rows. Same acceptance rule; this one has an error too. */
export function resultsRowsFromQuery(j: OutcomesResponse | undefined): OutcomeRow[] | null {
  if (!j?.ok) return null
  return j.rows || []
}

/** H104 — `resultsErr`. Unlike the flat table, this call site DOES surface both failures. */
export function resultsErrorFromQuery(
  j: OutcomesResponse | undefined,
  e: Error | null,
): string | null {
  if (e) return errText(e)
  if (j && !j.ok) return j.error || LOAD_FAILED_FALLBACK
  return null
}

/** H201 — the whole body is the detail, so there is nothing to unwrap. */
export function detailFromQuery(j: DetailResponse | undefined): OutcomeDetail | null {
  return j?.ok ? j : null
}

/** H151 — `detailErr`. */
export function detailErrorFromQuery(
  j: DetailResponse | undefined,
  e: Error | null,
): string | null {
  if (e) return errText(e)
  if (j && !j.ok) return j.error || LOAD_FAILED_FALLBACK
  return null
}
