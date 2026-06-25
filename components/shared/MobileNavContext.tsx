"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// Breakpoint below which we treat layout as "mobile" (kept for any consumers that
// still branch on it; the nav is now a hamburger dropdown on every size).
export const MOBILE_BREAKPOINT = 900;

type MobileNavCtx = {
  isMobile: boolean;
  // ── hamburger dropdown menu (replaces the old persistent sidebar) ──
  menuOpen: boolean;
  openMenu: () => void;
  closeMenu: () => void;
  toggleMenu: () => void;
};

const Ctx = createContext<MobileNavCtx>({
  isMobile: false,
  menuOpen: false,
  openMenu: () => {},
  closeMenu: () => {},
  toggleMenu: () => {},
});

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [isMobile, setIsMobile] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Close the menu on any route change.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const value: MobileNavCtx = {
    isMobile,
    menuOpen,
    openMenu: () => setMenuOpen(true),
    closeMenu: () => setMenuOpen(false),
    toggleMenu: () => setMenuOpen((v) => !v),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMobileNav() {
  return useContext(Ctx);
}
