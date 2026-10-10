"use client";

// Dependency-free draggable + resizable dashboard grid.
// - Fixed COLS-column grid; each item has {x,y,w,h} in grid units.
// - Drag from the item's header handle (data-dashgrid-handle) to move.
// - Resize from the bottom-right handle to change w/h.
// - In "locked" mode items render statically (no handles, no listeners).
// - onLayoutChange fires with the new layout after a drag/resize gesture ends,
//   so the parent can persist it.
//
// Geometry: column width is derived from the measured container width; row
// height is a fixed px value (rowH). Item pixel box = grid units * cell size,
// minus gutter. Positions snap to whole grid units on drop.
//
// CARDS NEVER OVERLAP. Every gesture runs through compactLayout(): whatever the
// dragged/resized card lands on is pushed straight down, and the whole board
// then floats up to close the gaps. Cards can't be stacked on top of each other
// even deliberately, which is what makes a saved template safe to reload.

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import type { GridItem } from "@/lib/layoutStore";

export type { GridItem };

/** Do two items share any cell? Touching edges don't count. */
export function collides(a: GridItem, b: GridItem): boolean {
  if (a.id === b.id) return false;
  if (a.x + a.w <= b.x || b.x + b.w <= a.x) return false;
  if (a.y + a.h <= b.y || b.y + b.h <= a.y) return false;
  return true;
}

/**
 * Resolve overlaps and pull everything upward (gravity), the way every
 * dashboard grid behaves.
 *
 * Items are placed in reading order (top row first, then left to right). Each
 * one floats up until the cell above is taken, then drops past anything it
 * still overlaps. `fixedId` pins one card to its exact coordinates — that's the
 * card under the cursor mid-gesture, so the preview tracks the pointer instead
 * of snapping away while the others get out of its way.
 *
 * Input order is preserved in the result so React keys and child matching stay
 * stable; only x/y/w/h change.
 */
export function compactLayout(items: GridItem[], fixedId?: string | null): GridItem[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  // The pinned card claims its cells before anyone else gets to reason about them.
  const order = fixedId
    ? [...sorted.filter((i) => i.id === fixedId), ...sorted.filter((i) => i.id !== fixedId)]
    : sorted;

  const placed: GridItem[] = [];
  for (const src of order) {
    const it: GridItem = { ...src, x: Math.max(0, src.x), y: Math.max(0, src.y) };
    if (fixedId && it.id === fixedId) { placed.push(it); continue; }
    // Float up while the row above is clear…
    while (it.y > 0 && !placed.some((p) => collides({ ...it, y: it.y - 1 }, p))) it.y--;
    // …then fall past anything still in the way. Each hop clears at least one
    // item, so this ends after at most one pass per placed card.
    for (let guard = 0; guard <= placed.length; guard++) {
      const hit = placed.find((p) => collides(it, p));
      if (!hit) break;
      it.y = hit.y + hit.h;
    }
    placed.push(it);
  }

  const byId = new Map(placed.map((p) => [p.id, p]));
  return items.map((orig) => byId.get(orig.id) ?? orig);
}

type DragState =
  | { kind: "move"; id: string; startX: number; startY: number; origX: number; origY: number }
  | { kind: "resize"; id: string; startX: number; startY: number; origW: number; origH: number }
  | null;

export type DashGridProps = {
  layout: GridItem[];
  onLayoutChange: (next: GridItem[]) => void;
  children: React.ReactNode;        // each child must have a `key` matching a layout id
  cols?: number;
  rowH?: number;                    // px per grid row
  gutter?: number;                  // px gap between cells
  locked?: boolean;                 // when true: static render, no drag/resize
  minW?: number;
  minH?: number;
};

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// Warn once per id, not once per render. Deliberately not gated on NODE_ENV:
// this file ships through the Vite SPA as well as Next, and a bare `process`
// reference there is a page-blanking ReferenceError. One console line for a
// genuine misconfiguration is the cheaper trade.
const warnedIds = new Set<string>();
function warnMissingGridId(id: string) {
  if (warnedIds.has(id)) return;
  warnedIds.add(id);
  console.warn(
    `[DashGrid] child "${id}" has no data-grid-id prop — falling back to its key. ` +
      "Pass data-grid-id (and data-grid-overflow) as props on the child ELEMENT, " +
      "not just on a DOM node inside it, or per-card options are silently ignored.",
  );
}

export default function DashGrid({
  layout,
  onLayoutChange,
  children,
  cols = 12,
  rowH = 28,
  gutter = 10,
  locked = false,
  minW = 2,
  minH = 2,
}: DashGridProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<DragState>(null);
  // Live (pre-commit) layout shown during a gesture; null when idle.
  const [draft, setDraft] = useState<GridItem[] | null>(null);
  const dragRef = useRef<DragState>(null);
  const draftRef = useRef<GridItem[] | null>(null);
  // Layout as it was when the current gesture began — every frame is derived
  // from this, never from the previous frame (see onMove).
  const startRef = useRef<GridItem[] | null>(null);
  const baseId = useId();

  dragRef.current = drag;
  draftRef.current = draft;

  // Measure container width so we can convert px deltas → grid units.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const colW = cols > 0 && width > 0 ? (width + gutter) / cols : 0;

  const active = draft ?? layout;
  const byId = new Map(active.map((i) => [i.id, i]));

  // Total rows = max bottom edge, plus a little slack so there's room to drop lower.
  const maxRows = active.reduce((m, i) => Math.max(m, i.y + i.h), 0);
  const gridRows = Math.max(maxRows + 2, 8);
  const containerH = gridRows * rowH + (gridRows - 1) * gutter;

  const pxBox = (it: GridItem) => ({
    left: it.x * colW,
    top: it.y * (rowH + gutter),
    width: Math.max(0, it.w * colW - gutter),
    height: Math.max(0, it.h * (rowH + gutter) - gutter),
  });

  const onPointerDownMove = useCallback((e: React.PointerEvent, id: string) => {
    if (locked) return;
    // Only start a move from the header handle.
    const target = e.target as HTMLElement;
    if (!target.closest("[data-dashgrid-handle]")) return;
    // Ignore clicks on interactive elements inside the handle (links/buttons).
    if (target.closest("a,button,input,select,textarea")) return;
    const it = byId.get(id);
    if (!it) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const snapshot = active.map((x) => ({ ...x }));
    startRef.current = snapshot;
    setDrag({ kind: "move", id, startX: e.clientX, startY: e.clientY, origX: it.x, origY: it.y });
    setDraft(snapshot);
  }, [active, byId, locked]);

  const onPointerDownResize = useCallback((e: React.PointerEvent, id: string) => {
    if (locked) return;
    const it = byId.get(id);
    if (!it) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const snapshot = active.map((x) => ({ ...x }));
    startRef.current = snapshot;
    setDrag({ kind: "resize", id, startX: e.clientX, startY: e.clientY, origW: it.w, origH: it.h });
    setDraft(snapshot);
  }, [active, byId, locked]);

  // Global move/up while a gesture is active.
  useEffect(() => {
    if (!drag) return;
    const cell = rowH + gutter;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      // Always recompute from the layout as it was when the gesture STARTED.
      // Deriving each frame from the previous frame would let the push-down /
      // float-up passes accumulate, and the board would creep while the pointer
      // sat still.
      const base = startRef.current;
      if (!d || !base || colW <= 0) return;
      const dxCols = Math.round((e.clientX - d.startX) / colW);
      const dyRows = Math.round((e.clientY - d.startY) / cell);
      const next = base.map((it) => {
        if (it.id !== d.id) return { ...it };
        if (d.kind === "move") {
          const w = it.w, h = it.h;
          return { ...it, x: clamp(d.origX + dxCols, 0, cols - w), y: Math.max(0, d.origY + dyRows) };
        } else {
          const w = clamp(d.origW + dxCols, minW, cols - it.x);
          const h = Math.max(minH, d.origH + dyRows);
          return { ...it, w, h };
        }
      });
      // Pin the card being dragged so the preview tracks the pointer; everything
      // it lands on is pushed out of the way live, not on drop.
      setDraft(compactLayout(next, d.id));
    };
    const onUp = () => {
      const committed = draftRef.current;
      const d = dragRef.current;
      setDrag(null);
      setDraft(null);
      startRef.current = null;
      // Second pass with nothing pinned: the card that was under the cursor now
      // falls into the board's gravity too, so releasing never leaves a hole
      // above it.
      if (committed) onLayoutChange(compactLayout(compactLayout(committed, d?.id ?? null)));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, colW, cols, rowH, gutter, minW, minH, onLayoutChange]);

  // Map children by key so we can position each by its layout entry.
  const childArray = React.Children.toArray(children) as React.ReactElement[];

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", height: containerH }}>
      {childArray.map((child) => {
        // Identify the child by its explicit data-grid-id PROP. (Keys are
        // unreliable here: React.Children.toArray rewrites them, and children
        // coming from a nested .map() get compound prefixes like ".6:0:$id".)
        //
        // These are read off the ELEMENT, so a child component must accept them
        // under exactly these names — rendering data-grid-id on some inner div
        // is invisible here. The key fallback below silently papered over that
        // for the id; nothing covered data-grid-overflow, so a wrapper that
        // renamed it to `overflow` lost its opt-out and got clipped. Hence the
        // dev warning.
        const childProps = child.props as {
          "data-grid-id"?: string;
          "data-grid-overflow"?: string;
        } | undefined;
        const propId = childProps?.["data-grid-id"];
        // Fallback: take the segment after the last "$" in the toArray key.
        const rawKey = String(child.key ?? "");
        const id = propId ?? (rawKey.includes("$") ? rawKey.slice(rawKey.lastIndexOf("$") + 1) : rawKey);
        // Opt out of the clipping box: a card whose content legitimately escapes
        // its bounds (an open dropdown, a tooltip) sets data-grid-overflow=
        // "visible" and also gets a raised base z-index, so the escaped menu
        // paints over the cards below instead of being cut off by them.
        const overflowVisible = childProps?.["data-grid-overflow"] === "visible";
        if (!propId) warnMissingGridId(id);
        const it = byId.get(id);
        if (!it) return null;
        const box = pxBox(it);
        const isDragging = drag?.id === id;
        return (
          <div
            key={`${baseId}-${id}`}
            onPointerDown={(e) => onPointerDownMove(e, id)}
            style={{
              position: "absolute",
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              transition: isDragging ? "none" : "left .12s ease, top .12s ease, width .12s ease, height .12s ease",
              zIndex: isDragging ? 50 : overflowVisible ? 30 : 1,
              boxShadow: isDragging ? "0 18px 50px rgba(0,0,0,.55)" : "none",
              touchAction: locked ? undefined : "none",
            }}
          >
            {/* The panel itself fills this box. */}
            <div style={{ width: "100%", height: "100%", overflow: overflowVisible ? "visible" : "hidden", position: "relative" }}>
              {child}
              {!locked && (
                <div
                  onPointerDown={(e) => onPointerDownResize(e, id)}
                  title="Drag to resize"
                  style={{
                    position: "absolute", right: 2, bottom: 2, width: 16, height: 16,
                    cursor: "nwse-resize", zIndex: 20,
                    background: "linear-gradient(135deg, transparent 50%, rgba(46,230,200,.7) 50%)",
                    borderBottomRightRadius: 10,
                  }}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
