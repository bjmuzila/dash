import type { ReactNode } from 'react'

// A single number with a label. Tabular by default so a ticking value does not
// shift the layout under itself.
//
// Note there is no `loading` state and no spinner. A stat either has a value
// (live or cached) or renders an em dash. Spinners on numbers that update
// several times a second are visual noise, not information.

export type Direction = 'up' | 'down' | 'flat'

export interface StatProps {
  label: ReactNode
  value: ReactNode
  /** Secondary line under the value — change, percentage, timestamp. */
  sub?: ReactNode
  /** Colours the value. Leave undefined for a neutral figure. */
  direction?: Direction
  /** Cached, not yet confirmed live. */
  stale?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const SIZE = {
  sm: 'text-base',
  md: 'text-xl',
  lg: 'text-2xl',
} as const

const DIR = {
  up: 'text-up',
  down: 'text-down',
  flat: 'text-flat',
} as const

export function Stat({ label, value, sub, direction, stale = false, size = 'md' }: StatProps) {
  return (
    <div className={stale ? 'stale flex flex-col gap-0.5' : 'flex flex-col gap-0.5'}>
      <span className="text-xs text-muted">{label}</span>
      <span
        className={[
          'tabular font-medium leading-none',
          SIZE[size],
          direction ? DIR[direction] : 'text-fg',
        ].join(' ')}
      >
        {value ?? '—'}
      </span>
      {sub && <span className="tabular text-xs text-faint">{sub}</span>}
    </div>
  )
}
