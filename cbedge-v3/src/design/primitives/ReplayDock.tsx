// ─────────────────────────────────────────────────────────────────────────────
// THE REPLAY DOCK — one bar, bottom of the page, every replay surface.
//
// Transcribed from v2's ES Candles transport (components/pages/EsCandles.tsx
// 766–795 + components/dashboard/es-candles/EsChartCard.tsx 5618–5775), which is
// the shape Brandon asked every v3 replay transport to take.
//
// ── IT IS NOT `position: fixed`, AND THAT IS THE WHOLE POINT ─────────────────
// A fixed bar covers the last inch of whatever it is docked over — on a ladder
// that is the strikes nearest the money, on a chart it is the live candles. This
// dock is the LAST FLEX CHILD of the app's page column instead: `flexShrink: 0`
// beside a `flex-1` page, so mounting it SHRINKS the page by its height and
// nothing is ever occluded. v2 records the same reasoning and the same trade —
// the content reflows twice per replay (once in, once out) and that is a fair
// price for never hiding the thing being replayed.
//
// ── Why a portal ─────────────────────────────────────────────────────────────
// The transports live deep inside their surfaces — inside the Options Chain's
// toolbar cluster, inside the Ticker Lookup card, inside a replay page's own
// column — and they own the state they drive. Hoisting that state to the page
// to move a bar would be the wrong repair. So the surface renders
// `<ReplayDock>{bar}</ReplayDock>` wherever it likes in its own tree and the DOM
// lands at the bottom of the page, with its state, context and handlers intact:
// a portal moves the DOM, not the React tree.
//
// ── The dock is orange because only ONE thing ever docks here ────────────────
// Every other bar in this app is neutral. A rewound grid that does not announce
// itself reads as a live one, which is the single worst way any of these
// surfaces can be misunderstood — so the announcement is the whole bottom edge
// of the page, not a chip inside a panel. The bars themselves therefore drop
// their own plates: the dock IS the plate.
//
// ── No host, no problem ──────────────────────────────────────────────────────
// Rendered outside a ReplayDockHost (a preview, a test, a modal that owns its
// own bottom edge), ReplayDock renders its children inline exactly where they
// sit. That is the fallback, not an error.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { alpha, SHADOW, T } from '@/design/theme'

interface ReplayDockValue {
  /** The node bars portal into. Null until the dock has committed. */
  target: HTMLDivElement | null
  /** Call on mount; the returned function releases the claim on unmount. */
  claim: () => () => void
}

const Ctx = createContext<ReplayDockValue | null>(null)

/**
 * Wraps a page column and contributes the dock as its last child.
 *
 * The dock only exists while something has claimed it — an empty bar with a
 * hairline and a shadow is a page that looks broken at the bottom edge.
 */
export function ReplayDockHost({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const [claims, setClaims] = useState(0)

  const claim = useCallback(() => {
    setClaims((n) => n + 1)
    return () => setClaims((n) => Math.max(0, n - 1))
  }, [])

  const value = useMemo<ReplayDockValue>(() => ({ target, claim }), [target, claim])

  return (
    <Ctx.Provider value={value}>
      {children}
      {claims > 0 && (
        <div
          className="cb-replay-dock"
          style={{
            flexShrink: 0,
            minWidth: 0,
            // In flow, not fixed. See the header.
            position: 'relative',
            zIndex: 40,
            borderTop: `1px solid ${alpha(T.orange, 0.35)}`,
            background: `linear-gradient(180deg,${alpha(T.orange, 0.1)},${alpha(T.orange, 0.03)}), ${alpha(
              T.panel,
              0.92,
            )}`,
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            // Upward, because the thing it needs to separate from is above it.
            boxShadow: `0 -10px 30px ${alpha(SHADOW, 0.35)}`,
            padding: '8px 16px',
          }}
        >
          {/* `setTarget` as a ref callback rather than a ref object: the bars
              cannot portal until this node exists, so the host has to RE-RENDER
              once it does. A ref would fill in silently and nothing would
              re-run. React also calls it with null on unmount, which is how the
              target clears itself. */}
          <div ref={setTarget} style={{ width: '100%', minWidth: 0 }} />
        </div>
      )}
    </Ctx.Provider>
  )
}

/**
 * Put a replay transport at the bottom of the page.
 *
 * Children are laid out as one wrapping row — groups inside should be their own
 * nowrap flex boxes so they fold as intact units and the dock simply gets
 * taller, which (being in flow) shrinks the page rather than covering it.
 */
export function ReplayDock({ children }: { children: ReactNode }) {
  const ctx = useContext(Ctx)
  const claim = ctx?.claim

  useEffect(() => {
    if (!claim) return
    return claim()
  }, [claim])

  const row = (
    <div
      className="cb-replay-bar"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 10,
        minWidth: 0,
        fontSize: 'var(--text-xs)',
        color: T.text,
      }}
    >
      {children}
    </div>
  )

  // No host: render where we stand. A modal owns its own bottom edge and must
  // not push a bar onto the page behind it.
  if (!ctx) return row
  // Claimed this commit, node lands on the next one.
  if (!ctx.target) return null
  return createPortal(row, ctx.target)
}
