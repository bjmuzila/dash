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
};

const Ctx = createContext<GexPanelCtx>({
  open: false,
  openPanel: () => {},
  closePanel: () => {},
  togglePanel: () => {},
});

export function GexPanelProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

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
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGexPanel() {
  return useContext(Ctx);
}
