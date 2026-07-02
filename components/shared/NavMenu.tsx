"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { HOME_THEME, DOCK_THEME } from "./homeTheme";
import { useMobileNav } from "./MobileNavContext";

// ─── icons (20px, stroke = currentColor) ─────────────────────────────────────
type IconProps = { size?: number };
const Svg = ({ size = 20, children }: IconProps & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
const HomeIcon = (p: IconProps) => <Svg {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></Svg>;
const ShieldIcon = (p: IconProps) => <Svg {...p}><path d="M12 2l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V5z" /></Svg>;

// glossy frosted dock language — centralized in homeTheme.ts (DOCK_THEME)
const CYAN_TOP = DOCK_THEME.cyanTop;
const DOCK_BG = DOCK_THEME.bg;
const DOCK_SHADOW = DOCK_THEME.shadow;
const ACTIVE_TILE = DOCK_THEME.activeTile;

const LEGAL_LINKS: { label: string; href: string }[] = [
  { label: "Disclaimer", href: "/disclaimer" },
  { label: "Risk Disclosure", href: "/risk-disclosure" },
  { label: "Terms of Service", href: "/terms" },
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Help & Docs", href: "/docs" },
];

type NavItem = { label: string; href: string };

// GEX pages — the only nav group left. Backend + Owner pages now live under the
// owner hub (/owner/*) and are owner-gated there, so they're no longer listed here.
const GEX_ITEMS: NavItem[] = [
  { label: "Home", href: "/home" },
  { label: "Multi Greek", href: "/mult-greek" },
  { label: "Traders Dashboard", href: "/traders-dashboard" },
  { label: "Options Chain", href: "/options-chain" },
  { label: "Estimated Moves", href: "/em" },
  { label: "Flow", href: "/flow" },
  { label: "Analytics", href: "/analytics" },
  { label: "ES Candles", href: "/es-candles" },
  { label: "Scanner", href: "/scanner" },
  { label: "ICT", href: "/ict" },
  { label: "Journal", href: "/trading" },
  { label: "Order Flow", href: "/order-flow" },
];

// Routes that exist in the nav but are not yet live — rendered as disabled labels
const COMING_SOON = new Set(["/ict", "/trading", "/order-flow"]);

// Monochrome Unicode glyphs per route — flat black/white across all platforms
// (no color-emoji fallback). Routes without an entry fall back to "•".
const ROUTE_SYMBOL: Record<string, string> = {
  "/home": "⌂",
  "/es-candles": "⑊",
  "/ict": "⌖",
  "/traders-dashboard": "⊞",
  "/docs": "☰",
  "/mult-greek": "∇",
  "/options-chain": "⛓",
  "/em": "↔",
  "/analytics": "▦",
  "/flow": "≈",
  "/scanner": "🔍︎",
  "/trading": "✎",
  "/order-flow": "⇅",
};
const routeSymbol = (href: string) => ROUTE_SYMBOL[href] ?? "•";

/** Small fixed-width monochrome glyph shown before a nav item label. */
function NavGlyph({ href }: { href: string }) {
  return (
    <span
      aria-hidden
      style={{
        width: 18,
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 15,
        lineHeight: 1,
        fontFamily: "'Segoe UI Symbol','Apple Symbols','Noto Sans Symbols2',sans-serif",
      }}
    >
      {routeSymbol(href)}
    </span>
  );
}

// ─── menu ────────────────────────────────────────────────────────────────────
// Anchored dropdown rendered under the toolbar hamburger. `anchor` is the
// hamburger button's bounding rect (so the panel lines up under it).
export default function NavMenu({ anchor }: { anchor: DOMRect | null }) {
  const pathname = usePathname();
  const { menuOpen, closeMenu } = useMobileNav();

  const [mounted, setMounted] = useState(false);
  const [legalOpen, setLegalOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const isActive = (href: string) => pathname === href || (href === "/home" && pathname === "/");

  // Close on outside click / Escape (route-change close handled by context).
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      // Ignore clicks on the hamburger itself (it manages its own toggle).
      if ((e.target as HTMLElement)?.closest?.("[data-nav-hamburger]")) return;
      closeMenu();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeMenu(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, closeMenu]);

  if (!mounted || !menuOpen) return null;

  const left = anchor ? Math.max(8, anchor.left) : 12;
  const top = anchor ? anchor.bottom + 10 : 60;

  const rowLink = (active: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 12px",
    borderRadius: 10,
    textDecoration: "none",
    fontSize: 15,
    fontWeight: active ? 700 : 500,
    color: active ? HOME_THEME.cyan : HOME_THEME.text,
    background: active ? ACTIVE_TILE : "transparent",
    border: active ? "1px solid rgba(33,158,188,0.30)" : "1px solid transparent",
    boxShadow: active ? "0 0 14px rgba(33,158,188,0.22)" : "none",
  });

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      className="nav-menu-panel"
      style={{
        position: "fixed",
        top,
        left,
        width: 300,
        maxHeight: "calc(100vh - 80px)",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        background: DOCK_BG,
        border: `1px solid ${HOME_THEME.border}`,
        borderTop: `2px solid ${CYAN_TOP}`,
        borderRadius: 16,
        boxShadow: DOCK_SHADOW,
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        zIndex: 100000,
        padding: 10,
      }}
    >
      <style>{`
        .nav-row:not(.nav-active):hover{
          background:rgba(255,255,255,0.07) !important;
        }
        /* themed scrollbar */
        .nav-menu-panel{ scrollbar-width: thin; scrollbar-color: rgba(33,158,188,0.35) transparent; }
        .nav-menu-panel::-webkit-scrollbar{ width: 8px; }
        .nav-menu-panel::-webkit-scrollbar-track{ background: transparent; margin: 6px 0; }
        .nav-menu-panel::-webkit-scrollbar-thumb{
          background: linear-gradient(180deg, rgba(33,158,188,0.45), rgba(33,158,188,0.22));
          border-radius: 999px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        .nav-menu-panel::-webkit-scrollbar-thumb:hover{
          background: linear-gradient(180deg, rgba(33,158,188,0.7), rgba(33,158,188,0.4));
          background-clip: padding-box;
        }
      `}</style>

      {/* Home */}
      <Link href="/home" prefetch={false} className={`nav-row${isActive("/home") ? " nav-active" : ""}`} style={rowLink(isActive("/home"))} onClick={closeMenu}>
        <HomeIcon size={18} />
        <span>Home</span>
      </Link>

      <div style={{ height: 1, background: HOME_THEME.border, margin: "6px 4px" }} />

      {/* GEX pages — flat list (single group, no accordion) */}
      {GEX_ITEMS.filter((i) => i.href !== "/home").map((item) => {
        const active = isActive(item.href);
        const comingSoon = COMING_SOON.has(item.href);
        if (comingSoon) {
          return (
            <div
              key={item.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 12px",
                borderRadius: 10,
                fontSize: 15,
                fontWeight: 500,
                color: HOME_THEME.muted,
                opacity: 0.5,
                cursor: "default",
                userSelect: "none",
              }}
            >
              <NavGlyph href={item.href} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
              <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.7, flexShrink: 0 }}>Soon</span>
            </div>
          );
        }
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            onClick={closeMenu}
            className={`nav-row${active ? " nav-active" : ""}`}
            style={rowLink(active)}
          >
            <NavGlyph href={item.href} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
          </Link>
        );
      })}

      {/* What's New (customer-facing changelog) — visible to everyone */}
      <div style={{ height: 1, background: HOME_THEME.border, margin: "6px 4px" }} />
      <div style={{ padding: "2px 2px 2px" }}>
        <Link
          href="/whats-new"
          prefetch={false}
          onClick={closeMenu}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "10px 12px",
            borderRadius: 10,
            cursor: "pointer",
            textDecoration: "none",
            color: isActive("/whats-new") ? HOME_THEME.cyan : HOME_THEME.muted,
            background: isActive("/whats-new") ? "rgba(33,158,188,0.08)" : "rgba(255,255,255,0.03)",
            border: `1px solid ${isActive("/whats-new") ? "rgba(33,158,188,0.28)" : HOME_THEME.border}`,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>✦</span>
          <span>What&apos;s New</span>
        </Link>
      </div>

      {/* footer: legal only (socials + Clerk avatar removed) */}
      <div style={{ height: 1, background: HOME_THEME.border, margin: "6px 4px" }} />
      <div style={{ position: "relative", padding: "2px 2px 2px" }}>
        <button
          onClick={() => setLegalOpen((v) => !v)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "10px 12px",
            borderRadius: 10,
            cursor: "pointer",
            color: legalOpen ? HOME_THEME.cyan : HOME_THEME.muted,
            background: legalOpen ? "rgba(33,158,188,0.08)" : "rgba(255,255,255,0.03)",
            border: `1px solid ${legalOpen ? "rgba(33,158,188,0.28)" : HOME_THEME.border}`,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          <ShieldIcon size={15} />
          <span>Disclaimer &amp; Legal</span>
        </button>
        {legalOpen && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "6px 2px 2px" }}>
            {LEGAL_LINKS.map((l) => {
              const active = pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  prefetch={false}
                  onClick={closeMenu}
                  style={{
                    padding: "7px 10px",
                    fontSize: 12.5,
                    fontWeight: active ? 700 : 500,
                    color: active ? HOME_THEME.cyan : HOME_THEME.text,
                    textDecoration: "none",
                    borderRadius: 8,
                    background: active ? "rgba(33,158,188,0.12)" : "transparent",
                  }}
                >
                  {l.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
