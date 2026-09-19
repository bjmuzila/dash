// ─────────────────────────────────────────────────────────────────────────────
// The toolbar and the context bar.
//
// THE DATES PICKER IS THE BOARD'S MOST IMPORTANT CONTROL and it is the one
// people miss, so it says what it is doing in words rather than only in state:
// the chip carries the scope's own tag, and every tile and every ribbon line
// downstream repeats that tag. Changing the dates changes every number on the
// page, and the page has to make that obvious or the numbers look wrong.
//
// ⚡ 0DTE is a shortcut, not a fourth mode: it scopes to the nearest
// expiration, and tapping it again goes back to Σ all. Same control, two taps.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'
import { T, alpha, V2W } from '@/design/theme'
import { isTodayExp } from './board'
import type { BoardMap, BoardMode, BoardSource, Scope } from './types'
import { IbStrip } from './IbStrip'

/* ── small parts ──────────────────────────────────────────────────────────── */

function Chip({
  on = false,
  onClick,
  title,
  children,
  tone = T.cyan,
  disabled = false,
}: {
  on?: boolean
  onClick?: () => void
  title?: string
  children: ReactNode
  tone?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-2xs"
      style={{
        background: on ? alpha(tone, 0.18) : V2W.chipBg,
        color: disabled ? T.faint : on ? tone : T.muted,
        border: `1px solid ${on ? alpha(tone, 0.45) : V2W.chipEdge}`,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}

function Seg<V extends string>({
  options,
  value,
  onPick,
  titles = {},
}: {
  options: readonly V[]
  value: V
  onPick: (v: V) => void
  titles?: Partial<Record<V, string>>
}) {
  return (
    <span
      className="flex shrink-0 items-center rounded-md p-0.5"
      style={{ background: V2W.chipBg, border: `1px solid ${V2W.chipEdge}` }}
    >
      {options.map((o) => {
        const on = o === value
        return (
          <button
            key={o}
            type="button"
            onClick={() => onPick(o)}
            title={titles[o]}
            className="rounded px-2 py-0.5 text-2xs"
            style={on ? { background: alpha(T.cyan, 0.2), color: T.cyan } : { color: T.muted }}
          >
            {o}
          </button>
        )
      })}
    </span>
  )
}

/* ── the toolbar ──────────────────────────────────────────────────────────── */

export interface BoardToolbarProps {
  board: BoardMap | null
  mode: BoardMode
  onMode: (m: BoardMode) => void
  source: BoardSource
  onSource: (s: BoardSource) => void
  scope: Scope
  onScope: (s: Scope) => void
  quiet: boolean
  onQuiet: (q: boolean) => void
  scopeTag: string
}

export function BoardToolbar({
  board,
  mode,
  onMode,
  source,
  onSource,
  scope,
  onScope,
  quiet,
  onQuiet,
  scopeTag,
}: BoardToolbarProps) {
  const frontIdx = 0
  const front = board?.cols[0]
  const frontIs0DTE = front ? isTodayExp(front.exp) : false
  const on0DTE = scope === frontIdx

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-2"
      style={{ borderBottom: `1px solid ${T.border}` }}
    >
      <Seg
        options={['GEX', 'VEX'] as const}
        value={mode}
        onPick={onMode}
        titles={{
          GEX: 'Gamma exposure — how hard dealers lean against a move.',
          VEX: 'Vega exposure — how the book reacts to a change in implied vol.',
        }}
      />

      <Seg
        options={['oi', 'volume'] as const}
        value={source}
        onPick={onSource}
        titles={{
          oi: 'Open interest — the positions carried on the book. Updates once a day.',
          volume: "Today's volume — contracts traded so far. The level cards stay on open interest.",
        }}
      />

      <Chip
        on={on0DTE}
        onClick={() => onScope(on0DTE ? -1 : frontIdx)}
        title={
          frontIs0DTE
            ? 'Jump to the nearest expiration, which today is a same-day contract. Tap again for all dates.'
            : 'Jump to the nearest expiration. This name has no same-day contract today. Tap again for all dates.'
        }
        disabled={!board?.cols.length}
      >
        ⚡ {frontIs0DTE ? '0DTE' : 'Front'}
      </Chip>

      <Chip
        on={scope === 'WEEK'}
        onClick={() => onScope(scope === 'WEEK' ? -1 : 'WEEK')}
        title="This week's expirations together: today through Friday. One combined Volt, call wall and put wall for the week."
        disabled={!board?.cols.length}
      >
        Week
      </Chip>

      <Chip
        on={scope === -1}
        onClick={() => onScope(-1)}
        title="Every expiration the board carries, added together."
        disabled={!board?.cols.length}
      >
        Σ all
      </Chip>

      <span
        className="shrink-0 rounded-md px-2 py-1 text-2xs"
        style={{ background: V2W.chipBg, border: `1px solid ${V2W.chipEdge}`, color: T.text }}
        title="Every level, tile and ribbon line on this page is scoped to these dates."
      >
        Dates · {scopeTag}
      </span>

      <span className="flex-1" />

      <Chip
        on={quiet}
        onClick={() => onQuiet(!quiet)}
        title="Quiet map: push back every cell with no mark, so the Volt, the Reversal and the Surge come forward."
      >
        ◹ Quiet
      </Chip>
    </div>
  )
}

/* ── the context bar ──────────────────────────────────────────────────────── */

export interface ContextBarProps {
  spot: number
  readOpen: boolean
  onRead: (v: boolean) => void
  onTour?: () => void
}

/**
 * The read chips plus the IB strip, on one row that scrolls sideways rather
 * than wrapping — see the note in IbStrip about what wrapping costs here.
 */
export function ContextBar({ spot, readOpen, onRead, onTour }: ContextBarProps) {
  return (
    <div
      className="flex shrink-0 items-center gap-2 overflow-x-auto px-4 py-2"
      style={{ borderBottom: `1px solid ${T.border}` }}
    >
      {onTour && (
        <Chip onClick={onTour} title="A short walk of this board — the map, the dates that scope every level, and the levels.">
          ▶ Show me around
        </Chip>
      )}
      <Chip
        on={readOpen}
        onClick={() => onRead(!readOpen)}
        title={readOpen ? 'Hide the Session Read — you can bring it back any time' : 'Show the Session Read of the board'}
      >
        {readOpen ? '▾' : '▸'} Session Read
      </Chip>
      <IbStrip spot={spot} />
    </div>
  )
}
