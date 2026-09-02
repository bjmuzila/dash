// ─────────────────────────────────────────────────────────────────────────────
// PICK STUDY — THE DATA LAYER. Five routes, three reads and two writes.
//
// Transcribed 1:1 from v2's `components/scanner/PickStudyTab.tsx` lines 369–445
// against the checklist in docs/parity/scanner.md Part D, rows D121–D127.
// Every path, every query param, every param ORDER and every default is v2's.
//
// THE SHAPE OF THIS TAB'S TRAFFIC:
//
//   GET  /proxy/gex-change-top-study        days, by, cohort   → the buckets
//   GET  /proxy/gex-change-top-calibration  days, cohort       → the grader's grades
//   GET  /proxy/gex-change-top-rule         (no params)        → the rule in force
//   POST /proxy/gex-change-top-rule-fit     days, cohort, apply
//   POST /proxy/gex-change-top-rule         {"clear":true}     → disarm
//
// FOUR THINGS THAT ARE NOT OBVIOUS FROM THE ROUTE LIST:
//
//   1. THE THREE GETS ARE ALREADY PARALLEL. v2 fires them from three independent
//      mount effects in the same commit, so there is no waterfall here to
//      straighten — v3 non-negotiable #3 is satisfied by the v2 code as written.
//      Every loader below still takes everything it needs as arguments, so a
//      route can fire all three at entry. The ONLY chaining anywhere is
//      post-mutation (rule → calibration after a fit or a disarm), which is
//      correct sequencing, not a waterfall.
//   2. THE CALIBRATION TAKES NO `by`. It is not per-feature, so changing the
//      feature refetches the study and NOT the calibration. The rule takes no
//      params at all and in v2 fires exactly once, on mount.
//   3. THE FIT FLOORS ITS WINDOW AT 90 DAYS. See `fitDays`.
//   4. NO POLLING ANYWHERE. Not one of the five has an interval, so there is no
//      visibility gating to add and an off-screen tab costs nothing. If step 3
//      ever adds a poll, it adds `pollMs` on `useQuery`, which already suspends
//      while the tab is hidden.
//
// ── THE ONE DELIBERATE DEPARTURE FROM v2 ─────────────────────────────────────
// None in the requests. The transport changes and the semantics do not:
//
//   • v2's `fetch(url, { cache: 'no-store' })` becomes `query(url, { staleMs: 0 })`.
//     Same effect — always go and ask — plus v3's in-flight dedupe, so the ↻
//     button's double-click (v2 leaves it enabled and un-debounced, D28) makes
//     one request instead of two, and `preload()` becomes available to the nav.
//   • v2 hand-rolls five `fetch` chains with NO AbortController on any of them
//     (D126): toggling `days` twice quickly issues two study requests and
//     whichever resolves LAST wins, which may be the older window. Every read
//     below accepts a `signal` and hands it to `query()`, so step 3 can cancel.
//     That removes a race; it does not change a single response.
//   • The three reads THROW instead of returning null. v2 swallows two of them
//     entirely (`setCal(null)` / `setRule(null)` on both a throw and an
//     `ok:false` body), which is what makes a 500 on the calibration route
//     render as the words "nothing is being predicted yet". v3's error channel
//     exists; these loaders feed it. The four-state collapse this repairs is
//     documented on `isNotArmed` in pickStudy.ts — step 3 decides how many of
//     the four states get their own screen.
//
// ── REMOVED IN v2, DO NOT RE-ADD ─────────────────────────────────────────────
// • `new URL(path, window.location.origin)`. Same-origin absolute URLs built off
//   `window` do not exist during SSR or in a test renderer, and `query()` wants a
//   path. Params are built with URLSearchParams in v2's exact `set()` order.
// • The `.finally(() => setLoading(false))` / `setFitting('')` bookkeeping and
//   the `setErr` / `setFitErr` state writes. Those are step 3's; a loader
//   returns or throws.
// • The un-cleaned 1600 ms `setTimeout` behind "✓ copied" (v2 :455). It is a
//   render concern and it must not survive as written — no clearTimeout on
//   unmount means a setState after unmount. The duration is COPIED_RESET_MS.
//
// ── THE OWNER GATE, AS SEEN FROM HERE ────────────────────────────────────────
// The two POSTs branch on 401/403 and throw OWNER_ONLY_ERROR. That branch is the
// ONLY evidence anywhere in the v2 client that a server-side gate exists on any
// of these five routes. The three GETs have no such branch — which does not mean
// they are ungated, it means the client cannot tell. The tab's own owner check
// is chrome (see pickStudy.ts's header). Whether …-study, …-calibration and the
// …-rule GET are gated server-side is Part D open question 3, still open.
//
// Spec: docs/parity/scanner.md Part D, rows D121–D127.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '@/data/api'
import {
  FIT_MIN_DAYS,
  OWNER_ONLY_ERROR,
  STUDY_LOAD_FAILED,
} from '@/pages/scanner/pickStudy'
import type { CalResp, FitResp, RuleState, StudyResp } from '@/pages/scanner/pickStudy'

/** v2's `cache: 'no-store'` on all five calls. Nothing here is ever served stale. */
const NO_STORE = { staleMs: 0 } as const

const STUDY_PATH = '/proxy/gex-change-top-study'
const CALIBRATION_PATH = '/proxy/gex-change-top-calibration'
/** The GET and the disarm POST share this path; only the method distinguishes them. */
const RULE_PATH = '/proxy/gex-change-top-rule'
const RULE_FIT_PATH = '/proxy/gex-change-top-rule-fit'

/** Params in v2's `set()` order, so the cache key matches call for call. */
function withParams(path: string, params: readonly (readonly [string, string])[]): string {
  const q = new URLSearchParams()
  for (const [k, v] of params) q.set(k, v)
  const s = q.toString()
  return s ? `${path}?${s}` : path
}

/** URLs, exported so a route can `preload()` them before the tab mounts. */
export function studyUrl(days: number, by: string, cohort: string): string {
  return withParams(STUDY_PATH, [
    ['days', String(days)],
    ['by', by],
    ['cohort', cohort],
  ])
}

/** No `by` — the calibration is not per-feature. Changing the feature does not move it. */
export function calibrationUrl(days: number, cohort: string): string {
  return withParams(CALIBRATION_PATH, [
    ['days', String(days)],
    ['cohort', cohort],
  ])
}

/** No params at all. */
export function ruleUrl(): string {
  return RULE_PATH
}

/**
 * BUG (v2): THE FIT SILENTLY WIDENS THE WINDOW.
 *
 * `Math.max(days, 90)` — the fit floors its window at 90 days regardless of the
 * day toggle, so a user looking at the 14d view clicks "Fit now" and gets a 90d
 * fit with NOTHING on screen saying the window changed. The bucket table above
 * still shows 14 days; the terms below it were fitted on 90.
 *
 * Ported exactly as written. Part D open question 6 asks whether the floor is
 * intended or whether the fit should refuse rather than silently widen — step 3
 * decides, and either answer needs a line of copy this tab does not have.
 */
export function fitDays(days: number): number {
  return Math.max(days, FIT_MIN_DAYS)
}

export function ruleFitUrl(days: number, cohort: string, apply: boolean): string {
  const params: [string, string][] = [
    ['days', String(fitDays(days))],
    ['cohort', cohort],
  ]
  // v2 sets `apply` only when applying — a dry run's URL has no such param at
  // all, rather than `apply=0`. The server distinguishes presence, not value.
  if (apply) params.push(['apply', '1'])
  return withParams(RULE_FIT_PATH, params)
}

// ─────────────────────────────────────────────────────────────────────────────
// THE THREE READS.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The bucket study. Refetched by ANY of the three controls — feature, window or
 * cohort.
 *
 * Throws `j.error || 'load failed'` on an `ok:false` body, which is v2's string
 * exactly. In v2 that same path also calls `setData(null)`, which erases the
 * headline, the cohort hint, the verdict, both section labels, the bucket table
 * and its footnote — while the calibration block below survives, because it sits
 * outside that conditional and reads `cal`/`rule`, not `data`. That erasure is
 * step 3's to reproduce or not; this loader only reports the failure.
 *
 * NOTE what v2 does NOT do on a THROWN study fetch: it keeps the previous
 * `data`. Combined with the absence of any skeleton or dimming, the previous
 * window's numbers stay fully rendered and indistinguishable from live ones,
 * with only the subtitle's " · loading…" to say otherwise (D36).
 */
export class StudyBodyError extends Error {}

export async function loadStudy(
  days: number,
  by: string,
  cohort: string,
  signal?: AbortSignal,
): Promise<StudyResp> {
  const j = await query<StudyResp>(studyUrl(days, by, cohort), { ...NO_STORE, signal })
  // ADDED IN STEP 3 (see the report): the throw is typed so the two v2 error
  // paths stay distinguishable at the render layer. v2's `ok:false` branch calls
  // `setData(null)` and erases the whole upper half of the tab (D31, D32), while
  // a THROWN fetch keeps the previous window's numbers on screen (D33, D36).
  // With one untyped `Error` for both, a step-3 port has to pick one and lose
  // the other; with this class it can reproduce both, which is what it does.
  if (!j?.ok) throw new StudyBodyError(j?.error || STUDY_LOAD_FAILED)
  return j
}

/**
 * The calibration. v2 discards the body wholesale unless `ok` is truthy and
 * never reads `error`, so a 500 and a genuinely un-armed rule reach the screen
 * as the same paragraph. This throws instead — see the departure note.
 *
 * The `ok:false` case has no v2 error string to inherit, precisely because v2
 * never rendered one. The route's own `error` field is used when present.
 */
export async function loadCalibration(
  days: number,
  cohort: string,
  signal?: AbortSignal,
): Promise<CalResp> {
  const j = await query<CalResp>(calibrationUrl(days, cohort), { ...NO_STORE, signal })
  if (!j?.ok) throw new Error(j?.error || `${CALIBRATION_PATH} returned ok:false`)
  return j
}

/**
 * The rule in force. In v2 this fires exactly ONCE, on mount (its callback is
 * memoised on an empty dependency list), and is refetched only by an applied fit
 * or a disarm. The ↻ button deliberately does not touch it — see REFRESH_TARGETS
 * in pickStudy.ts, and the two-sources-of-truth note on `ruleBarArmed`.
 */
export async function loadRule(signal?: AbortSignal): Promise<RuleState> {
  const j = await query<RuleState>(ruleUrl(), { ...NO_STORE, signal })
  if (!j?.ok) throw new Error(`${RULE_PATH} returned ok:false`)
  return j
}

// ─────────────────────────────────────────────────────────────────────────────
// THE TWO WRITES.
//
// These do NOT go through `query()`: it is a GET-only helper with no method or
// body option, and a mutation must not be deduped, cached or served from a stale
// window in any case. They are plain `fetch` calls carrying v2's exact method,
// headers and body — and v2's 401/403 branch, which is the only place in the
// whole tab where the client acknowledges a server-side gate.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The disarm response. v2 declares no type for it because v2 never looks at it;
 * this is the minimum shape a caller that DID check would need.
 */
export interface DisarmResp {
  ok?: boolean
  error?: string
}

/** Both writes 401/403 the same way, with the same sentence. */
function assertOwner(status: number): void {
  if (status === 401 || status === 403) throw new Error(OWNER_ONLY_ERROR)
}

/**
 * Run the auto-fit.
 *
 * `apply: false` is a DRY RUN — it reports the terms it would arm and every
 * bucket it rejected, so the rule is never a black box you are asked to trust.
 * `apply: true` stores the result, and from the next capture on every pick is
 * stamped with a projected grade.
 *
 * v2 sends NO BODY and NO content-type on this POST; everything is in the query
 * string. Copied as written — adding a JSON body would be a new contract with a
 * route whose handler is not staged.
 *
 * The returned body is handed back even when `ok` is false: v2 renders the
 * preview AND an error line in that case (`setFit(j)` happens unconditionally,
 * `setFitErr` only on `!ok`), so the caller needs both. Read `j.ok` and use
 * `FIT_FAILED` as the fallback message.
 *
 * A non-2xx that is NOT 401/403 falls through to `res.json()` exactly as in v2,
 * where a non-JSON error page surfaces as a parse error rather than a status.
 *
 * CALLER CONTRACT after `apply: true` — v2 refreshes the rule and THEN the
 * calibration (`loadRule(); loadCal();`). Both are needed: the rule feeds the
 * bar, the calibration feeds the body, and refreshing only one is exactly how
 * the two "armed" flags drift apart.
 */
export async function postRuleFit(
  days: number,
  cohort: string,
  apply: boolean,
  signal?: AbortSignal,
): Promise<FitResp> {
  const res = await fetch(ruleFitUrl(days, cohort, apply), {
    method: 'POST',
    credentials: 'same-origin',
    signal,
  })
  assertOwner(res.status)
  return (await res.json()) as FitResp
}

/**
 * Clear the stored rule and go inert.
 *
 * Stamped projections are NOT touched — they are history, and rewriting them
 * would destroy the calibration, which is the whole point of a table that tests
 * predictions made before the picks did anything.
 *
 * v2 FETCHES THE RESPONSE BODY AND THROWS IT AWAY (`.then(() => …)`), so an
 * `{ok:false}` disarm reports success and the bar simply re-renders from the
 * refetched rule. This returns the parsed body so a caller CAN check `ok`;
 * whether it does is step 3's call, and checking it would be a behaviour change.
 *
 * Same caller contract as the fit: refresh the rule, then the calibration.
 */
export async function postDisarm(signal?: AbortSignal): Promise<DisarmResp> {
  const res = await fetch(RULE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clear: true }),
    credentials: 'same-origin',
    signal,
  })
  assertOwner(res.status)
  return (await res.json()) as DisarmResp
}
