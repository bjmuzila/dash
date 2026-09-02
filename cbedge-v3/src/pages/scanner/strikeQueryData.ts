// ─────────────────────────────────────────────────────────────────────────────
// THE STRIKE QUERY DATA LAYER — two endpoints, and nothing else.
//
// Transcribed 1:1 from v2's `components/pages/Scanner.tsx:640–681`
// (`refreshWatchlist`, `load`) against the checklist in docs/parity/scanner.md
// Part E, rows E14–E27. The paths, the response contracts, the per-symbol
// swallow, the merge order, the expiry derivation and the expiry reset are the
// v2 behaviour, copied.
//
// THE WHOLE FILE IS TWO REQUESTS. That is the point:
//
//   1. `/proxy/strike-growth/watchlist`  — once, at mount.
//   2. `/proxy/strike-growth/by-expiry?symbol=…` — one per TARGET TICKER,
//      fanned out in parallel, re-fired ONLY when the Ticker select changes or
//      the watchlist first arrives.
//
// Expiry, Limit, direction, min-OTM, card scope and the sort column touch NONE
// of this. They are pure client re-derivations over rows already in state, and
// they live in `strikeQuery.ts` as functions of `SqRow[]` — see
// `SQ_REFETCH_INPUTS` and `SQ_CLIENT_ONLY_INPUTS` there. A step-3 port that
// puts any of the six in a query key turns one fetch into six; that is the
// single most important thing this port must not do, and it is why this module
// exports no function that takes a filter, a limit or a sort.
//
// Three pieces of behaviour that are not obvious from the screen:
//
//   1. THE FAN-OUT IS A FAN-OUT, NOT A WATERFALL. `ALL` fires one request per
//      watched ticker simultaneously (ten with the fallback universe). Nothing
//      waits on anything, so there is no waterfall to straighten — v3's
//      non-negotiable 3 is already satisfied by v2 here.
//   2. ONE DEAD TICKER IS SILENT. Each mapper swallows its own rejection and
//      contributes zero rows; the other nine still render. A ticker that 500s
//      is therefore indistinguishable from a ticker with no recorded strikes.
//   3. THE CLIENT OVERWRITES `symbol`. Every row is re-stamped with the symbol
//      that was ASKED FOR, not the one the API returned (E18). Anything the
//      server says about the symbol field is discarded.
//
// ── DEPARTURES FROM v2 ───────────────────────────────────────────────────────
//
// 1. `query()` INSTEAD OF RAW `fetch`. v2 calls `fetch` directly with no
//    `AbortController` and no request key (E27), so switching ticker mid-flight
//    leaves the old fan-out running and whichever `setRows` resolves LAST wins —
//    a stale response can overwrite a newer one after a fast ticker switch.
//    `query()` from `@/data/api` dedupes and caches BY URL, which fixes the
//    stale-overwrite: a result is addressed by the URL that asked for it rather
//    than by arrival time, two panels or two rapid switches asking the same URL
//    share one in-flight promise instead of racing, and step 3's keyed read
//    cannot apply the old symbol's payload to the new symbol. No abort is
//    needed to get correctness; abort would only save the egress.
//
// 2. ONE CACHING POLICY, NOT TWO. v2 sends `{ cache: "no-store" }` on
//    by-expiry and nothing at all on watchlist (E14, E17), so one endpoint
//    bypasses the HTTP cache and the other takes whatever the browser decides.
//    Both now go through `query()`'s stale window: `SQ_WATCHLIST_STALE_MS` for
//    the rarely-changing roster, `SQ_ROWS_STALE_MS` for the recorder data. The
//    `↻ Refresh` button passes `force` and bypasses the window, because a
//    button labelled Refresh that returns a cached body is a lie.
//
// 3. SYMBOLS ARE URL-ENCODED. v2 interpolates `sym` raw into the query string
//    (E17). Every symbol in the universe is alphanumeric so nothing changes
//    today; the encode is there so a future ticker with a `+` or a `/` does not
//    silently query something else.
//
// 4. `loadStrikeRows` ADDITIONALLY REPORTS WHICH SYMBOLS FAILED. `rows` is
//    exactly v2's `results.flat()` — same rows, same order, same swallow — and
//    `failed` is new information that v2 threw away. Nothing here consumes it;
//    see the note on the error path below.
//
// ── THE ERROR PATH IS STRUCTURALLY UNREACHABLE (E23, E112) ───────────────────
// v2 wraps the fan-out in a try/catch that sets an error banner, but
// `Promise.all` over mappers that each swallow their own rejection CANNOT
// reject. Only a synchronous throw in the four merge lines could set it, and
// none of them can throw. So the banner is dead code in practice, and the real
// consequence is the one in note 2 above: a per-symbol 500 renders as "No rows
// yet. Needs recorder history for the selected ticker(s)." — the same sentence
// as an empty result set. That is recorded, not papered over: the swallow is
// ported as written and the outer catch is kept for the merge lines it nominally
// guards. `failed` exists so step 3 CAN surface it; whether it should is a
// product decision, and inventing a per-symbol error banner here would be
// re-deriving rather than transcribing.
//
// ── REMOVED IN v2, DO NOT RE-ADD ─────────────────────────────────────────────
//  · Nothing dead to remove — both endpoints are live and both are used.
//  · No polling is added. v2 has none at all (E26): no `setInterval`, no
//    visibility hook, no market-hours gate. Data moves on mount, on a ticker
//    change, and on the ↻ button. `query()` supports `pollMs` and it is
//    deliberately NOT passed — whether this tab should get a cadence or a
//    socket subscription is Part E open question 9, and quietly adding one
//    would change the tab's egress profile without anyone deciding to.
//
// Spec: docs/parity/scanner.md Part E, rows E14–E27.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '@/data/api'
import { SQ_ALL } from '@/pages/scanner/strikeQuery'
import type { SqRow } from '@/pages/scanner/strikeQuery'

// ═════════════════════════════════════════════════════════════════════════════
//  Endpoints and cache windows
// ═════════════════════════════════════════════════════════════════════════════

export const SQ_WATCHLIST_URL = '/proxy/strike-growth/watchlist'
export const SQ_BY_EXPIRY_PATH = '/proxy/strike-growth/by-expiry'

/** The roster changes by hand, not by the minute. */
export const SQ_WATCHLIST_STALE_MS = 60_000

/**
 * The recorder writes a snapshot every ~5 minutes, so a 15s window costs no
 * freshness a user can observe while still absorbing a re-render storm or two
 * mounts of the same tab.
 */
export const SQ_ROWS_STALE_MS = 15_000

/** `↻ Refresh` (E25) must actually go and ask. */
const FORCED_STALE_MS = 0

export function sqByExpiryUrl(symbol: string): string {
  return `${SQ_BY_EXPIRY_PATH}?symbol=${encodeURIComponent(symbol)}`
}

// ═════════════════════════════════════════════════════════════════════════════
//  E14–E16 — The watchlist
// ═════════════════════════════════════════════════════════════════════════════

export interface SqWatchlistRow {
  symbol: string
  active: boolean
}

export interface SqWatchlistResponse {
  ok?: boolean
  rows?: SqWatchlistRow[]
}

/**
 * The active watched tickers, sorted. Spec: rows E14, E15.
 *
 * Fires ONCE per mount in v2 (`useCallback(…, [])` behind a mount effect), takes
 * no query params, and is the only request on this tab that is not per-symbol.
 *
 * Every failure mode collapses to the SAME empty array, deliberately, because
 * that is what v2's caller reacts to — an empty result leaves `watchlist` at
 * `[]` and `SQ_FALLBACK` stands in (E16):
 *
 *   · the request rejects              → `.catch(() => {})`, silently
 *   · `ok` is falsy                    → early return, no state change
 *   · every row has `active: false`    → `if (active.length > 0)` never fires
 *
 * There is no error text, no retry and no console line for any of them. The
 * caller CANNOT tell a down proxy from an empty roster, and that is v2's
 * behaviour, ported.
 *
 * The sort is `Array.prototype.sort()` with NO comparator — default
 * lexicographic string order, which is what feeds the Ticker dropdown.
 */
export async function loadStrikeWatchlist(): Promise<string[]> {
  try {
    const d = await query<SqWatchlistResponse | null>(SQ_WATCHLIST_URL, {
      staleMs: SQ_WATCHLIST_STALE_MS,
    })
    if (!d?.ok || !d.rows) return []
    return d.rows
      .filter((r) => r.active)
      .map((r) => r.symbol)
      .sort()
  } catch {
    return []
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  E17–E19 — The per-symbol fan-out
// ═════════════════════════════════════════════════════════════════════════════

export interface SqByExpiryResponse {
  ok?: boolean
  rows?: SqRow[]
}

/**
 * Which tickers the fan-out asks for. Spec: row E17.
 *
 * `ALL` asks for the whole universe — ten requests with the fallback, more once
 * a longer watchlist lands, with no concurrency cap (Part E open question 10).
 * Any other value asks for exactly one.
 */
export function sqTargets(symbol: string, symbolList: readonly string[]): string[] {
  return symbol === SQ_ALL ? [...symbolList] : [symbol]
}

export interface SqSymbolResult {
  symbol: string
  rows: SqRow[]
  /** True when the request rejected or the payload's `ok` was falsy. */
  failed: boolean
}

/**
 * One ticker's strikes. Spec: rows E17, E18.
 *
 * NEVER REJECTS — that is the contract the fan-out depends on. `ok` falsy or
 * any throw yields zero rows, so one dead ticker costs its own rows and nothing
 * else. It is also why the caller's outer catch is unreachable; see the file
 * header.
 *
 * Every returned row is re-stamped `{ ...r, symbol }` with the symbol that was
 * REQUESTED, discarding whatever the API put in that field (E18).
 */
export async function loadStrikeRowsFor(
  symbol: string,
  opts: { force?: boolean } = {},
): Promise<SqSymbolResult> {
  try {
    const j = await query<SqByExpiryResponse | null>(sqByExpiryUrl(symbol), {
      staleMs: opts.force ? FORCED_STALE_MS : SQ_ROWS_STALE_MS,
    })
    if (!j?.ok || !j.rows) return { symbol, rows: [], failed: true }
    return { symbol, rows: j.rows.map((r) => ({ ...r, symbol })), failed: false }
  } catch {
    return { symbol, rows: [], failed: true }
  }
}

export interface SqRowsResult {
  /** Exactly v2's `results.flat()` — see the merge note below. */
  rows: SqRow[]
  /** Additive; v2 discards this. Nothing renders it yet. */
  failed: string[]
}

/**
 * The whole fan-out. Spec: rows E17, E19, E24, E25.
 *
 * Takes its targets as an argument so a route can fire it at entry with
 * everything it needs already known — nothing here waits on anything else.
 *
 * THE MERGE ORDER IS LOAD BEARING: `results.flat()` concatenates in `targets`
 * order (i.e. the universe's own order — the ten unsorted fallbacks, or the
 * sorted watchlist), and within each ticker in the API's row order. There is no
 * dedupe and no re-sort at merge time, and because `Array.prototype.sort` is
 * stable, THIS ORDER IS THE TIE-BREAK for every comparator in `strikeQuery.ts`.
 * Reordering the fan-out silently reorders equal-magnitude rows on screen.
 *
 * Pass `force` for the ↻ Refresh button. v2 does not disable that button while
 * loading, so a double click fires two overlapping fan-outs and the later
 * `setRows` wins by arrival order (E25); with `query()`'s per-URL dedupe the
 * second click joins the first click's in-flight promise instead of racing it.
 */
export async function loadStrikeRows(
  targets: readonly string[],
  opts: { force?: boolean } = {},
): Promise<SqRowsResult> {
  const results = await Promise.all(targets.map((sym) => loadStrikeRowsFor(sym, opts)))
  return {
    rows: results.flatMap((r) => r.rows),
    failed: results.filter((r) => r.failed).map((r) => r.symbol),
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  E20–E21 — What the load derives on arrival
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The Expiry dropdown's options. Spec: row E20.
 *
 * Distinct expiries, `Array.prototype.sort()` with NO comparator — default
 * lexicographic order, which is also chronological for ISO `YYYY-MM-DD` and is
 * NOT for any other format the API might send. Recomputed on every successful
 * load. An empty result leaves the dropdown holding only "All Expiries".
 */
export function sqDeriveExpiries(rows: readonly SqRow[]): string[] {
  return [...new Set<string>(rows.map((r) => r.expiry))].sort()
}

/**
 * Keep the selected expiry if it still exists, else fall back to `ALL`.
 * Spec: row E21.
 *
 * Runs on every successful load, including the manual Refresh, so an expiry
 * that rolls off the recorder's window snaps the control back rather than
 * leaving a filter selected that matches nothing.
 */
export function sqReconcileExpiry(prev: string, expiries: readonly string[]): string {
  return prev === SQ_ALL || expiries.includes(prev) ? prev : SQ_ALL
}
