"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Whether the right-side GEX-groups pop-out is open. Persisted so it survives
// route changes and reloads; closing is explicit.
const OPEN_STORAGE_KEY = "gex-dock-open-v1";

type GexPanelCtx = {
  open: boolean;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  // Deep-link into a specific GexDock tile (e.g. from the toolbar's 1-5 quick
  // buttons) instead of just opening to whatever tile was last selected.
  // `requestedGroup` is a one-shot signal: GexDock consumes it (sets its
  // selectedId + clears it back to null) on the render after it changes.
  requestedGroup: string | null;
  openGroup: (id: string) => void;
  clearRequestedGroup: () => void;
};

const Ctx = createContext<GexPanelCtx>({
  open: false,
  openPanel: () => {},
  closePanel: () => {},
  togglePanel: () => {},
  requestedGroup: null,
  openGroup: () => {},
  clearRequestedGroup: () => {},
});

export function GexPanelProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [requestedGroup, setRequestedGroup] = useState<string | null>(null);

  useEffect(() => {
    try { setOpen(localStorage.getItem(OPEN_STORAGE_KEY) === "1"); } catch { /* ignore */ }
  }, []);

  const persist = (next: boolean) => {
    try { localStorage.setItem(OPEN_STORAGE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
    return next;
  };

  const value: GexPanelCtx = {
    open,
    openPanel: () => setOpen(persist(true)),
    closePanel: () => setOpen(persist(false)),
    togglePanel: () => setOpen((v) => persist(!v)),
    requestedGroup,
    openGroup: (id: string) => {
      setRequestedGroup(id);
      setOpen(persist(true));
    },
    clearRequestedGroup: () => setRequestedGroup(null),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGexPanel() {
  return useContext(Ctx);
}
