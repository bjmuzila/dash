// ─────────────────────────────────────────────────────────────────────────────
// VOLT WATCH: one line at the top of the page, the open watchlist's tickers
// stepping past one at a time, each with where its ★ Volt is and how far price is
// from it (Brandon, 2026-10-07: "a scrolling bar of the tickers in the watchlist
// and where their volt is and how far away it is"; direction C of the mockup
// canvas "Vela Volt Ticker Strip"). It replaced the session stats strip
// (setups/SessionStrip.tsx, no longer mounted) in the same spot and on the same
// switch. Called "Tape scroll" for a day; renamed 2026-10-08 when it went from a
// continuous scroll to STEP motion ("it's not a scroll"). The file keeps its name.
// DESKTOP ONLY ("no mobile for this"): Vela.tsx never mounts it on the phone build.
//
//   ★ VOLT WATCH 2 AT · 4 NEAR │ [−0.04%] NQ ★ 27,550 −10.50 │ [+0.14%] AMD ★ 215 … ✕
//
// ── Each chip ────────────────────────────────────────────────────────────────
//   distance %   (Volt − price) / price: + = the Volt is above price
//   ticker
//   ★ Volt       Level Alerts' read (levels/levelAlerts.ts levelsFor): CORE, the
//                top net GEX, on the page's GEX switch — the same number the
//                legend card's LEVELS row shows for that ticker
//   points       Volt − price
// The distance reads three ways: FAR (over NEAR_PCT) plain; NEAR (within
// NEAR_PCT) in Volt gold; AT (within AT_PCT) a filled gold pill. A ticker whose
// price went through its Volt wears a pulsing gold ring for CROSS_MS. No Volt
// (VIX, a name the chain does not cover) says so and sorts last.
// Hover a chip: the paging pauses, and its tooltip lists all four levels.
// Click: the active chart switches to that ticker.
//
// ── Order (setups.ts tapeSort; Workspace → Volt watch order) ─────────────────
//   Nearest   closest Volt first (the default). The order is taken when a round
//             of level reads lands (every LEVELS_MS), not on every quote, and the
//             line starts again from its first chip then.
//   A–Z       alphabetical
// The switch lives in the Workspace menu, not on the line (2026-10-08).
//
// ── Reads ────────────────────────────────────────────────────────────────────
// Prices: /api/quotes-batch through the watchlist store (refreshQuotes), every
// QUOTES_MS while the tab is visible. Volts: levelsFor per ticker (50 s shared
// cache), READS_AT_ONCE at a time, every LEVELS_MS, and again when the GEX
// switch moves. At most MAX_TAPE tickers, the list's first.
//
// ── Motion: PAGES OF TEN ─────────────────────────────────────────────────────
// Ten chips at a time, in ten even columns across the line; every PAGE_MS the
// whole ten swap for the next ten (a short fade, nothing slides). Brandon,
// 2026-10-08: "it should show 10 at a time, then the next 10 appear. I don't
// want scrolling on it" — replacing the one-chip step of that morning. The head
// shows which page (2/4). Ten or fewer tickers: one page, nothing changes. Paused
// while the pointer or focus is on it, or the tab is hidden. A narrow chip drops
// its points first (the % already says how far), via a container query.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { PROVIDER_NAME } from '@/pages/vela/cbedgeProvider'
import { onGexBasis } from '@/pages/vela/gexBasis'
import { levelsFor } from '@/pages/vela/levels/levelAlerts'
import { markSvg } from '@/pages/vela/levelMarks'
import { onStrip, tapeSort } from '@/pages/vela/setups/setups'
import { activeList, onWatchlist, quoteOf, refreshQuotes } from '@/pages/vela/watchlist/store'

const MAX_TAPE = 40
const QUOTES_MS = 15_000
const LEVELS_MS = 60_000
const READS_AT_ONCE = 3
/** Within this % of the Volt: AT (the gold pill). */
const AT_PCT = 0.15
/** Within this %: NEAR (gold figures). */
const NEAR_PCT = 0.35
/** How long a crossing keeps its ring. */
const CROSS_MS = 5 * 60_000
/** Chips on the line at once. */
const PAGE = 10
/** How long each ten stays up. */
const PAGE_MS = 8000

interface Lv {
  volt: number | null
  coil: number | null
  reversal: number | null
  flip: number | null
  /** The read's own last price (the 5-minute bar), when there is no quote. */
  price: number | null
}

type St = 'wait' | 'none' | 'far' | 'near' | 'at'

interface ChipVals {
  s: string
  st: St
  pct: string
  volt: string
  pts: string
  crossed: boolean
  tip: string
}

const fmt = (v: number, d: number) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const lvlText = (v: number) => fmt(v, Number.isInteger(v) ? 0 : 2)
const signed = (v: number, d: number) => `${v >= 0 ? '+' : '−'}${fmt(Math.abs(v), d)}`

function Chip({ c, onOpen }: { c: ChipVals; onOpen: (s: string) => void }) {
  return (
    <button
      type="button"
      className="cb-tape-chip"
      data-st={c.st}
      data-x={c.crossed ? '1' : undefined}
      title={c.tip}
      onClick={() => onOpen(c.s)}
    >
      {c.st === 'wait' || c.st === 'none' ? (
        <>
          <span className="cb-tape-t">{c.s}</span>
          <span className="cb-tape-none">{c.st === 'wait' ? '·' : 'no level yet'}</span>
        </>
      ) : (
        <>
          <span className="cb-tape-pct">{c.pct}</span>
          <span className="cb-tape-t">{c.s}</span>
          {/* constant markup from levelMarks.ts: the Volt's reserved colour comes with it */}
          <span className="cb-mk-box" dangerouslySetInnerHTML={{ __html: markSvg('volt') }} />
          <span className="cb-tape-v">{c.volt}</span>
          <span className="cb-tape-pts">{c.pts}</span>
        </>
      )}
    </button>
  )
}

export default function TapeScroll({ ws, onHide }: { ws: VelaWorkspace; onHide: () => void }) {
  const symKey = useSyncExternalStore(onWatchlist, () => activeList().symbols.slice(0, MAX_TAPE).join(','))
  const syms = useMemo(() => (symKey ? symKey.split(',') : []), [symKey])
  const sort = useSyncExternalStore(onStrip, tapeSort)
  const [levels, setLevels] = useState<ReadonlyMap<string, Lv>>(() => new Map())
  /** Bumped when a round of level reads lands: the NEAREST order is taken then. */
  const [round, setRound] = useState(0)
  /** Bumped when the GEX switch moves: every Volt is read again. */
  const [gexRev, setGexRev] = useState(0)
  const [, setTick] = useState(0)
  /** Which side of its Volt each ticker was on (for the crossing ring). */
  const sides = useRef(new Map<string, { side: number; volt: number; crossedAt: number }>())

  // quotes land through the watchlist store: repaint the distances
  useEffect(() => onWatchlist(() => setTick((n) => n + 1)), [])
  useEffect(() => onGexBasis(() => setGexRev((n) => n + 1)), [])

  // prices
  useEffect(() => {
    if (!syms.length) return
    const go = () => {
      if (!document.hidden) void refreshQuotes(syms)
    }
    // the first read happens even in a background tab: Volt watch is never left empty
    void refreshQuotes(syms)
    const t = setInterval(go, QUOTES_MS)
    // back in view: read now, not at the next tick
    const onVis = () => {
      if (!document.hidden) go()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [syms])

  // Volts
  useEffect(() => {
    let alive = true
    let reading = false
    const readAll = async (fresh: boolean, force = false) => {
      if ((document.hidden && !force) || !syms.length || reading) return
      reading = true
      const queue = [...syms]
      const worker = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const sym = next
          const r = await levelsFor(sym, fresh).catch(() => null)
          if (!alive) return
          const at = (k: string) => r?.levels.find((l) => l.key === k)?.price ?? null
          const lv: Lv = { volt: at('volt'), coil: at('coil'), reversal: at('reversal'), flip: at('flip'), price: r?.price ?? null }
          setLevels((m) => new Map(m).set(sym, lv))
        }
      }
      await Promise.all(Array.from({ length: Math.min(READS_AT_ONCE, queue.length) }, worker))
      reading = false
      if (alive) setRound((n) => n + 1)
    }
    // the first round runs even in a background tab (2026-10-08: a tab opened behind
    // another sat on "·" for every ticker until it was looked at and a minute passed)
    void readAll(false, true)
    const t = setInterval(() => void readAll(true), LEVELS_MS)
    // back in view: read now, not at the next tick
    const onVis = () => {
      if (!document.hidden) void readAll(true)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      alive = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [syms, gexRev])

  const priceOf = (s: string): number | null => quoteOf(s)?.last ?? levels.get(s)?.price ?? null
  const distPct = (s: string): number | null => {
    const v = levels.get(s)?.volt
    const p = priceOf(s)
    return v != null && p != null && p > 0 ? ((v - p) / p) * 100 : null
  }

  // The order: A–Z, or nearest first as of the last round of reads (see the header).
  const order = useMemo(() => {
    const az = [...syms].sort((a, b) => a.localeCompare(b))
    if (sort === 'az') return az
    const d = new Map(az.map((s) => [s, distPct(s)]))
    return az.sort((a, b) => {
      const x = d.get(a)
      const y = d.get(b)
      if (x == null) return y == null ? 0 : 1
      if (y == null) return -1
      return Math.abs(x) - Math.abs(y)
    })
    // distPct reads the levels and quotes as they are now; re-taken per round on purpose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syms, sort, round])

  const now = Date.now()
  const chips: ChipVals[] = order.map((s) => {
    const lv = levels.get(s)
    const p = priceOf(s)
    const v = lv?.volt ?? null
    if (!lv || v == null || p == null) {
      return { s, st: lv ? 'none' : 'wait', pct: '', volt: '', pts: '', crossed: false, tip: lv ? `${s}: no Volt for this ticker yet` : `${s}: reading its levels…` }
    }
    const pts = v - p
    const pct = (pts / p) * 100
    const a = Math.abs(pct)
    const st: St = a <= AT_PCT ? 'at' : a <= NEAR_PCT ? 'near' : 'far'
    // the crossing ring: price changed sides of the SAME Volt (a Volt that moved is not a cross)
    const side = p >= v ? 1 : -1
    const prev = sides.current.get(s)
    let crossedAt = prev?.crossedAt ?? 0
    if (prev && prev.volt === v && prev.side !== side) crossedAt = now
    if (!prev || prev.side !== side || prev.volt !== v || prev.crossedAt !== crossedAt) sides.current.set(s, { side, volt: v, crossedAt })
    const crossed = crossedAt > 0 && now - crossedAt < CROSS_MS
    const line = (name: string, x: number | null) => (x == null ? null : `${name} ${lvlText(x)}  (${signed(x - p, 2)})`)
    const tip = [
      `${s} ${fmt(p, 2)}`,
      line('Volt', v),
      line('Coil', lv.coil),
      line('Reversal', lv.reversal),
      line('Flip', lv.flip),
      crossed ? `Crossed its Volt ${Math.max(1, Math.round((now - crossedAt) / 60_000))} min ago` : null,
      'Click to open on the active chart',
    ]
      .filter(Boolean)
      .join('\n')
    return { s, st, pct: `${signed(pct, 2)}%`, volt: lvlText(v), pts: signed(pts, 2), crossed, tip }
  })
  const atN = chips.filter((c) => c.st === 'at').length
  const nearN = chips.filter((c) => c.st === 'near').length

  const open = (s: string) => ws.active.setSymbol(`${PROVIDER_NAME}:${s}`)

  // ── pages of ten (see the header) ──
  const paused = useRef(false)
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(chips.length / PAGE))
  const p = page % pages
  const shown = chips.slice(p * PAGE, p * PAGE + PAGE)

  // a new order (a round of reads, the order switch, the list) starts from page one
  const orderKey = order.join(',')
  useEffect(() => setPage(0), [orderKey])

  useEffect(() => {
    if (pages < 2) return
    const t = setInterval(() => {
      if (!paused.current && !document.hidden) setPage((n) => (n + 1) % pages)
    }, PAGE_MS)
    return () => clearInterval(t)
  }, [pages])
  const pause = (on: boolean) => () => {
    paused.current = on
  }

  return (
    <div className="cb-strip cb-tape" role="region" aria-label="Volt watch: the watchlist's Volts">
      <div className="cb-tape-head" title={`At the Volt: within ${AT_PCT}%. Near: within ${NEAR_PCT}%.`}>
        <span className="cb-mk-box" dangerouslySetInnerHTML={{ __html: markSvg('volt') }} />
        <span className="cb-tape-cap">VOLT WATCH</span>
        <span className="cb-tape-n" data-k="at">
          {atN} AT
        </span>
        <span className="cb-tape-cap">·</span>
        <span className="cb-tape-n">{nearN} NEAR</span>
        {pages > 1 && (
          <span className="cb-tape-pg" title={`Ten at a time: page ${p + 1} of ${pages}`}>
            {p + 1}/{pages}
          </span>
        )}
      </div>

      <div className="cb-tape-win" onMouseEnter={pause(true)} onMouseLeave={pause(false)} onFocus={pause(true)} onBlur={pause(false)}>
        {/* keyed by page: each new ten mounts fresh and fades in */}
        <div key={p} className="cb-tape-page">
          {shown.length ? (
            shown.map((c) => <Chip key={c.s} c={c} onOpen={open} />)
          ) : (
            <span className="cb-tape-empty">Add tickers to the watchlist to fill Volt watch</span>
          )}
        </div>
      </div>

      <div className="cb-tape-ctl">
        <button type="button" className="cb-vt-x cb-tape-x" onClick={onHide} title="Hide Volt watch (Workspace → Volt watch brings it back)" aria-label="Hide Volt watch">
          ✕
        </button>
      </div>
    </div>
  )
}
