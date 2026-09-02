// ─────────────────────────────────────────────────────────────────────────────
// THE GEX LEVELS TAB — THE DATA LAYER. Six endpoints, two polls, nothing else.
//
// Transcribed 1:1 from v2's `components/scanner/GexLevelsTab.tsx` (the five
// fetch call sites: `useGexLevels` :157–176, `fetchOiTotalsForExpiry` /
// `useOiByExpiration` :886–946, `useEodGex` :1090–1136, `useGexByStrikeMulti`
// :1317–1364, `fetchServerGlHistory` :1532–1568) and
// `components/dashboard/VolGexFlowPanel.tsx` (the sixth, `load` :178–214),
// against the checklist in docs/parity/scanner.md Part B, rows B18–B19,
// B113–B115, B141–B145, B171–B177, B210–B215 and B267–B274, B275–B285, B335.
//
// The TYPES, the derivations, the copy and the persistence helpers are NOT
// here — they are in gexLevels.ts and are imported. This file owns exactly one
// thing: the URLs, and what comes back off them.
//
// SEVEN pieces of behaviour here that are NOT obvious from the screen:
//
//   1. THE WATERFALL IS REAL AND IT STAYS. /api/chains cannot be addressed
//      without an EXPIRATION, and the only thing that hands the client a list
//      of expirations is /proxy/gex's `expirations` field. It is not a value
//      the client already had; it is data, so this is not the artificial
//      waterfall v3 non-negotiable 4 is about. Full reasoning, and the ONE
//      route that could narrow the first hop, in the departure block below.
//
//   2. THE `d`-GATE IS A RENDER DECISION, NOT A DATA ONE. In v2 all twelve
//      cards live inside `{d && (…)}` (:2048) — the gate being `d != null`,
//      which needs BOTH `rows.length > 0` AND `spot > 0`. So a /proxy/gex
//      outage blanks the four cards that have their own data source and may be
//      answering perfectly: both EOD boards (/api/eod-gex outright), and Open
//      interest by date and the history log, which read the persisted log for
//      every PRIOR session and take only TODAY's row from the live derivation.
//      A blank chart where nine sessions of history are sitting in
//      localStorage. Every loader below is INDEPENDENTLY AWAITABLE and
//      `loadGexLevelsEntry` settles them separately, so a step-3 route can give
//      each card its own loading and empty state. Nothing in this file gates
//      anything on anything. Spec B96, "Do not port" 16.
//
//   3. THE `date` OF THE OI CACHE IS AN ET CALENDAR DAY, NOT A TTL. OPRA open
//      interest is posted once, around 06:30 ET, and reflects the PRIOR close.
//      So the OI card does not ride the 15s poll at all: a cache entry stamped
//      with today's ET date answers without a request, and only the card's own
//      Refresh (`force`) goes past it. That is why `CHAINS_STALE_MS` is 0 —
//      an in-memory window here would swallow exactly the request Refresh
//      exists to make.
//
//   4. NULL AND ZERO ARE DIFFERENT ON THE EOD FEED. `total_gex_ex0dte` and
//      `total_gex_0dte` are coerced `o.x == null ? null : (Number(o.x) || 0)`,
//      so a row that predates the column stays NULL and the chart DROPS that
//      session rather than plotting it at zero on the wrong basis. `spot` and
//      the date get no such treatment. See `parseEodRows`.
//
//   5. THE MULTI FEED SHIPS SLIM ROWS AND `multiRow` ZERO-FILLS THE REST.
//      `{strike, netGEX, netVolGEX, netDEX, volNetDEX}` is everything the two
//      gamma ladders and the ex-0DTE delta ladder need, because `oiVolNet` sums
//      the gamma pair and `dexOf` the delta pair. The zero-fill is what lets
//      the shared chart components stay untouched — and it is silently lossy:
//      a call/put gamma surface pointed at one of these ladders would draw
//      nothing. Nothing points one at it. Spec B215.
//
//   6. TWO FAILURE MODES ON THE FLOW FEED, WITH DIFFERENT SIDE EFFECTS. A body
//      that says `ok: false` CLEARS the series (and still advances the updated
//      stamp); a request that THROWS keeps the last good series on screen under
//      the error scrim and does NOT advance the stamp. v2 wrote those two
//      branches deliberately and the difference is visible. Modelled below as
//      separate variants so step 3 cannot merge them by accident. Spec
//      B281–B282, B299.
//
//   7. THE SERVER HISTORY FEED FAILS COMPLETELY SILENTLY, and an EMPTY server
//      answer is DISCARDED rather than merged. `loadGexLevelsHistory` returns
//      `[]` on every failure path — no status, no message — and
//      `mergeServerHistory` returns the local rows untouched when the server
//      sent none, so a dead endpoint reads as "Logging starts as soon as a
//      level moves." rather than as an outage. Spec B141, B145, open
//      question 7.
//
// ── THE ONE DELIBERATE DEPARTURE FROM v2 ─────────────────────────────────────
// /api/eod-gex IS REQUESTED ONCE INSTEAD OF TWICE. v2 mounts an `EodGexPanel`
// per EOD card and each panel owns its own `useEodGex(30)`, so
// `/api/eod-gex?symbol=%24SPX&limit=30` — IDENTICAL params, both times — goes
// out TWICE on every mount of the tab, and twice more on every Refresh click
// (B114, "Do not port" 15). `query()` is keyed on the URL and returns the
// in-flight promise to the second caller, so the duplicate collapses for free:
// one request, two readers, same rows. Both cards still choose their own BASIS
// (`totalGex0dte` / `totalGexEx0dte`) client-side, which is what they always
// did — the basis was never a request parameter.
//
// SECOND DEPARTURE — `{cache: "no-store"}` AND FIVE HAND-ROLLED INTERVALS
// BECOME `staleMs` AND `pollMs`. Every fetch in both v2 files but one sends
// `{cache: "no-store"}`; `staleMs: 0` is the `query()` equivalent — no cached
// value is ever old enough to serve, so it always goes to the network. What is
// NEW is dedupe by URL, which v2 had nowhere.
//
// That matters because THERE IS NO `AbortController` ANYWHERE IN EITHER v2
// FILE (B273). v2 clears its intervals and flips an `alive` flag on unmount,
// but the in-flight request runs to completion, and only `useGexLevels` and
// `fetchServerGlHistory`'s caller guard the late `setState` — `useEodGex`,
// `useOiByExpiration`, `useGexByStrikeMulti` and `VolGexFlowPanel.load` all
// write state unconditionally in their `finally`/`catch`. `query()` does not
// abort either; it makes the race unwinnable a different way, by ADDRESSING
// STALENESS WITH THE URL. Two loads of the SAME url share one promise and
// cannot resolve out of order. Two loads of DIFFERENT urls — a session or
// expiry switch on card 12 — still can, exactly as in v2, and step 3's
// `useQuery(url)` discards the previous url's result because the hook is keyed
// on the url it is currently reading. Nothing here needs a `signal`.
//
// THIRD — THE POLLS NOW PAUSE ON A HIDDEN TAB, and card 12's wake-on-visible
// tick is no longer this file's to write. v2 ran the 15s /proxy/gex poll, the
// 60s multi poll and card 12's 15s flow poll at FULL RATE in a background tab
// (B274); `query()`'s `pollMs` skips a tick while `document.visibilityState`
// is `hidden` and fires one immediately on the way back. That last half is
// EXACTLY what `VolGexFlowPanel.tsx:211–212` hand-rolled — the tab's only
// `document.visibilityState` reference, and the one that made a poll MORE eager
// rather than pausing anything. It comes for free now. `background: true` is
// NOT set on any of the three: every one of these feeds is a current-value
// read where a missed tick is repaired by the next one, which is the only
// condition that would justify it.
//
// FOURTH, and it is a LOSS worth naming: THE MULTI FEED'S CONTENT-TYPE GUARD
// CANNOT BE REPRODUCED EXACTLY. v2 inspects `res.headers` BEFORE parsing, so an
// un-redeployed server-v2 — where the request falls through to Next's HTML 404
// — gets the sentence "endpoint … not found — server-v2 needs a
// restart/redeploy" instead of `Unexpected token '<'`. `query()` hides the
// Response. `loadGexByStrikeMulti` recovers the sentence by MAPPING the two
// error shapes that reach it (a 404 status in the thrown message, or a JSON
// SyntaxError from an HTML body served with a 200) back onto v2's string. It is
// a heuristic on an error message where v2 had a header; if `query()` ever
// grows a way to surface the response, this should use it.
//
// ── REMOVED IN v2, DO NOT RE-ADD ─────────────────────────────────────────────
// • THE FIVE DIRECT `fetch()` CALLS AND THEIR `useState` TRIPLES (B267–B271,
//   "Do not port" 13). Each endpoint carried its own rows/loading/err trio and
//   its own `setInterval`. `query` / `useQuery` / `preload` dedupe, cache and
//   pause polling; none of that existed here.
// • `EodGexRow.totalGex` AND THE `total_gex` COLUMN. Parsed by v2 only to feed
//   `EOD_GEX_FIELD_META.totalGex`, the "legacy, mixed basis" default that no
//   call site ever passes. The column is not chartable as one series at all —
//   its basis depends on which writer touched the row last. `parseEodRows`
//   below does not read it. Spec B136, "Do not port" 6.
// • `GexLevelsRow.callVolume` / `putVolume` (v2 :96–97), which `multiRow`
//   zero-filled alongside the rest. Declared on the wire type, read by nothing
//   in 2233 lines; gexLevels.ts dropped them from `GexLevelsRow` and this file
//   therefore cannot fill them.
// • THE `symbol` PARAM ON /proxy/gex-vol-flow. The route reads it and defaults
//   to `$SPX` (server-with-proxy.js:1177) because `option_strike_gex_history`
//   is multi-symbol; v2's panel never sends it and takes the default. Not sent
//   here either — adding it would be a new decision about which underlying
//   card 12 charts, and card 12 is shared with /home.
// • THE `alive` FLAGS AND `clearInterval` PAIRS. Lifetime is `useQuery`'s.
//
// Spec: docs/parity/scanner.md Part B, rows B18–B19, B113–B115, B141–B145,
// B171–B177, B210–B215, B267–B274, B275–B285, B335.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '@/data/api'
import {
  BIN_SEC,
  EOD_GEX_DAYS,
  EOD_GEX_SYMBOL,
  HISTORY_FETCH_LIMIT,
  VOL_FLOW_ALL,
  VOL_FLOW_FRONT,
  loadHistory,
  mergeHistory,
  oiExpiryTargets,
  readFreshOiExpiryCache,
  saveOiExpiryCache,
  sumChainOi,
} from '@/pages/scanner/gexLevels'
import type {
  CardEndpoint,
  CurvePoint,
  EodGexRow,
  GexLevelsRow,
  GexLevelsSnapshot,
  GexMultiLadder,
  GexMultiPayload,
  HistoryEntry,
  OiByExpiryRow,
  VolFlowResponse,
  VolFlowSession,
} from '@/pages/scanner/gexLevels'

// ─────────────────────────────────────────────────────────────────────────────
// § 1 — THE SIX ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

/** B18 — the live 0DTE snapshot. Walls, flip, spot, the strike ladder, the expiration list. */
export const EP_GEX = '/proxy/gex'
/** B210 — the same ladder widened to every listed expiration, plus an ex-0DTE cut. */
export const EP_GEX_BY_STRIKE_MULTI = '/proxy/gex-by-strike-multi'
/** B141 — the server-persisted key-level log (`gex_levels_history`, kept forever). */
export const EP_GEX_LEVELS_HISTORY = '/proxy/gex-levels-history'
/** B275 — card 12's intraday vol-GEX flow, bucketed server-side. */
export const EP_GEX_VOL_FLOW = '/proxy/gex-vol-flow'
/** B173 — the nested option chain, one expiry at a time. The only OI source. */
export const EP_CHAINS = '/api/chains'
/** B113 — one row per session from `eod_gex`. */
export const EP_EOD_GEX = '/api/eod-gex'

// ─────────────────────────────────────────────────────────────────────────────
// § 2 — POLL AND STALE WINDOWS
//
// `GEX_MULTI_POLL_MS` (60s) and `VOL_FLOW_POLL_MS` (15s) live in gexLevels.ts
// beside the comments that explain them; only the 0DTE feed's interval is
// declared here, because nothing outside the data layer reads it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * B19 — 15s, fixed. No jitter, no market-hours gate. /proxy/gex is a LIVE 0DTE
 * feed: the walls, the flip and $Gamma all move on it, and every card in the
 * left column plus all four header tiles are computed off one memo of it.
 */
export const GEX_POLL_MS = 15_000

/**
 * v2 sent `{cache: "no-store"}` on five of the six. `staleMs: 0` is the
 * `query()` equivalent: no cached value is old enough to serve, so every call
 * goes to the network — while two simultaneous calls for the same URL still
 * collapse into one request.
 */
const NO_STORE_STALE_MS = 0

/**
 * /api/chains is the ONE v2 fetch with no `cache` option (B173) — it rides the
 * browser's default HTTP cache. It gets a ZERO in-memory window here on
 * purpose: the real cache is the per-ET-day localStorage entry
 * (`readFreshOiExpiryCache`), and the only thing that ever gets past that is
 * the card's Refresh, which exists precisely to force a re-pull. An in-memory
 * window would swallow it.
 */
const CHAINS_STALE_MS = 0

// ─────────────────────────────────────────────────────────────────────────────
// § 3 — URL BUILDERS
//
// Every one of these takes what it needs as an ARGUMENT. That is the whole
// reason a route can fire them together at entry, and it is what makes the
// `d`-gate (header note 2) a render decision rather than a data one.
// ─────────────────────────────────────────────────────────────────────────────

/** B18 — no query params at all. The feed's symbol and expiry are the server's choice. */
export function gexUrl(): string {
  return EP_GEX
}

/**
 * B210 — `symbol` is `$SPX`, HARDCODED in v2 (`EOD_GEX_SYMBOL`, passed at
 * :1915), NOT `snap.symbol`. So the three multi-expiry cards describe SPX while
 * the four header tiles above them follow whatever the shared feed is on. If
 * the feed ever moves off SPX they silently disagree — spec open question 6.
 * Defaulted rather than hardcoded here so step 3 can settle that question
 * without editing a URL.
 */
export function gexByStrikeMultiUrl(symbol: string = EOD_GEX_SYMBOL): string {
  return `${EP_GEX_BY_STRIKE_MULTI}?symbol=${encodeURIComponent(symbol)}`
}

/** B141 — `limit=3650`. Ten years of sessions; the table itself has no window. */
export function gexLevelsHistoryUrl(limit: number = HISTORY_FETCH_LIMIT): string {
  return `${EP_GEX_LEVELS_HISTORY}?limit=${limit}`
}

/** B113 — `symbol=%24SPX&limit=30`, both constants, both from gexLevels.ts. */
export function eodGexUrl(symbol: string = EOD_GEX_SYMBOL, days: number = EOD_GEX_DAYS): string {
  return `${EP_EOD_GEX}?symbol=${encodeURIComponent(symbol)}&limit=${days}`
}

/**
 * B173 — one expiry per request. `range=all` is a literal, sent on every call;
 * both other params are `encodeURIComponent`'d.
 */
export function chainsUrl(symbol: string, expiry: string): string {
  return `${EP_CHAINS}?ticker=${encodeURIComponent(symbol)}&expiration=${encodeURIComponent(expiry)}&range=all`
}

/**
 * B275, B276, B277, B278, B335 —
 * `?bin=30&session={rth|eth}&{scope=all | scope=front | expiry=<iso>}`.
 *
 * `bin` is always 30: the floor the endpoint enforces AND the recorder's write
 * cadence, so every bucket holds exactly one row. The scope clause is EXACTLY
 * ONE of the three, chosen off the picker's value — the two sentinels
 * (`__front__`, `__all__`) can never collide with a real pick because neither
 * parses as a date. Anything else is sent as `expiry=`, encoded.
 *
 * Param ORDER is v2's: bin, session, then the scope clause.
 */
export function volGexFlowUrl(pick: string, session: VolFlowSession): string {
  const scope =
    pick === VOL_FLOW_ALL
      ? 'scope=all'
      : pick === VOL_FLOW_FRONT
        ? 'scope=front'
        : `expiry=${encodeURIComponent(pick)}`
  return `${EP_GEX_VOL_FLOW}?bin=${BIN_SEC}&session=${session}&${scope}`
}

/**
 * The URLs a route can hand to `preload()` the moment the tab is entered —
 * every source that needs NOTHING from another request. /api/chains is absent
 * on purpose; see the waterfall note.
 */
export function gexLevelsPreloadUrls(): string[] {
  return [
    gexUrl(),
    gexByStrikeMultiUrl(),
    eodGexUrl(),
    gexLevelsHistoryUrl(),
    volGexFlowUrl(VOL_FLOW_FRONT, 'rth'),
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// § 4 — THE WATERFALL, AND WHY IT IS NOT STRAIGHTENED
//
// v3 non-negotiable 4 forbids awaiting request A to build request B's URL FROM
// A VALUE THE CLIENT ALREADY HAD. This one is not that, and the distinction is
// the whole decision:
//
//   • /api/chains is addressed PER EXPIRY (`&expiration=YYYY-MM-DD`,
//     v2 :888). It has no "give me every expiry" mode from this call site —
//     omitting the param makes the route pick the nearest three itself
//     (proxy-tastytrade.js:1329–1341), which is a different question from the
//     one the card asks.
//   • The list of expirations to ask for is `snap.expirations` — a FIELD OF
//     /proxy/gex's RESPONSE BODY (v2 :2100, `expirations={snap?.expirations ?? []}`).
//     There is no route param, no URL segment and no client-side derivation
//     that produces it. It is data.
//
// So the URL genuinely cannot be built without a first hop, and the sequence
// stays. What DOES change: `loadOiByExpiration` takes `symbol` and
// `expirations` as ARGUMENTS rather than reaching into a snapshot, so the hop
// is the ROUTE's to schedule and every other loader on this tab fires at entry
// beside the first one, in parallel, unblocked.
//
// ONE FINDING FOR STEP 3, recorded and NOT acted on: the first hop does not
// have to be /proxy/gex. `/api/expirations?ticker=SPX` is a live registered
// route (api-router.js:533–541 → `/proxy/api/tt/expirations/:ticker` →
// `fetchExpirations`, proxy-tastytrade.js:1430–1441) that returns nothing but
// the list, from the SAME server-side cache: `getChainCached` is keyed on
// `chainTicker(ticker)`, and `chainTicker('SPXW') === 'SPX'`, so the feed's own
// expirations (`marketState.setExpirations`, proxy-tastytrade.js:2314–2315,
// filtered `e >= today`) and this route's (`filter(e => e >= today)`) are the
// same array from the same cache entry. v3's shell already prefetches it
// (`Shell.tsx:56`). Swapping the first hop would make the OI card independent
// of the heavy 0DTE snapshot, which is a real improvement — and it CHANGES
// WHICH ENDPOINT A CARD DEPENDS ON, which is a step-3 decision, not a
// transcription. No loader for it is written here.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// § 5 — ERROR STRINGS
// ─────────────────────────────────────────────────────────────────────────────

/** B18 — v2's own wording, `proxy ${r.status}`, thrown before the body is read. */
export const gexProxyError = (status: number): string => `proxy ${status}`

/** B113, B173 — both use this bare form. */
export const httpError = (status: number): string => `HTTP ${status}`

/** The only status a body can arrive with once `query()` has resolved. */
const OK_STATUS = 200

/**
 * B212 — the sentence a stale deploy earns. Without it, an un-redeployed
 * server-v2 falls through to Next's HTML 404 and the parse throws
 * `Unexpected token '<', "<!DOCTYPE "…`, which reads like a data bug rather
 * than a missing route.
 */
export const MULTI_ROUTE_MISSING =
  'endpoint /proxy/gex-by-strike-multi not found — server-v2 needs a restart/redeploy to pick up the route'

/** B212 — the other half of the guard, for any non-JSON that is not an HTML 404. */
export const multiUnexpectedResponse = (contentType: string, status: number): string =>
  `unexpected ${contentType || 'empty'} response (HTTP ${status})`

/** B175 — thrown when EVERY expiry's /api/chains leg rejected. */
export const OI_NO_EXPIRATIONS = 'no expirations resolved'

/** v2's `catch` text throughout both files: `e instanceof Error ? e.message : String(e)`. */
function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ─────────────────────────────────────────────────────────────────────────────
// § 6 — /proxy/gex (B18–B19, B267)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The live 0DTE snapshot, unparsed and unfiltered — `deriveGexLevels` in
 * gexLevels.ts is what turns it into something renderable, and it is the thing
 * that can return null.
 *
 * v2 throws `proxy ${status}` on a non-2xx BEFORE reading the body; `query()`
 * throws `${status} ${statusText} — ${url}`, which carries strictly more. The
 * v2 wording is exported above so step 3 can choose; this loader does not
 * rewrite the message, because burying the URL would make a proxy outage
 * harder to place, not easier.
 *
 * ON FAILURE THE CARD SET DOES NOT BLANK. v2 sets `err` and leaves `snap` at
 * its PREVIOUS value, so the page shows stale data plus an error banner. That
 * is `useQuery`'s behaviour too — a failed poll keeps the last good value — and
 * it is why the loader throws rather than returning a null.
 */
export function loadGexSnapshot(): Promise<GexLevelsSnapshot> {
  return query<GexLevelsSnapshot>(gexUrl(), { staleMs: NO_STORE_STALE_MS })
}

// ─────────────────────────────────────────────────────────────────────────────
// § 7 — /proxy/gex-by-strike-multi (B210–B215, B268)
// ─────────────────────────────────────────────────────────────────────────────

/** The slim row the endpoint actually ships. Everything else on `GexLevelsRow` is zero-filled. */
interface MultiWireRow {
  strike?: number
  netGEX?: number
  netVolGEX?: number
  netDEX?: number
  volNetDEX?: number
}

interface MultiWireLadder {
  rows?: unknown[]
  totalNetGex?: number | null
  gexFlip?: number | null
  callWall?: number | null
  putWall?: number | null
}

interface MultiWirePayload {
  ok?: boolean
  error?: string
  spot?: number
  sessionDate?: string
  expiryCount?: number
  all?: unknown
  ex0dte?: unknown
  updatedAt?: number
  cached?: boolean
}

/**
 * B215 — zero-fill the six fields the slim row omits so the shared chart
 * components stay untouched.
 *
 * The DELTA legs arrive as 0 from a server-v2 that predates the slimRows
 * change: the ex-0DTE net-delta card then draws a FLAT LINE rather than
 * throwing, which is why gexLevels.ts carries `multiDeltaAllZero` and a
 * sentence saying so — a convincing flat line is the failure mode worth naming.
 */
function multiRow(r: unknown): GexLevelsRow {
  const o = (r ?? {}) as MultiWireRow
  return {
    strike: Number(o.strike ?? 0),
    callOI: 0,
    putOI: 0,
    callGEX: 0,
    putGEX: 0,
    netGEX: Number(o.netGEX ?? 0),
    netVolGEX: Number(o.netVolGEX ?? 0),
    netDEX: Number(o.netDEX ?? 0),
    volNetDEX: Number(o.volNetDEX ?? 0),
  }
}

/**
 * B214 — `strike > 0` is STRICT, so the zero-filled strike a malformed row
 * produces is dropped rather than drawn at the left edge. The four scalars are
 * `== null ? null : Number(v)`: a server-v2 predating the walls change omits
 * `callWall`/`putWall` and they parse as null, which is what makes
 * `multiStatusLine` drop the whole walls clause instead of printing "—".
 */
function parseMultiLadder(v: unknown): GexMultiLadder {
  const o = (v ?? {}) as MultiWireLadder
  const rows = Array.isArray(o.rows)
    ? o.rows.map(multiRow).filter((r) => Number.isFinite(r.strike) && r.strike > 0)
    : []
  return {
    rows,
    totalNetGex: o.totalNetGex == null ? null : Number(o.totalNetGex),
    gexFlip: o.gexFlip == null ? null : Number(o.gexFlip),
    callWall: o.callWall == null ? null : Number(o.callWall),
    putWall: o.putWall == null ? null : Number(o.putWall),
  }
}

/**
 * B212 — recover v2's content-type sentence from the error `query()` throws.
 *
 * v2 read `res.headers.get("content-type")` before parsing. `query()` does not
 * expose the Response, so the two shapes that reach here are matched instead:
 *
 *   • a NON-2xx — `query()` throws `"404 Not Found — /proxy/…"`. Only a 404
 *     earns v2's "not found" sentence; every other status falls through to
 *     `multiUnexpectedResponse` with an unknown content type, which is the
 *     branch v2's `else` took.
 *   • a 200 CARRYING HTML — `res.json()` throws a SyntaxError. v2 caught this
 *     with `ct.includes("text/html")` and gave the SAME "not found" sentence,
 *     because that is what an un-redeployed server-v2 does.
 *
 * A heuristic where v2 had a header. Flagged in the departure block.
 */
function multiErrorText(e: unknown): string {
  if (e instanceof SyntaxError) return MULTI_ROUTE_MISSING
  const msg = errText(e)
  if (/^404\b/.test(msg)) return MULTI_ROUTE_MISSING
  const status = Number(/^(\d{3})\b/.exec(msg)?.[1] ?? 0)
  return status ? multiUnexpectedResponse('', status) : msg
}

/**
 * B210 — one request feeding all three multi-expiry cards (two gamma ladders
 * and the ex-0DTE delta ladder). ONE shared load in v2 too, at tab level; the
 * three cards' Refresh buttons all hit it, and one failure paints the same
 * error line in all three.
 *
 * B213 — `!res.ok || json?.ok === false` both throw `String(json?.error ||
 * HTTP ${status})`. `query()` has already thrown on the non-2xx by the time we
 * get a body, so only the `ok === false` half survives here; the status half is
 * covered by `multiErrorText`.
 *
 * `sessionDate`, `updatedAt` and `cached` are parsed and rendered NOWHERE
 * (B213, "Do not port" 9) — the three cards carry no freshness stamp at all
 * despite reading a body the server caches for ~60s. Kept parsed; see the note
 * on `GexMultiPayload` in gexLevels.ts.
 */
export async function loadGexByStrikeMulti(
  symbol: string = EOD_GEX_SYMBOL,
): Promise<GexMultiPayload> {
  let json: MultiWirePayload
  try {
    json = await query<MultiWirePayload>(gexByStrikeMultiUrl(symbol), {
      staleMs: NO_STORE_STALE_MS,
    })
  } catch (e) {
    throw new Error(multiErrorText(e))
  }
  // v2: `String(json?.error || \`HTTP ${res.status}\`)`. By the time a body
  // exists the status was 2xx, so the fallback half was only ever reachable as
  // "HTTP 200" — a body that says ok:false and then declines to say why.
  if (json?.ok === false) throw new Error(String(json?.error || httpError(OK_STATUS)))
  return {
    spot: Number(json.spot ?? 0),
    sessionDate: String(json.sessionDate ?? ''),
    expiryCount: Number(json.expiryCount ?? 0),
    all: parseMultiLadder(json.all),
    ex0dte: parseMultiLadder(json.ex0dte),
    updatedAt: Number(json.updatedAt ?? Date.now()),
    cached: !!json.cached,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// § 8 — /api/eod-gex (B113–B115, B269)
// ─────────────────────────────────────────────────────────────────────────────

interface EodWireRow {
  date?: string
  total_gex_ex0dte?: number | string | null
  total_gex_0dte?: number | string | null
  spot?: number | string
}

interface EodWirePayload {
  rows?: unknown[]
}

/**
 * B115 — the parse, with three rules that are each load-bearing:
 *
 *   • `date` is TRUNCATED to ten characters and then used as the filter: a row
 *     with no date is dropped entirely.
 *   • the two OI+Vol columns keep NULL (see header note 4). `Number(x) || 0`
 *     inside the non-null branch is v2's, and it turns a NaN into 0 — but only
 *     for a value the row actually carried.
 *   • the sort is `a.date.localeCompare(b.date)`, ASCENDING. The API answers
 *     newest-first and the chart wants oldest → newest, left → right.
 *
 * `total_gex` is NOT read — see the REMOVED block.
 */
function parseEodRows(json: EodWirePayload | null | undefined): EodGexRow[] {
  const raw: unknown[] = Array.isArray(json?.rows) ? json.rows : []
  return raw
    .map((r): EodGexRow => {
      const o = (r ?? {}) as EodWireRow
      return {
        date: String(o.date ?? '').slice(0, 10),
        totalGexEx0dte: o.total_gex_ex0dte == null ? null : Number(o.total_gex_ex0dte) || 0,
        totalGex0dte: o.total_gex_0dte == null ? null : Number(o.total_gex_0dte) || 0,
        spot: Number(o.spot ?? 0) || 0,
      }
    })
    .filter((r) => r.date)
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * B113 — fires ONCE per mount, no poll: `run` is a `useCallback` keyed on
 * `days`, `days` is the constant 30, so the effect never re-runs. The only
 * other way it fires is the card's own Refresh.
 *
 * BOTH EOD cards read this ONE call — see THE ONE DELIBERATE DEPARTURE. Which
 * BASIS each card charts (`totalGex0dte` vs `totalGexEx0dte`) is chosen
 * client-side by `eodPlottable` in gexLevels.ts; it was never a param.
 *
 * There is no loading flag in v2's first paint sense: `rows` starts `[]` and
 * `loading` starts false, so the very first frame renders the empty note, not
 * a spinner. Preserved by returning rows and letting step 3's `useQuery`
 * expose its own `loading`.
 */
export async function loadEodGex(
  symbol: string = EOD_GEX_SYMBOL,
  days: number = EOD_GEX_DAYS,
): Promise<EodGexRow[]> {
  const json = await query<EodWirePayload | null>(eodGexUrl(symbol, days), {
    staleMs: NO_STORE_STALE_MS,
  })
  return parseEodRows(json)
}

// ─────────────────────────────────────────────────────────────────────────────
// § 9 — /proxy/gex-levels-history (B141–B145, B270)
// ─────────────────────────────────────────────────────────────────────────────

interface HistoryWirePayload {
  ok?: boolean
  rows?: Record<string, unknown>[]
}

/** The five nullable level fields. `""` counts as absent, not as zero. */
const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v))

/**
 * B143 — the curve arrives as JSONB (already parsed by pg) but a JSON STRING is
 * tolerated. Returns the array only when more than ONE point survives: a
 * one-point curve cannot be drawn as a line, and the cell renders "—".
 */
function parseCurve(v: unknown): CurvePoint[] | null {
  let arr: unknown = v
  if (typeof v === 'string') {
    try {
      arr = JSON.parse(v)
    } catch {
      return null
    }
  }
  if (!Array.isArray(arr)) return null
  const pts = arr
    .map((p) => ({ k: Number((p as { k?: unknown })?.k), c: Number((p as { c?: unknown })?.c) }))
    .filter((p) => Number.isFinite(p.k) && Number.isFinite(p.c))
  return pts.length > 1 ? pts : null
}

/**
 * B142 — snake_case → camel, then `.filter(e => e.date && e.spot > 0)`. A row
 * with no date or a non-positive spot is dropped; `dollar_gamma`, `cpg_ratio`
 * and `open_int` are NOT nullable and coerce through `Number(x ?? 0)`.
 */
function parseHistoryRow(row: Record<string, unknown>): HistoryEntry {
  return {
    date: String(row.date ?? ''),
    t: Number(row.t ?? 0),
    spot: Number(row.spot ?? 0),
    resistance: num(row.resistance),
    support: num(row.support),
    neutral: num(row.neutral),
    dollarGamma: Number(row.dollar_gamma ?? 0),
    cpgRatio: Number(row.cpg_ratio ?? 0),
    r2: num(row.r2),
    s2: num(row.s2),
    openInt: Number(row.open_int ?? 0),
    curve: parseCurve(row.curve),
  }
}

/**
 * B141 — and note what this does NOT do: it never surfaces an error.
 *
 * A non-2xx, a body without `ok: true`, a non-array `rows`, a thrown request —
 * every one of them returns `[]`, and the card then shows "Logging starts as
 * soon as a level moves." A user on a fresh browser with a dead history
 * endpoint reads that as "nothing has happened yet", not "the server did not
 * answer". Transcribed as written; spec open question 7 asks whether it should
 * surface an error line the way the other five fetches do.
 *
 * No poll. Fires once on tab mount.
 */
export async function loadGexLevelsHistory(
  limit: number = HISTORY_FETCH_LIMIT,
): Promise<HistoryEntry[]> {
  try {
    const j = await query<HistoryWirePayload | null>(gexLevelsHistoryUrl(limit), {
      staleMs: NO_STORE_STALE_MS,
    })
    if (!j?.ok || !Array.isArray(j.rows)) return []
    return j.rows.map(parseHistoryRow).filter((e) => e.date && e.spot > 0)
  } catch {
    // Server unreachable — the localStorage fallback stands. Silent by design.
    return []
  }
}

/**
 * B145 — the mount sequence, as one function.
 *
 * The localStorage copy is read SYNCHRONOUSLY first so the table paints from
 * cache before any request lands, and the server rows are merged in when they
 * arrive. An EMPTY server answer is DISCARDED — `if (!server.length) return` in
 * v2 — so a dead endpoint or a fresh database never clears a cache that has
 * real rows in it.
 *
 * Returns both halves rather than only the merge, because step 3 wants to paint
 * `local` immediately and `merged` on arrival, which is exactly what v2 did
 * with two `setHistory` calls.
 */
export async function loadHistoryWithCache(limit: number = HISTORY_FETCH_LIMIT): Promise<{
  local: HistoryEntry[]
  server: HistoryEntry[]
  merged: HistoryEntry[]
}> {
  const local = loadHistory()
  const server = await loadGexLevelsHistory(limit)
  return { local, server, merged: mergeServerHistory(local, server) }
}

/** The "an empty server answer changes nothing" rule, on its own. */
export function mergeServerHistory(local: HistoryEntry[], server: HistoryEntry[]): HistoryEntry[] {
  return server.length ? mergeHistory(server, local) : local
}

// ─────────────────────────────────────────────────────────────────────────────
// § 10 — /api/chains (B171–B177, B271) — THE SECOND HOP
// ─────────────────────────────────────────────────────────────────────────────

export interface OiByExpirationLoad {
  /** One row per expiry whose leg RESOLVED. Server order is the target order. */
  rows: OiByExpiryRow[]
  /** True when today's ET cache answered and NO request was made at all. */
  fromCache: boolean
  /** ms. `null` only on the `skipped` path, where v2 returned without touching state. */
  loadedAt: number | null
  /** v2's bail: no symbol, or the expiration list has not arrived yet. */
  skipped: boolean
  /**
   * Expiries whose leg REJECTED. v2 drops them silently — a chart of 12 bars
   * quietly becomes a chart of 9 with nothing saying so. Reported here because
   * it costs nothing; step 3 decides whether to say anything. Not a behaviour
   * change: the rows are the same rows.
   */
  rejected: string[]
}

/** B176 — one expiry's call/put OI totals. The summation rules live in `sumChainOi`. */
async function fetchOiTotalsForExpiry(
  symbol: string,
  expiry: string,
): Promise<{ callOI: number; putOI: number }> {
  const json = await query<unknown>(chainsUrl(symbol, expiry), { staleMs: CHAINS_STALE_MS })
  return sumChainOi(json, expiry)
}

/**
 * B171–B177 — the second hop, and the only loader on this tab that takes data
 * from another response.
 *
 * `expirations` comes from `/proxy/gex`'s snapshot; see § 4 for why that is not
 * removable and what the alternative first hop would be. It is an ARGUMENT, so
 * the dependency is the route's to schedule and nothing else on the tab waits
 * on it.
 *
 * The order of operations is v2's exactly:
 *   1. BAIL (return, touching nothing) when there is no symbol or no
 *      expirations. A snapshot that never lands leaves the card at "no data
 *      yet" forever, which is v2's behaviour.
 *   2. Unless `force`, answer from TODAY's localStorage cache without a
 *      request. `force` is the card's Refresh and skips this step only.
 *   3. `oiExpiryTargets` — a lexicographic sort of `YYYY-MM-DD` (also
 *      chronological for that format), then the nearest 12.
 *   4. `Promise.allSettled` over all twelve AT ONCE. Only fulfilled legs are
 *      kept, paired back to their target by INDEX.
 *   5. If NOTHING resolved, throw `"no expirations resolved"` — the card's one
 *      error line. A partial result is not an error.
 *   6. Write the cache, stamped with today's ET date.
 */
export async function loadOiByExpiration(
  symbol: string,
  expirations: string[],
  force = false,
): Promise<OiByExpirationLoad> {
  if (!symbol || !expirations.length) {
    return { rows: [], fromCache: false, loadedAt: null, skipped: true, rejected: [] }
  }
  if (!force) {
    const cached = readFreshOiExpiryCache(symbol)
    if (cached) {
      return {
        rows: cached.rows,
        fromCache: true,
        loadedAt: Date.now(),
        skipped: false,
        rejected: [],
      }
    }
  }
  const targets = oiExpiryTargets(expirations)
  const settled = await Promise.allSettled(
    targets.map((expiry) => fetchOiTotalsForExpiry(symbol, expiry)),
  )
  const rows: OiByExpiryRow[] = []
  const rejected: string[] = []
  settled.forEach((r, i) => {
    const expiry = targets[i]
    if (expiry == null) return
    if (r.status === 'fulfilled') rows.push({ expiry, callOI: r.value.callOI, putOI: r.value.putOI })
    else rejected.push(expiry)
  })
  if (!rows.length) throw new Error(OI_NO_EXPIRATIONS)
  saveOiExpiryCache(symbol, rows)
  return { rows, fromCache: false, loadedAt: Date.now(), skipped: false, rejected }
}

// ─────────────────────────────────────────────────────────────────────────────
// § 11 — /proxy/gex-vol-flow (B275–B285, B299, B335) — CARD 12
// ─────────────────────────────────────────────────────────────────────────────

/**
 * v2's two failure branches, kept apart — see header note 6.
 *
 *   `ok`       — replace everything, advance the stamp.
 *   `rejected` — the body said `ok: false`. CLEAR the points, keep the expiry
 *                list and the resolved expiry at their previous values, and
 *                STILL advance the stamp: a failing feed goes on ticking the
 *                "updated" time, which is worth knowing before trusting it.
 *   `failed`   — the request threw. KEEP the last good series under the error
 *                scrim, and do NOT advance the stamp.
 */
export type VolFlowLoad =
  | {
      status: 'ok'
      points: NonNullable<VolFlowResponse['points']>
      expiries: NonNullable<VolFlowResponse['expiries']>
      resolvedExpiry: string | null
      updatedAt: number
    }
  | { status: 'rejected'; error: string; updatedAt: number }
  | { status: 'failed'; error: string }

/**
 * B281 — the two-branch reason ladder. `no-db` gets its own sentence; EVERY
 * other reason, including a missing one, collapses to "Feed unavailable".
 * Both strings live in `VOL_FLOW_COPY` in gexLevels.ts.
 */
function volFlowReasonText(reason: string | undefined, copy: { noDb: string; feed: string }): string {
  return reason === 'no-db' ? copy.noDb : copy.feed
}

/**
 * B275, B279 — card 12's only request. Polled at 15s (`VOL_FLOW_POLL_MS`), half
 * the bucket width, so a newly written bucket is on screen within one poll
 * rather than up to a full bucket late.
 *
 * v2 NEVER CHECKS `res.ok` on this one — it goes straight to `r.json()`, which
 * is safe in practice because the route answers `ok:false` with a 200
 * (`server-with-proxy.js:1184`, the `no-db` branch) and reserves non-2xx for
 * its outer 500 (`{error, detail}`, no `ok` field). `query()` throws on the
 * non-2xx, so that 500 now lands in `failed` with a status message instead of
 * in `rejected` with "Feed unavailable" — strictly more informative, and the
 * only path where the two versions differ.
 *
 * `copy` is passed in rather than imported so this file carries no user-visible
 * string of its own; the caller hands it `VOL_FLOW_COPY.errNoDb` /
 * `.errFeed` from gexLevels.ts.
 */
export async function loadVolGexFlow(
  pick: string,
  session: VolFlowSession,
  copy: { noDb: string; feed: string },
): Promise<VolFlowLoad> {
  try {
    const j = await query<VolFlowResponse | null>(volGexFlowUrl(pick, session), {
      staleMs: NO_STORE_STALE_MS,
    })
    if (j?.ok === false) {
      return { status: 'rejected', error: volFlowReasonText(j.reason, copy), updatedAt: Date.now() }
    }
    return {
      status: 'ok',
      points: Array.isArray(j?.points) ? j.points : [],
      expiries: Array.isArray(j?.expiries) ? j.expiries : [],
      resolvedExpiry: j?.expiry ?? null,
      updatedAt: Date.now(),
    }
  } catch (e) {
    return { status: 'failed', error: errText(e) }
  }
}

/**
 * ── WHAT DRIVES THE URL: CARD 12'S THREE CONTROLS ────────────────────────────
 *
 * `VolGexFlowPanel` takes NO PROPS. It owns its own picker, its own session
 * switch, its own view switch, its own fetch and its own poll, and it is SHARED
 * with `app/home/HomeClient.tsx`'s "Vol GEX Flow" tab — nothing about it is
 * scanner-specific, which is why a change here lands on /home too (spec open
 * question 12).
 *
 * Two of the three controls change the URL and one does not. All three are
 * already transcribed in gexLevels.ts; they are named here because this is the
 * file that turns them into a request, and a reader tracing "why did the chart
 * refetch" should not have to guess which control did it.
 *
 *   • THE EXPIRY PICKER → the scope clause. `volFlowExpiryOptions(expiries,
 *     resolvedExpiry)` builds ALWAYS EXACTLY TWO SENTINELS THEN ONE ROW PER
 *     REPORTED EXPIRY, in the SERVER's array order — not sorted client-side:
 *       (1) `__front__`, labelled `Front · Jul 31` (or bare `Front` before the
 *           first response resolves one),
 *       (2) `__all__`, labelled `All expiries`,
 *       (3…n) the ISO expiry, labelled `Jul 31 · 1,204 rows`.
 *     The list is whatever the endpoint reports as ACTUALLY HAVING ROWS TODAY,
 *     so a pick can never produce an empty chart — and before the first
 *     response only the two sentinels exist. Default is `VOL_FLOW_DEFAULT_PICK`
 *     = `__front__`. CHANGES THE URL.
 *   • THE SESSION SWITCH → `&session=`. Two buttons, `RTH` then `ETH`, default
 *     `VOL_FLOW_DEFAULT_SESSION` = `'rth'` — because the overnight stretch has
 *     no new prints, so values persist until the chain resets and draw a long
 *     flat line with a phantom step that reads as signal and is not. CHANGES
 *     THE URL, and v2 sets `loading` true on the change so the scrim returns.
 *   • THE VIEW SWITCH (`$ GEX` / `+GEX %`) → NOTHING. It is pure client-side
 *     presentation over the SAME response: `pctPointsOf` filters the points
 *     that carry a `posPct` and the chart swaps which series and which price
 *     scale is visible. Default is `$ GEX` (`readPctView()` false), remembered
 *     per BROWSER TAB in `sessionStorage` under
 *     `PCT_VIEW_STORAGE_KEY` = `"cbedge.volGexFlow.pctView"` — the only
 *     sessionStorage key in Part B, where the card layout and the OI cache both
 *     use localStorage, with no stated reason for the split (spec "Do not port"
 *     26). It must NOT reach `volGexFlowUrl`, or a toggle becomes a request.
 *
 * Spec B277–B278, B288–B291, B294, B297.
 */

// ─────────────────────────────────────────────────────────────────────────────
// § 12 — CARD 12 IS THE TAB'S ONLY CANVAS. FOR STEP 3.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything the eleven other cards draw is hand-rolled inline SVG. Card 12 is
 * a `lightweight-charts` `createChart` mounted imperatively into a bare
 * `<div style={{position:"absolute", inset:0}}>` (VolGexFlowPanel.tsx:290, 579)
 * — the ONLY `<canvas>` in Part B — and it arrives with three things v3
 * forbids outright:
 *
 *   1. NO `data-cb-layer`, and no data attribute of any kind, on the chart
 *      container (B302, "Do not port" 23). v3 non-negotiable 6.
 *   2. NO VISIBILITY GUARD ANYWHERE (B303, B274). The `ResizeObserver` and the
 *      rAF size pump run whenever mounted, and the chart re-lays-out on every
 *      resize whether or not the card is on screen. The tab's ONE
 *      `document.visibilityState` reference (:211) is the wake-on-visible tick
 *      on the POLL — it makes a request MORE eager and pauses nothing. That
 *      tick is now `query()`'s (see the THIRD departure); the PAINTING guard
 *      still has to be written in step 3.
 *   3. `handleScale: false` / `handleScroll: false` — no pan, no zoom — while
 *      the four strike charts in the same column implement bespoke wheel-zoom
 *      and drag-pan (B304, "Do not port" 29). Two opposite interaction models,
 *      side by side.
 *
 * In v3 it must mount through `ChartFrame` (non-negotiable 4) rather than
 * `createChart` into a bare div, and take its visibility from the handle. The
 * chart's OPTIONS, series shapes, scales and autoscale ladder are already
 * transcribed in gexLevels.ts (`volFlowChartOptions`, `VOL_FLOW_SERIES_SHAPE`,
 * `VOL_FLOW_SCALES`, `pctAutoscaleRange`, `VOL_FLOW_SIZE_PUMP_FRAMES`); this
 * note exists so the three violations are not rediscovered at render time.
 */
export const CARD_12_IS_THE_ONLY_CANVAS = true

// ─────────────────────────────────────────────────────────────────────────────
// § 13 — ROUTE ENTRY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `CardEndpoint` → the URL path this file owns.
 *
 * WHICH card reads WHICH endpoint is NOT declared here: `GEX_LEVELS_CARDS` in
 * gexLevels.ts already carries an `endpoints` list per card, and it is the
 * richer answer — `oiDate` and `history` list `proxy/gex-levels-history` AND
 * `proxy/gex`, because prior sessions come from the log while TODAY's row is
 * built from the live derivation. A second, flatter copy of that table here
 * would be wrong the first time a card gained a source.
 *
 * This map is the missing half: it turns those endpoint NAMES into the paths
 * the loaders actually address, so a route can walk the card registry and
 * `preload()` exactly what the visible cards need.
 */
export const EP_FOR: Readonly<Record<CardEndpoint, string>> = {
  'proxy/gex': EP_GEX,
  'proxy/gex-by-strike-multi': EP_GEX_BY_STRIKE_MULTI,
  'proxy/gex-levels-history': EP_GEX_LEVELS_HISTORY,
  'proxy/gex-vol-flow': EP_GEX_VOL_FLOW,
  'api/eod-gex': EP_EOD_GEX,
  'api/chains': EP_CHAINS,
}

/**
 * One settled result per independent source. `PromiseSettledResult` rather than
 * a merged object BECAUSE of the `d`-gate: a rejected /proxy/gex must not be
 * able to take the EOD boards or the history log down with it, and giving each
 * source its own settled slot is what makes that structurally impossible rather
 * than merely intended.
 *
 * /api/chains is NOT here — it is the second hop (§ 4). Call
 * `loadOiByExpiration(snap.symbol ?? DEFAULT_SYMBOL, snap.expirations ?? [])`
 * when the snapshot lands; until then the OI card shows "no data yet", which is
 * what v2 shows too.
 */
export interface GexLevelsEntry {
  snapshot: PromiseSettledResult<GexLevelsSnapshot>
  multi: PromiseSettledResult<GexMultiPayload>
  eod: PromiseSettledResult<EodGexRow[]>
  /** Never rejects — `loadGexLevelsHistory` swallows everything (B141). */
  history: PromiseSettledResult<{ local: HistoryEntry[]; server: HistoryEntry[]; merged: HistoryEntry[] }>
  /** Never rejects — `loadVolGexFlow` returns its failures as a variant. */
  volFlow: PromiseSettledResult<VolFlowLoad>
}

/**
 * Everything the route can fire at entry, together. Five sources, five
 * requests, one round trip — against v2's mount, which fired /proxy/gex,
 * /proxy/gex-by-strike-multi, /proxy/gex-levels-history, /proxy/gex-vol-flow
 * and /api/eod-gex TWICE, then waited on /proxy/gex to start twelve more.
 *
 * `volFlowCopy` is threaded through for the same reason `loadVolGexFlow` takes
 * it: no user-visible string is declared in this file.
 */
export async function loadGexLevelsEntry(opts: {
  volFlowCopy: { noDb: string; feed: string }
  multiSymbol?: string
  volFlowPick?: string
  volFlowSession?: VolFlowSession
}): Promise<GexLevelsEntry> {
  const [snapshot, multi, eod, history, volFlow] = await Promise.allSettled([
    loadGexSnapshot(),
    loadGexByStrikeMulti(opts.multiSymbol ?? EOD_GEX_SYMBOL),
    loadEodGex(),
    loadHistoryWithCache(),
    loadVolGexFlow(
      opts.volFlowPick ?? VOL_FLOW_FRONT,
      opts.volFlowSession ?? 'rth',
      opts.volFlowCopy,
    ),
  ])
  return { snapshot, multi, eod, history, volFlow }
}

/**
 * The ET calendar day the OI cache is stamped with, re-exported so a route can
 * decide whether it needs the second hop at all before the snapshot lands. Same
 * function gexLevels.ts uses for the history log's `date` — one definition of
 * "today" on this tab, deliberately.
 */
export { todayEtDate } from '@/pages/scanner/gexLevels'
