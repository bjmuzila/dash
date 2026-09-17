// ─────────────────────────────────────────────────────────────────────────────
// THE CHAIN PAGE'S DATA LAYER.
//
// One hook, so the render layer below it is only render. Three things it is
// deliberately built around:
//
//  1. NO WATERFALL AT ENTRY (v3 non-negotiable #3). The seed chain and the
//     expiration list go out TOGETHER. The seed — /api/chains with no
//     `expiration` — carries the nearest three expiries in one payload, so the
//     front expiry is on screen off the first response and the expiration list
//     only decides what the ACCORDION offers, not what is drawn.
//  2. AN EXPIRY LOADS ONCE, WHEN IT IS OPENED. Expanding a row is the request.
//     A chain page that pre-fetched sixty expirations would be sixty round trips
//     for a screen that shows one.
//  3. THE OLD BOOK STAYS ON SCREEN. A poll that fails, or a refetch in flight,
//     never blanks a loaded expiry — it repaints when the new one lands. Same
//     rule data/api.ts applies to a failed poll, for the same reason.
//
// REST + poll, no socket: there is no per-contract frame on /ws/gex to bind, so
// this reads data/api.ts and not data/hooks.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isSessionLive, isSpxFeedLive } from '@/pages/optionsChain/marketSession'
import {
  expiryMeta,
  fetchExpirations,
  fetchExpiry,
  fetchSeed,
  type ChainBook,
  type ExpiryMeta,
} from './chainBook'

/** Quotes drift all session; 20s sits inside the server's own 30s chain cache,
 *  so repeats across clients are absorbed there rather than hitting the feed. */
const POLL_MS = 20_000

export interface ChainBookState {
  /** Every expiry the symbol lists, nearest first. */
  expiries: ExpiryMeta[]
  /** Loaded books, keyed by expiration. */
  books: Record<string, ChainBook>
  /** Expiries the accordion has expanded. */
  open: string[]
  /** Expiries with a request in flight. */
  pending: string[]
  underlying: number
  /** Set only when there is nothing on screen — a failed poll keeps the book. */
  error: string
  /** ms epoch of the last successful load, for the toolbar clock. */
  updatedAt: number
  booting: boolean
  toggle: (expiration: string) => void
  refresh: () => Promise<void>
}

export function useChainBook(symbol: string): ChainBookState {
  const ticker = symbol.toUpperCase()

  const [expiries, setExpiries] = useState<ExpiryMeta[]>([])
  const [books, setBooks] = useState<Record<string, ChainBook>>({})
  const [open, setOpen] = useState<string[]>([])
  const [pending, setPending] = useState<string[]>([])
  const [underlying, setUnderlying] = useState(0)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(0)
  const [booting, setBooting] = useState(true)

  // The load generation. Every async result checks it before writing state, so
  // a response for the PREVIOUS ticker can never paint under the new one — the
  // book map is keyed by expiration alone, with no symbol in the key, which is
  // exactly the shape that goes wrong silently. (The GEX matrix carries the
  // same guard on its ΔOI snapshot, for the same reason.)
  const genRef = useRef(0)
  // Read by the poll and by `toggle`, which must not branch on state it closed
  // over — and must not put a fetch inside a state updater, which React may run
  // twice.
  const openRef = useRef<string[]>([])
  const booksRef = useRef<Record<string, ChainBook>>({})
  useEffect(() => {
    openRef.current = open
  }, [open])
  useEffect(() => {
    booksRef.current = books
  }, [books])

  const mark = useCallback((exp: string, on: boolean) => {
    setPending((p) => (on ? (p.includes(exp) ? p : [...p, exp]) : p.filter((e) => e !== exp)))
  }, [])

  // ── One expiry ─────────────────────────────────────────────────────────────
  const load = useCallback(
    async (exp: string, bust: boolean) => {
      const gen = genRef.current
      mark(exp, true)
      try {
        const { book, underlying: px } = await fetchExpiry(ticker, exp, bust)
        if (gen !== genRef.current) return
        if (px > 0) setUnderlying(px)
        if (book) {
          const next = { ...book, expiration: exp }
          booksRef.current = { ...booksRef.current, [exp]: next }
          setBooks(booksRef.current)
          setUpdatedAt(Date.now())
          setError('')
        }
      } finally {
        if (gen === genRef.current) mark(exp, false)
      }
    },
    [ticker, mark],
  )

  // ── Entry: seed + expirations, in parallel ─────────────────────────────────
  useEffect(() => {
    const gen = ++genRef.current
    booksRef.current = {}
    openRef.current = []
    setBooks({})
    setOpen([])
    setPending([])
    setExpiries([])
    setError('')
    setBooting(true)

    void (async () => {
      const [seed, list] = await Promise.all([fetchSeed(ticker), fetchExpirations(ticker)])
      if (gen !== genRef.current) return

      // The listing is authoritative for WHAT the symbol trades; the seed is
      // authoritative for what is already loaded. A seed expiry missing from
      // the listing still gets a row rather than being dropped.
      const merged = new Map<string, ExpiryMeta>()
      for (const e of list) merged.set(e.value, e)
      for (const b of seed.books) {
        if (!merged.has(b.expiration)) merged.set(b.expiration, expiryMeta(b.expiration))
      }
      const ordered = [...merged.values()].sort((a, b) => a.value.localeCompare(b.value))

      const loaded: Record<string, ChainBook> = {}
      for (const b of seed.books) loaded[b.expiration] = b

      booksRef.current = loaded
      setExpiries(ordered)
      setBooks(loaded)
      setUnderlying(seed.underlying)
      setBooting(false)

      if (!seed.books.length && !ordered.length) {
        setError(`No chain returned for ${ticker}.`)
        return
      }
      setUpdatedAt(Date.now())

      const front = seed.books[0]?.expiration ?? ordered[0]?.value ?? ''
      if (!front) return
      openRef.current = [front]
      setOpen([front])
      // A front expiry the seed did not carry (a symbol whose nearest listing
      // the no-expiration call skipped) is fetched rather than opened empty.
      if (!loaded[front]) void load(front, false)
    })()
  }, [ticker, load])

  const toggle = useCallback(
    (exp: string) => {
      const isOpen = openRef.current.includes(exp)
      const next = isOpen ? openRef.current.filter((e) => e !== exp) : [...openRef.current, exp]
      openRef.current = next
      setOpen(next)
      if (!isOpen && !booksRef.current[exp]) void load(exp, false)
    },
    [load],
  )

  const refresh = useCallback(async () => {
    const targets = openRef.current
    if (!targets.length) return
    await Promise.all(targets.map((e) => load(e, true)))
  }, [load])

  // ── Poll ───────────────────────────────────────────────────────────────────
  // SPX rides the ~24/5 feed; everything else is RTH-only, where after the bell
  // the book is frozen and re-asking is pure egress. Hidden tabs are skipped for
  // the same reason api.ts skips them.
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      const live = ticker === 'SPX' ? isSpxFeedLive() : isSessionLive()
      if (!live) return
      for (const exp of openRef.current) void load(exp, false)
    }, POLL_MS)
    return () => clearInterval(id)
  }, [ticker, load])

  return useMemo(
    () => ({
      expiries,
      books,
      open,
      pending,
      underlying,
      error,
      updatedAt,
      booting,
      toggle,
      refresh,
    }),
    [expiries, books, open, pending, underlying, error, updatedAt, booting, toggle, refresh],
  )
}
