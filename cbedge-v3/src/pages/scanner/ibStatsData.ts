// ─────────────────────────────────────────────────────────────────────────────
// IB STATS — THE DATA LAYER.
//
// Transcribed 1:1 from the four `fetch` call sites this tab owns, against the
// checklist in docs/parity/scanner.md Part G, rows G9–G13, G122–G123, G220–G221
// and G280:
//
//   IbStatsTab.tsx:1390–1402   the static dataset,   /data/ib-<SYM>.json
//   IbStatsTab.tsx:1002–1021   the last-5 tape,      /api/ib-results?…&limit=5
//   IbDailyResults.tsx:88–96   the EOD scoreboard,   /api/ib-results?…&limit=90
//   IbLevelCanvas.tsx:60–69    a SECOND copy of the dataset (dead file)
//
// THREE things here are not obvious from the screen:
//
//   1. THE DATASET IS A STATIC FILE, NOT AN API. Eight of them —
//      `ib-{ES,NQ}.json` and `orb{30,15,5}-{ES,NQ}.json` — written offline by
//      `ib-backtest-esu6.html` → "Export JSON for dashboard" and served out of
//      `public/data`. ~300 KB and ~2,300 sessions each. There is no revalidation
//      story because there is nothing to revalidate against: the file changes
//      only when someone re-runs the exporter and redeploys.
//   2. A MISSING FILE IS A PRODUCT STATE, NOT A BUG. Only the 60-minute datasets
//      are referenced anywhere else in the v2 tree, so three of the four window
//      buttons may lead straight to the "dataset not found" card. Its copy tells
//      you how to produce the file, verbatim, and that copy is preserved below.
//      (Open question Q2: do the ORB exports exist at all?)
//   3. `/api/ib-results` IS SUBSCRIBER-GATED AND CLAMPS ITS OWN LIMIT —
//      `Math.min(365, Math.max(1, Number(limit) || 90))`, symbol coerced to
//      NQ or ES — and returns rows NEWEST FIRST. Both facts are load-bearing:
//      the scoreboard renders in API order, and the tape has to reverse.
//
// ── THE ONE DELIBERATE DEPARTURE FROM v2 ─────────────────────────────────────
// THE TAPE NO LONGER HAS ITS OWN REQUEST. v2 fires TWO calls at the SAME
// endpoint from two components — `limit=5` for the "LAST 5 SESSIONS" strip and
// `limit=90` for the scoreboard — with no shared cache between them, so a tab
// with the scoreboard open holds 90 rows in one component and re-asks the server
// for five of them in another. `loadIbResults(sym)` below makes ONE request at
// the 90-row limit and `tapeFrom()` slices the five newest out of it locally.
// Same rows, same order, one request. v3 non-negotiable 3 and
// docs/parity/scanner.md Part G, "Do not port" item 11.
//
// Second, smaller: the scoreboard's request is no longer LAZY. v2 fetches on
// first expand (`if (!open || rows[sym]) return`), which is a waterfall behind a
// click. Here the route may fire it at entry alongside the dataset; the
// disclosure still controls what is DRAWN. If a caller wants to keep the lazy
// behaviour it simply calls the loader later — nothing in the loader assumes
// either way.
//
// ── REMOVED IN v2, DO NOT RE-ADD ─────────────────────────────────────────────
// • THE `alive` FLAGS. All four call sites guard `setState` with a teardown
//   boolean and abort nothing — the request still completes and its response is
//   still parsed, the result is just dropped. `query()` dedupes and caches, so a
//   remount inside the stale window makes no request at all.
// • THE SILENT `.catch(() => {})` ON THE TAPE (`IbStatsTab.tsx:1019`). It
//   swallows every error, and the tape then falls back to the STATIC EXPORT
//   whose newest row is months old — with no visual difference from live data.
//   The loader below returns null on failure and says so in its type, so the
//   caller has to decide; `fallbackTape()` in ibStats.ts is still there when it
//   decides to fall back.
// • THE PER-SYMBOL `rows` / `sets` / `errs` STATE MAPS. `query()`'s cache is
//   keyed by URL, which is the same thing done once.
// • `IbLevelCanvas`'s second `/data/ib-ES.json` fetch. It is a duplicate request
//   for the exact file `loadIbDataset('ES', 60)` already caches, in a file
//   imported by nothing. If the ladder is revived it calls this loader.
//
// Spec: docs/parity/scanner.md Part G, rows G9–G13, G122–G123, G220–G221, G280.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '@/data/api'
import type { IbResultRow } from '@/pages/scanner/ibDailyResults'
import { winLabel, type IbDataset, type IbSymbol, type IbWindow, type TapeDay } from '@/pages/scanner/ibStats'

// ─────────────────────────────────────────────────────────────────────────────
// THE STATIC DATASET.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `dsPath` (`IbStatsTab.tsx:52`). The 60-minute window is the odd one out — it
 * is `ib-`, not `orb60-`, because it predates the other three.
 */
export function datasetPath(sym: IbSymbol, win: IbWindow): string {
  return win === 60 ? `/data/ib-${sym}.json` : `/data/orb${win}-${sym}.json`
}

/**
 * The dataset changes only when someone re-runs the offline exporter and
 * redeploys, so a day-long window is not a staleness anyone can observe. v2
 * cached it in component state for the life of the mount and never refetched a
 * combination it had already loaded; this is that, shared across mounts.
 */
const DATASET_STALE_MS = 86_400_000

/**
 * The rows land once a day at 16:30 ET. v2 polls NOTHING on this tab, so a new
 * row appears only on a reload; a minute-long window keeps that behaviour while
 * letting two panels share one request.
 */
const RESULTS_STALE_MS = 60_000

/**
 * v2's dataset error copy (`IbStatsTab.tsx:1396`), verbatim — it is the only
 * place on the tab that tells you how to fix the problem.
 *
 * e.g. "ES ORB 5m: 404 — is public/data/orb5-ES.json in the repo? Export it from
 *       ib-backtest-esu6.html with the 5m window selected."
 */
export function datasetErrorMessage(sym: IbSymbol, win: IbWindow, status: number | string): string {
  return `${sym} ${winLabel(win)}: ${status} — is public${datasetPath(sym, win)} in the repo? Export it from ib-backtest-esu6.html with the ${win}m window selected.`
}

/**
 * One (symbol, window) dataset.
 *
 * THROWS with v2's message so the "dataset not found" card reads the same. The
 * status code is recovered from `query()`'s error text, which is
 * `"<status> <statusText> — <url>"`; a NETWORK failure has no status and lands
 * here as its raw message, exactly as v2's `catch` rendered `e.message`.
 */
export async function loadIbDataset(sym: IbSymbol, win: IbWindow): Promise<IbDataset> {
  try {
    return await query<IbDataset>(datasetPath(sym, win), { staleMs: DATASET_STALE_MS })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = /^(\d{3})\b/.exec(msg)?.[1]
    throw new Error(datasetErrorMessage(sym, win, status ?? msg))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE EOD RESULTS FEED.
// ─────────────────────────────────────────────────────────────────────────────

/** What `/api/ib-results` returns on a GET. */
export interface IbResultsResponse {
  symbol: string
  rows: IbResultRow[]
}

/**
 * The scoreboard's limit (`IbDailyResults.tsx:91`) and the one this loader asks
 * for. The server clamps to [1, 365] and defaults to 90 itself.
 */
export const IB_RESULTS_LIMIT = 90

/** How many of those rows the "LAST 5 SESSIONS" tape shows. */
export const TAPE_LENGTH = 5

/**
 * Every recorded session for a symbol, NEWEST FIRST — the order the scoreboard
 * renders in, because that table has no sort.
 *
 * Returns `[]` rather than throwing when the body carries no `rows`, which is
 * v2's `j.rows ?? []`. A transport failure still throws: the scoreboard has a
 * red banner for it (and never clears it — see ibDailyResults.ts finding 6).
 */
export async function loadIbResults(
  sym: IbSymbol,
  limit: number = IB_RESULTS_LIMIT,
): Promise<IbResultRow[]> {
  const res = await query<IbResultsResponse | null>(
    `/api/ib-results?symbol=${encodeURIComponent(sym)}&limit=${limit}`,
    { staleMs: RESULTS_STALE_MS },
  )
  return res?.rows ?? []
}

/**
 * The "LAST 5 SESSIONS" tape, sliced out of the rows already loaded.
 *
 * The API is newest-first and the tape reads OLDEST → NEWEST, left to right —
 * hence the reverse. The field mapping is v2's (`IbStatsTab.tsx:1010–1016`):
 * snake_case columns to the tape's camelCase, with every flag coerced to a real
 * boolean because they arrive as 0/1 integers.
 *
 * See the departure note at the top: v2 asked the server for these five rows
 * separately.
 */
export function tapeFrom(rows: readonly IbResultRow[], n: number = TAPE_LENGTH): TapeDay[] {
  return rows
    .slice(0, n)
    .reverse()
    .map((r) => ({
      date: r.date,
      firstTouchSide: r.first_touch_side ?? null,
      neitherBroke: !!r.neither_broke,
      bothBroke: !!r.both_broke,
      singleBreak: !!r.single_break,
    }))
}

// ─────────────────────────────────────────────────────────────────────────────
// THE ROUTE'S ENTRY LOAD.
// ─────────────────────────────────────────────────────────────────────────────

export interface IbStatsEntry {
  dataset: IbDataset
  /** Null when the feed failed; the caller decides whether to fall back. */
  results: IbResultRow[] | null
}

/**
 * Everything the tab needs for one (symbol, window), fired in PARALLEL.
 *
 * The two requests share nothing — neither URL is built from the other's
 * response — so there is no reason for either to wait. The dataset is the one
 * that can fail the page: without it there is no card to render, so its error
 * propagates. The results feed is enrichment (the tape, the owner scoreboard),
 * so its failure is swallowed into a null and the caller falls back to the
 * static export's newest five rows.
 */
export async function loadIbStatsEntry(sym: IbSymbol, win: IbWindow): Promise<IbStatsEntry> {
  const resultsP = loadIbResults(sym).catch(() => null)
  const dataset = await loadIbDataset(sym, win)
  return { dataset, results: await resultsP }
}

/**
 * Warm the cache for a (symbol, window) the user is about to pick — the strip's
 * buttons switch synchronously and the dataset is ~300 KB, so a hover prefetch
 * is the difference between an instant swap and a "Loading ES ORB 30m dataset…"
 * card. Failures are silent; the real call surfaces them.
 */
export function preloadIbDataset(sym: IbSymbol, win: IbWindow): void {
  void query<IbDataset>(datasetPath(sym, win), { staleMs: DATASET_STALE_MS }).catch(() => {})
}
