"use client";

// Shared public-site toolbar (landing + /explore/*). Center pill nav, dashboard
// button language (DOCK_THEME tiles, cyan gloss), trial CTA on the right.
// NOT mounted on /pricing — that page is its own conversion surface.
//
// Sized off the dashboard toolbar: taller bar, bigger logo, chunkier tiles.

import Link from "next/link";
import { HOME_THEME as T, DOCK_THEME } from "@/components/shared/homeTheme";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "CB Edge";

export const PUBLIC_NAV = [
  { label: "Overview", href: "/#overview" },
  { label: "Features", href: "/#features" },
  { label: "Pricing", href: "/pricing?from=nav" },
  { label: "Docs", href: "/docs" },
];

export default function PublicNav({
  /** Fixed over the hero (landing) vs in-flow at the top of a content page. */
  variant = "fixed",
  /** Which pill reads as current. */
  active,
}: {
  variant?: "fixed" | "static";
  active?: string;
}) {
  return (
    <>
      <style>{`
        .pnav-link { transition: color .18s, background .18s, box-shadow .18s; }
        .pnav-link:hover { background: ${DOCK_THEME.hoverTile}; color: ${T.cyan}; }
        .pnav-cta { transition: transform .18s, box-shadow .18s; }
        .pnav-cta:hover { transform: translateY(-1px); box-shadow: 0 12px 34px rgba(33,158,188,0.42); }
        .pnav-ghost { transition: border-color .18s, background .18s; }
        .pnav-ghost:hover { border-color: rgba(33,158,188,0.55); background: ${DOCK_THEME.hoverTile}; }
        @keyframes pnavPulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(33,158,188,0.45); }
          50% { box-shadow: 0 0 0 10px rgba(33,158,188,0); }
        }
        .pnav-pulse { animation: pnavPulse 2.2s ease-out infinite; }
        @media (prefers-reduced-motion: reduce) { .pnav-pulse { animation: none; } }
        @media (max-width: 900px) { .pnav-links { display: none !important; } }
      `}</style>

      <header style={variant === "fixed" ? { ...bar, position: "fixed", top: 0, left: 0, right: 0 } : bar}>
        <div style={accentBar} aria-hidden />

        <Link href="/" style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/cb-edge-logo.png"
            alt={APP_NAME}
            style={{
              height: "clamp(48px, 5vw, 72px)",
              width: "auto",
              objectFit: "contain",
              filter: "drop-shadow(0 4px 16px rgba(33,158,188,0.35))",
            }}
          />
        </Link>

        <nav style={pillWrap} className="pnav-links">
          {PUBLIC_NAV.map((n) => {
            const on = active === n.label;
            return (
              <Link
                key={n.label}
                href={n.href}
                className="pnav-link"
                style={{
                  ...pillLink,
                  ...(on
                    ? {
                        background: DOCK_THEME.activeTile,
                        border: `1px solid ${DOCK_THEME.activeBorder}`,
                        boxShadow: DOCK_THEME.activeGlow,
                        color: T.cyan,
                      }
                    : {}),
                }}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
          <Link href="/pricing?from=nav&trial=1" style={ctaBtn} className="pnav-cta pnav-pulse">
            START FREE TRIAL <span style={{ opacity: 0.8 }}>›</span>
          </Link>
          <Link href="/sign-in" style={ghostBtn} className="pnav-ghost">
            LOGIN
          </Link>
        </div>
      </header>
    </>
  );
}

/* ── styles — dashboard toolbar language (DOCK_THEME) ─────────────────────── */

const bar: React.CSSProperties = {
  position: "relative",
  zIndex: 20,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  padding: "16px clamp(16px, 4vw, 40px)",
  minHeight: 92,
  background: DOCK_THEME.bg,
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  borderBottom: `1px solid ${T.border}`,
  boxShadow: DOCK_THEME.shadow,
};

// Bright cyan center-fade strip, same as the dashboard toolbar.
const accentBar: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  height: 2,
  pointerEvents: "none",
  background:
    "linear-gradient(90deg, transparent 0%, rgba(33,158,188,0.12) 15%, rgba(33,158,188,0.9) 50%, rgba(33,158,188,0.12) 85%, transparent 100%)",
  boxShadow: "0 0 8px rgba(33,158,188,0.35)",
};

const pillWrap: React.CSSProperties = {
  display: "flex",
  gap: 6,
  padding: 6,
  borderRadius: 12,
  background: "rgba(13,17,25,0.62)",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  border: `1px solid ${T.border}`,
};

const pillLink: React.CSSProperties = {
  padding: "11px 20px",
  borderRadius: 9,
  fontSize: 14,
  fontWeight: 800,
  letterSpacing: "0.05em",
  color: T.text,
  textDecoration: "none",
  border: "1px solid transparent",
  whiteSpace: "nowrap",
};

const ctaBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "13px 22px",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 900,
  letterSpacing: "0.07em",
  color: "#fff",
  textDecoration: "none",
  background: "linear-gradient(180deg, #2CB6D6, #1A7D9B)",
  border: "1px solid rgba(140,222,244,0.55)",
  boxShadow: "0 10px 28px rgba(33,158,188,0.30)",
  whiteSpace: "nowrap",
};

const ghostBtn: React.CSSProperties = {
  padding: "13px 20px",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: "0.07em",
  color: T.text,
  textDecoration: "none",
  background: "rgba(255,255,255,0.04)",
  border: `1px solid ${T.border}`,
  whiteSpace: "nowrap",
};
