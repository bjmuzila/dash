"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The CB Edge mark on every seasonality card.
//
// ONE PER CARD, top right. It used to be one per chart and per table, centered —
// which put three or four marks on a card like Opex and sat them over the data.
// Card-level means exactly one mark per screenshot, in the corner the card title
// leaves empty.
//
// Tradeoff worth stating once: a corner mark crops off in two seconds where a
// centered one has to be cloned out. This is the deliberate choice, not an
// oversight — if reposting ever becomes a real problem, the fix is to move it
// back to center, not to make it darker.
//
// `/cb-edge-logo.png` is a chrome wordmark on a genuinely transparent background
// (alpha 0 at the corners — checked, not assumed). `pointerEvents: none` keeps it
// out of every hover target underneath; `aria-hidden` keeps it out of the
// accessibility tree, because it is branding, not content.
//
// The asset loads as a plain <img> from /public, the same way PublicNav does it.
// That matters on the signed-out page: the middleware matcher explicitly
// excludes ".png", so it is never auth-gated. Do not swap it for a fetched or
// generated source without re-checking that.
// ─────────────────────────────────────────────────────────────────────────────

import type { CSSProperties, ReactNode } from "react";
import { Card } from "@/components/shared/PageCard";
import { SEA } from "./seaTheme";

/** Sits in the card's top-right corner, above the content. */
export function Watermark({ inset = 14 }: { inset?: number }) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        top: inset,
        right: inset,
        pointerEvents: "none",
        zIndex: 4,
        lineHeight: 0,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/cb-edge-logo.png"
        alt=""
        style={{ width: 104, height: "auto", opacity: 0.34, userSelect: "none", display: "block" }}
      />
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
      title={title}
      subtitle={subtitle}
      padding={padding}
      style={{
        position: "relative",
        // Painted here, not by a class: the shared Card sets its background
        // INLINE, and no stylesheet can beat that. See seaTheme.ts.
        background: SEA.card,
        border: `1px solid ${SEA.line}`,
        boxShadow: "none",
        ...style,
      }}
    >
      <Watermark />
      {children}
    </Card>
  );
}

export default Watermark;
