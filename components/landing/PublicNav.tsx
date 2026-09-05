"use client";

// Shared public-site toolbar (landing, /explore/*, /pricing).
//
// STYLE = v3 (2026-09-05). It used to mirror v2's GlobalToolbar: a floating
// rounded pill inside a blue→teal gradient-border frame, near-opaque dark fill,
// deep drop shadow and a cursor-follow cyan highlight clipped to the pill. v3's
// chrome is flat — an opaque #0f1117 band, one #23272e hairline underneath, and
// controls that are 8px-radius plates rather than 999px pills. The gradient
// border, the bloom and the cursor highlight are all gone, and none of them
// should come back one at a time.
//
// Colours come from components/landing/v3Theme.ts and nowhere else. This file
// used to declare its own `cyanA()` / `blueA()` helpers over hardcoded rgb
// triples; that is exactly the drift v3's token rule exists to stop.

import Link from "next/link";
import { V3, V3_RADIUS, V3_TEXT, v3a } from "@/components/landing/v3Theme";
import { BRAND_LOGO_SRC } from "@/lib/brand";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "CB Edge";

export const PUBLIC_NAV = [
  { label: "Overview", href: "/#overview" },
  { label: "Pricing", href: "/pricing?from=nav" },
  { label: "Docs", href: "/docs" },
];

/**
 * Total height the toolbar occupies. The bar is ALWAYS in flow (sticky) so it
 * doesn't shift by a pixel when you navigate between /, /explore/* and
 * /pricing. Pages must NOT add manual top padding to compensate; the band does
 * it. Shorter than the old 95px because the pill and its gradient frame are
 * gone — a v3 toolbar is a band, not a floating capsule.
 */
export const PUBLIC_NAV_HEIGHT = 64;

export default function PublicNav({
  /** Which link reads as current. */
  active,
  /** Replaces the default trial + login buttons (e.g. /pricing passes UserMenu). */
  right,
}: {
  active?: string;
  right?: React.ReactNode;
}) {
  return (
    <>
      <style>{`
        /* v3 hover: step UP the surface ladder, take the accent on the edge.
           No transform, no glow — v3 chrome does not move under the cursor. */
        .pnav-link { transition: background .14s, border-color .14s, color .14s; }
        .pnav-link:hover { background: ${V3.raised}; border-color: ${V3.cyan}; color: ${V3.fg}; }
        .pnav-cta { transition: background .14s; }
        .pnav-cta:hover { background: ${v3a(V3.cyan, 0.85)}; }
        .pnav-ghost { transition: background .14s, border-color .14s; }
        .pnav-ghost:hover { background: ${V3.raised}; border-color: ${V3.cyan}; }
        @media (max-width: 960px) { .pnav-links { display: none !important; } }
        /* Phones: the right cluster plus a full-size logo is wider than the
           viewport. Shrink both so the bar fits ~360px. */
        @media (max-width: 520px) {
          .pnav-logo { height: 30px !important; }
          .pnav-cta, .pnav-ghost { height: 30px; padding: 0 10px; font-size: ${V3_TEXT.sm}px; }
        }
      `}</style>

      <div style={band}>
        <div style={inner}>
          {/* Logo */}
          <Link href="/" style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="pnav-logo"
              src={BRAND_LOGO_SRC}
              alt={APP_NAME}
              style={{ height: 38, width: "auto", maxWidth: 180, display: "block", objectFit: "contain" }}
            />
          </Link>

          {/* Center nav — absolutely centered on the BAND, not on the leftover
              space between the logo and the right cluster. Otherwise the links
              slide whenever the right cluster changes width (e.g. /pricing
              swaps the trial CTA for a UserMenu). */}
          <nav className="pnav-links" style={navRow}>
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
                    height: 32,
                    padding: "0 14px",
                    borderRadius: V3_RADIUS.md,
                    fontSize: V3_TEXT.base,
                    fontWeight: 600,
                    letterSpacing: "0.03em",
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                    border: `1px solid ${on ? V3.cyan : "transparent"}`,
                    background: on ? V3.surface2 : "transparent",
                    color: V3.fg,
                  }}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>

          {/* Right cluster — pinned to the right edge of the band. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginLeft: "auto" }}>
            {right ?? (
              <>
                <Link href="/pricing?from=nav&trial=1" className="pnav-cta" style={ctaBtn}>
                  START FREE TRIAL <span aria-hidden>›</span>
                </Link>
                <Link href="/sign-in" className="pnav-ghost" style={ghostBtn}>
                  LOGIN
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/* ── styles ─────────────────────────────────────────────────────────────── */

const band: React.CSSProperties = {
  position: "sticky",
  top: 0,
  flexShrink: 0,
  height: PUBLIC_NAV_HEIGHT,
  boxSizing: "border-box",
  zIndex: 50,
  // v3 paints the toolbar band in --color-bg, the same tone as the canvas, and
  // separates it with a hairline rather than a shadow.
  background: V3.bg,
  borderBottom: `1px solid ${V3.line}`,
};

const inner: React.CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  gap: "clamp(8px, 1.2vw, 16px)",
  height: "100%",
  padding: "0 clamp(12px, 2vw, 20px)",
  boxSizing: "border-box",
};

const navRow: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  display: "flex",
  alignItems: "center",
  gap: 4,
};

const ctaBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 34,
  padding: "0 16px",
  borderRadius: V3_RADIUS.md,
  fontSize: V3_TEXT.sm,
  fontWeight: 700,
  letterSpacing: "0.07em",
  color: V3.fg,
  textDecoration: "none",
  whiteSpace: "nowrap",
  background: V3.cyan,
  border: `1px solid ${V3.cyan}`,
};

const ghostBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 34,
  padding: "0 14px",
  borderRadius: V3_RADIUS.md,
  fontSize: V3_TEXT.sm,
  fontWeight: 700,
  letterSpacing: "0.07em",
  color: V3.fg,
  textDecoration: "none",
  whiteSpace: "nowrap",
  background: V3.surface,
  border: `1px solid ${V3.line}`,
};
