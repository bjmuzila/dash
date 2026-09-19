// ─────────────────────────────────────────────────────────────────────────────
// The Initial Balance strip — the 9:30–10:30 range, inline in the context bar.
//
// IT HIDES ITSELF. No session yet, no row, nothing to say → it renders nothing
// at all, rather than a row of dashes. An empty strip in a header is worse than
// no strip: it reads as a thing that is broken rather than a thing that has not
// happened yet.
//
// ONE LINE, AND IT REFUSES TO WRAP. This cluster rides the context bar's own
// sideways scroll. Left to wrap internally it folds to four stacked lines and
// stretches a 44px bar to ~150px, leaving the chips on its left floating in a
// gap. `flex-shrink-0` + `whitespace-nowrap` hands the overflow to the scroll
// every other chip on that row already uses.
//
// Descriptive only: it states where the range was and whether price left it.
// It never says what to do about that.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'
import { query } from '@/data/api'
import { T, alpha } from '@/design/theme'
import { nyToday } from './board'

interface IbRow {
  high?: number
  low?: number
  mid?: number
  range?: number
  rangePct?: number
  lowFirst?: number | null
  locked?: number
}

const POLL_MS = 30_000

export interface IbStripProps {
  /** Live price, so the strip can say whether the range broke. */
  spot: number
  /** "Full read →" — opens wherever the long form lives. Omit to hide the link. */
  onOpen?: () => void
}

export function IbStrip({ spot, onOpen }: IbStripProps) {
  const [ib, setIb] = useState<IbRow | null | false>(null) // null = loading, false = hide

  useEffect(() => {
    let dead = false
    const pull = () => {
      void query<{ row?: IbRow | null }>(`/api/snapshots/ib?date=${nyToday()}`)
        .then((j) => {
          if (dead) return
          const row = j?.row
          setIb(row && Number(row.high) > 0 ? row : false)
        })
        .catch(() => {
          if (!dead) setIb(false)
        })
    }
    pull()
    const t = setInterval(pull, POLL_MS)
    return () => {
      dead = true
      clearInterval(t)
    }
  }, [])

  if (!ib) return null

  const high = Number(ib.high) || 0
  const low = Number(ib.low) || 0
  const mid = Number(ib.mid) || (high + low) / 2
  const f2 = (v: number) => (v > 0 ? v.toFixed(2) : '·')

  // The break pill. "Forming" until the hour is locked; then where price sits.
  const locked = Number(ib.locked) === 1
  const broke =
    !locked || !(spot > 0)
      ? null
      : spot > high
        ? { word: 'BROKE HIGH', color: T.green }
        : spot < low
          ? { word: 'BROKE LOW', color: T.red }
          : { word: 'INSIDE', color: T.muted }

  return (
    <span className="flex shrink-0 items-center gap-2 whitespace-nowrap">
      <span className="text-3xs font-semibold" style={{ color: T.cyan }}>
        ◷ IB · 9:30-10:30
      </span>
      {!locked && (
        <span className="rounded px-1.5 py-0.5 text-3xs" style={{ background: alpha(T.muted, 0.15), color: T.muted }}>
          FORMING
        </span>
      )}
      <span className="tabular text-3xs text-faint">
        <span style={{ color: T.muted }}>H</span> {f2(high)}{' '}
        <span style={{ color: T.muted }}>M</span> {f2(mid)}{' '}
        <span style={{ color: T.muted }}>L</span> {f2(low)}
      </span>
      {broke && (
        <span
          className="rounded px-1.5 py-0.5 text-3xs"
          style={{ background: alpha(broke.color, 0.15), color: broke.color }}
          title={`Price is ${broke.word.toLowerCase()} relative to the 9:30–10:30 range. Descriptive only.`}
        >
          {broke.word}
        </span>
      )}
      {onOpen && (
        <button type="button" onClick={onOpen} className="text-3xs" style={{ color: T.cyan }}>
          Full read →
        </button>
      )}
    </span>
  )
}
