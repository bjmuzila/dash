// ─────────────────────────────────────────────────────────────────────────────
// REPLAY TRANSPORT.
//
// Deliberately NOT inside the toolbar: a screen-grab of a rewound grid that does
// not say WHEN it is reads as a live chain, which is the single worst way this
// feature can be misunderstood. The clock, the session date and the recorded
// spot travel with the image.
//
// Since 2026-09-02 it renders into the REPLAY DOCK — the bottom-of-page bar
// every v3 replay surface shares, transcribed from v2's ES Candles transport.
// The dock is in FLOW, so it shrinks the grid rather than covering the strikes
// nearest the money, and it carries the orange plate this bar used to draw for
// itself. See design/primitives/ReplayDock.tsx.
//
// The bar also states its own COVERAGE out loud, twice over. `strike_growth`
// records only the top N strikes a side per sweep, so the grid looks like the
// live chain while being a record of the WALLS — without the "recorded walls
// only" line and the cells-this-frame count, a missing strike reads as "no gamma
// there" rather than "the recorder never stored that strike".
//
// Spec: docs/parity/options-chain.md — Part E.
// ─────────────────────────────────────────────────────────────────────────────

import { T } from '@/design/theme'
import { fmtReplayClock } from './format'
import { ChainDropdown } from './pickers'
import { REPLAY_SCOPES, REPLAY_SCOPE_LABEL, REPLAY_SPEEDS, type ReplayScope } from './useChainData'
import type { ReplayFrame } from './useChainData'

export interface ReplayBarProps {
  dates: string[]
  date: string
  setDate: (d: string) => void
  frames: ReplayFrame[]
  frame: ReplayFrame | null
  idx: number
  setIdx: (updater: (i: number) => number) => void
  playing: boolean
  setPlaying: (updater: boolean | ((p: boolean) => boolean)) => void
  speed: number
  setSpeed: (s: number) => void
  loading: boolean
  err: string
  scope: ReplayScope
  setScope: (s: ReplayScope) => void
  allExpiries: string[]
  axis: { strikes: number[]; expiries: string[] }
  zeroDteExp: string
  zeroDteIsExact: boolean
  onOpenLadder: () => void
  segStyle: (on: boolean) => React.CSSProperties
}

export function ReplayBar(p: ReplayBarProps) {
  const smallBtn = (on: boolean): React.CSSProperties => ({
    ...p.segStyle(on),
    height: 24,
    padding: '0 9px',
    fontSize: 10,
    textTransform: 'none',
  })

  return (
    <div
      style={{
        // No plate. This bar lives in the REPLAY DOCK at the bottom of the page
        // now (design/primitives/ReplayDock.tsx), and the dock is the orange
        // one — a second plate inside it would be a bar drawn inside a bar.
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        flex: 1,
        minWidth: 0,
        fontSize: 'var(--text-xs)',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.orange }}>
        Replay
      </span>

      {p.dates.length > 0 && (
        <ChainDropdown value={p.date} options={p.dates} onChange={(d) => p.setDate(String(d))} accent={false} />
      )}

      {/* ── Expiry scope ──────────────────────────────────────────────────────
          0DTE collapses the grid to the session's front/same-day expiry; All
          expands it back to every recorded expiry plus the ⅀ Total column. The
          frame index is untouched by the switch — the clock you are parked on is
          the thing being examined, and losing it to change what is summed would
          be the wrong trade. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 10, color: T.muted, fontWeight: 700 }}>Exp</span>
        {REPLAY_SCOPES.map((sc) => (
          <button
            key={sc}
            onClick={() => p.setScope(sc)}
            disabled={sc === '0dte' && !p.zeroDteExp}
            style={{ ...smallBtn(p.scope === sc), opacity: sc === '0dte' && !p.zeroDteExp ? 0.4 : 1 }}
            title={
              sc === '0dte'
                ? p.zeroDteExp
                  ? `Show only ${p.zeroDteExp}${
                      p.zeroDteIsExact
                        ? ' (expires this session)'
                        : ' — front recorded expiry; this root had no same-day listing'
                    }`
                  : 'No expiry recorded for this session'
                : `Show all ${p.allExpiries.length} recorded expiries, with the ⅀ Total column (0DTE excluded from Total, as on the live chain)`
            }
          >
            {REPLAY_SCOPE_LABEL[sc]}
          </button>
        ))}
      </div>

      <button
        onClick={() => {
          p.setPlaying(false)
          p.setIdx((i) => Math.max(0, i - 1))
        }}
        disabled={!p.frames.length || p.idx <= 0}
        style={{ ...p.segStyle(false), height: 26, padding: '0 8px', opacity: p.idx > 0 ? 1 : 0.4 }}
        title="Previous snapshot"
      >
        ◀
      </button>
      <button
        onClick={() => {
          // Replaying from the end would show one frame and stop, which reads as
          // broken — rewind to the start first.
          if (p.idx >= p.frames.length - 1) p.setIdx(() => 0)
          p.setPlaying((v) => !v)
        }}
        disabled={p.frames.length < 2}
        style={{ ...p.segStyle(p.playing), height: 26, padding: '0 12px', opacity: p.frames.length > 1 ? 1 : 0.4 }}
      >
        {p.playing ? '❚❚' : '▶'}
      </button>
      <button
        onClick={() => {
          p.setPlaying(false)
          p.setIdx((i) => Math.min(p.frames.length - 1, i + 1))
        }}
        disabled={!p.frames.length || p.idx >= p.frames.length - 1}
        style={{ ...p.segStyle(false), height: 26, padding: '0 8px', opacity: p.idx < p.frames.length - 1 ? 1 : 0.4 }}
        title="Next snapshot"
      >
        ▶
      </button>

      <input
        type="range"
        min={0}
        max={Math.max(0, p.frames.length - 1)}
        value={Math.min(p.idx, Math.max(0, p.frames.length - 1))}
        disabled={!p.frames.length}
        onChange={(e) => {
          const next = Number(e.target.value)
          p.setPlaying(false)
          p.setIdx(() => next)
        }}
        style={{ flex: 1, minWidth: 160, height: 3, accentColor: T.orange }}
      />

      <span style={{ fontSize: 10, color: T.muted, fontWeight: 700 }}>Speed</span>
      {REPLAY_SPEEDS.map((sp) => (
        <button key={sp} onClick={() => p.setSpeed(sp)} style={{ ...smallBtn(p.speed === sp), padding: '0 7px' }}>
          {sp}×
        </button>
      ))}

      <span style={{ color: T.border }}>|</span>

      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: T.text }}>
        {p.frame ? `${fmtReplayClock(p.frame.ts)} ET` : '--:--:--'}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', color: T.muted }}>
        spot {p.frame && p.frame.spot > 0 ? p.frame.spot.toFixed(2) : '—'}
      </span>
      <span style={{ color: T.muted, opacity: 0.75 }}>
        {p.frames.length ? `frame ${Math.min(p.idx, p.frames.length - 1) + 1} / ${p.frames.length}` : ''}
      </span>

      {p.frame && (
        <span style={{ color: T.muted, opacity: 0.7 }}>
          · recorded walls only ·{' '}
          {p.scope === '0dte'
            ? `${p.zeroDteExp}${p.zeroDteIsExact ? '' : ' (front — no same-day listing)'} of ${
                p.allExpiries.length
              } recorded`
            : `${p.axis.expiries.length} expir${p.axis.expiries.length === 1 ? 'y' : 'ies'}`}
          {' · '}
          {(() => {
            // Cells present / cells the SCOPED axis could hold, so the
            // denominator shrinks with the scope instead of implying the 0DTE
            // view is missing the other expiries' cells.
            const shown =
              p.scope === '0dte' && p.zeroDteExp
                ? [...p.frame.cells.keys()].filter((k) => k.slice(0, k.indexOf('|')) === p.zeroDteExp).length
                : p.frame.cells.size
            return `${shown}/${p.axis.strikes.length * Math.max(1, p.axis.expiries.length)}`
          })()}{' '}
          cells this frame · GEX only
        </span>
      )}
      {p.loading && <span style={{ color: T.cyan }}>· loading…</span>}
      {!p.loading && p.err && <span style={{ color: T.red }}>· {p.err}</span>}

      <div style={{ flex: 1 }} />

      <button
        onClick={p.onOpenLadder}
        style={{ ...p.segStyle(false), height: 26, padding: '0 10px', fontSize: 10 }}
        title="Open the single-ladder replay view"
      >
        ⛶ Ladder
      </button>
    </div>
  )
}
