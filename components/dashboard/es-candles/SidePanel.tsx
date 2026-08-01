"use client";

/**
 * The panel that rides the right edge of every ES Candles card.
 *
 * PAGE-level, not per card: one choice for the whole row. That's partly so three
 * charts side by side read as one instrument panel rather than three unrelated
 * ones, and partly practical — the 0DTE chain is a real fetch, and per-card
 * choice makes "show me the chain" mean three of them.
 *
 *   none  — nothing. All the width goes to candles.
 *   rail  — the vertical GEX-by-strike rail, price-aligned to the candle chart.
 *   chain — the 0DTE option chain, pinned to today's expiry.
 *
 * The chain branch REUSES app/options-chain/page.tsx rather than reimplementing
 * a ladder. That component already takes `ticker` / `expiryCount` /
 * `showGrandTotal` for the home dashboard's embed; this adds `pinnedExpiry`,
 * `hideToolbar` and `compact` so it can also be a 230px column. One
 * implementation means the greek switcher, the heat scale and the strike
 * formatting can't drift between the two places they appear.
 */

import { lazy, Suspense, type MutableRefObject } from "react";
import EsGexRail, { type RailRow } from "@/components/dashboard/EsGexRail";
import { HOME_THEME } from "@/components/shared/homeTheme";
// Declared in slotStore (which has no React dependency) so the page-level
// persistence and this component can't drift into two spellings of the union.
import type { SidePanelKind } from "./slotStore";

export type { SidePanelKind };

/**
 * Per-kind geometry.
 *
 *   w         — the panel's width in px (the rail narrows below this; see the
 *               card's panelW).
 *   minChart  — how much CHART must survive after the panel, or the panel is
 *               suppressed entirely.
 *
 * This replaces a single flat `RAIL_MIN_WIDTH = 560` measured against total card
 * width. That number couldn't survive two panel kinds and three cards: what
 * actually matters is the width left for candles, and the chain is twice the
 * rail. At 1920 3-up (~624px cards) both fit; at 1440 3-up (~464px) the rail
 * survives and the chain steps aside.
 */
export const SIDE_PANEL_SPEC: Record<SidePanelKind, { w: number; minChart: number }> = {
  none:  { w: 0,   minChart: 0 },
  rail:  { w: 115, minChart: 340 },
  chain: { w: 230, minChart: 420 },
};

// Lazily loaded: the options-chain module is large, and a user who never turns
// the chain on should never pay for it. The route itself is already code-split
// by app-vite, so this keeps the parity.
const OptionsChainPage = lazy(() => import("@/app/options-chain/page"));

interface SidePanelProps {
  kind: SidePanelKind;
  /** Resolved width in px — the card narrows the rail on small cards. */
  width: number;
  /** Ticker for the chain (SPX for ES, else the ETF itself). NOT gexSymbol. */
  chainSymbol: string;
  railRows: RailRow[];
  callWall: number | null;
  putWall: number | null;
  gexFlip: number | null;
  spot: number | null;
  basis: number;
  priceToY: (esPrice: number) => number | null;
  drawRef?: MutableRefObject<() => void>;
}

export default function SidePanel({
  kind, width, chainSymbol,
  railRows, callWall, putWall, gexFlip, spot, basis, priceToY, drawRef,
}: SidePanelProps) {
  if (kind === "none") return null;

  if (kind === "chain") {
    return (
      <div style={{ width, flexShrink: 0, minHeight: 320, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Suspense fallback={
          <div style={{ flex: 1, display: "grid", placeItems: "center", fontSize: 11, color: HOME_THEME.muted }}>
            Loading chain…
          </div>
        }>
          {/*
            expiryCount={1} + pinnedExpiry="0dte" = exactly one column, today's
            expiry, re-pinned on an ET day rollover. defaultPercent={5} because
            the chain's own auto rule gives SPX a ±10% strike window — roughly
            ninety strikes, which in a 230px column is a scrollbar, not a read.
          */}
          <OptionsChainPage
            ticker={chainSymbol}
            pinnedExpiry="0dte"
            expiryCount={1}
            defaultPercent={5}
            hideToolbar
            compact
            showGrandTotal={false}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div style={{ width, flexShrink: 0, minHeight: 320 }}>
      <EsGexRail
        rows={railRows}
        callWall={callWall}
        putWall={putWall}
        gexFlip={gexFlip}
        spot={spot}
        basis={basis}
        priceToY={priceToY}
        drawRef={drawRef}
      />
    </div>
  );
}
