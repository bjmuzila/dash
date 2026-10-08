// ─────────────────────────────────────────────────────────────────────────────
// TAPE SCROLL: one line at the top of the page, the open watchlist's tickers
// scrolling past, each with where its ★ Volt is and how far price is from it
// (Brandon, 2026-10-07: "a scrolling bar of the tickers in the watchlist and
// where their volt is and how far away it is"; direction C of the mockup canvas
// "Vela Volt Ticker Strip"). It replaced the session stats strip
// (setups/SessionStrip.tsx, no longer mounted) in the same spot and on the same
// switch. DESKTOP ONLY ("no mobile for this"): Vela.tsx never mounts it on the
// phone build.
//
//   ★ VOLT WATCH 2 AT · 4 NEAR │ [−0.04%] NQ ★ 27,550 −10.50 │ [+0.14%] AMD ★ 215 … │ SORT [A–Z][NEAREST] ✕
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
// Hover a chip: the tape pauses, and its tooltip lists all four levels. Click:
// the active chart switches to that ticker.
//
// ── Sort (setups.ts tapeSort) ────────────────────────────────────────────────
//   A–Z       alphabetical
//   NEAREST   closest Volt first (the default). The order is taken when a round
//             of level reads lands (every LEVELS_MS), not on every quote, so the
//             tape does not reshuffle under your eye every 15 seconds.
//
// ── Reads ────────────────────────────────────────────────────────────────────
// Prices: /api/quotes-batch through the watchlist store (refreshQuotes), every
// QUOTES_MS while the tab is visible. Volts: levelsFor per ticker (50 s shared
// cache), READS_AT_ONCE at a time, every LEVELS_MS, and again when the GEX
// switch moves. At most MAX_TAPE tickers, the list's first.
//
// ── Motion ───────────────────────────────────────────────────────────────────
// It scrolls only when the chips are wider than the line (two copies, the track
// sliding half its width, SPEED px a second); a short list just sits there.
// Reduced motion: no scroll, the line scrolls by hand instead.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { PROVIDER_NAME } from '@/pages/vela/cbedgeProvider'
import { onGexBasis } from '@/pages/vela/gexBasis'
import { levelsFor } from '@/pages/vela/levels/levelAlerts'
import { markSvg } from '@/pages/vela/levelMarks'
import { onStrip, setTapeSort, tapeSort } from '@/pages/vela/setups/setups'
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
/** Scroll speed, px a second. */
const SPEED = 40

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

function Chip({ c, copy, onOpen }: { c: ChipVals; copy?: boolean; onOpen: (s: string) => void }) {
  return (
    <button
      type="button"
      className="cb-tape-chip"
      data-st={c.st}
      data-x={c.crossed ? '1' : undefined}
      tabIndex={copy ? -1 : undefined}
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
    go()
    const t = setInterval(go, QUOTES_MS)
    return () => clearInterval(t)
  }, [syms])

  // Volts
  useEffect(() => {
    let alive = true
    const readAll = async (fresh: boolean) => {
      if (document.hidden || !syms.length) return
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
      if (alive) setRound((n) => n + 1)
    }
    void readAll(false)
    const t = setInterval(() => void readAll(true), LEVELS_MS)
    return () => {
      alive = false
      clearInterval(t)
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

  // scroll only when the chips are wider than the line (see the header)
  const winRef = useRef<HTMLDivElement>(null)
  const setRef = useRef<HTMLDivElement>(null)
  const [run, setRun] = useState<{ on: boolean; dur: number }>({ on: false, dur: 0 })
  useLayoutEffect(() => {
    const win = winRef.current
    const set = setRef.current
    if (!win || !set) return
    const measure = () => {
      const w = set.offsetWidth
      const on = w > win.clientWidth + 1
      // whole 5 s steps: a digit's worth of width must not restart the slide
      const dur = Math.max(20, Math.round(w / SPEED / 5) * 5)
      setRun((r) => (r.on === on && r.dur === dur ? r : { on, dur }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(win)
    ro.observe(set)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="cb-strip cb-tape" role="region" aria-label="Tape scroll: the watchlist's Volts">
      <div className="cb-tape-head" title={`At the Volt: within ${AT_PCT}%. Near: within ${NEAR_PCT}%.`}>
        <span className="cb-mk-box" dangerouslySetInnerHTML={{ __html: markSvg('volt') }} />
        <span className="cb-tape-cap">VOLT WATCH</span>
        <span className="cb-tape-n" data-k="at">
          {atN} AT
        </span>
        <span className="cb-tape-cap">·</span>
        <span className="cb-tape-n">{nearN} NEAR</span>
      </div>

      <div ref={winRef} className="cb-tape-win">
        <div className={`cb-tape-track${run.on ? ' is-run' : ''}`} style={run.on ? { animationDuration: `${run.dur}s` } : undefined}>
          <div ref={setRef} className="cb-tape-set">
            {chips.length ? (
              chips.map((c) => <Chip key={c.s} c={c} onOpen={open} />)
            ) : (
              <span className="cb-tape-empty">Add tickers to the watchlist to fill the tape</span>
            )}
          </div>
          {run.on && (
            <div className="cb-tape-set cb-tape-copy" aria-hidden="true">
              {chips.map((c) => (
                <Chip key={c.s} c={c} copy onOpen={open} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="cb-tape-ctl">
        <span className="cb-tape-cap">SORT</span>
        <div className="cb-tape-seg" role="group" aria-label="Sort the tape">
          <button type="button" aria-pressed={sort === 'az'} onClick={() => setTapeSort('az')}>
            A–Z
          </button>
          <button type="button" aria-pressed={sort === 'near'} onClick={() => setTapeSort('near')}>
            NEAREST
          </button>
        </div>
        <button
          type="button"
          className="cb-vt-x cb-tape-x"
          onClick={onHide}
          title="Hide the tape (Workspace → Tape scroll brings it back)"
          aria-label="Hide the tape"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
