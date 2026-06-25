"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Whether the right-side Notes dock is open. Persisted so it "stays out" across
// route changes and reloads — closing is explicit (the NOTES button or the
// panel's own close control).
const OPEN_STORAGE_KEY = "notes-dock-open-v1";

type NotesPanelCtx = {
  open: boolean;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
};

const Ctx = createContext<NotesPanelCtx>({
  open: false,
  openPanel: () => {},
  closePanel: () => {},
  togglePanel: () => {},
});

export function NotesPanelProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  // Restore last state on mount (default closed).
  useEffect(() => {
    try { setOpen(localStorage.getItem(OPEN_STORAGE_KEY) === "1"); } catch { /* ignore */ }
  }, []);

  const persist = (next: boolean) => {
    try { localStorage.setItem(OPEN_STORAGE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
    return next;
  };

  const value: NotesPanelCtx = {
    open,
    openPanel: () => setOpen(persist(true)),
    closePanel: () => setOpen(persist(false)),
    togglePanel: () => setOpen((v) => persist(!v)),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotesPanel() {
  return useContext(Ctx);
}
