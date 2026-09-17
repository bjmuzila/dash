import type { ReactNode } from 'react'
import { createContext, useContext, useState } from 'react'
import { createPortal } from 'react-dom'

// ─────────────────────────────────────────────────────────────────────────────
// THE TOOLBAR'S PAGE SLOT — one place in the top bar that the routed page owns.
//
// The home board's controls (Edit layout / Save layout / + Add card) used to
// live in a Page header row of their own, directly under the toolbar: a second
// band of chrome across the top of a page whose whole job is to be a full-bleed
// board. They render THROUGH this slot into the toolbar itself now, which is
// why the board starts at the top of the page column and why the header row —
// and the word "Terminal" that led it — is gone.
//
// A DOM PORTAL rather than lifted state, deliberately. The board's edit mode,
// its dirty flag and its add-card menu stay inside BoardPage where the layout
// lives; the toolbar never learns what a card is. Any page can use the slot and
// nothing has to be registered for it.
//
// "ONLY ON THE HOME PAGE" needs no condition anywhere: the slot draws whatever
// the MOUNTED route puts into it, and every other route puts nothing. Delete a
// page and its toolbar controls leave with it.
//
// One slot, one filler. Two pages mounted at once would fight over it — v3
// mounts exactly one route at a time, and that is the assumption here.
// ─────────────────────────────────────────────────────────────────────────────

/** The host element, published downward so a page can portal into it. */
const SlotCtx = createContext<HTMLElement | null>(null)
/** The host's ref setter, published downward so the toolbar can claim the slot. */
const SlotHostCtx = createContext<((el: HTMLElement | null) => void) | null>(null)

export function ToolbarSlotProvider({ children }: { children: ReactNode }) {
  // State, not a ref: the page renders `null` until the host exists, and it has
  // to be told when it does. The extra render happens once, at mount.
  const [el, setEl] = useState<HTMLElement | null>(null)
  return (
    <SlotHostCtx.Provider value={setEl}>
      <SlotCtx.Provider value={el}>{children}</SlotCtx.Provider>
    </SlotHostCtx.Provider>
  )
}

/** Rendered ONCE, by the toolbar, at the spot page controls should appear. */
export function ToolbarSlotHost({ className }: { className?: string }) {
  const setEl = useContext(SlotHostCtx)
  return <div ref={setEl ?? undefined} className={className ?? 'flex items-center gap-2'} />
}

/** Rendered by a page: its children appear in the toolbar instead of in place. */
export function ToolbarSlot({ children }: { children: ReactNode }) {
  const el = useContext(SlotCtx)
  return el ? createPortal(children, el) : null
}
