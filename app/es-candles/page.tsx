"use client";

/**
 * /es-candles — a row of 1 to 3 candle charts.
 *
 * A single chart lives in components/dashboard/es-candles/EsChartCard.tsx; this
 * file is the workspace around it: how many charts, what rides their right
 * edge, and where the toolbar goes.
 *
 * ── One chart vs several ────────────────────────────────────────────────────
 * At ONE chart the card owns its whole dock, exactly as the page always worked.
 *
 * At two or three, three copies of a 1,200px toolbar is most of the screen, so
 * the row switches to a SHARED toolbar: one dock, hoisted up here, driving every
 * chart at once. The only per-chart control left is the ticker — which is the
 * point of the layout. ES / SPY / QQQ side by side on one timeframe with one set
 * of overlays is a comparison; three charts each with their own everything is
 * three pages in a trenchcoat.
 *
 * Mechanically the shared dock is still card 0's dock, portaled into the target
 * below (see EsChartCard's `dockMode`). It stays wired to card 0's live feed
 * state — the expirations list, the replay frames, the connection status — and
 * its writes broadcast to the other cards through slotStore. Lifting those
 * controls into this file would mean this file owning the websocket.
 *
 * The home dashboard still imports THIS file (app/home/HomeClient.tsx renders
 * `<EsCandlesPage embedded leading={gexViewSwitch} />`), so the `{ leading,
 * embedded }` signature is load-bearing. In that mode the page collapses to a
 * single card and renders no chrome of its own.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import EsChartCard from "@/components/dashboard/es-candles/EsChartCard";
import {
  MAX_CARDS, SHARED_SLOT, ensureMigrated,
  readCardCount, writeCardCount, readSidePanel, writeSidePanel,
  readChainGreek, writeChainGreek,
  type SidePanelKind,
} from "@/components/dashboard/es-candles/slotStore";
import { CHAIN_GREEKS, GREEK_LABEL, isChainGreek, type ChainGreek } from "@/components/dashboard/es-candles/ChainRail";
import { Dock, DockGap, SegGroup } from "@/components/shared/DockToolbar";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";

const PANEL_OPTIONS: Array<{ label: string; value: SidePanelKind }> = [
  { label: "None", value: "none" },
  { label: "Rail", value: "rail" },
  { label: "0DTE", value: "chain" },
];

export default function EsCandlesPage({ leading, embedded = false }: { leading?: ReactNode; embedded?: boolean } = {}) {
  // Page-level choices. Read in an effect, never in a useState initializer:
  // this route is still server-rendered by Next before the Vite SPA takes over,
  // and a localStorage read during the first render is a hydration mismatch.
  // The first paint is therefore always 1 card / rail, which is also the
  // sensible default for a new user.
  const [cards, setCards] = useState(1);
  const [sidePanel, setSidePanelState] = useState<SidePanelKind>("rail");
  const [chainGreek, setChainGreekState] = useState<ChainGreek>("gex");
  // The shared dock's mount point. State, not a ref: card 0 renders into it via
  // a portal, and a ref wouldn't re-render the tree once the node exists.
  const [dockTarget, setDockTarget] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    // Folds the pre-multi-card keys into slot blobs. Idempotent; no-ops once
    // slot 0 exists. (readSlot also calls it — React flushes child effects
    // before parent effects, so this one can't be relied on to run first.)
    ensureMigrated();
    setCards(readCardCount());
    setSidePanelState(readSidePanel());
    const g = readChainGreek();
    if (isChainGreek(g)) setChainGreekState(g);
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
  const setChainGreek = useCallback((v: ChainGreek) => {
    setChainGreekState(v);
    writeChainGreek(v);
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

  const multi = cards > 1;

  return (
    <div className="es-candles-page flex h-full flex-col" style={{ background: HOME_THEME.bg, backgroundImage: HOME_THEME.shellGlow }}>
      {/* Row 1 — what applies to the whole row: how many charts, what's on their
          right edge, and (when that's the 0DTE chain) which greek it paints. */}
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
            Panel
          </span>
          <SegGroup
            options={PANEL_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
            active={sidePanel}
            onChange={(v) => setSidePanel(v as SidePanelKind)}
          />
          {/* The chain's greek lives up here rather than in the panel itself for
              a structural reason, not a cosmetic one: ChainRail's box has to be
              exactly the chart container's box or its rows stop matching the
              chart's prices, so nothing may sit above its canvas. */}
          {sidePanel === "chain" && (
            <SegGroup
              options={CHAIN_GREEKS.map((g) => ({ label: GREEK_LABEL[g], value: g }))}
              active={chainGreek}
              onChange={(v) => setChainGreek(v as ChainGreek)}
            />
          )}
        </Dock>
      </div>

      {/* Row 2 — the shared chart toolbar. Card 0 portals its dock in here when
          there are 2–3 charts; at one chart the card keeps its own dock and this
          stays empty (and unrendered, so it costs no vertical space). */}
      {multi && (
        <div ref={setDockTarget} className="px-4" style={{ position: "relative", zIndex: 35, minWidth: 0 }} />
      )}

      {/* One row. Equal columns, each free to shrink — minWidth:0 on the flex
          items, or a card's own dock would set a min-content floor and the row
          would overflow the viewport instead of the cards getting narrower. */}
      <div className="es-candles-row flex flex-1 flex-row gap-2 px-2 pb-2" style={{ minHeight: 0 }}>
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="flex flex-1 flex-col" style={{ minWidth: 0, minHeight: 0 }}>
            <EsChartCard
              slot={i}
              // Multi-chart: everything but the ticker moves to one shared blob,
              // so the hoisted toolbar drives all of them. Single chart: the
              // card keeps its own slot and nothing about it changes.
              settingsSlot={multi ? SHARED_SLOT : undefined}
              dockMode={!multi ? "full" : i === 0 ? "shared" : "symbol"}
              dockTarget={dockTarget}
              sidePanel={sidePanel}
              chainGreek={chainGreek}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
