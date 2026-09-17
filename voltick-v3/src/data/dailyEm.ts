import { useMemo } from 'react'
import { useQuery } from '@/data/api'

// ─────────────────────────────────────────────────────────────────────────────
// THE DAILY EXPECTED-MOVE BAND — two static price levels, read not derived.
//
// ── This is NOT the ±1σ the GEX Chart's stat tiles show ──────────────────────
// Those read /api/em-tracker: the WEEKLY band, published once a week and
// evaluated against that week's high and low. This is the DAILY one — the front
// expiry's ATM straddle, anchored to the PREVIOUS SESSION'S CLOSE. Two different
// questions, two different numbers, and anything drawing this one labels it so
// the pair can never be read as one figure printed twice.
//
// ── Why there is nothing to compute here ─────────────────────────────────────
// The band is computed and FROZEN server-side (server-v2/daily-em.js): the
// first read of an ET session writes the row, every read after that is served
// from it. That is deliberate and it is the whole feature — a band recomputed
// client-side would drift all session as the straddle decays, so two traders
// looking at the same chart at 10:00 and 14:00 would be looking at two
// different lines and the earlier one could never be referred back to. "Price
// rejected the EM high" has to mean something an hour later.
//
// It also means this module cannot fall back to computing its own. Neither the
// socket's GEX rows nor the candles carry an IV or a mark (see
// contract/frames.ts), so there is no straddle on the client to price. No row,
// no rails — which is the honest answer, not a degraded one.
//
// ── The poll ─────────────────────────────────────────────────────────────────
// Five minutes, and it is not about staleness: the row does not change once
// written. The poll exists so the FIRST read of the day — which is what writes
// it — actually happens on a board that was left open overnight, rather than
// the chart sitting rail-less until somebody reloads.
// ─────────────────────────────────────────────────────────────────────────────

/** One recorded session's band. Prices, already anchored — nothing to add. */
export interface DailyEmBand {
  /** ET session date the band was frozen for, YYYY-MM-DD. */
  date: string
  /** The previous session's close the band hangs off. */
  refClose: number
  /** ±1σ magnitude, in points. */
  em: number
  up: number
  down: number
  /** The expiration the straddle was read from. */
  expiry: string | null
  /** 'straddle' on a 0DTE book, 'iv' when there was time left to price. */
  method: string | null
  /** Epoch ms the row was written — i.e. when the day's number was decided. */
  recordedAt: number | null
}

interface DailyEmResponse {
  ticker?: string
  date?: string
  band?: {
    date?: string
    refClose?: number | null
    em?: number | null
    up?: number | null
    down?: number | null
    expiry?: string | null
    method?: string | null
    recordedAt?: number | null
  } | null
}

/** The row never changes once written; the poll is only there to catch the write. */
const DAILY_EM_STALE_MS = 300_000
const DAILY_EM_POLL_MS = 300_000

/**
 * `date` asks for a PAST session instead of today's.
 *
 * Read-only by construction: a past band cannot be reconstructed from a live
 * chain, so the route never writes one. A replayed session that predates the
 * table therefore answers with no band, and the chart draws no rails — which is
 * right. Drawing TODAY's band over a rewound Tuesday would be a level that is
 * simply false, and false is worse than absent.
 */
export function dailyEmUrl(symbol: string, date?: string): string {
  const q = `?ticker=${encodeURIComponent(symbol)}`
  return `/api/daily-em${q}${date ? `&date=${encodeURIComponent(date)}` : ''}`
}

const fin = (v: unknown): number | null => {
  const x = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(x) && x > 0 ? x : null
}

/**
 * A band, or null.
 *
 * All three prices are required. A row carrying a magnitude but no anchor is
 * not a band that can be drawn — half a level is worse than none, because it
 * still looks like a level.
 */
export function parseDailyEm(json: unknown): DailyEmBand | null {
  const res = json as DailyEmResponse | undefined
  const b = res?.band
  if (!b) return null
  const refClose = fin(b.refClose)
  const em = fin(b.em)
  const up = fin(b.up)
  const down = fin(b.down)
  if (refClose == null || em == null || up == null || down == null) return null
  return {
    date: b.date ?? res?.date ?? '',
    refClose,
    em,
    up,
    down,
    expiry: b.expiry ?? null,
    method: b.method ?? null,
    recordedAt: typeof b.recordedAt === 'number' ? b.recordedAt : null,
  }
}

/**
 * The frozen band for a symbol — today's, or a named past session's.
 *
 * `enabled` false passes a null URL, which is what stops the request from
 * firing at all rather than firing and being thrown away: a card whose EM layer
 * is switched off has no reason to be asking for it.
 */
export function useDailyEm(symbol: string, enabled = true, date?: string): DailyEmBand | null {
  const q = useQuery<DailyEmResponse>(enabled && symbol ? dailyEmUrl(symbol, date) : null, {
    staleMs: DAILY_EM_STALE_MS,
    pollMs: DAILY_EM_POLL_MS,
  })
  return useMemo(() => parseDailyEm(q.data), [q.data])
}
