import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

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

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height: containerH }}>
      {active.map((it) => {
        const box = pxBox(it)
        const isDragging = gesture?.id === it.id
        return (
          <div
            key={`${baseId}-${it.id}`}
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
