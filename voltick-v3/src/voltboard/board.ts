// ─────────────────────────────────────────────────────────────────────────────
// Building the strike × expiration matrix, in the browser.
//
// WHY CLIENT-SIDE. The socket's `gex` frame carries ONE expiry
// (`GexData.expiry`, one row per strike). The Voltmap needs every column at
// once, so the board is assembled here from the same two endpoints the Options
// Chain page already uses:
//
//   /api/expirations?ticker=       the ticker's real listed expirations
//   /api/chains?ticker=&expiration= one expiration's strikes
//
// AND IT REUSES `parseExpiration` RATHER THAN RE-DOING THE MATHS. That is the
// whole point: the chain page and this board then cannot disagree about what a
// strike's GEX is, because there is one function and it lives in chainMath.ts.
// A second copy of the dealer convention here would be a second thing to keep
// correct, and the first symptom would be the board and the chain quoting
// different walls for the same ticker.
//
// The columns are fetched in PARALLEL, not in sequence — fourteen serial
// round-trips is a visible pause on a cold board and it is a waterfall, which
// this app does not do (AGENTS.md rule 3).
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '@/data/api'
import { parseExpiration, type Expiration, type GreekCell } from '@/pages/optionsChain/chainMath'
import type { BoardCell, BoardCol, BoardMap, BoardMode, BoardSource } from './types'

/** How many expirations the board draws. Voltick's own board sits around 14. */
export const MAX_COLUMNS = 14

/** Refresh cadence. Open interest moves once a day; volume and spot do not. */
export const REFRESH_MS = 60_000

/* ── dates ────────────────────────────────────────────────────────────────── */

const DAY_MS = 86_400_000

/** New York's civil date, as YYYY-MM-DD. The board is a US-market object. */
export function nyToday(): string {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return f.format(new Date())
}

/** Whole days from today to an ISO date. 0 is same-day. */
export function dteOf(iso: string): number {
  const a = Date.parse(`${nyToday()}T00:00:00Z`)
  const b = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.round((b - a) / DAY_MS)
}

/** MM/DD — how the column headers print a date. */
export function fmtDate(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-')
  return `${m}/${d}`
}

/** Is this expiration today's? */
export function isTodayExp(iso: string): boolean {
  return iso.slice(0, 10) === nyToday()
}

/* ── the fetch ────────────────────────────────────────────────────────────── */

/**
 * /api/expirations is a PASS-THROUGH of the TastyTrade proxy, so the shape is
 * TastyTrade's, not ours: `data.items[]`, each carrying `expiration-date`, and
 * the SAME date appears many times (once per strike listing). The first cut of
 * this file guessed `{ expirations: [...] }` and got an empty board with a live
 * price above it — the one failure mode worth naming here, because the page
 * looked like a rendering bug and was a parsing one.
 *
 * The other shapes below are tolerated, not expected. The proxy is the source
 * of truth and it can change; an unrecognised payload must say so rather than
 * present as "this ticker has no options".
 */
interface ExpirationsPayload {
  data?: { items?: Array<Record<string, unknown>>; expirations?: unknown[] }
  items?: Array<Record<string, unknown>>
  expirations?: unknown[]
}

/**
 * The ticker's real listed expirations, nearest first, capped at MAX_COLUMNS.
 * Returns [] rather than throwing — an empty board renders its own empty
 * state, which is more useful than an error boundary swallowing the page.
 */
export async function fetchExpirations(ticker: string): Promise<Expiration[]> {
  const j = await query<ExpirationsPayload>(`/api/expirations?ticker=${encodeURIComponent(ticker)}`)
  const rows: unknown[] = j?.data?.items ?? j?.items ?? j?.data?.expirations ?? j?.expirations ?? []

  // Deduped: `items` lists a date once per strike, so SPX comes back with
  // thousands of rows over a few dozen real dates.
  const seen = new Set<string>()
  for (const r of rows) {
    const value =
      typeof r === 'string'
        ? r
        : String(
            (r as Record<string, unknown>)?.['expiration-date'] ??
              (r as Record<string, unknown>)?.expiration ??
              (r as Record<string, unknown>)?.value ??
              '',
          )
    const iso = value.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue
    if (dteOf(iso) < 0) continue // already expired — the feed still lists it on roll day
    seen.add(iso)
  }

  return [...seen]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_COLUMNS)
    .map((iso) => ({ value: iso, label: fmtDate(iso) }))
}

interface ChainPayload {
  data?: { items?: unknown[]; underlyingPrice?: unknown }
}

/** One column. Never throws: a column that fails comes back empty and the grid draws it blank. */
async function fetchColumn(
  ticker: string,
  exp: Expiration,
): Promise<{ exp: string; underlying: number; cells: Map<number, GreekCell> }> {
  try {
    const j = await query<ChainPayload>(
      `/api/chains?ticker=${encodeURIComponent(ticker)}&expiration=${encodeURIComponent(exp.value)}&range=all`,
    )
    const items = (j?.data?.items as unknown[]) ?? []
    const underlying = parseFloat(String(j?.data?.underlyingPrice ?? 0)) || 0
    // 'oi-vol' is the chain page's default basis and the honest one for a map:
    // the settled book plus today's tape. The board's OI / VOLUME switch picks
    // which LEG it draws out of the cell, below — it does not re-fetch.
    return { exp: exp.value, underlying, cells: parseExpiration(items, exp.value, underlying, 'oi-vol') }
  } catch {
    return { exp: exp.value, underlying: 0, cells: new Map() }
  }
}

/* ── the matrix ───────────────────────────────────────────────────────────── */

/**
 * Pull every column and assemble the board.
 *
 * `mode` and `source` pick which number lands in `cell.v`; both legs are kept
 * on every cell regardless, because the stat tiles are ALWAYS open interest
 * even when the map above them is weighted by volume. That split is Voltick's
 * and it is deliberate — the VOLUME switch stays lit while the tiles keep
 * quoting the book, and the legend says so.
 */
export async function buildBoard(
  ticker: string,
  mode: BoardMode,
  source: BoardSource,
  liveSpot = 0,
): Promise<BoardMap> {
  const exps = await fetchExpirations(ticker)
  if (!exps.length) {
    return {
      symbol: ticker,
      spot: liveSpot,
      prevClose: 0,
      strikes: [],
      cols: [],
      atmIv: null,
      em: null,
      builtAt: Date.now(),
      warning:
        `No listed expirations came back for ${ticker}. ` +
        `/api/expirations returned nothing this page could read — check it is ` +
        `answering (it needs a subscriber session) and that its payload still ` +
        `carries data.items[].expiration-date.`,
    }
  }

  const results = await Promise.all(exps.map((e) => fetchColumn(ticker, e)))

  const spot = liveSpot > 0 ? liveSpot : (results.find((r) => r.underlying > 0)?.underlying ?? 0)

  const strikeSet = new Set<number>()
  const cols: BoardCol[] = results.map((r) => {
    const cells = new Map<number, BoardCell>()
    for (const [strike, g] of r.cells) {
      strikeSet.add(strike)
      // VEX has no volume leg of its own on this feed, so a volume map falls
      // back to the vega it does carry rather than drawing an empty column.
      const oiNet = mode === 'GEX' ? g.gex : g.vex
      const volNet = mode === 'GEX' ? g.volGex : g.vex
      cells.set(strike, {
        v: source === 'volume' ? volNet : oiNet,
        oiNet,
        volNet,
        callOI: g.callOI,
        putOI: g.putOI,
        callVol: g.callVol,
        putVol: g.putVol,
      })
    }
    return {
      exp: r.exp,
      dte: dteOf(r.exp),
      label: fmtDate(r.exp),
      cells,
      king: kingOf(cells),
      flip: flipOf(cells, spot),
    }
  })

  const strikes = [...strikeSet].sort((a, b) => a - b)
  const empty = cols.every((c) => c.cells.size === 0)

  return {
    symbol: ticker,
    spot,
    prevClose: 0,
    strikes,
    cols,
    atmIv: null,
    em: null,
    builtAt: Date.now(),
    warning: empty ? `No live chain payload returned for ${ticker}.` : undefined,
  }
}

/* ── per-column levels ────────────────────────────────────────────────────── */

/** The biggest level in a column, by absolute value. */
function kingOf(cells: Map<number, BoardCell>): number | null {
  let best: number | null = null
  let bestAbs = 0
  for (const [k, c] of cells) {
    const a = Math.abs(c.v)
    if (a > bestAbs) {
      bestAbs = a
      best = k
    }
  }
  return bestAbs > 0 ? best : null
}

/**
 * Where a column's cumulative gamma crosses zero, walked from the bottom
 * strike up, interpolated between the two strikes that straddle the crossing
 * and reported as the crossing NEAREST PRICE.
 *
 * Returns null when the column never crosses — which is an answer, not a
 * failure, and the header prints `⚡︎ none` for it rather than going blank.
 */
export function flipOf(cells: Map<number, BoardCell>, spot: number): number | null {
  const ks = [...cells.keys()].sort((a, b) => a - b)
  const first = ks[0]
  if (ks.length < 2 || first === undefined) return null
  let run = 0
  let prevK = first
  let prevRun = 0
  const crossings: number[] = []
  for (const k of ks) {
    const v = cells.get(k)?.v ?? 0
    const next = run + v
    if (run !== 0 && Math.sign(next) !== Math.sign(run) && next !== 0) {
      const span = k - prevK
      const t = Math.abs(prevRun) / (Math.abs(prevRun) + Math.abs(next) || 1)
      crossings.push(prevK + span * t)
    }
    prevK = k
    prevRun = run
    run = next
  }
  if (!crossings.length) return null
  if (!(spot > 0)) return crossings[0] ?? null
  return crossings.reduce((a, b) => (Math.abs(b - spot) < Math.abs(a - spot) ? b : a))
}
