"use client";

/**
 * /es-candles — a row of 1 to 3 independent candle charts.
 *
 * The whole of a single chart lives in components/dashboard/es-candles/
 * EsChartCard.tsx; this file is only the workspace around it: how many charts,
 * what rides their right edge, and the persistence for those two page-level
 * choices. Everything else — symbol, timeframe, expiry, overlays, bubble
 * sliders — belongs to a card and is stored per slot, so three charts can
 * disagree about everything and still come back the way you left them.
 *
 * Two things stay page-level on purpose:
 *   • The side panel (None / GEX Rail / 0DTE Chain). The chain is a real fetch;
 *     letting each card choose turns "show me the chain" into three of them.
 *   • The card count, obviously.
 *
 * The home dashboard still imports THIS file (app/home/HomeClient.tsx renders
 * `<EsCandlesPage embedded leading={gexViewSwitch} />`), so the `{ leading,
 * embedded }` signature is load-bearing. In that mode the page collapses to a
 * single card and renders no chrome of its own.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import EsChartCard from "@/components/dashboard/es-candles/EsChartCard";
import {
  MAX_CARDS, ensureMigrated, readCardCount, writeCardCount, readSidePanel, writeSidePanel,
  type SidePanelKind,
} from "@/components/dashboard/es-candles/slotStore";
import { Dock, DockGap, SegGroup } from "@/components/shared/DockToolbar";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";

const PANEL_OPTIONS: Array<{ label: string; value: SidePanelKind }> = [
  { label: "None", value: "none" },
  { label: "GEX Rail", value: "rail" },
  { label: "0DTE Chain", value: "chain" },
];

export default function EsCandlesPage({ leading, embedded = false }: { leading?: ReactNode; embedded?: boolean } = {}) {
  // Page-level choices. Read in an effect, never in a useState initializer:
  // this route is still server-rendered by Next before the Vite SPA takes over,
  // and a localStorage read during the first render is a hydration mismatch.
  // The first paint is therefore always 1 card / rail, which is also the
  // sensible default for a new user.
  const [cards, setCards] = useState(1);
  const [sidePanel, setSidePanelState] = useState<SidePanelKind>("rail");

  useEffect(() => {
    // Folds the pre-multi-card keys into slot blobs. Idempotent; no-ops once
    // slot 0 exists. Must run before the cards mount and read their slots —
    // effects flush in declaration order, and this one is declared first.
    ensureMigrated();
    setCards(readCardCount());
    setSidePanelState(readSidePanel());
  }, []);

  const setCardCount = useCallback((n: number) => {
    const clamped = Math.min(MAX_CARDS, Math.max(1, n));
    setCards(clamped);
    writeCardCount(clamped);
  }, []);
  const setSidePanel = useCallback((v: SidePanelKind) => {
    setSidePanelState(v);
    writeSidePanel(v);
  }, []);

  // The home GEX card embeds this component. It wants exactly the chart, with
  // its own switcher in the dock and no page chrome — so short-circuit to one
  // card rather than growing an `embedded` branch through the layout below.
  if (embedded) {
    // density="full" pins the home card to the dock it has today. Its width sits
    // near the compact threshold, and this page's layout work has no business
    // silently restyling the home dashboard's toolbar.
    return <EsChartCard slot="embed" sidePanel="rail" leading={leading} embedded density="full" />;
  }

  return (
    <div className="es-candles-page flex h-full flex-col" style={{ background: HOME_THEME.bg, backgroundImage: HOME_THEME.shellGlow }}>
      {/* Page dock. Deliberately thin: everything here applies to the ROW.
          Per-chart controls live in each card's own dock so it's always obvious
          which chart a control is about to change. */}
      <div className="px-4 pt-3" style={{ position: "relative", zIndex: 40 }}>
        <Dock className="dock-noscroll" noScroll style={{ minWidth: 0 }}>
          <span className="font-bold uppercase tracking-[0.2em]" style={{ fontSize: 13, color: LIGHT_BLUE, whiteSpace: "nowrap" }}>
            Charts
          </span>
          <SegGroup
            options={Array.from({ length: MAX_CARDS }, (_, i) => ({ label: String(i + 1), value: String(i + 1) }))}
            active={String(cards)}
            onChange={(v) => setCardCount(Number(v))}
          />
          <DockGap />
          <span className="font-bold uppercase tracking-[0.2em]" style={{ fontSize: 13, color: LIGHT_BLUE, whiteSpace: "nowrap" }}>
            Side panel
          </span>
          <SegGroup
            options={PANEL_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
            active={sidePanel}
            onChange={(v) => setSidePanel(v as SidePanelKind)}
          />
          <span style={{ fontSize: 11, color: HOME_THEME.muted, opacity: 0.7, whiteSpace: "nowrap" }}>
            applies to every chart
          </span>
        </Dock>
      </div>

      {/* One row. Equal columns, each free to shrink — minWidth:0 on the flex
          items, or a card's own dock would set a min-content floor and the row
          would overflow the viewport instead of the cards getting narrower.
          Each card measures its own width and switches to its compact dock. */}
      <div className="es-candles-row flex flex-1 flex-row gap-2 px-2 pb-2" style={{ minHeight: 0 }}>
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="flex flex-1 flex-col" style={{ minWidth: 0, minHeight: 0 }}>
            <EsChartCard slot={i} sidePanel={sidePanel} />
          </div>
        ))}
      </div>
    </div>
  );
}
