// ─────────────────────────────────────────────────────────────────────────────
// ALIGN — the model behind /scanner?tab=align.
//
// "When do the nearest expirations' walls all sit on the SAME strike, a few
// strikes away from spot?" The AMZN read that started it: on the open, every
// later expiry had its biggest GEX strike at 260 while 0DTE still sat at 255 —
// and then 0DTE rolled up to 260 too. That roll is the event this tab exists to
// catch.
//
// Everything here is pure: (recorded walls, settings) in, verdicts out. The tab
// fetches and paints; nothing in this file knows about React or the network.
//
// FIVE THINGS THAT ARE NOT OBVIOUS
//
//   1. 0DTE IS THE TRIGGER, NOT A VOTE (by default). The shared wall `k` is
//      picked from the LATER expiries only. 0DTE joining it is what moves a
//      ticker from PENDING to LOCKED. With `zeroTrigger` off, 0DTE votes like
//      the rest and there is no PENDING state.
//   2. THE EXPIRIES ARE WHATEVER THE RECORDER KEEPS. strike_growth stores the
//      front STRIKE_GROWTH_EXPIRIES (3 by default) per ticker, so "the next
//      3–5" is 3 until that env var — and the live feed's
//      STRIKE_GROWTH_FEED_EXPIRIES — are raised. Nothing here assumes 3; `need()`
//      scales with however many arrive.
//   3. "FRONT" IS NOT ALWAYS 0DTE. A root with no same-day listing has a front
//      expiry days out. `frontIsZeroDte` says which, and the UI labels it.
//   4. DOMINANCE IS A CURRENT-ONLY FILTER. The server sends the runner-up's size
//      for the latest sweep only (history is run-length encoded strikes), so the
//      dominance threshold filters what the board SHOWS, never the timeline.
//   5. HOLD IS A DEBOUNCE ON HISTORY. A state run shorter than `holdMin` is
//      folded into the run before it — except the live one, which is always
//      shown so a fresh lock is never hidden while it proves itself.
// ─────────────────────────────────────────────────────────────────────────────

export type AlignMode = 'abs' | 'pos' | 'neg'
export type AlignState = 'LOCKED' | 'PENDING' | 'FORMING' | 'SCATTERED'

/** One expiry's wall as the server sends it. `segs` = [tMs, strike] at every move. */
export interface AlignWallRaw {
  expiry: string
  strike: number | null
  net: number
  next: number
  segs: Array<[number, number]>
}

export interface AlignSymbolRaw {
  symbol: string
  t: number
  spot: number
  step: number
  expiries: string[]
  walls: AlignWallRaw[]
}

export interface AlignResponse {
  ok?: boolean
  error?: string
  date?: string
  stale?: boolean
  mode?: AlignMode
  asOf?: number
  symbols?: AlignSymbolRaw[]
}

export interface AlignSettings {
  mode: AlignMode
  /** Strikes of slack when comparing two walls. 0 = exact. */
  tol: 0 | 1
  /** Minimum distance from spot to the shared wall, in strikes. */
  minDist: number
  /** Minimum wall ÷ runner-up across the aligned expiries. 1 = off. */
  minDom: number
  /** Debounce for the history, in minutes (the recorder sweeps once a minute). */
  holdMin: number
  zeroTrigger: boolean
}

export const DEFAULT_SETTINGS: AlignSettings = {
  mode: 'abs',
  tol: 0,
  minDist: 1,
  minDom: 1,
  holdMin: 3,
  zeroTrigger: true,
}

export const STATE_RANK: Record<AlignState, number> = { LOCKED: 0, PENDING: 1, FORMING: 2, SCATTERED: 3 }

export const STATE_LABEL: Record<AlignState, string> = {
  LOCKED: 'LOCKED',
  PENDING: '0DTE PENDING',
  FORMING: 'FORMING',
  SCATTERED: 'SCATTERED',
}

// ── Requests ─────────────────────────────────────────────────────────────────

export const alignUrl = (mode: AlignMode): string => `/proxy/strike-growth/align?mode=${mode}`

export const framesUrl = (symbol: string, date: string | null): string =>
  `/proxy/strike-growth/frames-by-expiry?symbol=${encodeURIComponent(symbol)}${
    date ? `&date=${encodeURIComponent(date)}` : ''
  }`

/** The recorder sweeps once a minute; polling faster only re-reads the cache. */
export const ALIGN_POLL_MS = 60_000

// ── The verdict ──────────────────────────────────────────────────────────────

export interface Verdict {
  state: AlignState
  /** The shared wall, or null when nothing lines up. */
  k: number | null
  /** Per expiry: is its wall on `k`? */
  on: boolean[]
  /** Voting expiries on `k`, and how many could vote. */
  votesOn: number
  votes: number
  /** Is the front expiry on `k`? */
  frontOn: boolean
  /** Every expiry on `k`, front included. */
  total: number
}

/** How many voters must agree. Two voters: both. More: all but one. */
export function need(voters: number): number {
  return voters <= 2 ? voters : voters - 1
}

function near(a: number | null | undefined, b: number | null | undefined, tolAbs: number): boolean {
  if (a == null || b == null) return false
  return Math.abs(a - b) <= tolAbs
}

/** Absolute slack for a strike comparison. A hair over, so float strikes match. */
export function tolAbs(step: number, tol: 0 | 1): number {
  const s = step > 0 ? step : 0
  return tol * s + Math.max(1e-6, s * 0.01)
}

/**
 * Score one snapshot of walls (index 0 = front). `nets` breaks ties toward the
 * heavier candidate; it may be omitted (history replay has strikes only).
 */
export function evaluate(
  walls: ReadonlyArray<number | null>,
  step: number,
  settings: Pick<AlignSettings, 'tol' | 'zeroTrigger'>,
  nets?: ReadonlyArray<number>,
): Verdict {
  const n = walls.length
  const slack = tolAbs(step, settings.tol)
  const voterIdx: number[] = []
  for (let i = settings.zeroTrigger ? 1 : 0; i < n; i++) voterIdx.push(i)
  const front = walls[0] ?? null

  let best: { k: number; count: number; frontOn: boolean; weight: number } | null = null
  for (const vi of voterIdx) {
    const c = walls[vi]
    if (c == null) continue
    let count = 0
    let weight = 0
    for (const vj of voterIdx) {
      if (near(walls[vj], c, slack)) {
        count++
        weight += Math.abs(nets?.[vj] ?? 0)
      }
    }
    const frontOn = near(front, c, slack)
    const better =
      !best ||
      count > best.count ||
      (count === best.count && frontOn && !best.frontOn) ||
      (count === best.count && frontOn === best.frontOn && weight > best.weight) ||
      (count === best.count && frontOn === best.frontOn && weight === best.weight && c < best.k)
    if (better) best = { k: c, count, frontOn, weight }
  }

  const empty: Verdict = {
    state: 'SCATTERED',
    k: null,
    on: walls.map(() => false),
    votesOn: 0,
    votes: voterIdx.length,
    frontOn: false,
    total: 0,
  }
  if (!best || n < 2) return empty

  const k = best.k
  const on = walls.map((w) => near(w, k, slack))
  const total = on.filter(Boolean).length
  const frontOn = on[0] ?? false
  const votesOn = best.count
  const votes = voterIdx.length
  const req = need(votes)

  let state: AlignState
  if (settings.zeroTrigger) {
    if (votesOn >= req && votesOn >= 1 && frontOn) state = 'LOCKED'
    else if (votesOn >= req && votesOn >= 1) state = 'PENDING'
    else if (total >= 2) state = 'FORMING'
    else state = 'SCATTERED'
  } else if (votesOn >= req && votes >= 2) state = 'LOCKED'
  else if (total >= 2) state = 'FORMING'
  else state = 'SCATTERED'

  if (state === 'SCATTERED') return { ...empty, k: null }
  return { state, k, on, votesOn, votes, frontOn, total }
}

// ── The timeline ─────────────────────────────────────────────────────────────

export interface Run {
  start: number
  end: number
  state: AlignState
  k: number | null
  /** The walls at the start of the run — what the transition looked like. */
  walls: Array<number | null>
}

function sameK(a: number | null, b: number | null): boolean {
  return a === b || (a != null && b != null && Math.abs(a - b) < 1e-9)
}

/** The wall of every expiry at every minute it moved, as one walk. */
export function wallSteps(sym: AlignSymbolRaw): Array<{ t: number; walls: Array<number | null> }> {
  const times = new Set<number>()
  for (const w of sym.walls) for (const s of w.segs) times.add(s[0])
  const sorted = [...times].sort((a, b) => a - b)
  const ptr = sym.walls.map(() => -1)
  const out: Array<{ t: number; walls: Array<number | null> }> = []
  for (const t of sorted) {
    const walls = sym.walls.map((w, i) => {
      let p = ptr[i] ?? -1
      while (p + 1 < w.segs.length && (w.segs[p + 1]?.[0] ?? Infinity) <= t) p++
      ptr[i] = p
      return p >= 0 ? (w.segs[p]?.[1] ?? null) : null
    })
    out.push({ t, walls })
  }
  return out
}

export function timeline(sym: AlignSymbolRaw, settings: AlignSettings, endT: number): Run[] {
  const steps = wallSteps(sym)
  const raw: Run[] = []
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    if (!s) continue
    const v = evaluate(s.walls, sym.step, settings)
    const prev = raw[raw.length - 1]
    if (prev && prev.state === v.state && sameK(prev.k, v.k)) continue
    if (prev) prev.end = s.t
    raw.push({ start: s.t, end: endT, state: v.state, k: v.k, walls: s.walls })
  }
  const holdMs = Math.max(0, settings.holdMin) * 60_000
  const out: Run[] = []
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i]
    if (!r) continue
    const isLast = i === raw.length - 1
    const last = out[out.length - 1]
    if (!isLast && last && r.end - r.start < holdMs) {
      last.end = r.end
      continue
    }
    if (last && last.state === r.state && sameK(last.k, r.k)) {
      last.end = r.end
      continue
    }
    out.push({ ...r })
  }
  return out
}

// ── Events (the tape) ────────────────────────────────────────────────────────

export type AlignEventKind = 'LOCK' | 'PENDING' | 'FORMING' | 'BREAK'

export interface AlignEvent {
  t: number
  symbol: string
  kind: AlignEventKind
  text: string
}

export function frontLabel(sym: AlignSymbolRaw, date: string | undefined): string {
  return frontIsZeroDte(sym, date) ? '0DTE' : 'front'
}

export function frontIsZeroDte(sym: AlignSymbolRaw, date: string | undefined): boolean {
  return !!date && sym.expiries[0] === date
}

export function eventsFor(sym: AlignSymbolRaw, runs: Run[], date: string | undefined, tol: 0 | 1): AlignEvent[] {
  const fl = frontLabel(sym, date)
  const slack = tolAbs(sym.step, tol)
  const out: AlignEvent[] = []
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]
    if (!r) continue
    const prev = runs[i - 1]
    const ps: AlignState = prev?.state ?? 'SCATTERED'
    const k = r.k != null ? fmtStrike(r.k) : ''
    const frontNow = r.walls[0] != null ? fmtStrike(r.walls[0]) : '—'
    const n = r.walls.length
    const onCount = r.walls.filter((w) => near(w, r.k, slack)).length
    const push = (kind: AlignEventKind, text: string) => out.push({ t: r.start, symbol: sym.symbol, kind, text })

    if (r.state === 'LOCKED') {
      if (ps === 'PENDING' && prev && sameK(prev.k, r.k)) push('LOCK', `${fl} joined ${k} · ${onCount} of ${n} on ${k}`)
      else if (ps === 'LOCKED') push('LOCK', `lock moved ${prev?.k != null ? fmtStrike(prev.k) : '—'} → ${k}`)
      else push('LOCK', `locked on ${k} · ${onCount} of ${n}`)
    } else if (r.state === 'PENDING') {
      if (ps === 'LOCKED' && prev && sameK(prev.k, r.k)) push('BREAK', `${fl} left ${k} → ${frontNow} · back months still on ${k}`)
      else push('PENDING', `later expiries on ${k} · ${fl} at ${frontNow}`)
    } else if (r.state === 'FORMING') {
      if (ps === 'LOCKED' || ps === 'PENDING') push('BREAK', `${prev?.k != null ? fmtStrike(prev.k) : ''} lost · ${onCount} of ${n} now on ${k}`)
      else push('FORMING', `${onCount} of ${n} walls on ${k}`)
    } else if (ps === 'LOCKED' || ps === 'PENDING') {
      push('BREAK', `${prev?.k != null ? fmtStrike(prev.k) : ''} broke up`)
    }
  }
  return out
}

// ── Rows (the board) ─────────────────────────────────────────────────────────

export interface AlignRow {
  sym: AlignSymbolRaw
  symbol: string
  spot: number
  step: number
  walls: Array<number | null>
  verdict: Verdict
  /** Signed strikes from spot to k. */
  distStrikes: number | null
  distPct: number | null
  /** Σ net of the expiries on k. */
  wallGex: number
  /** min(wall ÷ runner-up) across the expiries on k. */
  dom: number | null
  /** When the current state began (ms). */
  since: number
  runs: Run[]
  events: AlignEvent[]
  /** Distance and dominance filters both pass. */
  passes: boolean
  frontIsZeroDte: boolean
}

export function buildRow(sym: AlignSymbolRaw, settings: AlignSettings, date: string | undefined, now: number): AlignRow {
  const walls = sym.walls.map((w) => w.strike)
  const nets = sym.walls.map((w) => w.net)
  const verdict = evaluate(walls, sym.step, settings, nets)
  const runs = timeline(sym, settings, now)
  const lastRun = runs[runs.length - 1]
  const since =
    lastRun && lastRun.state === verdict.state && sameK(lastRun.k, verdict.k) ? lastRun.start : sym.t || now

  let distStrikes: number | null = null
  let distPct: number | null = null
  let wallGex = 0
  let dom: number | null = null
  if (verdict.k != null && sym.spot > 0) {
    distPct = (verdict.k - sym.spot) / sym.spot
    distStrikes = sym.step > 0 ? Math.round((verdict.k - sym.spot) / sym.step) : null
    sym.walls.forEach((w, i) => {
      if (!verdict.on[i]) return
      wallGex += w.net
      const d = w.next > 0 ? Math.abs(w.net) / w.next : null
      if (d != null) dom = dom == null ? d : Math.min(dom, d)
    })
  }
  const distOk = distStrikes == null ? verdict.k == null : Math.abs(distStrikes) >= settings.minDist
  const domOk = settings.minDom <= 1 || (dom != null && dom >= settings.minDom)

  return {
    sym,
    symbol: sym.symbol,
    spot: sym.spot,
    step: sym.step,
    walls,
    verdict,
    distStrikes,
    distPct,
    wallGex,
    dom,
    since,
    runs,
    events: eventsFor(sym, runs, date, settings.tol),
    passes: verdict.state === 'SCATTERED' ? true : distOk && domOk,
    frontIsZeroDte: frontIsZeroDte(sym, date),
  }
}

export function sortRows(rows: AlignRow[]): AlignRow[] {
  return [...rows].sort(
    (a, b) =>
      STATE_RANK[a.verdict.state] - STATE_RANK[b.verdict.state] ||
      b.verdict.total - a.verdict.total ||
      Math.abs(b.wallGex) - Math.abs(a.wallGex) ||
      (a.symbol < b.symbol ? -1 : 1),
  )
}

// ── The drill-in: per-minute walls from the chain replay ─────────────────────

export interface ReplayResponse {
  ok?: boolean
  error?: string
  expiries?: unknown[]
  frames?: Array<{ ts: string; spot: number; cells?: Array<[number, number, number, number]> }>
}

export interface ReplaySeries {
  expiries: string[]
  t: number[]
  spot: number[]
  /** [expiryIdx][frameIdx] */
  walls: Array<Array<number | null>>
  nets: Array<Array<number>>
}

/**
 * One wall per expiry per recorded minute, by the same rule the server uses for
 * the board (mode, ties to the lower strike). `keep` pins the expiry set to the
 * board's, so an expiry that rolled off mid-session does not grow a column.
 */
export function parseReplay(resp: ReplayResponse | undefined, mode: AlignMode, keep?: string[]): ReplaySeries {
  const all = Array.isArray(resp?.expiries) ? resp.expiries.map(String) : []
  const expiries = (keep && keep.length ? keep.filter((e) => all.includes(e)) : [...all].sort()).slice(0, 6)
  const idxOf = new Map<number, number>()
  all.forEach((e, i) => {
    const j = expiries.indexOf(e)
    if (j >= 0) idxOf.set(i, j)
  })
  const score = (n: number) => (mode === 'pos' ? n : mode === 'neg' ? -n : Math.abs(n))
  const ok = (n: number) => (mode === 'pos' ? n > 0 : mode === 'neg' ? n < 0 : n !== 0)

  const out: ReplaySeries = {
    expiries,
    t: [],
    spot: [],
    walls: expiries.map(() => []),
    nets: expiries.map(() => []),
  }
  for (const f of resp?.frames ?? []) {
    const t = Date.parse(String(f.ts))
    if (!Number.isFinite(t)) continue
    const best: Array<{ s: number; strike: number; net: number } | null> = expiries.map(() => null)
    for (const c of f.cells ?? []) {
      const j = idxOf.get(Number(c[0]))
      if (j == null) continue
      const strike = Number(c[1])
      const net = Number(c[2]) || 0
      if (!Number.isFinite(strike) || !ok(net)) continue
      const s = score(net)
      const cur = best[j]
      if (!cur || s > cur.s || (s === cur.s && strike < cur.strike)) best[j] = { s, strike, net }
    }
    out.t.push(t)
    out.spot.push(Number(f.spot) || 0)
    best.forEach((b, j) => {
      out.walls[j]?.push(b ? b.strike : null)
      out.nets[j]?.push(b ? b.net : 0)
    })
  }
  return out
}

export interface Join {
  expiry: string
  /** When it arrived on k and stayed, or null if it is not on k now. */
  t: number | null
  from: number | null
  now: number | null
}

/** For each expiry: when its wall last moved ONTO `k` and stayed there. */
export function joinOrder(series: ReplaySeries, k: number | null, step: number, tol: 0 | 1): Join[] {
  const slack = tolAbs(step, tol)
  return series.expiries.map((expiry, j) => {
    const w = series.walls[j] ?? []
    const nowW = w[w.length - 1] ?? null
    if (k == null || !near(nowW, k, slack)) return { expiry, t: null, from: null, now: nowW }
    let i = w.length - 1
    while (i > 0 && near(w[i - 1], k, slack)) i--
    let from: number | null = null
    for (let p = i - 1; p >= 0; p--) {
      const v = w[p]
      if (v != null) {
        from = v
        break
      }
    }
    return { expiry, t: series.t[i] ?? null, from, now: nowW }
  })
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** 260, 257.5, 188.25 — no trailing zeros. */
export function fmtStrike(n: number): string {
  return String(Math.round(n * 100) / 100)
}

const ET_HM = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: '2-digit',
  hour12: false,
})

export function fmtEt(ms: number): string {
  return ET_HM.format(new Date(ms))
}

export function fmtHeld(ms: number): string {
  if (!(ms > 0)) return '<1m'
  const m = Math.floor(ms / 60_000)
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/** "Fri 10-09" from "2026-10-09". */
export function fmtExpiry(e: string): string {
  const d = new Date(`${e}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return e
  const wd = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
  return `${wd} ${e.slice(5)}`
}
