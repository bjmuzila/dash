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
 * Both panels are PRICE-ALIGNED: every row sits at the chart's own y for that
 * price, via the same `priceToY` the candle series answers with. That's the
 * whole reason the chain branch is ChainRail and not an embedded
 * /options-chain grid — see the note at the top of ChainRail.tsx. The chain's
 * numbers and heat ramp still come from the chain page's own math, now shared
 * through lib/calculations/optionChain.ts.
 */

import { type MutableRefObject } from "react";
import EsGexRail, { type RailRow } from "@/components/dashboard/EsGexRail";
import ChainRail from "./ChainRail";
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
  // Wider than the rail because it carries a value per row (strike on the left,
  // the greek in millions on the right) rather than a bar.
  chain: { w: 148, minChart: 340 },
};

interface SidePanelProps {
  kind: SidePanelKind;
  /** Resolved width in px — the card narrows the rail on small cards. */
  width: number;
  /** Ticker for the chain (SPX for ES, else the ETF itself). NOT gexSymbol. */
  chainSymbol: string;
  /** The card's heatmap intensity, so the chain heat matches the chart's. */
  intensity: number;
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
  kind, width, chainSymbol, intensity,
  railRows, callWall, putWall, gexFlip, spot, basis, priceToY, drawRef,
}: SidePanelProps) {
  if (kind === "none") return null;

  if (kind === "chain") {
    return (
      <div style={{ width, flexShrink: 0, minHeight: 320, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <ChainRail
          symbol={chainSymbol}
          basis={basis}
          priceToY={priceToY}
          drawRef={drawRef}
          intensity={intensity}
        />
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
