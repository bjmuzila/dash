// ─────────────────────────────────────────────────────────────────────────────
// CB SCRIPT — the script library: the user's saved scripts, per browser.
//
// localStorage `cb-v3-vela-scripts` → { v: 1, scripts: [{ id, name, source, u }] }
// (`u` = when it was last saved, epoch ms). Seeded with three examples the first
// time, so the editor opens on something that shows the format.
//
// ── Synced across devices ────────────────────────────────────────────────────
// Signed in, the library is ALSO kept on the server, in the per-user preset
// store every page already uses (/api/page-preset — no table of its own): one
// preset per script, `page` = vela-scripts[-2…-9] (12 presets a page is the
// store's cap), `name` = the script id, `preset` = { n, s, u } — or { d: 1, u }
// for a script deleted on some device, so a delete reaches the others instead
// of the next sync putting it back. syncLibrary() merges both ways: the newer
// `u` wins, per script; a save made while a sync runs is kept and pushed by a
// second pass. Signed out (401), it stays a per-browser library.
//
// A script ON A CHART carries its own copy of the source in the chart's saved
// state (panel.ts persistence), keyed `cbs-<library id>-<n>`, so deleting a
// script from the library never blanks a chart; saving an edit updates every
// chart running that library script.
// ─────────────────────────────────────────────────────────────────────────────

export interface Script {
  id: string
  name: string
  source: string
  /** Last saved, epoch ms — the sync's tiebreak (0 / absent: an untouched example). */
  u?: number
}

const KEY = 'cb-v3-vela-scripts'
/** Scripts deleted in this browser, id → when (so the sync deletes them elsewhere too). */
const DELETED_KEY = 'cb-v3-vela-scripts-deleted'

const EXAMPLES: Script[] = [
  {
    id: 'ex-ema',
    name: 'EMA cross',
    source: `// EMA cross: two averages, shaded between, a marker where they cross
indicator("EMA cross", overlay=true)
fastLen = input("Fast", 9, min=1)
slowLen = input("Slow", 21, min=1)
fast = ema(close, fastLen)
slow = ema(close, slowLen)
p1 = plot(fast, "Fast", color=gold, width=2)
p2 = plot(slow, "Slow", color=blue, width=2)
fill(p1, p2, color=gold, opacity=0.08)
marker(crossover(fast, slow), position="below", color=green)
marker(crossunder(fast, slow), position="above", color=red)
`,
  },
  {
    id: 'ex-rsi',
    name: 'RSI',
    source: `// RSI in its own pane, with the 70 / 30 lines and a tint when stretched
indicator("RSI", overlay=false)
len = input("Length", 14, min=2)
r = rsi(close, len)
plot(r, "RSI", color=purple, width=2)
hline(70, "Overbought", color=red)
hline(30, "Oversold", color=green)
bgcolor(r > 70, color=red, opacity=0.08)
bgcolor(r < 30, color=green, opacity=0.08)
`,
  },
  {
    id: 'ex-bands',
    name: 'Bands + VWAP',
    source: `// Bollinger bands around a 20 SMA, plus the session VWAP
indicator("Bands + VWAP", overlay=true)
len = input("Length", 20, min=2)
mult = input("Multiplier", 2, step=0.1)
up = plot(bb_upper(close, len, mult), "Upper", color=teal)
dn = plot(bb_lower(close, len, mult), "Lower", color=teal)
fill(up, dn, color=teal, opacity=0.06)
plot(sma(close, len), "Basis", color=gray, dashed=true)
plot(vwap(), "VWAP", color=orange, width=2)
`,
  },
]

/** A blank script for "New". */
export const TEMPLATE = `// My script: see Reference below for every name and function
indicator("My script", overlay=true)
len = input("Length", 20, min=1)
plot(ema(close, len), "EMA", color=gold, width=2)
`

export function loadLibrary(): Script[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw == null) {
      saveLibrary(EXAMPLES)
      return EXAMPLES.map((s) => ({ ...s }))
    }
    const j: unknown = JSON.parse(raw)
    const list = (j as { scripts?: unknown })?.scripts
    if (!Array.isArray(list)) return []
    return list
      .filter(
        (s): s is Script =>
          !!s && typeof s === 'object' && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.source === 'string',
      )
      .map((s) => ({ id: s.id, name: s.name, source: s.source, ...(typeof s.u === 'number' ? { u: s.u } : {}) }))
  } catch {
    return EXAMPLES.map((s) => ({ ...s }))
  }
}

export function saveLibrary(list: readonly Script[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, scripts: list }))
  } catch {
    /* private mode: the script still runs this visit */
  }
}

// ── Deletes, remembered for the sync ──
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
/** Record a delete (the panel calls this; the sync tells the server). */
export function markDeleted(id: string): void {
  writeDeleted({ ...readDeleted(), [id]: Date.now() })
}

// ── The sync ──
const PAGES = ['vela-scripts', 'vela-scripts-2', 'vela-scripts-3', 'vela-scripts-4', 'vela-scripts-5', 'vela-scripts-6', 'vela-scripts-7', 'vela-scripts-8', 'vela-scripts-9']
const PER_PAGE = 12
/** The store's cap is 64KB a preset; leave room for the wrapper. */
const MAX_SOURCE = 60_000
/** Tombstones older than this are dropped from the server. */
const TOMBSTONE_MS = 45 * 86_400_000

interface Remote {
  page: string
  u: number
  n?: string
  s?: string
  d?: number
}

export interface SyncResult {
  status: 'ok' | 'signed-out' | 'error'
  /** The merged library (status 'ok'), already saved in this browser. */
  scripts?: Script[]
  pulled?: number
  pushed?: number
  skipped?: string[]
  error?: string
}

/** One page of the account's presets (/api/page-preset), or 'auth' when signed out. Shared with the watchlist. */
export async function readPage(page: string): Promise<{ name: string; preset: unknown }[] | 'auth'> {
  const r = await fetch(`/api/page-preset?page=${encodeURIComponent(page)}`, { cache: 'no-store', credentials: 'same-origin' })
  if (r.status === 401 || r.status === 403) return 'auth'
  if (!r.ok) throw new Error(`page-preset ${r.status}`)
  const j = (await r.json()) as { presets?: { name?: unknown; preset?: unknown }[] }
  return (j.presets ?? []).filter((p): p is { name: string; preset: unknown } => typeof p?.name === 'string')
}

/** Store (or, with null, delete) one named preset on a page. */
export async function writePreset(page: string, name: string, preset: Record<string, unknown> | null): Promise<void> {
  const body = preset ? { page, name, preset } : { page, name, action: 'delete' }
  const r = await fetch('/api/page-preset', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`page-preset save ${r.status}`)
}

let syncing: Promise<SyncResult> | null = null
let again = false

/**
 * Merge this browser's library with the account's, both ways. One at a time: a call
 * while one runs queues ONE more run (a save made mid-sync is pushed by it).
 */
export function syncLibrary(): Promise<SyncResult> {
  if (syncing) {
    again = true
    return syncing
  }
  const loop = async (): Promise<SyncResult> => {
    let r: SyncResult
    do {
      again = false
      r = await runSync()
    } while (again && r.status === 'ok')
    return r
  }
  syncing = loop().finally(() => (syncing = null))
  return syncing
}

/** The store's own cap is 65,536 characters of JSON per preset. */
const MAX_PRESET_JSON = 64_000

async function runSync(): Promise<SyncResult> {
  try {
    // ── read every page (a gap left by a purged tombstone must not hide the pages after it) ──
    const pages = await Promise.all(PAGES.map((page) => readPage(page)))
    if (pages.some((rows) => rows === 'auth')) return { status: 'signed-out' }
    const remote = new Map<string, Remote>()
    const count = new Map<string, number>()
    const extras: { page: string; id: string }[] = []
    pages.forEach((rows, k) => {
      const page = PAGES[k]!
      if (rows === 'auth') return
      count.set(page, rows.length)
      for (const row of rows) {
        const p = row.preset as Partial<Remote> | null
        if (!p || typeof p.u !== 'number') continue
        const r: Remote = { page, u: p.u, ...(typeof p.n === 'string' ? { n: p.n } : {}), ...(typeof p.s === 'string' ? { s: p.s } : {}), ...(p.d ? { d: 1 } : {}) }
        const had = remote.get(row.name)
        // one id on two pages: the newer copy wins, the other is removed
        if (had && had.u >= r.u) extras.push({ page, id: row.name })
        else {
          if (had) extras.push({ page: had.page, id: row.name })
          remote.set(row.name, r)
        }
      }
    })
    const local = loadLibrary()
    const deleted = readDeleted()
    const byId = new Map(local.map((x) => [x.id, x]))
    const ids = new Set([...byId.keys(), ...remote.keys(), ...Object.keys(deleted)])
    const out: Script[] = []
    const pushes: { id: string; preset: Record<string, unknown> | null; page: string | null; name: string }[] = []
    const skipped: string[] = []
    let pulled = 0
    const now = Date.now()
    for (const id of ids) {
      const l = byId.get(id)
      const r = remote.get(id)
      const lu = l ? (l.u ?? 0) : (deleted[id] ?? 0)
      const ru = r?.u ?? -1
      if (r && ru > lu) {
        // the account's copy is newer
        if (!r.d && typeof r.n === 'string' && typeof r.s === 'string') {
          out.push({ id, name: r.n, source: r.s, u: r.u })
          if (!l || l.source !== r.s || l.name !== r.n) pulled++
        } else if (l) pulled++
        if (r.d && now - r.u > TOMBSTONE_MS) pushes.push({ id, preset: null, page: r.page, name: id })
        continue
      }
      if (l) {
        out.push(l)
        if (lu > ru && lu > 0) {
          const preset = { n: l.name, s: l.source, u: lu }
          if (l.source.length > MAX_SOURCE || JSON.stringify(preset).length > MAX_PRESET_JSON) skipped.push(l.name)
          else pushes.push({ id, preset, page: r?.page ?? null, name: l.name })
        }
        continue
      }
      // deleted here, newer than the account's copy: tell the account
      if (deleted[id] && lu > ru && r) pushes.push({ id, preset: { d: 1, u: lu }, page: r.page, name: id })
    }
    // ── write — one failure skips that script, not the sync ──
    let pushed = 0
    let failed = 0
    for (const x of extras) {
      try {
        await writePreset(x.page, x.id, null)
        count.set(x.page, Math.max(0, (count.get(x.page) ?? 1) - 1))
      } catch {
        failed++
      }
    }
    for (const p of pushes) {
      try {
        if (!p.preset) {
          if (p.page) await writePreset(p.page, p.id, null)
          continue
        }
        let page = p.page
        if (!page) {
          page = PAGES.find((pg) => (count.get(pg) ?? 0) < PER_PAGE) ?? null
          if (!page) {
            skipped.push(p.name)
            continue
          }
          count.set(page, (count.get(page) ?? 0) + 1)
        }
        await writePreset(page, p.id, p.preset)
        pushed++
      } catch {
        failed++
      }
    }
    // ── what changed HERE while this ran (a save, a delete) is kept, not overwritten ──
    const merged = new Map(out.map((x) => [x.id, x]))
    const nowLocal = loadLibrary()
    const nowDeleted = readDeleted()
    for (const x of nowLocal) {
      const before = byId.get(x.id)
      if (!before || (x.u ?? 0) > (before.u ?? 0)) {
        merged.set(x.id, x)
        again = true // push it on the next pass
      }
    }
    for (const [id, at] of Object.entries(nowDeleted)) if ((deleted[id] ?? 0) < at && !nowLocal.some((x) => x.id === id)) merged.delete(id)
    const result = [...merged.values()]
    // order: the library's own order first, then what arrived
    const order = new Map(nowLocal.map((x, k) => [x.id, k]))
    result.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9))
    saveLibrary(result)
    if (failed) skipped.push(`${failed} not saved: try Sync again`)
    return { status: 'ok', scripts: result, pulled, pushed, ...(skipped.length ? { skipped } : {}) }
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : String(e) }
  }
}

export function newScriptId(): string {
  return `s${Date.now().toString(36)}${Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, '0')}`
}

/** The library id inside a chart instance id `cbs-<lib>-<n>`, or null. */
export function libIdOf(instanceId: string): string | null {
  const m = /^cbs-(.+)-[a-z0-9]+$/.exec(instanceId)
  return m ? m[1]! : null
}

/** A fresh chart instance id for a library script. */
export function instanceIdFor(libId: string): string {
  return `cbs-${libId}-${Math.floor(Math.random() * 46656).toString(36)}`
}

// ── "Edit this script" from elsewhere (the Strategy Tester) ──────────────────
// The Scripts panel listens; a request made before it ever opened waits for it.
const editListeners = new Set<(id: string, note?: string) => void>()
let pendingEdit: { id: string; note?: string } | null = null
export function requestEdit(id: string, note?: string): void {
  pendingEdit = { id, note }
  for (const fn of editListeners) fn(id, note)
}
export function onEditRequest(fn: (id: string, note?: string) => void): () => void {
  editListeners.add(fn)
  return () => editListeners.delete(fn)
}
/** The request no listener has taken yet (the Scripts panel's first open). */
export function takePendingEdit(): { id: string; note?: string } | null {
  const p = pendingEdit
  pendingEdit = null
  return p
}
