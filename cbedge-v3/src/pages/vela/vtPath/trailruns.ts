// ─────────────────────────────────────────────────────────────────────────────
// VOLTICK PATH ARITHMETIC — transcribed, not redesigned.
//
// A TypeScript port of the pure helpers behind Voltick's two trail shapes,
// Path (bubbles) and Path Ribbon, from the Voltick repo at 2026.10.02.5:
//
//   web/src/trailruns.js   strikeRuns … thinPathLanes (only what the two shapes call)
//   web/src/trailheat.js   growthHeat
//   web/src/heatscale.js   heatT, HEAT_FLOOR
//
// Every constant, curve and rule is Voltick's, line for line. The founder tuned
// these on live boards over many rounds (RELEASES.md tells that story); the
// point of this file is that a Path on a Vela chart reads exactly like a Path on
// voltick.io. Do NOT retune a number here without retuning it in Voltick first.
//
// Times are SECONDS (Voltick's candle clock), as in the original — the CARRY,
// hole and hold windows below are seconds too.
// ─────────────────────────────────────────────────────────────────────────────

/** One reading of a level: time (s), strike, size. */
export interface PathPt {
  t: number
  p: number
  v: number | null | undefined
}

// ── heatscale.js ─────────────────────────────────────────────────────────────

export const HEAT_FLOOR = 0.35
export const HEAT_KNEE = 0.84
const OVER = Math.log(1 / HEAT_FLOOR)

export function heatT(v: number, ref: number): number {
  if (!ref || !Number.isFinite(ref) || ref <= 0) return 0
  const r = Math.abs(Number(v) || 0) / ref
  if (!Number.isFinite(r)) return 0
  if (r <= 1) return Math.sqrt(r) * HEAT_KNEE
  return Math.min(1, HEAT_KNEE + (1 - HEAT_KNEE) * (Math.log(r) / OVER))
}

// ── trailheat.js ─────────────────────────────────────────────────────────────

const GROW_FLOOR = 0.014
const GROW_FULL = 0.055
const ATTACK = 0.62
const RELEASE_DOWN = 0.8
const RELEASE_FLAT = 0.91
const LOOKBACK = 3

export function growthHeat(values: ReadonlyArray<number | null | undefined>): Float32Array {
  const n = values ? values.length : 0
  const out = new Float32Array(n)
  let h = 0
  const at = (i: number) => Math.max(0, Number(values[i]) || 0)
  for (let i = 0; i < n; i++) {
    let ref = 0
    let m = 0
    for (let j = Math.max(0, i - LOOKBACK); j < i; j++) {
      ref += at(j)
      m++
    }
    const v = at(i)
    ref = m ? ref / m : v
    const rise = (v - ref) / Math.max(ref, 1e-9)
    const drive = Math.min(1, Math.max(0, (rise - GROW_FLOOR) / (GROW_FULL - GROW_FLOOR)))
    if (drive > h) h += (drive - h) * ATTACK
    else h *= rise < -0.004 ? RELEASE_DOWN : RELEASE_FLAT
    out[i] = h
  }
  return out
}

// ── runs ─────────────────────────────────────────────────────────────────────

/** Split a row into runs of one strike. */
export function strikeRuns<T extends { p: number }>(pts: readonly T[]): T[][] {
  if (!Array.isArray(pts) || !pts.length) return []
  const runs: T[][] = []
  let cur: T[] = [pts[0]!]
  for (let i = 1; i < pts.length; i++) {
    if (pts[i]!.p !== cur[cur.length - 1]!.p) {
      runs.push(cur)
      cur = []
    }
    cur.push(pts[i]!)
  }
  runs.push(cur)
  return runs
}

/** Fold runs shorter than `floor` readings into a neighbour's strike (the dwell rule). */
export function absorbRuns<T extends { p: number; y?: number }>(runs: T[][], floor: number): T[][] {
  if (!Array.isArray(runs) || runs.length < 2 || !(floor > 1)) return runs
  let r = runs.map((x) => x.slice())
  for (let pass = 0; pass < runs.length + 2; pass++) {
    if (r.length < 2) break
    let k = -1
    for (let i = 0; i < r.length; i++) if (r[i]!.length < floor && (k < 0 || r[i]!.length < r[k]!.length)) k = i
    if (k < 0) break
    const L = k > 0 ? r[k - 1]! : null
    const R = k + 1 < r.length ? r[k + 1]! : null
    const into = !L ? k + 1 : !R ? k - 1 : R.length >= L.length ? k + 1 : k - 1
    const host = r[into]![0]!
    const moved = r[k]!.map((q) => ({ ...q, p: host.p, y: host.y }) as T)
    r[into] = into > k ? moved.concat(r[into]!) : r[into]!.concat(moved)
    r.splice(k, 1)
    for (let i = 0; i + 1 < r.length; ) {
      const a = r[i]!
      const b = r[i + 1]!
      if (a[a.length - 1]!.p === b[0]!.p) {
        r[i] = a.concat(b)
        r.splice(i + 1, 1)
      } else i++
    }
  }
  return r
}

export function smoothSeries(vals: readonly number[], win: number): number[] {
  if (!Array.isArray(vals)) return []
  if (!(win > 1) || vals.length < 3) return vals.slice()
  const w = win >> 1
  return vals.map((_, i) => {
    let a = 0
    let n = 0
    for (let j = Math.max(0, i - w); j <= Math.min(vals.length - 1, i + w); j++) {
      a += vals[j]!
      n++
    }
    return n ? a / n : 0
  })
}

// ── Path Ribbon geometry ─────────────────────────────────────────────────────

/** A point of a ribbon run on screen (built by the ribbon draw). */
export interface BandQ {
  x: number
  y: number
  p: number
  t: number
  /** Index among this row's on-screen points — what "follows" is judged by. */
  i: number
  lit: number
  v: number | null | undefined
  k: number
  /** Half-height of the band at this point. */
  h: number
  /** Growth glow (ribbonRowFacts.g). */
  g: number
}

export interface BandSample {
  x: number
  top: number
  bot: number
  /** Hop fade weight 0..1. */
  w: number
  q: BandQ
}

export function fadeBand(
  run: BandQ[],
  o: { half: number; ov: number; hopIn: boolean; hopOut: boolean; xStart?: number; xEnd?: number; taperPx: number },
): { S: BandSample[]; x0: number; x1: number; first: BandQ; last: BandQ } | null {
  if (!Array.isArray(run) || !run.length) return null
  const a = run[0]!
  const b = run[run.length - 1]!
  const hf = Math.max(0, Number(o.half) || 0)
  const ov = Math.max(0, Number(o.ov) || 0)
  const x0 = o.hopIn ? a.x - hf - ov : Number.isFinite(o.xStart) ? Math.min(a.x, o.xStart!) : a.x - hf
  const x1 = o.hopOut ? b.x + hf + ov : Number.isFinite(o.xEnd) ? Math.max(b.x, o.xEnd!) : b.x + hf
  const TIP_H = 0.12
  const tp = o.taperPx > 0 ? Math.min((x1 - x0) / 2, o.taperPx) : 0
  const ss = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
  const fw = (x: number) => {
    let w = 1
    if (o.hopIn) w = Math.min(w, ss((x - x0) / (ov + hf)))
    if (o.hopOut) w = Math.min(w, ss((x1 - x) / (ov + hf)))
    return w
  }
  const taper = (x: number) => {
    if (!(tp > 0)) return 1
    let e = 1
    if (!o.hopIn) {
      const t = Math.min(1, Math.max(0, (x - x0) / tp))
      e = Math.min(e, TIP_H + (1 - TIP_H) * Math.sin((t * Math.PI) / 2))
    }
    if (!o.hopOut) {
      const t = Math.min(1, Math.max(0, (x1 - x) / tp))
      e = Math.min(e, TIP_H + (1 - TIP_H) * Math.sin((t * Math.PI) / 2))
    }
    return e
  }
  const S: BandSample[] = []
  const put = (x: number, q: BandQ) => {
    const e = taper(x)
    S.push({ x, top: q.y - q.h * e, bot: q.y + q.h * e, w: fw(x), q })
  }
  put(x0, a)
  if (o.hopIn) for (let u = 1; u < 6; u++) put(x0 + ((a.x - x0) * u) / 6, a)
  for (const q of run) put(q.x, q)
  if (o.hopOut) for (let u = 1; u < 6; u++) put(b.x + ((x1 - b.x) * u) / 6, b)
  put(x1, b)
  return { S, x0, x1, first: a, last: b }
}

export function runFollows(A: BandQ[] | undefined, B: BandQ[] | undefined, holeSec: number): boolean {
  return (
    !!A?.length && !!B?.length && B[0]!.i === A[A.length - 1]!.i + 1 && B[0]!.t - A[A.length - 1]!.t <= holeSec
  )
}

export function ribbonHops(runs: BandQ[][], ri: number, holeSec: number): { hopIn: boolean; hopOut: boolean } {
  const run = runs[ri]!
  const prev = runs[ri - 1]
  const next = runs[ri + 1]
  return {
    hopIn: runFollows(prev, run, holeSec) && prev![prev!.length - 1]!.p !== run[0]!.p,
    hopOut: runFollows(run, next, holeSec) && next![0]!.p !== run[run.length - 1]!.p,
  }
}

export const RIBBON_GLOW = {
  law: 'stretch',
  lo: 0.1,
  curve: 1.25,
  floor: 0.03,
  fadeMin: 130,
  fillLift: 1.9,
  bankFloor: 0.5,
  growBack: 10,
  growGain: 2.4,
  growMin: 0.45,
  growMax: 1.7,
  ceiling: 0.55,
  labelReads: 8,
  dotWithinSec: 20 * 60,
} as const

type Glow = typeof RIBBON_GLOW

export interface RibbonRow {
  pts: PathPt[]
  pathOnly?: boolean
}

/** Per-session size law for the ribbon's thickness (the stretched law). */
export function ribbonSizeScale(
  rows: readonly RibbonRow[],
  partsOf: (tSec: number) => { day: string; mins: number },
  capFromMin = 15 * 60,
  opt: Glow | null = null,
): { sizeK: (p: PathPt) => number } {
  const clock = new Map<number, { day: string; mins: number }>()
  const at = (t: number) => {
    let c = clock.get(t)
    if (!c) clock.set(t, (c = partsOf(t)))
    return c
  }
  const pre = new Map<string, number[]>()
  const all = new Map<string, number[]>()
  const capDay = new Map<string, number>()
  const refDay = new Map<string, number>()
  const loDay = new Map<string, number>()
  const stretch = opt?.law === 'stretch'
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r?.pathOnly) continue
    for (const p of Array.isArray(r?.pts) ? r.pts : []) {
      const v = Number(p?.v)
      if (p?.v == null || !Number.isFinite(v) || v <= 0) continue
      const { day, mins } = at(p.t)
      ;(all.get(day) || all.set(day, []).get(day)!).push(v)
      if (mins < capFromMin) (pre.get(day) || pre.set(day, []).get(day)!).push(v)
    }
  }
  for (const [day, vs] of all) {
    const pv = pre.get(day)
    const cap = pv?.length ? Math.max(...pv) : Math.max(...vs)
    const capped = vs.map((v) => Math.min(v, cap)).sort((a, b) => a - b)
    const p90 = capped[Math.min(capped.length - 1, Math.floor(capped.length * 0.9))]!
    capDay.set(day, cap)
    refDay.set(day, Math.max(p90, HEAT_FLOOR * cap))
    if (stretch && opt)
      loDay.set(day, Math.min(capped[Math.min(capped.length - 1, Math.floor(capped.length * opt.lo))]!, cap * 0.9))
  }
  const sizeK = (p: PathPt) => {
    const v = Number(p?.v)
    if (p?.v == null || !Number.isFinite(v) || v <= 0) return 0.5
    const { day } = at(p.t)
    const cap = capDay.get(day)
    const ref = refDay.get(day)
    if (!cap || !ref) return 0.5
    if (stretch && opt) {
      const lo = loDay.get(day) ?? 0
      const u = cap > lo ? Math.min(1, Math.max(0, (Math.min(v, cap) - lo) / (cap - lo))) : 1
      return Math.min(1, Math.max(opt.floor, Math.pow(u, opt.curve)))
    }
    return heatT(Math.min(v, cap), ref)
  }
  return { sizeK }
}

export function ribbonGrowth(ks: readonly number[], Z: Glow = RIBBON_GLOW): number[] {
  const k = Array.isArray(ks) ? ks : []
  return k.map((v, j) => {
    const L = Math.min(Z.growBack, j)
    const d = L ? (Number(v) || 0) - (Number(k[j - L]) || 0) : 0
    return Math.min(Z.growMax, Math.max(Z.growMin, 1 + Z.growGain * d))
  })
}

export function ribbonInk(ageSec: number, Z: Glow = RIBBON_GLOW): { fill: number; bank: number } {
  const f = Math.exp(-Math.max(0, Number(ageSec) || 0) / 60 / Z.fadeMin)
  return { fill: 1 + Z.fillLift * f, bank: Z.bankFloor + (1 - Z.bankFloor) * f }
}

interface FactQ {
  t: number
  p: number
  v: number | null | undefined
  k: number
}

export interface RibbonChange {
  ratio: number
  since: number
  text: string
}

export function ribbonChange(run: readonly FactQ[], Z: Glow = RIBBON_GLOW): RibbonChange | null {
  if (!Array.isArray(run) || run.length < Z.labelReads) return null
  const ok = (q: FactQ | undefined) => Number.isFinite(Number(q?.v)) && Number(q!.v) > 0
  const a = run.find(ok)
  const b = [...run].reverse().find(ok)
  if (!a || !b || a === b) return null
  const r = Number(b.v) / Number(a.v)
  if (Math.round((r - 1) * 100) === 0) return null
  return {
    ratio: r,
    since: a.t,
    text:
      r >= 3
        ? `▲×${r >= 10 ? r.toFixed(0) : r.toFixed(1)}`
        : `${r >= 1 ? '▲' : '▼'}${Math.abs(Math.round((r - 1) * 100))}%`,
  }
}

export interface RowFacts {
  g: Map<number, number>
  end: Map<number, RibbonChange | null>
}

export function ribbonRowFacts(
  pts: readonly PathPt[],
  sizeK: (p: PathPt) => number,
  { dwell = 3, smooth = 3, Z = RIBBON_GLOW }: { dwell?: number; smooth?: number; Z?: Glow } = {},
): RowFacts {
  const list = Array.isArray(pts) ? pts : []
  const gaps: number[] = []
  for (let j = 1; j < list.length; j++) gaps.push(list[j]!.t - list[j - 1]!.t)
  gaps.sort((a, b) => a - b)
  const holeSec = Math.max(20 * 60, 4 * (gaps.length ? gaps[gaps.length >> 1]! : 0))
  const runs: FactQ[][] = []
  let chunk: FactQ[] = []
  for (const p of list) {
    const k = Number(sizeK(p))
    const q: FactQ = { t: p.t, p: p.p, v: p.v, k: Number.isFinite(k) ? Math.min(1, Math.max(0, k)) : 0.5 }
    if (chunk.length && q.t - chunk[chunk.length - 1]!.t > holeSec) {
      runs.push(...absorbRuns(strikeRuns(chunk), dwell))
      chunk = []
    }
    chunk.push(q)
  }
  if (chunk.length) runs.push(...absorbRuns(strikeRuns(chunk), dwell))
  const g = new Map<number, number>()
  const end = new Map<number, RibbonChange | null>()
  for (const run of runs) {
    const glow = ribbonGrowth(smoothSeries(run.map((q) => q.k), smooth), Z)
    run.forEach((q, j) => g.set(q.t, glow[j]!))
    end.set(run[run.length - 1]!.t, ribbonChange(run, Z))
  }
  return { g, end }
}

export interface LabelCand {
  w: number
  h: number
  at: Array<{ x: number; y: number }>
}

export function placeRibbonLabels<C extends LabelCand>(
  cands: readonly C[],
  boxes: ReadonlyArray<readonly number[]>,
  width: number,
  height = Infinity,
): Array<C & { x: number; y: number }> {
  const taken = (Array.isArray(boxes) ? boxes : []).slice()
  const out: Array<C & { x: number; y: number }> = []
  const hit = (a: readonly number[]) =>
    taken.some((b) => a[0]! < b[2]! && a[2]! > b[0]! && a[1]! < b[3]! && a[3]! > b[1]!)
  for (const c of Array.isArray(cands) ? cands : []) {
    for (const s of c.at) {
      const box = [s.x - 1, s.y - c.h / 2, s.x + c.w + 1, s.y + c.h / 2]
      if (!(s.x >= 0) || !(box[1]! >= 0) || box[2]! > width || box[3]! > height || hit(box)) continue
      taken.push(box)
      out.push({ ...c, x: s.x, y: s.y })
      break
    }
  }
  return out
}

export interface GoldSpan {
  t0: number
  t1: number
  tNext: number | null
  p: number
  x0: number
  x1: number
}

export function stretchEnd(
  runs: BandQ[][],
  ri: number,
  holeSec: number,
  half: number,
  toGold?: Map<BandQ[], number> | null,
  spans?: GoldSpan[] | null,
): number | undefined {
  const run = runs[ri]!
  const next = runs[ri + 1]
  const tail = run[run.length - 1]!
  const follows = runFollows(run, next, holeSec)
  let at = follows ? next![0]!.x - half : toGold?.has(run) ? toGold.get(run)! - half : undefined
  if (at != null && spans) for (const w of spans) if (w.p === tail.p && w.x0 > tail.x && w.x0 - half < at) at = w.x0 - half
  return at == null ? undefined : Math.max(tail.x, at)
}

export function goldSpans(runs: BandQ[][], holeSec: number, half: number): GoldSpan[] {
  const out: GoldSpan[] = []
  for (let ri = 0; ri < runs.length; ri++) {
    const run = runs[ri]!
    if (!run.length) continue
    const tail = run[run.length - 1]!
    const nx = runs[ri + 1]
    const x1 = stretchEnd(runs, ri, holeSec, half)
    out.push({
      t0: run[0]!.t,
      t1: tail.t,
      tNext: x1 != null && nx?.length ? nx[0]!.t : null,
      p: run[0]!.p,
      x0: run[0]!.x,
      x1: x1 ?? tail.x + half,
    })
  }
  return out
}

export function goldAt(spans: GoldSpan[] | null, q: BandQ): GoldSpan | null {
  return spans
    ? spans.find((w) => q.p === w.p && q.t >= w.t0 && (q.t <= w.t1 || (w.tNext != null && q.t < w.tNext))) || null
    : null
}

/** Cut a non-Volt row where it runs onto the Volt's strike (the gold owns that stretch). */
export function cutAtGold(
  whole: BandQ[][],
  spans: GoldSpan[] | null,
  holeSec: number,
): { runs: BandQ[][]; toGold: Map<BandQ[], number>; fromGold: Map<BandQ, number> } {
  const runs: BandQ[][] = []
  const toGold = new Map<BandQ[], number>()
  const fromGold = new Map<BandQ, number>()
  let hit: { q: BandQ; w: GoldSpan } | null = null
  for (const run of whole) {
    let cur: BandQ[] = []
    for (const q of run) {
      const w = goldAt(spans, q)
      if (w) {
        if (cur.length) {
          runs.push(cur)
          toGold.set(cur, w.x0)
        } else if (runs.length && !hit) {
          const pv = runs[runs.length - 1]!
          const tl = pv[pv.length - 1]!
          if (!toGold.has(pv) && tl.i === q.i - 1 && q.t - tl.t <= holeSec) toGold.set(pv, q.x)
        }
        cur = []
        hit = { q, w }
      } else {
        if (!cur.length && hit && hit.q.p === q.p && hit.q.i === q.i - 1 && q.t - hit.q.t <= holeSec)
          fromGold.set(q, Math.max(hit.q.x, hit.w.x1))
        hit = null
        cur.push(q)
      }
    }
    if (cur.length) runs.push(cur)
  }
  return { runs, toGold, fromGold }
}

// ── Path (bubbles) ───────────────────────────────────────────────────────────

export type PathRole = 'volt' | 'reversal' | 'coil' | 'surge'

export const PATH_PRIORITY: PathRole[] = ['volt', 'reversal', 'coil', 'surge']

export interface FillPt {
  t: number
  p: number
  v: number | null | undefined
}

/**
 * ONE POINT PER LEVEL PER CANDLE, ONE LEVEL PER STRIKE. A candle with no reading
 * carries the last one forward for at most CARRY seconds and never across a
 * session gap; a lower level on a strike a higher one already holds that candle
 * is left out (Volt, Reversal, Coil, Surge).
 */
export function pathFill(
  rows: ReadonlyArray<{ role: PathRole; pts: PathPt[] }>,
  bars: ReadonlyArray<{ time: number }>,
  span: number,
  priority: PathRole[] = PATH_PRIORITY,
): Map<PathRole, FillPt[]> {
  const fills = new Map<PathRole, FillPt[]>()
  if (!rows?.length || !bars?.length) return fills
  const CARRY = Math.max(2 * span, 420)
  const byRole = new Map<PathRole, Map<number, PathPt>>()
  let t0 = Infinity
  for (const r of rows) {
    fills.set(r.role, [])
    if (!Array.isArray(r.pts) || !r.pts.length) continue
    byRole.set(r.role, new Map(r.pts.map((q) => [q.t, q])))
    if (r.pts[0]!.t < t0) t0 = r.pts[0]!.t
  }
  const cur = new Map<PathRole, FillPt>()
  for (let i = 0; i < bars.length; i++) {
    const t = bars[i]!.time
    if (t < t0) continue
    if (i > 0 && t - bars[i - 1]!.time > span * 2) cur.clear()
    const taken = new Set<number>()
    for (const role of priority) {
      const seen = byRole.get(role)
      if (!seen) continue
      const q = seen.get(t)
      if (q) cur.set(role, { t, p: q.p, v: q.v })
      const c = cur.get(role)
      if (!c || t - c.t > CARRY) continue
      if (taken.has(c.p)) continue
      taken.add(c.p)
      fills.get(role)!.push({ t, p: c.p, v: c.v })
    }
  }
  return fills
}

/** A reading with no size of its own keeps the level's last one (for up to an hour). */
export function holdSizes(pts: PathPt[], span: number): PathPt[] {
  if (!Array.isArray(pts)) return []
  const SIZE_HOLD = Math.max(3 * span, 3600)
  let lastV: number | null = null
  let lastT = -Infinity
  return pts.map((q) => {
    if (Number.isFinite(q?.v)) {
      lastV = q.v as number
      lastT = q.t
      return q
    }
    return lastV != null && q.t - lastT <= SIZE_HOLD ? { ...q, v: lastV } : q
  })
}

export const PATH_SIZE = { spread: 0.75, curve: 0.75, minPx: 2, smooth: 3 }

export function pathSizes(fill: readonly FillPt[], pts: readonly PathPt[], flatSpan: number, S = PATH_SIZE): number[] {
  if (!Array.isArray(fill) || !fill.length) return []
  let plo = Infinity
  let phi = 0
  for (const p of Array.isArray(pts) ? pts : []) {
    const v = p?.v
    if (Number.isFinite(v) && (v as number) > 0) {
      if ((v as number) < plo) plo = v as number
      if ((v as number) > phi) phi = v as number
    }
  }
  const sized = phi > 0 && plo < Infinity
  const pMoved = sized && (phi - plo) / phi >= flatSpan
  const ks = fill.map((q) => {
    const v = q?.v
    if (!pMoved || !Number.isFinite(v)) return 0.5
    return Math.min(1, Math.max(0, (Math.max(0, v as number) - plo) / (phi - plo)))
  })
  const gaps: number[] = []
  for (let i = 1; i < fill.length; i++) {
    const d = fill[i]!.t - fill[i - 1]!.t
    if (d > 0) gaps.push(d)
  }
  gaps.sort((a, b) => a - b)
  const step = gaps.length ? gaps[gaps.length >> 1]! : Infinity
  const out: number[] = []
  for (let s0 = 0, i = 1; i <= ks.length; i++) {
    if (i < ks.length && !(fill[i]!.t - fill[i - 1]!.t > step * 1.5)) continue
    for (const k of smoothSeries(ks.slice(s0, i), S.smooth)) out.push(k)
    s0 = i
  }
  return out
}

export function pathRadius(k: number | undefined, rad: number, S = PATH_SIZE): number {
  const kk = Number.isFinite(k) ? Math.min(1, Math.max(0, k as number)) : 0.5
  const f = 1 + S.spread * (Math.pow(kk, S.curve) - Math.pow(0.5, S.curve))
  return Math.max(Math.min(S.minPx, rad), rad * f)
}

export const PATH_ZOOM = {
  refBar: 6,
  peerPx: 3.72,
  voltPx: 5.4,
  follow: 0.25,
  minPx: 1.8,
  maxPx: 6.5,
  peerMaxPx: 4.5,
  maxOverlap: 0.6,
  gapFit: 0.35,
}

export function pathZoomRadius(barSpacing: number, lead: boolean, Z = PATH_ZOOM): number {
  const bs = Number.isFinite(barSpacing) && barSpacing > 0 ? barSpacing : Z.refBar
  if (bs >= Z.refBar)
    return Math.max(Z.minPx, Math.min(lead ? Z.maxPx : Z.peerMaxPx, (bs * (lead ? Z.voltPx : Z.peerPx)) / Z.refBar))
  const r = (lead ? Z.voltPx : Z.peerPx) * Math.pow(bs / Z.refBar, Z.follow)
  return Math.max(Z.minPx, Math.min(Z.maxPx, r))
}

export function pathGrowthMax(S = PATH_SIZE): number {
  return 1 + S.spread * (1 - Math.pow(0.5, S.curve))
}

export function pathGapFit(gapPx: number, maxR: number, minR = 0, Z = PATH_ZOOM): number {
  if (!(gapPx > 0) || !Number.isFinite(gapPx) || !(maxR > 0)) return 1
  const cap = gapPx / (2 * (1 - Math.min(0.95, Math.max(0, Z.gapFit))))
  let f = maxR > cap ? cap / maxR : 1
  if (minR > 0) f = Math.max(f, Z.minPx / minR)
  return Math.min(1, f)
}

const PATH_RANK: Record<PathRole, number> = { volt: 0, reversal: 1, coil: 2, surge: 3 }

export function pathStepOf(radMax: number, barSpacing: number, span: number, Z = PATH_ZOOM): number {
  const steps =
    span <= 60
      ? [1, 2, 3, 5, 10, 15, 30, 60, 120, 240]
      : span <= 300
        ? [1, 2, 3, 6, 12, 24, 48, 96]
        : [1, 2, 4, 8, 16, 32, 64, 128]
  const T = Math.min(0.95, Math.max(0, Z.maxOverlap))
  const bs = barSpacing > 0 ? barSpacing : Z.refBar
  const raw = (2 * radMax * (1 - T)) / bs
  return steps.find((n) => n >= raw) || Math.ceil(raw)
}

export interface ThinRow {
  role: PathRole
  fill: FillPt[]
  rad: number
  r: number[]
}

/** Which candles draw once a strike row's bubbles would overlap (by candle number, so a pan never changes it). */
export function thinPathLanes(
  rows: readonly ThinRow[],
  barSpacing: number,
  spanIn: number | null = null,
  Z = PATH_ZOOM,
  S = PATH_SIZE,
): Set<string> {
  const keep = new Set<string>()
  if (!Array.isArray(rows) || !rows.length) return keep
  let span = spanIn
  if (!(span != null && span > 0)) {
    const gaps: number[] = []
    for (const row of rows) {
      const f = row.fill || []
      for (let i = 1; i < f.length; i++) {
        const d = f[i]!.t - f[i - 1]!.t
        if (d > 0) gaps.push(d)
      }
    }
    gaps.sort((a, b) => a - b)
    span = gaps.length ? gaps[gaps.length >> 1]! : 60
  }
  const bs = barSpacing > 0 ? barSpacing : Z.refBar
  const T = Math.min(0.95, Math.max(0, Z.maxOverlap))
  const grow = pathGrowthMax(S)
  interface Entry {
    key: string
    role: PathRole
    idx: number
    imp: number
    N: number
    r: number
  }
  const lanes = new Map<number, Entry[]>()
  for (const row of rows) {
    const f = Array.isArray(row.fill) ? row.fill : []
    if (!f.length) continue
    const N = pathStepOf(row.rad * grow, bs, span, Z)
    let s0 = 0
    for (let i = 1; i <= f.length; i++) {
      if (i < f.length && f[i]!.p === f[i - 1]!.p && f[i]!.t - f[i - 1]!.t <= span * 1.5) continue
      const len = i - s0
      for (let j = s0; j < i; j++) {
        const idx = Math.round(f[j]!.t / span)
        const imp = j === s0 ? 2 : j === i - 1 && len >= 2 * N ? 1 : 0
        if (!(imp > 0 || idx % N === 0)) continue
        const r = Array.isArray(row.r) && Number.isFinite(row.r[j]) ? row.r[j]! : row.rad
        const e: Entry = { key: row.role + '|' + f[j]!.t, role: row.role, idx, imp, N, r }
        let L = lanes.get(f[j]!.p)
        if (!L) lanes.set(f[j]!.p, (L = []))
        L.push(e)
      }
      s0 = i
    }
  }
  const rank = (e: Entry) => PATH_RANK[e.role] ?? 9
  const better = (a: Entry, b: Entry) => a.imp > b.imp || (a.imp === b.imp && a.imp > 0 && rank(a) < rank(b))
  const clash = (a: Entry, b: Entry) => {
    const d = Math.abs(a.idx - b.idx)
    return d < Math.max(a.N, b.N) || d * bs < (a.r + b.r) * (1 - T)
  }
  for (const L of lanes.values()) {
    L.sort((a, b) => a.idx - b.idx || b.imp - a.imp || rank(a) - rank(b))
    const kept: Entry[] = []
    for (const e of L) {
      while (kept.length && clash(kept[kept.length - 1]!, e) && better(e, kept[kept.length - 1]!)) kept.pop()
      if (kept.length && clash(kept[kept.length - 1]!, e)) continue
      kept.push(e)
    }
    for (const e of kept) keep.add(e.key)
  }
  return keep
}
