import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useIsPhone } from '@/design/useIsPhone'

// ─────────────────────────────────────────────────────────────────────────────
// Board — the customizable card grid (terminal home, and anywhere else a page
// wants add/remove/resize/drag cards with a saved arrangement).
//
// v3-native, not a port of v2's DashGrid: same well-known grid-compaction idea
// (float up, push past collisions), rewritten against this app's primitives
// and rules. No colour literals here — every visual comes from the caller's
// own Card/tokens; this file only computes geometry.
//
// Contract:
//   - Fixed COLS-column grid. Each item is {id,x,y,w,h} in grid units.
//   - Drag from the element carrying `data-board-handle`.
//   - Resize from the handle this component renders in each tile's corner.
//   - CARDS NEVER OVERLAP and always compact toward the top-left ("snap close
//     to the other cards") — every gesture re-runs compaction, so a saved
//     layout can never come back as a stack.
//   - GUIDED, NOT FORCED. The card follows the pointer; nothing is dragged out
//     of the hand. What the board adds is a dashed LANDING SLOT drawn where the
//     card will actually come to rest, plus column guides for the duration of
//     the gesture. See the `preview` block below for why the slot is computed
//     with the release maths rather than approximated.
//   - locked=true renders statically: no handles, no listeners. Use this
//     outside "edit layout" mode if the page wants a locked default view.
// ─────────────────────────────────────────────────────────────────────────────

export interface BoardItem {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/** Do two items share any cell? Touching edges don't count. */
export function boardCollides(a: BoardItem, b: BoardItem): boolean {
  if (a.id === b.id) return false
  if (a.x + a.w <= b.x || b.x + b.w <= a.x) return false
  if (a.y + a.h <= b.y || b.y + b.h <= a.y) return false
  return true
}

/**
 * Gravity pass: every card floats up until something is in the way, then
 * anything still overlapping gets pushed down past it. `pinnedId` keeps one
 * card exactly where the pointer put it while everything else gets out of
 * its way — that's what makes a drag look like it "snaps" the others aside
 * instead of the dragged card jumping around.
 */
export function compactBoard(items: BoardItem[], pinnedId?: string | null): BoardItem[] {
  const order = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  const ordered = pinnedId
    ? [...order.filter((i) => i.id === pinnedId), ...order.filter((i) => i.id !== pinnedId)]
    : order

  const placed: BoardItem[] = []
  for (const src of ordered) {
    const it: BoardItem = { ...src, x: Math.max(0, src.x), y: Math.max(0, src.y) }
    if (pinnedId && it.id === pinnedId) {
      placed.push(it)
      continue
    }
    while (it.y > 0 && !placed.some((p) => boardCollides({ ...it, y: it.y - 1 }, p))) it.y--
    for (let guard = 0; guard <= placed.length; guard++) {
      const hit = placed.find((p) => boardCollides(it, p))
      if (!hit) break
      it.y = hit.y + hit.h
    }
    placed.push(it)
  }

  const byId = new Map(placed.map((p) => [p.id, p]))
  return items.map((orig) => byId.get(orig.id) ?? orig)
}

type Gesture =
  | { kind: 'move'; id: string; startX: number; startY: number; origX: number; origY: number }
  | { kind: 'resize'; id: string; startX: number; startY: number; origW: number; origH: number }
  | null

export interface BoardProps {
  layout: BoardItem[]
  onLayoutChange: (next: BoardItem[]) => void
  /** id -> rendered card content. A missing id is simply not drawn. */
  render: (id: string) => ReactNode
  cols?: number
  rowH?: number
  gutter?: number
  locked?: boolean
  minW?: number
  minH?: number
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

export function Board({
  layout,
  onLayoutChange,
  render,
  cols = 12,
  rowH = 32,
  gutter = 8,
  locked = false,
  minW = 2,
  minH = 3,
}: BoardProps) {
  const phone = useIsPhone()
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const [gesture, setGesture] = useState<Gesture>(null)
  const [draft, setDraft] = useState<BoardItem[] | null>(null)
  const gestureRef = useRef<Gesture>(null)
  const draftRef = useRef<BoardItem[] | null>(null)
  const startRef = useRef<BoardItem[] | null>(null)
  const baseId = useId()

  gestureRef.current = gesture
  draftRef.current = draft

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const colW = cols > 0 && width > 0 ? (width + gutter) / cols : 0
  const active = draft ?? layout
  const byId = new Map(active.map((i) => [i.id, i]))
  const maxRows = active.reduce((m, i) => Math.max(m, i.y + i.h), 0)
  const gridRows = Math.max(maxRows + 2, 6)
  const containerH = gridRows * rowH + (gridRows - 1) * gutter

  const pxBox = (it: BoardItem) => ({
    left: it.x * colW,
    top: it.y * (rowH + gutter),
    width: Math.max(0, it.w * colW - gutter),
    height: Math.max(0, it.h * (rowH + gutter) - gutter),
  })

  // ── The landing slot ───────────────────────────────────────────────────────
  //
  // The card under the pointer is PINNED: it sits exactly where the hand put it,
  // which is the only way a drag feels like dragging. But the release runs one
  // more compaction, and the card then floats up to the first free row — so the
  // place it is being held is very often NOT the place it ends up.
  //
  // That gap is the whole complaint about grids that "fight you": you let go and
  // the card jumps. The fix is not to stop the float (a board with holes in it is
  // worse) but to SHOW the destination while the drag is still happening. This
  // runs the exact release maths — the same double compaction as onUp — and
  // draws the result as an outline underneath everything.
  //
  // So the guidance is honest by construction: the outline cannot disagree with
  // where the card lands, because it is computed by the code that lands it.
  const preview =
    gesture && draft
      ? (compactBoard(compactBoard(draft, gesture.id)).find((i) => i.id === gesture.id) ?? null)
      : null
  // Nothing to point at when the card is already sitting in its landing slot.
  const pinned = gesture ? (byId.get(gesture.id) ?? null) : null
  const showPreview = preview != null && pinned != null && (preview.x !== pinned.x || preview.y !== pinned.y)

  const onDownMove = useCallback(
    (e: ReactPointerEvent, id: string) => {
      if (locked) return
      const target = e.target as HTMLElement
      if (!target.closest('[data-board-handle]')) return
      if (target.closest('a,button,input,select,textarea')) return
      const it = byId.get(id)
      if (!it) return
      e.preventDefault()
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      const snapshot = active.map((x) => ({ ...x }))
      startRef.current = snapshot
      setGesture({ kind: 'move', id, startX: e.clientX, startY: e.clientY, origX: it.x, origY: it.y })
      setDraft(snapshot)
    },
    [active, byId, locked],
  )

  const onDownResize = useCallback(
    (e: ReactPointerEvent, id: string) => {
      if (locked) return
      const it = byId.get(id)
      if (!it) return
      e.preventDefault()
      e.stopPropagation()
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      const snapshot = active.map((x) => ({ ...x }))
      startRef.current = snapshot
      setGesture({ kind: 'resize', id, startX: e.clientX, startY: e.clientY, origW: it.w, origH: it.h })
      setDraft(snapshot)
    },
    [active, byId, locked],
  )

  useEffect(() => {
    if (!gesture) return
    const cell = rowH + gutter
    const onMove = (e: PointerEvent) => {
      const g = gestureRef.current
      const base = startRef.current
      if (!g || !base || colW <= 0) return
      const dxCols = Math.round((e.clientX - g.startX) / colW)
      const dyRows = Math.round((e.clientY - g.startY) / cell)
      const next = base.map((it) => {
        if (it.id !== g.id) return { ...it }
        if (g.kind === 'move') {
          return { ...it, x: clamp(g.origX + dxCols, 0, cols - it.w), y: Math.max(0, g.origY + dyRows) }
        }
        const w = clamp(g.origW + dxCols, minW, cols - it.x)
        const h = Math.max(minH, g.origH + dyRows)
        return { ...it, w, h }
      })
      setDraft(compactBoard(next, g.id))
    }
    const onUp = () => {
      const committed = draftRef.current
      const g = gestureRef.current
      setGesture(null)
      setDraft(null)
      startRef.current = null
      if (committed) onLayoutChange(compactBoard(compactBoard(committed, g?.id ?? null)))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [gesture, colW, cols, rowH, gutter, minW, minH, onLayoutChange])

  // ── Phone: one column, no grid ─────────────────────────────────────────────
  //
  // The grid above is 12 columns of absolutely-positioned pixels. On a 390px
  // screen a 4-column card is 97px wide, and there is no arrangement of twelve
  // of those that is worth looking at — the board does not need to be
  // responsive so much as it needs to STOP on a phone.
  //
  // So: the same cards, in reading order, full width, stacked. Drag and resize
  // are not wired up at all — they are a pointer gesture the phone would have
  // to steal from the chart's own pan, and a saved arrangement made by a thumb
  // is one the desktop then has to live with.
  //
  // Height comes from the card's own grid height so a tall card stays tall,
  // floored at something a chart can actually be read in and capped at 78vh so
  // one card never fills the screen with no hint that another follows. The cap
  // is CSS `min()` rather than a measured innerHeight: the browser then
  // re-evaluates it on rotation and on the URL bar collapsing, neither of which
  // fires anything React would hear.
  if (phone) {
    const ordered = [...active].sort((a, b) => a.y - b.y || a.x - b.x)
    return (
      <div ref={wrapRef} className="flex w-full flex-col" style={{ gap: gutter }}>
        {ordered.map((it) => (
          <div
            key={`${baseId}-${it.id}`}
            // Same attribute the desktop tile carries: scripts/perf-check.mjs
            // attributes a canvas to a card by walking up to it, and a phone
            // layout that dropped it would make the card invisible to the perf
            // budget rather than exempt from it.
            data-card-id={it.id}
            className="relative flex w-full flex-col overflow-hidden"
            style={{ height: `min(${Math.max(280, it.h * (rowH + gutter) - gutter)}px, 78vh)` }}
          >
            {render(it.id)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height: containerH }}>
      {/* ── Column guides ───────────────────────────────────────────────────
          Only in edit mode, and only while a card is actually moving. A grid
          drawn the whole time is wallpaper; a grid that appears under the hand
          is a ruler. It says what the card is snapping TO — the columns are
          otherwise invisible, so a card that jumps a column reads as the board
          being twitchy rather than as the card taking the next slot. */}
      {!locked && gesture && colW > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            zIndex: 0,
            backgroundImage: `repeating-linear-gradient(to right, color-mix(in srgb, var(--color-accent) 14%, transparent) 0 1px, transparent 1px ${colW}px)`,
            backgroundSize: `${colW}px 100%`,
          }}
        />
      )}

      {/* The landing slot. Drawn UNDER the tiles (z-0) so it reads as a hole in
          the board the card is about to drop into, not as a second card. */}
      {showPreview && preview && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-md"
          style={{
            ...pxBox(preview),
            zIndex: 0,
            border: '2px dashed color-mix(in srgb, var(--color-accent) 55%, transparent)',
            background: 'color-mix(in srgb, var(--color-accent) 7%, transparent)',
            transition: 'left 90ms ease, top 90ms ease, width 90ms ease, height 90ms ease',
          }}
        />
      )}

      {active.map((it) => {
        const box = pxBox(it)
        const isDragging = gesture?.id === it.id
        return (
          <div
            key={`${baseId}-${it.id}`}
            // The tile's identity, in the DOM. scripts/perf-check.mjs attributes
            // every canvas it instruments to a card by walking up to this
            // attribute — without it a paint is just "something on the page
            // drew", and a per-card redraw budget is not possible at all.
            data-card-id={it.id}
            onPointerDown={(e) => onDownMove(e, it.id)}
            className="absolute"
            style={{
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              transition: isDragging ? 'none' : 'left 120ms ease, top 120ms ease, width 120ms ease, height 120ms ease',
              zIndex: isDragging ? 50 : 1,
              touchAction: locked ? undefined : 'none',
              // The card in the hand is lifted off the board — it is the only
              // one not in its final place, and it has to read that way for the
              // outline underneath to mean anything. Slightly transparent so
              // the slot stays visible when the two overlap.
              ...(isDragging
                ? {
                    opacity: 0.92,
                    filter: 'drop-shadow(0 8px 18px color-mix(in srgb, var(--color-app) 65%, transparent))',
                  }
                : null),
            }}
          >
            {/*
              Must be a flex column, not just a sized box: Card (and every
              card body under it) fills its space via `flex-1`/`min-h-0`,
              which only takes effect inside a flex parent. Without `flex
              flex-col` here, Card has no layout instruction to obey and
              shrinks to its header's content height instead of the pixel
              height this tile was just given — the card LOOKS unsized even
              though `box.height` above is correct.
            */}
            <div className="relative flex h-full w-full flex-col overflow-hidden">
              {render(it.id)}
              {!locked && (
                <div
                  onPointerDown={(e) => onDownResize(e, it.id)}
                  title="Drag to resize"
                  className="absolute bottom-0.5 right-0.5 h-4 w-4 cursor-nwse-resize rounded-br-md"
                  style={{ background: 'linear-gradient(135deg, transparent 50%, var(--color-accent) 50%)', opacity: 0.6 }}
                />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
