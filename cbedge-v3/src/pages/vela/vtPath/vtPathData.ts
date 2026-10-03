// ─────────────────────────────────────────────────────────────────────────────
// VOLTICK PATH — THE DATA. Where each Voltick level was, candle by candle.
//
// Voltick's Path reads /api/history?levels=1 — its recorder's frames, each one
// { t, volt, surge, rev, gates[], sz } — and folds them onto the chart's candles
// (HeatChart.jsx `pathRows`). CB Edge has no such route, but it has the thing
// those frames are made OF: the per-minute GEX ladder the GEX Candles card
// draws its bubbles from (/api/snapshots/option-strike-gex-history, front
// expiry, one column a minute). So each column becomes one frame here:
//
//   volt / surge / rev / gates   voltickMarks() — the CB Edge port of Voltick's
//                                marksOf(), the same one GEX Candles' Voltick
//                                theme and the ladder use, `always` on (one
//                                bubble per level per candle, which is what the
//                                founder asked Path for on 2026-09-28)
//   sz                           |GEX| at that level's strike on the chosen map —
//                                Voltick's history.js sizesOf(), same rule
//
// The fold onto the candles is Voltick's pathRows, transcribed: the last frame
// in a candle wins (keeping the latest sizes recorded in it), a frame more than
// two bars past its candle belongs to nobody, Volt / Surge / Reversal rows plus
// the Coil on Path only (the coil nearest that candle's close), sizes held
// across unsized readings, then pathFill — one point per level per candle, one
// level per strike.
//
// ── Sessions ─────────────────────────────────────────────────────────────────
// One request per session DATE on the route's date branch (`minutes=0&date=`
// with `expiryFallback=1`, the replay URL — it resolves that day's own front
// expiry). The dates are the newest weekdays the chart's own candles cover, so a
// weekend or a holiday never costs a request. A settled day is read once; today
// is re-read once a minute while a live chart is open in session and visible.
//
// ── Futures ──────────────────────────────────────────────────────────────────
// ES / NQ draw SPX's / NDX's levels pushed into futures prices by that session's
// basis (board/gexCandles/basis.ts), like the walls. A column with no plausible
// basis is dropped — an unshifted index strike on a futures chart is a level one
// basis below where it belongs.
// ─────────────────────────────────────────────────────────────────────────────

import { gexHistoryDayUrl, parseGexHistory, type GexColumn } from '@/board/gexCandles/gexHistory'
import { BUBBLE_LADDER_REQUEST } from '@/board/gexCandles/settings'
import { symbolDef } from '@/board/gexCandles/symbols'
import { basisFor, isPlausibleBasis, type BasisModel } from '@/board/gexCandles/basis'
import { etDateKey } from '@/board/gexCandles/candles'
import { voltickMarks } from '@/data/voltickLevels'
import { resolveSym } from '@/pages/vela/cbedgeProvider'
import { loadBasis } from '@/pages/vela/wallsIndicator'
import { holdSizes, pathFill, type FillPt, type PathPt, type PathRole } from './trailruns'

/** Which GEX the levels and sizes are read off. */
export type VtMap = 'book' | 'vol'

/** One recorded reading — Voltick's level frame. Times in SECONDS. */
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

// ── Reads (shared by every chart and both shapes) ───────────────────────────

const SHARED_MS = 55_000
interface Read {
  at: number
  p: Promise<GexColumn[]>
}
const reads = new Map<string, Read>()

function readDay(gexSymbol: string, date: string, today: boolean, fresh: boolean): Promise<GexColumn[]> {
  // The date doubles as the expiry guess (0DTE); expiryFallback=1 corrects it
  // to whatever that session actually recorded under.
  const url = gexHistoryDayUrl(gexSymbol, date, date, BUBBLE_LADDER_REQUEST)
  const hit = reads.get(url)
  if (hit && (!today || !fresh || Date.now() - hit.at < SHARED_MS)) return hit.p
  const p = fetch(url, { cache: 'no-store', credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => parseGexHistory(j))
    .catch(() => [] as GexColumn[])
  reads.set(url, { at: Date.now(), p })
  return p
}

const ET_WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' })

/** The newest `n` weekday ET dates the bars cover (bars in ms). */
export function sessionDates(barsMs: readonly number[], n: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (let i = barsMs.length - 1; i >= 0 && out.length < n; i--) {
    const t = barsMs[i]!
    const d = etDateKey(t)
    if (seen.has(d)) continue
    seen.add(d)
    const wd = ET_WEEKDAY.format(new Date(`${d}T12:00:00Z`))
    if (wd === 'Sat' || wd === 'Sun') continue
    out.push(d)
  }
  return out
}

export interface LoadResult {
  frames: VtFrame[]
  /** True when the newest date asked for is today — the read that keeps moving. */
  hasToday: boolean
}

/** Frames for the chart symbol over `dates`. [] when the symbol has no recorded ladder. */
export async function loadFrames(chartSymbol: string, dates: string[], map: VtMap, fresh: boolean): Promise<LoadResult> {
  const sym = resolveSym(chartSymbol.replace(/^[^:]*:/, ''))
  const gexSymbol = symbolDef(sym.fut === 'NQ' ? 'NDX' : sym.fut === 'ES' ? 'SPX' : sym.key).gexSymbol
  const today = etDateKey(Date.now())
  const [cols, basis] = await Promise.all([
    Promise.all(dates.map((d) => readDay(gexSymbol, d, d === today, fresh))),
    sym.fut ? loadBasis(sym.fut) : Promise.resolve(null),
  ])
  const all = cols.flat().sort((a, b) => a.slotTs - b.slotTs)
  return { frames: framesOf(basis ? shifted(all, basis) : all, map), hasToday: dates.includes(today) }
}

/** Futures price space; a column with no plausible basis for its session is dropped. */
function shifted(cols: GexColumn[], basis: BasisModel): GexColumn[] {
  const out: GexColumn[] = []
  for (const c of cols) {
    const b = basisFor(basis, c.slotTs)
    if (!isPlausibleBasis(b, basis.max)) continue
    out.push({
      slotTs: c.slotTs,
      spot: c.spot > 0 ? c.spot + b : c.spot,
      cells: c.cells.map((x) => ({ strike: x.strike + b, net: x.net, netVol: x.netVol })),
    })
  }
  return out
}

/** One frame per column: the four levels, and how big each was. */
function framesOf(cols: GexColumn[], map: VtMap): VtFrame[] {
  const out: VtFrame[] = []
  for (const c of cols) {
    const rows = c.cells.map((x) => ({ strike: x.strike, book: map === 'vol' ? x.netVol : x.net, vol: x.netVol }))
    const vt = voltickMarks(rows, { always: true })
    if (vt.volt == null) continue
    const size = new Map(rows.map((r) => [r.strike, Math.abs(r.book)]))
    const at = (k: number | null) => {
      if (k == null) return null
      const v = size.get(k)
      return v == null || !Number.isFinite(v) ? null : v
    }
    out.push({
      t: Math.floor(c.slotTs / 1000),
      volt: vt.volt,
      surge: vt.surge,
      rev: vt.reversal,
      gates: vt.coils.slice(),
      sz: { volt: at(vt.volt), surge: at(vt.surge), rev: at(vt.reversal), gates: vt.coils.map(at) },
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
      pathOnly: true,
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
