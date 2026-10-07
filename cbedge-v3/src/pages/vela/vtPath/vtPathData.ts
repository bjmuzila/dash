// ─────────────────────────────────────────────────────────────────────────────
// VOLTICK PATH — THE DATA. Where each Voltick level was, candle by candle.
//
// ── The levels ARE the walls migration, renamed (2026-10-03, Brandon) ────────
// The same recorded walls_log the Level Log's Wall Migration chart and CB Walls
// read (/api/walls-range — 15-minute slots, kept for months), named the Voltick
// way. This is the wall migration's own Voltick view, vtFromWalls() in
// pages/levelLog/wallData.ts:
//
//   Volt ★      = CORE, the top net GEX
//   Coil ◆      = the 2nd top net GEX on the Volt's side of spot: off the walls,
//                 a wall on that side that is NOT the Volt's strike (the call
//                 wall, with the Volt above spot); none when CORE sits on it
//   Reversal ↘  = the top net GEX across spot: the wall on the other side
//   Surge ↯     = the CORE of the VOLUME-ONLY walls (basis=vol) — Voltick's Surge
//                 is the biggest volume-GEX strike, and that is exactly what the
//                 volume book's CORE is. With the GEX map already on Vol only,
//                 Surge and Volt are the same strike and the Volt draws.
//
// Spot is each candle's close, as on the migration chart's Voltick view. Size =
// |level_gex| on the row the level was last written with (where the recorder
// carries one; a level without it draws at the flat middle size).
//
// Why not the per-minute GEX ladder (the first version of this file): the
// server keeps that table for 5 sessions only (GEX_HISTORY_KEEP_SESSIONS in
// server-v2/_lib-db.cjs); walls_log goes back months.
//
// ── The fold onto the candles ────────────────────────────────────────────────
// walls_log is CHANGE-ONLY, so each level is FORWARD-FILLED: every candle that
// starts inside 09:29–16:00 ET on a recorded session gets one frame — the
// levels in force at the candle's end (CB Walls' rule). Daily and coarser
// candles take the levels that session closed on. Then Voltick's pathRows,
// transcribed: Volt / Surge / Reversal / Coil rows, sizes held across unsized
// readings, and pathFill — one point per level per candle, one level per strike
// (Volt, Reversal, Coil, Surge).
//
// ES / NQ draw SPX's / NDX's walls shifted by the session basis (buildDays,
// shared with CB Walls); a session with no plausible basis draws nothing.
// OVERNIGHT (2026-10-06): an ES / NQ candle outside 09:29–16:00 reads what the
// GEX Rail reads at that minute — the NEXT expiry's per-minute ladder recorded
// after the close (studies/ladder.ts loadNextExpiryColumns), levels by the
// Voltick definition, moved by the rail's basis — so the bubbles line up with
// the rail. Where no ladder was recorded (an older night, a gap before the first
// column) it carries the walls the last cash session closed on.
//
// ── Vol only: the open rides the OI + Vol walls (2026-10-05) ────────────────
// The volume-only book has no open capture: at 09:29 nothing has traded, so the
// recorder's first vol row of a session is the 09:45 slot (10:00 on some
// Non-0DTE days). Read straight, a "Vol only" Path drew NOTHING on today's
// candles until 09:45 — the first live session on the walls read showed an empty
// path on every chart. So on Vol only, a candle before the volume book's first
// CORE write that session takes the OI + Vol walls in force instead (their open
// capture is pinned at 09:29); from the first vol write on, it is the volume
// book alone. The Surge stays the volume CORE, so it simply starts at 09:45.
// ─────────────────────────────────────────────────────────────────────────────

import type { OHLCV } from '@luxalgo/vela'
import { RTH_CLOSE_MIN, etDateKey, etMinutesOfDay } from '@/board/gexCandles/candles'
import { vtFromWalls } from '@/pages/levelLog/wallData'
import { isPlausibleBasis, type BasisModel } from '@/board/gexCandles/basis'
import type { GexColumn } from '@/board/gexCandles/gexHistory'
import { voltickMarks, vtFromLadder } from '@/data/voltickLevels'
import { columnAt, loadNextExpiryColumns, loadSessionColumns } from '@/pages/vela/studies/ladder'
import { resolveSym } from '@/pages/vela/cbedgeProvider'
import {
  SESSION_FROM_MIN,
  buildDays,
  heldAt,
  loadBasis,
  loadWallSlices,
  type DayModel,
  type Write,
} from '@/pages/vela/wallsData'
import { ladderValue, type GexBasis } from '@/pages/vela/gexBasis'
import { holdSizes, pathFill, type FillPt, type PathPt, type PathRole } from './trailruns'

const DAY_MS = 86_400_000

/** One reading — Voltick's level frame shape. Times in SECONDS. */
export interface VtFrame {
  t: number
  volt: number | null
  surge: number | null
  rev: number | null
  gates: number[]
  sz: { volt: number | null; surge: number | null; rev: number | null; gates: Array<number | null> } | null
  /** The gate list `sz.gates` is indexed by, when the sizes came from an earlier frame in the candle. */
  szGates?: number[]
}

export interface PathRow {
  role: PathRole
  pts: PathPt[]
  lead: boolean
  pathOnly: boolean
  fill: FillPt[]
}

// ── Reads ────────────────────────────────────────────────────────────────────

export interface WallRead {
  scope: '0dte' | 'agg'
  /** The GEX book Volt / Coil / Reversal are ranked on (on Vela: the page's GEX switch, gexBasis.ts). */
  basis: GexBasis
  sessions: number
}

export interface WallModels {
  /** The book `main` is on, and what a ladder frame ranks on (absent: volume, as before 2026-10-07). */
  basis?: GexBasis
  /** The walls on the chosen GEX map — Volt, Coil, Reversal. */
  main: DayModel[]
  /** The volume-only walls — their CORE is the Surge. */
  vol: DayModel[]
  /**
   * Vol only: the OI + Vol walls, for the candles before the volume book's first
   * CORE write of a session (see the header). Empty on OI + Vol.
   */
  open: DayModel[]
  /** The newest session is today's — the read that keeps moving. */
  hasToday: boolean
  /** A future (ES / NQ): its overnight candles carry the cash session's last walls (header). */
  fut: boolean
  /**
   * A future's nights, by the ET session date they follow: the per-minute ladder
   * columns recorded under the NEXT expiry after that close — what the GEX Rail
   * reads overnight (studies/ladder.ts loadNextExpiryColumns).
   */
  nights?: Map<string, GexColumn[]>
  /** The index → chart shift at a time (the GEX Rail's own; 0 on a cash chart); null = no usable basis. */
  shiftAt?: (ts: number) => number | null
  /**
   * Vol only and OI only: the newest sessions' per-minute ladders
   * (studies/ladder.ts), by ET date. A candle the chosen book has no CORE for yet
   * (on Vol only 09:29–09:45, or a symbol whose volume walls have not been written
   * that day; on OI only, any session from before the recorder kept an OI-only
   * log) reads that book's GEX here instead.
   */
  ladders?: Map<string, GexColumn[]>
}

export async function loadWallModels(chartSymbol: string, s: WallRead, fresh: boolean): Promise<WallModels> {
  const sym = resolveSym(chartSymbol.replace(/^[^:]*:/, ''))
  const wallsSymbol = sym.fut === 'NQ' ? 'NDX' : sym.fut === 'ES' ? 'SPX' : sym.key
  // The chosen book is the main map. The volume book is always read too: its CORE
  // is the Surge (on Vol only it IS the main map). On Vol only the OI + Vol walls
  // stand in for the open, before the volume book's first write (header).
  const onVol = s.basis === 'vol'
  const [mainSl, volSl, openSl, basis] = await Promise.all([
    loadWallSlices(wallsSymbol, s, fresh),
    onVol ? Promise.resolve(null) : loadWallSlices(wallsSymbol, { ...s, basis: 'vol' }, fresh),
    onVol ? loadWallSlices(wallsSymbol, { ...s, basis: 'oivol' }, fresh) : Promise.resolve(null),
    sym.fut ? loadBasis(sym.fut) : Promise.resolve(null),
  ])
  const mainDays = buildDays(mainSl, basis)
  const volDays = volSl ? buildDays(volSl, basis) : mainDays
  const openDays = openSl ? buildDays(openSl, basis) : []
  const today = etDateKey(Date.now())
  const isToday = (d: DayModel) => d.date === today
  const out: WallModels = {
    basis: s.basis,
    main: mainDays,
    vol: volDays,
    open: openDays,
    hasToday: mainDays.some(isToday) || openDays.some(isToday),
    fut: !!sym.fut,
  }
  // every recorded session date on any book read (an OI-only log can be younger than the others)
  const known = [...new Set([...mainDays, ...openDays, ...volDays].map((d) => d.date))].sort()
  const b0: BasisModel | null = basis
  out.shiftAt = (ts: number) => {
    if (!sym.fut) return 0
    if (!b0) return null
    const v = b0.days.get(etDateKey(ts)) ?? b0.basis
    return isPlausibleBasis(v, b0.max) ? v : null
  }
  if (s.basis !== 'oivol') {
    // the chosen book's gaps (header of ladderFrame): the ladder of the two newest
    // recorded sessions and today's (the ladder's retention)
    const dates = [...new Set(known.concat(today))].sort().slice(-2)
    const reads = await Promise.all(dates.map((d) => loadSessionColumns(wallsSymbol, d, fresh).catch(() => [] as GexColumn[])))
    out.ladders = new Map(dates.map((d, k) => [d, reads[k]!]))
  }
  if (sym.fut) {
    // OVERNIGHT = THE RAIL (2026-10-06, Brandon: "path bubbles should line up with
    // the gex rail"): the nights after the two newest recorded sessions read the
    // next expiry's per-minute ladder, as the rail does (older nights are past the
    // ladder's retention and keep the closing walls)
    const dates = known.slice(-2)
    const reads = await Promise.all(dates.map((d) => loadNextExpiryColumns(wallsSymbol, d, fresh).catch(() => [] as GexColumn[])))
    out.nights = new Map(dates.map((d, k) => [d, reads[k]!]))
  }
  return out
}

// ── One frame per candle ─────────────────────────────────────────────────────

const abs = (w: Write | null | undefined) => (w?.gex != null && Number.isFinite(w.gex) ? Math.abs(w.gex) : null)

/**
 * One candle's frame off a per-minute ladder (overnight, the next expiry's; in
 * session, where the volume book has no CORE yet): the newest column by the
 * candle's end, Volt / Coil / Reversal by the Voltick definition on the chosen
 * book's GEX (vtFromLadder; volume only until 2026-10-07, now the page's GEX
 * switch), Surge the biggest VOLUME GEX whatever the book, every strike moved by
 * the rail's basis. null: no column yet, or no basis.
 */
function ladderFrame(
  night: readonly GexColumn[],
  bar: OHLCV,
  tfMs: number,
  shiftAt: WallModels['shiftAt'],
  book: GexBasis = 'vol',
): VtFrame | null {
  const col = columnAt(night, bar.time + tfMs - 1)
  if (!col || !col.cells.length) return null
  const shift = shiftAt ? shiftAt(col.slotTs) : null
  if (shift == null) return null
  let spot = col.spot
  if (!(spot > 0)) {
    // legacy rows carry no spot: the middle of the ladder, as the rail does
    const ks = col.cells.map((c) => c.strike)
    spot = (Math.max(...ks) + Math.min(...ks)) / 2
  }
  const def = vtFromLadder(col.cells.map((c) => ({ strike: c.strike, net: ladderValue(c.net, c.netVol, book) })), spot)
  if (def.volt == null) return null
  const surge = voltickMarks(col.cells.map((c) => ({ strike: c.strike, book: c.netVol, vol: c.netVol })), { always: true }).surge
  const sizeOf = (k: number | null) => {
    if (k == null) return null
    const c = col.cells.find((x) => x.strike === k)
    return c ? Math.abs(ladderValue(c.net, c.netVol, book)) : null
  }
  // the Surge is the volume book's, so its size is too
  const surgeSize = surge == null ? null : (() => {
    const c = col.cells.find((x) => x.strike === surge)
    return c ? Math.abs(c.netVol) : null
  })()
  const sh = (k: number | null) => (k == null ? null : k + shift)
  return {
    t: Math.floor(bar.time / 1000),
    volt: sh(def.volt),
    surge: sh(surge),
    rev: sh(def.reversal),
    gates: def.coil != null ? [def.coil + shift] : [],
    sz: { volt: sizeOf(def.volt), surge: surgeSize, rev: sizeOf(def.reversal), gates: def.coil != null ? [sizeOf(def.coil)] : [] },
  }
}

/** The walls in force for each candle, as Voltick frames (one per candle). */
export function framesFromWalls(bars: readonly OHLCV[], tfMs: number, m: WallModels): VtFrame[] {
  const byDate = new Map(m.main.map((d) => [d.date, d]))
  const volByDate = new Map(m.vol.map((d) => [d.date, d]))
  const openByDate = new Map((m.open ?? []).map((d) => [d.date, d]))
  const coarse = tfMs >= DAY_MS
  // OVERNIGHT ON A FUTURE: the recorded sessions, oldest first, to find the one
  // whose closing walls an overnight candle carries
  const dates = [...new Set([...byDate.keys(), ...openByDate.keys(), ...volByDate.keys()])].sort()
  const latestBefore = (key: string, inclusive: boolean): string | undefined => {
    let hit: string | undefined
    for (const d of dates) {
      if (inclusive ? d <= key : d < key) hit = d
      else break
    }
    return hit
  }
  const out: VtFrame[] = []
  for (const bar of bars) {
    let date: string | undefined
    let close: number | undefined
    if (coarse) {
      // the newest recorded session inside this bar, at its close
      for (let t = bar.time; t < bar.time + tfMs; t += DAY_MS) {
        const k = etDateKey(t + 12 * 3_600_000)
        const d = byDate.get(k) ?? openByDate.get(k)
        if (d) {
          date = k
          close = d.close
        }
      }
      if (date == null || close == null) continue
    } else {
      const mins = etMinutesOfDay(bar.time)
      const inRth = mins >= SESSION_FROM_MIN && mins < RTH_CLOSE_MIN
      if (inRth) date = etDateKey(bar.time)
      else if (m.fut) {
        // OVERNIGHT (2026-10-06, Brandon: "path bubbles should work and show
        // overnight on ES using SPX"). The SPX walls are recorded 09:29–16:00
        // only; outside it a future's candle carries the walls the last cash
        // session CLOSED on — after 16:00 that day's, before 09:29 the session
        // before (Friday's through the weekend), shifted by that session's basis
        // as every ES / NQ wall is (buildDays).
        date = latestBefore(etDateKey(bar.time), mins >= RTH_CLOSE_MIN)
        // …and where the next expiry's ladder was recorded that night, its levels
        // instead: the gamma the GEX Rail shows at that minute
        const night = date != null ? m.nights?.get(date) : undefined
        const f = night?.length ? ladderFrame(night, bar, tfMs, m.shiftAt, m.basis) : null
        if (f) {
          out.push(f)
          continue
        }
      } else continue
      if (date == null) continue
      close = (byDate.get(date) ?? openByDate.get(date) ?? volByDate.get(date))?.close
      if (close == null) continue
    }
    // an overnight candle (after that session's close) reads the walls at the close
    const end = coarse ? close + 1 : Math.min(bar.time + tfMs, close + 1)
    // The chosen map's walls in force; on Vol only, before the volume book's
    // first CORE write that session, the OI + Vol walls stand in (header).
    let day = byDate.get(date)
    let cb = day ? heldAt(day.levels.get('cb'), end) : null
    if (!cb && !coarse) {
      // the volume book has no CORE yet: the volume GEX of that minute's ladder
      const lad = m.ladders?.get(date)
      const f = lad?.length ? ladderFrame(lad, bar, tfMs, m.shiftAt, m.basis) : null
      if (f) {
        out.push(f)
        continue
      }
    }
    if (!cb) {
      day = openByDate.get(date)
      cb = day ? heldAt(day.levels.get('cb'), end) : null
    }
    if (!day || !cb) continue
    const cw = heldAt(day.levels.get('call_wall'), end)
    const pw = heldAt(day.levels.get('put_wall'), end)
    const vt = vtFromWalls(cb.strike, cw?.strike, pw?.strike, bar.close)
    // which recorded rows the Coil and the Reversal are (for their sizes)
    const rowOf = (k: number | null) => (k == null ? null : k === cw?.strike ? cw : k === pw?.strike ? pw : null)
    const coilW = rowOf(vt.coil)
    const revW = rowOf(vt.reversal)
    const volDay = volByDate.get(day.date)
    const surgeW = volDay ? heldAt(volDay.levels.get('cb'), end) : null
    out.push({
      t: Math.floor(bar.time / 1000),
      volt: cb.strike,
      surge: surgeW?.strike ?? null,
      rev: vt.reversal,
      gates: vt.coil != null ? [vt.coil] : [],
      sz: {
        volt: abs(cb),
        surge: abs(surgeW),
        rev: abs(revW),
        gates: vt.coil != null ? [abs(coilW)] : [],
      },
    })
  }
  return out
}

// ── The fold onto the candles (Voltick HeatChart.jsx `pathRows`) ────────────

/** Bars in SECONDS with their close — the candles' clock, as Voltick reads them. */
export interface SecBar {
  time: number
  close: number
}

interface Role {
  role: PathRole
  lead: boolean
  pathOnly: boolean
  of: (f: VtFrame, t: number) => number | null | undefined
  sz: (f: VtFrame, t: number) => number | null | undefined
}

export function buildPathRows(frames: readonly VtFrame[], bars: readonly SecBar[]): PathRow[] | null {
  if (!frames.length || !bars.length) return null
  const span = bars.length > 1 ? Math.max(60, bars[bars.length - 1]!.time - bars[bars.length - 2]!.time) : 86400
  const byBar = new Map<number, VtFrame>()
  let bi = 0
  for (const f of frames) {
    const sec = f?.t
    if (!Number.isFinite(sec)) continue
    while (bi + 1 < bars.length && bars[bi + 1]!.time <= sec) bi++
    if (sec < bars[0]!.time) continue
    if (sec >= bars[bi]!.time + span * 2) continue
    const key = bars[bi]!.time
    const held = byBar.get(key)
    byBar.set(key, f.sz == null && held?.sz ? { ...f, sz: held.sz, szGates: held.szGates || held.gates } : f)
  }
  if (!byBar.size) return null

  const closeAt = new Map(bars.map((b) => [b.time, b.close]))
  const coilAt = (f: VtFrame, t: number) => {
    const gs = Array.isArray(f.gates) ? f.gates : []
    const px = closeAt.get(t)
    let best = -1
    for (let i = 0; i < gs.length; i++) {
      const g = gs[i]!
      if (!Number.isFinite(g) || g <= 0) continue
      if (best < 0 || (px != null && Number.isFinite(px) && Math.abs(g - px) < Math.abs(gs[best]! - px))) best = i
    }
    return best
  }
  const ROLES: Role[] = [
    { role: 'volt', lead: true, pathOnly: false, of: (f) => f.volt, sz: (f) => f.sz?.volt },
    { role: 'surge', lead: false, pathOnly: false, of: (f) => f.surge, sz: (f) => f.sz?.surge },
    { role: 'reversal', lead: false, pathOnly: false, of: (f) => f.rev, sz: (f) => f.sz?.rev },
    {
      role: 'coil',
      lead: false,
      // CB Edge: the Coil rides the Ribbon too (Voltick keeps it to Path only)
      pathOnly: false,
      of: (f, t) => {
        const i = coilAt(f, t)
        return i < 0 ? null : f.gates[i]
      },
      sz: (f, t) => {
        const i = coilAt(f, t)
        if (i < 0) return null
        const j = (f.szGates || f.gates).indexOf(f.gates[i]!)
        return j < 0 ? null : f.sz?.gates?.[j]
      },
    },
  ]
  const out: PathRow[] = []
  for (const r of ROLES) {
    const pts: PathPt[] = []
    for (const [t, f] of byBar) {
      const v = r.of(f, t)
      if (v != null && Number.isFinite(v) && v > 0) pts.push({ t, p: v, v: r.sz(f, t) })
    }
    if (pts.length) out.push({ role: r.role, pts: holdSizes(pts, span), lead: r.lead, pathOnly: r.pathOnly, fill: [] })
  }
  if (!out.length) return null
  const fills = pathFill(out, bars, span)
  for (const r of out) r.fill = fills.get(r.role) ?? []
  return out
}
