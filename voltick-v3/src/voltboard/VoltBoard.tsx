// ─────────────────────────────────────────────────────────────────────────────
// THE SINGLE BOARD — Voltick's Voltmap, as a v3 route.
//
// The page owns state and nothing else. Every number it shows comes out of
// `useBoardDerived`, called ONCE here and handed to the ribbon, the grid, the
// tiles and the node card. That is the rule the whole folder exists to keep,
// and it is why a tile can never quote a different Volt than the grid.
//
// THE SPOT COMES OFF THE SOCKET, THE MATRIX COMES OFF REST, and they are
// deliberately not the same clock. The chain endpoints are a snapshot taken
// when the board was built; the `spot` frame is live. So the header's price
// ticks while the grid holds still, and the grid is rebuilt on a timer rather
// than on every tick — rebuilding a fourteen-column matrix at 10Hz would be
// absurd, and open interest only moves once a day anyway.
//
// A REBUILD NEVER BLANKS THE BOARD. The previous matrix stays on screen while
// the next one loads, because a grid that empties every minute reads as broken
// even when it is working perfectly.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'
import { Page } from '@/design/primitives/Page'
import { useField } from '@/data/hooks'
import type { SpotFrame } from '@/contract/frames'
import { T, alpha, V2W } from '@/design/theme'
import { buildBoard, REFRESH_MS } from './board'
import { useBoardDerived, fmtStrike } from './derive'
import { BoardToolbar, ContextBar } from './BoardToolbar'
import { SessionRead } from './SessionRead'
import { Voltmap } from './Voltmap'
import { StatBand } from './StatBand'
import { NodeCard } from './NodeCard'
import type { BoardMap, BoardMode, BoardSource, Scope } from './types'

const LS = {
  strikes: 'vb-strikes',
  mode: 'vb-mode',
  source: 'vb-source',
  quiet: 'vb-quiet',
  read: 'vb-read',
} as const

/** localStorage is a convenience, never load-bearing — a throw must not kill the board. */
function pref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback
  } catch {
    return fallback
  }
}
function setPref(key: string, v: string) {
  try {
    localStorage.setItem(key, v)
  } catch {
    /* private window, blocked site data — the board does not care */
  }
}

export default function VoltBoard() {
  // pref() infers its literal fallback, so pref(k, '0') returns the TYPE '0'
  // and `=== '1'` is a comparison TS can prove never holds. Widen at the call.
  const [symbol, setSymbol] = useState<string>(() => pref<string>('vb-sym', 'SPX'))
  const [mode, setMode] = useState<BoardMode>(() => pref<BoardMode>(LS.mode, 'GEX'))
  const [source, setSource] = useState<BoardSource>(() => pref<BoardSource>(LS.source, 'oi'))
  const [scope, setScope] = useState<Scope>(-1)
  const [strikeCount, setStrikeCount] = useState(() => {
    const n = Number(pref<string>(LS.strikes, '50'))
    return [30, 50, 100, 150].includes(n) ? n : 50
  })
  const [quiet, setQuiet] = useState(() => pref<string>(LS.quiet, '0') === '1')
  const [readOpen, setReadOpen] = useState(() => pref<string>(LS.read, '1') === '1')
  const [openStrike, setOpenStrike] = useState<number | null>(null)

  const [board, setBoard] = useState<BoardMap | null>(null)
  const [loading, setLoading] = useState(true)

  // Live price. useField, not useFrame: this re-renders only when the rounded
  // price actually changes, which on a 10Hz feed is a large difference.
  const liveSpot = useField<SpotFrame, number>('spot', (f) => f?.data?.spot ?? 0)

  // ── the matrix ────────────────────────────────────────────────────────────
  // One effect, one timer. `gen` guards against an out-of-order response
  // landing after a newer one — switching symbol twice quickly is enough to
  // reproduce that, and the symptom is one ticker's grid under another's name.
  const gen = useRef(0)
  const rebuild = useCallback(async () => {
    const mine = ++gen.current
    setLoading(true)
    try {
      const next = await buildBoard(symbol, mode, source, liveSpotRef.current)
      if (mine !== gen.current) return
      setBoard(next)
    } finally {
      if (mine === gen.current) setLoading(false)
    }
  }, [symbol, mode, source])

  // The live price is read at build time but must not be a dependency — it
  // ticks constantly, and a rebuild per tick is the waterfall this app bans.
  const liveSpotRef = useRef(liveSpot)
  liveSpotRef.current = liveSpot

  useEffect(() => {
    void rebuild()
    const t = setInterval(() => void rebuild(), REFRESH_MS)
    return () => clearInterval(t)
  }, [rebuild])

  // Keep the header's price live without rebuilding the grid under it.
  const spot = liveSpot > 0 ? liveSpot : (board?.spot ?? 0)
  const shown: BoardMap | null = board ? { ...board, spot } : null

  const d = useBoardDerived(shown, scope, strikeCount, quiet, source)

  const jump = useCallback((strike: number) => {
    const rows = document.querySelectorAll<HTMLElement>('#board-grid tbody tr')
    for (const r of rows) {
      if (r.textContent?.startsWith(fmtStrike(strike))) {
        r.scrollIntoView({ block: 'center', behavior: 'smooth' })
        return
      }
    }
  }, [])

  const net = d?.aggOi.netTotal ?? 0
  const sticky = net >= 0

  return (
    <Page fill>
      {/* ── the header: symbol, price, the gamma pill, the jumps ───────────── */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-3 px-4 py-2.5"
        style={{ background: V2W.panelBg, borderBottom: `1px solid ${T.border}` }}
      >
        <input
          value={symbol}
          onChange={(e) => {
            const v = e.target.value.toUpperCase().replace(/[^A-Z.]/g, '').slice(0, 6)
            setSymbol(v)
            setPref('vb-sym', v)
          }}
          className="w-20 rounded-md px-2 py-1 text-sm tabular"
          style={{ background: V2W.chipBg, border: `1px solid ${V2W.chipEdge}`, color: T.text }}
          aria-label="Board symbol"
        />

        <span className="tabular text-lg text-fg">{spot > 0 ? spot.toFixed(2) : '—'}</span>

        {d && (
          <span
            className="rounded-full px-2.5 py-1 text-2xs"
            style={{
              background: alpha(sticky ? T.green : T.red, 0.16),
              color: sticky ? T.green : T.red,
            }}
            title={
              sticky
                ? 'Positive gamma across the dates in view — dealers lean against moves, so ranges tend to hold.'
                : 'Negative gamma across the dates in view — dealers move with price, so moves tend to stretch further.'
            }
          >
            ● {sticky ? 'Positive' : 'Negative'} Gamma · {d.scopeTag}
          </span>
        )}

        {/* The feed dot. It reports the BOARD's freshness, not the socket's —
            a live spot over an hour-old matrix is the state worth showing. */}
        <span
          title={
            board
              ? `Board built ${Math.round((Date.now() - board.builtAt) / 1000)}s ago. Rebuilds every ${REFRESH_MS / 1000}s.`
              : 'Building the board…'
          }
          style={{
            width: 8,
            height: 8,
            borderRadius: 99,
            background: loading ? T.orange : board ? T.green : T.red,
          }}
        />

        <span className="flex-1" />

        {d?.agg.king != null && (
          <JumpPill label={`★ Volt ${fmtStrike(d.agg.king)}`} onClick={() => jump(d.agg.king!)} />
        )}
        {d?.agg.surge != null && (
          <JumpPill label={`↯ Surge ${fmtStrike(d.agg.surge)}`} onClick={() => jump(d.agg.surge!)} />
        )}
        {spot > 0 && <JumpPill label="◉ Spot" onClick={() => document.getElementById('spot-row')?.scrollIntoView({ block: 'center', behavior: 'smooth' })} />}
      </div>

      <BoardToolbar
        board={shown}
        mode={mode}
        onMode={(m) => {
          setMode(m)
          setPref(LS.mode, m)
        }}
        source={source}
        onSource={(s) => {
          setSource(s)
          setPref(LS.source, s)
        }}
        scope={scope}
        onScope={setScope}
        quiet={quiet}
        onQuiet={(q) => {
          setQuiet(q)
          setPref(LS.quiet, q ? '1' : '0')
        }}
        scopeTag={d?.scopeTag ?? 'all dates'}
      />

      <ContextBar
        spot={spot}
        readOpen={readOpen}
        onRead={(v) => {
          setReadOpen(v)
          setPref(LS.read, v ? '1' : '0')
        }}
      />

      {readOpen && shown && d && <SessionRead board={shown} d={d} />}

      {/* ── the grid ───────────────────────────────────────────────────────── */}
      {shown && d && d.rows.length > 0 ? (
        <Voltmap
          board={shown}
          d={d}
          mode={mode}
          source={source}
          quiet={quiet}
          strikeCount={strikeCount}
          onStrikeCount={(n) => {
            setStrikeCount(n)
            setPref(LS.strikes, String(n))
          }}
          onPickCol={(i) => setScope((cur) => (cur === i ? -1 : i))}
          onRow={setOpenStrike}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-8">
          <span className="text-sm text-muted">
            {loading ? `Building the ${symbol} board…` : (board?.warning ?? `No board for ${symbol}.`)}
          </span>
        </div>
      )}

      {shown && d && <StatBand board={shown} d={d} mode={mode} onJump={jump} />}

      {shown && d && openStrike != null && (
        <NodeCard board={shown} d={d} strike={openStrike} mode={mode} onClose={() => setOpenStrike(null)} />
      )}
    </Page>
  )
}

function JumpPill({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-md px-2 py-1 text-2xs"
      style={{ background: V2W.chipBg, border: `1px solid ${V2W.chipEdge}`, color: T.text }}
      title="Scroll the grid to this level"
    >
      {label}
    </button>
  )
}
