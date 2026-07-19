import { useEffect, useState, Suspense } from "react";
import type { CSSProperties } from "react";
import { Link, useLocation, Outlet } from "react-router-dom";
import { OWNER_SIDEBAR_GROUPS } from "./lib/nav";
import { OWNER_THEME } from "./lib/theme";
import OwnerToolbar from "./OwnerToolbar";

/**
 * OwnerShell — persistent left rail + content outlet for the owner-vite app.
 * Faithful port of components/shared/OwnerSidebar.tsx, swapping next/navigation
 * for react-router. Rendered once around all owner routes so every page inherits
 * the same nav automatically (add a link in lib/nav.ts → it appears here).
 */

function useIsMobile(): boolean {
  const [m, setM] = useState<boolean>(
    typeof window !== "undefined" ? window.matchMedia("(max-width: 820px)").matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 820px)");
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return m;
}

export default function OwnerShell() {
  const loc = useLocation();
  const pathname = loc.pathname || "";
  const activeTab = new URLSearchParams(loc.search).get("tab") || "overview";
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  // Exact-match only: a link is active solely on its own page. Control Panel
  // section links (/owner/dev/owner?tab=…) share one pathname → disambiguate on
  // the tab. Only ONE link is ever highlighted at a time.
  const isActive = (href: string) => {
    const q = href.indexOf("?tab=");
    if (q >= 0) return pathname === href.slice(0, q) && activeTab === href.slice(q + 5);
    return pathname === href;
  };

  // Close the drawer whenever the route (or active tab) changes on mobile.
  useEffect(() => {
    setOpen(false);
  }, [pathname, loc.search]);

  const asideStyle: CSSProperties = isMobile
    ? {
        position: "fixed",
        top: 0,
        bottom: 0,
        left: 0,
        zIndex: 120,
        width: "min(78vw, 260px)",
        transform: open ? "translateX(0)" : "translateX(-100%)",
        transition: "transform 0.22s ease",
        boxShadow: open ? "0 0 40px rgba(0,0,0,0.6)" : "none",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        padding: "18px 12px",
        paddingTop: "max(18px, env(safe-area-inset-top, 0px))",
        overflowY: "auto",
        background: "rgba(10,13,20,0.98)",
        backdropFilter: "blur(16px)",
        borderRight: `1px solid ${OWNER_THEME.border}`,
      }
    : {
        width: 224,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 18,
        padding: "18px 12px",
        overflowY: "auto",
        background: OWNER_THEME.panelBgStrong,
        borderRight: `1px solid ${OWNER_THEME.border}`,
      };

  const rail = (
    <aside style={asideStyle}>
      {OWNER_SIDEBAR_GROUPS.map((group) => (
        <div key={group.label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div
            style={{
              fontSize: 17,
              fontWeight: 800,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: group.accent,
              padding: "0 8px 5px",
            }}
          >
            {group.label}
          </div>
          {group.links.map((link) => {
            const here = isActive(link.href);
            return (
              <Link
                key={link.href}
                to={link.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: here ? 800 : 600,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                  color: here ? group.accent : OWNER_THEME.text,
                  background: here ? `${group.accent}1f` : "transparent",
                  border: `1px solid ${here ? `${group.accent}59` : "transparent"}`,
                }}
              >
                <span aria-hidden style={{ width: 18, textAlign: "center", opacity: 1, fontSize: 14 }}>
                  {link.glyph}
                </span>
                {link.label}
              </Link>
            );
          })}
        </div>
      ))}
    </aside>
  );

  const content = (
    <main style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Suspense
        fallback={
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: OWNER_THEME.cyan, fontSize: 14, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.7 }}>
            Loading…
          </div>
        }
      >
        <Outlet />
      </Suspense>
    </main>
  );

  const mobileControls = isMobile && (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Owner menu"
        aria-expanded={open}
        style={{
          position: "fixed",
          left: 12,
          bottom: "max(16px, env(safe-area-inset-bottom, 0px))",
          zIndex: 121,
          width: 48,
          height: 48,
          borderRadius: "50%",
          border: `1px solid ${OWNER_THEME.cyan}80`,
          background: "rgba(10,13,20,0.96)",
          color: OWNER_THEME.cyan,
          fontSize: 22,
          fontWeight: 800,
          lineHeight: 1,
          cursor: "pointer",
          boxShadow: "0 6px 18px rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {open ? "✕" : "☰"}
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 119, background: "rgba(0,0,0,0.5)" }}
        />
      )}
    </>
  );

  // Universal toolbar on top, then the rail + page content row beneath it.
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, height: "100%" }}>
      <OwnerToolbar />
      <div style={{ display: "flex", flex: 1, minHeight: 0, position: "relative" }}>
        {mobileControls}
        {rail}
        {content}
      </div>
    </div>
  );
}
