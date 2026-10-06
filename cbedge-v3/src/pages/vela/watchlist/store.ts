// ─────────────────────────────────────────────────────────────────────────────
// VELA WATCHLIST — the lists, their sync, and the quotes. The panel
// (watchlist/panel.ts) draws what this holds; every panel instance (desktop
// column, phone sheet) reads the same store and hears the same changes.
//
// LISTS   in this browser (localStorage `cb-v3-vela-watchlists`), any number
//         up to MAX_LISTS, each an ordered set of tickers. Signed in, they are
//         merged with the account's copy (/api/page-preset, page
//         `vela-watchlists`, one preset per list `{ n, s, g, o, u }`, a deleted
//         list a tombstone `{ d: 1, u }`) — newest edit wins, per list — so
//         every device has them. Signed out they stay in this browser.
// SECTIONS a list's own named sections, in the order you set (`o`, kept even
//         while empty), and which section each symbol is in (`g`); a symbol in
//         none is Unsorted. A sort orders the symbols INSIDE each section.
//         Which list is open is the workspace's (panel.ts persistence), so a
//         saved layout reopens on its own list.
// QUOTES  /api/quotes-batch (last, change, change %; extended-hours price
//         when pre / post market), every 15 s while a watchlist is on screen.
//         ES / NQ ask for /ES and /NQ. VOLUME, a column that is off by
//         default, is the last 24 hours of the chart tape's 5-minute bars
//         (/api/snapshots/etf-candles; /api/snapshots/candles for the futures), read
//         once a minute per symbol while that column shows. Indexes have none.
// ─────────────────────────────────────────────────────────────────────────────

import { esCandlesUrl, parseCandles, parseEsCandles } from '@/board/gexCandles/candles'
import { TICKER_RE } from '@/board/gexCandles/symbols'
import { readPage, writePreset } from '@/pages/vela/script/library'
import { CbEdgeProvider, resolveSym } from '@/pages/vela/cbedgeProvider'

export interface WatchList {
  id: string
  name: string
  symbols: string[]
  /** Sections: symbol → section name (absent = Unsorted). The docked panel and the Advanced view share them. */
  groups?: Record<string, string>
  /** The sections in display order, empty ones included (a name only in `groups` is appended). */
  sections?: string[]
  /** Last edit (ms) — the merge key. */
  u: number
}

export type SortKey = 'symbol' | 'price' | 'change' | 'pct' | 'volume'
export interface ViewPrefs {
  cols: { price: boolean; change: boolean; pct: boolean; volume: boolean }
  /** One-line rows (the default since 2026-10-05, W2), or ticker over name (W1). */
  compact: boolean
  /** Which defaults this copy has seen (2: the points-change column went off by default). */
  rev?: number
  /** Per list: the column it is sorted by, or none (the list's own order). Applies inside each section. */
  sort: Record<string, { key: SortKey; dir: 1 | -1 } | undefined>
  /** Per list: the docked panel's folded sections. */
  folded?: Record<string, string[]>
}

export interface Quote {
  last: number | null
  change: number | null
  pct: number | null
  volume: number | null
}

const KEY = 'cb-v3-vela-watchlists'
const DELETED_KEY = 'cb-v3-vela-watchlists-deleted'
const PREFS_KEY = 'cb-v3-vela-watchlist-view'
const PAGE = 'vela-watchlists'
export const MAX_LISTS = 10
export const MAX_SYMBOLS = 200
export const MAX_SECTIONS = 20
/** The name a symbol in no section is shown under. Not a section of its own. */
export const UNSORTED = 'Unsorted'
const DEFAULT_SYMBOLS = ['SPX', 'ES', 'NQ', 'SPY', 'QQQ', 'VIX', 'NVDA', 'TSLA', 'AAPL']
const TOMBSTONE_MS = 30 * 86_400_000

const newId = () => `wl${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** A ticker as the lists keep it: upper case, the chart's own key (`/ES` → `ES`). */
export function normTicker(raw: string): string | null {
  const t = raw.trim().toUpperCase().replace(/^[^:]*:/, '')
  if (!t) return null
  const key = resolveSym(t).key
  return TICKER_RE.test(key) ? key : null
}

// ── This browser ──
interface Saved {
  v: 1
  lists: WatchList[]
  active: string
}
function read(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null
    const lists = Array.isArray(raw?.lists)
      ? raw.lists
          .filter((l): l is WatchList => !!l && typeof l.id === 'string' && typeof l.name === 'string' && Array.isArray(l.symbols))
          .map((l) => {
            const symbols = dedupe(l.symbols)
            const groups = cleanGroups(l.groups, symbols)
            return { id: l.id, name: l.name.slice(0, 60), symbols, groups, sections: cleanSections(l.sections, groups), u: Number(l.u) || 0 }
          })
      : []
    if (lists.length) return { v: 1, lists, active: typeof raw?.active === 'string' && lists.some((l) => l.id === raw.active) ? raw.active : lists[0]!.id }
  } catch {
    /* fall through to the default list */
  }
  const first: WatchList = { id: newId(), name: 'Watchlist', symbols: DEFAULT_SYMBOLS.slice(), u: 0 }
  return { v: 1, lists: [first], active: first.id }
}
function cleanGroups(g: unknown, symbols: readonly string[]): Record<string, string> | undefined {
  if (!g || typeof g !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(g as Record<string, unknown>)) {
    if (symbols.includes(k) && typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 40)
  }
  return Object.keys(out).length ? out : undefined
}
/** A section name as the lists keep it (trimmed, 40 characters; never the Unsorted label). */
function sectionName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const n = raw.trim().slice(0, 40)
  return n && n.toLowerCase() !== UNSORTED.toLowerCase() ? n : null
}
function cleanSections(raw: unknown, groups: Record<string, string> | undefined): string[] | undefined {
  const out: string[] = []
  for (const x of Array.isArray(raw) ? raw : []) {
    const n = sectionName(x)
    if (n && !out.includes(n) && out.length < MAX_SECTIONS) out.push(n)
  }
  for (const n of Object.values(groups ?? {})) if (!out.includes(n)) out.push(n)
  return out.length ? out : undefined
}
/** A list's sections, in display order: its own order, then any name only a symbol carries. */
export function sectionsOf(l: WatchList): string[] {
  const out = (l.sections ?? []).slice()
  for (const s of l.symbols) {
    const g = l.groups?.[s]
    if (g && !out.includes(g)) out.push(g)
  }
  return out
}
function dedupe(xs: unknown[]): string[] {
  const out: string[] = []
  for (const x of xs) {
    const t = typeof x === 'string' ? normTicker(x) : null
    if (t && !out.includes(t)) out.push(t)
    if (out.length >= MAX_SYMBOLS) break
  }
  return out
}
function write(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* private mode — this page's life only */
  }
}
function readDeleted(): Record<string, number> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DELETED_KEY) ?? '{}')
    return raw && typeof raw === 'object' ? (raw as Record<string, number>) : {}
  } catch {
    return {}
  }
}
function writeDeleted(d: Record<string, number>): void {
  try {
    localStorage.setItem(DELETED_KEY, JSON.stringify(d))
  } catch {
    /* private mode */
  }
}

let state: Saved = read()
const listeners = new Set<() => void>()
export function onWatchlist(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function changed(sync = true): void {
  write()
  for (const fn of listeners) fn()
  if (sync) scheduleSync()
}

export const lists = (): readonly WatchList[] => state.lists
export const activeList = (): WatchList => state.lists.find((l) => l.id === state.active) ?? state.lists[0]!

/** A list the workspace asked for before the account's lists arrived — opened once they do. */
let pendingActive: string | null = null
export function setActive(id: string): void {
  if (!state.lists.some((l) => l.id === id)) {
    pendingActive = id
    return
  }
  pendingActive = null
  if (id === state.active) return
  state = { ...state, active: id }
  changed(false)
}

function edit(id: string, fn: (l: WatchList) => WatchList): void {
  state = { ...state, lists: state.lists.map((l) => (l.id === id ? { ...fn(l), u: Date.now() } : l)) }
  changed()
}

/** Add a ticker to the open list (false: not a ticker, already there, or the list is full). */
export function addSymbol(raw: string): boolean {
  const t = normTicker(raw)
  const l = activeList()
  if (!t || l.symbols.includes(t) || l.symbols.length >= MAX_SYMBOLS) return false
  edit(l.id, (x) => ({ ...x, symbols: [...x.symbols, t] }))
  return true
}
export function removeSymbol(sym: string): void {
  const l = activeList()
  edit(l.id, (x) => {
    const groups = { ...(x.groups ?? {}) }
    // the section stays (sections live on while empty)
    const sections = sectionsOf(x)
    delete groups[sym]
    return { ...x, symbols: x.symbols.filter((s) => s !== sym), groups: Object.keys(groups).length ? groups : undefined, sections: sections.length ? sections : undefined }
  })
}
/** Put a symbol of the open list in a section (null: take it out of any). A new name becomes a section. */
export function setGroup(sym: string, name: string | null): void {
  const l = activeList()
  if (!l.symbols.includes(sym)) return
  edit(l.id, (x) => withGroup(x, sym, name))
}
function withGroup(x: WatchList, sym: string, name: string | null): WatchList {
  const groups = { ...(x.groups ?? {}) }
  const n = sectionName(name)
  const sections = sectionsOf(x)
  if (n) {
    groups[sym] = n
    if (!sections.includes(n)) sections.push(n)
  } else delete groups[sym]
  return { ...x, groups: Object.keys(groups).length ? groups : undefined, sections: sections.length ? sections : undefined }
}
/**
 * A drag in the docked panel: the symbol lands in `section` (null: Unsorted),
 * and, when the list is not sorted, the list takes `order` (the rows as they now
 * stand). One edit, so one save and one sync.
 */
export function arrange(sym: string, section: string | null, order: string[] | null): void {
  const l = activeList()
  if (!l.symbols.includes(sym)) return
  edit(l.id, (x) => {
    const next = withGroup(x, sym, section)
    if (!order) return next
    const keep = order.filter((s) => x.symbols.includes(s))
    for (const s of x.symbols) if (!keep.includes(s)) keep.push(s)
    return { ...next, symbols: keep }
  })
}
/** A new, empty section at the end of the open list (false: no name, taken, or 20 already). */
export function addSection(raw: string): boolean {
  const n = sectionName(raw)
  const l = activeList()
  const have = sectionsOf(l)
  if (!n || have.includes(n) || have.length >= MAX_SECTIONS) return false
  edit(l.id, (x) => ({ ...x, sections: [...sectionsOf(x), n] }))
  return true
}
/** Rename a section; its symbols go with it (false: no name, or the name is taken). */
export function renameSection(from: string, raw: string): boolean {
  const n = sectionName(raw)
  const l = activeList()
  if (!n || (n !== from && sectionsOf(l).includes(n))) return false
  edit(l.id, (x) => {
    const groups: Record<string, string> = {}
    for (const [s, g] of Object.entries(x.groups ?? {})) groups[s] = g === from ? n : g
    return { ...x, groups: Object.keys(groups).length ? groups : undefined, sections: sectionsOf(x).map((g) => (g === from ? n : g)) }
  })
  return true
}
/** Delete a section; its symbols stay on the list, Unsorted. */
export function removeSection(name: string): void {
  const l = activeList()
  edit(l.id, (x) => {
    const groups: Record<string, string> = {}
    for (const [s, g] of Object.entries(x.groups ?? {})) if (g !== name) groups[s] = g
    const sections = sectionsOf(x).filter((g) => g !== name)
    return { ...x, groups: Object.keys(groups).length ? groups : undefined, sections: sections.length ? sections : undefined }
  })
}
/** Move a section one place up (-1) or down (+1). */
export function moveSection(name: string, dir: -1 | 1): void {
  const l = activeList()
  const order = sectionsOf(l)
  const i = order.indexOf(name)
  const j = i + dir
  if (i < 0 || j < 0 || j >= order.length) return
  ;[order[i], order[j]] = [order[j]!, order[i]!]
  edit(l.id, (x) => ({ ...x, sections: order }))
}
/** The user's own order (a drag) — it clears the list's sort. */
export function reorder(symbols: string[]): void {
  const l = activeList()
  const keep = symbols.filter((s) => l.symbols.includes(s))
  for (const s of l.symbols) if (!keep.includes(s)) keep.push(s)
  setSort(l.id, undefined)
  edit(l.id, (x) => ({ ...x, symbols: keep }))
}
export function createList(name: string): WatchList | null {
  if (state.lists.length >= MAX_LISTS) return null
  const l: WatchList = { id: newId(), name: name.trim().slice(0, 60) || 'Watchlist', symbols: [], u: Date.now() }
  state = { ...state, lists: [...state.lists, l], active: l.id }
  changed()
  return l
}
/**
 * IMPORT (the picker's import screen; watchlist/importParse.ts reads the file).
 * Into a NEW list named `name` (`into` null), or merged into the list `into`:
 * its sections are added after the list's own, new symbols go to the end in
 * their section, a symbol already on the list keeps its place and section.
 * The target list opens. Capped at MAX_SYMBOLS and MAX_SECTIONS like any list.
 * null: a new list was asked for and there are MAX_LISTS already.
 */
export function importList(
  into: string | null,
  name: string,
  groups: ReadonlyArray<{ name: string | null; tickers: readonly string[] }>,
): { listId: string; added: number } | null {
  let target = into ? state.lists.find((l) => l.id === into) : undefined
  if (!target) {
    const made = createList(name)
    if (!made) return null
    target = made
  }
  let added = 0
  edit(target.id, (x) => {
    let next: WatchList = { ...x, symbols: x.symbols.slice() }
    for (const g of groups) {
      let sec = sectionName(g.name)
      if (sec) {
        const secs = sectionsOf(next)
        if (!secs.includes(sec)) {
          if (secs.length >= MAX_SECTIONS) sec = null
          else next = { ...next, sections: [...secs, sec] }
        }
      }
      for (const raw of g.tickers) {
        const t = normTicker(raw)
        if (!t || next.symbols.includes(t) || next.symbols.length >= MAX_SYMBOLS) continue
        next.symbols.push(t)
        added++
        if (sec) next = withGroup(next, t, sec)
      }
    }
    return next
  })
  setActive(target.id)
  return { listId: target.id, added }
}
export function renameList(id: string, name: string): void {
  const n = name.trim().slice(0, 60)
  if (n) edit(id, (x) => ({ ...x, name: n }))
}
/** Delete a list and its symbols. The last list is emptied and kept, never removed. */
export function deleteList(id: string): void {
  if (state.lists.length <= 1) {
    edit(id, (x) => ({ ...x, symbols: [] }))
    return
  }
  writeDeleted({ ...readDeleted(), [id]: Date.now() })
  const rest = state.lists.filter((l) => l.id !== id)
  state = { ...state, lists: rest, active: state.active === id ? rest[0]!.id : state.active }
  changed()
}

// ── View: columns + sort ──
const PREFS_REV = 2
function readPrefs(): ViewPrefs {
  const d: ViewPrefs = { cols: { price: true, change: false, pct: true, volume: false }, sort: {}, compact: true, rev: PREFS_REV }
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<ViewPrefs> | null
    if (raw?.cols) d.cols = { ...d.cols, ...raw.cols }
    // The watchlist cleanup (2026-10-05): the points change gives way to the % change
    // once, for a copy saved before it; ⋯ → Columns turns it back on, and that sticks.
    if (raw && (raw.rev ?? 1) < 2) d.cols.change = false
    if (typeof raw?.compact === 'boolean') d.compact = raw.compact
    if (raw?.sort && typeof raw.sort === 'object') d.sort = raw.sort
    if (raw?.folded && typeof raw.folded === 'object') d.folded = raw.folded
  } catch {
    /* defaults */
  }
  return d
}
let prefs = readPrefs()
export const viewPrefs = (): ViewPrefs => prefs
function savePrefs(): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* private mode */
  }
  for (const fn of listeners) fn()
}
export function setColumn(col: keyof ViewPrefs['cols'], on: boolean): void {
  prefs = { ...prefs, cols: { ...prefs.cols, [col]: on } }
  savePrefs()
}
/** One-line rows, or ticker over name. */
export function setCompact(on: boolean): void {
  prefs = { ...prefs, compact: on }
  savePrefs()
}
/** Fold or unfold one section of a list in the docked panel. */
export function setFolded(listId: string, section: string, folded: boolean): void {
  const cur = new Set(prefs.folded?.[listId] ?? [])
  if (folded) cur.add(section)
  else cur.delete(section)
  prefs = { ...prefs, folded: { ...(prefs.folded ?? {}), [listId]: [...cur] } }
  savePrefs()
}
export function isFolded(listId: string, section: string): boolean {
  return !!prefs.folded?.[listId]?.includes(section)
}
export function setSort(listId: string, s: { key: SortKey; dir: 1 | -1 } | undefined): void {
  const sort = { ...prefs.sort }
  if (s) sort[listId] = s
  else delete sort[listId]
  prefs = { ...prefs, sort }
  savePrefs()
}

// ── The account copy ──
export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'signed-out' | 'error'
let syncStatus: SyncStatus = 'idle'
export const watchlistSyncStatus = (): SyncStatus => syncStatus
let syncTimer: ReturnType<typeof setTimeout> | null = null
let syncing: Promise<void> | null = null
let syncAgain = false
let lastSync = 0

function scheduleSync(): void {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    syncTimer = null
    void syncWatchlists(true)
  }, 1500)
}

interface Remote {
  n?: string
  s?: unknown[]
  g?: unknown
  /** The sections, in order. */
  o?: unknown
  u: number
  d?: number
}

/** Merge both ways (newest edit wins per list). `force` skips the 30 s throttle. */
export function syncWatchlists(force = false): Promise<void> {
  if (!force && Date.now() - lastSync < 30_000) return syncing ?? Promise.resolve()
  if (syncing) {
    syncAgain = true
    return syncing
  }
  const run = async () => {
    do {
      syncAgain = false
      lastSync = Date.now()
      syncStatus = 'syncing'
      try {
        await syncOnce()
      } catch {
        syncStatus = 'error'
      }
    } while (syncAgain)
    for (const fn of listeners) fn()
  }
  syncing = run().finally(() => {
    syncing = null
  })
  return syncing
}

async function syncOnce(): Promise<void> {
  const page = await readPage(PAGE)
  if (page === 'auth') {
    syncStatus = 'signed-out'
    return
  }
  const remote = new Map<string, Remote>()
  for (const p of page) {
    const r = p.preset as Partial<Remote> | null
    if (r && typeof r === 'object' && typeof r.u === 'number') remote.set(p.name, r as Remote)
  }
  const deleted = readDeleted()
  const local = new Map(state.lists.map((l) => [l.id, l]))
  const remoteLive = [...remote.values()].some((r) => !r.d)
  const merged: WatchList[] = []
  const writes: [string, Record<string, unknown> | null][] = []
  let pulled = false
  for (const id of new Set([...local.keys(), ...remote.keys(), ...Object.keys(deleted)])) {
    const l = local.get(id)
    const r = remote.get(id)
    // this browser's untouched starter list never joins an account that has lists
    if (l && l.u === 0 && !r && remoteLive) {
      pulled = true
      continue
    }
    const del = deleted[id]
    // a tombstone (here or there) newer than the list wins
    const rDel = r?.d ? r.u : 0
    const goneAt = Math.max(del ?? 0, rDel)
    const newest = Math.max(l?.u ?? 0, r && !r.d ? r.u : 0)
    if (goneAt && goneAt >= newest) {
      if (!r?.d && r) writes.push([id, { d: 1, u: goneAt }])
      else if (!r && goneAt > Date.now() - TOMBSTONE_MS) writes.push([id, { d: 1, u: goneAt }])
      if (r?.d && Date.now() - r.u > TOMBSTONE_MS) writes.push([id, null])
      if (l) pulled = true
      continue
    }
    if (l && (!r || r.d || l.u >= r.u)) {
      merged.push(l)
      if (!r || r.d || l.u > r.u)
        writes.push([id, { n: l.name, s: l.symbols, ...(l.groups ? { g: l.groups } : {}), ...(l.sections?.length ? { o: l.sections } : {}), u: l.u || Date.now() }])
    } else if (r && !r.d) {
      const symbols = dedupe(r.s ?? [])
      const groups = cleanGroups(r.g, symbols)
      merged.push({ id, name: String(r.n ?? 'Watchlist').slice(0, 60), symbols, groups, sections: cleanSections(r.o, groups), u: r.u })
      pulled = true
    }
  }
  // the server keeps 12 a page: newest lists first
  const pushes = writes.slice(0, 12)
  for (const [id, preset] of pushes) await writePreset(PAGE, id, preset)
  syncStatus = 'ok'
  if (pulled && merged.length) {
    const at = (id: string) => {
      const i = state.lists.findIndex((l) => l.id === id)
      return i < 0 ? 1e6 : i
    }
    merged.sort((a, b) => at(a.id) - at(b.id))
    const keep = merged.slice(0, MAX_LISTS)
    const want = pendingActive && keep.some((l) => l.id === pendingActive) ? pendingActive : state.active
    pendingActive = null
    state = { ...state, lists: keep, active: keep.some((l) => l.id === want) ? want : keep[0]!.id }
    changed(false)
  }
  // old tombstones kept here are forgotten
  const fresh = Object.fromEntries(Object.entries(deleted).filter(([, t]) => Date.now() - t < TOMBSTONE_MS))
  if (Object.keys(fresh).length !== Object.keys(deleted).length) writeDeleted(fresh)
}

// ── Symbols for Add ──
export interface SymbolRow {
  ticker: string
  description: string
  type: string
}
let symbolsP: Promise<SymbolRow[]> | null = null
/** Everything a chart here can load (the provider's list: CB Edge names, ES / NQ, the scanner roster). */
export function chartSymbols(): Promise<SymbolRow[]> {
  return (symbolsP ??= new CbEdgeProvider()
    .listSymbols()
    .then((xs) => xs.map((x) => ({ ticker: x.ticker, description: x.description ?? '', type: String(x.type ?? '') })))
    .catch(() => {
      symbolsP = null
      return []
    }))
}

// ── Quotes ──
const quotes = new Map<string, Quote>()
export const quoteOf = (sym: string): Quote | undefined => quotes.get(sym)
const quoteSym = (sym: string) => (sym === 'ES' || sym === 'NQ' ? `/${sym}` : sym)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Last / change / change % for these tickers (one request), merged into the cache. */
export async function refreshQuotes(symbols: readonly string[]): Promise<void> {
  if (!symbols.length) return
  const ask = symbols.slice(0, MAX_SYMBOLS)
  try {
    const r = await fetch(`/api/quotes-batch?symbols=${encodeURIComponent(ask.map(quoteSym).join(','))}`, { cache: 'no-store', credentials: 'same-origin' })
    if (!r.ok) return
    const j = (await r.json()) as { data?: { items?: Record<string, unknown>[] } }
    for (const it of j.data?.items ?? []) {
      const s = String(it.symbol ?? '').replace(/^\//, '')
      if (!s) continue
      const prev = quotes.get(s)
      quotes.set(s, { last: num(it.last), change: num(it.change), pct: num(it['percent-change']), volume: prev?.volume ?? null })
    }
  } catch {
    /* keep what is showing */
  }
  for (const fn of listeners) fn()
}

const volAt = new Map<string, number>()
/** 24 h volume off the chart tape, at most once a minute per symbol. */
export async function refreshVolumes(symbols: readonly string[]): Promise<void> {
  const now = Date.now()
  const due = symbols.filter((s) => resolveSym(s).kind !== 'index' && now - (volAt.get(s) ?? 0) > 60_000).slice(0, 40)
  if (!due.length) return
  await Promise.all(
    due.map(async (s) => {
      volAt.set(s, now)
      const sym = resolveSym(s)
      try {
        const url = sym.fut ? esCandlesUrl(5, 2, sym.fut) : `/api/snapshots/etf-candles?symbol=${encodeURIComponent(sym.key)}&days=2&interval=5`
        const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin' })
        if (!r.ok) return
        const json: unknown = await r.json()
        const bars = sym.fut ? parseEsCandles(json) : parseCandles(json)
        const last = bars[bars.length - 1]
        if (!last) return
        const from = last.t - 86_400_000
        let v = 0
        for (const b of bars) if (b.t > from) v += b.v
        const q = quotes.get(s) ?? { last: null, change: null, pct: null, volume: null }
        quotes.set(s, { ...q, volume: v || null })
      } catch {
        /* no volume for this one */
      }
    }),
  )
  for (const fn of listeners) fn()
}
