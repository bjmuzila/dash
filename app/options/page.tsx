"use client";

import type { ReactNode } from "react";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import SpxHeatmap from "@/components/spx/SpxHeatmap";
import SectorSunburst from "@/components/dashboard/SectorSunburst";
import { TickerProvider, useTicker } from "./tickerContext";
import TickerSelect from "./TickerSelect";
import OptionsPlaceholder from "./OptionsPlaceholder";

/**
 * Options dashboard layout.
 *
 *   ┌──────────────────────────┬───────────────────────────┐
 *   │ ticker selector          │                           │
 *   │ daily / yearly heatmap   │  S&P 500 sunburst         │
 *   ├──────────────────────────┼───────────────────────────┤
 *   │ candlestick (ES-based)   │  orderflow graph          │
 *   │                          │  live orderflow feed      │
 *   └──────────────────────────┴───────────────────────────┘
 *
 * Every card reads the selected symbol from TickerProvider, so the dropdown
 * drives the whole page. The heatmap and the sector wheel are live; the
 * candlestick and the two orderflow panels are still placeholders — no
 * fetches, sockets, or chart libs behind those yet.
 */

const GRID_CSS = `
.opt-cols { display: flex; gap: clamp(16px, 2vw, 32px); align-items: stretch; }
.opt-cols > div { display: flex; flex-direction: column; gap: clamp(16px, 2vw, 32px); min-width: 0; }
.opt-cols > div.opt-left { flex: 1.35 1 0; }
.opt-cols > div.opt-right { flex: 1 1 0; }
@media (max-width: 1100px) { .opt-cols { flex-direction: column; } }
`;

export default function OptionsPage() {
  return (
    <TickerProvider>
      <PageShell>
        <style>{GRID_CSS}</style>

        <div className="opt-cols">
          <div className="opt-left">
            {/* Cards use backdrop-filter (+ a hover transform), so each one is
                its own stacking context — a later sibling paints over an
                earlier one's overflow no matter what z-index the dropdown
                carries internally. Raising THIS card lifts the whole context,
                which is what keeps the open menu above the heatmap below. */}
            <div className="no-card-lift" style={{ position: "relative", zIndex: 30 }}>
              <Card variant="budget" accent={LIGHT_BLUE} padding={16} style={{ overflow: "visible" }}>
                <TickerSelect />
              </Card>
            </div>

            <HeatmapCard />

            <TickerCard title="Candlestick" subtitle="ES-based chart">
              <OptionsPlaceholder
                label="candles"
                shape="candles"
                minHeight={320}
                note="placeholder — chart component goes here"
              />
            </TickerCard>
          </div>

          <div className="opt-right">
            {/* Same wheel the Traders Dashboard runs — it brings its own header,
                expand/full-screen and snapshot button, and self-fetches
                /api/spx-sunburst, so it drops into a bare Card. It shows the
                whole index rather than the selected symbol, hence no ticker in
                the heading. */}
            <Card
              variant="budget"
              accent={LIGHT_BLUE}
              style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}
            >
              <SectorSunburst />
            </Card>

            <TickerCard title="Orderflow Graph" subtitle="cumulative delta">
              <OptionsPlaceholder label="orderflow" shape="bars" minHeight={200} />
            </TickerCard>

            <OrderflowFeedCard />
          </div>
        </div>
      </PageShell>
    </TickerProvider>
  );
}

/** Card whose header carries the selected symbol. */
function TickerCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const { ticker } = useTicker();
  return (
    <Card
      variant="budget"
      accent={LIGHT_BLUE}
      title={`${title} · ${ticker}`}
      subtitle={subtitle}
      style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}
    >
      {children}
    </Card>
  );
}

/**
 * Heatmap stays live — SpxHeatmap pulls /api/spx-heatmap and rolls forward on
 * its own each trading day (SPX only for now). Card carries no subtitle: the
 * grid and its tooltips are the whole story here.
 */
function HeatmapCard() {
  const { ticker } = useTicker();
  const isSpx = ticker === "SPX";
  return (
    <Card
      variant="budget"
      accent={LIGHT_BLUE}
      title={`Heatmap · ${ticker}`}
      style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}
    >
      {isSpx ? (
        <SpxHeatmap />
      ) : (
        <OptionsPlaceholder
          label="daily / yearly heatmap"
          shape="rows"
          minHeight={260}
          note="placeholder — heatmap is SPX-only until per-ticker data is wired"
        />
      )}
    </Card>
  );
}

const FEED_ROWS = [
  { t: "—:—:—", side: "BUY", qty: "—", px: "—", tag: "SWEEP" },
  { t: "—:—:—", side: "SELL", qty: "—", px: "—", tag: "BLOCK" },
  { t: "—:—:—", side: "BUY", qty: "—", px: "—", tag: "SPLIT" },
  { t: "—:—:—", side: "SELL", qty: "—", px: "—", tag: "SWEEP" },
  { t: "—:—:—", side: "BUY", qty: "—", px: "—", tag: "BLOCK" },
  { t: "—:—:—", side: "SELL", qty: "—", px: "—", tag: "SPLIT" },
];

const FEED_COLS = "80px 56px 1fr 1fr 76px";

/** Skeleton tape — BUY/SELL colors are a data encoding, tokenized not literal. */
function OrderflowFeedCard() {
  const { ticker } = useTicker();
  return (
    <Card
      variant="budget"
      accent={LIGHT_BLUE}
      title={`Live Orderflow Feed · ${ticker}`}
      subtitle="idle — no stream connected"
      style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}
    >
      <div style={{ border: `1px solid ${HOME_THEME.border}`, borderRadius: 12, overflow: "hidden", fontSize: 11 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: FEED_COLS,
            gap: 8,
            padding: "8px 14px",
            color: HOME_THEME.text,
            opacity: 0.55,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            borderBottom: `1px solid ${HOME_THEME.border}`,
          }}
        >
          <span>Time</span>
          <span>Side</span>
          <span>Size</span>
          <span>Price</span>
          <span>Type</span>
        </div>
        {FEED_ROWS.map((r, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: FEED_COLS,
              gap: 8,
              padding: "7px 14px",
              borderBottom: i === FEED_ROWS.length - 1 ? "none" : `1px solid ${HOME_THEME.border}`,
              color: HOME_THEME.text,
              opacity: 0.55,
            }}
          >
            <span>{r.t}</span>
            <span style={{ color: r.side === "BUY" ? HOME_THEME.cyan : HOME_THEME.orange, fontWeight: 800 }}>{r.side}</span>
            <span>{r.qty}</span>
            <span>{r.px}</span>
            <span>{r.tag}</span>
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: 10,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: HOME_THEME.text,
          opacity: 0.5,
        }}
      >
        {ticker} — placeholder rows
      </div>
    </Card>
  );
}
