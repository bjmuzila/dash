"use client";

import { useEffect, useMemo, useState } from "react";
import { HOME_THEME } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { TickerListDropdown } from "@/components/shared/TickerListDropdown";
import {
  GexRegimeCard,
  useRegimeData,
  synthesize,
  fmtUsdShort,
} from "@/components/dashboard/GexRegimeCard";

const DEFAULT_TICKERS = ["SPX", "SPY", "QQQ"];

/** The user's saved 4-ticker Positioning list (same source as /test Positioning
 * tab) — falls back to the SPX/SPY/QQQ core set when signed out or unset. */
function useMainTickers(): string[] {
  const [tickers, setTickers] = useState<string[]>(DEFAULT_TICKERS);
  useEffect(() => {
    let alive = true;
    fetch("/api/positioning-tickers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return;
        if (Array.isArray(j?.tickers) && j.tickers.length) setTickers(j.tickers);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return tickers;
}

type Step = { n: number; title: string; body: string; live: string; liveTone?: string };

function StepCard({ step }: { step: Step }) {
  return (
    <div
      style={{
        flex: "1 1 220px",
        minWidth: 220,
        background: HOME_THEME.panelBg,
        backdropFilter: "blur(16px)",
        border: `1px solid ${HOME_THEME.border}`,
        borderRadius: 16,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: HOME_THEME.green,
          color: HOME_THEME.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          fontWeight: 800,
        }}
      >
        {step.n}
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, color: HOME_THEME.text, lineHeight: 1.3 }}>
        {step.title}
      </div>
      <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.7, lineHeight: 1.6 }}>
        {step.body}
      </div>
      <div
        style={{
          marginTop: "auto",
          paddingTop: 10,
          borderTop: `1px solid ${HOME_THEME.border}`,
          fontSize: 13,
          fontWeight: 700,
          color: step.liveTone ?? HOME_THEME.cyan,
          lineHeight: 1.5,
        }}
      >
        {step.live}
      </div>
    </div>
  );
}

export default function LogicOrderPage() {
  const mainTickers = useMainTickers();
  const [ticker, setTicker] = useState(DEFAULT_TICKERS[0]);
  useEffect(() => { setTicker(mainTickers[0] ?? DEFAULT_TICKERS[0]); }, [mainTickers]);

  const { wave, gex, err, loadedAt } = useRegimeData(ticker);
  const cond = useMemo(() => synthesize(wave, gex, ticker), [wave, gex, ticker]);

  const steps: Step[] = [
    {
      n: 1,
      title: "Check the bias",
      body: "Net GEX (aggregate across the chain) vs. the gamma flip. Positive GEX above the flip leans bullish/stable — dealers dampen moves. Negative GEX below the flip leans bearish/volatile — moves accelerate. Near the flip is neutral.",
      live: gex
        ? `${gex.biasLabel} — net GEX ${fmtUsdShort(gex.totalGex)}, spot ${gex.spot.toFixed(2)}${gex.flip != null ? ` vs. flip ${gex.flip.toFixed(1)}` : " (no flip found)"}.`
        : "Loading chain…",
      liveTone: gex?.biasTone,
    },
    {
      n: 2,
      title: "Find the Apex Level",
      body: "The Apex Level is the strongest pull on the map — the strike with the largest dealer gamma concentration, drawing price toward it like a magnet, especially near expiration.",
      live: gex?.apex
        ? `CB Level: ${Math.round(gex.apex.strike)} (${fmtUsdShort(gex.apex.gex)}) — heaviest dealer hedging on the chain.`
        : "Loading chain…",
    },
    {
      n: 3,
      title: "Watch key levels",
      body: "Call Wall = top resistance (fade rallies / watch for a break). Put Wall = key support (expect a bounce or an accelerated break). In positive gamma, price ranges between the walls; in negative gamma, breaks accelerate.",
      live: gex
        ? `Call Wall ${gex.callWall ? Math.round(gex.callWall.strike) : "–"} · Put Wall ${gex.putWall ? Math.round(gex.putWall.strike) : "–"}. ${gex.totalGex > 0 ? "Positive gamma — expect range between the walls." : "Negative gamma — breaks can accelerate."}`
        : "Loading chain…",
    },
    {
      n: 4,
      title: "Wait for confirmation",
      body: "Confirm with price action at the CB level/flip/walls plus options flow — aggressive call or put buying, or price respecting/rejecting a level intraday. Don't fight the regime.",
      live: cond.stars > 0
        ? `${cond.label} · ${cond.stars}/5 — ${cond.bullets[0]}`
        : "Awaiting flow…",
      liveTone: cond.stars > 0 ? cond.tone : undefined,
    },
  ];

  return (
    <PageShell>
      <Card
        variant="budget"
        title="Logic & Order"
        subtitle={
          loadedAt
            ? `Live read for ${ticker} · updated ${new Date(loadedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })} ET`
            : "How to read the map, step by step."
        }
      >
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
          <TickerListDropdown
            activeTicker={ticker}
            onSelect={setTicker}
            universe={mainTickers}
            triggerLabel={ticker}
          />
        </div>

        {err && (
          <div style={{ fontSize: 12, color: HOME_THEME.red, marginBottom: 12 }}>
            Feed error: {err}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          {steps.map((s) => (
            <StepCard key={s.n} step={s} />
          ))}
        </div>
      </Card>

      <GexRegimeCard symbol={ticker} subtitle="Full WAVE + 0-DTE structure breakdown for the ticker above." />
    </PageShell>
  );
}
