// ─────────────────────────────────────────────────────────────────────────────
// VOLTICK PATH — THE DATA. Where each Voltick level was, candle by candle.
//
// ── The levels ARE the walls migration, renamed (2026-10-03, Brandon) ────────
// The same recorded walls_log the Level Log's Wall Migration chart and CB Walls
// read (/api/walls-range — 15-minute slots, kept for months), named the Voltick
// way. This is the wall migration's own Voltick view, vtFromWalls() in
// pages/levelLog/wallData.ts:
//
//   Volt ★      = CORE
//   Coil ◆      = the wall on the SAME side of spot as the CORE
//                 (CORE above spot → the call wall; below → the put wall)
//   Reversal ↘  = the wall on the OTHER side
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
// ─────────────────────────────────────────────────────────────────────────────

import type { OHLCV } from '@luxalgo/vela'
import { RTH_CLOSE_MIN, etDateKey, etMinutesOfDay } from '@/board/gexCandles/candles'
import { vtFromWalls } from '@/pages/levelLog/wallData'
import { resolveSym } from '@/pages/vela/cbedgeProvider'
import {
  SESSION_FROM_MIN,
  buildDays,
  heldAt,
  loadBasis,
  loadWallSlices,
  type DayModel,
  type Write,
} from '@/pages/vela/wallsIndicator'
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
  basis: 'oivol' | 'vol'
  sessions: number
}

export interface WallModels {
  /** The walls on the chosen GEX map — Volt, Coil, Reversal. */
  main: DayModel[]
  /** The volume-only walls — their CORE is the Surge. */
  vol: DayModel[]
  /** The newest session is today's — the read that keeps moving. */
  hasToday: boolean
}

export async function loadWallModels(chartSymbol: string, s: WallRead, fresh: boolean): Promise<WallModels> {
  const sym = resolveSym(chartSymbol.replace(/^[^:]*:/, ''))
  const wallsSymbol = sym.fut === 'NQ' ? 'NDX' : sym.fut === 'ES' ? 'SPX' : sym.key
  const [main, vol, basis] = await Promise.all([
    loadWallSlices(wallsSymbol, s, fresh),
    s.basis === 'vol' ? Promise.resolve(null) : loadWallSlices(wallsSymbol, { ...s, basis: 'vol' }, fresh),
    sym.fut ? loadBasis(sym.fut) : Promise.resolve(null),
  ])
  const mainDays = buildDays(main, basis)
  const volDays = vol ? buildDays(vol, basis) : mainDays
  const today = etDateKey(Date.now())
  return { main: mainDays, vol: volDays, hasToday: mainDays.some((d) => d.date === today) }
}

// ── One frame per candle ─────────────────────────────────────────────────────

const abs = (w: Write | null | undefined) => (w?.gex != null && Number.isFinite(w.gex) ? Math.abs(w.gex) : null)

/** The walls in force for each candle, as Voltick frames (one per candle). */
export function framesFromWalls(bars: readonly OHLCV[], tfMs: number, m: WallModels): VtFrame[] {
  const byDate = new Map(m.main.map((d) => [d.date, d]))
  const volByDate = new Map(m.vol.map((d) => [d.date, d]))
  const coarse = tfMs >= DAY_MS
  const out: VtFrame[] = []
  for (const bar of bars) {
    let day: DayModel | undefined
    let end: number
    if (coarse) {
      // the newest recorded session inside this bar, at its close
      for (let t = bar.time; t < bar.time + tfMs; t += DAY_MS) {
        const d = byDate.get(etDateKey(t + 12 * 3_600_000))
        if (d) day = d
      }
      if (!day) continue
      end = day.close + 1
    } else {
      const mins = etMinutesOfDay(bar.time)
      if (mins < SESSION_FROM_MIN || mins >= RTH_CLOSE_MIN) continue
      day = byDate.get(etDateKey(bar.time))
      if (!day) continue
      end = Math.min(bar.time + tfMs, day.close + 1)
    }
    const cb = heldAt(day.levels.get('cb'), end)
    if (!cb) continue
    const cw = heldAt(day.levels.get('call_wall'), end)
    const pw = heldAt(day.levels.get('put_wall'), end)
    const vt = vtFromWalls(cb.strike, cw?.strike, pw?.strike, bar.close)
    // which recorded rows the Coil and the Reversal are (for their sizes)
    const coreAbove = cb.strike >= bar.close
    const coilW = vt.coil == null ? null : coreAbove ? cw : pw
    const revW = vt.reversal == null ? null : coreAbove ? pw : cw
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
