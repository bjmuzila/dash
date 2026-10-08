import type { CbBoot, PrefsBootResult } from '@/boot/types'

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS FOLLOW THE ACCOUNT: localStorage ⇄ Postgres, per user.
//
// Brandon, 2026-10-08: "all settings, indicators, anything that saves layouts
// or anything needs to save per user name in postgres".
//
// v3 keeps every setting in localStorage: the board layout and its named
// layouts, every card's settings, the rail order, the theme, the chain's
// columns, the scanner's card layout, and all of Vela (its workspace document:
// layout, charts, indicators with their inputs, drawings; indicator presets,
// favourites and lists, watchlists, scripts, alerts, setups, replay). About
// eighty keys written by about ninety files, and all of it stayed in ONE
// browser. vela.cbedge.net is another origin, so it did not even share them
// with cbedge.net/v3/vela on the same machine.
//
// This module makes the ACCOUNT the home of those keys without touching any of
// the ninety files. They keep reading and writing localStorage; this module
//   · puts the account's copy INTO localStorage before any of them runs, and
//   · sends every write to one of them up to the account a moment later.
// The server half is server-v2/user-prefs.cjs (table user_prefs, keyed by the
// signed-in user's id; values stored verbatim).
//
// ── Why it must be the FIRST import of main.tsx (and vela/main.tsx) ──────────
// Plenty of v3 reads a setting the moment its module loads (layoutStore stamps
// and rescales the board at import, the Vela watchlist store reads its lists at
// import). A read that beats the account's copy is a read of whatever this
// browser happened to hold, and the next write would push that stale value
// over the account's. So:
//   1. index.html / vela.html ask POST /api/user-prefs/sync in the head, in
//      parallel with the bundle download;
//   2. the entry script is held until that answers, or 3s pass
//      (vite.config.ts, holdEntryForPrefs; the bundle still downloads);
//   3. this module evaluates FIRST and applies the answer synchronously, at
//      module scope, before any other module of the app has run.
// If the answer is late (3s passed) or there was no early request, it is
// applied when it lands, minus anything the page has already read or written
// (`seen`): those keys keep this browser's copy for this visit, are never sent
// from it, and are marked stale (`x`) so the next load takes the account's. A
// late answer that finds a DIFFERENT account in this browser stops the tab
// syncing and reloads it once: the page is already running on the other
// account's settings and would save them straight back as this one's.
//
// ── What syncs ──────────────────────────────────────────────────────────────
// isSyncedKey() below: every key under the PREFIXES, the EXACT names that
// predate them, and this account's own quick-jot notes, minus NEVER. A new
// setting syncs with no change here as long as its key starts `cb-v3-` (the
// namespace every v3 key is meant to carry). A key that must stay in ONE
// browser (a session flag, a cache, a "seen" marker) has to live outside the
// prefixes or be added to NEVER. sessionStorage is never touched.
//
// ── How a write travels ─────────────────────────────────────────────────────
// Storage.prototype.setItem / removeItem are wrapped, once: after the real
// write, a key that syncs is queued, and the queue is POSTed to
// /api/user-prefs after DEBOUNCE_MS of quiet (MAX_WAIT_MS at most), or with
// sendBeacon when the tab is hidden or closed. clear() is NOT sent: wiping a
// browser must never wipe the account; the next load simply refills it.
//
// What the account holds is tracked here in META_KEY (this browser's alone):
// per key, the account's rev and a hash of the value this browser last agreed
// with it on. "Changed here" is therefore a fact read off the data (hash ≠ the
// agreed hash), not a flag that a crash or a second tab could lose.
//
// ── When two places disagree ─────────────────────────────────────────────────
//   · changed only on the account      → the account's copy comes down
//   · changed only here                → this browser's goes up
//   · changed in both                  → this browser's wins: it is the most
//                                        recent thing the user did HERE
//   · deleted on another device        → deleted here (a clean copy only)
//   · first contact: a browser holding its own copy of a key the account
//     already has (each browser's first load after this shipped, or a new
//     device)                          → the ACCOUNT's copy wins; this
//                                        browser's own is kept in BACKUP_KEY.
//                                        Quick-jot notes are merged instead
//                                        (by id), so nobody's notes vanish.
//                                        Keys only this browser has go up.
//   · a different account used this browser last → its synced keys are taken
//     out first (they are on ITS account), then this account's come down. The
//     notes are per user id already and are left where they are. A tab still
//     open under the old account stops writing synced keys (`frozen`).
//   · the account is empty (or most of it vanished at once): a restored or
//     emptied table, not a person deleting things → this browser re-seeds it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every key under these is a SETTING and follows the account, unless NEVER names it.
 */
const PREFIXES = [
  // the board and every card, the rail, the theme, every v3 page, and Vela:
  // its workspace documents (cb-v3-vela, cb-v3-vela-m) and every panel's state
  'cb-v3-',
  // Vela: indicator presets, level alerts, setups, replay and paper trades, the
  // Volt watch strip, the pinned watchlist column
  'cb-vela-',
  // premarket: level basis, gamma bell basis and zoom
  'cb-premarket-',
  // post-market notes and log
  'cb-postmarket-',
  // options chain: near-core switch and %
  'cb.chain.',
  // analytics: favourite tickers, recent lookups, extra tickers
  'analytics.',
  // scanner → GEX Levels: the card layout
  'gexlevels-card-',
  // the alerts feed's type filters (alerts:shown, alerts:shown-script)
  'alerts:shown',
]
/** Settings whose keys predate the namespaces above (several shared with v2 on this origin). */
const EXACT = new Set(['chain_heat_skin', 'es-candles-fav-symbols-v1', 'cbedge.sectorWheel.skin', 'notes-dock-open-v1'])
/** Under a prefix above, and still this browser's alone. Some are sessionStorage today; listed so a move cannot start syncing them. */
const NEVER = new Set([
  'cb-v3-stale-chunk-reloaded',
  'cb-v3-update-dismissed',
  'cb-v3-force-desktop',
  'cb-v3-flow-netbins-v2',
  'cb-v3-script-alerts',
  'cb-vela-stale-chunk-reloaded',
  'cb-vela-tel-sid',
])
/** shell/notes.tsx keys its list by user id already: only the signed-in account's own list travels. */
const NOTES = 'sidebar-notes-v1:'
/** What this browser and the account agree on. This browser's alone, by definition. */
export const META_KEY = 'cb-prefs-sync'

export function isSyncedKey(key: string, user: string | null): boolean {
  if (key === META_KEY || key === BACKUP_KEY || NEVER.has(key)) return false
  if (EXACT.has(key)) return true
  if (key.startsWith(NOTES)) return !!user && key === NOTES + user
  return PREFIXES.some((p) => key.startsWith(p))
}

// ── Tuning ───────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 1500
const MAX_WAIT_MS = 8000
/** After the boot sync, what this browser holds that the account lacks goes up once the page has settled. */
const FIRST_PUSH_MS = 4000
/** One POST carries at most this much (the server takes 8M chars; values are JSON-escaped on the wire). */
const BATCH_CHARS = 3 * 1024 * 1024
/** sendBeacon / keepalive bodies are capped near 64KB by browsers. */
const BEACON_CHARS = 60_000
const JSON_HEADERS = { 'content-type': 'application/json' }
const SYNC_URL = '/api/user-prefs/sync'
const WRITE_URL = '/api/user-prefs'

// ── This browser's record of the account ─────────────────────────────────────

interface KeyMeta {
  /** The account's rev of the value this browser agreed on. 0: sent once, never acknowledged. */
  r: number
  /** Hash of that value. */
  h: string
  /** Hash of a value SENT and not yet acknowledged ('-': a delete). Lets the next load tell "landed" from "lost". */
  p?: string
  /** 1: this browser's copy is known stale (a late answer found the account ahead while the page held the old one): the next load takes the account's. */
  x?: 1
}
interface Meta {
  v: 1
  user: string
  keys: Record<string, KeyMeta>
  /** Values the account refused (too large, over quota), by hash: not resent on every load. */
  skip?: Record<string, string>
}
interface SyncBody {
  user: string
  keys: Record<string, number>
  values?: Record<string, string>
  limits?: { keyMaxBytes?: number }
}

export type PrefsStatus = 'waiting' | 'synced' | 'local' | 'signed-out' | 'account-changed'

let ls: Storage | null = null
try {
  ls = window.localStorage
} catch {
  ls = null // storage blocked: nothing to sync, nothing to break
}
const proto: Storage | null = typeof Storage === 'undefined' ? null : Storage.prototype
// The REAL methods, captured before the wrap below. Everything this module
// writes goes through these, so its own writes are never queued as edits.
const rawGet = proto?.getItem
const rawSet = proto?.setItem
const rawRemove = proto?.removeItem

function get(k: string): string | null {
  try {
    return rawGet && ls ? rawGet.call(ls, k) : null
  } catch {
    return null
  }
}
function put(k: string, v: string): boolean {
  try {
    if (!rawSet || !ls) return false
    rawSet.call(ls, k, v)
    return true
  } catch {
    return false // quota: this key keeps what it had
  }
}
function drop(k: string): void {
  try {
    if (rawRemove && ls) rawRemove.call(ls, k)
  } catch {
    /* nothing to do */
  }
}
function keysHere(): string[] {
  const out: string[] = []
  try {
    for (let i = 0; ls && i < ls.length; i++) {
      const k = ls.key(i)
      if (k != null) out.push(k)
    }
  } catch {
    /* blocked mid-way: what was read is what there is */
  }
  return out
}
function readMeta(): Meta | null {
  try {
    const m = JSON.parse(get(META_KEY) ?? 'null') as Meta | null
    return m && m.v === 1 && typeof m.user === 'string' && m.keys && typeof m.keys === 'object' ? m : null
  } catch {
    return null
  }
}
const writeMeta = (m: Meta) => put(META_KEY, JSON.stringify(m))

/** cyrb53 over the string, plus its length: equality of two values without keeping a copy of either. */
export function hashOf(s: string): string {
  let a = 0xdeadbeef ^ s.length
  let b = 0x41c6ce57 ^ s.length
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    a = Math.imul(a ^ c, 2654435761)
    b = Math.imul(b ^ c, 1597334677)
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909)
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909)
  return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36) + '.' + s.length.toString(36)
}

/** UTF-8 bytes, measured only when the char count alone cannot settle it. */
function overLimit(v: string, max: number): boolean {
  if (v.length > max) return true
  if (v.length * 3 <= max) return false
  return new TextEncoder().encode(v).length > max
}

// ── State ────────────────────────────────────────────────────────────────────

let status: PrefsStatus = 'waiting'
/** The account this page syncs with, once the sync has answered. */
let user: string | null = null
let keyMax = 2 * 1024 * 1024
/** Keys written since they were last sent. */
const pending = new Set<string>()
/** Until the account's copy is applied: what the page has read or written (see "late" in the header). */
let tracking = true
const seen = new Set<string>()
/** Keys a late answer found the account ahead on while this page held the old value: never sent this visit. */
const held = new Set<string>()
/** Another account owns this browser now: this tab must not write its (old account's) settings into it. */
let frozen = false
let retries = 0
/** Where a browser's own copy goes when the account's replaces it on first contact. This browser's alone. */
const BACKUP_KEY = 'cb-prefs-backup'
const RELOAD_KEY = 'cb-prefs-reloaded'
/** A backup is a courtesy, not a second store: a value bigger than this is not kept (localStorage holds ~5MB in all). */
const BACKUP_MAX_CHARS = 512 * 1024

/** Stop this tab syncing, and writing synced keys, for the rest of its life. */
function freeze(why: PrefsStatus): void {
  status = why
  frozen = true
  pending.clear()
}

// ── The sync: the account's copy into localStorage ───────────────────────────

function reconcile(body: SyncBody, late: boolean): void {
  const me = body.user
  const server = body.keys
  const values = body.values ?? {}
  let prev = readMeta()
  // A different account used this browser last: its settings are on ITS account
  // and must not leak into this one. The notes are per user id already.
  if (prev && prev.user !== me) {
    for (const k of keysHere()) if (!k.startsWith(NOTES) && isSyncedKey(k, prev.user)) drop(k)
    if (late) {
      // The page is already running on the other account's settings, in memory,
      // and would write them straight back as this account's. Nothing is sent
      // from this visit; a reload (once a session) boots clean on this account.
      writeMeta({ v: 1, user: me, keys: {} })
      freeze('account-changed')
      let again = true
      try {
        again = !sessionStorage.getItem(RELOAD_KEY)
        sessionStorage.setItem(RELOAD_KEY, '1')
      } catch {
        again = false
      }
      if (again) location.reload()
      return
    }
    prev = null
  }
  const known = prev?.keys ?? {}
  const next: Meta = { v: 1, user: me, keys: {}, ...(prev?.skip ? { skip: prev.skip } : {}) }
  const up = new Set<string>()
  const backup: Record<string, string> = {}
  let pulled = 0
  // Most of what this browser synced has vanished from the account at once: a
  // restored or emptied table, not someone deleting settings. Re-seed it.
  const knownIds = Object.keys(known)
  const missing = knownIds.filter((k) => !(k in server)).length
  const reseed = knownIds.length > 0 && (Object.keys(server).length === 0 || (missing >= 5 && missing * 2 > knownIds.length))

  /**
   * The account's value comes down. On a LATE answer, a key the page has already
   * read or written is not swapped under it: it is held (never sent this visit)
   * and marked stale, so the next load takes the account's copy.
   */
  const take = (k: string, r: number, v: string | undefined, was: KeyMeta | undefined): void => {
    if (v === undefined) {
      if (was) next.keys[k] = was
      return
    }
    if (late && seen.has(k)) {
      held.add(k)
      // r 0: the next load does not claim to hold any rev, so the account's value is sent
      next.keys[k] = { r: 0, h: was?.h ?? '', x: 1 }
      return
    }
    if (put(k, v)) {
      next.keys[k] = { r, h: hashOf(v) }
      pulled++
    } else if (was) next.keys[k] = was
  }

  for (const [k, r] of Object.entries(server)) {
    if (!isSyncedKey(k, me)) continue // the account holds a key this build does not sync: leave it alone
    const local = get(k)
    const was = known[k]
    const sv = values[k]
    if (local == null) {
      if (was && r === was.r && !was.x) {
        // removed here since the last sync and untouched on the account: the delete goes up
        next.keys[k] = was
        up.add(k)
      } else take(k, r, sv, was) // new on the account, or changed there after this browser removed it
      continue
    }
    const h = hashOf(local)
    if (sv !== undefined && hashOf(sv) === h) {
      next.keys[k] = { r, h } // already the same value
    } else if (!was && sv !== undefined && k.startsWith(NOTES) && !(late && seen.has(k))) {
      // First contact with notes on both sides: nobody's notes are dropped. The
      // union (by id, newest first) is kept here and goes up.
      const merged = mergeNotes(local, sv)
      if (merged != null && put(k, merged)) {
        next.keys[k] = { r, h: hashOf(sv) }
        up.add(k)
      } else {
        if (local.length <= BACKUP_MAX_CHARS) backup[k] = local
        take(k, r, sv, was)
      }
    } else if (!was || was.x) {
      // First contact on this browser (or a copy a late answer left stale): the
      // ACCOUNT's copy wins. This browser's own is kept in BACKUP_KEY.
      if (sv !== undefined && !(late && seen.has(k)) && local.length <= BACKUP_MAX_CHARS) backup[k] = local
      take(k, r, sv, was)
    } else if (h === was.h) {
      // clean here: the account's copy is the newer one if its rev moved
      if (r !== was.r) take(k, r, sv, was)
      else next.keys[k] = { r, h }
    } else if (was.p === h && r !== was.r) {
      // this exact value was sent and the account has moved since: someone else
      // wrote after it (had it landed and stayed, the values would match above)
      take(k, r, sv, was)
    } else if (late && seen.has(k) && r !== was.r) {
      // changed here while the page ran on a copy the account had moved past:
      // that write may be the old copy saved back; the account's wins next load
      take(k, r, sv, was)
    } else {
      // changed here and not on the account (or the send never landed): it goes up
      next.keys[k] = was
      up.add(k)
    }
  }

  for (const k of keysHere()) {
    if (k in server || !isSyncedKey(k, me)) continue
    const local = get(k)
    if (local == null) continue
    const was = known[k]
    if (was && !reseed && was.r > 0 && !was.p && hashOf(local) === was.h) {
      // synced before, untouched here, gone from the account: deleted on another device
      if (late && seen.has(k)) next.keys[k] = was
      else {
        drop(k)
        pulled++
      }
    } else up.add(k) // new here, changed here, or re-seeding an emptied account
  }

  writeMeta(next)
  if (Object.keys(backup).length) {
    let old: Record<string, string> = {}
    try {
      old = (JSON.parse(get(BACKUP_KEY) ?? 'null') as { values?: Record<string, string> } | null)?.values ?? {}
    } catch {
      old = {}
    }
    // best effort: a browser short of room keeps the account's copy and no backup
    put(BACKUP_KEY, JSON.stringify({ at: new Date().toISOString(), user: me, values: { ...old, ...backup } }))
  }
  user = me
  if (typeof body.limits?.keyMaxBytes === 'number') keyMax = body.limits.keyMaxBytes
  tracking = false
  seen.clear()
  status = 'synced'
  // A late answer: what the page queued before it is decided by the rules above, not by the queue.
  if (late) pending.clear()
  for (const k of up) if (!held.has(k)) pending.add(k)
  if (late && (pulled || held.size)) console.info(`[prefs] ${pulled + held.size} account setting(s) apply on the next load`)
  if (pending.size) schedule(FIRST_PUSH_MS)
}

/** Two quick-jot note lists (shell/notes.tsx: [{ id, ts, … }], newest first) as one, or null if either is not a list. */
function mergeNotes(a: string, b: string): string | null {
  try {
    const x: unknown = JSON.parse(a)
    const y: unknown = JSON.parse(b)
    if (!Array.isArray(x) || !Array.isArray(y)) return null
    const byId = new Map<string, { id?: unknown; ts?: unknown }>()
    for (const n of [...y, ...x] as { id?: unknown; ts?: unknown }[]) if (n && typeof n.id === 'string') byId.set(n.id, n)
    return JSON.stringify([...byId.values()].sort((p, q) => Number(q.ts) - Number(p.ts)))
  } catch {
    return null
  }
}

function apply(res: PrefsBootResult, late: boolean): void {
  const body = res?.body as Partial<SyncBody> | null | undefined
  if (res?.status === 200 && body && typeof body.user === 'string' && body.keys && typeof body.keys === 'object') {
    try {
      reconcile(body as SyncBody, late)
    } catch (err) {
      status = 'local'
      console.warn('[prefs] could not apply the account settings', err)
    }
    return
  }
  if (res && (res.status === 401 || res.status === 403)) {
    status = 'signed-out'
    return
  }
  // offline, a deploy, the API down: this browser's copy for now, and ask again later
  status = 'local'
  if (retries < 3) setTimeout(() => void request().then((r) => apply(r, true)), [15_000, 60_000, 300_000][retries++])
}

function request(): Promise<PrefsBootResult> {
  const m = readMeta()
  const have: Record<string, number> = {}
  for (const [k, x] of Object.entries(m?.keys ?? {})) if (x.r > 0) have[k] = x.r
  return fetch(SYNC_URL, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: JSON_HEADERS,
    body: JSON.stringify({ u: m?.user ?? null, have }),
  }).then(
    (r) =>
      r.json().then(
        (body: unknown) => ({ status: r.status, body }),
        () => ({ status: r.status, body: null }),
      ),
    () => null,
  )
}

// ── Writes: localStorage up to the account ───────────────────────────────────

function noteWrite(key: string): void {
  if (tracking) seen.add(key)
  if (held.has(key) || !isSyncedKey(key, user)) return
  pending.add(key)
  if (status === 'synced') schedule()
}

/** Wrap Storage.prototype once (see "How a write travels"). The page's own reads are watched only until the sync lands. */
function wrapStorage(): void {
  if (!proto || !ls || !rawGet || !rawSet || !rawRemove) return
  const mark = proto as Storage & { __cbPrefs?: true }
  if (mark.__cbPrefs) return
  mark.__cbPrefs = true
  const store = ls
  const set = rawSet
  const remove = rawRemove
  const read = rawGet
  proto.setItem = function (this: Storage, key: string, value: string): void {
    if (frozen && this === store && isSyncedKey(String(key), user)) return
    set.call(this, key, value)
    if (this === store) noteWrite(String(key))
  }
  proto.removeItem = function (this: Storage, key: string): void {
    if (frozen && this === store && isSyncedKey(String(key), user)) return
    remove.call(this, key)
    if (this === store) noteWrite(String(key))
  }
  proto.getItem = function (this: Storage, key: string): string | null {
    if (tracking && this === store) seen.add(String(key))
    return read.call(this, key)
  }
}

let timer: ReturnType<typeof setTimeout> | null = null
let dueBy = 0
let inflight = false
let failures = 0

function schedule(ms = DEBOUNCE_MS): void {
  if (status !== 'synced') return
  const now = Date.now()
  if (!dueBy) dueBy = now + MAX_WAIT_MS
  if (timer) clearTimeout(timer)
  timer = setTimeout(
    () => {
      timer = null
      dueBy = 0
      void push(false)
    },
    Math.max(0, Math.min(ms, dueBy - now)),
  )
}

interface Batch {
  set: Record<string, string>
  del: string[]
  /** key → the hash sent ('-' for a delete) */
  sent: Record<string, string>
}

/** Take what is queued off the queue, as one request's worth, and mark it sent in META_KEY. */
function takeBatch(): Batch | null {
  if (status !== 'synced' || !user || !pending.size) return null
  const meta = readMeta()
  if (!meta || meta.user !== user) {
    // another tab signed a different account in on this browser
    freeze('account-changed')
    return null
  }
  const out: Batch = { set: {}, del: [], sent: {} }
  let chars = 0
  let touched = false
  for (const k of [...pending]) {
    const v = get(k)
    const was = meta.keys[k]
    if (held.has(k) || !isSyncedKey(k, user)) {
      pending.delete(k)
      continue
    }
    if (v == null) {
      pending.delete(k)
      if (was) {
        out.del.push(k)
        out.sent[k] = '-'
      }
      continue
    }
    const h = hashOf(v)
    if ((was && was.h === h && was.r > 0 && !was.p) || meta.skip?.[k] === h) {
      pending.delete(k) // rewritten with what the account already has, or a value it refused
      continue
    }
    if (overLimit(v, keyMax)) {
      // too big for the account: it stays in this browser, as before this module
      ;(meta.skip ??= {})[k] = h
      touched = true
      pending.delete(k)
      console.info(`[prefs] ${k}: too large, kept in this browser only`)
      continue
    }
    if (chars && chars + v.length > BATCH_CHARS) continue // the next push takes it
    pending.delete(k)
    out.set[k] = v
    out.sent[k] = h
    chars += v.length
  }
  const any = out.del.length > 0 || Object.keys(out.sent).length > 0
  for (const [k, h] of Object.entries(out.sent)) meta.keys[k] = { ...(meta.keys[k] ?? { r: 0, h: '' }), p: h }
  if (any || touched) writeMeta(meta)
  return any ? out : null
}

async function push(beacon: boolean): Promise<void> {
  if (inflight && !beacon) {
    schedule()
    return
  }
  const b = takeBatch()
  if (!b) return
  const body = JSON.stringify({ u: user, set: b.set, del: b.del })
  if (beacon) {
    // The page is going away and no answer will come back. The `p` marks just
    // written settle it on the next load.
    try {
      if (body.length <= BEACON_CHARS && navigator.sendBeacon?.(WRITE_URL, new Blob([body], { type: 'application/json' }))) return
      void fetch(WRITE_URL, { method: 'POST', credentials: 'same-origin', headers: JSON_HEADERS, body, keepalive: body.length <= BEACON_CHARS }).catch(() => {})
    } catch {
      /* the next load sends it */
    }
    return
  }
  inflight = true
  try {
    const r = await fetch(WRITE_URL, { method: 'POST', credentials: 'same-origin', headers: JSON_HEADERS, body })
    if (r.status === 409) {
      // this tab's account is no longer the session's: stop here
      freeze('account-changed')
      return
    }
    if (r.status === 401) {
      status = 'signed-out'
      pending.clear()
      return
    }
    if (r.status === 400 || r.status === 413) {
      // the account will never take this batch as it is: kept in this browser, not resent
      const meta = readMeta()
      if (meta && meta.user === user) {
        for (const [k, h] of Object.entries(b.sent)) {
          if (h === '-') continue
          ;(meta.skip ??= {})[k] = h
          if (meta.keys[k]?.r === 0) delete meta.keys[k]
          else if (meta.keys[k]) delete meta.keys[k].p
        }
        writeMeta(meta)
      }
      console.info(`[prefs] the account refused ${Object.keys(b.set).join(', ')} (HTTP ${r.status}); kept in this browser only`)
      return
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = (await r.json()) as { revs?: Record<string, number>; deleted?: string[]; rejected?: Record<string, string> }
    const meta = readMeta()
    if (!meta || meta.user !== user) return
    for (const [k, rev] of Object.entries(j.revs ?? {})) {
      const h = b.sent[k]
      if (!h) continue
      const cur = meta.keys[k]
      // a later send of this key (another tab, a beacon) keeps its own pending mark
      meta.keys[k] = cur?.p && cur.p !== h ? { r: rev, h, p: cur.p } : { r: rev, h }
      if (meta.skip) delete meta.skip[k]
    }
    for (const k of j.deleted ?? []) if (meta.keys[k]?.p === '-') delete meta.keys[k]
    for (const [k, why] of Object.entries(j.rejected ?? {})) {
      const h = b.sent[k]
      if (!h || h === '-') continue
      ;(meta.skip ??= {})[k] = h
      if (meta.keys[k]?.r === 0) delete meta.keys[k]
      else if (meta.keys[k]) delete meta.keys[k].p
      console.info(`[prefs] ${k}: ${why}, kept in this browser only`)
    }
    writeMeta(meta)
    failures = 0
  } catch {
    // offline, a deploy, a 5xx: back in the queue, tried again further apart each time
    for (const k of Object.keys(b.sent)) pending.add(k)
    failures++
    setTimeout(() => schedule(0), Math.min(300_000, 5000 * 2 ** Math.min(failures, 6)))
  } finally {
    inflight = false
    if (pending.size && failures === 0) schedule()
  }
}

// ── Public ───────────────────────────────────────────────────────────────────

export function prefsStatus(): PrefsStatus {
  return status
}

/** Send what is queued now (a "save" button, the console). */
export function flushPrefs(): Promise<void> {
  return push(false)
}

// ── Boot (module scope, on purpose: see the header) ─────────────────────────

function start(): void {
  if (!ls || !proto) {
    status = 'local'
    return
  }
  wrapStorage()
  const b = (window as Window & { __CB_BOOT__?: CbBoot }).__CB_BOOT__
  if (b && b.prefsResult !== undefined) apply(b.prefsResult, false)
  else if (b?.prefs) void b.prefs.then((r) => apply(r, true), () => apply(null, true))
  else void request().then((r) => apply(r, true))
  // another tab signed a different account in on this browser: this one stops writing synced keys
  window.addEventListener('storage', (e) => {
    if (e.key !== META_KEY || !user || frozen) return
    const m = readMeta()
    if (m && m.user !== user) freeze('account-changed')
  })
  window.addEventListener('pagehide', () => void push(true))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void push(true)
  })
}

start()
