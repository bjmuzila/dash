import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// EXPAND — "full screen" for a Card, without leaving the app.
//
// Every Card in the shell can be blown up to fill the page area. NOT the
// browser's Fullscreen API and not `position: fixed` over the viewport: both of
// those take the RAIL and the TOOLBAR with them, and those two are how you leave
// the card you just expanded. A chart you cannot navigate away from without
// pressing Escape first is a worse chart.
//
// So the stage is an `absolute inset-0` layer inside the PAGE COLUMN — the div
// that already sits to the right of the rail and below the toolbar in
// shell/Shell.tsx. The card fills everything that column owns and not one pixel
// more, so the rail stays clickable, the toolbar keeps its ticker and clock, and
// the replay dock (which is a later sibling, in flow) still holds the bottom
// edge. Nothing about the app's frame changes; only the page under it does.
//
// ── Why a portal, and not a CSS class on the tile ────────────────────────────
// A board tile is absolutely positioned inside a 12-column grid whose parent
// clips it. Nothing a tile's own child can set gets it out of that box — and
// re-mounting the card at the top level instead would throw away everything it
// holds: the chart instance, the fetched chain, the scroll position, the replay
// cursor. A portal moves the DOM and leaves the React tree exactly where it is,
// which is the same trick CardToolbar and ReplayDock already use here.
//
// ── No host, no button ───────────────────────────────────────────────────────
// Outside an ExpandStageHost — the phone build, a preview, a test — the context
// is null and Card simply draws no expand control. That is the fallback, not an
// error: the phone build has no page column to expand into.
// ─────────────────────────────────────────────────────────────────────────────

interface ExpandValue {
  /** The node an expanded Card portals into. Stable for the host's lifetime. */
  stage: HTMLDivElement | null
  /** Which card key is expanded, or null. One at a time, always. */
  expandedId: string | null
  /** Expand this key, replacing whatever was expanded before. */
  expand: (id: string) => void
  /** Collapse. With an id, only if that id is the one currently expanded. */
  collapse: (id?: string) => void
}

const Ctx = createContext<ExpandValue | null>(null)

/** Null when there is no stage on the page — see the header. */
export function useExpandStage(): ExpandValue | null {
  return useContext(Ctx)
}

/**
 * Wraps a page column and contributes the expand stage as an overlay over the
 * page — under nothing, over everything the page drew.
 */
export function ExpandStageHost({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<HTMLDivElement | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const expand = useCallback((id: string) => setExpandedId(id), [])
  const collapse = useCallback((id?: string) => {
    setExpandedId((cur) => (id == null || cur === id ? null : cur))
  }, [])

  // Escape is the universal way out of a thing that filled the screen, and the
  // one people try first. Bound on the window rather than the stage because the
  // focus may well be inside a chart canvas that never took it.
  useEffect(() => {
    if (!expandedId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpandedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expandedId])

  const value = useMemo<ExpandValue>(
    () => ({ stage, expandedId, expand, collapse }),
    [stage, expandedId, expand, collapse],
  )

  return (
    <Ctx.Provider value={value}>
      {/* The page column's own box, made a positioning context so the stage can
          cover exactly it. `min-h-0 flex-1 flex-col` reproduces what the page
          had as a direct flex child of the column, so wrapping changes nothing
          about how a `fill` page sizes itself. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {children}
        {/* Always rendered, so the ref is committed BEFORE anything asks to
            portal into it — a stage that mounted with the first expand would
            paint the card in its tile for one frame first. `hidden` when idle
            costs nothing and takes it out of the layout entirely. */}
        <div
          ref={setStage}
          data-cb-stage
          className={
            expandedId
              ? 'absolute inset-0 z-40 flex min-h-0 flex-col overflow-hidden bg-bg p-2'
              : 'hidden'
          }
        />
      </div>
    </Ctx.Provider>
  )
}
