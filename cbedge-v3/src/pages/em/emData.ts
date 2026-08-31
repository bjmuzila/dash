// ─────────────────────────────────────────────────────────────────────────────
// THE ESTIMATED MOVES DATA LAYER.
//
// Transcribed 1:1 from v2's `hooks/useEmLookup.ts` against the checklist in
// docs/parity/em.md Part J. Nothing here was re-derived from a description —
// the thresholds, the alias fan-outs, the merge order and the fallback chain
// are the v2 values, copied. That is deliberate: re-deriving is where detail
// goes missing, and this file holds four pieces of business logic that are not
// obvious from the screen:
//
//   1. the ESU/ESM + NQU/NQM alias fan-out — futures are RECORDED under their
//      internal month code and DISPLAYED under the front code, so the tracker
//      has to be asked for both;
//   2. the win-rate merge of the static verified history JSON with the live
//      em_tracker table — two different field names for the same idea
//      (`total` vs `evaluated`), which is the kind of thing a rewrite silently
//      gets wrong;
//   3. the zones fallback chain — a published row with no zones, or no
//      published row at all, still gets on-demand zones from /api/em-zones;
//   4. EM values arrive as comma-formatted STRINGS ("7,711.76"). Every consumer
//      must strip the commas before parseFloat — `parseFloat("7,711.76")` is 7.
//
// ── THE ONE DELIBERATE DEPARTURE FROM v2 ─────────────────────────────────────
// v2 awaits /api/levels and only THEN fires the four enrichment requests, even
// though not one of them needs anything from the levels row — every URL is
// built from the symbol, which is known on the first line. That is a two-stage
// waterfall, and v3's non-negotiable 3 forbids it. Here the enrichment wave is
// started BEFORE the levels read is awaited. Same requests, same results, one
// round trip less. Recorded in docs/parity/em.md Part J and in the changelog.
//
// Second, smaller departure: v2 reads /api/levels with `cache: "no-store"`.
// Here it goes through `query()` with a 10s stale window so the rail's
// `preload('/api/levels?ticker=SPX')` on hover actually pays for itself. The
// levels row is published once a week; ten seconds is not a staleness anyone
// can observe.
//
// ── REMOVED IN v2, DO NOT RE-ADD ─────────────────────────────────────────────
// /api/confidence and its "CB Confidence" tile. The route returns
// `score: ConfidenceResult` (an object) where the reader expected a scalar, so
// `Number(object)` was NaN, `Number.isFinite` was false, and the tile never
// rendered on any surface, ever. It was also the most expensive request in the
// set — a 120-session server-side scan per lookup, for a value that was thrown
// away. If the tile is wanted, fix the ROUTE to return a scalar first.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '@/data/api'

/** The published weekly row. Every numeric field is a formatted STRING. */
export interface Levels {
  ticker?: string | null
  label?: string | null
  close?: string | null
  em?: string | null
  up?: string | null
  down?: string | null
  buy_near?: string | null
  buy_far?: string | null
  sell_near?: string | null
  sell_far?: string | null
  pivot?: string | null
  exp_label?: string | null
  updated_at?: string | null
}

export interface TickerEmStats {
  recentAvg: number | null
  midAvg: number | null
  sampleSize: number
}

export interface WinRate {
  hits: number
  evaluated: number
  hit_rate: number
}

export interface RecentRecord {
  lastResult: 'hit' | 'miss' | null
  lastLabel: string | null
  last5Hits: number
  last5Total: number
}

export interface TrackerWeekRow {
  week_label?: string | null
  week_start?: string | null
  result?: 'hit' | 'miss' | null
}

export interface EmSnapshot {
  data: Levels
  emStats: TickerEmStats | null
  winRate: WinRate | null
  recentRec: RecentRecord | null
}

/** The quick-pick chips, in this exact order. v2's POPULAR, unchanged. */
export const POPULAR = ['SPX', 'NDX', 'ESU', 'NQU', 'SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA', 'MSFT'] as const

/**
 * Futures are recorded in em_tracker under their internal month code and shown
 * under the front code. Ask for both or the record comes back empty.
 *
 * NOTE this is the CLIENT fan-out only. `/api/levels` does its own, wider
 * aliasing server-side (ES, ESM, ESU6, ESU26, /ES → ESU and the NQ equivalents)
 * and `/api/em/ticker-em-stats` does NONE — which is why ESU can show a hit
 * rate and no historical average in the same render. That asymmetry is v2's;
 * it is recorded here rather than papered over.
 */
const TRACKER_ALIASES: Record<string, string[]> = {
  ESU: ['ESU', 'ESM'],
  NQU: ['NQU', 'NQM'],
}

const aliasesFor = (sym: string): string[] => TRACKER_ALIASES[sym] ?? [sym]

/** Levels are published weekly; a short window makes the nav prefetch count. */
const LEVELS_STALE_MS = 10_000
/** The enrichment set changes once a week too. */
const ENRICH_STALE_MS = 60_000

/** `"--"` for a missing value, and the raw string for everything else. */
export function val(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '--'
  return v
}

/** Parse a DB-formatted level string ("7,711.76") into a number. */
export function emNumber(v: string | null | undefined): number | null {
  if (v == null || v === '') return null
  const n = parseFloat(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * "Aug 28, 04:19 PM". Browser-local, not ET — v2's behaviour, kept so the two
 * pages agree while both are up. An unparseable timestamp renders as "", which
 * leaves the bare word "Updated" on screen; also v2's.
 */
export function fmtUpdated(ts: string | null | undefined): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Log the lookup. Fire-and-forget, never blocks, never throws — transcribed
 * from v2's lib/trackTicker.ts rather than imported, because v3 imports nothing
 * from the v2 tree.
 */
export function trackEmLookup(ticker: string): void {
  if (!ticker) return
  try {
    const json = JSON.stringify({ ticker, event: 'click', source: 'em' })
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/ticker-event', new Blob([json], { type: 'application/json' }))
      return
    }
    void fetch('/api/ticker-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json,
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* tracking must never throw */
  }
}

/** On-demand Buy/Sell zones for any ticker. Static for the week, server-cached. */
async function fetchZones(sym: string): Promise<Levels | null> {
  try {
    const z = await query<Levels | { error?: string } | null>(
      `/api/em-zones?ticker=${encodeURIComponent(sym)}`,
      { staleMs: LEVELS_STALE_MS },
    )
    if (!z || (z as { error?: string }).error) return null
    return z as Levels
  } catch {
    return null
  }
}

/** Per-ticker weekly hit/miss rows, newest first, with the alias fan-out. */
async function fetchTrackerRows(sym: string): Promise<TrackerWeekRow[]> {
  const sets = await Promise.all(
    aliasesFor(sym).map((c) =>
      query<{ rows?: TrackerWeekRow[] } | null>(`/api/em-tracker?ticker=${encodeURIComponent(c)}`, {
        staleMs: ENRICH_STALE_MS,
      }).catch(() => null),
    ),
  )
  const rows: TrackerWeekRow[] = []
  for (const s of sets) if (s?.rows) rows.push(...s.rows)
  // Newest first. Lexicographic, which is correct only because week_start is
  // ISO `YYYY-MM-DD`; the week_label fallback ("8/28") sorts wrongly. v2's
  // behaviour and v2's latent bug, transcribed rather than quietly fixed.
  rows.sort((a, b) =>
    String(b.week_start ?? b.week_label ?? '').localeCompare(String(a.week_start ?? a.week_label ?? '')),
  )
  return rows
}

interface StatsResp {
  recentAvg?: number | null
  midAvg?: number | null
  sampleSize?: number | null
}
interface SummaryRow {
  ticker: string
  hits: number
  evaluated: number
}
interface HistResp {
  tallies?: Record<string, { hits: number; total: number }>
}

/**
 * One lookup. Throws with v2's exact error strings so the banner reads the
 * same:
 *   "Lookup failed"                         — /api/levels was not OK
 *   "No levels published for {SYM} yet."    — no row AND no on-demand zones
 */
export async function loadEm(rawSym: string): Promise<EmSnapshot> {
  const sym = rawSym.trim().toUpperCase()
  const e = encodeURIComponent(sym)

  // ── The enrichment wave, fired FIRST (see the header note). Every one of
  // these is built from `sym` alone, so none of them has any business waiting
  // for the levels row. All are individually swallowed: no single failing
  // endpoint may take the page down — the core row still renders.
  const statsP = query<StatsResp | null>(`/api/em/ticker-em-stats?ticker=${e}`, {
    staleMs: ENRICH_STALE_MS,
  }).catch(() => null)

  const trackerP = Promise.all([
    query<{ summary?: SummaryRow[] } | null>('/api/em-tracker', { staleMs: ENRICH_STALE_MS }).catch(
      () => null,
    ),
    query<HistResp | null>('/api/em-tracker/history', { staleMs: ENRICH_STALE_MS }).catch(() => null),
  ]).then(([live, hist]) => (live ? { summary: live.summary, history: hist } : null))

  const rowsP = fetchTrackerRows(sym)

  // ── The core row.
  let row: Levels | null
  try {
    row = await query<Levels | null>(`/api/levels?ticker=${e}`, { staleMs: LEVELS_STALE_MS })
  } catch {
    throw new Error('Lookup failed')
  }

  let data: Levels
  if (!row) {
    // No published row at all — still try on-demand zones, which are static for
    // the week. EM only exists once the weekly publisher has computed it, so a
    // brand new ticker shows zones now and EM after the next weekend run.
    const zones = await fetchZones(sym)
    if (!zones) throw new Error(`No levels published for ${sym} yet.`)
    data = zones
  } else {
    data = row
    // Fill zones in on demand when the published row has EM but no zones — the
    // long-tail names are not pre-published with them. The on-demand fields
    // WIN over the published row; that is v2's merge order.
    const hasZones = row.buy_near || row.sell_near || row.pivot
    if (!hasZones) {
      const zones = await fetchZones(sym)
      if (zones) data = { ...data, ...zones }
    }
  }

  // Only log a visit once data actually came back, so lookups that find nothing
  // do not skew the counts.
  trackEmLookup(sym)

  const [stats, tracker, rows] = await Promise.all([statsP, trackerP, rowsP])

  // ── EM history averages.
  const emStats: TickerEmStats | null = stats
    ? {
        recentAvg: stats.recentAvg ?? null,
        midAvg: stats.midAvg ?? null,
        sampleSize: stats.sampleSize ?? 0,
      }
    : null

  // ── Win rate: the static verified history plus the live tracker table.
  let winRate: WinRate | null = null
  if (tracker) {
    const candidates = aliasesFor(sym)
    const liveRow = (tracker.summary || []).find((r) => candidates.includes(r.ticker))
    const histTicker = candidates.find((c) => tracker.history?.tallies?.[c])
    const hist = histTicker ? tracker.history?.tallies?.[histTicker] : null
    const liveHits = liveRow?.hits ?? 0
    const liveEval = liveRow?.evaluated ?? 0
    const histHits = hist?.hits ?? 0
    // The field names differ between the two sources on purpose — `total` in
    // the history JSON, `evaluated` in the live table. Reading one for the
    // other is silent and produces a plausible wrong number.
    const histTotal = hist?.total ?? 0
    const totalHits = histHits + liveHits
    const totalEval = histTotal + liveEval
    if (totalEval > 0) {
      winRate = { hits: totalHits, evaluated: totalEval, hit_rate: totalHits / totalEval }
    }
  }

  // ── Recent record: the most-recent FINALIZED week plus a trailing-5 rate.
  let recentRec: RecentRecord | null = null
  const evaluated = rows.filter((r) => r.result === 'hit' || r.result === 'miss')
  if (evaluated.length > 0) {
    const last5 = evaluated.slice(0, 5)
    recentRec = {
      lastResult: evaluated[0].result ?? null,
      lastLabel: evaluated[0].week_label ?? null,
      last5Hits: last5.filter((r) => r.result === 'hit').length,
      last5Total: last5.length,
    }
  }

  return { data, emStats, winRate, recentRec }
}
