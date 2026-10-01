// ─────────────────────────────────────────────────────────────────────────────
// LEVEL LOG › BACKTEST › FORWARD TEST — the record and the reader behind it.
//
// A backtest answers "would it have worked"; a forward test answers "is it
// working", and the second number is the only one that cannot be curve-fit.
// So: lock a rule set from the backtest at a moment, and from that moment on
// every fill the same engine finds is logged — nothing before the lock, no
// re-tuning after it. Brandon trades it on MES, so every trade is also priced
// in MES (SPX + that session's ES−SPX basis, to the quarter-point tick) and in
// dollars (contracts × $5 a point, less fees, less slippage on market exits).
//
// THE BASIS is /proxy/es-spx-basis and nothing else — our ES 16:00 close minus
// Yahoo's ^GSPC close, per session (server-v2/es-spx-basis.js says why every
// live ES−spot path is poisoned). A session's own close is its basis; today,
// before its close exists, the newest one before it — the basis decays about a
// point a day, so that is the number a trader would have used.
//
// WHY THE TRADES ARE KEPT, NOT RECOMPUTED. The engine is deterministic and the
// recorder has no look-ahead, so a forward session could in principle be
// re-scored on demand forever — except that the 1-minute bars it is scored on
// only live about 30 days. Once a session is COMPLETE (any date before today,
// ET) its trades are frozen into the record with the basis they had, and never
// re-scored. Today's session is scored live, once a minute while the page is
// open, and frozen the next time the page is opened on a later day. A session
// first seen after its bars have aged out is scored on 5-minute samples and
// says so.
//
// WHERE THE RECORD LIVES — the rail store's two tiers (railStore.ts):
//   · localStorage, written on every change, read on the first frame;
//   · /api/level-log-forward, one JSON row per account, so the record follows
//     the login between machines and survives a cleared browser. A 401, a dead
//     DB or an over-size record leave the local copy exactly as it was.
// When both exist for the SAME lock, their frozen sessions are unioned (they
// are the same trades either way) and the newer one wins everything else; a
// different lock → the newer record wins outright.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type Approach,
  type Bar,
  type BtDay,
  type BtEvent,
  type BtParams,
  type TouchMode,
  fetchBacktestDays,
  fetchMinuteBars,
  filterEvents,
  runBacktest,
} from '@/pages/levelLog/bounceEngine'
import { type ExpScope, type GexBasis, todayETStr } from '@/pages/levelLog/wallData'

// ── MES ─────────────────────────────────────────────────────────────────────

/** Micro E-mini S&P: $5 a point, quarter-point ticks. */
export const MES_PER_PT = 5
export const MES_TICK = 0.25

export const toTick = (v: number) => Math.round(v / MES_TICK) * MES_TICK

// ── the record ──────────────────────────────────────────────────────────────

/** The backtest settings a forward test is locked to — keys for display, params for the engine. */
export interface FwdRules {
  symbol: string
  scope: ExpScope
  basis: GexBasis
  entry: string
  frac: string
  stop: string
  hold: string
  approach: Approach
  touches: TouchMode
  params: BtParams
}

/** What the backtest said for these rules at the moment they were locked. */
export interface FwdBaseline {
  sessions: number
  from: string
  to: string
  bars: '1m' | '5m'
  n: number
  ptsPerFill: number | null
  winOfResolved: number | null
  bouncePct: number | null
  avgReward: number | null
  avgRisk: number | null
}

export interface FwdLock {
  /** Epoch ms of the lock, and the same moment as an ET session date + minutes. */
  at: number
  date: string
  mins: number
  rules: FwdRules
  baseline: FwdBaseline | null
}

export interface FwdMes {
  contracts: number
  /** Dollars per contract, round trip, all-in. */
  fees: number
  /** Ticks given up on a market exit (a break or an open trade closed at the hold). */
  slip: number
}

export interface FwdTrade {
  id: string
  date: string
  mins: number
  side: 'support' | 'resistance'
  core: number
  entryPx: number
  target: number
  stopPx: number
  wall: number
  wallKind: 'call' | 'put'
  result: 'bounce' | 'break' | 'open'
  /** Points from the entry, as the engine scores it. */
  exit: number
  exitMins: number
  exitPx: number
  mfe: number
  mae: number
  resolveMin: number | null
  touchNo: number
  /** ES − SPX for the session (see THE BASIS); null when there was none. */
  basis: number | null
  bars: '1m' | '5m'
}

export interface FwdDoc {
  v: 1
  lock: FwdLock | null
  mes: FwdMes
  /** Complete sessions, by ET date — an empty list is a session that had no fill. */
  frozen: Record<string, FwdTrade[]>
  /** Trades Brandon marked as actually taken. */
  taken: Record<string, true>
  updatedAt: number
}

export const MES_DEFAULTS: FwdMes = { contracts: 1, fees: 2, slip: 1 }

export const emptyDoc = (): FwdDoc => ({ v: 1, lock: null, mes: { ...MES_DEFAULTS }, frozen: {}, taken: {}, updatedAt: 0 })

// ── normalizing — anything from storage or the server, made safe ───────────

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const numOr = (v: unknown, d: number) => (isNum(v) ? v : d)
const numOrNull = (v: unknown) => (isNum(v) ? v : null)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function cleanParams(raw: unknown): BtParams | null {
  const p = (raw ?? {}) as Record<string, unknown>
  if (!isNum(p.strike) || !isNum(p.entryPts) || !isNum(p.wallFrac) || !isNum(p.stopStrikes)) return null
  return {
    strike: p.strike,
    entryPts: p.entryPts,
    wallFrac: p.wallFrac,
    stopStrikes: p.stopStrikes,
    holdMin: isNum(p.holdMin) ? p.holdMin : null,
  }
}

function cleanRules(raw: unknown): FwdRules | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const params = cleanParams(r.params)
  if (!params) return null
  const pick = <V extends string>(v: unknown, ok: readonly V[], d: V): V => (ok.includes(v as V) ? (v as V) : d)
  return {
    symbol: typeof r.symbol === 'string' && r.symbol ? r.symbol : 'SPX',
    scope: pick(r.scope, ['0dte', 'agg'], '0dte'),
    basis: pick(r.basis, ['oivol', 'vol'], 'oivol'),
    entry: String(r.entry ?? ''),
    frac: String(r.frac ?? ''),
    stop: String(r.stop ?? ''),
    hold: String(r.hold ?? ''),
    approach: pick(r.approach, ['both', 'support', 'resistance'], 'both'),
    touches: pick(r.touches, ['every', 'first'], 'every'),
    params,
  }
}

function cleanBaseline(raw: unknown): FwdBaseline | null {
  const b = raw as Record<string, unknown> | null
  if (!b || !isNum(b.n)) return null
  return {
    sessions: numOr(b.sessions, 0),
    from: String(b.from ?? ''),
    to: String(b.to ?? ''),
    bars: b.bars === '5m' ? '5m' : '1m',
    n: b.n,
    ptsPerFill: numOrNull(b.ptsPerFill),
    winOfResolved: numOrNull(b.winOfResolved),
    bouncePct: numOrNull(b.bouncePct),
    avgReward: numOrNull(b.avgReward),
    avgRisk: numOrNull(b.avgRisk),
  }
}

function cleanTrade(raw: unknown): FwdTrade | null {
  const t = (raw ?? {}) as Record<string, unknown>
  if (typeof t.id !== 'string' || typeof t.date !== 'string' || !DATE_RE.test(t.date)) return null
  for (const k of ['mins', 'core', 'entryPx', 'target', 'stopPx', 'wall', 'exit', 'exitMins', 'exitPx'] as const) {
    if (!isNum(t[k])) return null
  }
  const result = t.result === 'bounce' || t.result === 'break' ? t.result : 'open'
  return {
    id: t.id,
    date: t.date,
    mins: t.mins as number,
    side: t.side === 'resistance' ? 'resistance' : 'support',
    core: t.core as number,
    entryPx: t.entryPx as number,
    target: t.target as number,
    stopPx: t.stopPx as number,
    wall: t.wall as number,
    wallKind: t.wallKind === 'put' ? 'put' : 'call',
    result,
    exit: t.exit as number,
    exitMins: t.exitMins as number,
    exitPx: t.exitPx as number,
    mfe: numOr(t.mfe, 0),
    mae: numOr(t.mae, 0),
    resolveMin: numOrNull(t.resolveMin),
    touchNo: numOr(t.touchNo, 1),
    basis: numOrNull(t.basis),
    bars: t.bars === '5m' ? '5m' : '1m',
  }
}

/** Total: never throws, never returns something the page cannot draw. */
export function normalizeDoc(raw: unknown): FwdDoc {
  const d = (raw ?? {}) as Record<string, unknown>
  const out = emptyDoc()
  const l = d.lock as Record<string, unknown> | null | undefined
  const rules = l ? cleanRules(l.rules) : null
  if (l && rules && isNum(l.at) && typeof l.date === 'string' && DATE_RE.test(l.date) && isNum(l.mins)) {
    out.lock = { at: l.at, date: l.date, mins: l.mins, rules, baseline: cleanBaseline(l.baseline) }
  }
  const m = (d.mes ?? {}) as Record<string, unknown>
  out.mes = {
    contracts: clamp(Math.round(numOr(m.contracts, MES_DEFAULTS.contracts)), 1, 100),
    fees: clamp(numOr(m.fees, MES_DEFAULTS.fees), 0, 50),
    slip: clamp(Math.round(numOr(m.slip, MES_DEFAULTS.slip)), 0, 3),
  }
  const fz = (d.frozen ?? {}) as Record<string, unknown>
  for (const [date, list] of Object.entries(fz)) {
    if (!DATE_RE.test(date) || !Array.isArray(list)) continue
    out.frozen[date] = list.map(cleanTrade).filter((t): t is FwdTrade => t != null)
  }
  const tk = (d.taken ?? {}) as Record<string, unknown>
  for (const [id, v] of Object.entries(tk)) if (v === true) out.taken[id] = true
  out.updatedAt = numOr(d.updatedAt, 0)
  return out
}

/** Local and account copies → one. See WHERE THE RECORD LIVES in the header. */
export function mergeDocs(a: FwdDoc, b: FwdDoc): FwdDoc {
  const [older, newer] = a.updatedAt <= b.updatedAt ? [a, b] : [b, a]
  if (!older.lock || !newer.lock || older.lock.at !== newer.lock.at) return newer
  return { ...newer, frozen: { ...older.frozen, ...newer.frozen } }
}

// ── persistence ─────────────────────────────────────────────────────────────

const LOCAL_KEY = 'cb-v3-level-log:forward:v1'
const ENDPOINT = '/api/level-log-forward'
const SAVE_DEBOUNCE_MS = 800

function readLocal(): FwdDoc {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    return raw ? normalizeDoc(JSON.parse(raw)) : emptyDoc()
  } catch {
    return emptyDoc()
  }
}

function writeLocal(doc: FwdDoc): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(doc))
  } catch {
    /* best-effort — the in-memory record still drives this session */
  }
}

export interface ForwardStore {
  doc: FwdDoc
  /** Apply a change; stamps `updatedAt` and persists. */
  update: (fn: (d: FwdDoc) => FwdDoc) => void
  /** true once the account copy has answered — or failed to. */
  synced: boolean
  /** Whether the account copy is being written (false = this browser only). */
  account: boolean
}

export function useForwardDoc(): ForwardStore {
  const [doc, setDoc] = useState<FwdDoc>(readLocal)
  const [synced, setSynced] = useState(false)
  const [account, setAccount] = useState(false)
  /** What this browser and the account copy last held, serialized — so neither is rewritten with what it already has. */
  const lastLocal = useRef<string>(JSON.stringify(doc))
  const lastPosted = useRef<string>('')

  useEffect(() => {
    let alive = true
    fetch(ENDPOINT, { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { stored?: boolean; doc?: unknown } | null) => {
        if (!alive) return
        setAccount(j != null)
        if (j?.stored) {
          const server = normalizeDoc(j.doc)
          lastPosted.current = JSON.stringify(server)
          setDoc((local) => mergeDocs(local, server))
        }
        setSynced(true)
      })
      .catch(() => {
        if (alive) setSynced(true)
      })
    return () => {
      alive = false
    }
  }, [])

  // localStorage on every change; the account copy once it has been read (so
  // a first paint never overwrites a newer record from another machine), and
  // never for a record nobody has touched. A RESET is a touch — it has to
  // reach the account, or the next machine would bring the old test back.
  useEffect(() => {
    const json = JSON.stringify(doc)
    if (json !== lastLocal.current) {
      lastLocal.current = json
      writeLocal(doc)
    }
    if (!synced || json === lastPosted.current) return
    if (doc.updatedAt === 0) return
    const id = window.setTimeout(() => {
      lastPosted.current = json
      fetch(ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: `{"doc":${json}}`,
      })
        .then((r) => {
          setAccount(r.ok)
          if (!r.ok) lastPosted.current = ''
        })
        .catch(() => {
          setAccount(false)
          lastPosted.current = ''
        })
    }, SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [doc, synced])

  const update = useCallback((fn: (d: FwdDoc) => FwdDoc) => {
    setDoc((d) => ({ ...fn(d), updatedAt: Date.now() }))
  }, [])

  return { doc, update, synced, account }
}

// ── clock ───────────────────────────────────────────────────────────────────

/** The ET session date and minutes since ET midnight, now. */
export function etNow(): { date: string; mins: number; weekday: boolean } {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  const wd = g('weekday')
  return { date: todayETStr(), mins: Number(g('hour')) * 60 + Number(g('minute')), weekday: wd !== 'Sat' && wd !== 'Sun' }
}

/** The cash session, padded a few minutes either side for the recorder's last write. */
export function inSessionET(): boolean {
  const n = etNow()
  return n.weekday && n.mins >= 9 * 60 + 25 && n.mins <= 16 * 60 + 10
}

const dayMs = 86_400_000
const utcOf = (date: string) => Date.parse(`${date}T00:00:00Z`)
const nextDate = (date: string) => new Date(utcOf(date) + dayMs).toISOString().slice(0, 10)
const calDaysBetween = (a: string, b: string) => Math.round((utcOf(b) - utcOf(a)) / dayMs)

// ── the basis ───────────────────────────────────────────────────────────────

export type BasisBook = { days: Record<string, number>; latest: { basis: number; date: string } | null }

/** /proxy/es-spx-basis — best-effort: an empty book on any failure, and trades keep a null basis. */
async function fetchBasis(signal?: AbortSignal): Promise<BasisBook> {
  const out: BasisBook = { days: {}, latest: null }
  try {
    const r = await fetch('/proxy/es-spx-basis', { cache: 'no-store', credentials: 'same-origin', signal })
    if (!r.ok) return out
    const j = (await r.json()) as { basis?: unknown; date?: unknown; days?: unknown }
    const days = (j.days ?? {}) as Record<string, unknown>
    for (const [d, v] of Object.entries(days)) if (DATE_RE.test(d) && isNum(v) && v > 0 && v < 250) out.days[d] = v
    if (isNum(j.basis) && j.basis > 0 && j.basis < 250 && typeof j.date === 'string') out.latest = { basis: j.basis, date: j.date.slice(0, 10) }
  } catch {
    /* best-effort — see above */
  }
  return out
}

/** The basis for a session: its own close, else the newest close before it. */
export function basisFor(book: BasisBook, date: string): { basis: number; date: string } | null {
  if (book.days[date] != null) return { basis: book.days[date]!, date }
  const prior = Object.keys(book.days)
    .filter((d) => d < date)
    .sort()
    .pop()
  if (prior) return { basis: book.days[prior]!, date: prior }
  return book.latest && book.latest.date <= date ? book.latest : null
}

// ── the reader ──────────────────────────────────────────────────────────────

const r2 = (v: number) => Math.round(v * 100) / 100

function toTrade(e: BtEvent, basis: number | null, bars: '1m' | '5m'): FwdTrade {
  return {
    id: e.id,
    date: e.date,
    mins: e.mins,
    side: e.side,
    core: e.core,
    entryPx: r2(e.entryPx),
    target: r2(e.target),
    stopPx: r2(e.stopPx),
    wall: e.wall,
    wallKind: e.wallKind,
    result: e.result,
    exit: r2(e.exit),
    exitMins: e.exitMins,
    exitPx: r2(e.exitPx),
    mfe: r2(e.mfe),
    mae: r2(e.mae),
    resolveMin: e.resolveMin,
    touchNo: e.touchNo,
    basis: basis == null ? null : r2(basis),
    bars,
  }
}

/** Today's session as the order ticket needs it. */
export interface FwdToday {
  day: BtDay
  /** Every fill today under the locked params, before the lock and the filters — for touch counts and re-arming. */
  all: BtEvent[]
  /** The newest SPX bar. */
  last: Bar | null
  /** The basis the MES prices use today, and the session close it comes from. */
  basis: { basis: number; date: string } | null
}

export interface FwdRead {
  /** Sessions now complete and not yet in the record — freeze these. */
  fresh: Record<string, FwdTrade[]>
  /** Today's fills after the lock, scored live. */
  live: FwdTrade[]
  today: FwdToday | null
}

/**
 * Every session from the lock (or the day after the newest frozen one) to
 * today, scored under the locked rules. Three reads, together: levels +
 * 5-minute spot, the SPX 1-minute bars, and the basis book.
 */
export async function readForward(lock: FwdLock, frozen: Record<string, FwdTrade[]>, signal?: AbortSignal): Promise<FwdRead> {
  const today = todayETStr()
  const empty: FwdRead = { fresh: {}, live: [], today: null }
  if (today < lock.date) return empty
  const done = Object.keys(frozen)
    .filter((d) => d >= lock.date)
    .sort()
  const lastDone = done[done.length - 1]
  const start = lastDone ? nextDate(lastDone) : lock.date
  if (start > today) return empty
  const span = calDaysBetween(start, today) + 1
  const { rules } = lock
  const [raw, minute, book] = await Promise.all([
    fetchBacktestDays(rules.symbol, today, Math.min(260, span), rules.scope, rules.basis, signal),
    fetchMinuteBars(rules.symbol, signal, Math.min(30, span + 1)),
    fetchBasis(signal),
  ])
  const sessions = raw.filter((d) => d.date >= start && d.date <= today && !frozen[d.date])

  const out: FwdRead = { fresh: {}, live: [], today: null }
  for (const d of sessions) {
    const b = minute.get(d.date)
    const has1m = !!b && b.length >= 30
    const day: BtDay = has1m ? { ...d, bars: b, price: b.map((x) => ({ mins: x.mins, px: x.c })) } : d
    const all = runBacktest([day], rules.params).events
    let evs = filterEvents(all, rules.approach, rules.touches)
    if (d.date === lock.date) evs = evs.filter((e) => e.mins >= lock.mins)
    const basis = basisFor(book, d.date)
    const trades = evs.map((e) => toTrade(e, basis?.basis ?? null, has1m ? '1m' : '5m'))
    if (d.date < today) {
      out.fresh[d.date] = trades
    } else {
      out.live = trades
      const last = has1m ? (b![b!.length - 1] ?? null) : null
      out.today = { day, all, last, basis }
    }
  }
  return out
}

// ── money ───────────────────────────────────────────────────────────────────

/** Dollars for one trade at these MES settings: points less slippage on a market exit, × $5 × contracts, less fees. */
export function tradeDollars(t: Pick<FwdTrade, 'exit' | 'result'>, mes: FwdMes): number {
  const slipPts = t.result === 'bounce' ? 0 : mes.slip * MES_TICK
  return ((t.exit - slipPts) * MES_PER_PT - mes.fees) * mes.contracts
}
