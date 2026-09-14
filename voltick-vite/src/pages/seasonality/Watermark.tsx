// ─────────────────────────────────────────────────────────────────────────────
// The Voltick mark on every seasonality card.
//
// ONE PER CARD, top right. The CB Edge original loads a PNG lockup out of
// /public; this build draws the mark as INLINE SVG instead, for two reasons
// that both matter here:
//
//   • voltick-vite ships no image assets, and /assets/* on this subdomain is
//     behind nginx's auth_request. An <img> would be a second gated request per
//     card on a page that mounts a dozen of them.
//   • The mark is then painted from ACCENT and SKY, so it follows the theme
//     rather than carrying a baked-in colour of its own.
//
// It is the same bolt Shell.tsx draws in the top bar, at the same proportions,
// with the wordmark beside it. The gradient id is namespaced per mount because
// several of these are in the document at once and a duplicate id makes every
// later bolt reference the first one's gradient.
//
// `pointerEvents: none` keeps it out of every hover target underneath;
// `aria-hidden` keeps it out of the accessibility tree, because it is branding,
// not content.
//
// Tradeoff worth stating once: a corner mark crops off in two seconds where a
// centered one has to be cloned out. That is the deliberate choice the CB Edge
// page made and this one keeps it.
// ─────────────────────────────────────────────────────────────────────────────

import { useId } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Card } from "../../components/PageCard";
import { SEA } from "./seaTheme";
import { ACCENT, PAPER, SKY, W_BOLD } from "../../theme";

/** Sits in the card's top-right corner, above the content. */
export function Watermark({ inset = 14 }: { inset?: number }) {
  const gid = `vk-wm-${useId()}`;
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        top: inset,
        right: inset,
        pointerEvents: "none",
        zIndex: 4,
        display: "flex",
        alignItems: "center",
        gap: 6,
        opacity: 0.4,
      }}
    >
      <svg width="13" height="16" viewBox="0 0 18 22" role="presentation">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={SKY} />
            <stop offset="100%" stopColor={ACCENT} />
          </linearGradient>
        </defs>
        <path d="M10.5 1 2 12.4h5.1L6.6 21 16 9.2h-5.2L10.5 1z" fill={`url(#${gid})`} />
      </svg>
      <span
        style={{
          fontSize: 11,
          fontWeight: W_BOLD,
          letterSpacing: "0.02em",
          color: PAPER,
          userSelect: "none",
        }}
      >
        Voltick
      </span>
    </div>
  );
}

/**
 * A themed Card with the mark in its corner. Every seasonality card goes
 * through this rather than `Card` directly, so no card can ship unmarked and
 * the mark's position is defined once.
 *
 * Props mirror the ones these cards actually use — deliberately not a spread of
 * Card's whole surface, so this stays a thin, obvious wrapper.
 */
export function SeaCard({
  title,
  subtitle,
  padding = 20,
  style,
  children,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  padding?: number | string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <Card
      // Hook for SHELL_CSS's phone breakpoint, which trims the card padding
      // with !important — Card writes its padding INLINE, so nothing weaker
      // can reach it. Same reason the background is set inline below.
      className="sea-card"
      title={title}
      subtitle={subtitle}
      padding={padding}
      style={{
        position: "relative",
        // Painted here, not by a class: the shared Card sets its background
        // INLINE, and no stylesheet can beat that. See seaTheme.ts.
        background: SEA.card,
        border: `1px solid ${SEA.line}`,
        ...style,
      }}
    >
      <Watermark />
      {children}
    </Card>
  );
}

export default Watermark;
