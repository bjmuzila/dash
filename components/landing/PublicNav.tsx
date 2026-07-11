"use client";

// Shared public-site toolbar (landing, /explore/*, /pricing).
//
// STYLE = the universal dashboard toolbar (components/shared/GlobalToolbar.tsx):
// a floating rounded pill inside a blue→teal gradient-border frame, near-opaque
// dark fill, deep drop shadow, and a cursor-follow cyan highlight clipped to the
// pill. Only the CONTENTS differ — public nav links + trial CTA instead of the
// app's hamburger/clock/dock buttons. If GlobalToolbar's look changes, mirror it
// here; do not invent a second toolbar language.

import { useRef, useState } from "react";
import Link from "next/link";
import { HOME_THEME as T } from "@/components/shared/homeTheme";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "CB Edge";

function cyanA(a: number) { return `rgba(33,158,188,${a})`; }
function blueA(a: number) { return `rgba(18,103,131,${a})`; }

export const PUBLIC_NAV = [
  { label: "Overview", href: "/#overview" },
  { label: "Features", href: "/#features" },
  { label: "Pricing", href: "/pricing?from=nav" },
  { label: "Docs", href: "/docs" },
];

/**
 * Total height the toolbar occupies (band padding + pill + gradient border).
 * The bar is ALWAYS fixed so it doesn't shift by a pixel when you navigate
 * between /, /explore/* and /pricing — every page that mounts PublicNav must
 * reserve exactly this much space at the top of its content.
 */
export const PUBLIC_NAV_HEIGHT = 95;

export default function PublicNav({
  /** Which pill reads as current. */
  active,
  /** Replaces the default trial + login buttons (e.g. /pricing passes UserMenu). */
  right,
}: {
  active?: string;
  right?: React.ReactNode;
}) {
  // Cursor-follow highlight, same as GlobalToolbar.
  const pillRef = useRef<HTMLDivElement | null>(null);
  const [glow, setGlow] = useState<{ x: number; y: number } | null>(null);
  const onMove = (e: React.MouseEvent) => {
    const r = pillRef.current?.getBoundingClientRect();
    if (r) setGlow({ x: e.clientX - r.left, y: e.clientY - r.top });
  };

  return (
    <>
      <style>{`
        .pnav-link { transition: background .14s, border-color .14s, color .14s, box-shadow .14s, transform .14s; }
        .pnav-link:hover {
          background: ${cyanA(0.14)};
          border-color: ${cyanA(0.55)};
          color: ${T.cyan};
          transform: translateY(-1px);
          box-shadow: 0 4px 12px -2px ${cyanA(0.45)};
        }
        .pnav-cta { transition: transform .14s, box-shadow .14s, border-color .14s; }
        .pnav-cta:hover { transform: translateY(-1px); box-shadow: 0 8px 22px -4px ${cyanA(0.65)}; }
        .pnav-ghost { transition: background .14s, border-color .14s, transform .14s; }
        .pnav-ghost:hover { background: ${cyanA(0.14)}; border-color: ${cyanA(0.55)}; transform: translateY(-1px); }
        @keyframes pnavPulse {
          0%,100% { box-shadow: 0 0 0 0 ${cyanA(0.45)}; }
          50% { box-shadow: 0 0 0 9px rgba(33,158,188,0); }
        }
        .pnav-pulse { animation: pnavPulse 2.4s ease-out infinite; }
        @media (prefers-reduced-motion: reduce) { .pnav-pulse { animation: none; } }
        @media (max-width: 960px) { .pnav-links { display: none !important; } }
      `}</style>

      {/* Outer band — gives the pill breathing room so it floats over content.
          Always fixed: identical position on every public page, no jump on nav. */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          flexShrink: 0,
          height: PUBLIC_NAV_HEIGHT,
          padding: "10px clamp(12px, 2vw, 20px)",
          boxSizing: "border-box",
          zIndex: 50,
        }}
      >
        {/* Gradient-border frame (blue → teal) */}
        <div
          style={{
            width: "100%",
            borderRadius: 999,
            padding: 1.5,
            background: `linear-gradient(110deg, ${cyanA(0.55)}, ${blueA(0.4)} 35%, ${cyanA(0.15)} 60%, ${cyanA(0.55)})`,
            boxShadow: `0 14px 34px -14px rgba(0,0,0,0.8), 0 0 18px -6px ${cyanA(0.4)}`,
          }}
        >
          <div
            ref={pillRef}
            onMouseMove={onMove}
            onMouseLeave={() => setGlow(null)}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: "clamp(8px, 1.2vw, 16px)",
              height: 72,
              padding: "0 16px",
              borderRadius: 998,
              background: "rgba(10,13,20,0.96)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              boxSizing: "border-box",
            }}
          >
            {/* cursor-follow cyan highlight (clipped to the pill) */}
            <span
              aria-hidden
              style={{ position: "absolute", inset: 0, borderRadius: 998, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}
            >
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  opacity: glow ? 1 : 0,
                  transition: "opacity 0.25s",
                  background: glow
                    ? `radial-gradient(170px circle at ${glow.x}px ${glow.y}px, ${cyanA(0.2)}, transparent 70%)`
                    : "none",
                }}
              />
            </span>

            {/* Logo */}
            <Link href="/" style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", flexShrink: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/cb-edge-logo.png"
                alt={APP_NAME}
                style={{ height: 52, width: "auto", display: "block", objectFit: "contain" }}
              />
            </Link>

            {/* Center nav — absolutely centered on the PILL, not on the leftover
                space between the logo and the right cluster. Otherwise the pills
                slide whenever the right cluster changes width (e.g. /pricing
                swaps the trial CTA for a UserMenu). */}
            <nav
              className="pnav-links"
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                zIndex: 1,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {PUBLIC_NAV.map((n) => {
                const on = active === n.label;
                return (
                  <Link
                    key={n.label}
                    href={n.href}
                    className="pnav-link"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      height: 38,
                      padding: "0 18px",
                      borderRadius: 999,
                      fontSize: 14,
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                      textDecoration: "none",
                      whiteSpace: "nowrap",
                      border: `1px solid ${on ? cyanA(0.45) : "transparent"}`,
                      background: on ? cyanA(0.12) : "rgba(255,255,255,0.04)",
                      color: on ? T.cyan : T.text,
                    }}
                  >
                    {n.label}
                  </Link>
                );
              })}
            </nav>

            {/* Right cluster — pinned to the right edge of the pill. */}
            <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginLeft: "auto" }}>
              {right ?? (
                <>
                  <Link href="/pricing?from=nav&trial=1" className="pnav-cta pnav-pulse" style={ctaBtn}>
                    START FREE TRIAL <span style={{ opacity: 0.8 }}>›</span>
                  </Link>
                  <Link href="/sign-in" className="pnav-ghost" style={ghostBtn}>
                    LOGIN
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ── styles ─────────────────────────────────────────────────────────────── */

const ctaBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  height: 38,
  padding: "0 18px",
  borderRadius: 999,
  fontSize: 12.5,
  fontWeight: 900,
  letterSpacing: "0.07em",
  color: "#fff",
  textDecoration: "none",
  whiteSpace: "nowrap",
  background: `linear-gradient(180deg, ${cyanA(0.85)}, ${blueA(0.9)})`,
  border: `1px solid ${cyanA(0.6)}`,
};

const ghostBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 38,
  padding: "0 16px",
  borderRadius: 999,
  fontSize: 12.5,
  fontWeight: 800,
  letterSpacing: "0.07em",
  color: T.text,
  textDecoration: "none",
  whiteSpace: "nowrap",
  background: "rgba(255,255,255,0.04)",
  border: `1px solid ${cyanA(0.3)}`,
};
