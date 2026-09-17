import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// IS THE NOTES DOCK OPEN.
//
// Straight port of v2's components/shared/NotesPanelContext.tsx, rewritten for
// v3 (no "use client", v3 import style) — no v2 import, per the clean-slate
// rule in cbedge-v3/AGENTS.md.
//
// The STORAGE KEY is deliberately identical to v2's. Both builds run on the
// same origin (cbedge.net/app/* and cbedge.net/v3/*), so a dock left open in
// one is open in the other: the same person, the same browser, the same panel.
// ─────────────────────────────────────────────────────────────────────────────

const OPEN_STORAGE_KEY = 'notes-dock-open-v1'

interface NotesPanelCtx {
  open: boolean
  openPanel: () => void
  closePanel: () => void
  togglePanel: () => void
}

const Ctx = createContext<NotesPanelCtx>({
  open: false,
  openPanel: () => {},
  closePanel: () => {},
  togglePanel: () => {},
})

export function NotesPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)

  // Restore last state on mount (default closed).
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN_STORAGE_KEY) === '1')
    } catch {
      /* ignore */
    }
  }, [])

  const value = useMemo<NotesPanelCtx>(() => {
    const persist = (next: boolean) => {
      try {
        localStorage.setItem(OPEN_STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    }
    return {
      open,
      openPanel: () => setOpen(persist(true)),
      closePanel: () => setOpen(persist(false)),
      togglePanel: () => setOpen((v) => persist(!v)),
    }
  }, [open])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useNotesPanel(): NotesPanelCtx {
  return useContext(Ctx)
}
