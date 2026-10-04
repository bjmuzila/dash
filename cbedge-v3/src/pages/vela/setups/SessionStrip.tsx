// ─────────────────────────────────────────────────────────────────────────────
// THE SESSION STATS STRIP: one line above the chart for the active chart's
// symbol, and the numbers a trader checks before every entry.
//
//   SPX 6,732.94 +0.21%   price, and the change from the prior close: PHONE ONLY.
//                         On the desktop the top bar's ticker chip
//                         (symbolPicker.ts) shows them, so the strip leaves them
//                         out (Brandon, 2026-10-04); the price is still read
//                         for the distances and the EM used.
//   ON 6,705–6,731 (26)   the overnight range (futures from 18:00, stocks from
//                         04:00; none for an index)
//   IB 17.5 · 0.8× avg    today's initial balance (09:30–10:30) against its
//                         average over the last 20 sessions; "forming" until 10:30
//   ★ VOLT +17.1 · ◆ COIL −7.9 · ↘ REV −32.9 · ⚡︎ FLIP +4.0
//                         PHONE ONLY: on the desktop each chart's legend card
//                         (legend/legendCard.ts) carries the levels (Brandon,
//                         2026-10-04). Distance from price to each Voltick level
//                         (Level Alerts' read: the Volt is CORE, the top net GEX;
//                         the Coil the 2nd top on the Volt's side of price; the
//                         Reversal the top across price; the flip, all off the
//                         front chain's live ladder), positive = above.
//                         Each mark DRAWN in its reserved colour (levelMarks.ts:
//                         typed, Windows showed them as emoji), the word in Paper.
//   EM ±41.2 · 62% used   the day's frozen expected move and how much of it the
//                         move from the prior close has used
//
// Refreshed every 30 s, the price on every tick of the active chart. Workspace →
// Session stats strip (desktop) or ⋮ → Session stats (phone) hides or shows it
// (off by default on the phone). It hides itself during a bar replay: its
// numbers are live ones.
//
// Voltick's type: every number in mono, every label a mono uppercase caption in
// Paper Quiet (never a dimmed Paper), green / red on the change figures only.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { OHLCV } from '@luxalgo/vela'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'
import { query } from '@/data/api'
import { dailyEmUrl, parseDailyEm, type DailyEmBand } from '@/data/dailyEm'
import { CbEdgeProvider, resolveSym } from '@/pages/vela/cbedgeProvider'
import { etDateKey, etMinutesOfDay } from '@/pages/vela/studies/common'
import { levelsFor } from '@/pages/vela/levels/levelAlerts'
import { markSvg, type MarkKey } from '@/pages/vela/levelMarks'
import { replayStore } from '@/pages/vela/replay/replay'

const provider = new CbEdgeProvider()
const bare = (s: string | undefined) => (s ?? '').replace(/^[^:]*:/, '').trim().toUpperCase()

interface Stats {
  sym: string
  prevClose: number | null
  on: { hi: number; lo: number } | null
  ib: { size: number; avg: number | null; forming: boolean } | null
  levels: { volt: number | null; coil: number | null; reversal: number | null; flip: number | null }
  em: DailyEmBand | null
}

const rth = (b: OHLCV) => {
  const m = etMinutesOfDay(b.time)
  return m >= 570 && m < 960
}

async function readStats(sym: string): Promise<{ stats: Stats; last: number | null }> {
  const r = resolveSym(sym)
  const fut = r.kind === 'futures'
  const [bars, lv, emJson] = await Promise.all([
    provider.getBars(sym, '5', { session: r.kind === 'index' ? 'regular' : 'extended' }).catch(() => [] as OHLCV[]),
    levelsFor(sym).catch(() => null),
    query<unknown>(dailyEmUrl(r.fut === 'NQ' ? 'NDX' : r.fut === 'ES' ? 'SPX' : r.key), { staleMs: 300_000 }).catch(() => null),
  ])
  const last = bars.length ? bars[bars.length - 1]!.close : null
  const today = bars.length ? etDateKey(bars[bars.length - 1]!.time) : etDateKey(Date.now())
  const days = [...new Set(bars.filter(rth).map((b) => etDateKey(b.time)))]
  const prevDay = days.filter((d) => d < today).pop()
  const prevBars = prevDay ? bars.filter((b) => rth(b) && etDateKey(b.time) === prevDay) : []
  const prevClose = prevBars.length ? prevBars[prevBars.length - 1]!.close : null
  // overnight
  const pre = bars.filter((b) => {
    const d = etDateKey(b.time)
    const m = etMinutesOfDay(b.time)
    if (fut) return (d === today && m < 570) || (d === prevDay && m >= 18 * 60)
    return d === today && m < 570
  })
  const on = pre.length ? { hi: Math.max(...pre.map((b) => b.high)), lo: Math.min(...pre.map((b) => b.low)) } : null
  // IB and its 20-session average
  const ibOf = (d: string) => {
    const xs = bars.filter((b) => rth(b) && etDateKey(b.time) === d && etMinutesOfDay(b.time) < 630)
    return xs.length ? Math.max(...xs.map((b) => b.high)) - Math.min(...xs.map((b) => b.low)) : null
  }
  const todayRth = bars.filter((b) => rth(b) && etDateKey(b.time) === today)
  const past = days.filter((d) => d < today).slice(-20).map(ibOf).filter((v): v is number => v != null && v > 0)
  const ibNow = ibOf(today)
  const ib = ibNow != null ? { size: ibNow, avg: past.length ? past.reduce((a, b) => a + b, 0) / past.length : null, forming: !todayRth.some((b) => etMinutesOfDay(b.time) >= 630) } : null
  const pick = (k: string) => lv?.levels.find((l) => l.key === k)?.price ?? null
  const em = parseDailyEm(emJson)
  return {
    stats: { sym, prevClose, on, ib, levels: { volt: pick('volt'), coil: pick('coil'), reversal: pick('reversal'), flip: pick('flip') }, em: em && em.date === today ? em : null },
    last,
  }
}

const num = (v: number, d = 2) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const sgn = (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`
const toneCls = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-fg')

/** Voltick's four levels as the strip names them: the drawn mark, the chip code. */
const VT_ITEMS: ReadonlyArray<{ key: MarkKey; code: string; name: string }> = [
  { key: 'volt', code: 'VOLT', name: 'Volt' },
  { key: 'coil', code: 'COIL', name: 'Coil' },
  { key: 'reversal', code: 'REV', name: 'Reversal' },
  { key: 'flip', code: 'FLIP', name: 'Flip' },
]

function Item({ label, mark, children, title }: { label: string; mark?: MarkKey; children: React.ReactNode; title: string }) {
  return (
    <span className="flex shrink-0 items-baseline gap-1" title={title}>
      {/* constant markup from levelMarks.ts: the mark's reserved colour comes with it */}
      {mark && <span className="cb-mk-box" dangerouslySetInnerHTML={{ __html: markSvg(mark) }} />}
      <span className="font-mono text-3xs font-semibold uppercase tracking-[0.08em] text-faint">{label}</span>
      <span className="tabular font-mono text-2xs font-extrabold text-fg">{children}</span>
    </span>
  )
}

export default function SessionStrip({
  ws,
  onHide,
  showTicker = true,
  showLevels = true,
}: {
  ws: VelaWorkspace
  onHide: () => void
  showTicker?: boolean
  showLevels?: boolean
}) {
  const replay = useSyncExternalStore(replayStore.subscribe, replayStore.get)
  const [sym, setSym] = useState(() => bare(ws.chart.market.symbol))
  const [stats, setStats] = useState<Stats | null>(null)
  const [price, setPrice] = useState<number | null>(null)

  // follow the active chart's symbol
  useEffect(() => {
    const upd = () => setSym(bare(ws.chart.market.symbol))
    const offs = [ws.on('cell:active', upd), ws.on('state:changed', upd)]
    return () => {
      for (const off of offs) off()
    }
  }, [ws])

  // the numbers, every 30 s
  useEffect(() => {
    let alive = true
    setStats(null)
    const load = () =>
      void readStats(sym).then((r) => {
        if (!alive) return
        setStats(r.stats)
        if (r.last != null) setPrice((p) => p ?? r.last)
      })
    load()
    const t = setInterval(() => !document.hidden && load(), 30_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [sym])

  // the price, on every tick of the active chart
  useEffect(() => {
    setPrice(null)
    let off: (() => void) | null = null
    const wire = () => {
      off?.()
      const chart = ws.chart
      off = chart.on('bar', (b) => {
        if (bare(chart.market.symbol) === sym) setPrice(b.close)
      })
    }
    wire()
    const offActive = ws.on('cell:active', wire)
    return () => {
      off?.()
      offActive()
    }
  }, [ws, sym])

  if (replay.phase === 'on') return null

  const s = stats
  const px = price
  const chg = s?.prevClose != null && px != null ? ((px - s.prevClose) / s.prevClose) * 100 : null
  const dist = (v: number | null) => (v != null && px != null ? v - px : null)
  const emUsed = s?.em && px != null && s.em.em > 0 ? (Math.abs(px - s.em.refClose) / s.em.em) * 100 : null

  return (
    <div className="cb-strip flex min-w-0 shrink-0 items-center gap-4 overflow-x-auto border-b border-line bg-surface2 px-3 py-1 text-xs" role="status" aria-label="Session stats">
      {showTicker && (
        <span className="flex shrink-0 items-baseline gap-1.5">
          <span className="font-black tracking-wide text-fg">{sym}</span>
          <span className="tabular font-mono text-2xs font-extrabold text-fg">{px != null ? num(px) : '·'}</span>
          {chg != null && <span className={`tabular font-mono text-2xs font-extrabold ${toneCls(chg)}`}>{sgn(chg, 2)}%</span>}
        </span>
      )}
      {!s ? (
        <span className="text-2xs text-faint">Reading the session…</span>
      ) : (
        <>
          {s.on && (
            <Item label="ON" title="The overnight range, before the 09:30 open">
              {num(s.on.lo, s.on.lo > 1000 ? 0 : 2)}–{num(s.on.hi, s.on.hi > 1000 ? 0 : 2)} <span className="text-faint">({num(s.on.hi - s.on.lo, 1)})</span>
            </Item>
          )}
          {s.ib && (
            <Item label="IB" title="Today's initial balance (09:30–10:30) and how it compares with the last 20 sessions' average">
              {num(s.ib.size, 1)}
              {s.ib.avg != null && <span className="text-faint"> · {(s.ib.size / s.ib.avg).toFixed(1)}× avg</span>}
              {s.ib.forming && <span className="text-faint"> · forming</span>}
            </Item>
          )}
          {showLevels &&
            VT_ITEMS.map((v) => {
              const lv = s.levels[v.key]
              const d = dist(lv)
              if (d == null) return null
              return (
                <Item key={v.key} label={v.code} mark={v.key} title={`${v.name} at ${num(lv!)}: distance from price`}>
                  {sgn(d)}
                </Item>
              )
            })}
          {s.em && (
            <Item label="EM" title={`Today's expected move (±1σ from the prior close ${num(s.em.refClose)}) and how much of it is used`}>
              ±{num(s.em.em, 1)}
              {emUsed != null && <span className={emUsed >= 100 ? 'font-extrabold text-fg' : 'text-faint'}> · {Math.round(emUsed)}% used</span>}
            </Item>
          )}
          {s.prevClose != null && (
            <Item label="Prior" title="The prior session's close">
              {num(s.prevClose)}
            </Item>
          )}
        </>
      )}
      <button type="button" onClick={onHide} className="cb-vt-x ml-auto shrink-0 cursor-pointer px-1 text-2xs text-fg" title={showTicker ? 'Hide the session stats (⋮ → Session stats brings them back)' : 'Hide the session stats (Workspace → Session stats strip brings them back)'} aria-label="Hide session stats">
        ✕
      </button>
    </div>
  )
}
