// ─────────────────────────────────────────────────────────────────────────────
// GEX CHANGE TOP — THE DATA LAYER.
//
// Transcribed 1:1 from v2's `components/scanner/GexChangeTop.tsx` (the three
// `fetch` call sites at lines 484, 506 and 612, plus their state transitions)
// against the checklist in docs/parity/scanner.md Part C, rows C6–C15.
//
// Five things here are NOT obvious from the screen:
//
//   1. TWO DISTINCT FAILURE MODES PER ENDPOINT, with DIFFERENT side effects. A
//      body that says `ok: false` CLEARS the rows; a thrown request keeps the
//      last-good rows on screen. v2 wrote those two branches deliberately and
//      the difference is visible — a proxy blip leaves the board up, a server
//      that says "no" empties it. Both are modelled below as separate variants
//      rather than one `error` field, so step 3 cannot merge them by accident.
//   2. THE `date` PARAM IS OMITTED ENTIRELY when it is falsy, and the SERVER
//      then picks today. It is never sent as an empty string, and the client
//      never computes "today" itself — which is what keeps a viewer in London
//      from asking for tomorrow's slots.
//   3. THE HISTORY FEED IS FILTERED CLIENT-SIDE by `isRth` before anything sees
//      it. Snapshots accrue around the clock; the card charts the cash session
//      only. That filter is why "now" on a card back means "the last RTH
//      snapshot", not wall-clock now.
//   4. HISTORY IS KEYED BY `watch_id`, NOT BY CARD. The same contract appearing
//      in several slots shares one request and one cache entry — which is the
//      whole reason "Flip all" over ~65 tiles is not 65 requests.
//   5. THE `/results` FEED CARRIES `frozen`, AND A FAILED LOAD DOES NOT RESET
//      IT. `frozen` defaults to false, so a scorecard that has never loaded
//      reads "live · peak so far" rather than admitting it has nothing.
//
// ── THE ONE DELIBERATE DEPARTURE FROM v2 ─────────────────────────────────────
// C12'S WATERFALL IS STRAIGHTENED. v2 ran `loadResults(date || undefined)` in an
// effect keyed on `date`, so it fired ONCE on mount with `date === ""` (no
// param) and then AGAIN the moment `/proxy/gex-change-top` echoed a date back —
// two `/results` requests on every entry to the tab, the second one waiting on
// the first feed's response for a value it did not actually need. Neither feed
// needs anything from the other: both take the SAME `date` argument, and both
// default to today on the server when it is omitted. `loadGexChangeTopEntry()`
// below fires them together. Same requests, same results, one round trip and one
// wasted request less. Recorded in docs/parity/scanner.md Part C, row C12 and
// the "Do not port" list, item 3.
//
// SECOND DEPARTURE, and it is a real behaviour change worth naming: v2 read all
// three endpoints with `{ cache: "no-store" }` and its own `setInterval` pair.
// Here they go through `query()` with `staleMs: 0` — no cached value is ever
// served, so "no-store" holds — but `query()` ALSO dedupes by URL, which v2 did
// not. v2 had NO `AbortController` (C6), so two overlapping loads could resolve
// out of order and the later-resolving one won; two loads of the SAME url now
// share one promise and cannot race each other. A load of a DIFFERENT date
// still can, exactly as before.
//
// THIRD, and it is a LOSS, not a win: v2 called `r.json()` unconditionally and
// read `j.error` off the body whatever the status. `query()` throws on a non-2xx
// before the body is parsed, and this proxy pairs `ok: false` with 503 (404 for
// history) — so where v2 showed the server's own sentence ("recorder not
// running"), v3 shows "503 Service Unavailable — /proxy/gex-change-top". The
// `rejected` variant below is kept and is still correct for a 200-with-ok:false;
// it is simply not the path today's server takes. Restoring parity needs a
// `query()` that surfaces the JSON body on a non-2xx, which is a change to
// src/data/api.ts and therefore not this file's to make. FLAGGED FOR STEP 3.
//
// ── REMOVED IN v2, DO NOT RE-ADD ─────────────────────────────────────────────
// • THE DIRECT `fetch()` CALLS (v2 lines 484, 506, 612). v3 pages go through
//   `query` / `useQuery` / `preload`, which dedupe, cache and pause polling on a
//   hidden tab. None of that existed here.
// • THE 60s `setInterval` PAIR (C13) and the open-card `setInterval` (C14).
//   Replaced by `pollMs` on the hook in step 3, with `POLL_MS` and
//   `OPEN_CARD_POLL_MAX` carried over unchanged. NOTE THE BEHAVIOUR CHANGE: v2's
//   intervals kept firing while the tab was hidden — there was no visibility
//   guard anywhere on this tab — and `query()`'s polling stops when the tab is
//   hidden. That is the right default here: a missed poll is repaired by the
//   next one, so nothing in the session's record is lost, which is the only
//   condition that would justify `background: true`.
// • THE `flipAll` WAVE SCHEDULER (C15) — six-at-a-time `Promise.all` recursion
//   over `need = [...new Set(ids)].filter(id => !hist[id])`. Both halves of that
//   are `query()`'s job now: the `Set` is dedupe and the `!hist[id]` filter is
//   the cache. `FLIP_ALL_WAVE_SIZE` survives in gexChangeTop.ts as the rate
//   ceiling, for step 3 to stagger with if it wants to.
// • THE `hist` / `histLoading` STATE MAPS. Per-`watch_id` caching and per-id
//   loading flags are what `useQuery` gives back per URL.
//
// Spec: docs/parity/scanner.md Part C, rows C6–C15.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '@/data/api'
import { LOAD_FAILED, NO_HISTORY, POLL_MS, isRth } from '@/pages/scanner/gexChangeTop'
import type { PickContract, PickHist, PickPoint, ResultRow, SlotBucket } from '@/pages/scanner/gexChangeTop'

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

/** C6 — the slot feed. Every ★ Very strong capture for one ET session. */
export const EP_TOP = '/proxy/gex-change-top'
/** C10 — one auto-probed contract's option price / net GEX for one ET session. */
export const EP_HISTORY = '/proxy/gex-change-top-history'
/** C8 — the EOD scorecard. Frozen after the close; computed live before it. */
export const EP_RESULTS = '/proxy/gex-change-top-results'
/**
 * The graded-pick study. THIS TAB NEVER CALLS IT — it is the feedback loop Pick
 * Study (Part D) reads this tab's grade ladder back through, and Part D owns its
 * response shape and its query defaults (`days=60`, `by="score"`,
 * `cohort="selected"` in v2's `PickStudyTab.tsx:350–352`). It is here because
 * the grade ladder in gexChangeTop.ts is the thing on the other end of it, and
 * because docs/parity/scanner.md's endpoint table lists it against Parts C and D
 * both. See `loadPickStudy` below.
 */
export const EP_STUDY = '/proxy/gex-change-top-study'
/**
 * The probe pipeline. THIS TAB NEVER CALLS IT EITHER — the recorder does,
 * server-side, at capture time (`POST /api/watch` → `watch_options` + a 60s
 * snapshot loop), and the resulting id rides along on the row as `watch_id`.
 * See `probeWatchAdd` below.
 */
export const EP_WATCH = '/api/watch'

/**
 * v2 read all three feeds with `{ cache: "no-store" }`. `staleMs: 0` is the
 * `query()` equivalent: no cached value is old enough to serve, so every call
 * goes to the network — while still collapsing two simultaneous calls for the
 * same URL into one request.
 */
const NO_STORE_STALE_MS = 0

/**
 * A pick's history is a growing series, appended once a minute. One minute of
 * cache is therefore exactly right — it makes a second "Flip all" free, which is
 * what v2's `need.filter(id => !hist[id])` was hand-rolling, and it matches the
 * cadence the open-card refresh polls at.
 */
const HISTORY_STALE_MS = POLL_MS

/** The `date` param is OMITTED, never blanked, when falsy. See note 2 in the header. */
function withDate(path: string, date?: string): string {
  return date ? `${path}?date=${encodeURIComponent(date)}` : path
}

/** The URLs a route can hand to `preload()` at entry. Same strings the loaders use. */
export function gexChangeTopUrls(date?: string): { top: string; results: string } {
  return { top: withDate(EP_TOP, date), results: withDate(EP_RESULTS, date) }
}

// ─────────────────────────────────────────────────────────────────────────────
// WIRE ENVELOPES
// ─────────────────────────────────────────────────────────────────────────────

interface TopResponse {
  ok?: boolean
  error?: string
  slots?: SlotBucket[]
  date?: string
}

interface ResultsResponse {
  ok?: boolean
  error?: string
  rows?: ResultRow[]
  frozen?: boolean
}

interface HistoryResponse {
  ok?: boolean
  error?: string
  points?: PickPoint[]
  contract?: PickContract | null
}

/**
 * v2's two failure branches, kept apart.
 *
 *   `ok`       — the body said `ok: true`. Replace everything.
 *   `rejected` — the body said `ok: false`. CLEAR the rows, keep everything else
 *                (the slot feed keeps its `date`; the scorecard keeps `frozen`).
 *   `failed`   — the request threw. Keep the LAST-GOOD rows on screen and show
 *                the error line above them.
 */
export type Load<T> =
  | ({ status: 'ok' } & T)
  | { status: 'rejected'; error: string }
  | { status: 'failed'; error: string }

/** v2's `catch` text: `String(e?.message || e)`. */
function errText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message
  return String(e)
}

// ─────────────────────────────────────────────────────────────────────────────
// LOADERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * C6 — the slot feed.
 *
 * `slots` are returned in the SERVER'S ARRAY ORDER and nothing here reorders
 * them. v2's file header says "most recent first" and no client code enforces
 * that; there is no comparator on this tab. Do not add one.
 *
 * On `ok: false` v2 set `err` and cleared `slots` but LEFT `date` at its previous
 * value — hence `rejected` carrying no date.
 */
export async function loadGexChangeTop(
  date?: string,
): Promise<Load<{ slots: SlotBucket[]; date: string }>> {
  try {
    const j = await query<TopResponse>(withDate(EP_TOP, date), { staleMs: NO_STORE_STALE_MS })
    if (!j?.ok) return { status: 'rejected', error: j?.error || LOAD_FAILED }
    return { status: 'ok', slots: j.slots || [], date: j.date || '' }
  } catch (e) {
    return { status: 'failed', error: errText(e) }
  }
}

/**
 * C8 — the EOD scorecard.
 *
 * There is NO loading flag on this feed in v2 — the scorecard has no loading
 * state at all, which is why it renders its "no scored picks" empty copy during
 * the first round trip rather than a spinner.
 *
 * `rows` are returned in the SERVER'S ARRAY ORDER. The table renders them in
 * that order; there is no client sort. See gexChangeTop.ts, header point 7.
 */
export async function loadGexChangeTopResults(
  date?: string,
): Promise<Load<{ rows: ResultRow[]; frozen: boolean }>> {
  try {
    const j = await query<ResultsResponse>(withDate(EP_RESULTS, date), {
      staleMs: NO_STORE_STALE_MS,
    })
    // `Array.isArray` rather than `|| []`: v2 guarded this one and not the slot
    // feed, and a non-array `rows` would otherwise reach `.filter`.
    if (!j?.ok) return { status: 'rejected', error: j?.error || LOAD_FAILED }
    return { status: 'ok', rows: Array.isArray(j.rows) ? j.rows : [], frozen: !!j.frozen }
  } catch (e) {
    return { status: 'failed', error: errText(e) }
  }
}

/**
 * C11, C12 — everything the route needs at entry, fired TOGETHER.
 *
 * This is the straightened waterfall; see THE ONE DELIBERATE DEPARTURE at the
 * top. `date` is whatever the route resolved (a `?date=` param, the date picker's
 * value, or `undefined` for "let the server pick today") and BOTH feeds get the
 * same one. The `date` the slot feed echoes back is for DISPLAY — the date
 * picker's value and the cards' capture stamps — and is not used to build a
 * second request.
 */
export async function loadGexChangeTopEntry(date?: string): Promise<{
  top: Load<{ slots: SlotBucket[]; date: string }>
  results: Load<{ rows: ResultRow[]; frozen: boolean }>
}> {
  const [top, results] = await Promise.all([
    loadGexChangeTop(date),
    loadGexChangeTopResults(date),
  ])
  return { top, results }
}

/**
 * C10 — one pick's recorded option price / net GEX for one ET session.
 *
 * `id` is ALWAYS sent; `date` is omitted when falsy. Points are filtered to RTH
 * here, before anything sees them — see note 3 in the header.
 *
 * BOTH failure paths collapse to the same shape in v2 (`points: []`,
 * `contract: null`, `error` set), which is why this returns a `PickHist` rather
 * than a `Load<…>`: the card's back face has exactly one error state and it does
 * not care which way the request failed.
 */
export async function loadPickHistory(watchId: number, date?: string): Promise<PickHist> {
  const base = `${EP_HISTORY}?id=${encodeURIComponent(String(watchId))}`
  const url = date ? `${base}&date=${encodeURIComponent(date)}` : base
  try {
    const j = await query<HistoryResponse>(url, { staleMs: HISTORY_STALE_MS })
    if (!j?.ok) return { points: [], contract: null, error: j?.error || NO_HISTORY }
    return {
      points: (j.points || []).filter((p) => isRth(Number(p.ts))),
      contract: j.contract ?? null,
    }
  } catch (e) {
    return { points: [], contract: null, error: errText(e) }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINTS THIS TAB DOES NOT CALL
//
// Both are listed against Part C in docs/parity/scanner.md's endpoint table and
// neither is reachable from `GexChangeTop.tsx`. They are transcribed here — with
// the exact path, params and request body, and with NO invented response shape —
// because leaving them out of the port is how a route quietly stops existing.
// ─────────────────────────────────────────────────────────────────────────────

/** `/proxy/gex-change-top-study` query params, as the route reads them. */
export interface PickStudyParams {
  /** Lookback window in days. Omitted → the server's own default. */
  days?: number
  /** The feature to bucket by. Omitted → the server's own default. */
  by?: string
  /** `selected` | `shadow` | `all`. `shadow` reads the picks the board did NOT take. */
  cohort?: string
}

/**
 * The study route's envelope, as `server-v2/server-with-proxy.js:3417–3439`
 * documents it: `{ ok, by, label, note, overall, cohorts, buckets:[…], features:[…] }`.
 * The payload fields are `unknown` ON PURPOSE: PART D OWNS THEIR SHAPE, and
 * guessing at them here would create a second, wrong copy of Part D's types.
 */
export interface PickStudyEnvelope {
  ok?: boolean
  error?: string
  by?: string
  label?: string
  note?: string
  overall?: unknown
  cohorts?: unknown
  buckets?: unknown[]
  features?: unknown[]
}

/**
 * @notWiredInV2 — `GexChangeTop.tsx` never calls this. Pick Study (Part D)
 * does, and this tab's grade ladder is what it is studying: `/study` reads
 * `gex_change_top_results` joined back to each pick's FIRST `gex_change_top`
 * row (the only capture-time feature source that cannot leak the outcome),
 * buckets one feature at a time and reports the hit rate per bucket.
 *
 * It is transcribed here so the PATH and the PARAM NAMES have exactly one home
 * in v3 — the grade ladder and the endpoint that reads it back should not drift
 * apart across two files in two parts. Step 3 decides whether Part D imports
 * this loader or keeps its own; what it must NOT do is write a third spelling of
 * the URL.
 *
 * Params are only appended when provided. The ROUTE reads each with
 * `searchParams.get(x) || undefined` (server-with-proxy.js:3431–3434), so an
 * absent param takes the server's own default — while v2's Pick Study CLIENT
 * always sent all three, from its own state. Those client defaults are
 * `days=60`, `by="score"`, `cohort="selected"` (PickStudyTab.tsx:350–352) and
 * they belong to Part D, not here; this loader deliberately has none of its own.
 */
export async function loadPickStudy(params: PickStudyParams = {}): Promise<PickStudyEnvelope> {
  const q: string[] = []
  if (params.days != null) q.push(`days=${encodeURIComponent(String(params.days))}`)
  if (params.by) q.push(`by=${encodeURIComponent(params.by)}`)
  if (params.cohort) q.push(`cohort=${encodeURIComponent(params.cohort)}`)
  const url = q.length ? `${EP_STUDY}?${q.join('&')}` : EP_STUDY
  return query<PickStudyEnvelope>(url, { staleMs: NO_STORE_STALE_MS })
}

/** The `POST /api/watch` "add" body, exactly as v2's one client caller sends it. */
export interface WatchAddRequest {
  action: 'add'
  ticker: string
  expiry: string
  strike: number
  side: 'C' | 'P'
  note?: string
  /** Omitted on purpose by v2's caller — see the note on `probeWatchAdd`. */
  addedPrice?: number
}

/** The route's 200 body. `created` is the inserted `watch_options` row. */
export interface WatchAddResponse {
  ok?: boolean
  error?: string
  created?: { id: number; added_price?: number | null } | null
}

/**
 * @notWiredInV2 — `GexChangeTop.tsx` never calls this. The RECORDER does, at
 * capture time, server-side: `POST /api/watch` upserts on
 * ticker+expiry+strike+side into `watch_options`, starts a 60s snapshot loop,
 * and the row's id rides back to the client as `Row.watch_id` — which is the
 * only reason a card can flip at all. Footer legend C156 is describing exactly
 * this.
 *
 * The one CLIENT caller anywhere in v2 is `components/scanner/ProbeButton.tsx`
 * (the owner-only "+ Probe" action on a scanner card), and the body below is
 * that call transcribed, not invented. Two things about it are load-bearing:
 *
 *   1. `addedPrice` IS DELIBERATELY NOT SENT. With no entry price the route
 *      captures the live mark from its own immediate probe as the permanent
 *      entry basis, and echoes it back as `created.added_price`. Sending one
 *      would freeze a basis nobody measured.
 *   2. `added_price` IS WRITE-ONCE. The upsert only writes the mark when the row
 *      is NEW, so a strike already in the pipeline from an earlier day keeps
 *      that day's mark forever. That is the whole reason the cards read their
 *      entry off the scorecard instead — see `derivePickCard` in
 *      gexChangeTop.ts.
 *
 * NOT ON `query()`, and it must not be: `query()` is a GET with a dedupe cache,
 * and a mutation that is deduped or served from cache is a mutation that
 * silently does not happen. It is also OWNER-GATED SERVER-SIDE
 * (`api-router.js:8457`, `auth: 'owner'`) — the client gate on ProbeButton is
 * cosmetic.
 *
 * ONE ADDITION TO v2's REQUEST, and it is the only one: `credentials:
 * 'same-origin'`. v2's ProbeButton omitted it and relied on the browser default,
 * which sends cookies same-origin anyway; `query()` in src/data/api.ts sets it
 * explicitly on every read, and an owner-gated mutation must not be the one call
 * in v3 that leaves its auth to a default. Nothing else about the body or the
 * error handling is changed.
 *
 * Step 3 decides whether v3's scanner surfaces a probe action at all.
 */
export async function probeWatchAdd(body: WatchAddRequest): Promise<WatchAddResponse> {
  const res = await fetch(EP_WATCH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  })
  const j = (await res.json().catch(() => ({}))) as WatchAddResponse
  if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`)
  return j
}
